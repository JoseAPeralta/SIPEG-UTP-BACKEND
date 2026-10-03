import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

interface DashboardTarget {
  direction?: string;
  expr?: string;
}

interface DashboardPanel {
  title?: string;
  type?: string;
  targets?: DashboardTarget[];
}

const loadApiOverview = async (): Promise<{ panels: DashboardPanel[] }> => {
  const content = await readFile(
    new URL('../../observability/grafana/dashboards/api-overview.json', import.meta.url),
    'utf8',
  );
  return JSON.parse(content) as { panels: DashboardPanel[] };
};

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
