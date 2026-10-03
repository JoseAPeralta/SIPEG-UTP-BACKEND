import { EventEmitter } from 'node:events';

import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { accessLogger, logger } from '../config/logger.js';
import {
  accessLogLevel,
  captureRouteTemplate,
  requestLogger,
  resolveRequestId,
  routeTemplate,
} from './requestLogger.middleware.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// `route` y `baseUrl` no son opciones: la plantilla de ruta solo existe si se
// reproduce el orden de Express con `matchRoute`, porque un `route` fijado antes
// de que el middleware instale la captura nunca se registraria.
interface MockRequestOptions {
  headers?: Record<string, string>;
  path?: string;
  method?: string;
  statusCode?: number;
  headersSent?: boolean;
  writableFinished?: boolean;
}

function createReqRes(options?: MockRequestOptions) {
  const headers = options?.headers ?? {};
  const headersSet: Record<string, string> = {};
  const req = {
    headers,
    method: options?.method ?? 'GET',
    path: options?.path ?? '/api/v1/users',
    baseUrl: '',
  };
  const res = {
    statusCode: options?.statusCode ?? 200,
    headersSent: options?.headersSent ?? true,
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

/**
 * Reproduce el orden real de Express: fija `baseUrl` al montaje y asigna
 * `req.route` en el instante del match, con el prefijo todavia disponible.
 */
function matchRoute(req: Request, baseUrl: string, path: string): void {
  req.baseUrl = baseUrl;
  (req as { route?: unknown }).route = { path };
}

/** Lo que Express hace al desenrollar el router antes de emitir `finish`. */
function unwindRouter(req: Request): void {
  req.baseUrl = '';
}

describe('resolveRequestId', () => {
  it('generates a UUID and sets the X-Request-ID header when no header is sent', () => {
    const { req, res, headersSet } = createReqRes();

    const requestId = resolveRequestId(req, res);

    expect(UUID_PATTERN.test(requestId)).toBe(true);
    expect(headersSet['X-Request-ID']).toBe(requestId);
  });

  it('reuses a valid UUID header and echoes it back so the client can correlate', () => {
    const { req, res, headersSet } = createReqRes({
      headers: { 'x-request-id': '11111111-2222-4333-8444-555555555555' },
    });

    const requestId = resolveRequestId(req, res);

    expect(requestId).toBe('11111111-2222-4333-8444-555555555555');
    expect(headersSet['X-Request-ID']).toBe('11111111-2222-4333-8444-555555555555');
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
    const { reqEmitter } = createEmitterPair({ path: '/api/v1/nope' });

    captureRouteTemplate(reqEmitter);

    expect(routeTemplate(reqEmitter)).toBe('unmatched');
  });

  it('keeps the mount prefix even after Express restores baseUrl', () => {
    const { reqEmitter } = createEmitterPair({ path: '/api/v1/users/123' });

    captureRouteTemplate(reqEmitter);
    matchRoute(reqEmitter, '/api/v1', '/users/:id');
    unwindRouter(reqEmitter);

    expect(routeTemplate(reqEmitter)).toBe('/api/v1/users/:id');
  });

  it('stays readable for the rest of the chain after the capture', () => {
    const { reqEmitter } = createEmitterPair();

    captureRouteTemplate(reqEmitter);
    matchRoute(reqEmitter, '/api/v1', '/careers');

    expect(reqEmitter.route).toEqual({ path: '/careers' });
  });

  it('ignores a route assignment without a string path', () => {
    const { reqEmitter } = createEmitterPair();

    captureRouteTemplate(reqEmitter);
    reqEmitter.baseUrl = '/api/v1';
    (reqEmitter as { route?: unknown }).route = undefined;
    (reqEmitter as { route?: unknown }).route = { path: 42 };

    expect(routeTemplate(reqEmitter)).toBe('unmatched');
  });
});

describe('requestLogger middleware', () => {
  const readAccessLogs = (writeSpy: ReturnType<typeof vi.spyOn>) =>
    writeSpy.mock.calls
      .map((call: unknown[]) => call[0])
      .filter(
        (chunk: unknown): chunk is string =>
          typeof chunk === 'string' && chunk.includes('"logType":"access"'),
      )
      .map((chunk: string) => JSON.parse(chunk) as Record<string, unknown>);

  // The suite runs with LOG_LEVEL=silent (see vitest.config.ts) so the reporter
  // output stays readable. This file asserts on the access log itself, so it
  // turns the ambient singleton back on for the duration of each test.
  beforeEach(() => {
    logger.level = 'info';
    accessLogger.level = 'info';
  });

  afterEach(() => {
    logger.level = 'silent';
    accessLogger.level = 'silent';
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
      requestKind: 'unmatched',
      outcome: 'completed',
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
    });
    const next = vi.fn();

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    requestLogger(reqEmitter, resEmitter, next);
    matchRoute(reqEmitter, '/api/v1', '/users/:id');
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
    matchRoute(reqEmitter, '/api/v1', '/health');
    resEmitter.emit('finish');

    expect(readAccessLogs(writeSpy)).toHaveLength(0);
  });

  it('does not hide unsupported methods on the health path', () => {
    const { reqEmitter, resEmitter } = createEmitterPair({
      method: 'POST',
      path: '/api/v1/health',
      statusCode: 404,
    });
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    requestLogger(reqEmitter, resEmitter, vi.fn());
    resEmitter.emit('finish');

    expect(readAccessLogs(writeSpy)).toHaveLength(1);
  });

  it('classifies CORS preflights separately from unmatched requests', () => {
    const { reqEmitter, resEmitter } = createEmitterPair({
      method: 'OPTIONS',
      path: '/api/v1/activities',
      statusCode: 204,
    });
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    requestLogger(reqEmitter, resEmitter, vi.fn());
    resEmitter.emit('finish');

    expect(readAccessLogs(writeSpy)[0]).toMatchObject({
      requestKind: 'preflight',
      route: 'unmatched',
    });
  });

  it('logs 5xx health checks as errors', () => {
    const { reqEmitter, resEmitter } = createEmitterPair({
      path: '/api/v1/health',
      statusCode: 500,
    });
    const next = vi.fn();

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    requestLogger(reqEmitter, resEmitter, next);
    resEmitter.emit('finish');

    const logs = readAccessLogs(writeSpy);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.['statusCode']).toBe(500);
    expect(logs[0]?.['level']).toBe('error');
  });

  it('logs aborted requests when the client closes before finish', () => {
    const { reqEmitter, resEmitter } = createEmitterPair({
      headersSent: false,
      writableFinished: false,
    });
    const next = vi.fn();

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    requestLogger(reqEmitter, resEmitter, next);
    resEmitter.emit('close');

    const logs = readAccessLogs(writeSpy);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.['aborted']).toBe(true);
    expect(logs[0]?.['outcome']).toBe('aborted');
    expect(logs[0]?.['statusCode']).toBeUndefined();
    expect(logs[0]?.['level']).toBe('warn');
  });

  it('keeps error severity when a 5xx response is aborted after headers are sent', () => {
    const { reqEmitter, resEmitter } = createEmitterPair({
      headersSent: true,
      statusCode: 500,
      writableFinished: false,
    });
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    requestLogger(reqEmitter, resEmitter, vi.fn());
    resEmitter.emit('close');

    expect(readAccessLogs(writeSpy)[0]).toMatchObject({
      level: 'error',
      outcome: 'aborted',
      statusCode: 500,
    });
  });

  it('keeps access telemetry at info when the application logger is set to error', () => {
    const { reqEmitter, resEmitter } = createEmitterPair();
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logger.level = 'error';

    requestLogger(reqEmitter, resEmitter, vi.fn());
    resEmitter.emit('finish');

    expect(readAccessLogs(writeSpy)).toHaveLength(1);
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
    const { reqEmitter, resEmitter } = createEmitterPair({
      path: '/api/v1/login',
      statusCode: 429,
    });
    const next = vi.fn();

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    requestLogger(reqEmitter, resEmitter, next);
    resEmitter.emit('finish');

    const logs = readAccessLogs(writeSpy);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.['level']).toBe('warn');
    expect(logs[0]?.['statusCode']).toBe(429);
  });

  it('logs the full route template for a response born inside the chain', () => {
    // `authenticate` responde 401 con `next(error)`, el router se desenrolla de
    // forma sincrona y Express restaura `req.baseUrl` a '' antes de `finish`.
    const { reqEmitter, resEmitter } = createEmitterPair({
      path: '/api/v1/audit-events',
      statusCode: 401,
    });
    const next = vi.fn();

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    requestLogger(reqEmitter, resEmitter, next);
    matchRoute(reqEmitter, '/api/v1', '/audit-events');
    unwindRouter(reqEmitter);
    resEmitter.emit('finish');

    const logs = readAccessLogs(writeSpy);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.['route']).toBe('/api/v1/audit-events');
    expect(logs[0]?.['requestKind']).toBe('matched');
    expect(logs[0]?.['statusCode']).toBe(401);
  });

  it('logs the full route template for aborted requests', () => {
    const { reqEmitter, resEmitter } = createEmitterPair({
      path: '/api/v1/activities',
      writableFinished: false,
    });
    const next = vi.fn();

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    requestLogger(reqEmitter, resEmitter, next);
    matchRoute(reqEmitter, '/api/v1', '/activities');
    unwindRouter(reqEmitter);
    resEmitter.emit('close');

    const logs = readAccessLogs(writeSpy);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.['route']).toBe('/api/v1/activities');
    expect(logs[0]?.['aborted']).toBe(true);
  });

  it('logs the route template of a mount outside /api/v1', () => {
    const { reqEmitter, resEmitter } = createEmitterPair({ path: '/api/auth/jwks' });
    const next = vi.fn();

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    requestLogger(reqEmitter, resEmitter, next);
    matchRoute(reqEmitter, '/api/auth', '/jwks');
    resEmitter.emit('finish');

    const logs = readAccessLogs(writeSpy);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.['route']).toBe('/api/auth/jwks');
  });
});
