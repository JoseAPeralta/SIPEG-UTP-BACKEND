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
});
