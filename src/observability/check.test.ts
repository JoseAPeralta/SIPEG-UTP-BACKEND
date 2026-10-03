import { describe, expect, it } from 'vitest';

import {
  type AlertExport,
  type DashboardEntry,
  type DatasourceHealth,
  type Observation,
  type PromResponse,
  renderReport,
  verifyObservability,
} from './check.js';

/**
 * Tabla de expectativas declarada aqui, y no importada del modulo, para que el
 * test sea un contrato independiente: si `EXPECTED` cambia en `check.ts` y el
 * archivo del repositorio no, este test falla en vez de confirmar el error.
 */
const FIXTURE_RULES = [
  {
    uid: 'sipeg-fatal',
    threshold: 0,
    for: undefined,
    exprIncludes: 'event=~"app[.]fatal|app[.]jwks[.]failed"',
    dashboardUid: 'sipeg-errors',
    panelId: 4,
  },
  {
    uid: 'sipeg-unexpected-errors',
    threshold: 5,
    for: undefined,
    exprIncludes: 'event="http.error.unexpected"',
    dashboardUid: 'sipeg-errors',
    panelId: 1,
  },
  {
    uid: 'sipeg-5xx',
    threshold: 10,
    for: undefined,
    exprIncludes: 'statusCode=~"5.."',
    dashboardUid: 'sipeg-errors',
    panelId: 7,
  },
  {
    uid: 'sipeg-auth-failures',
    threshold: 20,
    for: undefined,
    exprIncludes: 'event="auth.login.failed"',
    dashboardUid: 'sipeg-security',
    panelId: 6,
  },
  {
    uid: 'sipeg-rate-limits',
    threshold: 30,
    for: '2m',
    exprIncludes: 'event="rate_limit.exceeded"',
    dashboardUid: 'sipeg-security',
    panelId: 4,
  },
] as const;

const jsonStreams = {
  log_type: 'access',
  service: 'sipeg-utp-backend',
  container: 'api',
  environment: 'development',
  level: 'info',
} as const;

type FixtureRules = NonNullable<NonNullable<AlertExport['groups']>[number]['rules']>;

function buildExport(mutate: (rules: FixtureRules) => void = () => {}): AlertExport {
  const rules = FIXTURE_RULES.map((rule) => ({
    uid: rule.uid,
    title: rule.uid,
    condition: 'B',
    ...(rule.for === undefined ? {} : { for: rule.for }),
    dashboardUid: rule.dashboardUid,
    panelId: rule.panelId,
    noDataState: 'OK',
    execErrState: 'Alerting',
    isPaused: false,
    data: [
      {
        refId: 'A',
        queryType: 'instant',
        datasourceUid: 'loki',
        model: {
          refId: 'A',
          instant: true,
          queryType: 'instant',
          expr: `sum(count_over_time({service="sipeg-utp-backend"} |= "${rule.exprIncludes}" [5m])) or vector(0)`,
        },
      },
      {
        refId: 'B',
        queryType: '',
        datasourceUid: '__expr__',
        model: {
          refId: 'B',
          type: 'classic_conditions',
          expression: 'A',
          conditions: [
            {
              type: 'query',
              query: { params: ['A'] },
              reducer: { type: 'last', params: [] },
              operator: { type: 'and' },
              evaluator: { type: 'gt', params: [rule.threshold] },
            },
          ],
        },
      },
    ],
  }));

  mutate(rules);

  return {
    apiVersion: 1,
    groups: [{ name: 'sipeg-api', folder: 'SIPEG UTP', interval: '1m', rules }],
  };
}

function buildPromRules(
  overrides: Partial<Record<string, { health?: string; state?: string }>> = {},
): PromResponse {
  return {
    status: 'success',
    data: {
      groups: [
        {
          name: 'sipeg-api',
          interval: 60,
          rules: FIXTURE_RULES.map((rule) => ({
            uid: rule.uid,
            name: rule.uid,
            health: overrides[rule.uid]?.health ?? 'ok',
            state: overrides[rule.uid]?.state ?? 'inactive',
            provenance: 'file',
          })),
        },
      ],
    },
  };
}

const healthyHealth: DatasourceHealth = {
  status: 'OK',
  message: 'Data source successfully connected.',
};

const healthyDashboards: DashboardEntry[] = [
  { uid: 'sipeg-api-overview', title: 'API Overview', folderTitle: 'SIPEG UTP' },
  { uid: 'sipeg-errors', title: 'Errors', folderTitle: 'SIPEG UTP' },
  { uid: 'sipeg-security', title: 'Security', folderTitle: 'SIPEG UTP' },
];

const healthyApiOverview = {
  dashboard: {
    panels: [
      {
        title: 'Frecuencia por operacion',
        targets: [
          {
            expr: 'sort_desc(sum by (method, route) (count_over_time({log_type="access"} | requestKind="matched" [$__auto])))',
          },
        ],
      },
      {
        title: 'Ultimas solicitudes',
        type: 'logs',
        targets: [{ direction: 'backward', expr: '{log_type="access"}' }],
      },
    ],
  },
};

function buildObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    datasourceHealth: healthyHealth,
    alertExport: buildExport(),
    promRules: buildPromRules(),
    dashboards: healthyDashboards,
    apiStreams: [jsonStreams],
    apiUnstructuredLines: [],
    apiOverview: healthyApiOverview,
    windowMinutes: 15,
    ...overrides,
  };
}

const checkIds = (observation: Observation): string[] =>
  verifyObservability(observation)
    .filter((finding) => finding.level === 'fail')
    .map((finding) => finding.check);

describe('verifyObservability', () => {
  it('no reporta ningun fallo contra un stack sano', () => {
    expect(checkIds(buildObservation())).toEqual([]);
  });

  it('falla si el datasource Loki no esta sano', () => {
    expect(
      checkIds(
        buildObservation({
          datasourceHealth: { status: 'error', message: 'dial tcp: connection refused' },
        }),
      ),
    ).toContain('datasource.health');
  });

  it('falla si el grupo de alertas no es el declarado o cambia de carpeta o intervalo', () => {
    const wrongGroup = buildObservation({
      alertExport: {
        ...buildExport(),
        groups: [{ name: 'otro', folder: 'General', interval: '5m', rules: [] }],
      },
    });

    expect(checkIds(wrongGroup)).toContain('alerts.group');
  });

  it('falla si falta una regla esperada', () => {
    const missing = buildObservation({
      alertExport: {
        groups: [
          {
            name: 'sipeg-api',
            folder: 'SIPEG UTP',
            interval: '1m',
            rules: buildExport().groups?.[0]?.rules?.slice(0, 4) ?? [],
          },
        ],
      },
    });

    expect(checkIds(missing)).toContain('alerts.rules');
  });

  it('falla si la condition apunta a un refId inexistente', () => {
    const dangling = buildObservation({
      alertExport: buildExport((rules) => {
        const rule = rules[0];
        if (rule) rule.condition = 'Z';
      }),
    });

    expect(checkIds(dangling)).toContain('alerts.condition');
  });

  it('falla si el umbral referencia su propio refId, que Grafana rechaza al evaluar', () => {
    const selfReferencing = buildObservation({
      alertExport: buildExport((rules) => {
        const conditions = rules[0]?.data?.[1]?.model?.conditions;
        if (conditions?.[0]?.query) conditions[0].query.params = ['B'];
      }),
    });

    const failed = checkIds(selfReferencing);

    expect(failed).toContain('alerts.threshold-ref');
    const finding = verifyObservability(selfReferencing).find(
      (item) => item.check === 'alerts.threshold-ref',
    );
    expect(finding?.hint).toContain('cannot reference itself');
  });

  it('falla si el umbral no es el declarado, aunque la forma sea correcta', () => {
    const drifted = buildObservation({
      alertExport: buildExport((rules) => {
        const conditions = rules[3]?.data?.[1]?.model?.conditions;
        if (conditions?.[0]?.evaluator) conditions[0].evaluator.params = [25];
      }),
    });

    expect(checkIds(drifted)).toContain('alerts.threshold-value');
  });

  it('falla si la consulta no usa el datasource loki ni es instantanea', () => {
    const wrongQuery = buildObservation({
      alertExport: buildExport((rules) => {
        const query = rules[0]?.data?.[0];
        if (query) {
          query.datasourceUid = 'otro-datasource';
          query.queryType = 'range';
        }
      }),
    });

    expect(checkIds(wrongQuery)).toContain('alerts.query');
  });

  it('falla si la consulta pierde el or vector(0), que es lo que evita el estado NoData', () => {
    const withoutFallback = buildObservation({
      alertExport: buildExport((rules) => {
        const model = rules[0]?.data?.[0]?.model;
        if (model?.expr) model.expr = model.expr.replace(' or vector(0)', '');
      }),
    });

    expect(checkIds(withoutFallback)).toContain('alerts.query');
  });

  it('falla si cambia noDataState o execErrState', () => {
    const unsafeStates = buildObservation({
      alertExport: buildExport((rules) => {
        const rule = rules[0];
        if (rule) {
          rule.noDataState = 'Alerting';
          rule.execErrState = 'OK';
        }
      }),
    });

    expect(checkIds(unsafeStates)).toContain('alerts.states');
  });

  it('acepta una regla sin `for` como 0s y exige el 2m de rate limits', () => {
    expect(checkIds(buildObservation())).toEqual([]);

    const wrongFor = buildObservation({
      alertExport: buildExport((rules) => {
        const rule = rules[4];
        if (rule) rule.for = '5m';
      }),
    });

    expect(checkIds(wrongFor)).toContain('alerts.states');
  });

  it('falla si falta el enlace al panel, que solo expone el export y no el listado de reglas', () => {
    const withoutPanel = buildObservation({
      alertExport: buildExport((rules) => {
        const rule = rules[0];
        if (rule) {
          delete rule.dashboardUid;
          delete rule.panelId;
        }
      }),
    });

    expect(checkIds(withoutPanel)).toContain('alerts.panel-link');
  });

  it('falla si el panel enlazado no es el que corresponde a la regla', () => {
    const wrongPanel = buildObservation({
      alertExport: buildExport((rules) => {
        const rule = rules[2];
        if (rule) rule.panelId = 99;
      }),
    });

    expect(checkIds(wrongPanel)).toContain('alerts.panel-link');
  });

  it('falla si alguna regla queda en estado de salud Error, que es como se manifiesta una expresion rota', () => {
    const broken = buildObservation({
      promRules: buildPromRules({ 'sipeg-5xx': { health: 'Error' } }),
    });

    expect(checkIds(broken)).toContain('rules.health');
  });

  it('informa el estado de las alertas sin fallar por estar disparada', () => {
    const firing = buildObservation({
      promRules: buildPromRules({ 'sipeg-rate-limits': { state: 'alerting' } }),
    });

    const findings = verifyObservability(firing);

    expect(findings.find((item) => item.check === 'rules.state')?.level).toBe('info');
    expect(findings.filter((item) => item.level === 'fail')).toEqual([]);
  });

  it('falla si hay lineas no estructuradas de la aplicacion, que es la firma de LOG_PRETTY', () => {
    const prettyLogs = buildObservation({
      apiStreams: [jsonStreams, { container: 'api' }],
      apiUnstructuredLines: ['[12:00:00] INFO GET /api/v1/users 200'],
    });

    const failed = checkIds(prettyLogs);

    expect(failed).toContain('ingest.json-labels');
    const finding = verifyObservability(prettyLogs).find(
      (item) => item.check === 'ingest.json-labels',
    );
    expect(finding?.hint).toContain('LOG_PRETTY');
    expect(finding?.hint).toContain('--force-recreate api');
    expect(finding?.hint).toContain('--window');
  });

  it('tolera el banner conocido de tsx watch sin ocultar otros logs no estructurados', () => {
    const developmentStartup = buildObservation({
      apiStreams: [jsonStreams, { container: 'api' }],
      apiUnstructuredLines: ['$ tsx watch src/server.ts'],
    });

    const finding = verifyObservability(developmentStartup).find(
      (item) => item.check === 'ingest.json-labels',
    );

    expect(finding?.level).toBe('pass');
  });

  it('informa sin fallar cuando no hubo trafico del contenedor api en la ventana', () => {
    const quiet = buildObservation({ apiStreams: [] });

    const findings = verifyObservability(quiet);

    expect(findings.find((item) => item.check === 'ingest.json-labels')?.level).toBe('info');
    expect(findings.filter((item) => item.level === 'fail')).toEqual([]);
  });

  it('falla si un panel quedo en otra carpeta que el grupo de alertas', () => {
    const splitFolder = buildObservation({
      dashboards: [
        ...healthyDashboards.slice(0, 2),
        { uid: 'sipeg-security', title: 'Security', folderTitle: 'General' },
      ],
    });

    expect(checkIds(splitFolder)).toContain('dashboards.folder');
  });

  it('falla si falta alguno de los tres paneles provisionados', () => {
    const missingDashboard = buildObservation({
      dashboards: healthyDashboards.slice(0, 2),
    });

    expect(checkIds(missingDashboard)).toContain('dashboards.folder');
  });

  it('falla si API Overview no tiene una cola descendente de access logs', () => {
    const broken = buildObservation({
      apiOverview: {
        dashboard: {
          panels: healthyApiOverview.dashboard.panels.filter(
            (panel) => panel.title !== 'Ultimas solicitudes',
          ),
        },
      },
    });

    expect(checkIds(broken)).toContain('dashboards.api-traffic');
  });

  it('falla si la frecuencia no distingue method y route', () => {
    const broken = buildObservation({
      apiOverview: {
        dashboard: {
          panels: [
            {
              title: 'Frecuencia por operacion',
              targets: [{ expr: 'topk(10, sum by (route) (count_over_time({} [1h])))' }],
            },
            healthyApiOverview.dashboard.panels[1]!,
          ],
        },
      },
    });

    expect(checkIds(broken)).toContain('dashboards.api-traffic');
  });
});

describe('renderReport', () => {
  it('marca cada hallazgo y resume el resultado', () => {
    const report = renderReport(
      verifyObservability(
        buildObservation({
          promRules: buildPromRules({ 'sipeg-5xx': { health: 'Error' } }),
        }),
      ),
    );

    expect(report).toContain('rules.health');
    expect(report).toContain('FAIL');
    expect(report).toContain('PASS');
  });
});
