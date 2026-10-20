import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  collectMetricsObservation,
  type MetricsAlertExport,
  type MetricsDashboard,
  type MetricsObservation,
  type MetricsTarget,
  verifyMetrics,
} from './metrics.check.js';

const EXPECTED_JOBS = [
  'node',
  'sipeg-api',
  'postgres',
  'docker',
  'blackbox',
  'blackbox-internal',
  'blackbox-public',
  'prometheus',
];

const EXPECTED_METRICS = [
  'sipeg_http_requests_total',
  'sipeg_http_request_duration_seconds_bucket',
  'sipeg_http_requests_in_flight',
  'process_cpu_seconds_total',
  'node_cpu_seconds_total',
  'pg_up',
  'docker_container_status_state_code',
  'probe_success',
  'up',
];

const DASHBOARDS = [
  {
    uid: 'sipeg-vps-overview',
    title: 'SIPEG · VPS Overview',
    fragments: ['node_cpu_seconds_total'],
  },
  {
    uid: 'sipeg-api-http',
    title: 'SIPEG · API HTTP',
    fragments: ['sipeg_http_requests_total', 'histogram_quantile'],
  },
  {
    uid: 'sipeg-nodejs-runtime',
    title: 'SIPEG · Node.js Runtime',
    fragments: ['process_cpu_seconds_total'],
  },
  {
    uid: 'sipeg-postgres-overview',
    title: 'SIPEG · PostgreSQL',
    fragments: ['pg_up'],
  },
  {
    uid: 'sipeg-docker-overview',
    title: 'SIPEG · Docker',
    fragments: ['docker_container_status_state_code'],
  },
  {
    uid: 'sipeg-availability',
    title: 'SIPEG · Availability',
    fragments: ['probe_success'],
  },
  {
    uid: 'sipeg-operations-overview',
    title: 'SIPEG · Operations',
    fragments: [
      'sipeg_http_requests_total',
      'histogram_quantile',
      'pg_up',
      'docker_container_status_state_code',
      'probe_success',
      'node_cpu_seconds_total',
    ],
  },
];

const ALERT_UIDS = [
  'sipeg-target-down',
  'sipeg-host-network-stale',
  'sipeg-postgres-exporter-errors',
  'sipeg-host-cpu-high',
  'sipeg-host-memory-low',
  'sipeg-host-inodes-low',
  'sipeg-disk-critical',
  'sipeg-postgres-down',
  'sipeg-postgres-connections-high',
  'sipeg-docker-service-not-running',
  'sipeg-docker-critical-service-missing',
  'sipeg-probe-failing',
  'sipeg-tls-expiring',
  'sipeg-api-latency-high',
  'sipeg-http-5xx-ratio',
];

const upTarget = (job: string): MetricsTarget => ({
  labels: { job },
  health: 'up',
});

const healthyDashboards = (): MetricsDashboard[] =>
  DASHBOARDS.map((expected, index) => ({
    uid: expected.uid,
    title: expected.title,
    panels: [
      {
        id: index + 1,
        title: 'Panel',
        type: 'timeseries',
        datasource: { type: 'prometheus', uid: 'prometheus' },
        targets: [
          {
            expr: expected.fragments.join(' '),
            datasource: { type: 'prometheus', uid: 'prometheus' },
          },
        ],
      },
      {
        id: index + 100,
        title: 'Nota',
        type: 'text',
        datasource: { type: 'prometheus', uid: 'prometheus' },
        targets: [],
      },
    ],
  }));

const healthyAlerts = (): MetricsAlertExport => ({
  apiVersion: 1,
  groups: [
    {
      name: 'sipeg-metrics-collectors',
      folder: 'SIPEG UTP',
      rules: ALERT_UIDS.map((uid) => ({
        uid,
        title: uid,
        condition: 'B',
        data: [{ datasourceUid: 'prometheus', model: { expr: 'up' } }],
      })),
    },
  ],
});

const buildObservation = (overrides: Partial<MetricsObservation> = {}): MetricsObservation => ({
  datasourceHealth: { status: 'OK', message: 'Data source successfully connected.' },
  targets: EXPECTED_JOBS.map(upTarget),
  metricNames: [...EXPECTED_METRICS],
  alertExport: healthyAlerts(),
  dashboards: healthyDashboards(),
  windowMinutes: 10,
  ...overrides,
});

const failChecks = (observation: MetricsObservation): string[] =>
  verifyMetrics(observation)
    .filter((finding) => finding.level === 'fail')
    .map((finding) => finding.check);

const failFinding = (observation: MetricsObservation, check: string) =>
  verifyMetrics(observation).find((finding) => finding.check === check && finding.level === 'fail');

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const requestUrl = (input: unknown): string => {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  if (input instanceof Request) {
    return input.url;
  }
  return String(input);
};

describe('verifyMetrics', () => {
  it('no reporta fallos contra un stack de metricas sano', () => {
    expect(failChecks(buildObservation())).toEqual([]);
  });

  it('acepta el estado ok en minusculas', () => {
    const observation = buildObservation({
      datasourceHealth: { status: 'ok' },
    });

    expect(failChecks(observation)).toEqual([]);
  });

  it('falla si el datasource Prometheus no esta sano', () => {
    const observation = buildObservation({
      datasourceHealth: { status: 'error', message: 'dial tcp: connection refused' },
    });

    expect(failChecks(observation)).toContain('metrics.datasource.health');
  });

  it('falla si falta un job esperado y sugiere revisar la configuracion', () => {
    const observation = buildObservation({
      targets: EXPECTED_JOBS.filter((job) => job !== 'postgres').map(upTarget),
    });

    expect(failChecks(observation)).toContain('metrics.targets.jobs');
    expect(failFinding(observation, 'metrics.targets.jobs')?.hint).toContain('prometheus.yml');
  });

  it('falla si un target esta caido y muestra su lastError', () => {
    const observation = buildObservation({
      targets: [
        {
          labels: { job: 'node' },
          health: 'down',
          lastError: 'connection refused',
        },
        ...EXPECTED_JOBS.filter((job) => job !== 'node').map(upTarget),
      ],
    });

    const finding = failFinding(observation, 'metrics.targets.health');

    expect(finding?.detail).toContain('node');
    expect(finding?.detail).toContain('connection refused');
  });

  it('falla si falta una metrica esperada', () => {
    const observation = buildObservation({
      metricNames: EXPECTED_METRICS.filter((name) => name !== 'pg_up'),
    });

    expect(failChecks(observation)).toContain('metrics.metrics.names');
  });

  it('falla si falta un dashboard esperado', () => {
    const observation = buildObservation({
      dashboards: healthyDashboards().slice(0, -1),
    });

    expect(failChecks(observation)).toContain('metrics.dashboards.present');
  });

  it('falla si un dashboard cambia de titulo', () => {
    const observation = buildObservation({
      dashboards: healthyDashboards().map((dashboard, index) =>
        index === 0 ? { ...dashboard, title: 'Otro titulo' } : dashboard,
      ),
    });

    expect(failChecks(observation)).toContain('metrics.dashboards.present');
  });

  it('falla si un panel no usa el datasource prometheus', () => {
    const observation = buildObservation({
      dashboards: healthyDashboards().map((dashboard, index) =>
        index === 0
          ? {
              ...dashboard,
              panels: (dashboard.panels ?? []).map((panel, panelIndex) =>
                panelIndex === 0
                  ? {
                      ...panel,
                      datasource: { type: 'loki', uid: 'loki' },
                    }
                  : panel,
              ),
            }
          : dashboard,
      ),
    });

    expect(failChecks(observation)).toContain('metrics.dashboards.panels');
  });

  it('falla si un panel de datos no tiene ninguna expresion', () => {
    const observation = buildObservation({
      dashboards: healthyDashboards().map((dashboard, index) =>
        index === 0
          ? {
              ...dashboard,
              panels: (dashboard.panels ?? []).map((panel, panelIndex) =>
                panelIndex === 0
                  ? {
                      ...panel,
                      targets: [
                        {
                          expr: '',
                          datasource: { type: 'prometheus', uid: 'prometheus' },
                        },
                      ],
                    }
                  : panel,
              ),
            }
          : dashboard,
      ),
    });

    expect(failChecks(observation)).toContain('metrics.dashboards.panels');
  });

  it('falla si falta un fragmento de consulta clave en un dashboard', () => {
    const observation = buildObservation({
      dashboards: healthyDashboards().map((dashboard, index) =>
        index === 1
          ? {
              ...dashboard,
              panels: (dashboard.panels ?? []).map((panel, panelIndex) =>
                panelIndex === 0
                  ? {
                      ...panel,
                      targets: [
                        {
                          expr: 'sum(rate(sipeg_http_requests_total[5m]))',
                          datasource: { type: 'prometheus', uid: 'prometheus' },
                        },
                      ],
                    }
                  : panel,
              ),
            }
          : dashboard,
      ),
    });

    expect(failChecks(observation)).toContain('metrics.dashboards.queries');
  });

  it('falla si falta una alerta esperada', () => {
    const observation = buildObservation({
      alertExport: {
        groups: [
          {
            name: 'sipeg-metrics-collectors',
            folder: 'SIPEG UTP',
            rules: healthyAlerts().groups?.[0]?.rules?.slice(0, -1) ?? [],
          },
        ],
      },
    });

    expect(failChecks(observation)).toContain('metrics.alerts.rules');
  });

  it('falla si una alerta no tiene condition', () => {
    const observation = buildObservation({
      alertExport: {
        groups: [
          {
            name: 'sipeg-metrics-collectors',
            folder: 'SIPEG UTP',
            rules:
              healthyAlerts().groups?.[0]?.rules?.map((rule, index) =>
                index === 0 ? { ...rule, condition: '' } : rule,
              ) ?? [],
          },
        ],
      },
    });

    expect(failChecks(observation)).toContain('metrics.alerts.condition');
  });

  it('falla si una alerta no consulta el datasource prometheus', () => {
    const observation = buildObservation({
      alertExport: {
        groups: [
          {
            name: 'sipeg-metrics-collectors',
            folder: 'SIPEG UTP',
            rules:
              healthyAlerts().groups?.[0]?.rules?.map((rule, index) =>
                index === 0
                  ? { ...rule, data: [{ datasourceUid: 'loki', model: { expr: 'up' } }] }
                  : rule,
              ) ?? [],
          },
        ],
      },
    });

    expect(failChecks(observation)).toContain('metrics.alerts.query');
  });

  it('detecta UIDs de alerta duplicados', () => {
    const rules = healthyAlerts().groups?.[0]?.rules ?? [];
    const duplicated = rules[0];

    const observation = buildObservation({
      alertExport: {
        groups: [
          {
            name: 'sipeg-metrics-collectors',
            folder: 'SIPEG UTP',
            rules: duplicated === undefined ? rules : [...rules, duplicated],
          },
        ],
      },
    });

    expect(failChecks(observation)).toContain('metrics.alerts.duplicates');
  });

  it('mantiene la ausencia de datos como fallo y no como cero', () => {
    const observation = buildObservation({
      targets: [],
      metricNames: [],
      dashboards: [],
      alertExport: {},
    });

    const failed = failChecks(observation);

    expect(failed).toContain('metrics.targets.jobs');
    expect(failed).toContain('metrics.targets.health');
    expect(failed).toContain('metrics.metrics.names');
    expect(failed).toContain('metrics.dashboards.present');
    expect(failed).toContain('metrics.alerts.rules');
  });
});

describe('collectMetricsObservation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('consulta todos los endpoints con autenticacion Basic y timeout de 5 s', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const fetchMock = vi.fn(async (input: unknown, _init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.endsWith('/api/datasources/uid/prometheus/health')) {
        return jsonResponse({ status: 'OK' });
      }
      if (url.endsWith('/api/v1/targets')) {
        return jsonResponse({
          status: 'success',
          data: { activeTargets: EXPECTED_JOBS.map(upTarget) },
        });
      }
      if (url.endsWith('/api/v1/label/__name__/values')) {
        return jsonResponse({ status: 'success', data: EXPECTED_METRICS });
      }
      if (url.endsWith('/api/v1/provisioning/alert-rules/export?format=json')) {
        return jsonResponse(healthyAlerts());
      }
      if (url.includes('/api/dashboards/uid/')) {
        const uid = url.split('/').pop();
        return jsonResponse({
          dashboard: { uid, title: uid, panels: [] },
        });
      }
      return jsonResponse({ message: 'unexpected' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const observation = await collectMetricsObservation({
      url: 'http://grafana:3000',
      authorization: 'Basic abc',
      windowMinutes: 10,
    });

    expect(fetchMock).toHaveBeenCalledTimes(11);
    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toEqual(
        expect.objectContaining({
          headers: { authorization: 'Basic abc' },
          signal: expect.any(AbortSignal),
        }),
      );
    }
    expect(timeoutSpy).toHaveBeenCalledWith(5000);
    expect(observation.datasourceHealth.status).toBe('OK');
    expect(observation.targets).toHaveLength(EXPECTED_JOBS.length);
    expect(observation.metricNames).toEqual(EXPECTED_METRICS);
    expect(observation.dashboards).toHaveLength(DASHBOARDS.length);
    expect(observation.windowMinutes).toBe(10);
  });

  it('falla con URL y status sin filtrar el header Authorization', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = requestUrl(input);
      if (url.endsWith('/api/v1/targets')) {
        return jsonResponse({ message: 'unavailable' }, 503);
      }
      return jsonResponse({ status: 'OK' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const error = await collectMetricsObservation({
      url: 'http://grafana:3000',
      authorization: 'Basic super-secret',
      windowMinutes: 10,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('503');
    expect((error as Error).message).toContain('/api/v1/targets');
    expect((error as Error).message).not.toContain('super-secret');
  });
});
