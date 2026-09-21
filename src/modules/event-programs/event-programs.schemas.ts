import { z } from 'zod';

import type {
  EventProgramDetail,
  EventProgramPublicDetail,
  PaginatedEventPrograms,
} from './event-programs.types.js';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const isValidCalendarDate = (value: string): boolean => {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year as number, (month as number) - 1, day as number));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === (month as number) - 1 &&
    date.getUTCDate() === day
  );
};

const institutionalDateSchema = z
  .string()
  .regex(datePattern, 'Date must be in YYYY-MM-DD format.')
  .refine(isValidCalendarDate, 'Date must be a valid calendar date.');

const eventProgramIdSchema = z
  .string()
  .trim()
  .min(1, 'Event program id is required.')
  .max(100, 'Event program id cannot exceed 100 characters.');

export const eventProgramParamsSchema = z.object({
  params: z.object({ id: eventProgramIdSchema }),
});

export type EventProgramParams = z.infer<typeof eventProgramParamsSchema>['params'];

export const listEventProgramsQuerySchema = z.object({
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
        .max(50, 'Limit cannot exceed 50.')
        .default(20),
      organizationalUnitId: z.string().trim().min(1, 'Organizational unit is invalid.').optional(),
      unitType: z.enum(['FACULTY', 'SUBDIRECTORATE'], 'Unit type is invalid.').optional(),
      status: z
        .enum(
          ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED', 'ALL'],
          'Status is invalid.',
        )
        .optional(),
      q: z
        .string()
        .trim()
        .min(1, 'Search term cannot be empty.')
        .max(200, 'Search term cannot exceed 200 characters.')
        .optional(),
    })
    .strict(),
});

export type ListEventProgramsQuery = z.infer<typeof listEventProgramsQuerySchema>['query'];

export const createEventProgramSchema = z.object({
  body: z
    .object({
      name: z
        .string()
        .trim()
        .min(1, 'Name is required.')
        .max(200, 'Name cannot exceed 200 characters.'),
      description: z
        .string()
        .trim()
        .max(2000, 'Description cannot exceed 2000 characters.')
        .nullish(),
      label: z.string().trim().max(100, 'Label cannot exceed 100 characters.').nullish(),
      bannerUrl: z.string().url('Banner URL must be a valid URL.').max(500).nullish(),
      startDate: institutionalDateSchema,
      endDate: institutionalDateSchema,
      organizationalUnitId: z.string().trim().min(1, 'Organizational unit is required.'),
    })
    .strict()
    .refine((value) => value.endDate >= value.startDate, {
      message: 'End date must be on or after start date.',
      path: ['endDate'],
    }),
});

export type CreateEventProgramBody = z.infer<typeof createEventProgramSchema>['body'];

export const updateEventProgramSchema = z.object({
  params: z.object({ id: eventProgramIdSchema }),
  body: z
    .object({
      name: z
        .string()
        .trim()
        .min(1, 'Name is required.')
        .max(200, 'Name cannot exceed 200 characters.')
        .optional(),
      description: z
        .string()
        .trim()
        .max(2000, 'Description cannot exceed 2000 characters.')
        .nullish(),
      label: z.string().trim().max(100, 'Label cannot exceed 100 characters.').nullish(),
      bannerUrl: z.string().url('Banner URL must be a valid URL.').max(500).nullish(),
      startDate: institutionalDateSchema.optional(),
      endDate: institutionalDateSchema.optional(),
      status: z
        .literal('ACTIVE', 'Only the ACTIVE status can be set through this endpoint.')
        .optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
      message: 'At least one field must be provided.',
    })
    .refine((value) => !value.startDate || !value.endDate || value.endDate >= value.startDate, {
      message: 'End date must be on or after start date.',
      path: ['endDate'],
    }),
});

export type UpdateEventProgramBody = z.infer<typeof updateEventProgramSchema>['body'];

const eventProgramOrganizationalUnitSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.enum(['FACULTY', 'SUBDIRECTORATE']),
  })
  .meta({
    id: 'EventProgramOrganizationalUnit',
    description: 'Organizational unit that owns the event program.',
  });

const eventProgramDetailShape = {
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  label: z.string().nullable(),
  bannerUrl: z.string().nullable(),
  isDefault: z.boolean(),
  status: z.enum(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED']),
  startDate: z.string().nullable().meta({ description: 'Start date in YYYY-MM-DD format.' }),
  endDate: z.string().nullable().meta({ description: 'End date in YYYY-MM-DD format.' }),
  organizationalUnit: eventProgramOrganizationalUnitSchema,
};

export const eventProgramDetailSchema = z.object(eventProgramDetailShape).meta({
  id: 'EventProgramDetail',
  description: 'Event program detail returned by the event program endpoints.',
}) satisfies z.ZodType<EventProgramDetail>;

const eventProgramActivityCountSchema = z
  .object({
    visible: z.number().int().nonnegative(),
    total: z.number().int().nonnegative().optional(),
    byStatus: z
      .object({
        DRAFT: z.number().int().nonnegative(),
        SCHEDULED: z.number().int().nonnegative(),
        ONGOING: z.number().int().nonnegative(),
        COMPLETED: z.number().int().nonnegative(),
        CANCELLED: z.number().int().nonnegative(),
      })
      .optional(),
  })
  .meta({
    id: 'EventProgramActivityCount',
    description:
      'Activity count for an event program. Anonymous callers only receive the public visible count; authorized callers also receive the total and the per-status breakdown.',
  });

export const eventProgramPublicDetailSchema = z
  .object({
    ...eventProgramDetailShape,
    activityCount: eventProgramActivityCountSchema,
  })
  .meta({
    id: 'EventProgramPublicDetail',
    description: 'Public event program detail including activity counts.',
  }) satisfies z.ZodType<EventProgramPublicDetail>;

export const paginatedEventProgramsSchema = z
  .object({
    items: z.array(eventProgramDetailSchema),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .meta({
    id: 'PaginatedEventPrograms',
    description: 'Paginated list of active event programs.',
  }) satisfies z.ZodType<PaginatedEventPrograms>;
