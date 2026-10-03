import { z } from 'zod';

import {
  AUDIT_ACTIONS,
  AUDIT_ACTOR_TYPES,
  AUDIT_RESOURCE_TYPES,
  AUDIT_SCOPE_TYPES,
  type AuditEventPage,
  type AuditEventResponse,
} from './audit.types.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_ID_FILTER_LENGTH = 100;
const MAX_CURSOR_LENGTH = 200;

const idFilterSchema = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} cannot be empty.`)
    .max(MAX_ID_FILTER_LENGTH, `${label} cannot exceed ${MAX_ID_FILTER_LENGTH} characters.`);

const instantFilterSchema = (label: string) =>
  z.iso
    .datetime({ offset: true, error: `${label} must be an ISO 8601 datetime.` })
    .transform((value) => new Date(value));

export const listAuditEventsQuerySchema = z.object({
  query: z
    .object({
      action: z.enum(AUDIT_ACTIONS, 'Action is invalid.').optional(),
      resourceType: z.enum(AUDIT_RESOURCE_TYPES, 'Resource type is invalid.').optional(),
      scopeType: z.enum(AUDIT_SCOPE_TYPES, 'Scope type is invalid.').optional(),
      actorId: idFilterSchema('Actor id').optional(),
      resourceId: idFilterSchema('Resource id').optional(),
      scopeId: idFilterSchema('Scope id').optional(),
      from: instantFilterSchema('From').optional(),
      to: instantFilterSchema('To').optional(),
      cursor: z
        .string()
        .trim()
        .min(1, 'Cursor cannot be empty.')
        .max(MAX_CURSOR_LENGTH, `Cursor cannot exceed ${MAX_CURSOR_LENGTH} characters.`)
        .optional(),
      limit: z.coerce
        .number('Limit must be a number.')
        .int('Limit must be an integer.')
        .min(1, 'Limit must be at least 1.')
        .max(MAX_PAGE_SIZE, `Limit cannot exceed ${MAX_PAGE_SIZE}.`)
        .default(DEFAULT_PAGE_SIZE),
    })
    .strict()
    .refine((query) => !query.from || !query.to || query.from <= query.to, {
      message: 'from cannot be after to.',
      path: ['to'],
    }),
});

export type ListAuditEventsQuery = z.infer<typeof listAuditEventsQuerySchema>['query'];

const auditScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const auditValueSchema = z.union([auditScalarSchema, z.array(auditScalarSchema)]);

export const auditChangesSchema = z
  .object({
    before: z.record(z.string(), auditValueSchema).optional(),
    after: z.record(z.string(), auditValueSchema).optional(),
  })
  .nullable()
  .meta({
    id: 'AuditChanges',
    description:
      'Typed before/after snapshot of the audited change. Only allowlisted keys without secrets or personal data are persisted.',
  });

export const auditMetadataSchema = z.record(z.string(), auditValueSchema).nullable().meta({
  id: 'AuditMetadata',
  description: 'Allowlisted metadata that qualifies the audited action.',
});

export const auditEventSchema = z
  .object({
    id: z.string().meta({ description: 'Audit event identifier.' }),
    action: z.string().meta({ description: 'Audited action, from the audit catalog.' }),
    occurredAt: z.iso
      .datetime({ offset: true })
      .meta({ description: 'Instant of the audited change, in UTC.' }),
    actorType: z
      .enum(AUDIT_ACTOR_TYPES)
      .meta({ description: 'Nature of the actor behind the change.' }),
    actorId: z.string().nullable().meta({ description: 'User that performed the change.' }),
    resourceType: z.string().meta({ description: 'Type of the affected resource.' }),
    resourceId: z.string().nullable().meta({ description: 'Identifier of the affected resource.' }),
    scopeType: z
      .string()
      .nullable()
      .meta({ description: 'Collaboration scope type, when present.' }),
    scopeId: z.string().nullable().meta({ description: 'Collaboration scope identifier.' }),
    targetUserId: z
      .string()
      .nullable()
      .meta({ description: 'User the change is about, when different from the actor.' }),
    requestId: z
      .string()
      .nullable()
      .meta({ description: 'Request identifier that correlates the event with the logs.' }),
    changes: auditChangesSchema,
    metadata: auditMetadataSchema,
  })
  .meta({
    id: 'AuditEvent',
    description: 'Single append-only audit record.',
  }) satisfies z.ZodType<AuditEventResponse>;

export const auditEventPageSchema = z
  .object({
    items: z.array(auditEventSchema).meta({ description: 'Audit events, most recent first.' }),
    limit: z.number().int().meta({ description: 'Maximum number of events per page.' }),
    hasMore: z
      .boolean()
      .meta({ description: 'True when more events are available after this page.' }),
    nextCursor: z
      .string()
      .nullable()
      .meta({ description: 'Opaque cursor for the next page, or null on the last page.' }),
  })
  .meta({
    id: 'AuditEventPage',
    description: 'Cursor paginated page of audit events, ordered by occurredAt and id descending.',
  }) satisfies z.ZodType<AuditEventPage>;
