import { z } from 'zod';

import type { AlertResponse, MarkAllAlertsReadResult, PaginatedAlerts } from './alerts.types.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_ID_LENGTH = 100;

export const alertTypeSchema = z.enum(
  [
    'PROPOSAL_RECEIVED',
    'PROPOSAL_UPDATED',
    'PROPOSAL_RESPONDED',
    'PROGRAM_UPDATED',
    'PROGRAM_ARCHIVED',
    'ACTIVITY_UPDATED',
    'ACTIVITY_CANCELLED',
    'CERTIFICATE_ISSUED',
  ],
  'Alert type is invalid.',
);

const alertIdSchema = z
  .string()
  .trim()
  .min(1, 'Alert id is required.')
  .max(MAX_ID_LENGTH, `Alert id cannot exceed ${MAX_ID_LENGTH} characters.`);

export const listAlertsQuerySchema = z.object({
  query: z
    .object({
      page: z.coerce
        .number('Page must be a number.')
        .int('Page must be an integer.')
        .min(1, 'Page must be at least 1.')
        .default(1),
      limit: z.coerce
        .number('Limit must be a number.')
        .int('Limit must be an integer.')
        .min(1, 'Limit must be at least 1.')
        .max(MAX_PAGE_SIZE, `Limit cannot exceed ${MAX_PAGE_SIZE}.`)
        .default(DEFAULT_PAGE_SIZE),
      isRead: z
        .enum(['true', 'false'], 'Status must be true or false.')
        .transform((value) => value === 'true')
        .optional(),
      type: alertTypeSchema.optional(),
    })
    .strict(),
});

export type ListAlertsQuery = z.infer<typeof listAlertsQuerySchema>['query'];

export const alertParamsSchema = z.object({
  params: z.object({ id: alertIdSchema }),
});

export type AlertParams = z.infer<typeof alertParamsSchema>['params'];

const emptyBodySchema = z.object({}).strict().optional();

export const markAlertReadSchema = z.object({
  params: z.object({ id: alertIdSchema }),
  body: emptyBodySchema,
});

export const markAllAlertsReadSchema = z.object({
  body: emptyBodySchema,
});

export type MarkAlertReadBody = z.infer<typeof markAlertReadSchema>['body'];

export const alertTargetSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('PROPOSAL'), id: z.string() }),
    z.object({ kind: z.literal('EVENT_PROGRAM'), id: z.string() }),
    z.object({ kind: z.literal('ACTIVITY'), id: z.string() }),
    z.object({ kind: z.literal('CERTIFICATE'), id: z.string() }),
  ])
  .meta({
    id: 'AlertTarget',
    description: 'Discriminated reference to the domain object the alert is about.',
  });

export const alertSchema = z
  .object({
    id: z.string().meta({ description: 'Alert identifier.' }),
    type: alertTypeSchema,
    isRead: z.boolean().meta({ description: 'Whether the recipient already read the alert.' }),
    createdAt: z.iso.datetime({ offset: true }).meta({ description: 'Creation instant, in UTC.' }),
    target: alertTargetSchema,
  })
  .meta({
    id: 'Alert',
    description:
      'Alert owned by the authenticated user. The recipient and the internal target columns are not exposed.',
  }) satisfies z.ZodType<AlertResponse>;

export const paginatedAlertsSchema = z
  .object({
    items: z.array(alertSchema).meta({ description: 'Alerts, most recent first.' }),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .meta({
    id: 'PaginatedAlerts',
    description:
      'Paginated list of the authenticated user alerts, ordered by createdAt descending.',
  }) satisfies z.ZodType<PaginatedAlerts>;

export const markAllAlertsReadResultSchema = z
  .object({
    updatedCount: z
      .number()
      .int()
      .meta({ description: 'Number of alerts switched from unread to read.' }),
  })
  .meta({
    id: 'MarkAllAlertsReadResult',
    description: 'Result of marking every unread alert of the authenticated user as read.',
  }) satisfies z.ZodType<MarkAllAlertsReadResult>;
