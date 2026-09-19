import { describe, expect, it } from 'vitest';

import { listEventsQuerySchema } from './events.schemas.js';

describe('listEventsQuerySchema', () => {
  it('applies default pagination', () => {
    const parsed = listEventsQuerySchema.parse({ query: {} });

    expect(parsed.query).toEqual({ page: 1, limit: 20 });
  });

  it('coerces numeric strings', () => {
    const parsed = listEventsQuerySchema.parse({ query: { page: '3', limit: '50' } });

    expect(parsed.query).toEqual({ page: 3, limit: 50 });
  });

  it('rejects a limit above the maximum', () => {
    expect(() => listEventsQuerySchema.parse({ query: { limit: '51' } })).toThrow();
  });

  it('rejects a page below one', () => {
    expect(() => listEventsQuerySchema.parse({ query: { page: '0' } })).toThrow();
  });

  it('rejects non numeric values', () => {
    expect(() => listEventsQuerySchema.parse({ query: { page: 'abc' } })).toThrow();
  });

  it('rejects unknown query parameters', () => {
    expect(() => listEventsQuerySchema.parse({ query: { sort: 'name' } })).toThrow();
  });
});
