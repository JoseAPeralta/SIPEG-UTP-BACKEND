import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../../generated/prisma/client.js';
import { writeAuditEvent } from './audit.service.js';
import { resolveAuditTestDatabaseUrl } from './audit.test-support.js';
import type { AuditAction, AuditEventInput } from './audit.types.js';

const databaseUrl = resolveAuditTestDatabaseUrl();
const suite = databaseUrl ? describe : describe.skip;

const baseEvent = (overrides: Partial<AuditEventInput> = {}): AuditEventInput => ({
  action: 'authorization.collaborator_added',
  actorId: 'actor-001',
  resourceType: 'collaboration',
  resourceId: 'collab-001',
  scopeType: 'event_program',
  scopeId: 'program-001',
  targetUserId: 'user-001',
  requestId: 'request-001',
  ...overrides,
});

let sequence = 0;
const uniqueName = (prefix: string): string => `${prefix}-${Date.now()}-${sequence++}`;

suite('audit_events append-only integration', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', databaseUrl as string);
    vi.resetModules();

    const { getPrismaClient } = await import('../../config/prisma.js');
    prisma = getPrismaClient();
  });

  afterAll(async () => {
    if (!prisma) {
      return;
    }

    const { disconnectPrisma } = await import('../../config/prisma.js');
    await disconnectPrisma();
    vi.unstubAllEnvs();
  });

  const writeEvent = (tx: unknown, overrides: Partial<AuditEventInput> = {}) =>
    writeAuditEvent(tx as never, baseEvent(overrides));

  it('commits the mutation and the audit event in the same transaction', async () => {
    const name = uniqueName('audit-commit');

    const permission = await prisma.$transaction(async (tx) => {
      const created = await tx.permission.create({
        data: { name, description: 'audit integration permission' },
        select: { id: true, name: true },
      });

      await writeEvent(tx, {
        action: 'authorization.permission_granted',
        resourceType: 'collaboration_permission',
        resourceId: created.id,
        changes: { after: { permission: name, validFrom: null, validUntil: null } },
      });

      return created;
    });

    const events = await prisma.auditEvent.findMany({
      where: { requestId: 'request-001', resourceId: permission.id },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'authorization.permission_granted',
      actorId: 'actor-001',
      resourceType: 'collaboration_permission',
    });

    await prisma.permission.delete({ where: { id: permission.id } });
  });

  it('rolls back the mutation when the audit insert fails at the database level', async () => {
    const name = uniqueName('audit-db-failure');

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.permission.create({ data: { name } });
        await writeEvent(tx, { action: 'x'.repeat(200) as AuditAction });
      }),
    ).rejects.toThrow();

    expect(await prisma.permission.findUnique({ where: { name } })).toBeNull();
  });

  it('rolls back the mutation when the writer rejects the payload', async () => {
    const name = uniqueName('audit-payload-rejection');

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.permission.create({ data: { name } });
        await writeEvent(tx, {
          action: 'user.role_changed',
          resourceType: 'user',
          changes: { after: { identificationNumber: '8-123-4567' } },
        });
      }),
    ).rejects.toThrow();

    expect(await prisma.permission.findUnique({ where: { name } })).toBeNull();
  });

  it('rejects UPDATE on audit_events', async () => {
    await writeEvent(prisma);

    const target = await prisma.auditEvent.findFirstOrThrow({
      where: { requestId: 'request-001' },
      orderBy: { occurredAt: 'desc' },
    });

    await expect(
      prisma.$executeRaw`UPDATE "audit_events" SET "action" = 'tampered' WHERE "id" = ${target.id}`,
    ).rejects.toThrow(/append-only/);

    const stored = await prisma.auditEvent.findUnique({ where: { id: target.id } });
    expect(stored?.action).toBe('authorization.collaborator_added');
  });

  it('rejects DELETE on audit_events and keeps the row', async () => {
    await writeEvent(prisma);

    const target = await prisma.auditEvent.findFirstOrThrow({
      where: { requestId: 'request-001' },
      orderBy: { occurredAt: 'desc' },
    });

    await expect(
      prisma.$executeRaw`DELETE FROM "audit_events" WHERE "id" = ${target.id}`,
    ).rejects.toThrow(/append-only/);

    expect(await prisma.auditEvent.findUnique({ where: { id: target.id } })).not.toBeNull();
  });

  it('rejects TRUNCATE on audit_events', async () => {
    await writeEvent(prisma);

    await expect(prisma.$executeRawUnsafe('TRUNCATE TABLE "audit_events"')).rejects.toThrow(
      /append-only/,
    );
  });

  it('keeps the audit event after the referenced resource is deleted', async () => {
    const name = uniqueName('audit-durability');

    const permission = await prisma.$transaction(async (tx) => {
      const created = await tx.permission.create({ data: { name }, select: { id: true } });
      await writeEvent(tx, {
        action: 'authorization.permission_granted',
        resourceType: 'collaboration_permission',
        resourceId: created.id,
      });
      return created;
    });

    await prisma.permission.delete({ where: { id: permission.id } });

    const event = await prisma.auditEvent.findFirst({
      where: { resourceId: permission.id, resourceType: 'collaboration_permission' },
    });

    expect(event).not.toBeNull();
    expect(event?.resourceId).toBe(permission.id);
  });
});
