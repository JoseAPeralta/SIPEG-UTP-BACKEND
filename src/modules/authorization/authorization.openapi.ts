import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { apiErrorResponseSchema, apiSuccessResponse } from '../../docs/schemas.js';
import {
  addCollaboratorSchema,
  collaboratorListSchema,
  collaboratorParamsSchema,
  collaboratorSchema,
} from './authorization.schemas.js';

const errorResponse = {
  description: 'Error response.',
  content: { 'application/json': { schema: apiErrorResponseSchema } },
} as const;

const listResponses = {
  200: {
    description: 'Local collaborators of the scope.',
    content: { 'application/json': { schema: apiSuccessResponse(collaboratorListSchema) } },
  },
  400: errorResponse,
  401: errorResponse,
  403: errorResponse,
  404: errorResponse,
} as const;

const addResponses = {
  201: {
    description: 'Collaborator added to the scope with its role defaults materialized.',
    content: { 'application/json': { schema: apiSuccessResponse(collaboratorSchema) } },
  },
  400: errorResponse,
  401: errorResponse,
  403: errorResponse,
  404: errorResponse,
  409: errorResponse,
} as const;

const listDescription =
  'Lists the collaborators that live directly on the scope. Requires `permission:grant` in the scope or the ADMIN role. Inherited program collaborations are not expanded here; only local grants are returned.';

const addDescription =
  'Adds a collaborator to the scope and materializes the ROLE_DEFAULT grants of the assigned role. Requires `permission:grant` in the scope or the ADMIN role; the actor cannot assign a role whose defaults exceed its own permissions. Archived event programs cannot be modified.';

export const authorizationPaths: ZodOpenApiPathsObject = {
  '/api/v1/event-programs/{id}/collaborators': {
    get: {
      tags: ['Collaborators'],
      summary: 'List event program collaborators',
      description: listDescription,
      security: [{ bearerAuth: [] }],
      requestParams: { path: collaboratorParamsSchema.shape.params },
      responses: listResponses,
    },
    post: {
      tags: ['Collaborators'],
      summary: 'Add an event program collaborator',
      description: addDescription,
      security: [{ bearerAuth: [] }],
      requestParams: { path: collaboratorParamsSchema.shape.params },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: addCollaboratorSchema.shape.body } },
      },
      responses: addResponses,
    },
  },
  '/api/v1/activities/{id}/collaborators': {
    get: {
      tags: ['Collaborators'],
      summary: 'List activity collaborators',
      description: listDescription,
      security: [{ bearerAuth: [] }],
      requestParams: { path: collaboratorParamsSchema.shape.params },
      responses: listResponses,
    },
    post: {
      tags: ['Collaborators'],
      summary: 'Add an activity collaborator',
      description: addDescription,
      security: [{ bearerAuth: [] }],
      requestParams: { path: collaboratorParamsSchema.shape.params },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: addCollaboratorSchema.shape.body } },
      },
      responses: addResponses,
    },
  },
};
