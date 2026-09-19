import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { AlertType } from '../../src/generated/prisma/enums.js';
import { instantOffset, logStep, requireEntry, seedId } from './helpers.js';
import type { SeedActivity } from './activities.seed.js';
import type { SeedProgram } from './programs.seed.js';
import type { SeedUser } from './users.seed.js';

type AlertTarget =
  { type: 'activity'; activityKey: string } | { type: 'additionalProgram'; programKey: string };

interface AlertCatalogEntry {
  key: string;
  type: AlertType;
  recipientKey: string;
  target: AlertTarget;
  isRead: boolean;
  offsetDays: number;
}

export const PROGRAM_ALERTS: readonly AlertCatalogEntry[] = [
  {
    key: 'activity-cancelled-fic',
    type: 'ACTIVITY_CANCELLED',
    recipientKey: 'org-fic',
    target: { type: 'activity', activityKey: 'fic-charla-cancelada' },
    isRead: false,
    offsetDays: -6,
  },
  {
    key: 'activity-updated-fisc',
    type: 'ACTIVITY_UPDATED',
    recipientKey: 'editor',
    target: { type: 'activity', activityKey: 'fisc-charla-ia' },
    isRead: true,
    offsetDays: -2,
  },
  {
    key: 'program-updated-cit',
    type: 'PROGRAM_UPDATED',
    recipientKey: 'admin',
    target: { type: 'additionalProgram', programKey: 'congreso-cit' },
    isRead: true,
    offsetDays: -5,
  },
  {
    key: 'program-archived-ipe',
    type: 'PROGRAM_ARCHIVED',
    recipientKey: 'org-sub-ipe',
    target: { type: 'additionalProgram', programKey: 'foro-ipe' },
    isRead: true,
    offsetDays: -310,
  },
];

export const seedProgramAlerts = async (
  prisma: PrismaClient,
  input: {
    users: Map<string, SeedUser>;
    activities: Map<string, SeedActivity>;
    additionalPrograms: Map<string, SeedProgram>;
  },
  now: Date = new Date(),
): Promise<number> => {
  logStep('Sembrando alertas de programas y actividades...');

  for (const alert of PROGRAM_ALERTS) {
    const recipient = requireEntry(input.users, alert.recipientKey, 'usuario destinatario');
    const createdAt = instantOffset(alert.offsetDays, 8, 0, now);

    const target =
      alert.target.type === 'activity'
        ? {
            activityId: requireEntry(input.activities, alert.target.activityKey, 'actividad').id,
            eventProgramId: null,
          }
        : {
            activityId: null,
            eventProgramId: requireEntry(
              input.additionalPrograms,
              alert.target.programKey,
              'programa adicional',
            ).id,
          };

    await prisma.alert.upsert({
      where: { id: seedId('alert', 'program', alert.key) },
      update: { isRead: alert.isRead, recipientId: recipient.id, ...target },
      create: {
        id: seedId('alert', 'program', alert.key),
        type: alert.type,
        isRead: alert.isRead,
        recipientId: recipient.id,
        createdAt,
        ...target,
      },
    });
  }

  return PROGRAM_ALERTS.length;
};
