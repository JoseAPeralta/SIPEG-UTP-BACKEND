import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequestLogger } from '../config/logger.js';
import { ApiError } from '../utils/ApiError.js';

const mockRequestErrorLog = vi.fn();

vi.mock('../config/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  createRequestLogger: vi.fn(() => ({
    error: mockRequestErrorLog,
    info: vi.fn(),
    warn: vi.fn(),
  })),
}));

import { errorHandler } from './error.middleware.js';

const mockedCreateRequestLogger = vi.mocked(createRequestLogger);

interface MockResponse extends Response {
  statusCode: number;
  body: unknown;
}

function createReqRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(this: MockResponse, code: number) {
      this.statusCode = code;
      return this;
    },
    json(this: MockResponse, payload: unknown) {
      this.body = payload;
      return this;
    },
  } as unknown as MockResponse;
  return { req: {} as Request, res };
}

/**
 * Reproduce el error que lanzan `express.json()` y `express.urlencoded()` a traves
 * de `http-errors`: un `SyntaxError` con `status`/`statusCode`, `type` y el
 * cuerpo crudo adjunto en `body`.
 */
function bodyParserError(options: { status?: number; type?: string } = {}): Error {
  const status = options.status ?? 400;
  return Object.assign(
    new SyntaxError('Unexpected token } in JSON at position 20 (line 1 column 21)'),
    {
      status,
      statusCode: status,
      type: options.type ?? 'entity.parse.failed',
      body: '{"code": "SIN-CERRAR',
      expose: true,
    },
  );
}

describe('errorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('responds with the ApiError statusCode and emits no error log', () => {
    const { req, res } = createReqRes();

    errorHandler(new ApiError(404, 'Resource not found.'), req, res, vi.fn());

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      success: false,
      message: 'Resource not found.',
      errors: [],
    });
    expect(mockedCreateRequestLogger).not.toHaveBeenCalled();
    expect(mockRequestErrorLog).not.toHaveBeenCalled();
  });

  it('responds 500 and emits exactly one error log for unexpected errors', () => {
    const { req, res } = createReqRes();

    errorHandler(new Error('db blew up'), req, res, vi.fn());

    expect(res.statusCode).toBe(500);
    expect(mockedCreateRequestLogger).toHaveBeenCalledTimes(1);
    expect(mockRequestErrorLog).toHaveBeenCalledTimes(1);
    expect(mockRequestErrorLog).toHaveBeenCalledWith('http.error.unexpected');
  });

  it('passes the error and the event metadata to the request logger', () => {
    const { req, res } = createReqRes();

    errorHandler(new Error('boom'), req, res, vi.fn());

    const bindings = mockedCreateRequestLogger.mock.calls[0]?.[0] as {
      event?: string;
      logType?: string;
      err?: Error;
    };
    expect(bindings.event).toBe('http.error.unexpected');
    expect(bindings.logType).toBe('application');
    expect(bindings.err).toBeInstanceOf(Error);
    expect(bindings.err?.message).toBe('boom');
  });

  it('never leaks internal details in the response body', () => {
    const { req, res } = createReqRes();

    errorHandler(
      new Error('postgres connection string: postgres://hunter2@internal'),
      req,
      res,
      vi.fn(),
    );

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      success: false,
      message: 'Internal server error.',
      errors: [],
    });
  });

  describe('errores de cliente de las librerias HTTP', () => {
    it('responde 400 y no emite log de error cuando el cuerpo JSON esta malformado', () => {
      const { req, res } = createReqRes();

      errorHandler(bodyParserError(), req, res, vi.fn());

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        success: false,
        message: 'Malformed request body.',
        errors: [],
      });
      expect(mockedCreateRequestLogger).not.toHaveBeenCalled();
      expect(mockRequestErrorLog).not.toHaveBeenCalled();
    });

    it('no filtra ni el mensaje del parser ni el cuerpo crudo en la respuesta', () => {
      const { req, res } = createReqRes();

      errorHandler(bodyParserError(), req, res, vi.fn());

      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain('Unexpected token');
      expect(serialized).not.toContain('SIN-CERRAR');
      expect(serialized).not.toContain('entity.parse.failed');
    });

    it('responde 413 con su propio mensaje cuando el cuerpo excede el limite', () => {
      const { req, res } = createReqRes();

      errorHandler(bodyParserError({ status: 413, type: 'entity.too.large' }), req, res, vi.fn());

      expect(res.statusCode).toBe(413);
      expect(res.body).toEqual({
        success: false,
        message: 'Request payload is too large.',
        errors: [],
      });
      expect(mockRequestErrorLog).not.toHaveBeenCalled();
    });

    it('responde 415 con su propio mensaje ante un content type no soportado', () => {
      const { req, res } = createReqRes();

      errorHandler(
        bodyParserError({ status: 415, type: 'encoding.unsupported' }),
        req,
        res,
        vi.fn(),
      );

      expect(res.statusCode).toBe(415);
      expect(res.body).toEqual({
        success: false,
        message: 'Unsupported media type.',
        errors: [],
      });
      expect(mockRequestErrorLog).not.toHaveBeenCalled();
    });

    it('cae en 500 cuando el status adjunto no es un numero', () => {
      const { req, res } = createReqRes();
      const error = Object.assign(new Error('boom'), { status: '400' });

      errorHandler(error, req, res, vi.fn());

      expect(res.statusCode).toBe(500);
      expect(mockRequestErrorLog).toHaveBeenCalledTimes(1);
    });

    it('cae en 500 cuando el status adjunto es 5xx: es un fallo del servidor', () => {
      const { req, res } = createReqRes();

      errorHandler(bodyParserError({ status: 502, type: 'upstream' }), req, res, vi.fn());

      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({
        success: false,
        message: 'Internal server error.',
        errors: [],
      });
      expect(mockRequestErrorLog).toHaveBeenCalledTimes(1);
    });

    it('lee statusCode cuando el error no trae status', () => {
      const { req, res } = createReqRes();
      const error = Object.assign(new Error('too large'), { statusCode: 413 });

      errorHandler(error, req, res, vi.fn());

      expect(res.statusCode).toBe(413);
      expect(mockRequestErrorLog).not.toHaveBeenCalled();
    });
  });
});
