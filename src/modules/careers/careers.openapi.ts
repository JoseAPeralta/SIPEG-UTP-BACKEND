import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { apiErrorResponseSchema, apiSuccessResponse } from '../../docs/schemas.js';
import {
  careerParamsSchema,
  careerSummarySchema,
  createCareerSchema,
  listCareersQuerySchema,
  paginatedCareersSchema,
  updateCareerSchema,
} from './careers.schemas.js';

const errorResponse = {
  description: 'Error response.',
  content: { 'application/json': { schema: apiErrorResponseSchema } },
} as const;

export const careersPaths: ZodOpenApiPathsObject = {
  '/api/v1/careers': {
    get: {
      tags: ['Careers'],
      summary: 'List careers',
      description:
        'Public career catalog. Supports pagination and case-insensitive search by name or code. Use unitId to list the careers of a faculty plus the global ones, or unitId=global to list only global careers such as Otros.',
      requestParams: { query: listCareersQuerySchema.shape.query },
      responses: {
        200: {
          description: 'Paginated list of careers.',
          content: { 'application/json': { schema: apiSuccessResponse(paginatedCareersSchema) } },
        },
        400: errorResponse,
      },
    },
    post: {
      tags: ['Careers'],
      summary: 'Create a career',
      description:
        'Creates a career. Requires the ADMIN role. unitId is optional: omit it or send null to create a global career. When a unit is provided it must be an active FACULTY. The career code is unique and case-insensitive.',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: createCareerSchema.shape.body } },
      },
      responses: {
        201: {
          description: 'Created career.',
          content: { 'application/json': { schema: apiSuccessResponse(careerSummarySchema) } },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  '/api/v1/careers/{id}': {
    patch: {
      tags: ['Careers'],
      summary: 'Update a career',
      description:
        'Updates name, code, description or unit. Requires the ADMIN role. The global Otros career cannot change its code or stop being global, and a career with associated users cannot change units.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: careerParamsSchema.shape.params },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: updateCareerSchema.shape.body } },
      },
      responses: {
        200: {
          description: 'Updated career.',
          content: { 'application/json': { schema: apiSuccessResponse(careerSummarySchema) } },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
    delete: {
      tags: ['Careers'],
      summary: 'Delete a career',
      description:
        'Permanently deletes a career. Requires the ADMIN role. Careers with associated users and the global Otros career cannot be deleted.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: careerParamsSchema.shape.params },
      responses: {
        204: { description: 'Career deleted.' },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
};
