import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { apiErrorResponseSchema, apiSuccessResponse } from '../../docs/schemas.js';
import {
  activityDetailSchema,
  createActivitySchema,
  listActivitiesQuerySchema,
  paginatedActivitiesSchema,
} from './activities.schemas.js';

const errorResponse = {
  description: 'Error response.',
  content: { 'application/json': { schema: apiErrorResponseSchema } },
} as const;

export const activitiesPaths: ZodOpenApiPathsObject = {
  '/api/v1/activities': {
    get: {
      tags: ['Activities'],
      summary: 'List upcoming activities',
      description:
        'Public. Returns SCHEDULED and ONGOING activities of ACTIVE programs with date greater than or equal to today in the institutional time zone America/Panama.',
      requestParams: { query: listActivitiesQuerySchema.shape.query },
      responses: {
        200: {
          description: 'Paginated list of upcoming activities.',
          content: {
            'application/json': { schema: apiSuccessResponse(paginatedActivitiesSchema) },
          },
        },
        400: errorResponse,
      },
    },
    post: {
      tags: ['Activities'],
      summary: 'Create an activity',
      description:
        'Creates an activity in DRAFT status inside an ACTIVE event program. Accepts inline speakers; a speaker is reused when the email matches an existing catalog entry and linked to a platform user when the email matches an account. Speakers do not need a platform account. Requires the activity:create permission on the target program (or the ADMIN role).',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: createActivitySchema.shape.body } },
      },
      responses: {
        201: {
          description: 'Activity created successfully.',
          content: { 'application/json': { schema: apiSuccessResponse(activityDetailSchema) } },
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
