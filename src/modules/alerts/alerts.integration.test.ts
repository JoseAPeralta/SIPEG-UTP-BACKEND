import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../../generated/prisma/client.js';
import { resolveAuditTestDatabaseUrl } from '../audit/audit.test-support.js';
import { createAlert } from './alerts.service.js';

const databaseUrl = resolveAuditTestDatabaseUrl();
const suite = databaseUrl ? describe : describe.skip;

let counter = 0;
const uniqueToken = (prefix: string): string => `${prefix}${Date.now()}${counter++}`;

suite('alerts transaction integration', () => {
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

  it('rolls back the domain mutation when the alert insert fails', async () => {
    const suffix = uniqueToken('rollback');
    const email = `${suffix}@example.test`;

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.user.create({
          data: {
            name: `Alerts IT ${suffix}`,
            firstName: 'Alerts',
            lastName: 'Rollback',
            identificationNumber: suffix,
            email,
          },
        });

        await createAlert(tx, {
          recipientId: 'missing-recipient',
          type: 'ACTIVITY_CANCELLED',
          target: { kind: 'ACTIVITY', id: 'missing-activity' },
        });
      }),
    ).rejects.toThrow();

    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it('commits the alert together with the domain mutation', async () => {
    const suffix = uniqueToken('commit');
    const unitCode = uniqueToken('U');
    let unitId: string | undefined;
    let userId: string | undefined;
    let programId: string | undefined;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const unit = await tx.organizationalUnit.create({
          data: { name: `Alerts IT unit ${suffix}`, code: unitCode, type: 'FACULTY' },
          select: { id: true },
        });

        const user = await tx.user.create({
          data: {
            name: `Alerts IT ${suffix}`,
            firstName: 'Alerts',
            lastName: 'Commit',
            identificationNumber: suffix,
            email: `${suffix}@example.test`,
            globalRole: 'ADMIN',
          },
          select: { id: true },
        });

        const program = await tx.eventProgram.create({
          data: {
            name: `Alerts IT program ${suffix}`,
            organizationalUnitId: unit.id,
            createdById: user.id,
            startDate: new Date('2030-01-01T00:00:00.000Z'),
            endDate: new Date('2030-12-31T00:00:00.000Z'),
          },
          select: { id: true },
        });

        await createAlert(tx, {
          recipientId: user.id,
          type: 'PROGRAM_UPDATED',
          target: { kind: 'EVENT_PROGRAM', id: program.id },
        });

        return { unitId: unit.id, userId: user.id, programId: program.id };
      });

      unitId = result.unitId;
      userId = result.userId;
      programId = result.programId;

      const alert = await prisma.alert.findFirstOrThrow({
        where: { recipientId: userId, eventProgramId: programId },
      });

      expect(alert).toMatchObject({
        type: 'PROGRAM_UPDATED',
        isRead: false,
        proposalId: null,
        activityId: null,
        certificateId: null,
      });
      expect(alert.createdAt).toBeInstanceOf(Date);
    } finally {
      if (programId) {
        await prisma.$executeRaw`ALTER TABLE "event_programs" DISABLE TRIGGER "event_programs_prevent_delete"`;

        try {
          await prisma.alert.deleteMany({ where: { eventProgramId: programId } });
          await prisma.eventProgram.delete({ where: { id: programId } });
        } finally {
          await prisma.$executeRaw`ALTER TABLE "event_programs" ENABLE TRIGGER "event_programs_prevent_delete"`;
        }
      }

      if (userId) {
        await prisma.user.delete({ where: { id: userId } });
      }

      if (unitId) {
        await prisma.organizationalUnit.delete({ where: { id: unitId } });
      }
    }
  });
});
