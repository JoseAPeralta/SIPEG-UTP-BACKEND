import { getPrismaClient } from '../../config/prisma.js';
import type {
  CollaborationRole,
  PermissionGrantSource,
  ProgramStatus,
} from '../../generated/prisma/enums.js';
import { ApiError } from '../../utils/ApiError.js';
import { getPermissionEnvelopes, resolveScope } from './authorization.service.js';
import type {
  AuthorizationScope,
  CollaboratorDetail,
  CollaboratorList,
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

const collaboratorSelect = {
  userId: true,
  role: true,
  createdAt: true,
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

  const records = await getPrismaClient().collaboration.findMany({
    where: scopeWhere(resolved),
    orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
    select: collaboratorSelect,
  });

  return { items: records.map(toCollaboratorDetail) };
};

export const addCollaborator = async (
  actor: Express.AuthenticatedUser,
  scope: AuthorizationScope,
  targetUserId: string,
  role: CollaborationRole,
  now: Date = new Date(),
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

  const created = await prisma.$transaction((tx) =>
    tx.collaboration.create({
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
    }),
  );

  return toCollaboratorDetail(created);
};

export const updateCollaboratorRole = async (
  actor: Express.AuthenticatedUser,
  scope: AuthorizationScope,
  targetUserId: string,
  role: CollaborationRole,
  now: Date = new Date(),
): Promise<void> => {
  const envelopes = await assertActorCanDelegate(actor, scope, now);
  assertRoleWithinEnvelopes(role, envelopes);

  const resolved = await resolveScope(scope);
  const prisma = getPrismaClient();

  const collaboration = await prisma.collaboration.findFirst({
    where: { userId: targetUserId, ...scopeWhere(resolved) },
    select: { id: true },
  });

  if (!collaboration) {
    throw new ApiError(404, 'Collaborator not found.');
  }

  const permissionIds = await loadPermissionIds(ROLE_DEFAULTS[role]);

  await prisma.$transaction(async (tx) => {
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
  });
};

export const removeCollaborator = async (
  actor: Express.AuthenticatedUser,
  scope: AuthorizationScope,
  targetUserId: string,
  now: Date = new Date(),
): Promise<void> => {
  const envelopes = await assertActorCanDelegate(actor, scope, now);
  const resolved = await resolveScope(scope);
  const prisma = getPrismaClient();

  const collaboration = await prisma.collaboration.findFirst({
    where: { userId: targetUserId, ...scopeWhere(resolved) },
    select: {
      id: true,
      permissions: { select: { permission: { select: { name: true } } } },
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

  await prisma.collaboration.delete({ where: { id: collaboration.id } });
};

export const grantPermission = async (
  actor: Express.AuthenticatedUser,
  scope: AuthorizationScope,
  targetUserId: string,
  permission: PermissionName,
  window: GrantWindowInput = {},
  now: Date = new Date(),
): Promise<void> => {
  const envelopes = await assertActorCanDelegate(actor, scope, now);
  const validFrom = window.validFrom ?? null;
  const validUntil = window.validUntil ?? null;

  assertWindowValid(validFrom, validUntil);
  assertWindowWithinEnvelope(envelopes.get(permission), validFrom, validUntil);

  const resolved = await resolveScope(scope);
  const prisma = getPrismaClient();

  const collaboration = await prisma.collaboration.findFirst({
    where: { userId: targetUserId, ...scopeWhere(resolved) },
    select: { id: true },
  });

  if (!collaboration) {
    throw new ApiError(404, 'Collaborator not found.');
  }

  const permissionId = await loadPermissionId(permission);

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
};

export const revokePermission = async (
  actor: Express.AuthenticatedUser,
  scope: AuthorizationScope,
  targetUserId: string,
  permission: PermissionName,
  now: Date = new Date(),
): Promise<void> => {
  const envelopes = await assertActorCanDelegate(actor, scope, now);

  if (!envelopes.has(permission)) {
    throw new ApiError(403, 'Cannot revoke permissions you do not hold.');
  }

  const resolved = await resolveScope(scope);
  const prisma = getPrismaClient();

  const collaboration = await prisma.collaboration.findFirst({
    where: { userId: targetUserId, ...scopeWhere(resolved) },
    select: { id: true },
  });

  if (!collaboration) {
    throw new ApiError(404, 'Collaborator not found.');
  }

  const permissionId = await loadPermissionId(permission);

  const result = await prisma.collaborationPermission.deleteMany({
    where: { collaborationId: collaboration.id, permissionId },
  });

  if (result.count === 0) {
    throw new ApiError(404, 'Permission grant not found.');
  }
};
