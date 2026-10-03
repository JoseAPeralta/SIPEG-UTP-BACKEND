import { getPrismaClient } from '../../config/prisma.js';
import type { ActivityStatus, ProgramStatus, UnitType } from '../../generated/prisma/enums.js';
import { ApiError } from '../../utils/ApiError.js';
import { writeAuditEvent } from '../audit/audit.service.js';
import type { AuditContext, AuditEventInput, AuditScalar } from '../audit/audit.types.js';
import { hasPermission } from '../authorization/authorization.service.js';
import { PERMISSIONS } from '../authorization/permissions.js';
import type {
  CreateEventProgramBody,
  ListEventProgramsQuery,
  UpdateEventProgramBody,
} from './event-programs.schemas.js';
import type {
  EventProgramActivityCount,
  EventProgramDetail,
  EventProgramPublicDetail,
  PaginatedEventPrograms,
} from './event-programs.types.js';

const eventProgramDetailSelect = {
  id: true,
  name: true,
  description: true,
  label: true,
  bannerUrl: true,
  isDefault: true,
  status: true,
  startDate: true,
  endDate: true,
  organizationalUnit: { select: { id: true, name: true, type: true } },
} as const;

const eventProgramLifecycleSelect = {
  ...eventProgramDetailSelect,
  organizationalUnit: { select: { id: true, name: true, type: true, isActive: true } },
} as const;

interface EventProgramDetailRecord {
  id: string;
  name: string;
  description: string | null;
  label: string | null;
  bannerUrl: string | null;
  isDefault: boolean;
  status: ProgramStatus;
  startDate: Date | null;
  endDate: Date | null;
  organizationalUnit: { id: string; name: string; type: UnitType };
}

const formatDate = (value: Date | null): string | null =>
  value ? value.toISOString().slice(0, 10) : null;

const toEventProgramDetail = (record: EventProgramDetailRecord): EventProgramDetail => ({
  id: record.id,
  name: record.name,
  description: record.description,
  label: record.label,
  bannerUrl: record.bannerUrl,
  isDefault: record.isDefault,
  status: record.status,
  startDate: formatDate(record.startDate),
  endDate: formatDate(record.endDate),
  organizationalUnit: record.organizationalUnit,
});

const PUBLIC_ACTIVITY_STATUSES = ['SCHEDULED', 'ONGOING', 'COMPLETED'] as const;
const ACTIVITY_STATUSES = ['DRAFT', 'SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED'] as const;

const PROGRAM_FREE_TEXT_KEYS = ['name', 'description', 'label', 'bannerUrl'] as const;

const buildProgramUpdateAuditEvent = (
  current: {
    id: string;
    name: string;
    description: string | null;
    label: string | null;
    bannerUrl: string | null;
    startDate: Date | null;
    endDate: Date | null;
  },
  input: UpdateEventProgramBody,
  nextStartDate: Date | null,
  nextEndDate: Date | null,
  auditContext: AuditContext,
): AuditEventInput | null => {
  const before: Record<string, AuditScalar> = {};
  const after: Record<string, AuditScalar> = {};
  const changedFields: string[] = [];

  for (const key of PROGRAM_FREE_TEXT_KEYS) {
    if (input[key] !== undefined && input[key] !== current[key]) {
      changedFields.push(key);
    }
  }

  const datePairs = [
    ['startDate', current.startDate, nextStartDate],
    ['endDate', current.endDate, nextEndDate],
  ] as const;

  for (const [key, previous, updated] of datePairs) {
    const previousKey = previous ? formatDate(previous) : null;
    const updatedKey = updated ? formatDate(updated) : null;

    if (input[key] !== undefined && previousKey !== updatedKey) {
      before[key] = previousKey;
      after[key] = updatedKey;
    }
  }

  if (Object.keys(after).length === 0 && changedFields.length === 0) {
    return null;
  }

  return {
    ...auditContext,
    action: 'event_program.updated',
    resourceType: 'event_program',
    resourceId: current.id,
    ...(Object.keys(after).length > 0 ? { changes: { before, after } } : {}),
    ...(changedFields.length > 0 ? { metadata: { changedFields } } : {}),
  };
};

const countEventProgramActivities = async (
  eventProgramId: string,
  includeBreakdown: boolean,
): Promise<EventProgramActivityCount> => {
  const prisma = getPrismaClient();
  const groups = await prisma.activity.groupBy({
    by: ['status'],
    where: { eventProgramId },
    _count: { _all: true },
  });

  const byStatus = Object.fromEntries(ACTIVITY_STATUSES.map((status) => [status, 0])) as Record<
    ActivityStatus,
    number
  >;

  for (const group of groups) {
    byStatus[group.status] = group._count._all;
  }

  const visible = PUBLIC_ACTIVITY_STATUSES.reduce((total, status) => total + byStatus[status], 0);

  if (!includeBreakdown) {
    return { visible };
  }

  return {
    visible,
    total: ACTIVITY_STATUSES.reduce((total, status) => total + byStatus[status], 0),
    byStatus,
  };
};

export const listEventPrograms = async (
  query: ListEventProgramsQuery,
  viewer: Express.AuthenticatedUser | null = null,
): Promise<PaginatedEventPrograms> => {
  const prisma = getPrismaClient();
  const requestedStatus = viewer?.globalRole === 'ADMIN' ? query.status : undefined;
  const status = requestedStatus ?? 'ACTIVE';
  const where = {
    ...(status === 'ALL' ? {} : { status }),
    ...(query.organizationalUnitId ? { organizationalUnitId: query.organizationalUnitId } : {}),
    ...(query.unitType ? { organizationalUnit: { type: query.unitType } } : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' as const } },
            { label: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
  const skip = (query.page - 1) * query.limit;

  const [records, total] = await Promise.all([
    prisma.eventProgram.findMany({
      where,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip,
      take: query.limit,
      select: eventProgramDetailSelect,
    }),
    prisma.eventProgram.count({ where }),
  ]);

  return {
    items: records.map(toEventProgramDetail),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  };
};

export const getEventProgramById = async (
  id: string,
  viewer: Express.AuthenticatedUser | null = null,
): Promise<EventProgramPublicDetail> => {
  const prisma = getPrismaClient();
  const record = await prisma.eventProgram.findUnique({
    where: { id },
    select: eventProgramDetailSelect,
  });

  if (!record || record.status !== 'ACTIVE') {
    throw new ApiError(404, 'Event program not found.');
  }

  const includeBreakdown = viewer
    ? await hasPermission(viewer, PERMISSIONS.PROGRAM_READ, { eventProgramId: id })
    : false;

  return {
    ...toEventProgramDetail(record),
    activityCount: await countEventProgramActivities(id, includeBreakdown),
  };
};

export const createEventProgram = async (
  input: CreateEventProgramBody,
  createdById: string,
  auditContext: AuditContext = {},
): Promise<EventProgramDetail> => {
  const prisma = getPrismaClient();
  const organizationalUnit = await prisma.organizationalUnit.findUnique({
    where: { id: input.organizationalUnitId },
    select: { id: true, isActive: true },
  });

  if (!organizationalUnit) {
    throw new ApiError(404, 'Organizational unit not found.');
  }
  if (!organizationalUnit.isActive) {
    throw new ApiError(
      400,
      'Event programs can only be created for an active organizational unit.',
    );
  }

  const startDate = new Date(`${input.startDate}T00:00:00.000Z`);
  const endDate = new Date(`${input.endDate}T00:00:00.000Z`);

  const record = await prisma.$transaction(async (tx) => {
    const created = await tx.eventProgram.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        label: input.label ?? null,
        bannerUrl: input.bannerUrl ?? null,
        isDefault: false,
        status: 'DRAFT',
        startDate,
        endDate,
        organizationalUnitId: organizationalUnit.id,
        createdById,
      },
      select: eventProgramDetailSelect,
    });

    await writeAuditEvent(tx, {
      ...auditContext,
      action: 'event_program.created',
      resourceType: 'event_program',
      resourceId: created.id,
      scopeType: 'event_program',
      scopeId: created.id,
      changes: {
        after: {
          status: 'DRAFT',
          startDate: input.startDate,
          endDate: input.endDate,
          organizationalUnitId: organizationalUnit.id,
        },
      },
      metadata: { hasLabel: input.label !== undefined && input.label !== null },
    });

    return created;
  });

  return toEventProgramDetail(record);
};

export const updateEventProgram = async (
  id: string,
  input: UpdateEventProgramBody,
  auditContext: AuditContext = {},
): Promise<EventProgramDetail> => {
  const prisma = getPrismaClient();

  const program = await prisma.eventProgram.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      isDefault: true,
      startDate: true,
      endDate: true,
      name: true,
      description: true,
      label: true,
      bannerUrl: true,
    },
  });

  if (!program) {
    throw new ApiError(404, 'Event program not found.');
  }
  if (program.status === 'ARCHIVED') {
    throw new ApiError(409, 'Archived event programs cannot be modified.');
  }

  const touchesDates = input.startDate !== undefined || input.endDate !== undefined;
  if (program.isDefault && touchesDates) {
    throw new ApiError(400, 'Default event programs cannot have start or end dates.');
  }

  const startDate =
    input.startDate !== undefined
      ? new Date(`${input.startDate}T00:00:00.000Z`)
      : program.startDate;
  const endDate =
    input.endDate !== undefined ? new Date(`${input.endDate}T00:00:00.000Z`) : program.endDate;

  if (startDate && endDate && endDate < startDate) {
    throw new ApiError(400, 'End date must be on or after start date.');
  }

  if (input.status === 'ACTIVE' && program.status !== 'DRAFT') {
    throw new ApiError(409, 'Only draft event programs can be activated.');
  }

  if (!program.isDefault && touchesDates && startDate && endDate) {
    const excludedActivities = await prisma.activity.count({
      where: {
        eventProgramId: program.id,
        OR: [{ date: { lt: startDate } }, { date: { gt: endDate } }],
      },
    });

    if (excludedActivities > 0) {
      throw new ApiError(409, 'Event program dates cannot exclude existing activities.');
    }
  }

  const publishes = input.status === 'ACTIVE' && program.status === 'DRAFT';

  const data = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.bannerUrl !== undefined ? { bannerUrl: input.bannerUrl } : {}),
    ...(input.startDate !== undefined ? { startDate } : {}),
    ...(input.endDate !== undefined ? { endDate } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
  };

  const record = await prisma.$transaction(async (tx) => {
    const updated = await tx.eventProgram.update({
      where: { id: program.id },
      data,
      select: eventProgramDetailSelect,
    });

    if (publishes) {
      await writeAuditEvent(tx, {
        ...auditContext,
        action: 'event_program.published',
        resourceType: 'event_program',
        resourceId: program.id,
        changes: {
          before: { status: 'DRAFT' },
          after: { status: 'ACTIVE' },
        },
      });
    } else {
      const attributeEvent = buildProgramUpdateAuditEvent(
        program,
        input,
        startDate,
        endDate,
        auditContext,
      );

      if (attributeEvent) {
        await writeAuditEvent(tx, attributeEvent);
      }
    }

    return updated;
  });

  return toEventProgramDetail(record);
};

export const archiveEventProgram = async (
  id: string,
  auditContext: AuditContext = {},
): Promise<EventProgramDetail> => {
  const prisma = getPrismaClient();
  const program = await prisma.eventProgram.findUnique({
    where: { id },
    select: eventProgramLifecycleSelect,
  });

  if (!program) {
    throw new ApiError(404, 'Event program not found.');
  }

  if (program.status === 'ARCHIVED') {
    return toEventProgramDetail(program);
  }

  if (program.isDefault && program.organizationalUnit.isActive) {
    throw new ApiError(
      409,
      'A default event program cannot be archived while its organizational unit is active.',
    );
  }

  if (!program.isDefault) {
    const blockingActivities = await prisma.activity.count({
      where: { eventProgramId: program.id, status: { in: ['SCHEDULED', 'ONGOING'] } },
    });

    if (blockingActivities > 0) {
      throw new ApiError(
        409,
        'An event program with scheduled or ongoing activities cannot be archived.',
      );
    }
  }

  const record = await prisma.$transaction(async (tx) => {
    const archived = await tx.eventProgram.update({
      where: { id: program.id },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
      select: eventProgramDetailSelect,
    });

    await writeAuditEvent(tx, {
      ...auditContext,
      action: 'event_program.archived',
      resourceType: 'event_program',
      resourceId: program.id,
      changes: {
        before: { status: program.status },
        after: { status: 'ARCHIVED' },
      },
    });

    return archived;
  });

  return toEventProgramDetail(record);
};

export const reactivateEventProgram = async (
  id: string,
  auditContext: AuditContext = {},
): Promise<EventProgramDetail> => {
  const prisma = getPrismaClient();
  const program = await prisma.eventProgram.findUnique({
    where: { id },
    select: eventProgramLifecycleSelect,
  });

  if (!program) {
    throw new ApiError(404, 'Event program not found.');
  }

  if (program.isDefault) {
    throw new ApiError(409, 'Only additional event programs can be reactivated.');
  }

  if (program.status !== 'ARCHIVED') {
    throw new ApiError(409, 'Only archived event programs can be reactivated.');
  }

  if (!program.startDate || !program.endDate || program.endDate < program.startDate) {
    throw new ApiError(400, 'Event program dates are invalid.');
  }

  const record = await prisma.$transaction(async (tx) => {
    const reactivated = await tx.eventProgram.update({
      where: { id: program.id },
      data: { status: 'ACTIVE', archivedAt: null },
      select: eventProgramDetailSelect,
    });

    await writeAuditEvent(tx, {
      ...auditContext,
      action: 'event_program.reactivated',
      resourceType: 'event_program',
      resourceId: program.id,
      changes: {
        before: { status: 'ARCHIVED' },
        after: { status: 'ACTIVE' },
      },
    });

    return reactivated;
  });

  return toEventProgramDetail(record);
};
