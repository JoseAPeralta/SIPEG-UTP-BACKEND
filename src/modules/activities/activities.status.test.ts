import { describe, expect, it } from 'vitest';

import {
  buildEffectiveStatusWhere,
  buildReservingActivityWhere,
  PUBLISHED_ACTIVITY_STATUSES,
  resolveActivityStatus,
} from './activities.status.js';

const NOW = new Date('2026-09-20T14:30:00.000Z');

const buildActivity = (overrides: Partial<Parameters<typeof resolveActivityStatus>[0]> = {}) => ({
  status: 'SCHEDULED' as const,
  date: new Date('2026-09-20T00:00:00.000Z'),
  startTime: new Date('1970-01-01T09:00:00.000Z'),
  endTime: new Date('1970-01-01T11:00:00.000Z'),
  ...overrides,
});

describe('resolveActivityStatus', () => {
  it('exposes the published status as scheduled before the start', () => {
    const activity = buildActivity({ startTime: new Date('1970-01-01T15:00:00.000Z') });

    expect(resolveActivityStatus(activity, NOW)).toBe('SCHEDULED');
  });

  it('resolves ongoing at the exact start instant', () => {
    const activity = buildActivity({ startTime: new Date('1970-01-01T09:30:00.000Z') });

    expect(resolveActivityStatus(activity, NOW)).toBe('ONGOING');
  });

  it('resolves ongoing inside the window', () => {
    expect(resolveActivityStatus(buildActivity(), NOW)).toBe('ONGOING');
  });

  it('resolves completed at the exact end instant', () => {
    const activity = buildActivity({ endTime: new Date('1970-01-01T09:30:00.000Z') });

    expect(resolveActivityStatus(activity, NOW)).toBe('COMPLETED');
  });

  it('resolves completed after the end', () => {
    const activity = buildActivity({
      date: new Date('2026-09-01T00:00:00.000Z'),
      startTime: new Date('1970-01-01T09:00:00.000Z'),
      endTime: new Date('1970-01-01T11:00:00.000Z'),
    });

    expect(resolveActivityStatus(activity, NOW)).toBe('COMPLETED');
  });

  it('keeps DRAFT and CANCELLED untouched', () => {
    expect(resolveActivityStatus(buildActivity({ status: 'DRAFT' }), NOW)).toBe('DRAFT');
    expect(resolveActivityStatus(buildActivity({ status: 'CANCELLED' }), NOW)).toBe('CANCELLED');
  });

  it('tolerates legacy ONGOING and COMPLETED stored values', () => {
    const past = {
      date: new Date('2026-09-01T00:00:00.000Z'),
      startTime: new Date('1970-01-01T09:00:00.000Z'),
      endTime: new Date('1970-01-01T11:00:00.000Z'),
    };

    expect(resolveActivityStatus(buildActivity({ status: 'ONGOING', ...past }), NOW)).toBe(
      'COMPLETED',
    );
    expect(resolveActivityStatus(buildActivity({ status: 'COMPLETED', ...past }), NOW)).toBe(
      'COMPLETED',
    );
  });

  it('uses the Panama day boundary', () => {
    const activity = buildActivity({
      date: new Date('2026-09-20T00:00:00.000Z'),
      startTime: new Date('1970-01-01T00:00:00.000Z'),
      endTime: new Date('1970-01-01T01:00:00.000Z'),
    });

    expect(resolveActivityStatus(activity, new Date('2026-09-20T04:59:00.000Z'))).toBe('SCHEDULED');
    expect(resolveActivityStatus(activity, new Date('2026-09-20T05:00:00.000Z'))).toBe('ONGOING');
    expect(resolveActivityStatus(activity, new Date('2026-09-20T06:00:00.000Z'))).toBe('COMPLETED');
  });
});

describe('buildEffectiveStatusWhere', () => {
  it('maps DRAFT and CANCELLED to the stored value', () => {
    expect(buildEffectiveStatusWhere('DRAFT', NOW)).toEqual({ status: 'DRAFT' });
    expect(buildEffectiveStatusWhere('CANCELLED', NOW)).toEqual({ status: 'CANCELLED' });
  });

  it('builds the scheduled predicate around the institutional day', () => {
    expect(buildEffectiveStatusWhere('SCHEDULED', NOW)).toEqual({
      status: { in: PUBLISHED_ACTIVITY_STATUSES },
      OR: [
        { date: { gt: new Date('2026-09-20T00:00:00.000Z') } },
        {
          date: new Date('2026-09-20T00:00:00.000Z'),
          startTime: { gt: new Date('1970-01-01T09:30:00.000Z') },
        },
      ],
    });
  });

  it('builds the ongoing predicate with a half-open window', () => {
    expect(buildEffectiveStatusWhere('ONGOING', NOW)).toEqual({
      status: { in: PUBLISHED_ACTIVITY_STATUSES },
      date: new Date('2026-09-20T00:00:00.000Z'),
      startTime: { lte: new Date('1970-01-01T09:30:00.000Z') },
      endTime: { gt: new Date('1970-01-01T09:30:00.000Z') },
    });
  });

  it('builds the completed predicate around the end instant', () => {
    expect(buildEffectiveStatusWhere('COMPLETED', NOW)).toEqual({
      status: { in: PUBLISHED_ACTIVITY_STATUSES },
      OR: [
        { date: { lt: new Date('2026-09-20T00:00:00.000Z') } },
        {
          date: new Date('2026-09-20T00:00:00.000Z'),
          endTime: { lte: new Date('1970-01-01T09:30:00.000Z') },
        },
      ],
    });
  });
});

describe('buildReservingActivityWhere', () => {
  it('keeps only published activities that have not ended', () => {
    expect(buildReservingActivityWhere(NOW)).toEqual({
      status: { in: PUBLISHED_ACTIVITY_STATUSES },
      OR: [
        { date: { gt: new Date('2026-09-20T00:00:00.000Z') } },
        {
          date: new Date('2026-09-20T00:00:00.000Z'),
          endTime: { gt: new Date('1970-01-01T09:30:00.000Z') },
        },
      ],
    });
  });
});
