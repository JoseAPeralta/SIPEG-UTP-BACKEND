import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadMetricsModule = async () => {
  vi.resetModules();

  return import('./metrics.js');
};

const labels = {
  method: 'GET',
  route: '/api/v1/activities/:id',
  status_code: '200',
  request_kind: 'matched',
  outcome: 'completed',
};

const durationLabels = {
  method: 'GET',
  route: '/api/v1/activities/:id',
  request_kind: 'matched',
  outcome: 'completed',
};

describe('createMetrics', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(32));
    vi.stubEnv('CORS_ORIGIN', 'http://localhost:5173');
    vi.stubEnv('AUTH_PASSWORD_RESET_URL', 'http://localhost:5173/reset-password');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('exposes exactly the HTTP metrics with their expected names and types', async () => {
    const { createMetrics } = await loadMetricsModule();
    const metrics = createMetrics({ collectDefaults: false });

    const definitions = await metrics.registry.getMetricsAsJSON();

    expect(definitions.map((definition) => definition.name).sort()).toEqual([
      'sipeg_http_request_duration_seconds',
      'sipeg_http_requests_in_flight',
      'sipeg_http_requests_total',
    ]);
    expect(
      definitions.find((definition) => definition.name === 'sipeg_http_requests_total')?.type,
    ).toBe('counter');
    expect(
      definitions.find((definition) => definition.name === 'sipeg_http_request_duration_seconds')
        ?.type,
    ).toBe('histogram');
    expect(
      definitions.find((definition) => definition.name === 'sipeg_http_requests_in_flight')?.type,
    ).toBe('gauge');
  });

  it('uses the required duration buckets', async () => {
    const { createMetrics } = await loadMetricsModule();
    const metrics = createMetrics({ collectDefaults: false });

    metrics.httpRequestDurationSeconds.observe(durationLabels, 0.02);

    const definition = (await metrics.registry.getMetricsAsJSON()).find(
      (metric) => metric.name === 'sipeg_http_request_duration_seconds',
    );
    const bucketBounds = definition?.values
      .filter((value) => {
        const metricName = 'metricName' in value ? value.metricName : undefined;

        return typeof metricName === 'string' && metricName.endsWith('_bucket');
      })
      .map((value) => value.labels['le']);

    expect(bucketBounds).toEqual([0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, '+Inf']);
  });

  it('does not register runtime collectors when collectDefaults is false', async () => {
    const { createMetrics } = await loadMetricsModule();
    const metrics = createMetrics({ collectDefaults: false });

    const names = (await metrics.registry.getMetricsAsJSON()).map((metric) => metric.name);

    expect(names.some((name) => name.startsWith('process_'))).toBe(false);
    expect(names.some((name) => name.startsWith('nodejs_'))).toBe(false);
  });

  it('applies service and environment labels from the environment by default', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('LOG_SERVICE_NAME', 'sipeg-metrics-test');

    const { createMetrics } = await loadMetricsModule();
    const metrics = createMetrics({ collectDefaults: false });

    metrics.httpRequestsTotal.inc(labels);

    const definition = (await metrics.registry.getMetricsAsJSON()).find(
      (metric) => metric.name === 'sipeg_http_requests_total',
    );

    expect(definition?.values[0]?.labels).toMatchObject({
      service: 'sipeg-metrics-test',
      environment: 'test',
    });
  });

  it('lets explicit default labels override the environment values', async () => {
    const { createMetrics } = await loadMetricsModule();
    const metrics = createMetrics({
      collectDefaults: false,
      defaultLabels: { service: 'custom-service', environment: 'custom-environment' },
    });

    metrics.httpRequestsInFlight.inc();

    const definition = (await metrics.registry.getMetricsAsJSON()).find(
      (metric) => metric.name === 'sipeg_http_requests_in_flight',
    );

    expect(definition?.values[0]?.labels).toMatchObject({
      service: 'custom-service',
      environment: 'custom-environment',
    });
  });

  it('keeps two factories isolated from each other', async () => {
    const { createMetrics } = await loadMetricsModule();
    const first = createMetrics({ collectDefaults: false });
    const second = createMetrics({ collectDefaults: false });

    first.httpRequestsTotal.inc(labels);

    const firstDefinition = (await first.registry.getMetricsAsJSON()).find(
      (metric) => metric.name === 'sipeg_http_requests_total',
    );
    const secondDefinition = (await second.registry.getMetricsAsJSON()).find(
      (metric) => metric.name === 'sipeg_http_requests_total',
    );

    expect(first.registry).not.toBe(second.registry);
    expect(firstDefinition?.values).toHaveLength(1);
    expect(secondDefinition?.values ?? []).toHaveLength(0);
  });
});
