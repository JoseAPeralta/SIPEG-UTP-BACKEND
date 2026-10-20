import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

interface DashboardDatasource {
  type?: string;
  uid?: string;
}

interface DashboardTarget {
  direction?: string;
  expr?: string;
  datasource?: DashboardDatasource | string;
}

interface DashboardPanel {
  id?: number;
  title?: string;
  type?: string;
  datasource?: DashboardDatasource | string;
  targets?: DashboardTarget[];
}

interface DashboardFile {
  uid?: string;
  title?: string;
  schemaVersion?: number;
  timezone?: string;
  editable?: boolean;
  panels: DashboardPanel[];
}

const loadDashboard = async (fileName: string): Promise<DashboardFile> => {
  const content = await readFile(
    new URL(`../../observability/grafana/dashboards/${fileName}`, import.meta.url),
    'utf8',
  );
  return JSON.parse(content) as DashboardFile;
};

const loadApiOverview = async (): Promise<DashboardFile> => loadDashboard('api-overview.json');

const datasourceUid = (datasource: DashboardDatasource | string | undefined): string | undefined =>
  typeof datasource === 'string' ? datasource : datasource?.uid;

const expressions = (dashboard: DashboardFile): string[] =>
  dashboard.panels.flatMap((panel) => (panel.targets ?? []).map((target) => target.expr ?? ''));

const PROMETHEUS_DASHBOARDS = [
  {
    fileName: 'vps-overview.json',
    uid: 'sipeg-vps-overview',
    title: 'SIPEG · VPS Overview',
    fragments: ['node_cpu_seconds_total'],
  },
  {
    fileName: 'api-http.json',
    uid: 'sipeg-api-http',
    title: 'SIPEG · API HTTP',
    fragments: [
      'sipeg_http_requests_total',
      'sipeg_http_request_duration_seconds_bucket',
      'sipeg_http_requests_in_flight',
      'histogram_quantile',
    ],
  },
  {
    fileName: 'nodejs-runtime.json',
    uid: 'sipeg-nodejs-runtime',
    title: 'SIPEG · Node.js Runtime',
    fragments: ['process_cpu_seconds_total', 'nodejs_eventloop_lag_seconds'],
  },
  {
    fileName: 'postgres-overview.json',
    uid: 'sipeg-postgres-overview',
    title: 'SIPEG · PostgreSQL',
    fragments: ['pg_up', 'pg_stat_database_numbackends'],
  },
  {
    fileName: 'docker-overview.json',
    uid: 'sipeg-docker-overview',
    title: 'SIPEG · Docker',
    fragments: ['docker_container_status_state_code'],
  },
  {
    fileName: 'availability.json',
    uid: 'sipeg-availability',
    title: 'SIPEG · Availability',
    fragments: ['probe_success', 'probe_ssl_earliest_cert_expiry'],
  },
  {
    fileName: 'operations-overview.json',
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
] as const;

describe('API Overview dashboard', () => {
  it('shows the latest access requests in descending order', async () => {
    const dashboard = await loadApiOverview();
    const panel = dashboard.panels.find((candidate) => candidate.title === 'Ultimas solicitudes');

    expect(panel?.type).toBe('logs');
    expect(panel?.targets?.[0]?.direction).toBe('backward');
    expect(panel?.targets?.[0]?.expr).toContain('log_type="access"');
  });

  it('shows complete frequency grouped by HTTP method and route', async () => {
    const dashboard = await loadApiOverview();
    const panel = dashboard.panels.find(
      (candidate) => candidate.title === 'Frecuencia por operacion',
    );
    const expression = panel?.targets?.[0]?.expr ?? '';

    expect(expression).toContain('sum by (method, route)');
    expect(expression).not.toContain('topk(');
    expect(expression).toContain('requestKind="matched"');
  });

  it('excludes aborted requests from response status and latency panels', async () => {
    const dashboard = await loadApiOverview();
    const responsePanels = dashboard.panels.filter((panel) =>
      [
        'Tasa de error (5xx)',
        'p95 de latencia',
        'Distribucion por clase de estado',
        'Latencia p50 / p95',
      ].includes(panel.title ?? ''),
    );

    expect(responsePanels).toHaveLength(4);
    for (const panel of responsePanels) {
      for (const target of panel.targets ?? []) {
        expect(target.expr).toContain('outcome="completed"');
      }
    }
  });
});

describe.each(PROMETHEUS_DASHBOARDS)('$title dashboard', ({ fileName, uid, title, fragments }) => {
  it('has a stable identity and provisioning defaults', async () => {
    const dashboard = await loadDashboard(fileName);

    expect(dashboard.uid).toBe(uid);
    expect(dashboard.title).toBe(title);
    expect(dashboard.schemaVersion).toBe(42);
    expect(dashboard.timezone).toBe('utc');
    expect(dashboard.editable).toBe(false);
  });

  it('uses the prometheus datasource in every panel and target', async () => {
    const dashboard = await loadDashboard(fileName);

    for (const panel of dashboard.panels) {
      expect(datasourceUid(panel.datasource)).toBe('prometheus');
      for (const target of panel.targets ?? []) {
        expect(datasourceUid(target.datasource)).toBe('prometheus');
      }
    }
  });

  it('has unique panel ids and no zero-fill fallback in the new dashboards', async () => {
    const dashboard = await loadDashboard(fileName);
    const ids = dashboard.panels.map((panel) => panel.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(expressions(dashboard).join('\n')).not.toContain('or vector(0)');
  });

  it('contains the key PromQL fragments', async () => {
    const dashboard = await loadDashboard(fileName);
    const queryText = expressions(dashboard).join('\n');

    for (const fragment of fragments) {
      expect(queryText).toContain(fragment);
    }
  });
});
