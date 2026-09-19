import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { CollaborationRole } from '../../src/generated/prisma/enums.js';
import {
  PERMISSIONS,
  ROLE_DEFAULTS,
  type PermissionName,
} from '../../src/modules/authorization/permissions.js';
import { logStep, requireEntry, seedId } from './helpers.js';
import type { OrganizationCatalog } from './organizations.seed.js';
import type { SeedProgram } from './programs.seed.js';
import type { SeedActivity } from './activities.seed.js';
import type { SeedUser } from './users.seed.js';

type ScopeRef =
  | { type: 'unit'; unitKey: string }
  | { type: 'additional'; programKey: string }
  | { type: 'activity'; activityKey: string };

interface ProgramCollaborationCatalogEntry {
  scope: ScopeRef;
  userKey: string;
  role: CollaborationRole;
}

interface OverrideCatalogEntry {
  scope: ScopeRef;
  userKey: string;
  permission: PermissionName;
  validFromOffsetDays: number | null;
  validUntilOffsetDays: number | null;
}

const role = (scope: ScopeRef, userKey: string, collaborationRole: CollaborationRole) => ({
  scope,
  userKey,
  role: collaborationRole,
});

export const PROGRAM_COLLABORATIONS: readonly ProgramCollaborationCatalogEntry[] = [
  role({ type: 'unit', unitKey: 'fic' }, 'org-fic', 'ORGANIZER'),
  role({ type: 'unit', unitKey: 'fie' }, 'org-fie', 'ORGANIZER'),
  role({ type: 'unit', unitKey: 'fii' }, 'org-fii', 'ORGANIZER'),
  role({ type: 'unit', unitKey: 'fim' }, 'org-fim', 'ORGANIZER'),
  role({ type: 'unit', unitKey: 'fisc' }, 'org-fisc', 'ORGANIZER'),
  role({ type: 'unit', unitKey: 'fct' }, 'org-fct', 'ORGANIZER'),
  role({ type: 'unit', unitKey: 'sub-acad' }, 'org-sub-acad', 'ORGANIZER'),
  role({ type: 'unit', unitKey: 'sub-admin' }, 'org-sub-admin', 'ORGANIZER'),
  role({ type: 'unit', unitKey: 'sub-vida' }, 'org-sub-vida', 'ORGANIZER'),
  role({ type: 'unit', unitKey: 'sub-ipe' }, 'org-sub-ipe', 'ORGANIZER'),
  role({ type: 'unit', unitKey: 'fisc' }, 'editor', 'EDITOR'),
  role({ type: 'unit', unitKey: 'fct' }, 'visor', 'VIEWER'),
  role({ type: 'additional', programKey: 'semana-ic' }, 'org-fic', 'ORGANIZER'),
  role({ type: 'additional', programKey: 'congreso-cit' }, 'org-fisc', 'ORGANIZER'),
  role({ type: 'additional', programKey: 'foro-ipe' }, 'org-sub-ipe', 'ORGANIZER'),
  role({ type: 'activity', activityKey: 'fisc-charla-ia' }, 'editor', 'EDITOR'),
];

export const OVERRIDE_GRANTS: readonly OverrideCatalogEntry[] = [
  {
    scope: { type: 'unit', unitKey: 'fisc' },
    userKey: 'editor',
    permission: PERMISSIONS.CERTIFICATE_GENERATE,
    validFromOffsetDays: -1,
    validUntilOffsetDays: 30,
  },
  {
    scope: { type: 'additional', programKey: 'congreso-cit' },
    userKey: 'org-fisc',
    permission: PERMISSIONS.PERMISSION_GRANT,
    validFromOffsetDays: 0,
    validUntilOffsetDays: 60,
  },
  {
    scope: { type: 'unit', unitKey: 'fct' },
    userKey: 'visor',
    permission: PERMISSIONS.REPORT_EXPORT,
    validFromOffsetDays: -30,
    validUntilOffsetDays: -1,
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;

const windowFrom = (offsetDays: number | null, now: Date): Date | null =>
  offsetDays === null ? null : new Date(now.getTime() + offsetDays * DAY_MS);

const resolveScope = (
  scope: ScopeRef,
  input: {
    catalog: OrganizationCatalog;
    additionalPrograms: Map<string, SeedProgram>;
    activities: Map<string, SeedActivity>;
  },
): { id: string; eventProgramId: string | null; activityId: string | null; key: string } => {
  if (scope.type === 'unit') {
    const unit = requireEntry(input.catalog.units, scope.unitKey, 'unidad organizativa');
    return {
      id: unit.programId,
      eventProgramId: unit.programId,
      activityId: null,
      key: `unit_${scope.unitKey}`,
    };
  }

  if (scope.type === 'additional') {
    const program = requireEntry(input.additionalPrograms, scope.programKey, 'programa adicional');
    return {
      id: program.id,
      eventProgramId: program.id,
      activityId: null,
      key: `program_${scope.programKey}`,
    };
  }

  const activity = requireEntry(input.activities, scope.activityKey, 'actividad');
  return {
    id: activity.id,
    eventProgramId: null,
    activityId: activity.id,
    key: `activity_${scope.activityKey}`,
  };
};

export interface SeedCollaborationInput {
  catalog: OrganizationCatalog;
  users: Map<string, SeedUser>;
  additionalPrograms: Map<string, SeedProgram>;
  activities: Map<string, SeedActivity>;
  adminUserId: string;
}

export const seedCollaborations = async (
  prisma: PrismaClient,
  input: SeedCollaborationInput,
  now: Date = new Date(),
): Promise<void> => {
  logStep('Sembrando colaboraciones y permisos materializados...');

  const permissions = await prisma.permission.findMany({ select: { id: true, name: true } });
  const permissionIds = new Map(permissions.map((permission) => [permission.name, permission.id]));

  for (const entry of PROGRAM_COLLABORATIONS) {
    const scope = resolveScope(entry.scope, input);
    const user = requireEntry(input.users, entry.userKey, 'usuario');

    const existing = await prisma.collaboration.findFirst({
      where: {
        userId: user.id,
        ...(scope.activityId
          ? { activityId: scope.activityId }
          : { eventProgramId: scope.eventProgramId }),
      },
      select: { id: true },
    });

    const collaboration = existing
      ? await prisma.collaboration.update({
          where: { id: existing.id },
          data: { role: entry.role },
          select: { id: true },
        })
      : await prisma.collaboration.create({
          data: {
            id: seedId('collab', scope.key, entry.userKey),
            role: entry.role,
            eventProgramId: scope.eventProgramId,
            activityId: scope.activityId,
            userId: user.id,
          },
          select: { id: true },
        });

    await prisma.collaborationPermission.deleteMany({
      where: { collaborationId: collaboration.id, source: 'ROLE_DEFAULT' },
    });

    await prisma.collaborationPermission.createMany({
      data: ROLE_DEFAULTS[entry.role].map((name) => ({
        collaborationId: collaboration.id,
        permissionId: requireEntry(permissionIds, name, 'permiso'),
        source: 'ROLE_DEFAULT' as const,
        grantedById: input.adminUserId,
      })),
      skipDuplicates: true,
    });
  }

  logStep('Sembrando concesiones OVERRIDE con ventanas de vigencia...');
  for (const entry of OVERRIDE_GRANTS) {
    const scope = resolveScope(entry.scope, input);
    const user = requireEntry(input.users, entry.userKey, 'usuario');

    const collaboration = await prisma.collaboration.findFirst({
      where: {
        userId: user.id,
        ...(scope.activityId
          ? { activityId: scope.activityId }
          : { eventProgramId: scope.eventProgramId }),
      },
      select: { id: true },
    });

    if (!collaboration) {
      throw new Error(
        `Seed catalog error: OVERRIDE requires a collaboration for user "${entry.userKey}" in "${scope.key}".`,
      );
    }

    const permissionId = requireEntry(permissionIds, entry.permission, 'permiso');
    const validFrom = windowFrom(entry.validFromOffsetDays, now);
    const validUntil = windowFrom(entry.validUntilOffsetDays, now);

    await prisma.collaborationPermission.upsert({
      where: {
        collaborationId_permissionId: {
          collaborationId: collaboration.id,
          permissionId,
        },
      },
      update: {
        source: 'OVERRIDE',
        validFrom,
        validUntil,
        grantedById: input.adminUserId,
      },
      create: {
        collaborationId: collaboration.id,
        permissionId,
        source: 'OVERRIDE',
        validFrom,
        validUntil,
        grantedById: input.adminUserId,
      },
    });
  }
};
