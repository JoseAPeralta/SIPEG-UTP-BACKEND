import { describe, expect, it } from 'vitest';

import { toAuditContext } from './audit-context.js';

describe('toAuditContext', () => {
  it('builds a USER context from an authenticated request', () => {
    expect(
      toAuditContext({
        id: 'request-001',
        user: {
          id: 'actor-001',
          email: 'actor@example.com',
          globalRole: 'USER',
          unitId: null,
          careerId: null,
          isActive: true,
        },
      }),
    ).toEqual({ actorId: 'actor-001', actorType: 'USER', requestId: 'request-001' });
  });

  it('builds an ANONYMOUS context when the request has no user', () => {
    expect(toAuditContext({ id: 'request-002' })).toEqual({
      actorType: 'ANONYMOUS',
      requestId: 'request-002',
    });
  });

  it('omits the request id when the request has none', () => {
    const context = toAuditContext({
      user: {
        id: 'actor-002',
        email: 'actor@example.com',
        globalRole: 'ADMIN',
        unitId: null,
        careerId: null,
        isActive: true,
      },
    });

    expect(context).toEqual({ actorId: 'actor-002', actorType: 'USER' });
    expect(context.requestId).toBeUndefined();
  });

  it('never leaks the actor email or role into the audit context', () => {
    const context = toAuditContext({
      id: 'request-003',
      user: {
        id: 'actor-003',
        email: 'secret@example.com',
        globalRole: 'ADMIN',
        unitId: 'unit-1',
        careerId: 'career-1',
        isActive: true,
      },
    });

    expect(Object.keys(context).sort()).toEqual(['actorId', 'actorType', 'requestId']);
  });
});
