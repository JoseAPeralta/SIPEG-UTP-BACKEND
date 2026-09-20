import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { apiErrorResponseSchema, apiSuccessResponse } from '../../docs/schemas.js';
import {
  adminUserParamsSchema,
  adminUserSchema,
  createUserSchema,
  listUsersQuerySchema,
  paginatedUsersSchema,
  updateAdminUserSchema,
  updateProfileSchema,
  userProfileSchema,
} from './users.schemas.js';

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
        409: errorResponse,
      },
    },
  },
  '/api/v1/admin/users': {
    get: {
      tags: ['Admin'],
      summary: 'List users',
      description:
        'Administrative user listing. Requires the ADMIN role. Supports pagination, case-insensitive search by name, email or identification number, and filters by role, status, organizational unit and career.',
      security: [{ bearerAuth: [] }],
      requestParams: { query: listUsersQuerySchema.shape.query },
      responses: {
        200: {
          description: 'Paginated list of user accounts.',
          content: { 'application/json': { schema: apiSuccessResponse(paginatedUsersSchema) } },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
      },
    },
    post: {
      tags: ['Admin'],
      summary: 'Create a user',
      description:
        'Administrative user creation. Requires the ADMIN role. Creates the credential account with Argon2id and sends a verification email; the account cannot sign in until the email is verified.',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: createUserSchema.shape.body } },
      },
      responses: {
        201: {
          description: 'Created user account.',
          content: { 'application/json': { schema: apiSuccessResponse(adminUserSchema) } },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        409: errorResponse,
      },
    },
  },
  '/api/v1/admin/users/{id}': {
    get: {
      tags: ['Admin'],
      summary: 'Get a user by id',
      description: 'Administrative user detail. Requires the ADMIN role.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: adminUserParamsSchema.shape.params },
      responses: {
        200: {
          description: 'Administrative view of the requested user account.',
          content: { 'application/json': { schema: apiSuccessResponse(adminUserSchema) } },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
    patch: {
      tags: ['Admin'],
      summary: 'Update a user',
      description:
        'Administrative user update. Requires the ADMIN role. Allows changing the global role, active status, organizational unit and career. Deactivating a user revokes all of their sessions; administrators cannot deactivate or demote themselves and the last active administrator cannot be demoted or deactivated.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: adminUserParamsSchema.shape.params },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: updateAdminUserSchema.shape.body } },
      },
      responses: {
        200: {
          description: 'Updated administrative view of the user account.',
          content: { 'application/json': { schema: apiSuccessResponse(adminUserSchema) } },
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
