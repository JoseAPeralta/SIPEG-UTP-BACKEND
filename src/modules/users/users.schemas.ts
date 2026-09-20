import { z } from 'zod';

import type { AdminUserResponse, PaginatedUsers, UserProfileResponse } from './users.types.js';

const trimmedString = z.string().trim();

export const updateProfileSchema = z.object({
  body: z
    .object({
      firstName: trimmedString
        .min(2, 'First name must be at least 2 characters.')
        .max(100)
        .optional(),
      lastName: trimmedString
        .min(2, 'Last name must be at least 2 characters.')
        .max(100)
        .optional(),
      unitId: trimmedString.min(1, 'Unit ID is required.').max(50).nullable().optional().meta({
        description:
          'Organizational unit identifier. Send null to select the "Otro" option, which forces the global "Otros" career.',
      }),
      careerId: trimmedString.min(1, 'Career ID is required.').max(50).optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field must be provided.',
    }),
});

export const organizationReferenceSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    code: z.string(),
  })
  .meta({
    id: 'OrganizationReference',
    description: 'Minimal reference to an organizational unit or career.',
  });

export const userProfileSchema = z
  .object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    identificationNumber: z.string(),
    email: z.string().email(),
    globalRole: z.enum(['USER', 'ADMIN']),
    unit: organizationReferenceSchema.nullable(),
    career: organizationReferenceSchema.nullable(),
  })
  .meta({
    id: 'UserProfile',
    description: 'Public profile of the authenticated user.',
  }) satisfies z.ZodType<UserProfileResponse>;

export type UpdateProfileSchemaBody = z.infer<typeof updateProfileSchema>['body'];

export const listUsersQuerySchema = z.object({
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
      globalRole: z.enum(['USER', 'ADMIN'], 'Global role is invalid.').optional(),
      isActive: z
        .enum(['true', 'false'], 'Status must be true or false.')
        .transform((value) => value === 'true')
        .optional(),
      unitId: z.string().trim().min(1, 'Organizational unit is invalid.').optional(),
      careerId: z.string().trim().min(1, 'Career is invalid.').optional(),
      q: z
        .string()
        .trim()
        .min(1, 'Search term cannot be empty.')
        .max(200, 'Search term cannot exceed 200 characters.')
        .optional(),
    })
    .strict(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>['query'];

export const createUserSchema = z.object({
  body: z
    .object({
      email: z.string().trim().email('Invalid email format.').max(254),
      password: z
        .string()
        .min(12, 'Password must be at least 12 characters.')
        .max(128, 'Password must not exceed 128 characters.'),
      firstName: trimmedString.min(2, 'First name must be at least 2 characters.').max(100),
      lastName: trimmedString.min(2, 'Last name must be at least 2 characters.').max(100),
      identificationNumber: trimmedString
        .min(5, 'Identification number must be at least 5 characters.')
        .max(30, 'Identification number must not exceed 30 characters.'),
      globalRole: z.enum(['USER', 'ADMIN'], 'Global role is invalid.').default('USER'),
      isActive: z.boolean().default(true),
      unitId: trimmedString
        .min(1, 'Unit ID is required.')
        .max(50, 'Unit ID must not exceed 50 characters.')
        .nullable()
        .optional(),
      careerId: trimmedString
        .min(1, 'Career ID is required.')
        .max(50, 'Career ID must not exceed 50 characters.')
        .optional(),
    })
    .strict()
    .meta({
      id: 'AdminUserCreate',
      description: 'Administrative payload used to create a user account.',
    }),
});

export type CreateUserSchemaBody = z.infer<typeof createUserSchema>['body'];

export const adminUserParamsSchema = z.object({
  params: z.object({
    id: z
      .string()
      .trim()
      .min(1, 'User id is required.')
      .max(100, 'User id cannot exceed 100 characters.'),
  }),
});

export type AdminUserParams = z.infer<typeof adminUserParamsSchema>['params'];

export const updateAdminUserSchema = z.object({
  params: adminUserParamsSchema.shape.params,
  body: z
    .object({
      globalRole: z.enum(['USER', 'ADMIN'], 'Global role is invalid.').optional(),
      isActive: z.boolean('Status must be true or false.').optional(),
      unitId: trimmedString.min(1, 'Unit ID is required.').max(50).nullable().optional().meta({
        description:
          'Organizational unit identifier. Send null to select the "Otro" option, which forces the global "Otros" career.',
      }),
      careerId: trimmedString.min(1, 'Career ID is required.').max(50).optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field must be provided.',
    }),
});

export type UpdateAdminUserBody = z.infer<typeof updateAdminUserSchema>['body'];

export const adminUserSchema = z
  .object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    identificationNumber: z.string(),
    email: z.string().email(),
    globalRole: z.enum(['USER', 'ADMIN']),
    isActive: z.boolean(),
    unit: organizationReferenceSchema.nullable(),
    career: organizationReferenceSchema.nullable(),
  })
  .meta({
    id: 'AdminUser',
    description: 'Administrative view of a user account.',
  }) satisfies z.ZodType<AdminUserResponse>;

export const paginatedUsersSchema = z
  .object({
    items: z.array(adminUserSchema),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .meta({
    id: 'PaginatedUsers',
    description: 'Paginated list of user accounts.',
  }) satisfies z.ZodType<PaginatedUsers>;
