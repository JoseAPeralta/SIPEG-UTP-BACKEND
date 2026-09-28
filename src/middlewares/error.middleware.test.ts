import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createChildLogger, logger } from '../config/logger.js';
import { getLogContext } from '../lib/log-context.js';
import { ApiError } from '../utils/ApiError.js';

const mockChildErrorLog = vi.fn();
const mockChildLogger = { error: mockChildErrorLog, info: vi.fn(), warn: vi.fn() };

vi.mock('../config/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  createChildLogger: vi.fn(() => mockChildLogger),
}));

vi.mock('../lib/log-context.js', () => ({
  getLogContext: vi.fn(),
}));

import { errorHandler } from './error.middleware.js';

const mockedGetLogContext = vi.mocked(getLogContext);
const mockedCreateChildLogger = vi.mocked(createChildLogger);
const mockedLoggerError = vi.mocked(logger.error);

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

describe('errorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetLogContext.mockReturnValue({});
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
    expect(mockChildErrorLog).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('responds 500 and emits exactly one error log for unexpected errors', () => {
    const { req, res } = createReqRes();

    errorHandler(new Error('db blew up'), req, res, vi.fn());

    expect(res.statusCode).toBe(500);
    expect(mockedLoggerError).toHaveBeenCalledTimes(1);
    expect(mockedLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'http.error.unexpected' }),
      'http.error.unexpected',
    );
  });

  it('includes the serialized error in the log bindings', () => {
    const { req, res } = createReqRes();

    errorHandler(new Error('boom'), req, res, vi.fn());

    const bindings = mockedLoggerError.mock.calls[0]?.[0] as { err?: Error };
    expect(bindings.err).toBeInstanceOf(Error);
    expect(bindings.err?.message).toBe('boom');
  });

  it('uses a child logger with requestId when the log context has one', () => {
    mockedGetLogContext.mockReturnValue({ requestId: 'req-1' });
    const { req, res } = createReqRes();

    errorHandler(new Error('boom'), req, res, vi.fn());

    expect(mockedCreateChildLogger).toHaveBeenCalledWith({ requestId: 'req-1' });
    expect(mockChildErrorLog).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('uses the singleton logger when there is no log context', () => {
    const { req, res } = createReqRes();

    errorHandler(new Error('boom'), req, res, vi.fn());

    expect(mockedCreateChildLogger).not.toHaveBeenCalled();
    expect(mockedLoggerError).toHaveBeenCalledTimes(1);
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
});
