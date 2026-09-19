import { getPrismaClient } from '../../config/prisma.js';
import type { ActivityType } from '../../generated/prisma/enums.js';
import { startOfInstitutionalDay } from '../../utils/date.js';
import type { ListEventsQuery } from './events.schemas.js';
import type { EventListItem, PaginatedEvents } from './events.types.js';

const UPCOMING_STATUSES = ['SCHEDULED', 'ONGOING'] as const;

const eventSelect = {
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

interface EventRecord {
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

const toEventListItem = (record: EventRecord): EventListItem => {
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

export const listUpcomingEvents = async (
  query: ListEventsQuery,
  now: Date = new Date(),
): Promise<PaginatedEvents> => {
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
      select: eventSelect,
    }),
    prisma.activity.count({ where }),
  ]);

  return {
    items: records.map((record) => toEventListItem(record)),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  };
};
