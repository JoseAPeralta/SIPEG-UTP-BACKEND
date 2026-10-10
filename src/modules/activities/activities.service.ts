import { getPrismaClient } from '../../config/prisma.js';
import type { ActivityStatus, ActivityType } from '../../generated/prisma/enums.js';
import { ApiError } from '../../utils/ApiError.js';
import { startOfInstitutionalDay } from '../../utils/date.js';
import { writeAuditEvent } from '../audit/audit.service.js';
import type { AuditContext, AuditEventInput, AuditScalar } from '../audit/audit.types.js';
import { getEffectivePermissions } from '../authorization/authorization.service.js';
import { PERMISSIONS } from '../authorization/permissions.js';
import {
  assertActivityScheduleIsAvailable,
  assertActivityTimeRange,
  assertClassroomIsAssignable,
  isExclusionViolation,
  RESERVING_STATUSES,
} from './activities.schedule.js';
import {
  buildEffectiveStatusWhere,
  PUBLISHED_ACTIVITY_STATUSES,
  resolveActivityStatus,
} from './activities.status.js';
import type {
  CreateActivityBody,
  ListActivitiesQuery,
  ListEventProgramActivitiesQuery,
  UpdateActivityBody,
} from './activities.schemas.js';
import type {
  ActivityDetail,
  ActivityListItem,
  PaginatedActivities,
  PaginatedEventProgramActivities,
} from './activities.types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const ALL_ACTIVITY_STATUSES: ActivityStatus[] = [
  'DRAFT',
  'SCHEDULED',
  'ONGOING',
  'COMPLETED',
  'CANCELLED',
];

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
  status: true,
  speakers: {
    select: { speaker: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { speaker: { lastName: 'asc' } },
  },
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
  status: ActivityStatus;
  speakers: { speaker: { id: string; firstName: string; lastName: string } }[];
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

const toActivityListItem = (record: ActivityRecord, now: Date): ActivityListItem => {
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
    status: resolveActivityStatus(record, now),
    speakers: record.speakers.map(({ speaker }) => ({
      id: speaker.id,
      firstName: speaker.firstName,
      lastName: speaker.lastName,
    })),
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
  cancelReason: true,
  equipment: { select: { name: true }, orderBy: { name: 'asc' } },
} as const;

const activityDetailWithCountSelect = {
  ...activityDetailSelect,
  eventProgram: {
    select: { ...activityDetailSelect.eventProgram.select, status: true },
  },
  _count: { select: { attendance: true } },
} as const;

interface ActivityDetailRecord extends ActivityRecord {
  cancelReason: string | null;
  equipment: { name: string }[];
}

const toActivityDetail = (
  record: ActivityDetailRecord,
  enrolledCount: number,
  checkedInCount: number,
  now: Date,
): ActivityDetail => ({
  ...toActivityListItem(record, now),
  cancelReason: record.cancelReason,
  equipment: record.equipment.map((item) => item.name),
  enrolledCount,
  checkedInCount,
});

const parseActivityDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

const parseActivityTime = (value: string): Date => new Date(`1970-01-01T${value}:00.000Z`);

const ACTIVITY_DELETION_CONFLICT_MESSAGE =
  'The activity changed while it was being deleted. Retry the request.';

// A deletion can lose the eligibility race between the guards and the write:
// a concurrent attendance/alert insert trips the ON DELETE RESTRICT foreign
// keys, and the retention trigger rejects a status or program change.
const isDeletionRetentionConflict = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown; meta?: { code?: unknown } };
  const message = typeof candidate.message === 'string' ? candidate.message : '';

  return (
    candidate.code === 'P2003' ||
    candidate.meta?.code === 'P2003' ||
    message.includes('23503') ||
    message.includes('only DRAFT activities can be deleted') ||
    message.includes('activities can only be deleted in an active event program')
  );
};

export const listActivities = async (
  query: ListActivitiesQuery,
  viewer: Express.AuthenticatedUser | null = null,
  now: Date = new Date(),
): Promise<PaginatedActivities> => {
  const prisma = getPrismaClient();

  const requestedStatus = viewer?.globalRole === 'ADMIN' ? query.status : undefined;
  const statusWhere =
    requestedStatus && requestedStatus !== 'ALL'
      ? buildEffectiveStatusWhere(requestedStatus, now)
      : requestedStatus === 'ALL'
        ? {}
        : { status: { in: [...PUBLISHED_ACTIVITY_STATUSES] } };

  const when = query.when ?? 'upcoming';
  const today = startOfInstitutionalDay(now);
  let lowerBound: Date | undefined = when === 'upcoming' ? today : undefined;
  let upperBound: Date | undefined =
    when === 'past' ? new Date(today.getTime() - DAY_MS) : undefined;

  if (query.dateFrom) {
    const from = parseActivityDate(query.dateFrom);
    lowerBound = lowerBound && lowerBound > from ? lowerBound : from;
  }
  if (query.dateTo) {
    const to = parseActivityDate(query.dateTo);
    upperBound = upperBound && upperBound < to ? upperBound : to;
  }

  const where = {
    ...statusWhere,
    eventProgram: {
      status: 'ACTIVE' as const,
      ...(query.organizationalUnitId ? { organizationalUnitId: query.organizationalUnitId } : {}),
      ...(query.unitType ? { organizationalUnit: { type: query.unitType } } : {}),
    },
    ...(query.eventProgramId ? { eventProgramId: query.eventProgramId } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.classroomId ? { classroomId: query.classroomId } : {}),
    ...(lowerBound || upperBound
      ? {
          date: {
            ...(lowerBound ? { gte: lowerBound } : {}),
            ...(upperBound ? { lte: upperBound } : {}),
          },
        }
      : {}),
  };

  const orderBy =
    when === 'past'
      ? ([{ date: 'desc' }, { startTime: 'desc' }, { id: 'asc' }] as const)
      : ([{ date: 'asc' }, { startTime: 'asc' }, { id: 'asc' }] as const);

  const skip = (query.page - 1) * query.limit;

  const [records, total] = await Promise.all([
    prisma.activity.findMany({
      where,
      orderBy: [...orderBy],
      skip,
      take: query.limit,
      select: activitySelect,
    }),
    prisma.activity.count({ where }),
  ]);

  return {
    items: records.map((record) => toActivityListItem(record, now)),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  };
};

export const listEventProgramActivities = async (
  eventProgramId: string,
  query: ListEventProgramActivitiesQuery,
  viewer: Express.AuthenticatedUser | null = null,
  now: Date = new Date(),
): Promise<PaginatedEventProgramActivities> => {
  const prisma = getPrismaClient();

  const program = await prisma.eventProgram.findUnique({
    where: { id: eventProgramId },
    select: { id: true, status: true },
  });

  if (!program) {
    throw new ApiError(404, 'Event program not found.');
  }

  const canRead = viewer
    ? viewer.globalRole === 'ADMIN' ||
      (await getEffectivePermissions(viewer, { eventProgramId })).has(PERMISSIONS.ACTIVITY_READ)
    : false;

  if (!canRead && program.status !== 'ACTIVE') {
    throw new ApiError(404, 'Event program not found.');
  }

  const statusWhere = canRead
    ? query.status && query.status !== 'ALL'
      ? { AND: [buildEffectiveStatusWhere(query.status, now)] }
      : { status: { in: [...ALL_ACTIVITY_STATUSES] } }
    : { status: { in: [...PUBLISHED_ACTIVITY_STATUSES] } };

  const dateFilter =
    query.dateFrom || query.dateTo
      ? {
          ...(query.dateFrom ? { gte: parseActivityDate(query.dateFrom) } : {}),
          ...(query.dateTo ? { lte: parseActivityDate(query.dateTo) } : {}),
        }
      : undefined;

  const where = {
    eventProgramId,
    ...statusWhere,
    ...(query.type ? { type: query.type } : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' as const } },
            { description: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
    ...(dateFilter ? { date: dateFilter } : {}),
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
    items: records.map((record) => toActivityListItem(record, now)),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  };
};

export const getActivityById = async (
  id: string,
  viewer?: Express.AuthenticatedUser,
  now: Date = new Date(),
): Promise<ActivityDetail> => {
  const prisma = getPrismaClient();

  const record = await prisma.activity.findUnique({
    where: { id },
    select: activityDetailWithCountSelect,
  });

  if (!record) {
    throw new ApiError(404, 'Activity not found.');
  }

  if (!viewer || viewer.globalRole !== 'ADMIN') {
    const canRead = viewer
      ? (await getEffectivePermissions(viewer, { activityId: id })).has(PERMISSIONS.ACTIVITY_READ)
      : false;

    if (!canRead && (record.status === 'DRAFT' || record.eventProgram.status !== 'ACTIVE')) {
      throw new ApiError(404, 'Activity not found.');
    }
  }

  const checkedInCount = await prisma.attendance.count({
    where: { activityId: id, checkedInAt: { not: null } },
  });

  return toActivityDetail(record, record._count.attendance, checkedInCount, now);
};

type SpeakerInput = NonNullable<CreateActivityBody['speakers']>[number];

const buildSpeakerCreates = async (speakers: SpeakerInput[]) => {
  const prisma = getPrismaClient();
  const emails = speakers
    .map((speaker) => speaker.email)
    .filter((email): email is string => typeof email === 'string');

  const usersByEmail = emails.length
    ? await prisma.user.findMany({
        where: { email: { in: emails } },
        select: { id: true, email: true },
      })
    : [];

  const userIdByEmail = new Map(
    usersByEmail.map((user) => [user.email.toLowerCase(), user.id] as const),
  );

  return speakers.map((speaker) =>
    speaker.email
      ? {
          speaker: {
            connectOrCreate: {
              where: { email: speaker.email },
              create: {
                firstName: speaker.firstName,
                lastName: speaker.lastName,
                email: speaker.email,
                organization: speaker.organization ?? null,
                userId: userIdByEmail.get(speaker.email) ?? null,
              },
            },
          },
        }
      : {
          speaker: {
            create: {
              firstName: speaker.firstName,
              lastName: speaker.lastName,
              email: null,
              organization: speaker.organization ?? null,
              userId: null,
            },
          },
        },
  );
};

export const createActivity = async (
  input: CreateActivityBody,
  auditContext: AuditContext = {},
): Promise<ActivityDetail> => {
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

  const startTime = new Date(`1970-01-01T${input.startTime}:00.000Z`);
  const endTime = new Date(`1970-01-01T${input.endTime}:00.000Z`);

  assertActivityTimeRange(startTime, endTime);

  if (input.classroomId) {
    await assertActivityScheduleIsAvailable({
      classroomId: input.classroomId,
      date,
      startTime,
      endTime,
      maxCapacity: input.maxCapacity ?? null,
    });
  }

  const speakerCreates = input.speakers?.length ? await buildSpeakerCreates(input.speakers) : null;

  const record = await prisma.$transaction(async (tx) => {
    const created = await tx.activity.create({
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
        ...(speakerCreates ? { speakers: { create: speakerCreates } } : {}),
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

    await writeAuditEvent(tx, {
      ...auditContext,
      action: 'activity.created',
      resourceType: 'activity',
      resourceId: created.id,
      scopeType: 'event_program',
      scopeId: program.id,
      changes: {
        after: {
          status: 'DRAFT',
          type: input.type,
          date: input.date,
          startTime: input.startTime,
          endTime: input.endTime,
          maxCapacity: input.maxCapacity ?? null,
          classroomId: input.classroomId ?? null,
          eventProgramId: program.id,
        },
      },
    });

    return created;
  });

  return toActivityDetail(record, 0, 0, new Date());
};

interface ActivityScheduleSnapshot {
  date: Date;
  startTime: Date;
  endTime: Date;
  classroomId: string | null;
  maxCapacity: number | null;
}

const ACTIVITY_FREE_TEXT_KEYS = ['name', 'description', 'bannerUrl'] as const;

interface ActivityResidualSnapshot {
  type: ActivityType;
  name: string;
  description: string | null;
  bannerUrl: string | null;
  equipment: string[];
  speakers: string[];
}

const normalizeSet = (values: readonly string[]): string =>
  [...values]
    .map((value) => value.trim())
    .sort()
    .join(' ');

const sameStringSet = (left: readonly string[], right: readonly string[]): boolean =>
  normalizeSet(left) === normalizeSet(right);

const speakerSetKey = (speaker: {
  email?: string | null | undefined;
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
  organization?: string | null | undefined;
}): string =>
  [
    speaker.email ?? '',
    speaker.firstName ?? '',
    speaker.lastName ?? '',
    speaker.organization ?? '',
  ].join('');

const buildActivityScheduleChanges = (
  current: ActivityScheduleSnapshot,
  next: ActivityScheduleSnapshot,
): { before: Record<string, AuditScalar>; after: Record<string, AuditScalar> } => {
  const before: Record<string, AuditScalar> = {};
  const after: Record<string, AuditScalar> = {};

  const pairs = [
    ['date', formatDate(current.date), formatDate(next.date)],
    ['startTime', formatTime(current.startTime), formatTime(next.startTime)],
    ['endTime', formatTime(current.endTime), formatTime(next.endTime)],
    ['classroomId', current.classroomId, next.classroomId],
    ['maxCapacity', current.maxCapacity, next.maxCapacity],
  ] as const;

  for (const [key, previous, updated] of pairs) {
    if (previous !== updated) {
      before[key] = previous;
      after[key] = updated;
    }
  }

  return { before, after };
};

const buildActivityUpdateAuditEvents = (
  activityId: string,
  eventProgramId: string,
  currentStatus: ActivityStatus,
  nextStatus: ActivityStatus,
  scheduleChanges: { before: Record<string, AuditScalar>; after: Record<string, AuditScalar> },
  residualChanges: AuditEventInput | null,
  auditContext: AuditContext,
): AuditEventInput[] => {
  const base = {
    ...auditContext,
    resourceType: 'activity' as const,
    resourceId: activityId,
    scopeType: 'event_program' as const,
    scopeId: eventProgramId,
  };

  const events: AuditEventInput[] = [];

  if (currentStatus !== nextStatus) {
    events.push({
      ...base,
      action: nextStatus === 'SCHEDULED' ? 'activity.scheduled' : 'activity.unpublished',
      changes: {
        before: { status: currentStatus },
        after: { status: nextStatus },
      },
    });
  } else if (Object.keys(scheduleChanges.after).length > 0) {
    events.push({
      ...base,
      action: 'activity.schedule_changed',
      changes: scheduleChanges,
    });
  }

  if (residualChanges) {
    events.push(residualChanges);
  }

  return events;
};

const buildActivityResidualAuditEvent = (
  activityId: string,
  eventProgramId: string,
  current: ActivityResidualSnapshot,
  input: UpdateActivityBody,
  nextSpeakerSet: string[] | undefined,
  auditContext: AuditContext,
): AuditEventInput | null => {
  const before: Record<string, AuditScalar> = {};
  const after: Record<string, AuditScalar> = {};
  const changedFields: string[] = [];

  if (input.type !== undefined && input.type !== current.type) {
    before['type'] = current.type;
    after['type'] = input.type;
  }

  for (const key of ACTIVITY_FREE_TEXT_KEYS) {
    if (input[key] !== undefined && input[key] !== current[key]) {
      changedFields.push(key);
    }
  }

  if (input.equipment !== undefined && !sameStringSet(input.equipment, current.equipment)) {
    changedFields.push('equipment');
  }

  if (nextSpeakerSet !== undefined && !sameStringSet(nextSpeakerSet, current.speakers)) {
    changedFields.push('speakers');
  }

  if (Object.keys(after).length === 0 && changedFields.length === 0) {
    return null;
  }

  return {
    ...auditContext,
    action: 'activity.updated',
    resourceType: 'activity',
    resourceId: activityId,
    scopeType: 'event_program',
    scopeId: eventProgramId,
    ...(Object.keys(after).length > 0 ? { changes: { before, after } } : {}),
    ...(changedFields.length > 0 ? { metadata: { changedFields } } : {}),
  };
};

export const updateActivity = async (
  id: string,
  input: UpdateActivityBody,
  auditContext: AuditContext = {},
): Promise<ActivityDetail> => {
  const prisma = getPrismaClient();

  const current = await prisma.activity.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      date: true,
      startTime: true,
      endTime: true,
      classroomId: true,
      maxCapacity: true,
      type: true,
      name: true,
      description: true,
      bannerUrl: true,
      equipment: { select: { name: true } },
      speakers: {
        select: {
          speaker: {
            select: { email: true, firstName: true, lastName: true, organization: true },
          },
        },
      },
      eventProgram: {
        select: {
          id: true,
          status: true,
          isDefault: true,
          startDate: true,
          endDate: true,
        },
      },
    },
  });

  if (!current) {
    throw new ApiError(404, 'Activity not found.');
  }

  const now = new Date();
  const effectiveStatus = resolveActivityStatus(current, now);

  if (effectiveStatus === 'COMPLETED' || effectiveStatus === 'CANCELLED') {
    throw new ApiError(409, 'Completed or cancelled activities cannot be modified.');
  }
  if (effectiveStatus === 'ONGOING') {
    throw new ApiError(409, 'Ongoing activities cannot be modified.');
  }
  if (current.eventProgram.status !== 'ACTIVE') {
    throw new ApiError(409, 'Event programs must be active to modify their activities.');
  }

  const status = input.status ?? effectiveStatus;

  if (input.status !== undefined && input.status !== effectiveStatus) {
    const allowed =
      (effectiveStatus === 'DRAFT' && input.status === 'SCHEDULED') ||
      (effectiveStatus === 'SCHEDULED' && input.status === 'DRAFT');

    if (!allowed) {
      throw new ApiError(400, 'Activity status transition is not allowed.');
    }
  }

  const date = input.date !== undefined ? parseActivityDate(input.date) : current.date;
  const startTime =
    input.startTime !== undefined ? parseActivityTime(input.startTime) : current.startTime;
  const endTime = input.endTime !== undefined ? parseActivityTime(input.endTime) : current.endTime;

  assertActivityTimeRange(startTime, endTime);

  if (
    input.date !== undefined &&
    !current.eventProgram.isDefault &&
    ((current.eventProgram.startDate && date < current.eventProgram.startDate) ||
      (current.eventProgram.endDate && date > current.eventProgram.endDate))
  ) {
    throw new ApiError(400, 'Activity date must be within the event program date range.');
  }

  const classroomId =
    input.classroomId !== undefined ? (input.classroomId ?? null) : current.classroomId;
  const maxCapacity =
    input.maxCapacity !== undefined ? (input.maxCapacity ?? null) : current.maxCapacity;
  const statusChanged = input.status !== undefined && input.status !== current.status;
  const scheduleChanged =
    input.date !== undefined || input.startTime !== undefined || input.endTime !== undefined;
  const classroomChanged = input.classroomId !== undefined;
  const capacityChanged = input.maxCapacity !== undefined;
  const requiresBooking =
    RESERVING_STATUSES.includes(status) &&
    (statusChanged || scheduleChanged || classroomChanged || capacityChanged) &&
    classroomId !== null;

  if (requiresBooking && classroomId) {
    await assertActivityScheduleIsAvailable({
      activityId: id,
      classroomId,
      date,
      startTime,
      endTime,
      maxCapacity,
    });
  } else if (classroomChanged && classroomId) {
    await assertClassroomIsAssignable(classroomId);
  }

  const data = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.type !== undefined ? { type: input.type } : {}),
    ...(input.date !== undefined ? { date } : {}),
    ...(input.startTime !== undefined ? { startTime } : {}),
    ...(input.endTime !== undefined ? { endTime } : {}),
    ...(input.maxCapacity !== undefined ? { maxCapacity } : {}),
    ...(input.bannerUrl !== undefined ? { bannerUrl: input.bannerUrl } : {}),
    ...(input.classroomId !== undefined ? { classroomId } : {}),
    ...(status !== current.status ? { status } : {}),
    ...(input.equipment !== undefined
      ? {
          equipment:
            input.equipment.length > 0
              ? {
                  deleteMany: {},
                  createMany: {
                    data: input.equipment.map((name) => ({ name })),
                    skipDuplicates: true,
                  },
                }
              : { deleteMany: {} },
        }
      : {}),
    ...(input.speakers !== undefined
      ? {
          speakers:
            input.speakers.length > 0
              ? { deleteMany: {}, create: await buildSpeakerCreates(input.speakers) }
              : { deleteMany: {} },
        }
      : {}),
  };

  const scheduleChanges = buildActivityScheduleChanges(
    {
      date: current.date,
      startTime: current.startTime,
      endTime: current.endTime,
      classroomId: current.classroomId,
      maxCapacity: current.maxCapacity,
    },
    { date, startTime, endTime, classroomId, maxCapacity },
  );

  const auditEvents = buildActivityUpdateAuditEvents(
    id,
    current.eventProgram.id,
    current.status,
    status,
    scheduleChanges,
    buildActivityResidualAuditEvent(
      id,
      current.eventProgram.id,
      {
        type: current.type,
        name: current.name,
        description: current.description,
        bannerUrl: current.bannerUrl,
        equipment: current.equipment.map((item) => item.name),
        speakers: current.speakers.map(({ speaker }) => speakerSetKey(speaker)),
      },
      input,
      input.speakers?.map(speakerSetKey),
      auditContext,
    ),
    auditContext,
  );

  const record = await prisma.$transaction(async (tx) => {
    const updated = await tx.activity
      .update({
        where: { id },
        data,
        select: activityDetailWithCountSelect,
      })
      .catch((error: unknown) => {
        if (isExclusionViolation(error)) {
          throw new ApiError(409, 'Classroom is already reserved for an overlapping activity.');
        }
        throw error;
      });

    for (const event of auditEvents) {
      await writeAuditEvent(tx, event);
    }

    return updated;
  });

  const checkedInCount = await prisma.attendance.count({
    where: { activityId: id, checkedInAt: { not: null } },
  });

  return toActivityDetail(record, record._count.attendance, checkedInCount, now);
};

export const cancelActivity = async (
  id: string,
  reason?: string,
  auditContext: AuditContext = {},
): Promise<ActivityDetail> => {
  const prisma = getPrismaClient();

  const current = await prisma.activity.findUnique({
    where: { id },
    select: activityDetailWithCountSelect,
  });

  if (!current) {
    throw new ApiError(404, 'Activity not found.');
  }

  const now = new Date();
  const effectiveStatus = resolveActivityStatus(current, now);

  if (effectiveStatus === 'COMPLETED') {
    throw new ApiError(409, 'Completed activities cannot be cancelled.');
  }

  let record = current;

  if (effectiveStatus !== 'CANCELLED') {
    if (current.eventProgram.status !== 'ACTIVE') {
      throw new ApiError(409, 'Event programs must be active to cancel their activities.');
    }

    record = await prisma.$transaction(async (tx) => {
      const cancelled = await tx.activity.update({
        where: { id },
        data: { status: 'CANCELLED', cancelReason: reason ?? null },
        select: activityDetailWithCountSelect,
      });

      await writeAuditEvent(tx, {
        ...auditContext,
        action: 'activity.cancelled',
        resourceType: 'activity',
        resourceId: id,
        scopeType: 'event_program',
        scopeId: current.eventProgram.id,
        changes: {
          before: { status: current.status },
          after: { status: 'CANCELLED' },
        },
        metadata: { hasCancelReason: reason !== undefined },
      });

      return cancelled;
    });
  }

  const checkedInCount = await prisma.attendance.count({
    where: { activityId: id, checkedInAt: { not: null } },
  });

  return toActivityDetail(record, record._count.attendance, checkedInCount, now);
};

export const deleteActivity = async (
  id: string,
  auditContext: AuditContext = {},
): Promise<void> => {
  const prisma = getPrismaClient();

  const current = await prisma.activity.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      eventProgram: { select: { id: true, status: true } },
    },
  });

  if (!current) {
    throw new ApiError(404, 'Activity not found.');
  }
  if (current.status !== 'DRAFT') {
    throw new ApiError(409, 'Only DRAFT activities can be deleted.');
  }
  if (current.eventProgram.status !== 'ACTIVE') {
    throw new ApiError(409, 'Event programs must be active to delete their activities.');
  }

  const [enrolledCount, alertCount] = await Promise.all([
    prisma.attendance.count({ where: { activityId: id } }),
    prisma.alert.count({ where: { activityId: id } }),
  ]);

  if (enrolledCount > 0) {
    throw new ApiError(409, 'Activities with attendance records cannot be deleted.');
  }
  if (alertCount > 0) {
    throw new ApiError(409, 'Activities with alert records cannot be deleted.');
  }

  await prisma.$transaction(async (tx) => {
    const deleted = await tx.activity
      .deleteMany({
        where: {
          id,
          status: 'DRAFT',
          eventProgram: { status: 'ACTIVE' },
          attendance: { none: {} },
          alerts: { none: {} },
        },
      })
      .catch((error: unknown) => {
        if (isDeletionRetentionConflict(error)) {
          throw new ApiError(409, ACTIVITY_DELETION_CONFLICT_MESSAGE);
        }
        throw error;
      });

    if (deleted.count !== 1) {
      throw new ApiError(409, ACTIVITY_DELETION_CONFLICT_MESSAGE);
    }

    await writeAuditEvent(tx, {
      ...auditContext,
      action: 'activity.deleted',
      resourceType: 'activity',
      resourceId: id,
      scopeType: 'event_program',
      scopeId: current.eventProgram.id,
      changes: { before: { status: 'DRAFT' } },
    });
  });
};
