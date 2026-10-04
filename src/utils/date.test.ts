import { describe, expect, it } from 'vitest';

import {
  getInstitutionalDateKey,
  getInstitutionalDayOfWeek,
  getInstitutionalDayRange,
  getInstitutionalTimeOfDay,
  INSTITUTIONAL_TIME_ZONE,
  startOfInstitutionalDay,
  toInstitutionalInstant,
} from './date.js';

describe('institutional date helpers', () => {
  it('uses the institutional time zone', () => {
    expect(INSTITUTIONAL_TIME_ZONE).toBe('America/Panama');
  });

  it('resolves the Panama calendar date before local midnight', () => {
    expect(getInstitutionalDateKey(new Date('2026-09-20T03:00:00.000Z'))).toBe('2026-09-19');
  });

  it('resolves the Panama calendar date after local midnight', () => {
    expect(getInstitutionalDateKey(new Date('2026-09-20T06:00:00.000Z'))).toBe('2026-09-20');
  });

  it('resolves the Panama calendar date exactly at local midnight', () => {
    expect(getInstitutionalDateKey(new Date('2026-09-20T05:00:00.000Z'))).toBe('2026-09-20');
  });

  it('resolves the previous day one millisecond before local midnight', () => {
    expect(getInstitutionalDateKey(new Date('2026-09-20T04:59:59.999Z'))).toBe('2026-09-19');
  });

  it('builds a date-only instant at UTC midnight of the Panama date', () => {
    const start = startOfInstitutionalDay(new Date('2026-09-20T03:00:00.000Z'));

    expect(start.toISOString()).toBe('2026-09-19T00:00:00.000Z');
  });
});

describe('getInstitutionalDayOfWeek', () => {
  it('maps Monday through Saturday to ISO 1-6', () => {
    expect(getInstitutionalDayOfWeek('2026-09-21')).toBe(1);
    expect(getInstitutionalDayOfWeek('2026-09-26')).toBe(6);
  });

  it('maps Sunday to 7', () => {
    expect(getInstitutionalDayOfWeek('2026-09-27')).toBe(7);
  });

  it('resolves dates independently from the process time zone', () => {
    expect(getInstitutionalDayOfWeek('2026-01-01')).toBe(4);
  });
});

describe('getInstitutionalDayRange', () => {
  it('resolves the institutional midnight of the requested day', () => {
    const { start, endExclusive } = getInstitutionalDayRange('2026-08-26');

    expect(start.toISOString()).toBe('2026-08-26T05:00:00.000Z');
    expect(endExclusive.toISOString()).toBe('2026-08-27T05:00:00.000Z');
  });

  it('keeps consecutive days contiguous', () => {
    const first = getInstitutionalDayRange('2026-08-26');
    const second = getInstitutionalDayRange('2026-08-27');

    expect(first.endExclusive.getTime()).toBe(second.start.getTime());
  });

  it('returns exactly 24 hours because Panama has no daylight saving time', () => {
    const { start, endExclusive } = getInstitutionalDayRange('2026-12-31');

    expect(endExclusive.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(start.toISOString()).toBe('2026-12-31T05:00:00.000Z');
  });

  it('does not depend on the process time zone', () => {
    expect(getInstitutionalDayRange('2026-01-01').start.toISOString()).toBe(
      '2026-01-01T05:00:00.000Z',
    );
  });
});

describe('getInstitutionalTimeOfDay', () => {
  it('resolves the last millisecond of the Panama day before local midnight', () => {
    const time = getInstitutionalTimeOfDay(new Date('2026-09-20T04:59:59.999Z'));

    expect(time.toISOString()).toBe('1970-01-01T23:59:59.999Z');
  });

  it('resolves midnight exactly at the institutional day start', () => {
    const time = getInstitutionalTimeOfDay(new Date('2026-09-20T05:00:00.000Z'));

    expect(time.toISOString()).toBe('1970-01-01T00:00:00.000Z');
  });

  it('resolves the Panama wall clock during the day', () => {
    const time = getInstitutionalTimeOfDay(new Date('2026-09-20T14:30:15.250Z'));

    expect(time.toISOString()).toBe('1970-01-01T09:30:15.250Z');
  });
});

describe('toInstitutionalInstant', () => {
  it('combines a calendar date and a time into the Panama instant', () => {
    const instant = toInstitutionalInstant(
      new Date('2026-09-20T00:00:00.000Z'),
      new Date('1970-01-01T09:00:00.000Z'),
    );

    expect(instant.toISOString()).toBe('2026-09-20T14:00:00.000Z');
  });

  it('maps the time zero to the institutional midnight', () => {
    const instant = toInstitutionalInstant(
      new Date('2026-09-20T00:00:00.000Z'),
      new Date('1970-01-01T00:00:00.000Z'),
    );

    expect(instant.toISOString()).toBe('2026-09-20T05:00:00.000Z');
  });

  it('stays independent from the process time zone', () => {
    const instant = toInstitutionalInstant(
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('1970-01-01T23:59:00.000Z'),
    );

    expect(instant.toISOString()).toBe('2026-01-02T04:59:00.000Z');
  });
});
