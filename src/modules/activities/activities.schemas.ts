import { z } from 'zod';

import type {
  ActivityDetail,
  ActivityListItem,
  EventProgramActivityItem,
  PaginatedActivities,
  PaginatedEventProgramActivities,
} from './activities.types.js';

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

export const activityParamsSchema = z.object({
  params: z.object({
    id: z
      .string()
      .trim()
      .min(1, 'Activity id is required.')
      .max(100, 'Activity id cannot exceed 100 characters.'),
  }),
});

export type ActivityParams = z.infer<typeof activityParamsSchema>['params'];

export const cancelActivityBodySchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1, 'Reason cannot be empty.')
      .max(500, 'Reason cannot exceed 500 characters.')
      .optional(),
  })
  .strict();

export const cancelActivitySchema = z.object({
  params: activityParamsSchema.shape.params,
  body: cancelActivityBodySchema.optional().default({}),
});

export type CancelActivityBody = z.infer<typeof cancelActivityBodySchema>;

const activitySpeakerSummarySchema = z
  .object({ id: z.string(), firstName: z.string(), lastName: z.string() })
  .meta({ id: 'ActivitySpeakerSummary', description: 'Public speaker summary of an activity.' });

const activitySpeakerInputSchema = z
  .object({
    firstName: z
      .string()
      .trim()
      .min(1, 'First name is required.')
      .max(100, 'First name cannot exceed 100 characters.'),
    lastName: z
      .string()
      .trim()
      .min(1, 'Last name is required.')
      .max(100, 'Last name cannot exceed 100 characters.'),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email('Email must be a valid email.')
      .max(254, 'Email cannot exceed 254 characters.')
      .nullish(),
    organization: z
      .string()
      .trim()
      .max(150, 'Organization cannot exceed 150 characters.')
      .nullish(),
  })
  .strict()
  .meta({
    id: 'ActivitySpeakerInput',
    description: 'Inline speaker data accepted when creating an activity.',
  });

const uniqueSpeakerEmails = (
  speakers: readonly { email?: string | null | undefined }[],
): boolean => {
  const emails = speakers
    .map((speaker) => speaker.email)
    .filter((email): email is string => typeof email === 'string');

  return new Set(emails).size === emails.length;
};

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

const activityListItemShape = {
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
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
  date: z.string().meta({ description: 'Institutional date in YYYY-MM-DD format.' }),
  startTime: z.string().meta({ description: 'Institutional start time in HH:mm format.' }),
  endTime: z.string().meta({ description: 'Institutional end time in HH:mm format.' }),
  capacity: z.number().int().nullable(),
  bannerUrl: z.string().nullable(),
  speakers: z.array(activitySpeakerSummarySchema),
  classroom: activityClassroomSummarySchema.nullable(),
  eventProgram: activityProgramSummarySchema,
  organizationalUnit: activityOrganizationalUnitSchema,
};

export const activityListItemSchema = z.object(activityListItemShape).meta({
  id: 'ActivityListItem',
  description: 'Activity as returned by the upcoming activities listing.',
}) satisfies z.ZodType<ActivityListItem>;

export const eventProgramActivityItemSchema = z
  .object({
    ...activityListItemShape,
    status: z.enum(['DRAFT', 'SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED']).meta({
      description: 'Activity lifecycle status.',
    }),
  })
  .meta({
    id: 'EventProgramActivityItem',
    description: 'Activity of an event program including its lifecycle status.',
  }) satisfies z.ZodType<EventProgramActivityItem>;

export const paginatedEventProgramActivitiesSchema = z
  .object({
    items: z.array(eventProgramActivityItemSchema),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .meta({
    id: 'PaginatedEventProgramActivities',
    description: 'Paginated list of event program activities.',
  }) satisfies z.ZodType<PaginatedEventProgramActivities>;

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

const programActivityStatuses = [
  'DRAFT',
  'SCHEDULED',
  'ONGOING',
  'COMPLETED',
  'CANCELLED',
  'ALL',
] as const;

export const eventProgramActivitiesQuerySchema = z
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
    status: z.enum(programActivityStatuses, 'Status is invalid.').optional(),
    type: z
      .enum(
        ['WORKSHOP', 'SEMINAR', 'TALK', 'CONFERENCE', 'PANEL', 'COURSE', 'COMPETITION', 'OTHER'],
        'Type is invalid.',
      )
      .optional(),
    q: z
      .string()
      .trim()
      .min(1, 'Search term cannot be empty.')
      .max(200, 'Search term cannot exceed 200 characters.')
      .optional(),
    dateFrom: z
      .string()
      .regex(datePattern, 'Date from must be in YYYY-MM-DD format.')
      .refine(isValidCalendarDate, 'Date from must be a valid calendar date.')
      .optional(),
    dateTo: z
      .string()
      .regex(datePattern, 'Date to must be in YYYY-MM-DD format.')
      .refine(isValidCalendarDate, 'Date to must be a valid calendar date.')
      .optional(),
  })
  .strict();

export const listEventProgramActivitiesQuerySchema = eventProgramActivitiesQuerySchema.refine(
  (value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo,
  { message: 'dateFrom cannot be after dateTo.', path: ['dateTo'] },
);

export const eventProgramActivitiesParamsSchema = z.object({
  params: z.object({
    id: z
      .string()
      .trim()
      .min(1, 'Event program id is required.')
      .max(100, 'Event program id cannot exceed 100 characters.'),
  }),
});

export type EventProgramActivitiesParams = z.infer<
  typeof eventProgramActivitiesParamsSchema
>['params'];

export const listEventProgramActivitiesSchema = z.object({
  params: eventProgramActivitiesParamsSchema.shape.params,
  query: listEventProgramActivitiesQuerySchema,
});

export type ListEventProgramActivitiesQuery = z.infer<typeof eventProgramActivitiesQuerySchema>;

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
      type: z.enum(
        ['WORKSHOP', 'SEMINAR', 'TALK', 'CONFERENCE', 'PANEL', 'COURSE', 'COMPETITION', 'OTHER'],
        'Type is invalid.',
      ),
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
      speakers: z
        .array(activitySpeakerInputSchema)
        .max(10, 'No more than 10 speakers are allowed.')
        .refine(uniqueSpeakerEmails, 'Speaker emails must be unique.')
        .optional(),
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

export const updateActivitySchema = z.object({
  params: activityParamsSchema.shape.params,
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
      type: z
        .enum(
          ['WORKSHOP', 'SEMINAR', 'TALK', 'CONFERENCE', 'PANEL', 'COURSE', 'COMPETITION', 'OTHER'],
          'Type is invalid.',
        )
        .optional(),
      date: z
        .string()
        .regex(datePattern, 'Date must be in YYYY-MM-DD format.')
        .refine(isValidCalendarDate, 'Date must be a valid calendar date.')
        .optional(),
      startTime: z.string().regex(timePattern, 'Start time must be in HH:mm format.').optional(),
      endTime: z.string().regex(timePattern, 'End time must be in HH:mm format.').optional(),
      maxCapacity: z
        .number('Capacity must be a number.')
        .int('Capacity must be an integer.')
        .positive('Capacity must be greater than 0.')
        .max(100000, 'Capacity is too large.')
        .nullish(),
      bannerUrl: z.string().url('Banner URL must be a valid URL.').max(500).nullish(),
      classroomId: z
        .string()
        .trim()
        .min(1, 'Classroom identifier is invalid.')
        .max(100, 'Classroom identifier cannot exceed 100 characters.')
        .nullish(),
      status: z.enum(['DRAFT', 'SCHEDULED'], 'Status is invalid.').optional(),
      speakers: z
        .array(activitySpeakerInputSchema)
        .max(10, 'No more than 10 speakers are allowed.')
        .refine(uniqueSpeakerEmails, 'Speaker emails must be unique.')
        .optional(),
      equipment: z
        .array(z.string().trim().min(1, 'Equipment name cannot be empty.').max(255))
        .max(20, 'No more than 20 equipment items are allowed.')
        .refine((items) => new Set(items).size === items.length, 'Equipment items must be unique.')
        .optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
      message: 'At least one field must be provided.',
    })
    .refine((value) => !value.startTime || !value.endTime || value.endTime > value.startTime, {
      message: 'End time must be after start time.',
      path: ['endTime'],
    }),
});

export type UpdateActivityBody = z.infer<typeof updateActivitySchema>['body'];

export const activityDetailSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
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
    date: z.string().meta({ description: 'Institutional date in YYYY-MM-DD format.' }),
    startTime: z.string().meta({ description: 'Institutional start time in HH:mm format.' }),
    endTime: z.string().meta({ description: 'Institutional end time in HH:mm format.' }),
    capacity: z.number().int().nullable(),
    bannerUrl: z.string().nullable(),
    status: z.enum(['DRAFT', 'SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED']).meta({
      description: 'Activity lifecycle status.',
    }),
    cancelReason: z
      .string()
      .nullable()
      .meta({ description: 'Reason recorded when the activity was cancelled; null otherwise.' }),
    equipment: z.array(z.string()).meta({ description: 'Required equipment names.' }),
    enrolledCount: z.number().int().nonnegative().meta({
      description: 'Registered attendees of the activity.',
    }),
    checkedInCount: z.number().int().nonnegative().meta({
      description: 'Registered attendees who completed check-in.',
    }),
    speakers: z.array(activitySpeakerSummarySchema),
    classroom: activityClassroomSummarySchema.nullable(),
    eventProgram: activityProgramSummarySchema,
    organizationalUnit: activityOrganizationalUnitSchema,
  })
  .meta({
    id: 'ActivityDetail',
    description:
      'Activity detail with speakers, classroom, equipment, program and attendance counts. Never exposes check-in codes.',
  }) satisfies z.ZodType<ActivityDetail>;
