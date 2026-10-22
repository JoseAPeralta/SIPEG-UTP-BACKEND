import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import type { AlertCondition, AlertExport } from './check.js';

const ALERT_FILES = ['rules.yaml', 'metrics.yaml'] as const;

const loadAlerts = async (fileName: string): Promise<AlertExport> => {
  const content = await readFile(
    new URL(`../../observability/grafana/provisioning/alerting/${fileName}`, import.meta.url),
    'utf8',
  );
  return parse(content) as AlertExport;
};

interface ThresholdProblem {
  rule: string;
  message: string;
}

const thresholdProblems = (document: AlertExport): ThresholdProblem[] => {
  const problems: ThresholdProblem[] = [];
  for (const group of document.groups ?? []) {
    for (const rule of group.rules ?? []) {
      const stage = (rule.data ?? []).find((query) => query.model?.type === 'classic_conditions');
      if (stage === undefined) {
        continue;
      }
      const condition = stage.model?.conditions?.[0];
      const name = `${group.name ?? '?'}/${rule.uid ?? '?'}`;
      if (condition === undefined) {
        problems.push({ rule: name, message: 'sin condition' });
        continue;
      }
      if (condition.reducer?.type === undefined || condition.reducer.type === '') {
        problems.push({ rule: name, message: 'reducer vacio' });
      }
      if (condition.operator?.type === undefined || condition.operator.type === '') {
        problems.push({ rule: name, message: 'operator vacio' });
      }
      if (condition.evaluator?.type === undefined || condition.evaluator.type === '') {
        problems.push({ rule: name, message: 'evaluator vacio' });
      }
      if (!Array.isArray(condition.evaluator?.params)) {
        problems.push({ rule: name, message: 'evaluator sin params' });
      }
      const referenced = condition.query?.params?.[0];
      if (referenced === undefined || referenced === '') {
        problems.push({ rule: name, message: 'query.params vacio' });
      } else if (referenced === stage.refId) {
        problems.push({ rule: name, message: 'la condicion se referencia a si misma' });
      }
    }
  }
  return problems;
};

describe.each(ALERT_FILES)('%s', (fileName) => {
  it('declara reducer, operator y evaluator fuera de query en cada umbral', async () => {
    const document = await loadAlerts(fileName);

    expect(thresholdProblems(document)).toEqual([]);
  });
});

it('detecta reducer, operator y evaluator anidados dentro de query', () => {
  const malformed: AlertExport = {
    apiVersion: 1,
    groups: [
      {
        name: 'sipeg-host',
        rules: [
          {
            uid: 'sipeg-disk-full',
            condition: 'B',
            data: [
              { refId: 'A', model: { expr: 'up' } },
              {
                refId: 'B',
                model: {
                  refId: 'B',
                  type: 'classic_conditions',
                  conditions: [
                    {
                      type: 'query',
                      query: { params: ['A'] },
                      reducer: { type: 'last', params: [] },
                      operator: { type: 'and' },
                      evaluator: { type: 'gt', params: [80] },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  };

  const condition = malformed.groups?.[0]?.rules?.[0]?.data?.[1]?.model?.conditions?.[0];
  if (condition !== undefined) {
    const nestedQuery = condition.query as AlertCondition['query'] & Record<string, unknown>;
    nestedQuery['reducer'] = condition.reducer;
    nestedQuery['operator'] = condition.operator;
    nestedQuery['evaluator'] = condition.evaluator;
    delete condition.reducer;
    delete condition.operator;
    delete condition.evaluator;
  }

  expect(thresholdProblems(malformed)).toEqual(
    expect.arrayContaining([
      { rule: 'sipeg-host/sipeg-disk-full', message: 'reducer vacio' },
      { rule: 'sipeg-host/sipeg-disk-full', message: 'operator vacio' },
      { rule: 'sipeg-host/sipeg-disk-full', message: 'evaluator vacio' },
    ]),
  );
});
