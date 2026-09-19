import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { apiErrorResponseSchema, apiSuccessResponse } from '../../docs/schemas.js';
import {
  authTokensSchema,
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerResultSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from './auth.schemas.js';

const errorResponse = {
  description: 'Error response.',
  content: { 'application/json': { schema: apiErrorResponseSchema } },
} as const;

const emptyDataSchema = z
  .object({})
  .meta({ id: 'EmptyData', description: 'Empty successful payload.' });

export const authPaths: ZodOpenApiPathsObject = {
  '/api/v1/auth/login': {
    post: {
      tags: ['Auth'],
      summary: 'Log in with email and password',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: loginSchema.shape.body } },
      },
      responses: {
        200: {
          description: 'Authenticated. Returns an access/refresh token pair.',
          content: { 'application/json': { schema: apiSuccessResponse(authTokensSchema) } },
        },
        400: errorResponse,
        401: errorResponse,
        429: errorResponse,
      },
    },
  },
  '/api/v1/auth/register': {
    post: {
      tags: ['Auth'],
      summary: 'Register a new user',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: registerSchema.shape.body } },
      },
      responses: {
        201: {
          description: 'Registration successful. An email verification is sent.',
          content: { 'application/json': { schema: apiSuccessResponse(registerResultSchema) } },
        },
        400: errorResponse,
        409: errorResponse,
        429: errorResponse,
      },
    },
  },
  '/api/v1/auth/refresh': {
    post: {
      tags: ['Auth'],
      summary: 'Refresh the access token',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: refreshSchema.shape.body } },
      },
      responses: {
        200: {
          description: 'New access/refresh token pair.',
          content: { 'application/json': { schema: apiSuccessResponse(authTokensSchema) } },
        },
        400: errorResponse,
        401: errorResponse,
        429: errorResponse,
      },
    },
  },
  '/api/v1/auth/logout': {
    post: {
      tags: ['Auth'],
      summary: 'Log out and revoke the refresh token',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: logoutSchema.shape.body } },
      },
      responses: {
        200: {
          description: 'Session revoked.',
          content: { 'application/json': { schema: apiSuccessResponse(emptyDataSchema) } },
        },
        400: errorResponse,
      },
    },
  },
  '/api/v1/auth/verify-email': {
    post: {
      tags: ['Auth'],
      summary: 'Verify an email address',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: verifyEmailSchema.shape.body } },
      },
      responses: {
        200: {
          description: 'Email verified.',
          content: { 'application/json': { schema: apiSuccessResponse(emptyDataSchema) } },
        },
        400: errorResponse,
      },
    },
  },
  '/api/v1/auth/forgot-password': {
    post: {
      tags: ['Auth'],
      summary: 'Request a password reset',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: forgotPasswordSchema.shape.body } },
      },
      responses: {
        200: {
          description: 'Reset link sent if the email is registered.',
          content: { 'application/json': { schema: apiSuccessResponse(emptyDataSchema) } },
        },
        400: errorResponse,
        429: errorResponse,
      },
    },
  },
  '/api/v1/auth/reset-password': {
    post: {
      tags: ['Auth'],
      summary: 'Reset a password with a token',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: resetPasswordSchema.shape.body } },
      },
      responses: {
        200: {
          description: 'Password reset.',
          content: { 'application/json': { schema: apiSuccessResponse(emptyDataSchema) } },
        },
        400: errorResponse,
        429: errorResponse,
      },
    },
  },
};
