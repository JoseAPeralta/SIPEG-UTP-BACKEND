import { getPrismaClient } from '../../config/prisma.js';
import type { ActivityStatus, ActivityType } from '../../generated/prisma/enums.js';
import { ApiError } from '../../utils/ApiError.js';
import { startOfInstitutionalDay } from '../../utils/date.js';
import type { CreateActivityBody, ListActivitiesQuery } from './activities.schemas.js';
import type { ActivityDetail, ActivityListItem, PaginatedActivities } from './activities.types.js';

const UPCOMING_STATUSES = ['SCHEDULED', 'ONGOING'] as const;

const activitySelect = {
  id: true,
  name: true,
  description: true,
  type: true,
  date: true,
  startTime: true,
  endTime: true,
  maxCapacity: true,
  bannerUrl: true,
  speaker: { select: { id: true, firstName: true, lastName: true } },
  classroom: { select: { id: true, name: true, building: true } },
  eventProgram: {
    select: {
      id: true,
      name: true,
      label: true,
      organizationalUnit: { select: { id: true, name: true, type: true } },
    },
  },
} as const;

interface ActivityRecord {
  id: string;
  name: string;
  description: string | null;
  type: ActivityType;
  date: Date;
  startTime: Date;
  endTime: Date;
  maxCapacity: number | null;
  bannerUrl: string | null;
  speaker: { id: string; firstName: string; lastName: string } | null;
  classroom: { id: string; name: string; building: string | null } | null;
  eventProgram: {
    id: string;
    name: string;
    label: string | null;
    organizationalUnit: { id: string; name: string; type: 'FACULTY' | 'SUBDIRECTORATE' };
  };
}

const formatDate = (value: Date): string => value.toISOString().slice(0, 10);

const formatTime = (value: Date): string => value.toISOString().slice(11, 16);

const toActivityListItem = (record: ActivityRecord): ActivityListItem => {
  const { organizationalUnit } = record.eventProgram;

  return {
    id: record.id,
    name: record.name,
    description: record.description,
    type: record.type,
    date: formatDate(record.date),
    startTime: formatTime(record.startTime),
    endTime: formatTime(record.endTime),
    capacity: record.maxCapacity,
    bannerUrl: record.bannerUrl,
    speaker: record.speaker
      ? {
          id: record.speaker.id,
          firstName: record.speaker.firstName,
          lastName: record.speaker.lastName,
        }
      : null,
    classroom: record.classroom
      ? {
          id: record.classroom.id,
          name: record.classroom.name,
          building: record.classroom.building,
        }
      : null,
    eventProgram: {
      id: record.eventProgram.id,
      name: record.eventProgram.name,
      label: record.eventProgram.label,
    },
    organizationalUnit: {
      type: organizationalUnit.type,
      id: organizationalUnit.id,
      name: organizationalUnit.name,
    },
  };
};

const activityDetailSelect = {
  ...activitySelect,
  status: true,
  equipment: { select: { name: true }, orderBy: { name: 'asc' } },
} as const;

interface ActivityDetailRecord extends ActivityRecord {
  status: ActivityStatus;
  equipment: { name: string }[];
}

const toActivityDetail = (record: ActivityDetailRecord): ActivityDetail => ({
  ...toActivityListItem(record),
  status: record.status,
  equipment: record.equipment.map((item) => item.name),
});

export const listUpcomingActivities = async (
  query: ListActivitiesQuery,
  now: Date = new Date(),
): Promise<PaginatedActivities> => {
  const prisma = getPrismaClient();

  const where = {
    status: { in: [...UPCOMING_STATUSES] },
    eventProgram: { status: 'ACTIVE' as const },
    date: { gte: startOfInstitutionalDay(now) },
  };

  const skip = (query.page - 1) * query.limit;

  const [records, total] = await Promise.all([
    prisma.activity.findMany({
      where,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
      skip,
      take: query.limit,
      select: activitySelect,
    }),
    prisma.activity.count({ where }),
  ]);

  return {
    items: records.map((record) => toActivityListItem(record)),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  };
};

export const createActivity = async (input: CreateActivityBody): Promise<ActivityDetail> => {
  const prisma = getPrismaClient();

  const program = await prisma.eventProgram.findUnique({
    where: { id: input.eventProgramId },
    select: { id: true, status: true, isDefault: true, startDate: true, endDate: true },
  });

  if (!program) {
    throw new ApiError(404, 'Event program not found.');
  }

  if (program.status !== 'ACTIVE') {
    throw new ApiError(400, 'Activities can only be created in an active event program.');
  }

  const date = new Date(`${input.date}T00:00:00.000Z`);

  if (!program.isDefault) {
    if (
      (program.startDate && date < program.startDate) ||
      (program.endDate && date > program.endDate)
    ) {
      throw new ApiError(400, 'Activity date must be within the event program date range.');
    }
  }

  if (input.classroomId) {
    const classroom = await prisma.classroom.findUnique({
      where: { id: input.classroomId },
      select: { id: true, isActive: true },
    });

    if (!classroom) {
      throw new ApiError(404, 'Classroom not found.');
    }
    if (!classroom.isActive) {
      throw new ApiError(400, 'Classroom is not active.');
    }
  }

  if (input.speakerId) {
    const speaker = await prisma.user.findUnique({
      where: { id: input.speakerId },
      select: { id: true, isActive: true },
    });

    if (!speaker) {
      throw new ApiError(404, 'Speaker not found.');
    }
    if (!speaker.isActive) {
      throw new ApiError(400, 'Speaker is not active.');
    }
  }

  const startTime = new Date(`1970-01-01T${input.startTime}:00.000Z`);
  const endTime = new Date(`1970-01-01T${input.endTime}:00.000Z`);

  const record = await prisma.activity.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      type: input.type,
      date,
      startTime,
      endTime,
      maxCapacity: input.maxCapacity ?? null,
      bannerUrl: input.bannerUrl ?? null,
      status: 'DRAFT',
      eventProgramId: program.id,
      classroomId: input.classroomId ?? null,
      speakerId: input.speakerId ?? null,
      ...(input.equipment?.length
        ? {
            equipment: {
              createMany: {
                data: input.equipment.map((name) => ({ name })),
                skipDuplicates: true,
              },
            },
          }
        : {}),
    },
    select: activityDetailSelect,
  });

  return toActivityDetail(record);
};
