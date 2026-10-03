import { getPrismaClient } from '../../config/prisma.js';
import type { PermissionGrantSource } from '../../generated/prisma/enums.js';
import { ApiError } from '../../utils/ApiError.js';
import type {
  AuthorizationScope,
  GrantEnvelope,
  OwnPermissions,
  OwnPermissionsScope,
  PermissionOrigin,
  PermissionProvenance,
  ResolvedScope,
} from './authorization.types.js';
import { PERMISSION_NAMES, type PermissionName } from './permissions.js';

interface GrantRecord {
  validFrom: Date | null;
  validUntil: Date | null;
  permission: { name: string };
}

export interface ScopedGrantRecord extends GrantRecord {
  eventProgramId: string | null;
  activityId: string | null;
  source?: PermissionGrantSource;
}

export const isGrantActive = (
  grant: { validFrom: Date | null; validUntil: Date | null },
  now: Date,
): boolean => {
  if (grant.validFrom && grant.validFrom > now) {
    return false;
  }
  if (grant.validUntil && grant.validUntil <= now) {
    return false;
  }
  return true;
};

const mergeEnvelope = (current: GrantEnvelope, grant: GrantRecord): GrantEnvelope => {
  const validFrom =
    current.validFrom === null || grant.validFrom === null
      ? null
      : current.validFrom < grant.validFrom
        ? current.validFrom
        : grant.validFrom;

  const validUntil =
    current.validUntil === null || grant.validUntil === null
      ? null
      : current.validUntil > grant.validUntil
        ? current.validUntil
        : grant.validUntil;

  return { validFrom, validUntil };
};

export interface PermissionProvenanceEntry {
  envelope: GrantEnvelope;
  origin: PermissionOrigin;
  localSource?: PermissionGrantSource | undefined;
  inheritedSource?: PermissionGrantSource | undefined;
}

export const resolvePermissionEntries = (
  resolved: ResolvedScope,
  grants: readonly ScopedGrantRecord[],
  now: Date,
): Map<PermissionName, PermissionProvenanceEntry> => {
  const entries = new Map<PermissionName, PermissionProvenanceEntry>();

  for (const grant of grants) {
    if (!isGrantActive(grant, now)) {
      continue;
    }

    const name = grant.permission.name as PermissionName;
    if (!PERMISSION_NAMES.includes(name)) {
      continue;
    }

    const isLocal = !resolved.activityId || grant.activityId === resolved.activityId;
    const grantOrigin: PermissionOrigin = isLocal ? 'LOCAL' : 'INHERITED';
    const current = entries.get(name);
    const origin: PermissionOrigin = current
      ? current.origin === grantOrigin
        ? current.origin
        : 'BOTH'
      : grantOrigin;
    const localSource = isLocal && grant.source === 'OVERRIDE' ? 'OVERRIDE' : current?.localSource;
    const inheritedSource =
      !isLocal && grant.source === 'OVERRIDE' ? 'OVERRIDE' : current?.inheritedSource;

    entries.set(name, {
      envelope: current
        ? mergeEnvelope(current.envelope, grant)
        : { validFrom: grant.validFrom, validUntil: grant.validUntil },
      origin,
      localSource,
      inheritedSource,
    });
  }

  return entries;
};

export const resolveScope = async (scope: AuthorizationScope): Promise<ResolvedScope> => {
  if (scope.activityId) {
    const activity = await getPrismaClient().activity.findUnique({
      where: { id: scope.activityId },
      select: { eventProgramId: true },
    });

    if (!activity) {
      throw new ApiError(404, 'Activity not found.');
    }

    return { eventProgramId: activity.eventProgramId, activityId: scope.activityId };
  }

  if (scope.eventProgramId) {
    return { eventProgramId: scope.eventProgramId };
  }

  throw new ApiError(400, 'An activity or event program scope is required.');
};

export const getPermissionEnvelopes = async (
  user: Express.AuthenticatedUser,
  scope: AuthorizationScope,
  now: Date = new Date(),
): Promise<Map<PermissionName, GrantEnvelope>> => {
  const envelopes = new Map<PermissionName, GrantEnvelope>();

  if (user.globalRole === 'ADMIN') {
    for (const name of PERMISSION_NAMES) {
      envelopes.set(name, { validFrom: null, validUntil: null });
    }
    return envelopes;
  }

  const resolved = await resolveScope(scope);
  const collaborations = await getPrismaClient().collaboration.findMany({
    where: {
      userId: user.id,
      OR: [
        { eventProgramId: resolved.eventProgramId },
        ...(resolved.activityId ? [{ activityId: resolved.activityId }] : []),
      ],
    },
    select: {
      permissions: {
        select: {
          validFrom: true,
          validUntil: true,
          permission: { select: { name: true } },
        },
      },
    },
  });

  for (const collaboration of collaborations) {
    for (const grant of collaboration.permissions) {
      if (!isGrantActive(grant, now)) {
        continue;
      }

      const name = grant.permission.name as PermissionName;
      if (!PERMISSION_NAMES.includes(name)) {
        continue;
      }

      const current = envelopes.get(name);
      envelopes.set(
        name,
        current
          ? mergeEnvelope(current, grant)
          : {
              validFrom: grant.validFrom,
              validUntil: grant.validUntil,
            },
      );
    }
  }

  return envelopes;
};

export const getPermissionProvenance = async (
  user: Express.AuthenticatedUser,
  scope: AuthorizationScope,
  now: Date = new Date(),
): Promise<Map<PermissionName, PermissionProvenance>> => {
  const provenance = new Map<PermissionName, PermissionProvenance>();

  if (user.globalRole === 'ADMIN') {
    for (const name of PERMISSION_NAMES) {
      provenance.set(name, { envelope: { validFrom: null, validUntil: null }, origin: 'LOCAL' });
    }
    return provenance;
  }

  const resolved = await resolveScope(scope);
  const collaborations = await getPrismaClient().collaboration.findMany({
    where: {
      userId: user.id,
      OR: [
        { eventProgramId: resolved.eventProgramId },
        ...(resolved.activityId ? [{ activityId: resolved.activityId }] : []),
      ],
    },
    select: {
      eventProgramId: true,
      activityId: true,
      permissions: {
        select: {
          validFrom: true,
          validUntil: true,
          permission: { select: { name: true } },
        },
      },
    },
  });

  const grants: ScopedGrantRecord[] = collaborations.flatMap((collaboration) =>
    collaboration.permissions.map((row) => ({
      validFrom: row.validFrom,
      validUntil: row.validUntil,
      permission: row.permission,
      eventProgramId: collaboration.eventProgramId,
      activityId: collaboration.activityId,
    })),
  );

  return resolvePermissionEntries(resolved, grants, now);
};

export const getEffectivePermissions = async (
  user: Express.AuthenticatedUser,
  scope: AuthorizationScope,
  now: Date = new Date(),
): Promise<Set<PermissionName>> => {
  const envelopes = await getPermissionEnvelopes(user, scope, now);
  return new Set(envelopes.keys());
};

export const hasPermission = async (
  user: Express.AuthenticatedUser,
  permission: PermissionName,
  scope: AuthorizationScope,
  now: Date = new Date(),
): Promise<boolean> => {
  const permissions = await getEffectivePermissions(user, scope, now);
  return permissions.has(permission);
};

export const listOwnPermissions = async (
  user: Express.AuthenticatedUser,
  scope: OwnPermissionsScope,
  now: Date = new Date(),
): Promise<OwnPermissions> => {
  const authorizationScope: AuthorizationScope =
    scope.type === 'activity' ? { activityId: scope.id } : { eventProgramId: scope.id };

  const resolved = await resolveScope(authorizationScope);

  if (!resolved.activityId) {
    const program = await getPrismaClient().eventProgram.findUnique({
      where: { id: resolved.eventProgramId },
      select: { id: true },
    });

    if (!program) {
      throw new ApiError(404, 'Event program not found.');
    }
  }

  const provenance = await getPermissionProvenance(user, authorizationScope, now);

  return {
    scope: { type: scope.type, id: scope.id },
    permissions: [...provenance.entries()]
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([name, entry]) => ({
        name,
        origin: entry.origin,
        validFrom: entry.envelope.validFrom ? entry.envelope.validFrom.toISOString() : null,
        validUntil: entry.envelope.validUntil ? entry.envelope.validUntil.toISOString() : null,
      })),
  };
};
