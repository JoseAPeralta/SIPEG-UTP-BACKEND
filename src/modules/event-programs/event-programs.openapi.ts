import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { apiErrorResponseSchema, apiSuccessResponse } from '../../docs/schemas.js';
import { createEventProgramSchema, eventProgramDetailSchema } from './event-programs.schemas.js';

const errorResponse = {
  description: 'Error response.',
  content: { 'application/json': { schema: apiErrorResponseSchema } },
} as const;

export const eventProgramsPaths: ZodOpenApiPathsObject = {
  '/api/v1/event-programs': {
    post: {
      tags: ['Event Programs'],
      summary: 'Create an event program',
      description:
        'Creates a non-default event program in DRAFT status for an active organizational unit. Requires the program:create permission; without a scope, only ADMIN users are authorized.',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: createEventProgramSchema.shape.body } },
      },
      responses: {
        201: {
          description: 'Event program created successfully.',
          content: { 'application/json': { schema: apiSuccessResponse(eventProgramDetailSchema) } },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        500: errorResponse,
      },
    },
  },
};
