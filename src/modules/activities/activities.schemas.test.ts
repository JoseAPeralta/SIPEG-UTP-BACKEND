import { describe, expect, it } from 'vitest';

import { listActivitiesQuerySchema } from './activities.schemas.js';

describe('listActivitiesQuerySchema', () => {
  it('applies default pagination', () => {
    const parsed = listActivitiesQuerySchema.parse({ query: {} });

    expect(parsed.query).toEqual({ page: 1, limit: 20 });
  });

  it('coerces numeric strings', () => {
    const parsed = listActivitiesQuerySchema.parse({ query: { page: '3', limit: '50' } });

    expect(parsed.query).toEqual({ page: 3, limit: 50 });
  });

  it('rejects a limit above the maximum', () => {
    expect(() => listActivitiesQuerySchema.parse({ query: { limit: '51' } })).toThrow();
  });

  it('rejects a page below one', () => {
    expect(() => listActivitiesQuerySchema.parse({ query: { page: '0' } })).toThrow();
  });

  it('rejects non numeric values', () => {
    expect(() => listActivitiesQuerySchema.parse({ query: { page: 'abc' } })).toThrow();
  });

  it('rejects unknown query parameters', () => {
    expect(() => listActivitiesQuerySchema.parse({ query: { sort: 'name' } })).toThrow();
  });
});
