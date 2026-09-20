import { z } from 'zod';

import type { CareerSummary, PaginatedCareers } from './careers.types.js';

const careerCodeSchema = z
  .string()
  .trim()
  .min(2, 'Code must be at least 2 characters.')
  .max(20, 'Code cannot exceed 20 characters.')
  .regex(/^[A-Za-z0-9-]+$/, 'Code may only contain letters, numbers and hyphens.')
  .transform((value) => value.toUpperCase());

const careerIdSchema = z
  .string()
  .trim()
  .min(1, 'Career id is required.')
  .max(100, 'Career id cannot exceed 100 characters.');

const unitIdSchema = z
  .string()
  .trim()
  .min(1, 'Organizational unit id is required.')
  .max(100, 'Organizational unit id cannot exceed 100 characters.');

export const listCareersQuerySchema = z.object({
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
      unitId: z
        .string()
        .trim()
        .min(1, 'Organizational unit filter cannot be empty.')
        .max(100, 'Organizational unit filter cannot exceed 100 characters.')
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

export type ListCareersQuery = z.infer<typeof listCareersQuerySchema>['query'];

export const careerParamsSchema = z.object({
  params: z.object({ id: careerIdSchema }),
});

export type CareerParams = z.infer<typeof careerParamsSchema>['params'];

export const createCareerSchema = z.object({
  body: z
    .object({
      name: z
        .string()
        .trim()
        .min(1, 'Name is required.')
        .max(150, 'Name cannot exceed 150 characters.'),
      code: careerCodeSchema,
      description: z
        .string()
        .trim()
        .max(2000, 'Description cannot exceed 2000 characters.')
        .nullish(),
      unitId: unitIdSchema.nullish(),
    })
    .strict(),
});

export type CreateCareerBody = z.infer<typeof createCareerSchema>['body'];

export const updateCareerSchema = z.object({
  params: z.object({ id: careerIdSchema }),
  body: z
    .object({
      name: z
        .string()
        .trim()
        .min(1, 'Name is required.')
        .max(150, 'Name cannot exceed 150 characters.')
        .optional(),
      code: careerCodeSchema.optional(),
      description: z
        .string()
        .trim()
        .max(2000, 'Description cannot exceed 2000 characters.')
        .nullish(),
      unitId: unitIdSchema.nullish(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field must be provided.',
    }),
});

export type UpdateCareerBody = z.infer<typeof updateCareerSchema>['body'];

export const careerUnitSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    code: z.string(),
  })
  .meta({
    id: 'CareerUnit',
    description: 'Minimal reference to the organizational unit that owns a career.',
  });

export const careerSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    code: z.string(),
    description: z.string().nullable(),
    unit: careerUnitSchema.nullable(),
  })
  .meta({
    id: 'CareerSummary',
    description: 'Career catalog entry.',
  }) satisfies z.ZodType<CareerSummary>;

export const paginatedCareersSchema = z
  .object({
    items: z.array(careerSummarySchema),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .meta({
    id: 'PaginatedCareers',
    description: 'Paginated list of careers.',
  }) satisfies z.ZodType<PaginatedCareers>;
