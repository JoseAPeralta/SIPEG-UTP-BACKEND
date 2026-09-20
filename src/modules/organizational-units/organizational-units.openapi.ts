import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { apiErrorResponseSchema, apiSuccessResponse } from '../../docs/schemas.js';
import {
  createOrganizationalUnitSchema,
  listOrganizationalUnitsQuerySchema,
  organizationalUnitDetailSchema,
  organizationalUnitParamsSchema,
  paginatedOrganizationalUnitsSchema,
  updateOrganizationalUnitSchema,
} from './organizational-units.schemas.js';

const errorResponse = {
  description: 'Error response.',
  content: { 'application/json': { schema: apiErrorResponseSchema } },
} as const;

export const organizationalUnitsPaths: ZodOpenApiPathsObject = {
  '/api/v1/organizational-units': {
    get: {
      tags: ['Organizational Units'],
      summary: 'List organizational units',
      description:
        'Public catalog of organizational units. Returns only active units by default; use isActive=false to list inactive ones. Supports pagination, type and case-insensitive search by name or code.',
      requestParams: { query: listOrganizationalUnitsQuerySchema.shape.query },
      responses: {
        200: {
          description: 'Paginated list of organizational units.',
          content: {
            'application/json': {
              schema: apiSuccessResponse(paginatedOrganizationalUnitsSchema),
            },
          },
        },
        400: errorResponse,
      },
    },
    post: {
      tags: ['Organizational Units'],
      summary: 'Create an organizational unit',
      description:
        'Creates an organizational unit and its permanent default event program in a single transaction. Requires the ADMIN role. The organizational unit code is unique and case-insensitive.',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: createOrganizationalUnitSchema.shape.body } },
      },
      responses: {
        201: {
          description: 'Organizational unit created with its default event program.',
          content: {
            'application/json': { schema: apiSuccessResponse(organizationalUnitDetailSchema) },
          },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        409: errorResponse,
      },
    },
  },
  '/api/v1/organizational-units/{id}': {
    get: {
      tags: ['Organizational Units'],
      summary: 'Get an organizational unit',
      description:
        'Public organizational unit detail including its careers and its default event program.',
      requestParams: { path: organizationalUnitParamsSchema.shape.params },
      responses: {
        200: {
          description: 'Organizational unit detail.',
          content: {
            'application/json': { schema: apiSuccessResponse(organizationalUnitDetailSchema) },
          },
        },
        400: errorResponse,
        404: errorResponse,
      },
    },
    patch: {
      tags: ['Organizational Units'],
      summary: 'Update an organizational unit',
      description:
        'Updates name, description and head user. The code and type are immutable. Requires the ADMIN role.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: organizationalUnitParamsSchema.shape.params },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: updateOrganizationalUnitSchema.shape.body } },
      },
      responses: {
        200: {
          description: 'Updated organizational unit detail.',
          content: {
            'application/json': { schema: apiSuccessResponse(organizationalUnitDetailSchema) },
          },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  '/api/v1/organizational-units/{id}/deactivate': {
    post: {
      tags: ['Organizational Units'],
      summary: 'Deactivate an organizational unit',
      description:
        'Deactivates the unit and archives its default event program in a single transaction. Requires the ADMIN role. Rejected while the default program has scheduled or ongoing activities.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: organizationalUnitParamsSchema.shape.params },
      responses: {
        200: {
          description: 'Deactivated organizational unit with its archived default program.',
          content: {
            'application/json': { schema: apiSuccessResponse(organizationalUnitDetailSchema) },
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
  '/api/v1/organizational-units/{id}/reactivate': {
    post: {
      tags: ['Organizational Units'],
      summary: 'Reactivate an organizational unit',
      description:
        'Reactivates the unit and restores its existing default event program in the same transaction. Requires the ADMIN role.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: organizationalUnitParamsSchema.shape.params },
      responses: {
        200: {
          description: 'Reactivated organizational unit with its active default program.',
          content: {
            'application/json': { schema: apiSuccessResponse(organizationalUnitDetailSchema) },
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
