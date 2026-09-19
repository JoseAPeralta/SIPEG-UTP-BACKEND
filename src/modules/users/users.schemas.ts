import { z } from 'zod';

import type { UserProfileResponse } from './users.types.js';

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
      unitId: trimmedString.min(1, 'Unit ID is required.').max(50).optional(),
      careerId: trimmedString.min(1, 'Career ID is required.').max(50).optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field must be provided.',
    }),
});

const organizationReferenceSchema = z
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
