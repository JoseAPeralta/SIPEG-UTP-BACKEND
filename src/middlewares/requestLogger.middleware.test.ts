import { EventEmitter } from 'node:events';

import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { accessLogLevel, requestLogger, resolveRequestId, routeTemplate } from './requestLogger.middleware.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface MockRequestOptions {
  headers?: Record<string, string>;
  path?: string;
  method?: string;
  statusCode?: number;
  writableFinished?: boolean;
  route?: { path: string };
  baseUrl?: string;
}

function createReqRes(options?: MockRequestOptions) {
  const headers = options?.headers ?? {};
  const headersSet: Record<string, string> = {};
  const req = {
    headers,
    method: options?.method ?? 'GET',
    path: options?.path ?? '/api/v1/users',
    baseUrl: options?.baseUrl ?? '',
    route: options?.route,
  };
  const res = {
    statusCode: options?.statusCode ?? 200,
    writableFinished: options?.writableFinished ?? true,
    setHeader: (name: string, value: string) => {
      headersSet[name] = value;
    },
  };
  return { req: req as unknown as Request, res: res as unknown as Response, headersSet };
}

function createEmitterPair(options?: MockRequestOptions) {
  const { req, res, headersSet } = createReqRes(options);
  const reqEmitter = new EventEmitter() as Request & EventEmitter;
  Object.assign(reqEmitter, req);
  const resEmitter = new EventEmitter() as Response & EventEmitter;
  Object.assign(resEmitter, res);
  return { reqEmitter, resEmitter, headersSet };
}

describe('resolveRequestId', () => {
  it('generates a UUID and sets the X-Request-ID header when no header is sent', () => {
    const { req, res, headersSet } = createReqRes();

    const requestId = resolveRequestId(req, res);

    expect(UUID_PATTERN.test(requestId)).toBe(true);
    expect(headersSet['X-Request-ID']).toBe(requestId);
  });

  it('reuses a valid UUID header without calling setHeader', () => {
    const { req, res, headersSet } = createReqRes({
      headers: { 'x-request-id': '11111111-2222-4333-8444-555555555555' },
    });

    const requestId = resolveRequestId(req, res);

    expect(requestId).toBe('11111111-2222-4333-8444-555555555555');
    expect(Object.hasOwn(headersSet, 'X-Request-ID')).toBe(false);
  });

  it('generates a new UUID when the header is not a UUID', () => {
    const { req, res, headersSet } = createReqRes({ headers: { 'x-request-id': 'not-a-uuid' } });

    const requestId = resolveRequestId(req, res);

    expect(requestId).not.toBe('not-a-uuid');
    expect(UUID_PATTERN.test(requestId)).toBe(true);
    expect(headersSet['X-Request-ID']).toBe(requestId);
  });

  it('generates a new UUID when the header contains CRLF injection', () => {
    const { req, res } = createReqRes({ headers: { 'x-request-id': 'abc\r\nset-cookie: evil=1' } });

    const requestId = resolveRequestId(req, res);

    expect(UUID_PATTERN.test(requestId)).toBe(true);
    expect(requestId).not.toContain('\r');
  });
});

describe('accessLogLevel', () => {
  it('uses info for 2xx, 3xx and 4xx except 429', () => {
    expect(accessLogLevel(200)).toBe('info');
    expect(accessLogLevel(302)).toBe('info');
    expect(accessLogLevel(404)).toBe('info');
  });

  it('uses warn for 429', () => {
    expect(accessLogLevel(429)).toBe('warn');
  });

  it('uses error for 5xx', () => {
    expect(accessLogLevel(500)).toBe('error');
    expect(accessLogLevel(503)).toBe('error');
  });
});

describe('routeTemplate', () => {
  it('returns unmatched when the request did not match a route', () => {
    const { req } = createReqRes({ path: '/api/v1/nope' });

    expect(routeTemplate(req)).toBe('unmatched');
  });

  it('returns the route template when a route matched', () => {
    const { req } = createReqRes({ path: '/api/v1/users/123', baseUrl: '/api/v1' });
    (req as { route?: unknown }).route = { path: '/users/:id' };

    expect(routeTemplate(req)).toBe('/api/v1/users/:id');
  });
});

describe('requestLogger middleware', () => {
  const readAccessLogs = (writeSpy: ReturnType<typeof vi.spyOn>) =>
    writeSpy.mock.calls
      .map((call: unknown[]) => call[0])
      .filter((chunk: unknown): chunk is string => typeof chunk === 'string' && chunk.includes('"logType":"access"'))
      .map((chunk: string) => JSON.parse(chunk) as Record<string, unknown>);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets X-Request-ID, runs next and logs one access event', () => {
    const { reqEmitter, resEmitter } = createEmitterPair();
    const next = vi.fn();

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    requestLogger(reqEmitter, resEmitter, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(UUID_PATTERN.test(String(reqEmitter.id ?? ''))).toBe(true);

    resEmitter.emit('finish');

    const logs = readAccessLogs(writeSpy);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      logType: 'access',
      event: 'http.request.completed',
      method: 'GET',
      route: 'unmatched',
      statusCode: 200,
    });
    expect(typeof logs[0]?.['durationMs']).toBe('number');
    expect(logs[0]?.['aborted']).toBeUndefined();
    expect(JSON.stringify(logs[0])).not.toContain('?');
  });

  it('reuses the request id in the access log', () => {
    const { reqEmitter, resEmitter } = createEmitterPair({
      headers: { 'x-request-id': '11111111-2222-4333-8444-555555555555' },
    });
    const next = vi.fn();

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    requestLogger(reqEmitter, resEmitter, next);
    resEmitter.emit('finish');

    const logs = readAccessLogs(writeSpy);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.['requestId']).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('does not log the query string', () => {
    const { reqEmitter, resEmitter } = createEmitterPair({
      path: '/api/v1/users/123?token=secret&page=2',
      route: { path: '/users/:id' },
      baseUrl: '/api/v1',
    });
    const next = vi.fn();

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    requestLogger(reqEmitter, resEmitter, next);
    resEmitter.emit('finish');

    const logs = readAccessLogs(writeSpy);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.['route']).toBe('/api/v1/users/:id');
    expect(JSON.stringify(logs[0])).not.toContain('secret');
    expect(JSON.stringify(logs[0])).not.toContain('page=2');
  });

  it('skips successful health checks', () => {
    const { reqEmitter, resEmitter } = createEmitterPair({ path: '/api/v1/health' });
    const next = vi.fn();

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    requestLogger(reqEmitter, resEmitter, next);
    resEmitter.emit('finish');

    expect(readAccessLogs(writeSpy)).toHaveLength(0);
  });

  it('logs 5xx health checks as errors', () => {
    const { reqEmitter, resEmitter } = createEmitterPair({ path: '/api/v1/health', statusCode: 500 });
    const next = vi.fn();

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    requestLogger(reqEmitter, resEmitter, next);
    resEmitter.emit('finish');

    const logs = readAccessLogs(writeSpy);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.['statusCode']).toBe(500);
    expect(logs[0]?.['level']).toBe(50);
  });

  it('logs aborted requests when the client closes before finish', () => {
    const { reqEmitter, resEmitter } = createEmitterPair({ writableFinished: false });
    const next = vi.fn();

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    requestLogger(reqEmitter, resEmitter, next);
    resEmitter.emit('close');

    const logs = readAccessLogs(writeSpy);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.['aborted']).toBe(true);
    expect(logs[0]?.['level']).toBe(40);
  });

  it('emits only one access event when both finish and close fire', () => {
    const { reqEmitter, resEmitter } = createEmitterPair();
    const next = vi.fn();

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    requestLogger(reqEmitter, resEmitter, next);
    resEmitter.emit('finish');
    resEmitter.emit('close');

    const logs = readAccessLogs(writeSpy);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.['aborted']).toBeUndefined();
  });

  it('warns on 429 responses', () => {
    const { reqEmitter, resEmitter } = createEmitterPair({ path: '/api/v1/login', statusCode: 429 });
    const next = vi.fn();

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    requestLogger(reqEmitter, resEmitter, next);
    resEmitter.emit('finish');

    const logs = readAccessLogs(writeSpy);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.['level']).toBe(40);
    expect(logs[0]?.['statusCode']).toBe(429);
  });
});
