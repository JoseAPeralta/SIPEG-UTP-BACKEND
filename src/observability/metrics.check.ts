import type { Finding } from './check.js';

export interface MetricsDatasourceHealth {
  status?: string;
  message?: string;
}

export interface MetricsTarget {
  labels?: Record<string, string>;
  health?: string;
  lastError?: string;
  scrapePool?: string;
}

export interface MetricsDatasourceRef {
  type?: string;
  uid?: string;
}

export interface MetricsPanelTarget {
  expr?: string;
  datasource?: MetricsDatasourceRef | string;
}

export interface MetricsPanel {
  id?: number;
  title?: string;
  type?: string;
  datasource?: MetricsDatasourceRef | string;
  targets?: MetricsPanelTarget[];
  panels?: MetricsPanel[];
}

export interface MetricsDashboard {
  uid?: string;
  title?: string;
  panels?: MetricsPanel[];
}

export interface MetricsAlertQuery {
  datasourceUid?: string;
  model?: { expr?: string };
}

export interface MetricsAlertRule {
  uid?: string;
  title?: string;
  condition?: string;
  data?: MetricsAlertQuery[];
}

export interface MetricsAlertGroup {
  name?: string;
  folder?: string;
  rules?: MetricsAlertRule[];
}

export interface MetricsAlertExport {
  apiVersion?: number;
  groups?: MetricsAlertGroup[];
}

export interface MetricsObservation {
  datasourceHealth: MetricsDatasourceHealth;
  targets: MetricsTarget[];
  metricNames: string[];
  alertExport: MetricsAlertExport;
  dashboards: MetricsDashboard[];
  windowMinutes: number;
}

interface MetricsTargetsResponse {
  status?: string;
  data?: { activeTargets?: MetricsTarget[] };
}

interface MetricsLabelValuesResponse {
  status?: string;
  data?: string[];
}

interface MetricsDashboardResponse {
  dashboard?: MetricsDashboard;
}

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

const EXPECTED_DASHBOARDS = [
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

const EXPECTED_ALERTS = [
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

const PANELS_WITHOUT_TARGETS = new Set(['text', 'row']);

const REQUEST_TIMEOUT_MS = 5000;

const pass = (check: string, detail: string): Finding => ({ check, level: 'pass', detail });

const fail = (check: string, detail: string, hint?: string): Finding => {
  const finding: Finding = { check, level: 'fail', detail };
  if (hint !== undefined) {
    finding.hint = hint;
  }
  return finding;
};

const info = (check: string, detail: string): Finding => ({ check, level: 'info', detail });

const datasourceUid = (
  datasource: MetricsDatasourceRef | string | undefined,
): string | undefined => (typeof datasource === 'string' ? datasource : datasource?.uid);

const flattenPanels = (panels: MetricsPanel[]): MetricsPanel[] =>
  panels.flatMap((panel) => [panel, ...flattenPanels(panel.panels ?? [])]);

const dashboardExpressions = (dashboard: MetricsDashboard): string[] =>
  flattenPanels(dashboard.panels ?? []).flatMap((panel) =>
    (panel.targets ?? []).map((target) => target.expr?.trim() ?? '').filter((expr) => expr !== ''),
  );

const alertRules = (observation: MetricsObservation): MetricsAlertRule[] =>
  (observation.alertExport.groups ?? []).flatMap((group) => group.rules ?? []);

const getJson = async <T>(url: string, authorization: string): Promise<T> => {
  const response = await fetch(url, {
    headers: { authorization },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Grafana respondio ${response.status} ${response.statusText} en ${url}`);
  }
  return (await response.json()) as T;
};

export const collectMetricsObservation = async (options: {
  url: string;
  authorization: string;
  windowMinutes: number;
}): Promise<MetricsObservation> => {
  const baseUrl = options.url.replace(/\/+$/, '');
  const prometheusProxy = `${baseUrl}/api/datasources/proxy/uid/prometheus`;

  const [core, dashboardResponses] = await Promise.all([
    Promise.all([
      getJson<MetricsDatasourceHealth>(
        `${baseUrl}/api/datasources/uid/prometheus/health`,
        options.authorization,
      ),
      getJson<MetricsTargetsResponse>(`${prometheusProxy}/api/v1/targets`, options.authorization),
      getJson<MetricsLabelValuesResponse>(
        `${prometheusProxy}/api/v1/label/__name__/values`,
        options.authorization,
      ),
      getJson<MetricsAlertExport>(
        `${baseUrl}/api/v1/provisioning/alert-rules/export?format=json`,
        options.authorization,
      ),
    ] as const),
    Promise.all(
      EXPECTED_DASHBOARDS.map((expected) =>
        getJson<MetricsDashboardResponse>(
          `${baseUrl}/api/dashboards/uid/${expected.uid}`,
          options.authorization,
        ),
      ),
    ),
  ]);

  const [datasourceHealth, targetsResponse, metricNamesResponse, alertExport] = core;

  return {
    datasourceHealth,
    targets: targetsResponse.data?.activeTargets ?? [],
    metricNames: metricNamesResponse.data ?? [],
    alertExport,
    dashboards: dashboardResponses.map((response) => response.dashboard ?? {}),
    windowMinutes: options.windowMinutes,
  };
};

export const verifyMetrics = (observation: MetricsObservation): Finding[] => {
  const findings: Finding[] = [];

  const datasourceStatus = observation.datasourceHealth.status?.toLowerCase();
  findings.push(
    datasourceStatus === 'ok'
      ? pass('metrics.datasource.health', 'Prometheus responde OK desde el datasource de Grafana.')
      : fail(
          'metrics.datasource.health',
          `Prometheus no esta sano: ${observation.datasourceHealth.status ?? 'sin status'} ${observation.datasourceHealth.message ?? ''}`.trim(),
          'Revisar el servicio `prometheus`, la URL interna `http://prometheus:9090` y el datasource de Grafana.',
        ),
  );

  const targetsByJob = new Map<string, MetricsTarget[]>();
  for (const target of observation.targets) {
    const job = target.labels?.['job'];
    if (job !== undefined) {
      targetsByJob.set(job, [...(targetsByJob.get(job) ?? []), target]);
    }
  }

  const missingJobs = EXPECTED_JOBS.filter((job) => !targetsByJob.has(job));
  findings.push(
    missingJobs.length === 0
      ? pass('metrics.targets.jobs', `Los ${EXPECTED_JOBS.length} jobs esperados estan presentes.`)
      : fail(
          'metrics.targets.jobs',
          `Faltan jobs en Prometheus: ${missingJobs.join(', ')}.`,
          'Revisar `scrape_configs` en observability/prometheus/prometheus.yml y recrear `prometheus`: solo lee la configuracion al arrancar.',
        ),
  );

  const unhealthyTargets = EXPECTED_JOBS.flatMap((job) =>
    (targetsByJob.get(job) ?? [])
      .filter((target) => target.health?.toLowerCase() !== 'up')
      .map((target) => {
        const lastError = target.lastError?.trim();
        return `${job}: health=${target.health ?? '(vacio)'}${lastError ? `, lastError=${lastError}` : ''}`;
      }),
  );
  findings.push(
    unhealthyTargets.length === 0 && observation.targets.length > 0
      ? pass(
          'metrics.targets.health',
          `${observation.targets.length} target(s) de los jobs esperados estan up.`,
        )
      : fail(
          'metrics.targets.health',
          unhealthyTargets.length === 0
            ? 'No hay targets activos que evaluar.'
            : `Targets caidos: ${unhealthyTargets.join('; ')}.`,
          'Revisar `lastScrape`, `lastError` y el exporter del job en Prometheus. Un target ausente es distinto de un target que responde con una dependencia caida.',
        ),
  );

  const missingMetrics = EXPECTED_METRICS.filter((name) => !observation.metricNames.includes(name));
  findings.push(
    missingMetrics.length === 0
      ? pass(
          'metrics.metrics.names',
          `Las ${EXPECTED_METRICS.length} metricas esperadas existen en Prometheus.`,
        )
      : fail(
          'metrics.metrics.names',
          `Faltan metricas: ${missingMetrics.join(', ')}.`,
          'Revisar el exporter o la instrumentacion de cada fuente; la ausencia de una metrica no equivale a cero.',
        ),
  );

  const dashboardProblems = EXPECTED_DASHBOARDS.flatMap((expected) => {
    const dashboard = observation.dashboards.find((candidate) => candidate.uid === expected.uid);
    if (dashboard === undefined) {
      return [`falta ${expected.uid}`];
    }
    return dashboard.title === expected.title
      ? []
      : [`${expected.uid}: titulo "${dashboard.title ?? '(vacio)'}" en vez de "${expected.title}"`];
  });
  findings.push(
    dashboardProblems.length === 0
      ? pass(
          'metrics.dashboards.present',
          `Los ${EXPECTED_DASHBOARDS.length} dashboards tienen UID y titulo correctos.`,
        )
      : fail(
          'metrics.dashboards.present',
          dashboardProblems.join('; '),
          'Revisar los JSON provisionados en observability/grafana/dashboards y recrear Grafana.',
        ),
  );

  const panelProblems = EXPECTED_DASHBOARDS.flatMap((expected) => {
    const dashboard = observation.dashboards.find((candidate) => candidate.uid === expected.uid);
    if (dashboard === undefined) {
      return [];
    }
    return flattenPanels(dashboard.panels ?? []).flatMap((panel) => {
      if (panel.type === 'row') {
        return [];
      }
      const problems: string[] = [];
      const panelUid = datasourceUid(panel.datasource);
      if (panelUid !== 'prometheus') {
        problems.push(
          `${expected.uid} panel ${panel.id ?? '(sin id)'}: datasource ${panelUid ?? '(vacio)'}`,
        );
      }
      for (const target of panel.targets ?? []) {
        if (target.datasource === undefined) {
          continue;
        }
        const targetUid = datasourceUid(target.datasource);
        if (targetUid !== 'prometheus') {
          problems.push(
            `${expected.uid} panel ${panel.id ?? '(sin id)'}: target datasource ${targetUid ?? '(vacio)'}`,
          );
        }
      }
      const hasExpression =
        PANELS_WITHOUT_TARGETS.has(panel.type ?? '') ||
        (panel.targets ?? []).some((target) => (target.expr ?? '').trim() !== '');
      if (!hasExpression) {
        problems.push(`${expected.uid} panel ${panel.id ?? '(sin id)'}: sin expresion`);
      }
      return problems;
    });
  });
  findings.push(
    panelProblems.length === 0
      ? pass(
          'metrics.dashboards.panels',
          'Todos los paneles de datos usan el datasource prometheus y tienen al menos una expresion.',
        )
      : fail(
          'metrics.dashboards.panels',
          panelProblems.join('; '),
          'Cada panel de datos necesita datasource `prometheus` y una consulta; los paneles de texto son la unica excepcion.',
        ),
  );

  const queryProblems = EXPECTED_DASHBOARDS.flatMap((expected) => {
    const dashboard = observation.dashboards.find((candidate) => candidate.uid === expected.uid);
    if (dashboard === undefined) {
      return [];
    }
    const queryText = dashboardExpressions(dashboard).join('\n');
    const missingFragments = expected.fragments.filter((fragment) => !queryText.includes(fragment));
    return missingFragments.length === 0
      ? []
      : [`${expected.uid}: falta ${missingFragments.join(', ')}`];
  });
  findings.push(
    queryProblems.length === 0
      ? pass(
          'metrics.dashboards.queries',
          'Los siete dashboards contienen los fragmentos de consulta clave.',
        )
      : fail('metrics.dashboards.queries', queryProblems.join('; ')),
  );

  const rules = alertRules(observation);
  const missingAlerts = EXPECTED_ALERTS.filter((uid) => !rules.some((rule) => rule.uid === uid));
  findings.push(
    missingAlerts.length === 0
      ? pass(
          'metrics.alerts.rules',
          `Las ${EXPECTED_ALERTS.length} alertas de metricas estan provisionadas.`,
        )
      : fail(
          'metrics.alerts.rules',
          `Faltan alertas: ${missingAlerts.join(', ')}.`,
          'Revisar observability/grafana/provisioning/alerting/metrics.yaml y recrear Grafana. Una regla borrada del archivo no se elimina sola del estado aplicado.',
        ),
  );

  const conditionProblems = EXPECTED_ALERTS.flatMap((uid) => {
    const rule = rules.find((candidate) => candidate.uid === uid);
    if (rule === undefined) {
      return [];
    }
    return (rule.condition ?? '').trim() === '' ? [`${uid}: sin condition`] : [];
  });
  findings.push(
    missingAlerts.length === 0 && conditionProblems.length === 0
      ? pass('metrics.alerts.condition', 'Todas las alertas declaran una condition.')
      : fail('metrics.alerts.condition', conditionProblems.join('; ') || 'Faltan alertas.'),
  );

  const queryAlertProblems = EXPECTED_ALERTS.flatMap((uid) => {
    const rule = rules.find((candidate) => candidate.uid === uid);
    if (rule === undefined) {
      return [];
    }
    return (rule.data ?? []).some((query) => query.datasourceUid === 'prometheus')
      ? []
      : [`${uid}: sin query con datasourceUid prometheus`];
  });
  findings.push(
    missingAlerts.length === 0 && queryAlertProblems.length === 0
      ? pass('metrics.alerts.query', 'Todas las alertas consultan el datasource prometheus.')
      : fail('metrics.alerts.query', queryAlertProblems.join('; ') || 'Faltan alertas.'),
  );

  const uidCounts = new Map<string, number>();
  for (const rule of rules) {
    if (rule.uid !== undefined) {
      uidCounts.set(rule.uid, (uidCounts.get(rule.uid) ?? 0) + 1);
    }
  }
  const duplicateUids = [...uidCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([uid, count]) => `${uid} x${count}`);
  findings.push(
    duplicateUids.length === 0
      ? pass('metrics.alerts.duplicates', 'No hay UIDs de alerta duplicados.')
      : fail(
          'metrics.alerts.duplicates',
          `UIDs duplicados: ${duplicateUids.join(', ')}.`,
          'Cada regla debe tener un UID unico; Grafana puede rechazar o sobrescribir reglas duplicadas.',
        ),
  );

  findings.push(
    info(
      'metrics.summary',
      `${observation.targets.length} target(s), ${observation.metricNames.length} metrica(s), ${observation.dashboards.length} dashboard(s) y ${rules.length} regla(s) en una ventana de ${observation.windowMinutes} min.`,
    ),
  );

  return findings;
};
