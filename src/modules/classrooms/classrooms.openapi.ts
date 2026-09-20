import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { apiErrorResponseSchema, apiSuccessResponse } from '../../docs/schemas.js';
import {
  addClassroomAmenitySchema,
  addClassroomAvailabilitySchema,
  availableClassroomsQuerySchema,
  classroomAmenityParamsSchema,
  classroomAvailabilityParamsSchema,
  classroomDetailSchema,
  classroomParamsSchema,
  classroomSummarySchema,
  createClassroomSchema,
  listClassroomsQuerySchema,
  paginatedClassroomsSchema,
  updateClassroomSchema,
} from './classrooms.schemas.js';

const errorResponse = {
  description: 'Error response.',
  content: { 'application/json': { schema: apiErrorResponseSchema } },
} as const;

export const classroomsPaths: ZodOpenApiPathsObject = {
  '/api/v1/classrooms': {
    get: {
      tags: ['Classrooms'],
      summary: 'List classrooms',
      description:
        'Public classroom catalog. Returns only active classrooms by default; use isActive=false to list inactive ones. Supports pagination and filters by type, minimum capacity, amenity and status.',
      requestParams: { query: listClassroomsQuerySchema.shape.query },
      responses: {
        200: {
          description: 'Paginated list of classrooms.',
          content: {
            'application/json': { schema: apiSuccessResponse(paginatedClassroomsSchema) },
          },
        },
        400: errorResponse,
      },
    },
    post: {
      tags: ['Classrooms'],
      summary: 'Create a classroom',
      description: 'Creates a classroom in the institutional catalog. Requires the ADMIN role.',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: createClassroomSchema.shape.body } },
      },
      responses: {
        201: {
          description: 'Classroom created.',
          content: {
            'application/json': { schema: apiSuccessResponse(classroomDetailSchema) },
          },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
      },
    },
  },
  '/api/v1/classrooms/available': {
    get: {
      tags: ['Classrooms'],
      summary: 'List available classrooms',
      description:
        'Returns active classrooms whose weekly availability window covers the requested interval on the ISO day of week of the institutional date. Classrooms reserved by activities in SCHEDULED or ONGOING status are excluded; DRAFT, COMPLETED and CANCELLED activities do not block a room. Supports optional filters by minimum capacity, type and amenity.',
      requestParams: { query: availableClassroomsQuerySchema.shape.query },
      responses: {
        200: {
          description: 'Classrooms available for the requested interval.',
          content: {
            'application/json': {
              schema: apiSuccessResponse(z.array(classroomSummarySchema)),
            },
          },
        },
        400: errorResponse,
      },
    },
  },
  '/api/v1/classrooms/{id}': {
    get: {
      tags: ['Classrooms'],
      summary: 'Get a classroom',
      description:
        'Public classroom detail including its amenities and weekly availability windows.',
      requestParams: { path: classroomParamsSchema.shape.params },
      responses: {
        200: {
          description: 'Classroom detail.',
          content: {
            'application/json': { schema: apiSuccessResponse(classroomDetailSchema) },
          },
        },
        400: errorResponse,
        404: errorResponse,
      },
    },
    patch: {
      tags: ['Classrooms'],
      summary: 'Update a classroom',
      description:
        'Partially updates name, type, capacity, building, floor or status. Requires the ADMIN role. Deactivation is rejected with 409 while scheduled or ongoing activities reserve the room.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: classroomParamsSchema.shape.params },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: updateClassroomSchema.shape.body } },
      },
      responses: {
        200: {
          description: 'Updated classroom detail.',
          content: {
            'application/json': { schema: apiSuccessResponse(classroomDetailSchema) },
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
  '/api/v1/classrooms/{id}/amenities': {
    post: {
      tags: ['Classrooms'],
      summary: 'Add a classroom amenity',
      description:
        'Adds an amenity to a classroom. Requires the ADMIN role. Duplicates are rejected case-insensitively with 409.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: classroomParamsSchema.shape.params },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: addClassroomAmenitySchema.shape.body } },
      },
      responses: {
        201: {
          description: 'Amenity added; returns the updated classroom detail.',
          content: {
            'application/json': { schema: apiSuccessResponse(classroomDetailSchema) },
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
  '/api/v1/classrooms/{id}/amenities/{amenity}': {
    delete: {
      tags: ['Classrooms'],
      summary: 'Remove a classroom amenity',
      description:
        'Removes an amenity from a classroom. Requires the ADMIN role. The lookup is case-insensitive.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: classroomAmenityParamsSchema.shape.params },
      responses: {
        200: {
          description: 'Amenity removed; returns the updated classroom detail.',
          content: {
            'application/json': { schema: apiSuccessResponse(classroomDetailSchema) },
          },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  '/api/v1/classrooms/{id}/availability': {
    post: {
      tags: ['Classrooms'],
      summary: 'Add a classroom availability window',
      description:
        'Adds a weekly availability window. Requires the ADMIN role. dayOfWeek uses ISO numbering (1 Monday to 7 Sunday). Overlapping windows on the same day are rejected with 409.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: classroomParamsSchema.shape.params },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: addClassroomAvailabilitySchema.shape.body } },
      },
      responses: {
        201: {
          description: 'Availability window added; returns the updated classroom detail.',
          content: {
            'application/json': { schema: apiSuccessResponse(classroomDetailSchema) },
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
  '/api/v1/classrooms/{id}/availability/{availabilityId}': {
    delete: {
      tags: ['Classrooms'],
      summary: 'Remove a classroom availability window',
      description: 'Removes a weekly availability window. Requires the ADMIN role.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: classroomAvailabilityParamsSchema.shape.params },
      responses: {
        200: {
          description: 'Availability window removed; returns the updated classroom detail.',
          content: {
            'application/json': { schema: apiSuccessResponse(classroomDetailSchema) },
          },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
};
