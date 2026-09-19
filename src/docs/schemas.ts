import { z } from 'zod';

export const validationIssueSchema = z
  .object({
    field: z.string().meta({ description: 'Dot path of the invalid request field.' }),
    message: z.string().meta({ description: 'Human readable validation message.' }),
  })
  .meta({
    id: 'ValidationIssue',
    description: 'A single request validation issue.',
    example: { field: 'body.email', message: 'Invalid email format.' },
  });

export const apiErrorResponseSchema = z
  .object({
    success: z.literal(false).meta({ description: 'Always false for error responses.' }),
    message: z.string().meta({ description: 'Human readable error summary.' }),
    errors: z.array(validationIssueSchema).meta({
      description: 'Structured validation issues. Empty for non-validation errors.',
    }),
  })
  .meta({
    id: 'ApiErrorResponse',
    description: 'Standard error envelope returned by every failing request.',
  });

export const apiSuccessResponse = <TData extends z.ZodType>(data: TData) =>
  z.object({
    success: z.literal(true).meta({ description: 'Always true for successful responses.' }),
    message: z.string().meta({ description: 'Human readable success summary.' }),
    data,
  });

export const bearerAuthSecurityScheme = {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: 'Access token JWT (EdDSA). Send it as `Authorization: Bearer <token>`.',
} as const;

export const jsonContent = <TSchema extends z.ZodType>(schema: TSchema) => ({
  'application/json': { schema },
});

export const errorResponse = (description: string) => ({
  description,
  content: jsonContent(apiErrorResponseSchema),
});
