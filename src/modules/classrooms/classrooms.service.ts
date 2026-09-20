import { getPrismaClient } from '../../config/prisma.js';
import type { ClassroomType } from '../../generated/prisma/enums.js';
import { ApiError } from '../../utils/ApiError.js';
import { getInstitutionalDayOfWeek } from '../../utils/date.js';
import type { AvailableClassroomsQuery, ListClassroomsQuery } from './classrooms.schemas.js';
import type {
  AddClassroomAvailabilityInput,
  ClassroomDetail,
  ClassroomSummary,
  CreateClassroomInput,
  PaginatedClassrooms,
  UpdateClassroomInput,
} from './classrooms.types.js';

const BLOCKING_ACTIVITY_STATUSES = ['SCHEDULED', 'ONGOING'] as const;

const classroomSummarySelect = {
  id: true,
  name: true,
  type: true,
  capacity: true,
  building: true,
  floor: true,
  isActive: true,
  amenities: { select: { amenity: true }, orderBy: { amenity: 'asc' as const } },
} as const;

const classroomDetailSelect = {
  ...classroomSummarySelect,
  availability: {
    select: { id: true, dayOfWeek: true, startTime: true, endTime: true, period: true },
    orderBy: [{ dayOfWeek: 'asc' as const }, { startTime: 'asc' as const }, { id: 'asc' as const }],
  },
};

interface ClassroomSummaryRecord {
  id: string;
  name: string;
  type: ClassroomType;
  capacity: number;
  building: string | null;
  floor: number | null;
  isActive: boolean;
  amenities: { amenity: string }[];
}

interface ClassroomDetailRecord extends ClassroomSummaryRecord {
  availability: {
    id: string;
    dayOfWeek: number;
    startTime: Date;
    endTime: Date;
    period: string | null;
  }[];
}

const formatTime = (value: Date): string => value.toISOString().slice(11, 16);

const toClassroomSummary = (record: ClassroomSummaryRecord): ClassroomSummary => ({
  id: record.id,
  name: record.name,
  type: record.type,
  capacity: record.capacity,
  building: record.building,
  floor: record.floor,
  isActive: record.isActive,
  amenities: record.amenities.map(({ amenity }) => amenity),
});

const toClassroomDetail = (record: ClassroomDetailRecord): ClassroomDetail => ({
  ...toClassroomSummary(record),
  availability: record.availability.map((slot) => ({
    id: slot.id,
    dayOfWeek: slot.dayOfWeek,
    startTime: formatTime(slot.startTime),
    endTime: formatTime(slot.endTime),
    period: slot.period,
  })),
});

const timeOfDay = (value: string): Date => new Date(`1970-01-01T${value}:00.000Z`);

const isUniqueConstraintViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === 'P2002';

const assertClassroomExists = async (id: string): Promise<void> => {
  const classroom = await getPrismaClient().classroom.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!classroom) {
    throw new ApiError(404, 'Classroom not found.');
  }
};

export const listClassrooms = async (query: ListClassroomsQuery): Promise<PaginatedClassrooms> => {
  const prisma = getPrismaClient();
  const where = {
    isActive: query.isActive ?? true,
    ...(query.type ? { type: query.type } : {}),
    ...(query.minCapacity ? { capacity: { gte: query.minCapacity } } : {}),
    ...(query.amenity
      ? {
          amenities: { some: { amenity: { equals: query.amenity, mode: 'insensitive' as const } } },
        }
      : {}),
  };
  const skip = (query.page - 1) * query.limit;

  const [items, total] = await Promise.all([
    prisma.classroom.findMany({
      where,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip,
      take: query.limit,
      select: classroomSummarySelect,
    }),
    prisma.classroom.count({ where }),
  ]);

  return {
    items: items.map((record) => toClassroomSummary(record)),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  };
};

export const getClassroomById = async (id: string): Promise<ClassroomDetail> => {
  const prisma = getPrismaClient();
  const record = await prisma.classroom.findUnique({
    where: { id },
    select: classroomDetailSelect,
  });

  if (!record) {
    throw new ApiError(404, 'Classroom not found.');
  }

  return toClassroomDetail(record);
};

export const createClassroom = async (input: CreateClassroomInput): Promise<ClassroomDetail> => {
  const prisma = getPrismaClient();
  const record = await prisma.classroom.create({
    data: {
      name: input.name,
      type: input.type,
      capacity: input.capacity,
      building: input.building ?? null,
      floor: input.floor ?? null,
      isActive: input.isActive ?? true,
    },
    select: classroomDetailSelect,
  });

  return toClassroomDetail(record);
};

export const updateClassroom = async (
  id: string,
  input: UpdateClassroomInput,
): Promise<ClassroomDetail> => {
  const prisma = getPrismaClient();
  await assertClassroomExists(id);

  if (input.isActive === false) {
    const blocking = await prisma.activity.findMany({
      where: { classroomId: id, status: { in: [...BLOCKING_ACTIVITY_STATUSES] } },
      select: { id: true },
      take: 1,
    });

    if (blocking.length > 0) {
      throw new ApiError(
        409,
        'Cannot deactivate a classroom with scheduled or ongoing activities.',
      );
    }
  }

  const record = await prisma.classroom.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
      ...(input.building !== undefined ? { building: input.building } : {}),
      ...(input.floor !== undefined ? { floor: input.floor } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
    select: classroomDetailSelect,
  });

  return toClassroomDetail(record);
};

export const addClassroomAmenity = async (
  classroomId: string,
  amenity: string,
): Promise<ClassroomDetail> => {
  const prisma = getPrismaClient();
  await assertClassroomExists(classroomId);

  const duplicate = await prisma.classroomAmenity.findFirst({
    where: { classroomId, amenity: { equals: amenity, mode: 'insensitive' } },
    select: { amenity: true },
  });

  if (duplicate) {
    throw new ApiError(409, 'Amenity already exists for this classroom.');
  }

  try {
    await prisma.classroomAmenity.create({ data: { classroomId, amenity } });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new ApiError(409, 'Amenity already exists for this classroom.');
    }
    throw error;
  }

  return getClassroomById(classroomId);
};

export const removeClassroomAmenity = async (
  classroomId: string,
  amenity: string,
): Promise<ClassroomDetail> => {
  const prisma = getPrismaClient();
  await assertClassroomExists(classroomId);

  const existing = await prisma.classroomAmenity.findFirst({
    where: { classroomId, amenity: { equals: amenity, mode: 'insensitive' } },
    select: { amenity: true },
  });

  if (!existing) {
    throw new ApiError(404, 'Amenity not found.');
  }

  await prisma.classroomAmenity.delete({
    where: { classroomId_amenity: { classroomId, amenity: existing.amenity } },
  });

  return getClassroomById(classroomId);
};

export const addClassroomAvailability = async (
  classroomId: string,
  input: AddClassroomAvailabilityInput,
): Promise<ClassroomDetail> => {
  const prisma = getPrismaClient();
  await assertClassroomExists(classroomId);

  const startTime = timeOfDay(input.startTime);
  const endTime = timeOfDay(input.endTime);

  const overlapping = await prisma.classroomAvailability.findFirst({
    where: {
      classroomId,
      dayOfWeek: input.dayOfWeek,
      startTime: { lt: endTime },
      endTime: { gt: startTime },
    },
    select: { id: true },
  });

  if (overlapping) {
    throw new ApiError(409, 'Classroom availability overlaps an existing window.');
  }

  try {
    await prisma.classroomAvailability.create({
      data: {
        classroomId,
        dayOfWeek: input.dayOfWeek,
        startTime,
        endTime,
        period: input.period ?? null,
      },
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new ApiError(409, 'Classroom availability overlaps an existing window.');
    }
    throw error;
  }

  return getClassroomById(classroomId);
};

export const removeClassroomAvailability = async (
  classroomId: string,
  availabilityId: string,
): Promise<ClassroomDetail> => {
  const prisma = getPrismaClient();
  await assertClassroomExists(classroomId);

  const existing = await prisma.classroomAvailability.findFirst({
    where: { id: availabilityId, classroomId },
    select: { id: true },
  });

  if (!existing) {
    throw new ApiError(404, 'Classroom availability not found.');
  }

  await prisma.classroomAvailability.delete({ where: { id: existing.id } });

  return getClassroomById(classroomId);
};

export const findAvailableClassrooms = async (
  query: AvailableClassroomsQuery,
): Promise<ClassroomSummary[]> => {
  const prisma = getPrismaClient();
  const dayOfWeek = getInstitutionalDayOfWeek(query.date);
  const date = new Date(`${query.date}T00:00:00.000Z`);
  const startTime = timeOfDay(query.startTime);
  const endTime = timeOfDay(query.endTime);

  const candidates = await prisma.classroom.findMany({
    where: {
      isActive: true,
      ...(query.type ? { type: query.type } : {}),
      ...(query.minCapacity ? { capacity: { gte: query.minCapacity } } : {}),
      ...(query.amenity
        ? {
            amenities: {
              some: { amenity: { equals: query.amenity, mode: 'insensitive' as const } },
            },
          }
        : {}),
      availability: {
        some: { dayOfWeek, startTime: { lte: startTime }, endTime: { gte: endTime } },
      },
    },
    orderBy: [{ capacity: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    select: classroomSummarySelect,
  });

  if (candidates.length === 0) {
    return [];
  }

  const blocking = await prisma.activity.findMany({
    where: {
      date,
      status: { in: [...BLOCKING_ACTIVITY_STATUSES] },
      classroomId: { in: candidates.map((candidate) => candidate.id) },
      startTime: { lt: endTime },
      endTime: { gt: startTime },
    },
    select: { classroomId: true },
    distinct: ['classroomId'],
  });

  const blocked = new Set(blocking.map((activity) => activity.classroomId));

  return candidates
    .filter((candidate) => !blocked.has(candidate.id))
    .map((record) => toClassroomSummary(record));
};
