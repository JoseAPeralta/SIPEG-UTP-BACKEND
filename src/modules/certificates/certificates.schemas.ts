import { z } from 'zod';

import type { MyCertificateSummary, PaginatedMyCertificates } from './certificates.types.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_ID_FILTER_LENGTH = 100;

const idFilterSchema = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(MAX_ID_FILTER_LENGTH, `${label} cannot exceed ${MAX_ID_FILTER_LENGTH} characters.`);

const dateFilterSchema = (label: string) => z.iso.date(`${label} must be in YYYY-MM-DD format.`);

export const listMyCertificatesQuerySchema = z.object({
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
      eventProgramId: idFilterSchema('Event program id').optional(),
      activityId: idFilterSchema('Activity id').optional(),
      issuedFrom: dateFilterSchema('issuedFrom').optional(),
      issuedTo: dateFilterSchema('issuedTo').optional(),
    })
    .strict()
    .refine((query) => !query.issuedFrom || !query.issuedTo || query.issuedFrom <= query.issuedTo, {
      message: 'issuedFrom cannot be after issuedTo.',
      path: ['issuedTo'],
    }),
});

export type ListMyCertificatesQuery = z.infer<typeof listMyCertificatesQuerySchema>['query'];

export const certificateActivitySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    date: z.string().meta({ description: 'Institutional date in YYYY-MM-DD format.' }),
    type: z.enum([
      'WORKSHOP',
      'SEMINAR',
      'TALK',
      'CONFERENCE',
      'PANEL',
      'COURSE',
      'COMPETITION',
      'OTHER',
    ]),
  })
  .meta({
    id: 'CertificateActivity',
    description: 'Activity the certificate attests.',
  });

export const certificateEventProgramSchema = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .meta({
    id: 'CertificateEventProgram',
    description: 'Event program that owns the activity the certificate attests.',
  });

export const certificateSummarySchema = z
  .object({
    id: z.string().meta({ description: 'Certificate identifier.' }),
    code: z.string().meta({ description: 'Unique certificate code shown on the document.' }),
    issuedAt: z.iso
      .datetime({ offset: true })
      .meta({ description: 'Instant of issuance, in UTC.' }),
    activity: certificateActivitySchema,
    eventProgram: certificateEventProgramSchema,
  })
  .meta({
    id: 'CertificateSummary',
    description:
      'Certificate owned by the authenticated user. Storage paths and attendance internals are not exposed.',
  }) satisfies z.ZodType<MyCertificateSummary>;

export const paginatedMyCertificatesSchema = z
  .object({
    items: z.array(certificateSummarySchema).meta({
      description: 'Certificates, most recently issued first.',
    }),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .meta({
    id: 'PaginatedMyCertificates',
    description:
      'Paginated list of the authenticated user certificates, ordered by issuedAt descending.',
  }) satisfies z.ZodType<PaginatedMyCertificates>;
