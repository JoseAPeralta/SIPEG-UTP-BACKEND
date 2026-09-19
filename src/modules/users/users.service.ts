import { getPrismaClient } from '../../config/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import type { UpdateProfileInput, UserProfileResponse } from './users.types.js';

const profileSelect = {
  id: true,
  firstName: true,
  lastName: true,
  identificationNumber: true,
  email: true,
  globalRole: true,
  faculty: { select: { id: true, name: true, code: true } },
  career: { select: { id: true, name: true, code: true } },
} as const;

interface ProfileUpdateData {
  firstName?: string;
  lastName?: string;
  facultyId?: string;
  careerId?: string | null;
}

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
      facultyId: true,
      careerId: true,
      career: { select: { facultyId: true } },
    },
  });

  if (!currentUser) {
    throw new ApiError(404, 'User not found.');
  }

  const data: ProfileUpdateData = {};

  if (input.firstName !== undefined) {
    data.firstName = input.firstName;
  }

  if (input.lastName !== undefined) {
    data.lastName = input.lastName;
  }

  if (input.facultyId !== undefined) {
    const faculty = await prisma.faculty.findUnique({
      where: { id: input.facultyId },
      select: { id: true, isActive: true },
    });

    if (!faculty?.isActive) {
      throw new ApiError(400, 'Faculty is not available.');
    }

    data.facultyId = faculty.id;
  }

  if (input.careerId !== undefined) {
    const career = await prisma.career.findUnique({
      where: { id: input.careerId },
      select: { id: true, facultyId: true, isActive: true },
    });

    if (!career?.isActive) {
      throw new ApiError(400, 'Career is not available.');
    }

    const effectiveFacultyId = data.facultyId ?? currentUser.facultyId;

    if (effectiveFacultyId && career.facultyId !== effectiveFacultyId) {
      throw new ApiError(400, 'Career does not belong to the selected faculty.');
    }

    if (!effectiveFacultyId) {
      data.facultyId = career.facultyId;
    }

    data.careerId = career.id;
  } else if (data.facultyId !== undefined && currentUser.career?.facultyId !== data.facultyId) {
    data.careerId = null;
  }

  return prisma.user.update({
    where: { id: userId },
    data,
    select: profileSelect,
  });
};
