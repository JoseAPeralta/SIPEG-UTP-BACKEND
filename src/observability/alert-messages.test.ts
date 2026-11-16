import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface MessageRule {
  uid: string;
  annotations?: Record<string, string>;
  [key: string]: unknown;
}

interface MessageDocument {
  groups?: Array<{
    rules?: MessageRule[];
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

const load = async (name: string): Promise<MessageDocument> =>
  parse(
    await readFile(
      new URL(`../../observability/grafana/provisioning/alerting/${name}`, import.meta.url),
      'utf8',
    ),
  ) as MessageDocument;

const withoutAnnotations = (document: MessageDocument): MessageDocument => ({
  ...document,
  ...(document.groups === undefined
    ? {}
    : {
        groups: document.groups.map((group) => ({
          ...group,
          rules: (group.rules ?? []).map((rule) => {
            const copy = { ...rule };
            delete copy.annotations;
            return copy;
          }),
        })),
      }),
});

describe.each(['rules.yaml', 'metrics.yaml'])('%s: contrato previo', (name) => {
  it('conserva toda la configuración excepto anotaciones', async () => {
    expect(withoutAnnotations(await load(name))).toMatchSnapshot();
  });
});

describe.each(['contact-points.yaml', 'notification-policies.yaml'])(
  '%s: notificaciones',
  (name) => {
    it('conserva contacto, recuperación, agrupación y frecuencias', async () => {
      expect(await load(name)).toMatchSnapshot();
    });
  },
);

const IDENTIFIER_KEYS = [
  'check',
  'route',
  'instance',
  'job',
  'module',
  'service',
  'project',
  'collector',
  'mountpoint',
  'fstype',
] as const;

it('las 21 reglas muestran valor y etiquetas permitidas sin cambiar su identidad', async () => {
  const documents = await Promise.all(['rules.yaml', 'metrics.yaml'].map(load));
  const rules = documents.flatMap((document) =>
    (document.groups ?? []).flatMap((group) => group.rules ?? []),
  );
  expect(rules).toHaveLength(21);
  expect(new Set(rules.map((rule) => rule.uid)).size).toBe(21);

  for (const rule of rules) {
    const description = rule.annotations?.['description'] ?? '';
    expect(description, rule.uid).toContain('Detalle:');
    expect(description, rule.uid).toContain('range $key, $value := $values');
    expect(description, rule.uid).toContain('match "^B[0-9]+$" $key');
    expect(description, rule.uid).toContain('printf "%.2f" $value.Value');
    expect(description, rule.uid).toContain('if not $found');
    expect(description, rule.uid).toContain('Sin detalle de series para esta evaluación.');
    expect(description, rule.uid).toContain('alcance=global');
    for (const key of IDENTIFIER_KEYS) {
      expect(description, `${rule.uid}/${key}`).toContain(`$value.Labels.${key}`);
    }
    const labelKeys = [...description.matchAll(/\$value\.Labels\.(\w+)/g)].map((match) => match[1]);
    expect([...new Set(labelKeys)].sort(), rule.uid).toEqual([...IDENTIFIER_KEYS].sort());
    expect(description, rule.uid).not.toMatch(/\$labels\b/);
    expect(description, rule.uid).not.toMatch(/\{\{\s*\$value\.Labels\s*\}\}/);
    expect(description, rule.uid).not.toContain('$$values');
  }

  const message = (uid: string): string => {
    const rule = rules.find((candidate) => candidate.uid === uid);
    expect(rule, uid).toBeDefined();
    return rule?.annotations?.['description'] ?? '';
  };

  expect(message('sipeg-probe-failing')).toContain('El valor no es un código HTTP.');
  expect(message('sipeg-probe-failing')).toContain('authJwksReachable');
  expect(message('sipeg-probe-failing')).toContain('cf-mitigated');
  expect(message('sipeg-probe-failing')).toContain('mismo VPS');
  expect(message('sipeg-host-memory-low')).toContain('condición <10 % durante 10m');
  expect(message('sipeg-tls-expiring')).toContain('condición <7 días durante 1h');
  expect(message('sipeg-api-latency-high')).toContain('latencia p95 en segundos');
  expect(message('sipeg-http-5xx-ratio')).toContain('más de 20 solicitudes');
  expect(message('sipeg-5xx')).toContain('condición >10');
  expect(message('sipeg-disk-full')).toContain('condición >80 % durante 15m');
});
