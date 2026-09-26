import type { Request, RequestHandler, Response } from 'express';
import { randomUUID } from 'node:crypto';

import { createChildLogger } from '../config/logger.js';
import { runWithLogContext } from '../lib/log-context.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEALTH_CHECK_PATH = '/api/v1/health';

export function resolveRequestId(req: Request, res: Response): string {
  const header = req.headers['x-request-id'];
  if (typeof header === 'string' && UUID_PATTERN.test(header)) return header;
  const generated = randomUUID();
  res.setHeader('X-Request-ID', generated);
  return generated;
}

export function accessLogLevel(statusCode: number): 'info' | 'warn' | 'error' {
  if (statusCode === 429) return 'warn';
  if (statusCode >= 500) return 'error';
  return 'info';
}

export function routeTemplate(req: Request): string {
  if (req.route) return `${req.baseUrl}${req.route.path}`;
  return 'unmatched';
}

export const requestLogger: RequestHandler = (req, res, next) => {
  const requestId = resolveRequestId(req, res);
  req.id = requestId;

  const startedAt = process.hrtime.bigint();
  let logged = false;

  const logCompletion = (aborted: boolean) => {
    if (logged) return;
    logged = true;

    const isHealthCheck = !aborted && req.path === HEALTH_CHECK_PATH && res.statusCode < 500;
    if (isHealthCheck) return;

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const log = createChildLogger({ requestId });
    const bindings = {
      event: 'http.request.completed',
      logType: 'access',
      method: req.method,
      route: routeTemplate(req),
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      aborted: aborted || undefined,
    };

    if (aborted) log.warn(bindings, 'http.request.completed');
    else if (res.statusCode === 429) log.warn(bindings, 'http.request.completed');
    else if (res.statusCode >= 500) log.error(bindings, 'http.request.completed');
    else log.info(bindings, 'http.request.completed');
  };

  res.on('finish', () => logCompletion(false));
  res.on('close', () => {
    if (!res.writableFinished) logCompletion(true);
  });

  runWithLogContext({ requestId }, () => next());
};
