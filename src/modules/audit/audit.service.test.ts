import { describe, expect, it, vi } from 'vitest';

import { Prisma } from '../../generated/prisma/client.js';
import { ApiError } from '../../utils/ApiError.js';
import type { ListAuditEventsQuery } from './audit.schemas.js';
import { writeAuditEvent } from './audit.service.js';
import type { AuditAction } from './audit.types.js';

const createTx = () => ({
  auditEvent: { create: vi.fn().mockResolvedValue({ id: 'audit-001' }) },
});

const auditInput = (action: AuditAction = 'authorization.collaborator_added') => ({
  action,
  actorId: 'actor-001',
  resourceType: 'collaboration' as const,
  resourceId: 'collab-001',
  scopeType: 'event_program' as const,
  scopeId: 'program-001',
  targetUserId: 'user-002',
  requestId: 'request-001',
});

describe('writeAuditEvent', () => {
  it('inserts the expected event with actor, resource and changes', async () => {
    const tx = createTx();

    await writeAuditEvent(tx as never, {
      ...auditInput(),
      changes: { before: { role: 'VIEWER' }, after: { role: 'EDITOR' } },
    });

    expect(tx.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.auditEvent.create).toHaveBeenCalledWith({
      data: {
        action: 'authorization.collaborator_added',
        actorType: 'USER',
        actorId: 'actor-001',
        resourceType: 'collaboration',
        resourceId: 'collab-001',
        scopeType: 'event_program',
        scopeId: 'program-001',
        targetUserId: 'user-002',
        requestId: 'request-001',
        changes: { before: { role: 'VIEWER' }, after: { role: 'EDITOR' } },
        metadata: Prisma.DbNull,
      },
    });
  });

  it('falls back to the ambient log context request id when none is provided', async () => {
    const tx = createTx();
    const { runWithLogContext } = await import('../../lib/log-context.js');

    await runWithLogContext({ requestId: 'request-ambient' }, () =>
      writeAuditEvent(tx as never, {
        action: 'auth.password_changed',
        actorId: 'user-001',
        resourceType: 'user',
        resourceId: 'user-001',
        targetUserId: 'user-001',
      }),
    );

    expect(tx.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ requestId: 'request-ambient' }),
      }),
    );
  });

  it('keeps an explicit request id over the ambient one', async () => {
    const tx = createTx();
    const { runWithLogContext } = await import('../../lib/log-context.js');

    await runWithLogContext({ requestId: 'request-ambient' }, () =>
      writeAuditEvent(tx as never, auditInput()),
    );

    expect(tx.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ requestId: 'request-001' }),
      }),
    );
  });

  it('defaults actorType to ANONYMOUS when no actor is known', async () => {
    const tx = createTx();

    await writeAuditEvent(tx as never, {
      action: 'authorization.permission_revoked',
      resourceType: 'collaboration_permission',
      resourceId: 'collab-001',
    });

    expect(tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorType: 'ANONYMOUS', actorId: null }),
    });
  });

  it('writes system actions with actorType SYSTEM and no actor id', async () => {
    const tx = createTx();

    await writeAuditEvent(tx as never, {
      action: 'auth.other_sessions_revoked',
      actorType: 'SYSTEM',
      resourceType: 'user',
      resourceId: 'user-001',
      targetUserId: 'user-001',
    });

    expect(tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorType: 'SYSTEM' }),
    });
  });

  it('rejects unknown keys in changes before touching the database', async () => {
    const tx = createTx();

    await expect(
      writeAuditEvent(tx as never, {
        ...auditInput(),
        changes: { after: { firstName: 'Ada' } },
      }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('rejects unknown keys in metadata before touching the database', async () => {
    const tx = createTx();

    await expect(
      writeAuditEvent(tx as never, {
        ...auditInput(),
        metadata: { reason: 'because' },
      }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('rejects snapshot keys that look like secrets', async () => {
    const tx = createTx();

    await expect(
      writeAuditEvent(tx as never, {
        ...auditInput(),
        changes: { after: { passwordHash: 'argon2id$abc' } },
      }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('rejects values that look like secrets', async () => {
    const tx = createTx();

    await expect(
      writeAuditEvent(tx as never, {
        ...auditInput(),
        changes: { after: { role: 'EDITOR', unitId: 'ada@example.com' } },
      }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('rejects a token-like value inside a list', async () => {
    const tx = createTx();

    await expect(
      writeAuditEvent(tx as never, {
        ...auditInput(),
        changes: { after: { permissions: ['program:read', 'refreshToken=abc'] } },
      }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('rejects values containing an identification-number-like key', async () => {
    const tx = createTx();

    await expect(
      writeAuditEvent(tx as never, {
        ...auditInput(),
        changes: { after: { identificationNumber: '8-123-4567' } },
      }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('accepts allowed change keys with null, boolean and numeric values', async () => {
    const tx = createTx();

    await writeAuditEvent(tx as never, {
      ...auditInput(),
      changes: {
        before: { globalRole: 'USER', isActive: true, unitId: null, careerId: null },
        after: { globalRole: 'ADMIN', isActive: false, validFrom: null, validUntil: null },
      },
    });

    expect(tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('surfaces the database failure so the caller transaction rolls back', async () => {
    const tx = createTx();
    tx.auditEvent.create.mockRejectedValueOnce(new Error('append-only violation'));

    await expect(writeAuditEvent(tx as never, auditInput())).rejects.toThrow(
      'append-only violation',
    );
  });

  it('never calls the global prisma client', async () => {
    const getPrismaClient = vi.fn(() => {
      throw new Error('global prisma client must not be used by the audit writer');
    });
    const { runWithLogContext } = await import('../../lib/log-context.js');

    vi.doMock('../../config/prisma.js', () => ({ getPrismaClient }));

    const module = await import('./audit.service.js');
    const tx = createTx();

    await runWithLogContext({ requestId: 'request-001' }, () =>
      module.writeAuditEvent(tx as never, auditInput()),
    );

    expect(getPrismaClient).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).toHaveBeenCalledTimes(1);

    vi.doUnmock('../../config/prisma.js');
    vi.resetModules();
  });
});

describe('writeAuditEvent payload shape', () => {
  it('persists explicit nulls for absent optional columns', async () => {
    const tx = createTx();

    await writeAuditEvent(tx as never, {
      action: 'user.admin_created',
      actorId: 'actor-001',
      resourceType: 'user',
      resourceId: 'user-001',
    });

    const call = tx.auditEvent.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };

    expect(call.data).toMatchObject({
      actorType: 'USER',
      actorId: 'actor-001',
      resourceType: 'user',
      resourceId: 'user-001',
      scopeType: null,
      scopeId: null,
      targetUserId: null,
      changes: Prisma.DbNull,
      metadata: Prisma.DbNull,
    });
  });
});

interface AuditPrismaMock {
  auditEvent: {
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
}

const createAuditPrismaMock = (): AuditPrismaMock => ({
  auditEvent: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
});

const auditRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'audit-003',
  action: 'user.role_changed',
  occurredAt: new Date('2026-09-27T18:00:00.000Z'),
  actorType: 'USER',
  actorId: 'user-001',
  resourceType: 'user',
  resourceId: 'user-002',
  scopeType: null,
  scopeId: null,
  targetUserId: 'user-002',
  requestId: 'request-001',
  changes: { before: { globalRole: 'USER' }, after: { globalRole: 'ADMIN' } },
  metadata: null,
  ...overrides,
});

const auditQuery = (overrides: Partial<ListAuditEventsQuery> = {}): ListAuditEventsQuery => ({
  limit: 20,
  ...overrides,
});

const encodeCursorPayload = (payload: unknown): string =>
  Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

const decodeCursorPayload = (cursor: string): unknown =>
  JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));

const loadAuditService = async (prisma: AuditPrismaMock) => {
  vi.resetModules();
  vi.doMock('../../config/prisma.js', () => ({ getPrismaClient: () => prisma }));

  const service = await import('./audit.service.js');

  vi.doUnmock('../../config/prisma.js');
  vi.resetModules();

  return service;
};

describe('listAuditEvents', () => {
  it('returns the newest page first without a cursor when the page is complete', async () => {
    const prisma = createAuditPrismaMock();
    prisma.auditEvent.findMany.mockResolvedValue([auditRow(), auditRow({ id: 'audit-002' })]);
    const { listAuditEvents } = await loadAuditService(prisma);

    const page = await listAuditEvents(auditQuery());

    expect(page.items.map((item) => item.id)).toEqual(['audit-003', 'audit-002']);
    expect(page.limit).toBe(20);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: 21,
      }),
    );
  });

  it('projects the row into the response contract with an ISO instant', async () => {
    const prisma = createAuditPrismaMock();
    prisma.auditEvent.findMany.mockResolvedValue([
      auditRow({
        scopeType: 'activity',
        scopeId: 'activity-001',
        metadata: { changedFields: ['globalRole'] },
      }),
    ]);
    const { listAuditEvents } = await loadAuditService(prisma);

    const page = await listAuditEvents(auditQuery());

    expect(page.items[0]).toEqual({
      id: 'audit-003',
      action: 'user.role_changed',
      occurredAt: '2026-09-27T18:00:00.000Z',
      actorType: 'USER',
      actorId: 'user-001',
      resourceType: 'user',
      resourceId: 'user-002',
      scopeType: 'activity',
      scopeId: 'activity-001',
      targetUserId: 'user-002',
      requestId: 'request-001',
      changes: { before: { globalRole: 'USER' }, after: { globalRole: 'ADMIN' } },
      metadata: { changedFields: ['globalRole'] },
    });
  });

  it('selects only the audit contract columns', async () => {
    const prisma = createAuditPrismaMock();
    const { listAuditEvents } = await loadAuditService(prisma);

    await listAuditEvents(auditQuery());

    const call = prisma.auditEvent.findMany.mock.calls[0]?.[0] as {
      select: Record<string, boolean>;
    };

    expect(Object.keys(call.select).sort()).toEqual(
      [
        'action',
        'actorId',
        'actorType',
        'changes',
        'id',
        'metadata',
        'occurredAt',
        'requestId',
        'resourceId',
        'resourceType',
        'scopeId',
        'scopeType',
        'targetUserId',
      ].sort(),
    );
  });

  it('reads one extra row and returns the cursor of the last returned event', async () => {
    const prisma = createAuditPrismaMock();
    prisma.auditEvent.findMany.mockResolvedValue([
      auditRow(),
      auditRow({ id: 'audit-002', occurredAt: new Date('2026-09-27T17:00:00.000Z') }),
      auditRow({ id: 'audit-001', occurredAt: new Date('2026-09-27T16:00:00.000Z') }),
    ]);
    const { listAuditEvents } = await loadAuditService(prisma);

    const page = await listAuditEvents(auditQuery({ limit: 2 }));

    expect(page.items.map((item) => item.id)).toEqual(['audit-003', 'audit-002']);
    expect(page.hasMore).toBe(true);
    expect(decodeCursorPayload(page.nextCursor as string)).toEqual({
      t: '2026-09-27T17:00:00.000Z',
      i: 'audit-002',
    });
    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }));
  });

  it('applies every provided filter as an independent predicate', async () => {
    const prisma = createAuditPrismaMock();
    const { listAuditEvents } = await loadAuditService(prisma);

    await listAuditEvents(
      auditQuery({
        action: 'authorization.permission_granted',
        actorId: 'user-001',
        resourceType: 'collaboration_permission',
        resourceId: 'permission-001',
        scopeType: 'event_program',
        scopeId: 'program-001',
      }),
    );

    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { action: 'authorization.permission_granted' },
            { actorId: 'user-001' },
            { resourceType: 'collaboration_permission' },
            { resourceId: 'permission-001' },
            { scopeType: 'event_program' },
            { scopeId: 'program-001' },
          ],
        },
      }),
    );
  });

  it('bounds the instant window with only the provided side', async () => {
    const prisma = createAuditPrismaMock();
    const { listAuditEvents } = await loadAuditService(prisma);

    await listAuditEvents(auditQuery({ from: new Date('2026-09-01T00:00:00.000Z') }));
    await listAuditEvents(auditQuery({ to: new Date('2026-09-30T00:00:00.000Z') }));

    expect(prisma.auditEvent.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { AND: [{ occurredAt: { gte: new Date('2026-09-01T00:00:00.000Z') } }] },
      }),
    );
    expect(prisma.auditEvent.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { AND: [{ occurredAt: { lte: new Date('2026-09-30T00:00:00.000Z') } }] },
      }),
    );
  });

  it('translates the cursor into a keyset predicate on occurredAt and id', async () => {
    const prisma = createAuditPrismaMock();
    const { listAuditEvents } = await loadAuditService(prisma);
    const cursor = encodeCursorPayload({ t: '2026-09-27T17:00:00.000Z', i: 'audit-002' });

    await listAuditEvents(auditQuery({ cursor, action: 'user.role_changed' }));

    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { action: 'user.role_changed' },
            {
              OR: [
                { occurredAt: { lt: new Date('2026-09-27T17:00:00.000Z') } },
                {
                  occurredAt: new Date('2026-09-27T17:00:00.000Z'),
                  id: { lt: 'audit-002' },
                },
              ],
            },
          ],
        },
      }),
    );
  });

  it('rejects a malformed cursor before touching the database', async () => {
    const prisma = createAuditPrismaMock();
    const { listAuditEvents } = await loadAuditService(prisma);

    await expect(listAuditEvents(auditQuery({ cursor: 'not-a-cursor' }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Invalid cursor.',
    });
    expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
  });

  it('rejects a cursor with an unexpected payload shape', async () => {
    const prisma = createAuditPrismaMock();
    const { listAuditEvents } = await loadAuditService(prisma);

    await expect(
      listAuditEvents(auditQuery({ cursor: encodeCursorPayload({ t: '2026-09-27', i: 7 }) })),
    ).rejects.toThrow('Invalid cursor.');
    await expect(
      listAuditEvents(auditQuery({ cursor: encodeCursorPayload({ unexpected: true }) })),
    ).rejects.toThrow('Invalid cursor.');
    expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
  });

  it('returns an empty page without a cursor when nothing matches', async () => {
    const prisma = createAuditPrismaMock();
    const { listAuditEvents } = await loadAuditService(prisma);

    const page = await listAuditEvents(auditQuery({ limit: 1 }));

    expect(page).toEqual({ items: [], limit: 1, hasMore: false, nextCursor: null });
  });

  it('never writes an audit event while reading the log', async () => {
    const prisma = createAuditPrismaMock();
    const { listAuditEvents } = await loadAuditService(prisma);

    await listAuditEvents(auditQuery());

    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });
});
