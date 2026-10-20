import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from '@prometheus-io/client';

import { env } from '../config/env.js';

export type HttpRequestLabel = 'method' | 'route' | 'status_code' | 'request_kind' | 'outcome';
export type HttpDurationLabel = 'method' | 'route' | 'request_kind' | 'outcome';

export interface CreateMetricsOptions {
  collectDefaults?: boolean;
  defaultLabels?: Record<string, string>;
}

export interface Metrics {
  registry: Registry;
  httpRequestsTotal: Counter<HttpRequestLabel>;
  httpRequestDurationSeconds: Histogram<HttpDurationLabel>;
  httpRequestsInFlight: Gauge;
}

const HTTP_DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export function createMetrics(options: CreateMetricsOptions = {}): Metrics {
  const registry = new Registry();

  registry.setDefaultLabels({
    service: env.LOG_SERVICE_NAME,
    environment: env.NODE_ENV,
    ...options.defaultLabels,
  });

  if (options.collectDefaults) {
    collectDefaultMetrics({ register: registry });
  }

  const httpRequestsTotal = new Counter<HttpRequestLabel>({
    name: 'sipeg_http_requests_total',
    help: 'Total number of HTTP requests handled by the API.',
    labelNames: ['method', 'route', 'status_code', 'request_kind', 'outcome'],
    registers: [registry],
  });

  const httpRequestDurationSeconds = new Histogram<HttpDurationLabel>({
    name: 'sipeg_http_request_duration_seconds',
    help: 'HTTP request duration in seconds.',
    labelNames: ['method', 'route', 'request_kind', 'outcome'],
    buckets: HTTP_DURATION_BUCKETS,
    registers: [registry],
  });

  const httpRequestsInFlight = new Gauge({
    name: 'sipeg_http_requests_in_flight',
    help: 'Number of HTTP requests currently being processed.',
    registers: [registry],
  });

  return {
    registry,
    httpRequestsTotal,
    httpRequestDurationSeconds,
    httpRequestsInFlight,
  };
}
