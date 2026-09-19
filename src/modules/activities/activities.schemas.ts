import { z } from 'zod';

import type { ActivityDetail, ActivityListItem, PaginatedActivities } from './activities.types.js';

export const listActivitiesQuerySchema = z.object({
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
    })
    .strict(),
});

export type ListActivitiesQuery = z.infer<typeof listActivitiesQuerySchema>['query'];

const activitySpeakerSummarySchema = z
  .object({ id: z.string(), firstName: z.string(), lastName: z.string() })
  .meta({ id: 'ActivitySpeakerSummary', description: 'Public speaker summary of an activity.' });

const activityClassroomSummarySchema = z
  .object({ id: z.string(), name: z.string(), building: z.string().nullable() })
  .meta({ id: 'ActivityClassroomSummary', description: 'Classroom assigned to an activity.' });

const activityProgramSummarySchema = z
  .object({ id: z.string(), name: z.string(), label: z.string().nullable() })
  .meta({ id: 'ActivityProgramSummary', description: 'Event program that owns the activity.' });

const activityOrganizationalUnitSchema = z
  .object({
    type: z.enum(['FACULTY', 'SUBDIRECTORATE']),
    id: z.string(),
    name: z.string(),
  })
  .meta({
    id: 'ActivityOrganizationalUnit',
    description: 'Organizational unit of the event program.',
  });

export const activityListItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    type: z.enum(['WORKSHOP', 'SEMINAR', 'TALK', 'OTHER']),
    date: z.string().meta({ description: 'Institutional date in YYYY-MM-DD format.' }),
    startTime: z.string().meta({ description: 'Institutional start time in HH:mm format.' }),
    endTime: z.string().meta({ description: 'Institutional end time in HH:mm format.' }),
    capacity: z.number().int().nullable(),
    bannerUrl: z.string().nullable(),
    speaker: activitySpeakerSummarySchema.nullable(),
    classroom: activityClassroomSummarySchema.nullable(),
    eventProgram: activityProgramSummarySchema,
    organizationalUnit: activityOrganizationalUnitSchema,
  })
  .meta({
    id: 'ActivityListItem',
    description: 'Activity as returned by the upcoming activities listing.',
  }) satisfies z.ZodType<ActivityListItem>;

export const paginatedActivitiesSchema = z
  .object({
    items: z.array(activityListItemSchema),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .meta({
    id: 'PaginatedActivities',
    description: 'Paginated list of upcoming activities.',
  }) satisfies z.ZodType<PaginatedActivities>;

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
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

export const createActivitySchema = z.object({
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
      type: z.enum(['WORKSHOP', 'SEMINAR', 'TALK', 'OTHER'], 'Type is invalid.'),
      date: z
        .string()
        .regex(datePattern, 'Date must be in YYYY-MM-DD format.')
        .refine(isValidCalendarDate, 'Date must be a valid calendar date.'),
      startTime: z.string().regex(timePattern, 'Start time must be in HH:mm format.'),
      endTime: z.string().regex(timePattern, 'End time must be in HH:mm format.'),
      maxCapacity: z
        .number('Capacity must be a number.')
        .int('Capacity must be an integer.')
        .positive('Capacity must be greater than 0.')
        .max(100000, 'Capacity is too large.')
        .optional(),
      bannerUrl: z.string().url('Banner URL must be a valid URL.').max(500).nullish(),
      eventProgramId: z.string().trim().min(1, 'Event program is required.'),
      classroomId: z.string().trim().min(1, 'Classroom identifier is invalid.').nullish(),
      speakerId: z.string().trim().min(1, 'Speaker identifier is invalid.').nullish(),
      equipment: z
        .array(z.string().trim().min(1, 'Equipment name cannot be empty.').max(255))
        .max(20, 'No more than 20 equipment items are allowed.')
        .refine((items) => new Set(items).size === items.length, 'Equipment items must be unique.')
        .optional(),
    })
    .strict()
    .refine((value) => value.endTime > value.startTime, {
      message: 'End time must be after start time.',
      path: ['endTime'],
    }),
});

export type CreateActivityBody = z.infer<typeof createActivitySchema>['body'];

export const activityDetailSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    type: z.enum(['WORKSHOP', 'SEMINAR', 'TALK', 'OTHER']),
    date: z.string().meta({ description: 'Institutional date in YYYY-MM-DD format.' }),
    startTime: z.string().meta({ description: 'Institutional start time in HH:mm format.' }),
    endTime: z.string().meta({ description: 'Institutional end time in HH:mm format.' }),
    capacity: z.number().int().nullable(),
    bannerUrl: z.string().nullable(),
    status: z.enum(['DRAFT', 'SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED']).meta({
      description: 'Activity lifecycle status.',
    }),
    equipment: z.array(z.string()).meta({ description: 'Required equipment names.' }),
    speaker: activitySpeakerSummarySchema.nullable(),
    classroom: activityClassroomSummarySchema.nullable(),
    eventProgram: activityProgramSummarySchema,
    organizationalUnit: activityOrganizationalUnitSchema,
  })
  .meta({
    id: 'ActivityDetail',
    description: 'Activity detail returned after creation. Never exposes check-in codes.',
  }) satisfies z.ZodType<ActivityDetail>;
