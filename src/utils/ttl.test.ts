import { describe, expect, it } from 'vitest';

import { parseTtlToMilliseconds, parseTtlToSeconds } from './ttl.js';

describe('TTL parsing', () => {
  it.each([
    ['15s', 15_000],
    ['15m', 900_000],
    ['2h', 7_200_000],
    ['7d', 604_800_000],
  ])('parses %s', (ttl, expected) => {
    expect(parseTtlToMilliseconds(ttl)).toBe(expected);
    expect(parseTtlToSeconds(ttl)).toBe(expected / 1000);
  });

  it('rejects an invalid TTL', () => {
    expect(() => parseTtlToMilliseconds('forever')).toThrow('Invalid TTL');
  });
});
