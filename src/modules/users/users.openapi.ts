import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { apiErrorResponseSchema, apiSuccessResponse } from '../../docs/schemas.js';
import { updateProfileSchema, userProfileSchema } from './users.schemas.js';

const errorResponse = {
  description: 'Error response.',
  content: { 'application/json': { schema: apiErrorResponseSchema } },
} as const;

export const usersPaths: ZodOpenApiPathsObject = {
  '/api/v1/users/me': {
    get: {
      tags: ['Users'],
      summary: 'Get the authenticated user profile',
      security: [{ bearerAuth: [] }],
      responses: {
        200: {
          description: 'Authenticated user profile.',
          content: { 'application/json': { schema: apiSuccessResponse(userProfileSchema) } },
        },
        401: errorResponse,
        404: errorResponse,
      },
    },
    patch: {
      tags: ['Users'],
      summary: 'Update the authenticated user profile',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: updateProfileSchema.shape.body } },
      },
      responses: {
        200: {
          description: 'Updated user profile.',
          content: { 'application/json': { schema: apiSuccessResponse(userProfileSchema) } },
        },
        400: errorResponse,
        401: errorResponse,
        404: errorResponse,
      },
    },
  },
};
