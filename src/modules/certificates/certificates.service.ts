import { getPrismaClient } from '../../config/prisma.js';
import { getInstitutionalDayRange } from '../../utils/date.js';
import type { ActivityType } from '../../generated/prisma/enums.js';
import type { ListMyCertificatesQuery } from './certificates.schemas.js';
import type { MyCertificateSummary, PaginatedMyCertificates } from './certificates.types.js';

const certificateSelect = {
  id: true,
  code: true,
  issuedAt: true,
  attendance: {
    select: {
      activity: {
        select: {
          id: true,
          name: true,
          date: true,
          type: true,
          eventProgram: { select: { id: true, name: true } },
        },
      },
    },
  },
} as const;

interface CertificateRecord {
  id: string;
  code: string;
  issuedAt: Date;
  attendance: {
    activity: {
      id: string;
      name: string;
      date: Date;
      type: ActivityType;
      eventProgram: { id: string; name: string };
    };
  };
}

const formatDate = (value: Date): string => value.toISOString().slice(0, 10);

const toCertificateSummary = (record: CertificateRecord): MyCertificateSummary => {
  const { activity } = record.attendance;

  return {
    id: record.id,
    code: record.code,
    issuedAt: record.issuedAt.toISOString(),
    activity: {
      id: activity.id,
      name: activity.name,
      date: formatDate(activity.date),
      type: activity.type,
    },
    eventProgram: activity.eventProgram,
  };
};

const buildIssuedAtFilter = (
  query: ListMyCertificatesQuery,
): { gte?: Date; lt?: Date } | undefined => {
  if (!query.issuedFrom && !query.issuedTo) {
    return undefined;
  }

  return {
    ...(query.issuedFrom ? { gte: getInstitutionalDayRange(query.issuedFrom).start } : {}),
    ...(query.issuedTo ? { lt: getInstitutionalDayRange(query.issuedTo).endExclusive } : {}),
  };
};

export const listMyCertificates = async (
  userId: string,
  query: ListMyCertificatesQuery,
): Promise<PaginatedMyCertificates> => {
  const prisma = getPrismaClient();
  const issuedAt = buildIssuedAtFilter(query);

  const where = {
    attendance: {
      userId,
      ...(query.activityId ? { activityId: query.activityId } : {}),
      ...(query.eventProgramId ? { activity: { eventProgramId: query.eventProgramId } } : {}),
    },
    ...(issuedAt ? { issuedAt } : {}),
  };

  const skip = (query.page - 1) * query.limit;

  const [records, total] = await Promise.all([
    prisma.certificate.findMany({
      where,
      orderBy: [{ issuedAt: 'desc' }, { id: 'asc' }],
      skip,
      take: query.limit,
      select: certificateSelect,
    }),
    prisma.certificate.count({ where }),
  ]);

  return {
    items: records.map((record) => toCertificateSummary(record)),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  };
};
