import { z } from 'zod';

import { getLogContext } from '../../lib/log-context.js';
import { ApiError } from '../../utils/ApiError.js';
import { getPrismaClient } from '../../config/prisma.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { ListAuditEventsQuery } from './audit.schemas.js';
import {
  isAllowedMetadataKey,
  isAllowedSnapshotKey,
  looksLikeSecret,
  type AuditEventInput,
  type AuditEventPage,
  type AuditEventResponse,
  type AuditReadChanges,
  type AuditScalar,
  type AuditSnapshotValue,
  type AuditValue,
} from './audit.types.js';

export type AuditTransactionClient = Prisma.TransactionClient;

const assertScalarValue = (key: string, value: AuditSnapshotValue): void => {
  if (value === null) {
    return;
  }

  if (typeof value === 'string' && looksLikeSecret(value)) {
    throw new ApiError(500, `Audit payload value for '${key}' is not allowed.`);
  }
};

const assertSnapshotRecord = (
  record: Record<string, AuditSnapshotValue>,
  isAllowed: (key: string) => boolean,
): void => {
  for (const [key, value] of Object.entries(record)) {
    if (!isAllowed(key)) {
      throw new ApiError(500, `Audit payload key '${key}' is not allowed.`);
    }

    if (looksLikeSecret(key)) {
      throw new ApiError(500, `Audit payload key '${key}' is not allowed.`);
    }

    if (Array.isArray(value)) {
      value.forEach((item) => assertScalarValue(key, item));
      continue;
    }

    assertScalarValue(key, value);
  }
};

const assertAuditPayload = (input: AuditEventInput): void => {
  if (input.changes?.before) {
    assertSnapshotRecord(input.changes.before, isAllowedSnapshotKey);
  }

  if (input.changes?.after) {
    assertSnapshotRecord(input.changes.after, isAllowedSnapshotKey);
  }

  if (input.metadata) {
    assertSnapshotRecord(input.metadata, isAllowedMetadataKey);
  }
};

const definedEntries = (
  record: Record<string, AuditScalar | AuditScalar[]>,
): Record<string, AuditScalar | AuditScalar[]> =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));

const toChangesPayload = (input: AuditEventInput): Prisma.InputJsonValue | typeof Prisma.DbNull => {
  if (!input.changes) {
    return Prisma.DbNull;
  }

  const payload: Record<string, Record<string, AuditScalar | AuditScalar[]>> = {};

  if (input.changes.before) {
    payload['before'] = definedEntries(input.changes.before);
  }

  if (input.changes.after) {
    payload['after'] = definedEntries(input.changes.after);
  }

  return payload as unknown as Prisma.InputJsonValue;
};

const toMetadataPayload = (input: AuditEventInput): Prisma.InputJsonValue | typeof Prisma.DbNull =>
  input.metadata
    ? (definedEntries(input.metadata) as unknown as Prisma.InputJsonValue)
    : Prisma.DbNull;

export const writeAuditEvent = async (
  tx: AuditTransactionClient,
  input: AuditEventInput,
): Promise<void> => {
  assertAuditPayload(input);

  const ambient = getLogContext();
  const actorId = input.actorId ?? ambient.actorId;

  await tx.auditEvent.create({
    data: {
      action: input.action,
      actorType: input.actorType ?? (actorId ? 'USER' : 'ANONYMOUS'),
      actorId: actorId ?? null,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      scopeType: input.scopeType ?? null,
      scopeId: input.scopeId ?? null,
      targetUserId: input.targetUserId ?? null,
      requestId: input.requestId ?? ambient.requestId ?? null,
      changes: toChangesPayload(input),
      metadata: toMetadataPayload(input),
    },
  });
};

const auditListSelect = {
  id: true,
  action: true,
  occurredAt: true,
  actorType: true,
  actorId: true,
  resourceType: true,
  resourceId: true,
  scopeType: true,
  scopeId: true,
  targetUserId: true,
  requestId: true,
  changes: true,
  metadata: true,
} as const;

type AuditListRow = Prisma.AuditEventGetPayload<{ select: typeof auditListSelect }>;

const auditCursorSchema = z.object({
  t: z.iso.datetime({ offset: true }),
  i: z.string().min(1).max(100),
});

const encodeAuditCursor = (row: { id: string; occurredAt: Date }): string =>
  Buffer.from(JSON.stringify({ t: row.occurredAt.toISOString(), i: row.id }), 'utf8').toString(
    'base64url',
  );

const decodeAuditCursor = (cursor: string): { occurredAt: Date; id: string } => {
  const payload = ((): unknown => {
    try {
      return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    } catch {
      return null;
    }
  })();
  const parsed = auditCursorSchema.safeParse(payload);

  if (!parsed.success) {
    throw new ApiError(400, 'Invalid cursor.');
  }

  return { occurredAt: new Date(parsed.data.t), id: parsed.data.i };
};

const isJsonObject = (value: Prisma.JsonValue | null | undefined): value is Prisma.JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toAuditValueRecord = (value: Prisma.JsonObject): Record<string, AuditValue> =>
  Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, Prisma.JsonValue] => entry[1] !== undefined)
      .map(([key, item]) => [key, item as AuditValue]),
  );

const toAuditChanges = (value: Prisma.JsonObject): AuditReadChanges => {
  const changes: AuditReadChanges = {};

  if (isJsonObject(value['before'])) {
    changes.before = toAuditValueRecord(value['before']);
  }

  if (isJsonObject(value['after'])) {
    changes.after = toAuditValueRecord(value['after']);
  }

  return changes;
};

const toAuditEventResponse = (row: AuditListRow): AuditEventResponse => ({
  id: row.id,
  action: row.action,
  occurredAt: row.occurredAt.toISOString(),
  actorType: row.actorType,
  actorId: row.actorId,
  resourceType: row.resourceType,
  resourceId: row.resourceId,
  scopeType: row.scopeType,
  scopeId: row.scopeId,
  targetUserId: row.targetUserId,
  requestId: row.requestId,
  changes: isJsonObject(row.changes) ? toAuditChanges(row.changes) : null,
  metadata: isJsonObject(row.metadata) ? toAuditValueRecord(row.metadata) : null,
});

const toAuditEventFilters = (query: ListAuditEventsQuery): Prisma.AuditEventWhereInput[] => {
  const filters: Prisma.AuditEventWhereInput[] = [];

  if (query.action) {
    filters.push({ action: query.action });
  }

  if (query.actorId) {
    filters.push({ actorId: query.actorId });
  }

  if (query.resourceType) {
    filters.push({ resourceType: query.resourceType });
  }

  if (query.resourceId) {
    filters.push({ resourceId: query.resourceId });
  }

  if (query.scopeType) {
    filters.push({ scopeType: query.scopeType });
  }

  if (query.scopeId) {
    filters.push({ scopeId: query.scopeId });
  }

  if (query.from || query.to) {
    filters.push({
      occurredAt: {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      },
    });
  }

  if (query.cursor) {
    const { occurredAt, id } = decodeAuditCursor(query.cursor);

    filters.push({ OR: [{ occurredAt: { lt: occurredAt } }, { occurredAt, id: { lt: id } }] });
  }

  return filters;
};

export const listAuditEvents = async (query: ListAuditEventsQuery): Promise<AuditEventPage> => {
  const filters = toAuditEventFilters(query);

  const rows = await getPrismaClient().auditEvent.findMany({
    where: filters.length > 0 ? { AND: filters } : {},
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    select: auditListSelect,
  });

  const hasMore = rows.length > query.limit;
  const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
  const lastRow = pageRows.at(-1);

  return {
    items: pageRows.map(toAuditEventResponse),
    limit: query.limit,
    hasMore,
    nextCursor: hasMore && lastRow ? encodeAuditCursor(lastRow) : null,
  };
};
