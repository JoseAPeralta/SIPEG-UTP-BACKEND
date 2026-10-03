import type { Request, RequestHandler, Response } from 'express';
import { randomUUID } from 'node:crypto';

import { accessLogger, createChildLogger } from '../config/logger.js';
import { runWithLogContext } from '../lib/log-context.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEALTH_CHECK_PATH = '/api/v1/health';

export function resolveRequestId(req: Request, res: Response): string {
  const header = req.headers['x-request-id'];
  const requestId = typeof header === 'string' && UUID_PATTERN.test(header) ? header : randomUUID();
  // Siempre, tambien cuando el id viene del cliente: sin el eco, quien envia un
  // `X-Request-ID` propio no recibe confirmacion de cual se correlaciono en Loki.
  res.setHeader('X-Request-ID', requestId);
  return requestId;
}

export function accessLogLevel(statusCode: number): 'info' | 'warn' | 'error' {
  if (statusCode === 429) return 'warn';
  if (statusCode >= 500) return 'error';
  return 'info';
}

const capturedRouteTemplates = new WeakMap<Request, string>();

/**
 * Express asigna `req.route` en el instante en que una ruta hace match, y en ese
 * momento `req.baseUrl` todavia vale el prefijo del montaje. Para toda respuesta
 * que nace dentro de la cadena (401, 403, 429, error de validacion) el router se
 * desenrolla de forma sincrona antes de que `res` emita `finish`, y Express
 * restaura `req.baseUrl` a ''. Leerlo en el handler de `finish` producia
 * plantillas sin el prefijo: un 401 sobre `/api/v1/careers` se registraba como
 * `/careers`, y el trafico de un mismo endpoint quedava partido en dos series al
 * agregar por ruta en Grafana.
 *
 * `req.route` es una propiedad propia, `configurable` y asignable, asi que
 * interceptar la asignacion es la unica forma de leer el valor mientras sigue
 * siendo valido. El getter se conserva para que el resto de la cadena siga
 * viendo lo que Express escribio.
 */
export function captureRouteTemplate(req: Request): void {
  let current: unknown;
  Object.defineProperty(req, 'route', {
    configurable: true,
    enumerable: true,
    get: () => current,
    set: (value: unknown) => {
      current = value;
      const path = (value as { path?: unknown } | undefined)?.path;
      if (typeof path === 'string') capturedRouteTemplates.set(req, `${req.baseUrl}${path}`);
    },
  });
}

export function routeTemplate(req: Request): string {
  return capturedRouteTemplates.get(req) ?? 'unmatched';
}

export const requestLogger: RequestHandler = (req, res, next) => {
  const requestId = resolveRequestId(req, res);
  req.id = requestId;
  captureRouteTemplate(req);

  const startedAt = process.hrtime.bigint();
  let logged = false;

  const logCompletion = (aborted: boolean) => {
    if (logged) return;
    logged = true;

    const route = routeTemplate(req);
    const isHealthCheck =
      !aborted &&
      req.method === 'GET' &&
      route === HEALTH_CHECK_PATH &&
      res.statusCode >= 200 &&
      res.statusCode < 400;
    if (isHealthCheck) return;

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const log = createChildLogger({ requestId }, accessLogger);
    const statusCode = aborted && !res.headersSent ? undefined : res.statusCode;
    const requestKind =
      route !== 'unmatched' ? 'matched' : req.method === 'OPTIONS' ? 'preflight' : 'unmatched';
    const bindings = {
      event: 'http.request.completed',
      logType: 'access',
      method: req.method,
      route,
      requestKind,
      outcome: aborted ? 'aborted' : 'completed',
      statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      aborted: aborted || undefined,
    };

    const level =
      statusCode !== undefined && statusCode >= 500
        ? 'error'
        : aborted
          ? 'warn'
          : accessLogLevel(statusCode ?? res.statusCode);
    if (level === 'error') log.error(bindings, 'http.request.completed');
    else if (level === 'warn') log.warn(bindings, 'http.request.completed');
    else log.info(bindings, 'http.request.completed');
  };

  res.on('finish', () => logCompletion(false));
  res.on('close', () => {
    if (!res.writableFinished) logCompletion(true);
  });

  runWithLogContext({ requestId }, () => next());
};
