import { z } from 'zod';

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
      facultyId: trimmedString.min(1, 'Faculty ID is required.').max(50).optional(),
      careerId: trimmedString.min(1, 'Career ID is required.').max(50).optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field must be provided.',
    }),
});

export type UpdateProfileSchemaBody = z.infer<typeof updateProfileSchema>['body'];
