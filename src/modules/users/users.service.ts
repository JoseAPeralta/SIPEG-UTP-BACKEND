import { randomUUID } from 'node:crypto';

import { getPrismaClient } from '../../config/prisma.js';
import { auth } from '../../lib/auth.js';
import { hashPassword } from '../../lib/password.js';
import { ApiError } from '../../utils/ApiError.js';
import type { GlobalRole } from '../../generated/prisma/enums.js';
import type { ListUsersQuery } from './users.schemas.js';
import type {
  AdminUserResponse,
  CreateUserInput,
  PaginatedUsers,
  UpdateAdminUserInput,
  UpdateProfileInput,
  UserProfileResponse,
} from './users.types.js';

const profileSelect = {
  id: true,
  firstName: true,
  lastName: true,
  identificationNumber: true,
  email: true,
  globalRole: true,
  unit: { select: { id: true, name: true, code: true } },
  career: { select: { id: true, name: true, code: true } },
} as const;

const adminUserSelect = {
  id: true,
  firstName: true,
  lastName: true,
  identificationNumber: true,
  email: true,
  globalRole: true,
  isActive: true,
  unit: { select: { id: true, name: true, code: true } },
  career: { select: { id: true, name: true, code: true } },
} as const;

const OTROS_CAREER_CODE = 'OTROS';

interface AdminUserUpdateData {
  globalRole?: GlobalRole;
  isActive?: boolean;
  unitId?: string | null;
  careerId?: string | null;
}

interface OrganizationAssignment {
  unitId?: string | null;
  careerId?: string | null;
}

interface OrganizationContext {
  unitId: string | null;
  career: { unitId: string | null } | null;
}

interface OrganizationAssignmentInput {
  unitId?: string | null | undefined;
  careerId?: string | undefined;
}

const resolveOrganizationAssignment = async (
  prisma: ReturnType<typeof getPrismaClient>,
  input: OrganizationAssignmentInput,
  current: OrganizationContext | null,
): Promise<OrganizationAssignment> => {
  const data: OrganizationAssignment = {};

  if (input.unitId === null) {
    data.unitId = null;

    const otrosCareer = await prisma.career.findUnique({
      where: { code: OTROS_CAREER_CODE },
      select: { id: true },
    });

    if (!otrosCareer) {
      throw new ApiError(409, 'The global Otros career is not configured.');
    }

    if (input.careerId !== undefined && input.careerId !== otrosCareer.id) {
      throw new ApiError(
        400,
        'Only the Otros career is allowed when no organizational unit is selected.',
      );
    }

    data.careerId = otrosCareer.id;
    return data;
  }

  if (input.unitId !== undefined) {
    const unit = await prisma.organizationalUnit.findUnique({
      where: { id: input.unitId },
      select: { id: true, isActive: true },
    });

    if (!unit?.isActive) {
      throw new ApiError(400, 'Organizational unit is not available.');
    }

    data.unitId = unit.id;
  }

  if (input.careerId !== undefined) {
    const career = await prisma.career.findUnique({
      where: { id: input.careerId },
      select: { id: true, unitId: true },
    });

    if (!career) {
      throw new ApiError(400, 'Career not found.');
    }

    const effectiveUnitId = data.unitId ?? current?.unitId ?? null;

    if (career.unitId !== null && effectiveUnitId && career.unitId !== effectiveUnitId) {
      throw new ApiError(400, 'Career does not belong to the selected unit.');
    }

    if (career.unitId !== null && !effectiveUnitId) {
      data.unitId = career.unitId;
    }

    data.careerId = career.id;
  } else if (
    data.unitId !== undefined &&
    current?.career?.unitId != null &&
    current.career.unitId !== data.unitId
  ) {
    data.careerId = null;
  }

  return data;
};

export const getProfile = async (userId: string): Promise<UserProfileResponse> => {
  const prisma = getPrismaClient();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: profileSelect,
  });

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  return user;
};

export const updateProfile = async (
  userId: string,
  input: UpdateProfileInput,
): Promise<UserProfileResponse> => {
  const prisma = getPrismaClient();

  const currentUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      unitId: true,
      careerId: true,
      career: { select: { unitId: true } },
    },
  });

  if (!currentUser) {
    throw new ApiError(404, 'User not found.');
  }

  const organization = await resolveOrganizationAssignment(prisma, input, currentUser);
  const data: OrganizationAssignment & { firstName?: string; lastName?: string } = {
    ...organization,
  };

  if (input.firstName !== undefined) {
    data.firstName = input.firstName;
  }

  if (input.lastName !== undefined) {
    data.lastName = input.lastName;
  }

  return prisma.user.update({
    where: { id: userId },
    data,
    select: profileSelect,
  });
};

const sendAccountVerificationEmail = async (email: string): Promise<void> => {
  try {
    await auth.api.sendVerificationEmail({ body: { email } });
  } catch {
    console.error('Failed to send account verification email.');
  }
};

export const createUser = async (input: CreateUserInput): Promise<AdminUserResponse> => {
  const prisma = getPrismaClient();
  const email = input.email.trim().toLowerCase();

  const duplicateEmail = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (duplicateEmail) {
    throw new ApiError(409, 'Email is already registered.');
  }

  const duplicateIdentification = await prisma.user.findUnique({
    where: { identificationNumber: input.identificationNumber },
    select: { id: true },
  });
  if (duplicateIdentification) {
    throw new ApiError(409, 'Identification number is already registered.');
  }

  const organization = await resolveOrganizationAssignment(prisma, input, null);
  const passwordHash = await hashPassword(input.password);
  const name = `${input.firstName} ${input.lastName}`;

  let created: AdminUserResponse;

  try {
    created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name,
          firstName: input.firstName,
          lastName: input.lastName,
          identificationNumber: input.identificationNumber,
          email,
          emailVerified: false,
          globalRole: input.globalRole,
          isActive: input.isActive,
          unitId: organization.unitId ?? null,
          careerId: organization.careerId ?? null,
        },
        select: adminUserSelect,
      });

      await tx.account.create({
        data: {
          id: randomUUID(),
          accountId: user.id,
          providerId: 'credential',
          userId: user.id,
          password: passwordHash,
        },
      });

      return user;
    });
  } catch (error) {
    const [raceEmail, raceIdentification] = await Promise.all([
      prisma.user.findUnique({ where: { email }, select: { id: true } }),
      prisma.user.findUnique({
        where: { identificationNumber: input.identificationNumber },
        select: { id: true },
      }),
    ]);

    if (raceEmail) {
      throw new ApiError(409, 'Email is already registered.');
    }
    if (raceIdentification) {
      throw new ApiError(409, 'Identification number is already registered.');
    }

    throw error;
  }

  await sendAccountVerificationEmail(email);

  return created;
};

export const listUsers = async (query: ListUsersQuery): Promise<PaginatedUsers> => {
  const prisma = getPrismaClient();
  const where = {
    ...(query.globalRole ? { globalRole: query.globalRole } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    ...(query.unitId ? { unitId: query.unitId } : {}),
    ...(query.careerId ? { careerId: query.careerId } : {}),
    ...(query.q
      ? {
          OR: [
            { firstName: { contains: query.q, mode: 'insensitive' as const } },
            { lastName: { contains: query.q, mode: 'insensitive' as const } },
            { email: { contains: query.q, mode: 'insensitive' as const } },
            { identificationNumber: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
  const skip = (query.page - 1) * query.limit;

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
      skip,
      take: query.limit,
      select: adminUserSelect,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    items,
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  };
};

export const getUserById = async (userId: string): Promise<AdminUserResponse> => {
  const prisma = getPrismaClient();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: adminUserSelect,
  });

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  return user;
};

export const updateAdminUser = async (
  actorUserId: string,
  targetUserId: string,
  input: UpdateAdminUserInput,
): Promise<AdminUserResponse> => {
  const prisma = getPrismaClient();

  const currentUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      globalRole: true,
      isActive: true,
      unitId: true,
      career: { select: { unitId: true } },
    },
  });

  if (!currentUser) {
    throw new ApiError(404, 'User not found.');
  }

  if (actorUserId === targetUserId) {
    if (input.isActive === false) {
      throw new ApiError(409, 'You cannot deactivate your own account.');
    }

    if (input.globalRole !== undefined && input.globalRole !== currentUser.globalRole) {
      throw new ApiError(409, 'You cannot change your own role.');
    }
  }

  const data: AdminUserUpdateData = {};

  if (input.globalRole !== undefined) {
    data.globalRole = input.globalRole;
  }

  if (input.isActive !== undefined) {
    data.isActive = input.isActive;
  }

  Object.assign(data, await resolveOrganizationAssignment(prisma, input, currentUser));

  const removesActiveAdmin =
    currentUser.globalRole === 'ADMIN' &&
    currentUser.isActive &&
    ((input.globalRole !== undefined && input.globalRole !== 'ADMIN') || input.isActive === false);

  if (removesActiveAdmin) {
    const otherActiveAdmins = await prisma.user.count({
      where: { globalRole: 'ADMIN', isActive: true, id: { not: targetUserId } },
    });

    if (otherActiveAdmins === 0) {
      throw new ApiError(409, 'At least one active administrator is required.');
    }
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: targetUserId },
      data,
      select: adminUserSelect,
    });

    if (data.isActive === false) {
      await tx.session.deleteMany({ where: { userId: targetUserId } });
    }

    return updated;
  });
};
