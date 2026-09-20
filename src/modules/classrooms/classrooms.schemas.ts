import { z } from 'zod';

import type { ClassroomDetail, ClassroomSummary, PaginatedClassrooms } from './classrooms.types.js';

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const amenityPattern = /^[\p{L}\p{N}][\p{L}\p{N} -]*$/u;

const isValidCalendarDate = (value: string): boolean => {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year as number, (month as number) - 1, day as number));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === (month as number) - 1 &&
    date.getUTCDate() === day
  );
};

const classroomIdSchema = z
  .string()
  .trim()
  .min(1, 'Classroom id is required.')
  .max(100, 'Classroom id cannot exceed 100 characters.');

const classroomTypeSchema = z.enum(['LABORATORY', 'CLASSROOM'], 'Classroom type is invalid.');

const capacitySchema = z
  .number('Capacity must be a number.')
  .int('Capacity must be an integer.')
  .positive('Capacity must be greater than 0.')
  .max(100000, 'Capacity is too large.');

const timeOfDaySchema = (label: string) =>
  z.string().regex(timePattern, `${label} time must be in HH:mm format.`);

const normalizeAmenity = (value: string): string => value.trim().replace(/\s+/g, ' ');

const amenitySchema = z
  .string()
  .transform(normalizeAmenity)
  .refine((value) => value.length >= 1, 'Amenity is required.')
  .refine((value) => value.length <= 50, 'Amenity cannot exceed 50 characters.')
  .refine(
    (value) => amenityPattern.test(value),
    'Amenity may only contain letters, numbers, spaces and hyphens.',
  );

const availabilityWindowShape = {
  dayOfWeek: z
    .number('Day of week must be a number.')
    .int('Day of week must be an integer.')
    .min(1, 'Day of week must be between 1 and 7.')
    .max(7, 'Day of week must be between 1 and 7.'),
  startTime: timeOfDaySchema('Start'),
  endTime: timeOfDaySchema('End'),
  period: z.string().trim().max(30, 'Period cannot exceed 30 characters.').nullish(),
};

export const listClassroomsQuerySchema = z.object({
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
      type: classroomTypeSchema.optional(),
      minCapacity: z.coerce
        .number('Minimum capacity must be a number.')
        .int('Minimum capacity must be an integer.')
        .positive('Minimum capacity must be greater than 0.')
        .optional(),
      amenity: amenitySchema.optional(),
      isActive: z
        .enum(['true', 'false'], 'Status must be true or false.')
        .transform((value) => value === 'true')
        .optional(),
    })
    .strict(),
});

export type ListClassroomsQuery = z.infer<typeof listClassroomsQuerySchema>['query'];

export const availableClassroomsQuerySchema = z.object({
  query: z
    .object({
      date: z
        .string()
        .regex(datePattern, 'Date must be in YYYY-MM-DD format.')
        .refine(isValidCalendarDate, 'Date must be a valid calendar date.'),
      startTime: timeOfDaySchema('Start'),
      endTime: timeOfDaySchema('End'),
      minCapacity: z.coerce
        .number('Minimum capacity must be a number.')
        .int('Minimum capacity must be an integer.')
        .positive('Minimum capacity must be greater than 0.')
        .optional(),
      type: classroomTypeSchema.optional(),
      amenity: amenitySchema.optional(),
    })
    .strict()
    .refine((value) => value.endTime > value.startTime, {
      message: 'End time must be after start time.',
      path: ['endTime'],
    }),
});

export type AvailableClassroomsQuery = z.infer<typeof availableClassroomsQuerySchema>['query'];

export const classroomParamsSchema = z.object({
  params: z.object({ id: classroomIdSchema }),
});

export type ClassroomParams = z.infer<typeof classroomParamsSchema>['params'];

const classroomLocationShape = {
  name: z.string().trim().min(1, 'Name is required.').max(50, 'Name cannot exceed 50 characters.'),
  type: classroomTypeSchema,
  capacity: capacitySchema,
  building: z.string().trim().max(50, 'Building cannot exceed 50 characters.').nullish(),
  floor: z
    .number('Floor must be a number.')
    .int('Floor must be an integer.')
    .min(-5, 'Floor must be at least -5.')
    .max(100, 'Floor cannot exceed 100.')
    .nullish(),
};

export const createClassroomBodySchema = z
  .object({
    ...classroomLocationShape,
    isActive: z.boolean().optional(),
  })
  .strict()
  .meta({
    id: 'CreateClassroom',
    description: 'Classroom data accepted when creating a classroom.',
  });

export const createClassroomSchema = z.object({
  body: createClassroomBodySchema,
});

export type CreateClassroomBody = z.infer<typeof createClassroomSchema>['body'];

export const updateClassroomBodySchema = z
  .object({
    name: classroomLocationShape.name.optional(),
    type: classroomTypeSchema.optional(),
    capacity: capacitySchema.optional(),
    building: classroomLocationShape.building,
    floor: classroomLocationShape.floor,
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided.',
  })
  .meta({
    id: 'UpdateClassroom',
    description: 'Partial classroom data. At least one field must be provided.',
  });

export const updateClassroomSchema = z.object({
  params: z.object({ id: classroomIdSchema }),
  body: updateClassroomBodySchema,
});

export type UpdateClassroomBody = z.infer<typeof updateClassroomSchema>['body'];

export const addClassroomAmenitySchema = z.object({
  params: z.object({ id: classroomIdSchema }),
  body: z.object({ amenity: amenitySchema }).strict().meta({
    id: 'AddClassroomAmenity',
    description: 'Amenity to add to a classroom.',
  }),
});

export type AddClassroomAmenityBody = z.infer<typeof addClassroomAmenitySchema>['body'];

export const classroomAmenityParamsSchema = z.object({
  params: z.object({ id: classroomIdSchema, amenity: amenitySchema }),
});

export type ClassroomAmenityParams = z.infer<typeof classroomAmenityParamsSchema>['params'];

export const addClassroomAvailabilitySchema = z.object({
  params: z.object({ id: classroomIdSchema }),
  body: z
    .object(availabilityWindowShape)
    .strict()
    .refine((value) => value.endTime > value.startTime, {
      message: 'End time must be after start time.',
      path: ['endTime'],
    })
    .meta({
      id: 'AddClassroomAvailability',
      description: 'Weekly availability window to add to a classroom.',
    }),
});

export type AddClassroomAvailabilityBody = z.infer<typeof addClassroomAvailabilitySchema>['body'];

export const classroomAvailabilityParamsSchema = z.object({
  params: z.object({
    id: classroomIdSchema,
    availabilityId: z
      .string()
      .trim()
      .min(1, 'Availability id is required.')
      .max(100, 'Availability id cannot exceed 100 characters.'),
  }),
});

export type ClassroomAvailabilityParams = z.infer<
  typeof classroomAvailabilityParamsSchema
>['params'];

export const classroomAvailabilitySchema = z
  .object({
    id: z.string(),
    dayOfWeek: z.number().int().meta({ description: 'ISO day of week, 1 (Monday) to 7 (Sunday).' }),
    startTime: z.string().meta({ description: 'Institutional start time in HH:mm format.' }),
    endTime: z.string().meta({ description: 'Institutional end time in HH:mm format.' }),
    period: z.string().nullable(),
  })
  .meta({
    id: 'ClassroomAvailability',
    description: 'Weekly availability window of a classroom.',
  });

export const classroomSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.enum(['LABORATORY', 'CLASSROOM']),
    capacity: z.number().int(),
    building: z.string().nullable(),
    floor: z.number().int().nullable(),
    isActive: z.boolean(),
    amenities: z.array(z.string()).meta({ description: 'Amenity names available in the room.' }),
  })
  .meta({
    id: 'ClassroomSummary',
    description: 'Classroom catalog entry with its amenities.',
  }) satisfies z.ZodType<ClassroomSummary>;

export const classroomDetailSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.enum(['LABORATORY', 'CLASSROOM']),
    capacity: z.number().int(),
    building: z.string().nullable(),
    floor: z.number().int().nullable(),
    isActive: z.boolean(),
    amenities: z.array(z.string()),
    availability: z.array(classroomAvailabilitySchema),
  })
  .meta({
    id: 'ClassroomDetail',
    description: 'Classroom detail with its amenities and weekly availability windows.',
  }) satisfies z.ZodType<ClassroomDetail>;

export const paginatedClassroomsSchema = z
  .object({
    items: z.array(classroomSummarySchema),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .meta({
    id: 'PaginatedClassrooms',
    description: 'Paginated list of classrooms.',
  }) satisfies z.ZodType<PaginatedClassrooms>;
