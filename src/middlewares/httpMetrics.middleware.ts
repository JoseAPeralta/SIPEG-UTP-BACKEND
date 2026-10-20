import type { RequestHandler } from 'express';

import type { Metrics } from '../observability/metrics.js';
import { routeTemplate } from './requestLogger.middleware.js';

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function normalizeMethod(method: string): string {
  const upperMethod = method.toUpperCase();

  return HTTP_METHODS.has(upperMethod) ? upperMethod : 'OTHER';
}

export function createHttpMetricsMiddleware(metrics: Metrics): RequestHandler {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    const rawMethod = req.method;
    const method = normalizeMethod(rawMethod);
    let observed = false;

    metrics.httpRequestsInFlight.inc();

    const observe = (aborted: boolean): void => {
      if (observed) return;
      observed = true;

      const route = routeTemplate(req);
      const requestKind =
        route !== 'unmatched' ? 'matched' : rawMethod === 'OPTIONS' ? 'preflight' : 'unmatched';
      const outcome = aborted ? 'aborted' : 'completed';
      const statusCode = aborted && !res.headersSent ? 'none' : String(res.statusCode);
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;

      metrics.httpRequestsInFlight.dec();
      metrics.httpRequestsTotal.inc({
        method,
        route,
        status_code: statusCode,
        request_kind: requestKind,
        outcome,
      });
      metrics.httpRequestDurationSeconds.observe(
        {
          method,
          route,
          request_kind: requestKind,
          outcome,
        },
        durationSeconds,
      );
    };

    res.on('finish', () => observe(false));
    res.on('close', () => {
      if (!res.writableFinished) observe(true);
    });

    next();
  };
}
