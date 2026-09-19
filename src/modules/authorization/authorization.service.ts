import { getPrismaClient } from '../../config/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import type {
  AuthorizationScope,
  GrantEnvelope,
  ResolvedScope,
} from './authorization.types.js';
import { PERMISSION_NAMES, type PermissionName } from './permissions.js';

interface GrantRecord {
  validFrom: Date | null;
  validUntil: Date | null;
  permission: { name: string };
}

const isGrantActive = (grant: GrantRecord, now: Date): boolean => {
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
      envelopes.set(name, current ? mergeEnvelope(current, grant) : {
        validFrom: grant.validFrom,
        validUntil: grant.validUntil,
      });
    }
  }

  return envelopes;
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
