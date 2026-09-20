import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { apiErrorResponseSchema, apiSuccessResponse } from '../../docs/schemas.js';
import {
  createEventProgramSchema,
  eventProgramDetailSchema,
  listEventProgramsQuerySchema,
  paginatedEventProgramsSchema,
  updateEventProgramSchema,
} from './event-programs.schemas.js';

const errorResponse = {
  description: 'Error response.',
  content: { 'application/json': { schema: apiErrorResponseSchema } },
} as const;

export const eventProgramsPaths: ZodOpenApiPathsObject = {
  '/api/v1/event-programs': {
    get: {
      tags: ['Event Programs'],
      summary: 'List active event programs',
      description:
        'Public. Returns ACTIVE event programs ordered by name. Supports filters by organizational unit, unit type and a name/label search term.',
      requestParams: { query: listEventProgramsQuerySchema.shape.query },
      responses: {
        200: {
          description: 'Paginated list of active event programs.',
          content: {
            'application/json': { schema: apiSuccessResponse(paginatedEventProgramsSchema) },
          },
        },
        400: errorResponse,
      },
    },
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
  '/api/v1/event-programs/{id}': {
    patch: {
      tags: ['Event Programs'],
      summary: 'Update an event program',
      description:
        'Partially updates name, description, label, bannerUrl, startDate and endDate of a specific event program. Requires the program:update permission on the program scope, or the ADMIN role. Archived programs cannot be modified.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: updateEventProgramSchema.shape.params },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: updateEventProgramSchema.shape.body } },
      },
      responses: {
        200: {
          description: 'Event program updated successfully.',
          content: { 'application/json': { schema: apiSuccessResponse(eventProgramDetailSchema) } },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
        500: errorResponse,
      },
    },
  },
};
