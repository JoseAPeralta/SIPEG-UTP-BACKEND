import { getPrismaClient } from '../../config/prisma.js';
import type { ClassroomType } from '../../generated/prisma/enums.js';
import { ApiError } from '../../utils/ApiError.js';
import { getInstitutionalDayOfWeek } from '../../utils/date.js';
import { writeAuditEvent } from '../audit/audit.service.js';
import type { AuditContext, AuditEventInput, AuditScalar } from '../audit/audit.types.js';
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

interface ClassroomMutableState {
  name: string;
  type: ClassroomType;
  capacity: number;
  building: string | null;
  floor: number | null;
  isActive: boolean;
}

const STRUCTURAL_ATTRIBUTE_KEYS = ['type', 'capacity', 'floor'] as const;

const FREE_TEXT_ATTRIBUTE_KEYS = ['name', 'building'] as const;

const buildClassroomUpdateAuditEvents = (
  classroomId: string,
  current: ClassroomMutableState,
  input: UpdateClassroomInput,
  next: ClassroomMutableState,
  auditContext: AuditContext,
): AuditEventInput[] => {
  const events: AuditEventInput[] = [];
  const base = { ...auditContext, resourceType: 'classroom' as const, resourceId: classroomId };

  if (current.isActive !== next.isActive) {
    events.push({
      ...base,
      action: next.isActive ? 'classroom.activated' : 'classroom.deactivated',
      changes: {
        before: { isActive: current.isActive },
        after: { isActive: next.isActive },
      },
    });
  }

  const before: Record<string, AuditScalar> = {};
  const after: Record<string, AuditScalar> = {};
  const changedFields: string[] = [];

  for (const key of STRUCTURAL_ATTRIBUTE_KEYS) {
    if (input[key] !== undefined && input[key] !== current[key]) {
      before[key] = current[key];
      after[key] = input[key];
    }
  }

  for (const key of FREE_TEXT_ATTRIBUTE_KEYS) {
    if (input[key] !== undefined && input[key] !== current[key]) {
      changedFields.push(key);
    }
  }

  if (Object.keys(after).length > 0 || changedFields.length > 0) {
    events.push({
      ...base,
      action: 'classroom.updated',
      ...(Object.keys(after).length > 0 ? { changes: { before, after } } : {}),
      ...(changedFields.length > 0 ? { metadata: { changedFields } } : {}),
    });
  }

  return events;
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

export const createClassroom = async (
  input: CreateClassroomInput,
  auditContext: AuditContext = {},
): Promise<ClassroomDetail> => {
  const prisma = getPrismaClient();
  const isActive = input.isActive ?? true;

  const record = await prisma.$transaction(async (tx) => {
    const created = await tx.classroom.create({
      data: {
        name: input.name,
        type: input.type,
        capacity: input.capacity,
        building: input.building ?? null,
        floor: input.floor ?? null,
        isActive,
      },
      select: classroomDetailSelect,
    });

    await writeAuditEvent(tx, {
      ...auditContext,
      action: 'classroom.created',
      resourceType: 'classroom',
      resourceId: created.id,
      changes: {
        after: {
          type: input.type,
          capacity: input.capacity,
          floor: input.floor ?? null,
          isActive,
        },
      },
    });

    return created;
  });

  return toClassroomDetail(record);
};

export const updateClassroom = async (
  id: string,
  input: UpdateClassroomInput,
  auditContext: AuditContext = {},
): Promise<ClassroomDetail> => {
  const prisma = getPrismaClient();
  const current = await prisma.classroom.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      type: true,
      capacity: true,
      building: true,
      floor: true,
      isActive: true,
    },
  });

  if (!current) {
    throw new ApiError(404, 'Classroom not found.');
  }

  const next: ClassroomMutableState = {
    name: input.name ?? current.name,
    type: input.type ?? current.type,
    capacity: input.capacity ?? current.capacity,
    building: input.building !== undefined ? input.building : current.building,
    floor: input.floor !== undefined ? input.floor : current.floor,
    isActive: input.isActive !== undefined ? input.isActive : current.isActive,
  };

  if (input.isActive === false && current.isActive) {
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

  const auditEvents = buildClassroomUpdateAuditEvents(id, current, input, next, auditContext);

  const record = await prisma.$transaction(async (tx) => {
    const updated = await tx.classroom.update({
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

    for (const event of auditEvents) {
      await writeAuditEvent(tx, event);
    }

    return updated;
  });

  return toClassroomDetail(record);
};

export const addClassroomAmenity = async (
  classroomId: string,
  amenity: string,
  auditContext: AuditContext = {},
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

  await prisma.$transaction(async (tx) => {
    try {
      await tx.classroomAmenity.create({ data: { classroomId, amenity } });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new ApiError(409, 'Amenity already exists for this classroom.');
      }
      throw error;
    }

    await writeAuditEvent(tx, {
      ...auditContext,
      action: 'classroom.amenity_added',
      resourceType: 'classroom',
      resourceId: classroomId,
      changes: { after: { amenity } },
    });
  });

  return getClassroomById(classroomId);
};

export const removeClassroomAmenity = async (
  classroomId: string,
  amenity: string,
  auditContext: AuditContext = {},
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

  await prisma.$transaction(async (tx) => {
    await tx.classroomAmenity.delete({
      where: { classroomId_amenity: { classroomId, amenity: existing.amenity } },
    });

    await writeAuditEvent(tx, {
      ...auditContext,
      action: 'classroom.amenity_removed',
      resourceType: 'classroom',
      resourceId: classroomId,
      changes: { before: { amenity: existing.amenity } },
    });
  });

  return getClassroomById(classroomId);
};

export const addClassroomAvailability = async (
  classroomId: string,
  input: AddClassroomAvailabilityInput,
  auditContext: AuditContext = {},
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

  await prisma.$transaction(async (tx) => {
    try {
      await tx.classroomAvailability.create({
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

    await writeAuditEvent(tx, {
      ...auditContext,
      action: 'classroom.availability_added',
      resourceType: 'classroom',
      resourceId: classroomId,
      changes: {
        after: {
          dayOfWeek: input.dayOfWeek,
          startTime: input.startTime,
          endTime: input.endTime,
        },
      },
      metadata: { hasPeriod: input.period !== undefined && input.period !== null },
    });
  });

  return getClassroomById(classroomId);
};

export const removeClassroomAvailability = async (
  classroomId: string,
  availabilityId: string,
  auditContext: AuditContext = {},
): Promise<ClassroomDetail> => {
  const prisma = getPrismaClient();
  await assertClassroomExists(classroomId);

  const existing = await prisma.classroomAvailability.findFirst({
    where: { id: availabilityId, classroomId },
    select: {
      id: true,
      dayOfWeek: true,
      startTime: true,
      endTime: true,
      period: true,
    },
  });

  if (!existing) {
    throw new ApiError(404, 'Classroom availability not found.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.classroomAvailability.delete({ where: { id: existing.id } });

    await writeAuditEvent(tx, {
      ...auditContext,
      action: 'classroom.availability_removed',
      resourceType: 'classroom',
      resourceId: classroomId,
      changes: {
        before: {
          dayOfWeek: existing.dayOfWeek,
          startTime: formatTime(existing.startTime),
          endTime: formatTime(existing.endTime),
        },
      },
      metadata: { hasPeriod: existing.period !== null },
    });
  });

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
