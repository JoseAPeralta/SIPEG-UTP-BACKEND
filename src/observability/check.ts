import 'dotenv/config';

export interface DatasourceHealth {
  status?: string;
  message?: string;
}

export interface AlertCondition {
  type?: string;
  query?: { params?: string[] };
  reducer?: { type?: string; params?: number[] };
  operator?: { type?: string };
  evaluator?: { type?: string; params?: number[] };
}

export interface AlertQueryModel {
  refId?: string;
  type?: string;
  expression?: string;
  expr?: string;
  instant?: boolean;
  queryType?: string;
  conditions?: AlertCondition[];
}

export interface AlertQuery {
  refId?: string;
  queryType?: string;
  datasourceUid?: string;
  model?: AlertQueryModel;
}

export interface AlertRule {
  uid?: string;
  title?: string;
  condition?: string;
  for?: string;
  dashboardUid?: string;
  panelId?: number;
  noDataState?: string;
  execErrState?: string;
  isPaused?: boolean;
  data?: AlertQuery[];
}

export interface AlertGroup {
  name?: string;
  folder?: string;
  interval?: string;
  rules?: AlertRule[];
}

export interface AlertExport {
  apiVersion?: number;
  groups?: AlertGroup[];
}

export interface PromRule {
  uid?: string;
  name?: string;
  state?: string;
  health?: string;
  provenance?: string;
}

export interface PromGroup {
  name?: string;
  interval?: number;
  rules?: PromRule[];
}

export interface PromResponse {
  status?: string;
  data?: { groups?: PromGroup[] };
}

export interface DashboardEntry {
  uid?: string;
  title?: string;
  folderTitle?: string;
}

export interface Observation {
  datasourceHealth: DatasourceHealth;
  alertExport: AlertExport;
  promRules: PromResponse;
  dashboards: DashboardEntry[];
  apiStreams: Record<string, string>[];
  windowMinutes: number;
}

export type FindingLevel = 'pass' | 'fail' | 'info';

export interface Finding {
  check: string;
  level: FindingLevel;
  detail: string;
  hint?: string;
}

const pass = (check: string, detail: string): Finding => ({ check, level: 'pass', detail });

const fail = (check: string, detail: string, hint?: string): Finding => {
  const finding: Finding = { check, level: 'fail', detail };
  if (hint !== undefined) {
    finding.hint = hint;
  }
  return finding;
};

const info = (check: string, detail: string): Finding => ({ check, level: 'info', detail });

const EXPECTED = {
  datasourceUid: 'loki',
  serviceLabel: 'sipeg-utp-backend',
  apiContainer: 'api',
  group: { name: 'sipeg-api', folder: 'SIPEG UTP', interval: '1m' },
  rules: [
    {
      uid: 'sipeg-fatal',
      threshold: 0,
      for: '0s',
      exprIncludes: 'app[.]fatal|app[.]jwks[.]failed',
      dashboardUid: 'sipeg-errors',
      panelId: 4,
    },
    {
      uid: 'sipeg-unexpected-errors',
      threshold: 5,
      for: '0s',
      exprIncludes: 'event="http.error.unexpected"',
      dashboardUid: 'sipeg-errors',
      panelId: 1,
    },
    {
      uid: 'sipeg-5xx',
      threshold: 10,
      for: '0s',
      exprIncludes: 'statusCode=~"5.."',
      dashboardUid: 'sipeg-errors',
      panelId: 7,
    },
    {
      uid: 'sipeg-auth-failures',
      threshold: 20,
      for: '0s',
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
  ],
  dashboards: ['sipeg-api-overview', 'sipeg-errors', 'sipeg-security'],
};

const SELF_REFERENCE_HINT =
  "Grafana evalua las expresiones en el servidor y una etapa `classic_conditions` debe referenciar el refId de la etapa anterior (`query.params: [A]`), no el suyo. Con `[B]` el provisioning acepta el archivo sin quejarse y cada evaluacion falla con `expression 'B' cannot reference itself. Must be query or another expression`, dejando las reglas en estado Error.";

const PRETTY_LOGS_HINT =
  'El contenedor `api` esta llegando a Loki sin etiquetas: casi siempre es LOG_PRETTY=true, o sea que el servicio se levanto sin el overlay de observabilidad. Recrear con: docker compose -f compose.dev.yaml -f compose.observability.yaml up -d --force-recreate api. Ojo: la comprobacion mira una ventana, asi que despues de arreglarlo sigue en rojo hasta que la ventana deje de abarcar las lineas viejas; --window 2 acorta la espera.';

export const verifyObservability = (observation: Observation): Finding[] => {
  const findings: Finding[] = [];
  const group = observation.alertExport.groups?.[0];
  const rules = group?.rules ?? [];
  const expectedGroup = EXPECTED.group;
  const expectedRules = EXPECTED.rules;
  const promGroup = observation.promRules.data?.groups?.find(
    (candidate) => candidate.name === expectedGroup.name,
  );
  const promRules = promGroup?.rules ?? [];

  findings.push(
    observation.datasourceHealth.status === 'OK'
      ? pass('datasource.health', 'Loki responde OK desde el datasource de Grafana.')
      : fail(
          'datasource.health',
          `Loki no esta sano: ${observation.datasourceHealth.status ?? 'sin status'} ${observation.datasourceHealth.message ?? ''}`.trim(),
          'Revisar el servicio `loki` y su healthcheck; sin datasource, las alertas no evaluan.',
        ),
  );

  const groupIsRight =
    observation.alertExport.groups?.length === 1 &&
    group?.name === expectedGroup.name &&
    group?.folder === expectedGroup.folder &&
    group?.interval === expectedGroup.interval;
  findings.push(
    groupIsRight
      ? pass(
          'alerts.group',
          `Grupo ${expectedGroup.name} en "${expectedGroup.folder}" cada ${expectedGroup.interval}.`,
        )
      : fail(
          'alerts.group',
          `Se esperaba un unico grupo ${expectedGroup.name} en "${expectedGroup.folder}" cada ${expectedGroup.interval} y hay ${observation.alertExport.groups?.length ?? 0} grupo(s): ${JSON.stringify(observation.alertExport.groups?.map((item) => ({ name: item.name, folder: item.folder, interval: item.interval })) ?? [])}.`,
          'La carpeta se referencia por titulo: el formato v1 de Grafana no admite folderUID. Revisar `folder` en rules.yaml y en dashboards.yaml.',
        ),
  );

  const uids = rules.map((rule) => rule.uid).filter((uid): uid is string => uid !== undefined);
  const expectedUids = expectedRules.map((rule) => rule.uid);
  const rulesAreRight =
    uids.length === expectedUids.length &&
    expectedUids.every((uid) => uids.filter((candidate) => candidate === uid).length === 1);
  findings.push(
    rulesAreRight
      ? pass('alerts.rules', `${uids.length} reglas esperadas y presentes.`)
      : fail(
          'alerts.rules',
          `Esperadas [${expectedUids.join(', ')}] y hay [${uids.join(', ')}].`,
          'Una regla borrada del archivo no se elimina de Grafana: se necesita `deleteRules` o recrear el volumen.',
        ),
  );

  const conditionProblems = expectedRules.flatMap((expected) => {
    const rule = rules.find((candidate) => candidate.uid === expected.uid);
    if (rule === undefined) {
      return [];
    }
    const refIds = (rule.data ?? []).map((query) => query.refId);
    return refIds.includes(rule.condition ?? '')
      ? []
      : [
          `${expected.uid}: condition=${rule.condition ?? '(vacia)'} no esta entre [${refIds.join(', ')}]`,
        ];
  });
  findings.push(
    conditionProblems.length === 0
      ? pass('alerts.condition', 'Cada condition apunta a un refId declarado en data.')
      : fail('alerts.condition', conditionProblems.join('; ')),
  );

  const selfReferenceProblems = expectedRules.flatMap((expected) => {
    const stages = rules.find((candidate) => candidate.uid === expected.uid)?.data ?? [];
    const thresholdStage = stages.find((stage) => stage.model?.type === 'classic_conditions');
    const referenced = thresholdStage?.model?.conditions?.[0]?.query?.params?.[0];
    if (thresholdStage === undefined || referenced === undefined) {
      return [`${expected.uid}: no hay etapa classic_conditions con query.params`];
    }
    // La referencia tiene que apuntar a otra etapa. Comparar contra el uid de la
    // regla daria siempre falso: los refId son A, B, C.
    return referenced === thresholdStage.refId
      ? [
          `${expected.uid}: la etapa ${thresholdStage.refId ?? '(sin refId)'} se referencia a si misma`,
        ]
      : [];
  });
  findings.push(
    selfReferenceProblems.length === 0
      ? pass('alerts.threshold-ref', 'Ninguna etapa de umbral se referencia a si misma.')
      : fail('alerts.threshold-ref', selfReferenceProblems.join('; '), SELF_REFERENCE_HINT),
  );

  const thresholdProblems = expectedRules.flatMap((expected) => {
    const condition = rules.find((candidate) => candidate.uid === expected.uid)?.data?.[1]?.model
      ?.conditions?.[0];
    const evaluator = condition?.evaluator;
    if (evaluator?.type !== 'gt' || evaluator.params?.[0] !== expected.threshold) {
      return [
        `${expected.uid}: esperaba gt ${expected.threshold} y hay ${evaluator?.type ?? 'sin evaluador'} ${JSON.stringify(evaluator?.params ?? [])}`,
      ];
    }
    return [];
  });
  findings.push(
    thresholdProblems.length === 0
      ? pass('alerts.threshold-value', 'Los cinco umbrales son los declarados.')
      : fail(
          'alerts.threshold-value',
          thresholdProblems.join('; '),
          'Un umbral se cambia a proposito (por ejemplo al recalibrar rate limits cuando exista el proxy TLS) y hay que actualizar tambien el verificador.',
        ),
  );

  const queryProblems = expectedRules.flatMap((expected) => {
    const rule = rules.find((candidate) => candidate.uid === expected.uid);
    const query = rule?.data?.[0];
    const expr = query?.model?.expr ?? '';
    const problems: string[] = [];
    if (query?.datasourceUid !== EXPECTED.datasourceUid) {
      problems.push(`datasourceUid=${query?.datasourceUid ?? '(vacio)'}`);
    }
    if (query?.queryType !== 'instant' || query?.model?.instant !== true) {
      problems.push(
        `queryType=${query?.queryType ?? '(vacio)'}/instant=${String(query?.model?.instant)}`,
      );
    }
    if (!expr.includes(expected.exprIncludes)) {
      problems.push(`expr no contiene ${expected.exprIncludes}`);
    }
    if (!expr.includes('or vector(0)')) {
      problems.push('expr no contiene "or vector(0)"');
    }
    return problems.length === 0 ? [] : [`${expected.uid}: ${problems.join(', ')}`];
  });
  findings.push(
    queryProblems.length === 0
      ? pass(
          'alerts.query',
          `Las cinco consultas son instantaneas contra ${EXPECTED.datasourceUid} y devuelven 0 en vez de vacio.`,
        )
      : fail('alerts.query', queryProblems.join('; ')),
  );

  const stateProblems = expectedRules.flatMap((expected) => {
    const rule = rules.find((candidate) => candidate.uid === expected.uid);
    if (rule === undefined) {
      return [];
    }
    const forValue = rule.for ?? '0s';
    const problems: string[] = [];
    if (rule.noDataState !== 'OK') {
      problems.push(`noDataState=${rule.noDataState ?? '(vacio)'}`);
    }
    if (rule.execErrState !== 'Alerting') {
      problems.push(`execErrState=${rule.execErrState ?? '(vacio)'}`);
    }
    if (forValue !== expected.for) {
      problems.push(`for=${forValue}`);
    }
    return problems.length === 0 ? [] : [`${expected.uid}: ${problems.join(', ')}`];
  });
  findings.push(
    stateProblems.length === 0
      ? pass('alerts.states', 'noDataState OK, execErrState Alerting y los cinco `for` declarados.')
      : fail('alerts.states', stateProblems.join('; ')),
  );

  const panelProblems = expectedRules.flatMap((expected) => {
    const rule = rules.find((candidate) => candidate.uid === expected.uid);
    if (rule === undefined) {
      return [];
    }
    if (rule.dashboardUid === expected.dashboardUid && rule.panelId === expected.panelId) {
      return [];
    }
    return [
      `${expected.uid}: esperaba ${expected.dashboardUid} panel ${expected.panelId} y hay ${rule.dashboardUid ?? '(sin dashboard)'} panel ${rule.panelId ?? '(sin panel)'}`,
    ];
  });
  findings.push(
    panelProblems.length === 0
      ? pass('alerts.panel-link', 'Las cinco reglas enlazan al panel que las explica.')
      : fail(
          'alerts.panel-link',
          panelProblems.join('; '),
          'GET /api/v1/provisioning/alert-rules NO devuelve dashboardUid ni panelId aunque esten aplicados. Esta comprobacion lee /export?format=json, que si los expone.',
        ),
  );

  const healthProblems = expectedRules.flatMap((expected) => {
    const rule = promRules.find((candidate) => candidate.uid === expected.uid);
    if (rule === undefined) {
      return [`${expected.uid}: no aparece en el endpoint de estado`];
    }
    return rule.health === 'ok' ? [] : [`${expected.uid}: health=${rule.health ?? '(vacio)'}`];
  });
  findings.push(
    healthProblems.length === 0
      ? pass('rules.health', 'Las cinco reglas evaluan con salud ok.')
      : fail(
          'rules.health',
          healthProblems.join('; '),
          'Una regla en Error casi siempre es una expresion mal formada mas que un problema de Loki: revisar `docker compose logs grafana` en busca de "Failed to evaluate rule".',
        ),
  );

  const byState = new Map<string, string[]>();
  for (const rule of promRules) {
    const state = rule.state ?? 'desconocido';
    byState.set(state, [...(byState.get(state) ?? []), rule.uid ?? '(sin uid)']);
  }
  const stateSummary = [...byState.entries()]
    .map(([state, uids]) => `${state}: ${uids.join(', ')}`)
    .join(' | ');
  findings.push(
    promRules.length === 0
      ? fail('rules.state', 'El grupo de alertas no aparece en el endpoint de estado.')
      : info(
          'rules.state',
          `${promGroup?.interval ?? 0}s de evaluacion. ${stateSummary || 'sin estados'}`,
        ),
  );

  const withoutService = observation.apiStreams.filter((stream) => stream['service'] === undefined);
  const withService = observation.apiStreams.filter(
    (stream) => stream['service'] === EXPECTED.serviceLabel && stream['log_type'] !== undefined,
  );
  if (observation.apiStreams.length === 0) {
    findings.push(
      info(
        'ingest.json-labels',
        `Sin trafico del contenedor "${EXPECTED.apiContainer}" en los ultimos ${observation.windowMinutes} min: nada que afirmar.`,
      ),
    );
  } else {
    findings.push(
      withoutService.length === 0 && withService.length > 0
        ? pass(
            'ingest.json-labels',
            `${withService.length} stream(s) de "${EXPECTED.apiContainer}" con service y log_type: la cadena JSON -> Alloy -> Loki esta viva.`,
          )
        : fail(
            'ingest.json-labels',
            `${withoutService.length} stream(s) del contenedor "${EXPECTED.apiContainer}" sin la etiqueta service, y ${withService.length} con service+log_type.`,
            PRETTY_LOGS_HINT,
          ),
    );
  }

  const folderProblems = EXPECTED.dashboards.flatMap((uid) => {
    const dashboard = observation.dashboards.find((candidate) => candidate.uid === uid);
    if (dashboard === undefined) {
      return [`falta el panel ${uid}`];
    }
    return dashboard.folderTitle === expectedGroup.folder
      ? []
      : [`${uid} esta en "${dashboard.folderTitle ?? '(sin carpeta)'}"`];
  });
  findings.push(
    folderProblems.length === 0
      ? pass(
          'dashboards.folder',
          `Los tres paneles y las alertas comparten la carpeta "${expectedGroup.folder}".`,
        )
      : fail(
          'dashboards.folder',
          folderProblems.join('; '),
          'Alertas y paneles se enlazan por TITULO de carpeta: es lo unico que ambos provisionadores comparten.',
        ),
  );

  return findings;
};

export const renderReport = (findings: Finding[]): string => {
  const lines: string[] = [];
  for (const finding of findings) {
    lines.push(`[${finding.level.toUpperCase()}] ${finding.check}: ${finding.detail}`);
    if (finding.hint !== undefined) {
      lines.push(`    -> ${finding.hint}`);
    }
  }
  const failed = findings.filter((finding) => finding.level === 'fail').length;
  const passed = findings.filter((finding) => finding.level === 'pass').length;
  lines.push('', `${passed} pass, ${failed} fail, ${findings.length} comprobaciones.`);
  return lines.join('\n');
};

export interface SeriesResponse {
  status?: string;
  data?: Record<string, string>[];
}

export interface Options {
  url: string;
  windowMinutes: number;
}

const DEFAULT_WINDOW_MINUTES = 15;

/**
 * Lee el puerto de Grafana del entorno sin pasar por `src/config/env.ts`: ese
 * modulo valida el entorno completo de la aplicacion (AUTH_SECRET, DATABASE_URL,
 * ...) y este verificador solo necesita las credenciales de la UI.
 */
const readOptions = (argv: string[]): Options => {
  const readFlag = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    const value = index === -1 ? undefined : argv[index + 1];
    return value !== undefined && !value.startsWith('--') ? value : undefined;
  };

  const windowFlag = readFlag('--window');
  const windowMinutes = windowFlag === undefined ? DEFAULT_WINDOW_MINUTES : Number(windowFlag);
  if (!Number.isInteger(windowMinutes) || windowMinutes < 1) {
    throw new Error(`--window debe ser un entero de minutos, no "${windowFlag ?? ''}".`);
  }

  return {
    url: readFlag('--url') ?? `http://127.0.0.1:${process.env['GRAFANA_PORT'] ?? '3001'}`,
    windowMinutes,
  };
};

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `Falta ${name}. El verificador habla con la UI de Grafana, no con Loki: necesita las mismas credenciales que se usan para entrar a http://127.0.0.1:GRAFANA_PORT.`,
    );
  }
  return value;
};

const getJson = async <T>(url: string, authorization: string): Promise<T> => {
  const response = await fetch(url, { headers: { authorization } });
  if (!response.ok) {
    throw new Error(`Grafana respondio ${response.status} ${response.statusText} en ${url}`);
  }
  // Una sola asercion local: las formas de las respuestas son las de la API de
  // Grafana 13 y se verifican comprobando los campos, no revalidando el esquema.
  return (await response.json()) as T;
};

const collectObservation = async (options: Options): Promise<Observation> => {
  const user = process.env['GRAFANA_ADMIN_USER'] ?? 'admin';
  const authorization = `Basic ${Buffer.from(`${user}:${requireEnv('GRAFANA_ADMIN_PASSWORD')}`).toString('base64')}`;
  const { url, windowMinutes } = options;

  const endSeconds = Math.floor(Date.now() / 1000);
  const startSeconds = endSeconds - windowMinutes * 60;
  const seriesUrl = new URL(`${url}/api/datasources/proxy/uid/loki/loki/api/v1/series`);
  seriesUrl.searchParams.append('match[]', `{container="${EXPECTED.apiContainer}"}`);
  seriesUrl.searchParams.append('start', `${startSeconds}000000000`);
  seriesUrl.searchParams.append('end', `${endSeconds}000000000`);

  const [datasourceHealth, alertExport, promRules, dashboards, series] = await Promise.all([
    getJson<DatasourceHealth>(`${url}/api/datasources/uid/loki/health`, authorization),
    getJson<AlertExport>(
      `${url}/api/v1/provisioning/alert-rules/export?format=json`,
      authorization,
    ),
    getJson<PromResponse>(`${url}/api/prometheus/grafana/api/v1/rules`, authorization),
    getJson<DashboardEntry[]>(`${url}/api/search?type=dash-db`, authorization),
    getJson<SeriesResponse>(seriesUrl.toString(), authorization),
  ]);

  return {
    datasourceHealth,
    alertExport,
    promRules,
    dashboards,
    apiStreams: series.data ?? [],
    windowMinutes,
  };
};

const main = async (): Promise<void> => {
  const options = readOptions(process.argv.slice(2));
  console.log(
    `Verificando el stack de observabilidad en ${options.url} (ventana de ${options.windowMinutes} min).`,
  );

  const findings = verifyObservability(await collectObservation(options));

  console.log(renderReport(findings));

  if (findings.some((finding) => finding.level === 'fail')) {
    process.exitCode = 1;
  }
};

const isDirectRun = (): boolean => {
  const entry = process.argv[1] ?? '';

  return entry.endsWith('check.ts') || entry.endsWith('check.js');
};

if (isDirectRun()) {
  main().catch((error: unknown) => {
    console.error(
      'No se pudo verificar el stack de observabilidad.',
      error instanceof Error ? error.message : error,
    );
    console.error(
      'Si el error es de conexion, el overlay no esta levantado: docker compose -f compose.dev.yaml -f compose.observability.yaml up -d',
    );
    process.exitCode = 1;
  });
}
