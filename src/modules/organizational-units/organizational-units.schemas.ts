import { z } from 'zod';

import type {
  OrganizationalUnitDetail,
  OrganizationalUnitSummary,
  PaginatedOrganizationalUnits,
} from './organizational-units.types.js';

const unitTypeSchema = z.enum(['FACULTY', 'SUBDIRECTORATE'], 'Unit type is invalid.');

const unitCodeSchema = z
  .string()
  .trim()
  .min(2, 'Code must be at least 2 characters.')
  .max(20, 'Code cannot exceed 20 characters.')
  .regex(/^[A-Za-z0-9-]+$/, 'Code may only contain letters, numbers and hyphens.')
  .transform((value) => value.toUpperCase());

const unitIdSchema = z
  .string()
  .trim()
  .min(1, 'Organizational unit id is required.')
  .max(100, 'Organizational unit id cannot exceed 100 characters.');

const headIdSchema = z
  .string()
  .trim()
  .min(1, 'Head user id is required.')
  .max(100, 'Head user id cannot exceed 100 characters.');

export const listOrganizationalUnitsQuerySchema = z.object({
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
      type: unitTypeSchema.optional(),
      isActive: z
        .enum(['true', 'false'], 'Status must be true or false.')
        .transform((value) => value === 'true')
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

export type ListOrganizationalUnitsQuery = z.infer<
  typeof listOrganizationalUnitsQuerySchema
>['query'];

export const organizationalUnitParamsSchema = z.object({
  params: z.object({ id: unitIdSchema }),
});

export type OrganizationalUnitParams = z.infer<typeof organizationalUnitParamsSchema>['params'];

export const createOrganizationalUnitSchema = z.object({
  body: z
    .object({
      name: z
        .string()
        .trim()
        .min(1, 'Name is required.')
        .max(150, 'Name cannot exceed 150 characters.'),
      code: unitCodeSchema,
      description: z
        .string()
        .trim()
        .max(2000, 'Description cannot exceed 2000 characters.')
        .nullish(),
      type: unitTypeSchema,
      headId: headIdSchema.nullish(),
    })
    .strict(),
});

export type CreateOrganizationalUnitBody = z.infer<typeof createOrganizationalUnitSchema>['body'];

export const updateOrganizationalUnitSchema = z.object({
  params: z.object({ id: unitIdSchema }),
  body: z
    .object({
      name: z
        .string()
        .trim()
        .min(1, 'Name is required.')
        .max(150, 'Name cannot exceed 150 characters.')
        .optional(),
      description: z
        .string()
        .trim()
        .max(2000, 'Description cannot exceed 2000 characters.')
        .nullish(),
      headId: headIdSchema.nullish(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field must be provided.',
    }),
});

export type UpdateOrganizationalUnitBody = z.infer<typeof updateOrganizationalUnitSchema>['body'];

export const organizationalUnitHeadSchema = z
  .object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
  })
  .meta({
    id: 'OrganizationalUnitHead',
    description: 'Minimal reference to the user in charge of an organizational unit.',
  });

export const organizationalUnitCareerSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    code: z.string(),
  })
  .meta({
    id: 'OrganizationalUnitCareer',
    description: 'Career offered by an organizational unit.',
  });

export const defaultEventProgramSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.enum(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED']),
  })
  .meta({
    id: 'DefaultEventProgram',
    description: 'Permanent default event program owned by an organizational unit.',
  });

export const organizationalUnitSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    code: z.string(),
    description: z.string().nullable(),
    type: z.enum(['FACULTY', 'SUBDIRECTORATE']),
    isActive: z.boolean(),
    head: organizationalUnitHeadSchema.nullable(),
  })
  .meta({
    id: 'OrganizationalUnitSummary',
    description: 'Organizational unit catalog entry.',
  }) satisfies z.ZodType<OrganizationalUnitSummary>;

export const organizationalUnitDetailSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    code: z.string(),
    description: z.string().nullable(),
    type: z.enum(['FACULTY', 'SUBDIRECTORATE']),
    isActive: z.boolean(),
    head: organizationalUnitHeadSchema.nullable(),
    careers: z.array(organizationalUnitCareerSchema),
    defaultProgram: defaultEventProgramSchema.nullable(),
  })
  .meta({
    id: 'OrganizationalUnitDetail',
    description: 'Organizational unit detail with its careers and default event program.',
  }) satisfies z.ZodType<OrganizationalUnitDetail>;

export const paginatedOrganizationalUnitsSchema = z
  .object({
    items: z.array(organizationalUnitSummarySchema),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .meta({
    id: 'PaginatedOrganizationalUnits',
    description: 'Paginated list of organizational units.',
  }) satisfies z.ZodType<PaginatedOrganizationalUnits>;
