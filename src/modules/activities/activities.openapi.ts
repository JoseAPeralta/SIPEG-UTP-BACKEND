import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { apiErrorResponseSchema, apiSuccessResponse } from '../../docs/schemas.js';
import {
  activityDetailSchema,
  activityParamsSchema,
  cancelActivityBodySchema,
  createActivitySchema,
  eventProgramActivitiesParamsSchema,
  eventProgramActivitiesQuerySchema,
  listActivitiesQuerySchema,
  paginatedActivitiesSchema,
  paginatedEventProgramActivitiesSchema,
  updateActivitySchema,
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
  '/api/v1/activities/{id}': {
    get: {
      tags: ['Activities'],
      summary: 'Get an activity',
      description:
        'Public. Returns the activity detail with speakers, classroom, equipment, program, enrolled and check-in counts. Anonymous callers only see non-DRAFT activities of ACTIVE programs; a valid Bearer token of an ADMIN or of a collaborator with the activity:read permission on the scope can also read DRAFT activities and activities of non ACTIVE programs.',
      requestParams: { path: activityParamsSchema.shape.params },
      responses: {
        200: {
          description: 'Activity detail.',
          content: { 'application/json': { schema: apiSuccessResponse(activityDetailSchema) } },
        },
        400: errorResponse,
        401: errorResponse,
        404: errorResponse,
      },
    },
    patch: {
      tags: ['Activities'],
      summary: 'Update an activity',
      description:
        'Partially updates an activity. Requires the activity:update permission on the activity scope (or the ADMIN role). COMPLETED and CANCELLED activities respond 409. The status field accepts DRAFT or SCHEDULED to unpublish or publish; ONGOING, COMPLETED and CANCELLED are rejected. When the resulting activity reserves a classroom (SCHEDULED/ONGOING), the availability window, overlaps and classroom capacity are validated. The event program is immutable.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: activityParamsSchema.shape.params },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: updateActivitySchema.shape.body } },
      },
      responses: {
        200: {
          description: 'Activity updated successfully.',
          content: { 'application/json': { schema: apiSuccessResponse(activityDetailSchema) } },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
    delete: {
      tags: ['Activities'],
      summary: 'Delete a draft activity',
      description:
        'Physically deletes an activity and responds 204 without a body. Requires the activity:delete permission on the activity scope (or the ADMIN role); activity:delete is a default of ORGANIZER only. Retention rule: only DRAFT activities of ACTIVE event programs can be deleted, and the activity must have no attendance records and no alert records, otherwise the endpoint responds 409. Attendance and alerts are retained data protected by ON DELETE RESTRICT, so an activity with history is cancelled instead of deleted. Equipment, speaker links and local collaborations are removed by cascade while the speakers catalog entry is kept. Archived event programs are frozen and their activities respond 409.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: activityParamsSchema.shape.params },
      responses: {
        204: { description: 'Activity deleted successfully.' },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  '/api/v1/activities/{id}/cancel': {
    post: {
      tags: ['Activities'],
      summary: 'Cancel an activity',
      description:
        'Cancels an activity and optionally records a reason. Requires the activity:cancel permission on the activity scope (or the ADMIN role). DRAFT, SCHEDULED and ONGOING activities can be cancelled; COMPLETED activities respond 409 and activities of non ACTIVE event programs also respond 409. Cancelling an already cancelled activity is idempotent: it responds 200 without overwriting the recorded reason. The optional body accepts a trimmed reason of up to 500 characters.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: activityParamsSchema.shape.params },
      requestBody: {
        required: false,
        content: { 'application/json': { schema: cancelActivityBodySchema } },
      },
      responses: {
        200: {
          description: 'Cancelled activity.',
          content: { 'application/json': { schema: apiSuccessResponse(activityDetailSchema) } },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  '/api/v1/event-programs/{id}/activities': {
    get: {
      tags: ['Activities'],
      summary: 'List activities of an event program',
      description:
        'Public. Returns the activities of an event program with offset pagination. Anonymous callers only see SCHEDULED, ONGOING and COMPLETED activities of ACTIVE programs; the status filter is honored only for an ADMIN or a collaborator with the activity:read permission on the program scope, while other callers silently receive the public statuses. Non ACTIVE programs respond 404 unless the caller is authorized. Supports optional type, case-insensitive name/description search and inclusive institutional date range filters.',
      requestParams: {
        path: eventProgramActivitiesParamsSchema.shape.params,
        query: eventProgramActivitiesQuerySchema,
      },
      responses: {
        200: {
          description: 'Paginated list of event program activities.',
          content: {
            'application/json': {
              schema: apiSuccessResponse(paginatedEventProgramActivitiesSchema),
            },
          },
        },
        400: errorResponse,
        401: errorResponse,
        404: errorResponse,
      },
    },
  },
};
