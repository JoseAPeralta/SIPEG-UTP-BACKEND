import { describe, expect, it } from 'vitest';

import {
  getInstitutionalDateKey,
  INSTITUTIONAL_TIME_ZONE,
  startOfInstitutionalDay,
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
