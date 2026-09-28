import { getPrismaClient } from '../../config/prisma.js';
import type {
  CollaborationRole,
  PermissionGrantSource,
  ProgramStatus,
} from '../../generated/prisma/enums.js';
import { writeAuditEvent } from '../audit/audit.service.js';
import type { AuditContext } from '../audit/audit.types.js';
import { ApiError } from '../../utils/ApiError.js';
import {
  getPermissionEnvelopes,
  isGrantActive,
  resolvePermissionEntries,
  resolveScope,
  type ScopedGrantRecord,
} from './authorization.service.js';
import type {
  AuthorizationScope,
  CollaboratorDetail,
  CollaboratorList,
  CollaboratorListDetail,
  GrantEnvelope,
  ResolvedScope,
} from './authorization.types.js';
import {
  PERMISSIONS,
  PERMISSION_NAMES,
  ROLE_DEFAULTS,
  type PermissionName,
} from './permissions.js';

export interface GrantWindowInput {
  validFrom?: Date | null;
  validUntil?: Date | null;
}

const assertActorCanDelegate = async (
  actor: Express.AuthenticatedUser,
  scope: AuthorizationScope,
  now: Date,
): Promise<Map<PermissionName, GrantEnvelope>> => {
  const envelopes = await getPermissionEnvelopes(actor, scope, now);

  if (!envelopes.has(PERMISSIONS.PERMISSION_GRANT)) {
    throw new ApiError(403, 'Insufficient privileges to manage permissions.');
  }

  return envelopes;
};

const assertRoleWithinEnvelopes = (
  role: CollaborationRole,
  envelopes: Map<PermissionName, GrantEnvelope>,
): void => {
  for (const permission of ROLE_DEFAULTS[role]) {
    if (!envelopes.has(permission)) {
      throw new ApiError(403, 'Cannot assign a role that exceeds your own permissions.');
    }
  }
};

const assertWindowValid = (validFrom: Date | null, validUntil: Date | null): void => {
  if (validFrom && validUntil && validUntil <= validFrom) {
    throw new ApiError(400, 'validUntil must be greater than validFrom.');
  }
};

const assertWindowWithinEnvelope = (
  envelope: GrantEnvelope | undefined,
  validFrom: Date | null,
  validUntil: Date | null,
): void => {
  if (!envelope) {
    throw new ApiError(403, 'Cannot grant permissions you do not hold.');
  }

  if (envelope.validFrom && (!validFrom || validFrom < envelope.validFrom)) {
    throw new ApiError(403, 'Grant window starts before the delegator grant.');
  }

  if (envelope.validUntil && (!validUntil || validUntil > envelope.validUntil)) {
    throw new ApiError(403, 'Grant window exceeds the delegator grant.');
  }
};

const scopeWhere = (resolved: ResolvedScope) =>
  resolved.activityId
    ? { activityId: resolved.activityId }
    : { eventProgramId: resolved.eventProgramId };

const scopeType = (resolved: ResolvedScope): 'activity' | 'event_program' =>
  resolved.activityId ? 'activity' : 'event_program';

const scopeId = (resolved: ResolvedScope): string => resolved.activityId ?? resolved.eventProgramId;

const windowChanges = (
  validFrom: Date | null,
  validUntil: Date | null,
): { validFrom: string | null; validUntil: string | null } => ({
  validFrom: validFrom ? validFrom.toISOString() : null,
  validUntil: validUntil ? validUntil.toISOString() : null,
});

const collaboratorSelect = {
  id: true,
  userId: true,
  role: true,
  createdAt: true,
  eventProgramId: true,
  activityId: true,
  user: { select: { firstName: true, lastName: true, email: true } },
  permissions: {
    select: {
      source: true,
      validFrom: true,
      validUntil: true,
      permission: { select: { name: true } },
    },
  },
} as const;

interface CollaboratorRecord {
  userId: string;
  role: CollaborationRole;
  createdAt: Date;
  eventProgramId: string | null;
  activityId: string | null;
  user: { firstName: string; lastName: string; email: string };
  permissions: {
    source: PermissionGrantSource;
    validFrom: Date | null;
    validUntil: Date | null;
    permission: { name: string };
  }[];
}

const toCollaboratorDetail = (record: CollaboratorRecord): CollaboratorDetail => ({
  userId: record.userId,
  firstName: record.user.firstName,
  lastName: record.user.lastName,
  email: record.user.email,
  role: record.role,
  createdAt: record.createdAt.toISOString(),
  permissions: [...record.permissions]
    .filter((row) => PERMISSION_NAMES.includes(row.permission.name as PermissionName))
    .sort((first, second) => first.permission.name.localeCompare(second.permission.name))
    .map((row) => ({
      name: row.permission.name,
      source: row.source,
      validFrom: row.validFrom ? row.validFrom.toISOString() : null,
      validUntil: row.validUntil ? row.validUntil.toISOString() : null,
    })),
});

const toCollaboratorListDetail = (
  record: CollaboratorRecord,
  resolved: ResolvedScope,
  inherited: readonly ScopedGrantRecord[],
  now: Date,
): CollaboratorListDetail => {
  const localGrants: ScopedGrantRecord[] = record.permissions.map((row) => ({
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    permission: row.permission,
    eventProgramId: record.eventProgramId,
    activityId: record.activityId,
    source: row.source,
  }));

  const entries = resolvePermissionEntries(resolved, [...localGrants, ...inherited], now);

  return {
    userId: record.userId,
    firstName: record.user.firstName,
    lastName: record.user.lastName,
    email: record.user.email,
    role: record.role,
    createdAt: record.createdAt.toISOString(),
    permissions: [...entries.entries()]
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([name, entry]) => ({
        name,
        source:
          entry.origin === 'INHERITED'
            ? (entry.inheritedSource ?? entry.localSource ?? 'ROLE_DEFAULT')
            : (entry.localSource ?? entry.inheritedSource ?? 'ROLE_DEFAULT'),
        origin: entry.origin,
        validFrom: entry.envelope.validFrom ? entry.envelope.validFrom.toISOString() : null,
        validUntil: entry.envelope.validUntil ? entry.envelope.validUntil.toISOString() : null,
        effective: true,
      })),
  };
};

const collaboratorListSelect = {
  userId: true,
  eventProgramId: true,
  activityId: true,
  permissions: {
    select: {
      source: true,
      validFrom: true,
      validUntil: true,
      permission: { select: { name: true } },
    },
  },
} as const;

const loadScopeProgram = async (
  resolved: ResolvedScope,
): Promise<{ id: string; status: ProgramStatus }> => {
  const program = await getPrismaClient().eventProgram.findUnique({
    where: { id: resolved.eventProgramId },
    select: { id: true, status: true },
  });

  if (!program) {
    throw new ApiError(404, 'Event program not found.');
  }

  return program;
};

const loadPermissionIds = async (
  names: readonly PermissionName[],
): Promise<Map<string, string>> => {
  const records = await getPrismaClient().permission.findMany({
    where: { name: { in: [...names] } },
    select: { id: true, name: true },
  });

  const ids = new Map(records.map((record) => [record.name, record.id]));

  if (ids.size !== new Set(names).size) {
    throw new ApiError(500, 'Permission catalog is not synchronized.');
  }

  return ids;
};

const loadPermissionId = async (name: PermissionName): Promise<string> => {
  const record = await getPrismaClient().permission.findUnique({
    where: { name },
    select: { id: true },
  });

  if (!record) {
    throw new ApiError(404, 'Permission not found.');
  }

  return record.id;
};

export const listCollaborators = async (
  actor: Express.AuthenticatedUser,
  scope: AuthorizationScope,
  now: Date = new Date(),
): Promise<CollaboratorList> => {
  await assertActorCanDelegate(actor, scope, now);

  const resolved = await resolveScope(scope);
  await loadScopeProgram(resolved);

  const prisma = getPrismaClient();
  const scopeFilter = resolved.activityId
    ? { activityId: resolved.activityId }
    : { eventProgramId: resolved.eventProgramId };

  const [records, programRecords] = await Promise.all([
    prisma.collaboration.findMany({
      where: scopeFilter,
      orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
      select: collaboratorSelect,
    }),
    prisma.collaboration.findMany({
      where: { eventProgramId: resolved.eventProgramId },
      select: collaboratorListSelect,
    }),
  ]);

  const inheritedByUser = new Map<string, ScopedGrantRecord[]>();

  for (const collaboration of programRecords) {
    const grants = inheritedByUser.get(collaboration.userId) ?? [];

    for (const row of collaboration.permissions) {
      grants.push({
        validFrom: row.validFrom,
        validUntil: row.validUntil,
        permission: row.permission,
        eventProgramId: collaboration.eventProgramId,
        activityId: collaboration.activityId,
        source: row.source,
      });
    }

    inheritedByUser.set(collaboration.userId, grants);
  }

  return {
    items: records.map((record) =>
      toCollaboratorListDetail(record, resolved, inheritedByUser.get(record.userId) ?? [], now),
    ),
  };
};

export const addCollaborator = async (
  actor: Express.AuthenticatedUser,
  scope: AuthorizationScope,
  targetUserId: string,
  role: CollaborationRole,
  now: Date = new Date(),
  auditContext: AuditContext = {},
): Promise<CollaboratorDetail> => {
  const envelopes = await assertActorCanDelegate(actor, scope, now);
  assertRoleWithinEnvelopes(role, envelopes);

  const resolved = await resolveScope(scope);
  const program = await loadScopeProgram(resolved);

  if (program.status === 'ARCHIVED') {
    throw new ApiError(409, 'Archived event programs cannot be modified.');
  }

  const prisma = getPrismaClient();

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, isActive: true },
  });

  if (!target) {
    throw new ApiError(404, 'User not found.');
  }

  if (!target.isActive) {
    throw new ApiError(400, 'User is not active.');
  }

  const existing = await prisma.collaboration.findFirst({
    where: { userId: targetUserId, ...scopeWhere(resolved) },
    select: { id: true },
  });

  if (existing) {
    throw new ApiError(409, 'User already collaborates in this scope.');
  }

  const permissionIds = await loadPermissionIds(ROLE_DEFAULTS[role]);

  const created = await prisma.$transaction(async (tx) => {
    const collaboration = await tx.collaboration.create({
      data: {
        role,
        eventProgramId: resolved.activityId ? null : resolved.eventProgramId,
        activityId: resolved.activityId ?? null,
        userId: targetUserId,
        permissions: {
          create: ROLE_DEFAULTS[role].map((name) => ({
            permissionId: permissionIds.get(name) as string,
            source: 'ROLE_DEFAULT',
            grantedById: actor.id,
          })),
        },
      },
      select: collaboratorSelect,
    });

    await writeAuditEvent(tx, {
      action: 'authorization.collaborator_added',
      actorType: 'USER',
      actorId: actor.id,
      resourceType: 'collaboration',
      resourceId: collaboration.id,
      scopeType: scopeType(resolved),
      scopeId: scopeId(resolved),
      targetUserId,
      requestId: auditContext.requestId,
      changes: { after: { role, permissions: [...ROLE_DEFAULTS[role]] } },
    });

    return collaboration;
  });

  return toCollaboratorDetail(created);
};

export const updateCollaboratorRole = async (
  actor: Express.AuthenticatedUser,
  scope: AuthorizationScope,
  targetUserId: string,
  role: CollaborationRole,
  now: Date = new Date(),
  auditContext: AuditContext = {},
): Promise<CollaboratorDetail> => {
  const envelopes = await assertActorCanDelegate(actor, scope, now);
  assertRoleWithinEnvelopes(role, envelopes);

  const resolved = await resolveScope(scope);
  const program = await loadScopeProgram(resolved);

  if (program.status === 'ARCHIVED') {
    throw new ApiError(409, 'Archived event programs cannot be modified.');
  }

  const prisma = getPrismaClient();

  const collaboration = await prisma.collaboration.findFirst({
    where: { userId: targetUserId, ...scopeWhere(resolved) },
    select: {
      id: true,
      role: true,
      permissions: {
        where: { source: 'ROLE_DEFAULT' },
        select: { permission: { select: { name: true } } },
      },
    },
  });

  if (!collaboration) {
    throw new ApiError(404, 'Collaborator not found.');
  }

  const previousRole = collaboration.role;

  for (const row of collaboration.permissions) {
    if (!envelopes.has(row.permission.name as PermissionName)) {
      throw new ApiError(403, 'Cannot remove a collaborator with permissions you do not hold.');
    }
  }

  const permissionIds = await loadPermissionIds(ROLE_DEFAULTS[role]);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.collaboration.update({
      where: { id: collaboration.id },
      data: { role },
    });

    await tx.collaborationPermission.deleteMany({
      where: { collaborationId: collaboration.id, source: 'ROLE_DEFAULT' },
    });

    await tx.collaborationPermission.createMany({
      data: ROLE_DEFAULTS[role].map((name) => ({
        collaborationId: collaboration.id,
        permissionId: permissionIds.get(name) as string,
        source: 'ROLE_DEFAULT',
        grantedById: actor.id,
      })),
    });

    await writeAuditEvent(tx, {
      action: 'authorization.collaborator_role_changed',
      actorType: 'USER',
      actorId: actor.id,
      resourceType: 'collaboration',
      resourceId: collaboration.id,
      scopeType: scopeType(resolved),
      scopeId: scopeId(resolved),
      targetUserId,
      requestId: auditContext.requestId,
      changes: { before: { role: previousRole }, after: { role } },
    });

    return tx.collaboration.findUniqueOrThrow({
      where: { id: collaboration.id },
      select: collaboratorSelect,
    });
  });

  return toCollaboratorDetail(updated);
};

interface DelegableRecord {
  user: { globalRole: 'USER' | 'ADMIN'; isActive: boolean };
  permissions: {
    validFrom: Date | null;
    validUntil: Date | null;
    permission: { name: string };
  }[];
}

const canDelegate = (record: DelegableRecord, now: Date): boolean =>
  record.user.isActive &&
  (record.user.globalRole === 'ADMIN' ||
    record.permissions.some(
      (row) => row.permission.name === PERMISSIONS.PERMISSION_GRANT && isGrantActive(row, now),
    ));

const assertScopeKeepsDelegator = async (
  resolved: ResolvedScope,
  targetUserId: string,
  now: Date,
): Promise<void> => {
  const scopeFilter = resolved.activityId
    ? { OR: [{ activityId: resolved.activityId }, { eventProgramId: resolved.eventProgramId }] }
    : { eventProgramId: resolved.eventProgramId };

  const remaining = await getPrismaClient().collaboration.findMany({
    where: { ...scopeFilter, userId: { not: targetUserId } },
    select: {
      user: { select: { globalRole: true, isActive: true } },
      permissions: {
        where: { permission: { name: PERMISSIONS.PERMISSION_GRANT } },
        select: { validFrom: true, validUntil: true },
      },
    },
  });

  const hasDelegator = remaining.some(
    (item) =>
      item.user.isActive &&
      (item.user.globalRole === 'ADMIN' || item.permissions.some((row) => isGrantActive(row, now))),
  );

  if (!hasDelegator) {
    throw new ApiError(409, 'Cannot remove the last collaborator able to delegate in this scope.');
  }
};

export const removeCollaborator = async (
  actor: Express.AuthenticatedUser,
  scope: AuthorizationScope,
  targetUserId: string,
  now: Date = new Date(),
  auditContext: AuditContext = {},
): Promise<void> => {
  const envelopes = await assertActorCanDelegate(actor, scope, now);

  const resolved = await resolveScope(scope);
  const program = await loadScopeProgram(resolved);

  if (program.status === 'ARCHIVED') {
    throw new ApiError(409, 'Archived event programs cannot be modified.');
  }

  const prisma = getPrismaClient();

  const collaboration = await prisma.collaboration.findFirst({
    where: { userId: targetUserId, ...scopeWhere(resolved) },
    select: {
      id: true,
      role: true,
      user: { select: { globalRole: true, isActive: true } },
      permissions: {
        select: {
          validFrom: true,
          validUntil: true,
          permission: { select: { name: true } },
        },
      },
    },
  });

  if (!collaboration) {
    throw new ApiError(404, 'Collaborator not found.');
  }

  for (const row of collaboration.permissions) {
    if (!envelopes.has(row.permission.name as PermissionName)) {
      throw new ApiError(403, 'Cannot remove a collaborator with permissions you do not hold.');
    }
  }

  if (canDelegate(collaboration, now)) {
    await assertScopeKeepsDelegator(resolved, targetUserId, now);
  }

  const removedRole = collaboration.role;

  await prisma.$transaction(async (tx) => {
    await tx.collaboration.delete({ where: { id: collaboration.id } });

    await writeAuditEvent(tx, {
      action: 'authorization.collaborator_removed',
      actorType: 'USER',
      actorId: actor.id,
      resourceType: 'collaboration',
      resourceId: collaboration.id,
      scopeType: scopeType(resolved),
      scopeId: scopeId(resolved),
      targetUserId,
      requestId: auditContext.requestId,
      changes: { before: { role: removedRole } },
    });
  });
};

export const grantPermission = async (
  actor: Express.AuthenticatedUser,
  scope: AuthorizationScope,
  targetUserId: string,
  permission: PermissionName,
  window: GrantWindowInput = {},
  now: Date = new Date(),
  auditContext: AuditContext = {},
): Promise<CollaboratorDetail> => {
  const envelopes = await assertActorCanDelegate(actor, scope, now);
  const validFrom = window.validFrom ?? null;
  const validUntil = window.validUntil ?? null;

  assertWindowValid(validFrom, validUntil);
  assertWindowWithinEnvelope(envelopes.get(permission), validFrom, validUntil);

  const resolved = await resolveScope(scope);
  const program = await loadScopeProgram(resolved);

  if (program.status === 'ARCHIVED') {
    throw new ApiError(409, 'Archived event programs cannot be modified.');
  }

  const prisma = getPrismaClient();

  const collaboration = await prisma.collaboration.findFirst({
    where: { userId: targetUserId, ...scopeWhere(resolved) },
    select: { id: true },
  });

  if (!collaboration) {
    throw new ApiError(404, 'Collaborator not found.');
  }

  const permissionId = await loadPermissionId(permission);

  return prisma.$transaction(async (tx) => {
    const previousGrant = await tx.collaborationPermission.findUnique({
      where: {
        collaborationId_permissionId: {
          collaborationId: collaboration.id,
          permissionId,
        },
      },
      select: { source: true, validFrom: true, validUntil: true },
    });

    await tx.collaborationPermission.upsert({
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
        grantedById: actor.id,
        grantedAt: now,
      },
      create: {
        collaborationId: collaboration.id,
        permissionId,
        source: 'OVERRIDE',
        validFrom,
        validUntil,
        grantedById: actor.id,
        grantedAt: now,
      },
    });

    await writeAuditEvent(tx, {
      action: previousGrant
        ? 'authorization.permission_replaced'
        : 'authorization.permission_granted',
      actorType: 'USER',
      actorId: actor.id,
      resourceType: 'collaboration_permission',
      resourceId: collaboration.id,
      scopeType: scopeType(resolved),
      scopeId: scopeId(resolved),
      targetUserId,
      requestId: auditContext.requestId,
      changes: {
        ...(previousGrant
          ? {
              before: {
                permission,
                source: previousGrant.source,
                ...windowChanges(previousGrant.validFrom, previousGrant.validUntil),
              },
            }
          : {}),
        after: { permission, ...windowChanges(validFrom, validUntil) },
      },
    });

    const updated = await tx.collaboration.findUniqueOrThrow({
      where: { id: collaboration.id },
      select: collaboratorSelect,
    });

    return toCollaboratorDetail(updated);
  });
};

const assertRevokeKeepsDelegator = async (
  resolved: ResolvedScope,
  targetUserId: string,
  now: Date,
): Promise<void> => {
  const scopeFilter = resolved.activityId
    ? { OR: [{ activityId: resolved.activityId }, { eventProgramId: resolved.eventProgramId }] }
    : { eventProgramId: resolved.eventProgramId };

  const collaborations = await getPrismaClient().collaboration.findMany({
    where: scopeFilter,
    select: {
      userId: true,
      eventProgramId: true,
      activityId: true,
      user: { select: { globalRole: true, isActive: true } },
      permissions: {
        where: { permission: { name: PERMISSIONS.PERMISSION_GRANT } },
        select: {
          validFrom: true,
          validUntil: true,
          permission: { select: { name: true } },
        },
      },
    },
  });

  const isRevokedCollaboration = (record: {
    userId: string;
    eventProgramId: string | null;
    activityId: string | null;
  }): boolean =>
    record.userId === targetUserId &&
    (resolved.activityId
      ? record.activityId === resolved.activityId
      : record.eventProgramId === resolved.eventProgramId);

  const hasDelegator = collaborations.some(
    (record) => !isRevokedCollaboration(record) && canDelegate(record, now),
  );

  if (!hasDelegator) {
    throw new ApiError(409, 'Cannot revoke the last delegation permission in this scope.');
  }
};

export const revokePermission = async (
  actor: Express.AuthenticatedUser,
  scope: AuthorizationScope,
  targetUserId: string,
  permission: PermissionName,
  now: Date = new Date(),
  auditContext: AuditContext = {},
): Promise<void> => {
  const envelopes = await assertActorCanDelegate(actor, scope, now);

  if (!envelopes.has(permission)) {
    throw new ApiError(403, 'Cannot revoke permissions you do not hold.');
  }

  const resolved = await resolveScope(scope);
  const program = await loadScopeProgram(resolved);

  if (program.status === 'ARCHIVED') {
    throw new ApiError(409, 'Archived event programs cannot be modified.');
  }

  const prisma = getPrismaClient();
  const permissionId = await loadPermissionId(permission);

  const collaboration = await prisma.collaboration.findFirst({
    where: { userId: targetUserId, ...scopeWhere(resolved) },
    select: {
      id: true,
      user: { select: { globalRole: true, isActive: true } },
      permissions: {
        where: { permissionId },
        select: {
          validFrom: true,
          validUntil: true,
          permission: { select: { name: true } },
        },
      },
    },
  });

  if (!collaboration || collaboration.permissions.length === 0) {
    if (resolved.activityId) {
      const inherited = await prisma.collaboration.findFirst({
        where: { userId: targetUserId, eventProgramId: resolved.eventProgramId },
        select: {
          permissions: {
            where: { permissionId },
            select: { validFrom: true, validUntil: true },
          },
        },
      });

      if (inherited?.permissions.some((row) => isGrantActive(row, now))) {
        throw new ApiError(409, 'Cannot revoke a permission inherited from the event program.');
      }
    }

    if (!collaboration) {
      throw new ApiError(404, 'Collaborator not found.');
    }

    throw new ApiError(404, 'Permission grant not found.');
  }

  if (permission === PERMISSIONS.PERMISSION_GRANT && canDelegate(collaboration, now)) {
    await assertRevokeKeepsDelegator(resolved, targetUserId, now);
  }

  const revokedGrant = collaboration.permissions[0];

  if (!revokedGrant) {
    throw new ApiError(404, 'Permission grant not found.');
  }

  await prisma.$transaction(async (tx) => {
    const result = await tx.collaborationPermission.deleteMany({
      where: { collaborationId: collaboration.id, permissionId },
    });

    if (result.count === 0) {
      throw new ApiError(404, 'Permission grant not found.');
    }

    await writeAuditEvent(tx, {
      action: 'authorization.permission_revoked',
      actorType: 'USER',
      actorId: actor.id,
      resourceType: 'collaboration_permission',
      resourceId: collaboration.id,
      scopeType: scopeType(resolved),
      scopeId: scopeId(resolved),
      targetUserId,
      requestId: auditContext.requestId,
      changes: {
        before: {
          permission,
          ...windowChanges(revokedGrant.validFrom, revokedGrant.validUntil),
        },
      },
    });
  });
};
