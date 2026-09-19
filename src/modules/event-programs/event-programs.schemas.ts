import { z } from 'zod';

import type { EventProgramDetail } from './event-programs.types.js';

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

export const eventProgramDetailSchema = z
  .object({
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
  })
  .meta({
    id: 'EventProgramDetail',
    description: 'Event program detail returned after creation.',
  }) satisfies z.ZodType<EventProgramDetail>;
