import { getPrismaClient } from '../../config/prisma.js';
import type { ActivityStatus } from '../../generated/prisma/enums.js';
import { ApiError } from '../../utils/ApiError.js';
import { getInstitutionalDayOfWeek } from '../../utils/date.js';

export const RESERVING_STATUSES: ActivityStatus[] = ['SCHEDULED', 'ONGOING'];

export interface ActivityScheduleInput {
  activityId?: string | null;
  classroomId: string;
  date: Date;
  startTime: Date;
  endTime: Date;
  maxCapacity: number | null;
}

export const assertActivityTimeRange = (startTime: Date, endTime: Date): void => {
  if (endTime <= startTime) {
    throw new ApiError(400, 'End time must be after start time.');
  }
};

const loadAssignableClassroom = async (
  classroomId: string,
): Promise<{ id: string; isActive: boolean; capacity: number }> => {
  const prisma = getPrismaClient();

  const classroom = await prisma.classroom.findUnique({
    where: { id: classroomId },
    select: { id: true, isActive: true, capacity: true },
  });

  if (!classroom) {
    throw new ApiError(404, 'Classroom not found.');
  }
  if (!classroom.isActive) {
    throw new ApiError(400, 'Classroom is not active.');
  }

  return classroom;
};

export const assertClassroomIsAssignable = async (classroomId: string): Promise<void> => {
  await loadAssignableClassroom(classroomId);
};

export const assertActivityScheduleIsAvailable = async (
  input: ActivityScheduleInput,
): Promise<void> => {
  const prisma = getPrismaClient();
  const classroom = await loadAssignableClassroom(input.classroomId);

  if (input.maxCapacity !== null && classroom.capacity < input.maxCapacity) {
    throw new ApiError(400, 'Classroom capacity is below the activity capacity.');
  }

  const dateKey = input.date.toISOString().slice(0, 10);

  const window = await prisma.classroomAvailability.findFirst({
    where: {
      classroomId: input.classroomId,
      dayOfWeek: getInstitutionalDayOfWeek(dateKey),
      startTime: { lte: input.startTime },
      endTime: { gte: input.endTime },
    },
    select: { id: true },
  });

  if (!window) {
    throw new ApiError(409, 'Classroom is not available in the requested time window.');
  }

  const overlapping = await prisma.activity.findFirst({
    where: {
      ...(input.activityId ? { id: { not: input.activityId } } : {}),
      classroomId: input.classroomId,
      date: input.date,
      status: { in: [...RESERVING_STATUSES] },
      startTime: { lt: input.endTime },
      endTime: { gt: input.startTime },
    },
    select: { id: true },
  });

  if (overlapping) {
    throw new ApiError(409, 'Classroom is already reserved for an overlapping activity.');
  }
};

export const isExclusionViolation = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown; meta?: { code?: unknown } };

  return (
    candidate.code === '23P01' ||
    candidate.meta?.code === '23P01' ||
    (typeof candidate.message === 'string' &&
      candidate.message.includes('activities_classroom_no_overlap'))
  );
};
