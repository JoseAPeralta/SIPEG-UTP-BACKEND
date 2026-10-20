import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadConfigMetrics = async () => {
  vi.resetModules();

  return import('./metrics.js');
};

describe('config metrics', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(32));
    vi.stubEnv('CORS_ORIGIN', 'http://localhost:5173');
    vi.stubEnv('AUTH_PASSWORD_RESET_URL', 'http://localhost:5173/reset-password');
    vi.stubEnv('METRICS_ENABLED', 'false');
    vi.stubEnv('METRICS_HOST', '127.0.0.1');
    vi.stubEnv('METRICS_PORT', '9464');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('exports no singleton when metrics are disabled', async () => {
    const { metrics, metricsConfig } = await loadConfigMetrics();

    expect(metrics).toBeUndefined();
    expect(metricsConfig).toEqual({ enabled: false, host: '127.0.0.1', port: 9464 });
  });

  it('exports the singleton and resolved configuration when metrics are enabled', async () => {
    vi.stubEnv('METRICS_ENABLED', 'true');
    vi.stubEnv('METRICS_HOST', '0.0.0.0');
    vi.stubEnv('METRICS_PORT', '9464');

    const { metrics, metricsConfig } = await loadConfigMetrics();

    expect(metrics).toBeDefined();
    expect(metricsConfig).toEqual({ enabled: true, host: '0.0.0.0', port: 9464 });

    const names = (await metrics?.registry.getMetricsAsJSON())?.map((metric) => metric.name) ?? [];

    expect(names.sort()).toEqual([
      'sipeg_http_request_duration_seconds',
      'sipeg_http_requests_in_flight',
      'sipeg_http_requests_total',
    ]);
  });

  it('does not register runtime collectors in the test environment', async () => {
    vi.stubEnv('METRICS_ENABLED', 'true');

    const { metrics } = await loadConfigMetrics();
    const names = (await metrics?.registry.getMetricsAsJSON())?.map((metric) => metric.name) ?? [];

    expect(names.some((name) => name.startsWith('process_'))).toBe(false);
    expect(names.some((name) => name.startsWith('nodejs_'))).toBe(false);
  });
});
