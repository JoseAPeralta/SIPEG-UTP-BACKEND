import { getPrismaClient } from '../../config/prisma.js';
import type { PermissionGrantSource } from '../../generated/prisma/enums.js';
import { ApiError } from '../../utils/ApiError.js';
import { resolveActivityStatus } from '../activities/activities.status.js';
import type {
  AuthorizationScope,
  GrantEnvelope,
  ListUserScopesQuery,
  OwnPermissionEnvelope,
  OwnPermissions,
  OwnPermissionsScope,
  PaginatedUserScopes,
  PermissionOrigin,
  PermissionProvenance,
  ResolvedScope,
  UserScopeItem,
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

const compareByNameThenId = (
  first: { name: string; id: string },
  second: { name: string; id: string },
): number => {
  if (first.name !== second.name) {
    return first.name < second.name ? -1 : 1;
  }
  if (first.id !== second.id) {
    return first.id < second.id ? -1 : 1;
  }
  return 0;
};

const toOwnPermissions = (
  entries: Map<PermissionName, PermissionProvenanceEntry>,
): OwnPermissionEnvelope[] =>
  [...entries.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([name, entry]) => ({
      name,
      origin: entry.origin,
      validFrom: entry.envelope.validFrom ? entry.envelope.validFrom.toISOString() : null,
      validUntil: entry.envelope.validUntil ? entry.envelope.validUntil.toISOString() : null,
    }));

interface ScopeCandidate {
  type: 'program' | 'activity';
  id: string;
  name: string;
}

const paginateScopeCandidates = <TCandidate extends ScopeCandidate>(
  candidates: TCandidate[],
  page: number,
  limit: number,
): { items: TCandidate[]; total: number; totalPages: number } => {
  const sorted = [...candidates].sort(compareByNameThenId);
  const skip = (page - 1) * limit;
  const total = sorted.length;

  return {
    items: sorted.slice(skip, skip + limit),
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
};

const listCollaborationScopes = async (
  user: Express.AuthenticatedUser,
  now: Date,
): Promise<UserScopeItem[]> => {
  const collaborations = await getPrismaClient().collaboration.findMany({
    where: { userId: user.id },
    select: {
      eventProgramId: true,
      activityId: true,
      eventProgram: {
        select: {
          id: true,
          name: true,
          label: true,
          status: true,
          organizationalUnit: { select: { id: true, name: true, type: true } },
        },
      },
      activity: {
        select: {
          id: true,
          name: true,
          status: true,
          date: true,
          startTime: true,
          endTime: true,
          eventProgram: {
            select: {
              id: true,
              name: true,
              label: true,
              status: true,
              organizationalUnit: { select: { id: true, name: true, type: true } },
            },
          },
        },
      },
      permissions: {
        select: {
          validFrom: true,
          validUntil: true,
          permission: { select: { name: true } },
        },
      },
    },
  });

  const programGrants = new Map<string, ScopedGrantRecord[]>();
  const activityGrants = new Map<string, ScopedGrantRecord[]>();

  for (const collaboration of collaborations) {
    const grants: ScopedGrantRecord[] = collaboration.permissions.map((row) => ({
      validFrom: row.validFrom,
      validUntil: row.validUntil,
      permission: row.permission,
      eventProgramId: collaboration.eventProgramId,
      activityId: collaboration.activityId,
    }));

    if (collaboration.eventProgramId) {
      const current = programGrants.get(collaboration.eventProgramId) ?? [];
      programGrants.set(collaboration.eventProgramId, [...current, ...grants]);
    }

    if (collaboration.activityId) {
      const current = activityGrants.get(collaboration.activityId) ?? [];
      activityGrants.set(collaboration.activityId, [...current, ...grants]);
    }
  }

  const items: UserScopeItem[] = [];

  for (const [programId, grants] of programGrants) {
    const program = collaborations.find(
      (collaboration) => collaboration.eventProgramId === programId,
    )?.eventProgram;

    if (!program) {
      continue;
    }

    const entries = resolvePermissionEntries({ eventProgramId: programId }, grants, now);

    if (entries.size === 0) {
      continue;
    }

    items.push({
      type: 'program',
      id: program.id,
      name: program.name,
      status: program.status,
      eventProgram: null,
      organizationalUnit: program.organizationalUnit,
      permissions: toOwnPermissions(entries),
    });
  }

  for (const [activityId, grants] of activityGrants) {
    const activity = collaborations.find(
      (collaboration) => collaboration.activityId === activityId,
    )?.activity;

    if (!activity) {
      continue;
    }

    const inheritedGrants = programGrants.get(activity.eventProgram.id) ?? [];
    const entries = resolvePermissionEntries(
      { eventProgramId: activity.eventProgram.id, activityId },
      [...grants, ...inheritedGrants],
      now,
    );

    if (entries.size === 0) {
      continue;
    }

    items.push({
      type: 'activity',
      id: activity.id,
      name: activity.name,
      status: resolveActivityStatus(activity, now),
      eventProgram: {
        id: activity.eventProgram.id,
        name: activity.eventProgram.name,
        label: activity.eventProgram.label,
        status: activity.eventProgram.status,
      },
      organizationalUnit: activity.eventProgram.organizationalUnit,
      permissions: toOwnPermissions(entries),
    });
  }

  return items;
};

const listAdminScopePage = async (
  query: ListUserScopesQuery,
  now: Date,
): Promise<PaginatedUserScopes> => {
  const prisma = getPrismaClient();
  const [programs, activities] = await Promise.all([
    query.type === 'activity'
      ? Promise.resolve([])
      : prisma.eventProgram.findMany({ select: { id: true, name: true } }),
    query.type === 'program'
      ? Promise.resolve([])
      : prisma.activity.findMany({ select: { id: true, name: true } }),
  ]);

  const candidates: ScopeCandidate[] = [
    ...programs.map((program) => ({
      type: 'program' as const,
      id: program.id,
      name: program.name,
    })),
    ...activities.map((activity) => ({
      type: 'activity' as const,
      id: activity.id,
      name: activity.name,
    })),
  ];
  const page = paginateScopeCandidates(candidates, query.page, query.limit);
  const programIds = page.items.filter((item) => item.type === 'program').map((item) => item.id);
  const activityIds = page.items.filter((item) => item.type === 'activity').map((item) => item.id);

  const [programRecords, activityRecords] = await Promise.all([
    programIds.length === 0
      ? Promise.resolve([])
      : prisma.eventProgram.findMany({
          where: { id: { in: programIds } },
          select: {
            id: true,
            name: true,
            status: true,
            organizationalUnit: { select: { id: true, name: true, type: true } },
          },
        }),
    activityIds.length === 0
      ? Promise.resolve([])
      : prisma.activity.findMany({
          where: { id: { in: activityIds } },
          select: {
            id: true,
            name: true,
            status: true,
            date: true,
            startTime: true,
            endTime: true,
            eventProgram: {
              select: {
                id: true,
                name: true,
                label: true,
                status: true,
                organizationalUnit: { select: { id: true, name: true, type: true } },
              },
            },
          },
        }),
  ]);

  const programById = new Map(programRecords.map((record) => [record.id, record]));
  const activityById = new Map(activityRecords.map((record) => [record.id, record]));
  const permissions: OwnPermissionEnvelope[] = [...PERMISSION_NAMES]
    .sort((first, second) => first.localeCompare(second))
    .map((name) => ({ name, origin: 'LOCAL', validFrom: null, validUntil: null }));

  const items = page.items.flatMap((candidate): UserScopeItem[] => {
    if (candidate.type === 'program') {
      const record = programById.get(candidate.id);

      if (!record) {
        return [];
      }

      return [
        {
          type: 'program',
          id: record.id,
          name: record.name,
          status: record.status,
          eventProgram: null,
          organizationalUnit: record.organizationalUnit,
          permissions,
        },
      ];
    }

    const record = activityById.get(candidate.id);

    if (!record) {
      return [];
    }

    return [
      {
        type: 'activity',
        id: record.id,
        name: record.name,
        status: resolveActivityStatus(record, now),
        eventProgram: {
          id: record.eventProgram.id,
          name: record.eventProgram.name,
          label: record.eventProgram.label,
          status: record.eventProgram.status,
        },
        organizationalUnit: record.eventProgram.organizationalUnit,
        permissions,
      },
    ];
  });

  return {
    items,
    page: query.page,
    limit: query.limit,
    total: page.total,
    totalPages: page.totalPages,
  };
};

export const listUserScopes = async (
  user: Express.AuthenticatedUser,
  query: ListUserScopesQuery,
  now: Date = new Date(),
): Promise<PaginatedUserScopes> => {
  if (user.globalRole === 'ADMIN') {
    return listAdminScopePage(query, now);
  }

  const items = await listCollaborationScopes(user, now);
  const filtered = query.type ? items.filter((item) => item.type === query.type) : items;
  const page = paginateScopeCandidates(filtered, query.page, query.limit);

  return {
    items: page.items,
    page: query.page,
    limit: query.limit,
    total: page.total,
    totalPages: page.totalPages,
  };
};
