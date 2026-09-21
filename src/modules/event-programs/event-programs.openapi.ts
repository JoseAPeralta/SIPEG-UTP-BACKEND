import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { apiErrorResponseSchema, apiSuccessResponse } from '../../docs/schemas.js';
import {
  createEventProgramSchema,
  eventProgramDetailSchema,
  eventProgramParamsSchema,
  eventProgramPublicDetailSchema,
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
      summary: 'List event programs',
      description:
        'Public. Returns ACTIVE event programs ordered by name. The status filter (DRAFT, ACTIVE, COMPLETED, CANCELLED, ARCHIVED or ALL) is honored only for ADMIN users; anonymous callers and non-admin users always receive ACTIVE programs even when they send another status. Supports filters by organizational unit, unit type and a name/label search term. An invalid status responds 400; a present but invalid bearer token responds 401 and an inactive account responds 403.',
      requestParams: { query: listEventProgramsQuerySchema.shape.query },
      responses: {
        200: {
          description: 'Paginated list of event programs.',
          content: {
            'application/json': { schema: apiSuccessResponse(paginatedEventProgramsSchema) },
          },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
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
    delete: {
      tags: ['Event Programs'],
      summary: 'Deleting event programs is not allowed',
      description:
        'Event programs are archived, never physically deleted. This operation always responds 405 with an Allow header listing GET and POST; use POST /api/v1/event-programs/{id}/archive to archive a program.',
      responses: {
        405: errorResponse,
      },
    },
  },
  '/api/v1/event-programs/{id}': {
    get: {
      tags: ['Event Programs'],
      summary: 'Get an event program',
      description:
        'Public. Returns an ACTIVE event program with its activity count. Anonymous callers receive the public visible count (SCHEDULED, ONGOING and COMPLETED activities); ADMIN users and collaborators with program:read on the program also receive the total and the per-status breakdown. Non-active or missing programs respond 404. A present but invalid bearer token responds 401.',
      requestParams: { path: eventProgramParamsSchema.shape.params },
      responses: {
        200: {
          description: 'Event program detail.',
          content: {
            'application/json': { schema: apiSuccessResponse(eventProgramPublicDetailSchema) },
          },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
    patch: {
      tags: ['Event Programs'],
      summary: 'Update an event program',
      description:
        'Partially updates name, description, label, bannerUrl, startDate, endDate and status of a specific event program. The only accepted status transition is DRAFT to ACTIVE; any other value or transition responds 400/409. Requires the program:update permission on the program scope, or the ADMIN role. Archived programs cannot be modified (409), default programs cannot receive start or end dates (400), and dates that would leave existing activities outside the range are rejected (409).',
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
    delete: {
      tags: ['Event Programs'],
      summary: 'Deleting an event program is not allowed',
      description:
        'Event programs are archived, never physically deleted. This operation always responds 405 with an Allow header listing GET and PATCH; use POST /api/v1/event-programs/{id}/archive to archive the program.',
      requestParams: { path: eventProgramParamsSchema.shape.params },
      responses: {
        405: errorResponse,
      },
    },
  },
  '/api/v1/event-programs/{id}/archive': {
    post: {
      tags: ['Event Programs'],
      summary: 'Archive an event program',
      description:
        'Archives an event program and stamps archivedAt. Requires the program:archive permission on the program scope, or the ADMIN role. Default programs cannot be archived while their organizational unit is active (409) and additional programs with SCHEDULED or ONGOING activities are rejected (409); DRAFT, COMPLETED and CANCELLED activities do not block. Archiving an already archived program is idempotent: it responds 200 without modifying archivedAt.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: eventProgramParamsSchema.shape.params },
      responses: {
        200: {
          description: 'Archived event program.',
          content: {
            'application/json': { schema: apiSuccessResponse(eventProgramDetailSchema) },
          },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  '/api/v1/event-programs/{id}/reactivate': {
    post: {
      tags: ['Event Programs'],
      summary: 'Reactivate an event program',
      description:
        'Reactivates an ARCHIVED additional event program to ACTIVE and clears archivedAt. Requires the program:reactivate permission on the program scope, or the ADMIN role; no collaboration role grants this permission by default. Default event programs follow their organizational unit lifecycle and respond 409 (use POST /organizational-units/{id}/reactivate instead), and programs that are not ARCHIVED also respond 409. An ARCHIVED program without a coherent start and end date responds 400. Reactivating a program whose organizational unit is inactive is allowed.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: eventProgramParamsSchema.shape.params },
      responses: {
        200: {
          description: 'Reactivated event program.',
          content: {
            'application/json': { schema: apiSuccessResponse(eventProgramDetailSchema) },
          },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
};
