import { describe, expect, it } from 'vitest';

import { planDevCleanup, resolveCleanupScope } from './cleanup-dev-activities.js';

interface ActivityRow {
  id: string;
  name: string;
  status: string;
  programStatus: string;
  attendanceCount: number;
  alertCount: number;
}

const activity = (overrides: Partial<ActivityRow> = {}): ActivityRow => ({
  id: 'activity-001',
  name: 'Actividad temporal fase 5.4',
  status: 'CANCELLED',
  programStatus: 'ACTIVE',
  attendanceCount: 0,
  alertCount: 0,
  ...overrides,
});

const purgeIds = (rows: readonly ActivityRow[], pattern: string): string[] =>
  resolveCleanupScope(rows, pattern).purge.map((row) => row.id);

describe('resolveCleanupScope', () => {
  it('keeps activities whose name does not match the pattern', () => {
    const rows = [activity({ name: 'Charla de puentes' }), activity({ id: 'activity-002' })];

    expect(purgeIds(rows, 'Actividad temporal%')).toEqual(['activity-002']);
  });

  it('matches with SQL LIKE semantics where % spans any characters', () => {
    const rows = [
      activity({ id: 'a', name: 'Actividad temporal 5.1' }),
      activity({ id: 'b', name: 'Temporal 5.4' }),
    ];

    expect(purgeIds(rows, 'Actividad temporal%')).toEqual(['a']);
  });

  it('treats a blank pattern as a no-op rather than a match everything', () => {
    const rows = [activity({ id: 'a' }), activity({ id: 'b' })];

    expect(resolveCleanupScope(rows, '')).toEqual({ purge: [], skipped: [] });
    expect(resolveCleanupScope(rows, '   ')).toEqual({ purge: [], skipped: [] });
  });

  it('keeps an activity that still has attendance even when the name matches', () => {
    const rows = [activity({ attendanceCount: 1 })];

    expect(resolveCleanupScope(rows, 'Actividad temporal%')).toEqual({
      purge: [],
      skipped: [{ id: 'activity-001', reason: 'has-attendance' }],
    });
  });

  it('keeps an activity that still has alerts even when the name matches', () => {
    const rows = [activity({ alertCount: 2 })];

    expect(resolveCleanupScope(rows, 'Actividad temporal%')).toEqual({
      purge: [],
      skipped: [{ id: 'activity-001', reason: 'has-alerts' }],
    });
  });

  it('reports the reason in the order the guards run', () => {
    const rows = [
      activity({ id: 'kept-name', name: 'Charla real' }),
      activity({ id: 'kept-attendance', attendanceCount: 1 }),
      activity({ id: 'kept-alert', alertCount: 1 }),
      activity({ id: 'purged' }),
    ];

    const scope = resolveCleanupScope(rows, 'Actividad temporal%');

    expect(scope.purge.map((row) => row.id)).toEqual(['purged']);
    expect(scope.skipped).toEqual([
      { id: 'kept-name', reason: 'name-does-not-match' },
      { id: 'kept-attendance', reason: 'has-attendance' },
      { id: 'kept-alert', reason: 'has-alerts' },
    ]);
  });
});

describe('planDevCleanup', () => {
  it('refuses to run when nothing matches the pattern', () => {
    const plan = planDevCleanup([activity({ name: 'Charla real' })], 'Temporal%');

    expect(plan.safe).toBe(false);
    expect(plan.reason).toBe('no-match');
    expect(plan.purge).toEqual([]);
  });

  it('refuses to run when the pattern would cover every activity', () => {
    const rows = [activity({ id: 'a' }), activity({ id: 'b' })];

    const plan = planDevCleanup(rows, '%');

    expect(plan.safe).toBe(false);
    expect(plan.reason).toBe('pattern-too-broad');
  });

  it('prefers all-retained over pattern-too-broad when nothing would be deleted', () => {
    const rows = [activity({ id: 'a', attendanceCount: 3 }), activity({ id: 'b', alertCount: 1 })];

    const plan = planDevCleanup(rows, 'Actividad temporal%');

    expect(plan.safe).toBe(false);
    expect(plan.reason).toBe('all-retained');
  });

  it('accepts a narrow pattern with at least one purgable activity', () => {
    const rows = [
      activity({ id: 'purged', name: 'Actividad temporal 5.4' }),
      activity({ id: 'kept', name: 'Actividad temporal 5.1', attendanceCount: 1 }),
      activity({ id: 'other', name: 'Charla de puentes' }),
    ];

    const plan = planDevCleanup(rows, 'Actividad temporal 5.%');

    expect(plan.safe).toBe(true);
    expect(plan.purge.map((row) => row.id)).toEqual(['purged']);
    expect(plan.skipped).toEqual([
      { id: 'kept', reason: 'has-attendance' },
      { id: 'other', reason: 'name-does-not-match' },
    ]);
  });

  it('allows purging the only activity when the operator named it exactly', () => {
    const rows = [activity({ id: 'only' })];

    const plan = planDevCleanup(rows, 'Actividad temporal fase 5.4');

    expect(plan.safe).toBe(true);
    expect(plan.total).toBe(1);
    expect(plan.purgeCount).toBe(1);
  });

  it('reports the total and the number to purge so the caller can print them', () => {
    const rows = [
      activity({ id: 'a', name: 'Actividad temporal 5.1' }),
      activity({ id: 'b', name: 'Actividad temporal 5.2' }),
      activity({ id: 'c', name: 'Charla de puentes' }),
    ];

    const plan = planDevCleanup(rows, 'Actividad temporal%');

    expect(plan.total).toBe(3);
    expect(plan.purgeCount).toBe(2);
  });
});
