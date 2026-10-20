import type { Server } from 'node:http';

import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Metrics } from './metrics.js';
import { createMetrics } from './metrics.js';
import { createMetricsServer } from './metrics.server.js';

const { loggerError } = vi.hoisted(() => ({ loggerError: vi.fn() }));

vi.mock('../config/logger.js', () => ({
  logger: { error: loggerError, info: vi.fn() },
}));

const createTestMetrics = (): Metrics => {
  const metrics = createMetrics({
    collectDefaults: false,
    defaultLabels: { service: 'test-service', environment: 'test' },
  });

  metrics.httpRequestsTotal.inc({
    method: 'GET',
    route: '/api/v1/health',
    status_code: '200',
    request_kind: 'matched',
    outcome: 'completed',
  });

  return metrics;
};

const listen = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });

const close = (server: Server | undefined): Promise<void> => {
  if (!server || !server.listening) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    server.close(() => resolve());
  });
};

describe('metrics server', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await close(server);
    server = undefined;
    vi.clearAllMocks();
  });

  it('serves GET /metrics with the registry content type and no-store', async () => {
    const metrics = createTestMetrics();
    server = createMetricsServer(metrics);
    await listen(server);

    const response = await request(server).get('/metrics').expect(200);

    expect(response.headers['content-type']).toBe(metrics.registry.contentType);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.text).toContain('sipeg_http_requests_total');
  });

  it('serves HEAD /metrics with the same headers and no body', async () => {
    const metrics = createTestMetrics();
    server = createMetricsServer(metrics);
    await listen(server);

    const response = await request(server).head('/metrics').expect(200);

    expect(response.headers['content-type']).toBe(metrics.registry.contentType);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.text ?? '').toBe('');
  });

  it('rejects other methods on /metrics with 405 and an Allow header', async () => {
    server = createMetricsServer(createTestMetrics());
    await listen(server);

    const response = await request(server).post('/metrics').expect(405);

    expect(response.headers['allow']).toBe('GET, HEAD');
    expect(response.text).not.toContain('sipeg_http_requests_total');
  });

  it('returns a generic 404 without echoing the requested URL', async () => {
    server = createMetricsServer(createTestMetrics());
    await listen(server);

    const response = await request(server).get('/unknown/path?token=secret').expect(404);

    expect(response.text).not.toContain('/unknown/path');
    expect(response.text).not.toContain('token');
    expect(response.text).not.toContain('secret');
  });

  it('does not accept /metrics with a query string', async () => {
    server = createMetricsServer(createTestMetrics());
    await listen(server);

    const response = await request(server).get('/metrics?token=secret').expect(404);

    expect(response.text).not.toContain('sipeg_http_requests_total');
    expect(response.text).not.toContain('secret');
  });

  it('returns a generic 500 and logs a technical error when collection fails', async () => {
    const failure = new Error('registry exploded');
    const metrics = {
      registry: {
        contentType: 'text/plain; version=0.0.4; charset=utf-8',
        metrics: vi.fn().mockRejectedValue(failure),
      },
    } as unknown as Metrics;

    server = createMetricsServer(metrics);
    await listen(server);

    const response = await request(server).get('/metrics').expect(500);

    expect(response.text).not.toContain('registry exploded');
    expect(loggerError).toHaveBeenCalledWith(
      { event: 'app.metrics.error', logType: 'infrastructure', err: failure },
      'app.metrics.error',
    );
  });
});
