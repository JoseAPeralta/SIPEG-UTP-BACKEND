import { getPrismaClient } from '../../config/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { AlertType } from '../../generated/prisma/enums.js';
import type { ListAlertsQuery } from './alerts.schemas.js';
import type {
  AlertResponse,
  AlertTarget,
  CreateAlertInput,
  MarkAllAlertsReadResult,
  PaginatedAlerts,
} from './alerts.types.js';

export type AlertTransactionClient = Prisma.TransactionClient;

const alertSelect = {
  id: true,
  type: true,
  isRead: true,
  createdAt: true,
  proposalId: true,
  eventProgramId: true,
  activityId: true,
  certificateId: true,
} as const;

interface AlertRecord {
  id: string;
  type: AlertType;
  isRead: boolean;
  createdAt: Date;
  proposalId: string | null;
  eventProgramId: string | null;
  activityId: string | null;
  certificateId: string | null;
}

const toAlertTarget = (record: AlertRecord): AlertTarget => {
  if (record.proposalId) {
    return { kind: 'PROPOSAL', id: record.proposalId };
  }

  if (record.eventProgramId) {
    return { kind: 'EVENT_PROGRAM', id: record.eventProgramId };
  }

  if (record.activityId) {
    return { kind: 'ACTIVITY', id: record.activityId };
  }

  if (record.certificateId) {
    return { kind: 'CERTIFICATE', id: record.certificateId };
  }

  throw new ApiError(500, 'Alert target is missing.');
};

const toAlertResponse = (record: AlertRecord): AlertResponse => ({
  id: record.id,
  type: record.type,
  isRead: record.isRead,
  createdAt: record.createdAt.toISOString(),
  target: toAlertTarget(record),
});

const isRecordNotFound = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2025';

export const listAlerts = async (
  recipientId: string,
  query: ListAlertsQuery,
): Promise<PaginatedAlerts> => {
  const prisma = getPrismaClient();

  const where = {
    recipientId,
    ...(query.isRead === undefined ? {} : { isRead: query.isRead }),
    ...(query.type ? { type: query.type } : {}),
  };

  const skip = (query.page - 1) * query.limit;

  const [records, total] = await Promise.all([
    prisma.alert.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip,
      take: query.limit,
      select: alertSelect,
    }),
    prisma.alert.count({ where }),
  ]);

  return {
    items: records.map((record) => toAlertResponse(record)),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  };
};

export const getAlertById = async (
  recipientId: string,
  alertId: string,
): Promise<AlertResponse> => {
  const record = await getPrismaClient().alert.findUnique({
    where: { id: alertId, recipientId },
    select: alertSelect,
  });

  if (!record) {
    throw new ApiError(404, 'Alert not found.');
  }

  return toAlertResponse(record);
};

export const markAlertRead = async (
  recipientId: string,
  alertId: string,
): Promise<AlertResponse> => {
  try {
    const record = await getPrismaClient().alert.update({
      where: { id: alertId, recipientId },
      data: { isRead: true },
      select: alertSelect,
    });

    return toAlertResponse(record);
  } catch (error) {
    if (isRecordNotFound(error)) {
      throw new ApiError(404, 'Alert not found.');
    }

    throw error;
  }
};

export const markAllAlertsRead = async (recipientId: string): Promise<MarkAllAlertsReadResult> => {
  const result = await getPrismaClient().alert.updateMany({
    where: { recipientId, isRead: false },
    data: { isRead: true },
  });

  return { updatedCount: result.count };
};

const toTargetData = (
  target: CreateAlertInput['target'],
):
  | { proposalId: string }
  | { eventProgramId: string }
  | { activityId: string }
  | { certificateId: string } => {
  switch (target.kind) {
    case 'PROPOSAL':
      return { proposalId: target.id };
    case 'EVENT_PROGRAM':
      return { eventProgramId: target.id };
    case 'ACTIVITY':
      return { activityId: target.id };
    case 'CERTIFICATE':
      return { certificateId: target.id };
  }
};

export const createAlert = async (
  tx: AlertTransactionClient,
  input: CreateAlertInput,
): Promise<void> => {
  await tx.alert.create({
    data: {
      recipientId: input.recipientId,
      type: input.type,
      ...toTargetData(input.target),
    },
  });
};
