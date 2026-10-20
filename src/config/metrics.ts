import { createMetrics } from '../observability/metrics.js';
import { env } from './env.js';

export const metricsConfig = {
  enabled: env.METRICS_ENABLED,
  host: env.METRICS_HOST,
  port: env.METRICS_PORT,
};

export const metrics = env.METRICS_ENABLED
  ? createMetrics({ collectDefaults: env.NODE_ENV !== 'test' })
  : undefined;
