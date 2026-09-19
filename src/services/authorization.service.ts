import { getPrismaClient } from '../config/prisma.js';
import type { CollaborationRole, GlobalRole } from '../generated/prisma/enums.js';

export interface AuthorizationUser {
  id: string;
  globalRole: GlobalRole;
}

export interface ResourceAccess {
  role: CollaborationRole;
  permissions: string[];
  inheritedPermissions: string[];
  localPermissions: string[];
  source: 'admin' | 'program' | 'inherited' | 'local';
}

const collaborationRoleRank: Record<CollaborationRole, number> = {
  VIEWER: 1,
  EDITOR: 2,
  ORGANIZER: 3,
};

const permissionSelection = {
  permissions: {
    select: {
      permission: {
        select: { name: true },
      },
    },
  },
} as const;

const buildAdminAccess = (): ResourceAccess => {
  return {
    role: 'ORGANIZER',
    permissions: [],
    inheritedPermissions: [],
    localPermissions: [],
    source: 'admin',
  };
};

const toPermissionNames = (permissions: { permission: { name: string } }[]): string[] => {
  return permissions.map(({ permission }) => permission.name);
};

export const hasRequiredRole = (
  role: CollaborationRole,
  requiredRole: CollaborationRole,
): boolean => {
  return collaborationRoleRank[role] >= collaborationRoleRank[requiredRole];
};

export const resolveProgramAccess = async (
  user: AuthorizationUser,
  eventProgramId: string,
): Promise<ResourceAccess | null> => {
  if (user.globalRole === 'ADMIN') {
    return buildAdminAccess();
  }

  const prisma = getPrismaClient();
  const collaborator = await prisma.collaboration.findFirst({
    where: { eventProgramId, userId: user.id },
    select: {
      role: true,
      ...permissionSelection,
    },
  });

  if (!collaborator) {
    return null;
  }

  const permissions = toPermissionNames(collaborator.permissions);

  return {
    role: collaborator.role,
    permissions,
    inheritedPermissions: [],
    localPermissions: permissions,
    source: 'program',
  };
};

export const resolveActivityAccess = async (
  user: AuthorizationUser,
  activityId: string,
): Promise<ResourceAccess | null> => {
  if (user.globalRole === 'ADMIN') {
    return buildAdminAccess();
  }

  const prisma = getPrismaClient();
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    select: {
      collaborations: {
        where: { userId: user.id },
        select: {
          role: true,
          ...permissionSelection,
        },
      },
      eventProgram: {
        select: {
          collaborations: {
            where: { userId: user.id },
            select: {
              role: true,
              ...permissionSelection,
            },
          },
        },
      },
    },
  });

  if (!activity) {
    return null;
  }

  const localCollaborator = activity.collaborations[0];
  const inheritedCollaborator = activity.eventProgram.collaborations[0];

  if (!localCollaborator && !inheritedCollaborator) {
    return null;
  }

  const localPermissions = localCollaborator
    ? toPermissionNames(localCollaborator.permissions)
    : [];
  const inheritedPermissions = inheritedCollaborator
    ? toPermissionNames(inheritedCollaborator.permissions)
    : [];

  return {
    role: localCollaborator?.role ?? inheritedCollaborator?.role ?? 'VIEWER',
    permissions: [...new Set([...inheritedPermissions, ...localPermissions])],
    inheritedPermissions,
    localPermissions,
    source: localCollaborator ? 'local' : 'inherited',
  };
};
