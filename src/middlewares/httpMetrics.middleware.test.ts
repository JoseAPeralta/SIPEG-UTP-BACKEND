import { EventEmitter } from 'node:events';

import express from 'express';
import type { Request, Response } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMetrics, type Metrics } from '../observability/metrics.js';
import { createHttpMetricsMiddleware } from './httpMetrics.middleware.js';
import { requestLogger } from './requestLogger.middleware.js';

const createTestMetrics = (): Metrics =>
  createMetrics({
    collectDefaults: false,
    defaultLabels: { service: 'test-service', environment: 'test' },
  });

const buildApp = (metrics: Metrics) => {
  const app = express();

  app.use(requestLogger);
  app.use(createHttpMetricsMiddleware(metrics));

  app.get('/api/v1/activities/:id', (req, res) => {
    if (req.params['id'] === 'missing') {
      res.status(404).json({ success: false });
      return;
    }

    res.json({ id: req.params['id'] });
  });
  app.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/api/v1/statuses/:code', (req, res) => {
    res.status(Number(req.params['code'])).end();
  });
  app.use((_req, res) => {
    res.status(404).json({ success: false });
  });

  return app;
};

interface MockOptions {
  method?: string;
  path?: string;
  statusCode?: number;
  headersSent?: boolean;
  writableFinished?: boolean;
}

const createEmitterPair = (options?: MockOptions) => {
  const req = new EventEmitter() as Request & EventEmitter;
  const res = new EventEmitter() as Response & EventEmitter;

  Object.assign(req, {
    headers: {},
    method: options?.method ?? 'GET',
    path: options?.path ?? '/api/v1/activities/1',
    baseUrl: '',
  });
  Object.assign(res, {
    statusCode: options?.statusCode ?? 200,
    headersSent: options?.headersSent ?? true,
    writableFinished: options?.writableFinished ?? true,
    setHeader: vi.fn(),
  });

  return { req, res };
};

const runMiddleware = (metrics: Metrics, options?: MockOptions) => {
  const { req, res } = createEmitterPair(options);

  requestLogger(req, res, vi.fn());
  createHttpMetricsMiddleware(metrics)(req, res, vi.fn());

  return { req, res };
};

const matchRoute = (req: Request, baseUrl: string, path: string): void => {
  req.baseUrl = baseUrl;
  (req as { route?: unknown }).route = { path };
};

const metricValues = async (metrics: Metrics, name: string) => {
  const definitions = await metrics.registry.getMetricsAsJSON();

  return definitions.find((definition) => definition.name === name)?.values ?? [];
};

describe('httpMetrics middleware', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('groups different IDs under a single route template', async () => {
    const metrics = createTestMetrics();
    const app = buildApp(metrics);

    await request(app).get('/api/v1/activities/1').expect(200);
    await request(app).get('/api/v1/activities/2').expect(200);

    const values = await metricValues(metrics, 'sipeg_http_requests_total');
    const text = await metrics.registry.metrics();

    expect(values).toHaveLength(1);
    expect(values[0]?.value).toBe(2);
    expect(values[0]?.labels).toMatchObject({
      method: 'GET',
      route: '/api/v1/activities/:id',
      status_code: '200',
      request_kind: 'matched',
      outcome: 'completed',
    });
    expect(text).not.toContain('/api/v1/activities/1');
    expect(text).not.toContain('/api/v1/activities/2');
  });

  it('keeps the route template for a 404 produced by the matched handler', async () => {
    const metrics = createTestMetrics();
    const app = buildApp(metrics);

    await request(app).get('/api/v1/activities/missing').expect(404);

    const values = await metricValues(metrics, 'sipeg_http_requests_total');

    expect(values).toEqual([
      expect.objectContaining({
        value: 1,
        labels: expect.objectContaining({
          route: '/api/v1/activities/:id',
          status_code: '404',
          request_kind: 'matched',
        }),
      }),
    ]);
  });

  it('classifies an unknown URL as unmatched without leaking the query string', async () => {
    const metrics = createTestMetrics();
    const app = buildApp(metrics);

    await request(app).get('/api/v1/unknown?token=secret').expect(404);

    const values = await metricValues(metrics, 'sipeg_http_requests_total');
    const text = await metrics.registry.metrics();

    expect(values[0]?.labels).toMatchObject({
      route: 'unmatched',
      status_code: '404',
      request_kind: 'unmatched',
    });
    expect(text).not.toContain('secret');
    expect(text).not.toContain('token');
  });

  it('classifies an unmatched OPTIONS request as a preflight', async () => {
    const metrics = createTestMetrics();
    const app = buildApp(metrics);

    await request(app).options('/api/v1/unknown').expect(404);

    const values = await metricValues(metrics, 'sipeg_http_requests_total');

    expect(values[0]?.labels).toMatchObject({
      method: 'OPTIONS',
      route: 'unmatched',
      request_kind: 'preflight',
    });
  });

  it.each([200, 401, 403, 404, 413, 429, 500])('counts a %i response', async (status) => {
    const metrics = createTestMetrics();
    const app = buildApp(metrics);

    await request(app).get(`/api/v1/statuses/${status}`).expect(status);

    const values = await metricValues(metrics, 'sipeg_http_requests_total');

    expect(values).toEqual([
      expect.objectContaining({
        value: 1,
        labels: expect.objectContaining({
          route: '/api/v1/statuses/:code',
          status_code: String(status),
        }),
      }),
    ]);
  });

  it('records an abort before headers with status_code none', async () => {
    const metrics = createTestMetrics();
    const { req, res } = runMiddleware(metrics, {
      headersSent: false,
      writableFinished: false,
    });

    matchRoute(req, '/api/v1', '/activities/:id');
    res.emit('close');

    const values = await metricValues(metrics, 'sipeg_http_requests_total');
    const gaugeValues = await metricValues(metrics, 'sipeg_http_requests_in_flight');

    expect(values[0]?.labels).toMatchObject({
      route: '/api/v1/activities/:id',
      status_code: 'none',
      request_kind: 'matched',
      outcome: 'aborted',
    });
    expect(gaugeValues[0]?.value).toBe(0);
  });

  it('records an abort after headers with the sent status code', async () => {
    const metrics = createTestMetrics();
    const { req, res } = runMiddleware(metrics, {
      statusCode: 500,
      headersSent: true,
      writableFinished: false,
    });

    matchRoute(req, '/api/v1', '/activities/:id');
    res.emit('close');

    const values = await metricValues(metrics, 'sipeg_http_requests_total');

    expect(values[0]?.labels).toMatchObject({
      status_code: '500',
      outcome: 'aborted',
    });
  });

  it('observes only once when finish and close both fire', async () => {
    const metrics = createTestMetrics();
    const { req, res } = runMiddleware(metrics);

    matchRoute(req, '/api/v1', '/activities/:id');
    res.emit('finish');
    res.emit('close');

    const values = await metricValues(metrics, 'sipeg_http_requests_total');
    const gaugeValues = await metricValues(metrics, 'sipeg_http_requests_in_flight');

    expect(values).toHaveLength(1);
    expect(values[0]?.value).toBe(1);
    expect(values[0]?.labels).toMatchObject({ outcome: 'completed' });
    expect(gaugeValues[0]?.value).toBe(0);
  });

  it('maps methods outside the catalog to OTHER', async () => {
    const metrics = createTestMetrics();
    const { req, res } = runMiddleware(metrics, { method: 'PURGE' });

    matchRoute(req, '/api/v1', '/activities/:id');
    res.emit('finish');

    const values = await metricValues(metrics, 'sipeg_http_requests_total');

    expect(values[0]?.labels).toMatchObject({ method: 'OTHER' });
  });

  it('returns the gauge to zero after completed requests and errors', async () => {
    const metrics = createTestMetrics();
    const app = buildApp(metrics);

    await request(app).get('/api/v1/health').expect(200);
    await request(app).get('/api/v1/statuses/500').expect(500);

    const gaugeValues = await metricValues(metrics, 'sipeg_http_requests_in_flight');

    expect(gaugeValues[0]?.value).toBe(0);
  });

  it('counts health checks instead of excluding them', async () => {
    const metrics = createTestMetrics();
    const app = buildApp(metrics);

    await request(app).get('/api/v1/health').expect(200);

    const values = await metricValues(metrics, 'sipeg_http_requests_total');

    expect(values[0]?.labels).toMatchObject({
      route: '/api/v1/health',
      status_code: '200',
      request_kind: 'matched',
    });
  });

  it('records durations in seconds for completed requests', async () => {
    const metrics = createTestMetrics();
    const app = buildApp(metrics);

    await request(app).get('/api/v1/health').expect(200);

    const definition = (await metrics.registry.getMetricsAsJSON()).find(
      (metric) => metric.name === 'sipeg_http_request_duration_seconds',
    );
    const count = definition?.values.find((value) => {
      const metricName = 'metricName' in value ? value.metricName : undefined;

      return typeof metricName === 'string' && metricName.endsWith('_count');
    });

    expect(count?.value).toBe(1);
  });
});
