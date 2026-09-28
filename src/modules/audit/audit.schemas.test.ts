import { describe, expect, it } from 'vitest';

import { auditEventPageSchema, listAuditEventsQuerySchema } from './audit.schemas.js';

describe('listAuditEventsQuerySchema', () => {
  it('applies the pagination default without forcing any filter', () => {
    expect(listAuditEventsQuerySchema.parse({ query: {} })).toEqual({ query: { limit: 20 } });
  });

  it('coerces and validates the limit bound', () => {
    expect(listAuditEventsQuerySchema.parse({ query: { limit: '100' } })).toEqual({
      query: { limit: 100 },
    });
    expect(() => listAuditEventsQuerySchema.parse({ query: { limit: '101' } })).toThrow();
    expect(() => listAuditEventsQuerySchema.parse({ query: { limit: '0' } })).toThrow();
    expect(() => listAuditEventsQuerySchema.parse({ query: { limit: '1.5' } })).toThrow();
    expect(() => listAuditEventsQuerySchema.parse({ query: { limit: 'many' } })).toThrow();
  });

  it('trims the id filters', () => {
    expect(
      listAuditEventsQuerySchema.parse({
        query: { actorId: ' user-001 ', resourceId: ' activity-001 ', scopeId: ' program-001 ' },
      }),
    ).toEqual({
      query: {
        limit: 20,
        actorId: 'user-001',
        resourceId: 'activity-001',
        scopeId: 'program-001',
      },
    });
  });

  it('rejects empty, oversized and unknown query keys', () => {
    expect(() => listAuditEventsQuerySchema.parse({ query: { actorId: '' } })).toThrow();
    expect(() => listAuditEventsQuerySchema.parse({ query: { actorId: '   ' } })).toThrow();
    expect(() =>
      listAuditEventsQuerySchema.parse({ query: { resourceId: 'a'.repeat(101) } }),
    ).toThrow();
    expect(() =>
      listAuditEventsQuerySchema.parse({ query: { scopeId: 'a'.repeat(101) } }),
    ).toThrow();
    expect(() => listAuditEventsQuerySchema.parse({ query: { unknown: 'x' } })).toThrow();
  });

  it('accepts the catalog enum filters', () => {
    expect(
      listAuditEventsQuerySchema.parse({
        query: {
          action: 'authorization.permission_granted',
          resourceType: 'collaboration_permission',
          scopeType: 'activity',
        },
      }),
    ).toEqual({
      query: {
        limit: 20,
        action: 'authorization.permission_granted',
        resourceType: 'collaboration_permission',
        scopeType: 'activity',
      },
    });
  });

  it('rejects enum filters outside the catalog', () => {
    expect(() => listAuditEventsQuerySchema.parse({ query: { action: 'user.unknown' } })).toThrow();
    expect(() =>
      listAuditEventsQuerySchema.parse({ query: { resourceType: 'invoice' } }),
    ).toThrow();
    expect(() => listAuditEventsQuerySchema.parse({ query: { scopeType: 'program' } })).toThrow();
  });

  it('parses the instant window into dates', () => {
    const parsed = listAuditEventsQuerySchema.parse({
      query: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-30T23:59:59-05:00' },
    });

    expect(parsed.query.from).toEqual(new Date('2026-09-01T00:00:00.000Z'));
    expect(parsed.query.to).toEqual(new Date('2026-09-30T23:59:59-05:00'));
  });

  it('rejects a malformed or inverted instant window', () => {
    expect(() => listAuditEventsQuerySchema.parse({ query: { from: '2026-09-01' } })).toThrow();
    expect(() => listAuditEventsQuerySchema.parse({ query: { to: 'not-a-date' } })).toThrow();
    expect(() =>
      listAuditEventsQuerySchema.parse({
        query: { from: '2026-09-30T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
      }),
    ).toThrow();
  });

  it('accepts an opaque cursor and rejects empty or oversized ones', () => {
    expect(
      listAuditEventsQuerySchema.parse({
        query: { cursor: '  eyJ0IjoiMjAyNi0wOS0xMVQwMDowMDowMFoi  ' },
      }),
    ).toEqual({ query: { limit: 20, cursor: 'eyJ0IjoiMjAyNi0wOS0xMVQwMDowMDowMFoi' } });
    expect(() => listAuditEventsQuerySchema.parse({ query: { cursor: '   ' } })).toThrow();
    expect(() =>
      listAuditEventsQuerySchema.parse({ query: { cursor: 'a'.repeat(201) } }),
    ).toThrow();
  });

  it('reports the inverted window on the to field', () => {
    const result = listAuditEventsQuerySchema.safeParse({
      query: { from: '2026-09-30T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['query', 'to']);
  });
});

describe('auditEventPageSchema', () => {
  it('accepts a page without a next cursor', () => {
    const parsed = auditEventPageSchema.parse({
      items: [],
      limit: 20,
      hasMore: false,
      nextCursor: null,
    });

    expect(parsed).toEqual({ items: [], limit: 20, hasMore: false, nextCursor: null });
  });

  it('accepts a fully populated event with null optional columns', () => {
    const parsed = auditEventPageSchema.parse({
      limit: 1,
      hasMore: true,
      nextCursor: 'cursor',
      items: [
        {
          id: 'audit-001',
          action: 'user.role_changed',
          occurredAt: '2026-09-27T18:00:00.000Z',
          actorType: 'USER',
          actorId: 'user-001',
          resourceType: 'user',
          resourceId: 'user-002',
          scopeType: null,
          scopeId: null,
          targetUserId: 'user-002',
          requestId: 'request-001',
          changes: { before: { globalRole: 'USER' }, after: { globalRole: 'ADMIN' } },
          metadata: { changedFields: ['globalRole'] },
        },
      ],
    });

    expect(parsed.items[0]?.occurredAt).toBe('2026-09-27T18:00:00.000Z');
    expect(parsed.items[0]?.changes?.after).toEqual({ globalRole: 'ADMIN' });
    expect(parsed.items[0]?.scopeId).toBeNull();
  });

  it('rejects nested objects inside the payload', () => {
    const result = auditEventPageSchema.safeParse({
      limit: 1,
      hasMore: false,
      nextCursor: null,
      items: [
        {
          id: 'audit-001',
          action: 'user.role_changed',
          occurredAt: '2026-09-27T18:00:00.000Z',
          actorType: 'USER',
          actorId: null,
          resourceType: 'user',
          resourceId: null,
          scopeType: null,
          scopeId: null,
          targetUserId: null,
          requestId: null,
          changes: { after: { nested: { deep: true } } },
          metadata: null,
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});
