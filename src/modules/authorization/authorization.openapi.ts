import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { apiErrorResponseSchema, apiSuccessResponse } from '../../docs/schemas.js';
import {
  addCollaboratorSchema,
  collaboratorListSchema,
  collaboratorParamsSchema,
  collaboratorSchema,
  collaboratorUserParamsSchema,
  grantPermissionSchema,
  ownPermissionsQuerySchema,
  ownPermissionsSchema,
  revokePermissionSchema,
  updateCollaboratorRoleSchema,
} from './authorization.schemas.js';

const errorResponse = {
  description: 'Error response.',
  content: { 'application/json': { schema: apiErrorResponseSchema } },
} as const;

const listResponses = {
  200: {
    description: 'Local collaborators of the scope with effective permissions and provenance.',
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

const updateResponses = {
  200: {
    description: 'Collaborator role replaced with its ROLE_DEFAULT grants regenerated.',
    content: { 'application/json': { schema: apiSuccessResponse(collaboratorSchema) } },
  },
  400: errorResponse,
  401: errorResponse,
  403: errorResponse,
  404: errorResponse,
  409: errorResponse,
} as const;

const deleteResponses = {
  204: { description: 'Collaborator removed from the scope.' },
  400: errorResponse,
  401: errorResponse,
  403: errorResponse,
  404: errorResponse,
  409: errorResponse,
} as const;

const grantResponses = {
  200: {
    description:
      'Permission grant created or replaced; the collaborator is returned with its local grants.',
    content: { 'application/json': { schema: apiSuccessResponse(collaboratorSchema) } },
  },
  400: errorResponse,
  401: errorResponse,
  403: errorResponse,
  404: errorResponse,
  409: errorResponse,
} as const;

const ownPermissionsResponses = {
  200: {
    description: 'Effective permissions of the authenticated user in the requested scope.',
    content: { 'application/json': { schema: apiSuccessResponse(ownPermissionsSchema) } },
  },
  400: errorResponse,
  401: errorResponse,
  404: errorResponse,
} as const;

const revokeResponses = {
  204: { description: 'Local permission grant removed from the scope.' },
  400: errorResponse,
  401: errorResponse,
  403: errorResponse,
  404: errorResponse,
  409: errorResponse,
} as const;

const revokeDescription =
  'Removes a local permission grant (ROLE_DEFAULT or OVERRIDE) from an existing collaborator of the scope. Requires `permission:grant` in the scope or the ADMIN role; the actor can only revoke permissions it holds. In an activity scope the endpoint never touches the program grants: when the permission has no local grant but is actively inherited from the event program it responds 409 `Cannot revoke a permission inherited from the event program.` (revoke it at the program scope instead); when a local grant exists it is removed even if the permission stays effective through inheritance. Revoking `permission:grant` from the last active collaborator able to delegate in the scope responds 409. Archived event programs cannot be modified.';

const listDescription =
  'Lists the collaborators that live directly on the scope with their effective permissions. Requires `permission:grant` in the scope or the ADMIN role. Each permission carries `origin` (`LOCAL` when it comes from the scope, `INHERITED` from the parent event program, `BOTH` when both add it), the effective window merged from every active grant and `effective: true`; expired or future grants are omitted even though they stay stored. `source` describes the local grant kind (ROLE_DEFAULT or OVERRIDE) and falls back to ROLE_DEFAULT for permissions that only come from inheritance. Inherited program collaborations are not expanded as collaborators, only their permissions are resolved for the local ones. Audit fields (`grantedById`, `grantedAt`) are never returned.';

const addDescription =
  'Adds a collaborator to the scope and materializes the ROLE_DEFAULT grants of the assigned role. Requires `permission:grant` in the scope or the ADMIN role; the actor cannot assign a role whose defaults exceed its own permissions. Archived event programs cannot be modified. Audit fields (`grantedById`, `grantedAt`) are never returned.';

const updateDescription =
  'Changes the role of a local collaborator. Replaces its ROLE_DEFAULT grants with the defaults of the new role and preserves OVERRIDE grants. Requires `permission:grant` in the scope or the ADMIN role; the actor cannot assign a role whose defaults exceed its own permissions nor strip ROLE_DEFAULT grants it does not hold. Archived event programs cannot be modified. Audit fields (`grantedById`, `grantedAt`) are never returned.';

const deleteDescription =
  'Removes a local collaborator from the scope. Requires `permission:grant` in the scope or the ADMIN role; the actor cannot remove a collaborator holding permissions it does not hold. The scope must keep at least one active collaborator able to delegate (an active `permission:grant` or the ADMIN global role); removing the last one responds 409. Archived event programs cannot be modified.';

const grantDescription =
  'Creates or replaces a local OVERRIDE grant for an existing collaborator of the scope. Requires `permission:grant` in the scope or the ADMIN role. The actor can only grant permissions it holds and the requested window must stay inside its own envelope for that permission, so a time-bounded delegator cannot create unbounded grants. Re-granting the same permission replaces the window of the existing row. Archived event programs cannot be modified. Audit fields (`grantedById`, `grantedAt`) are never returned.';

const ownPermissionsDescription =
  'Returns the effective permissions of the authenticated user in the requested program or activity scope with their temporal envelopes and origin. Activity scopes union the activity-local grants (`origin: LOCAL`) with the ones inherited from the parent program (`origin: INHERITED`); `BOTH` is possible when the same permission is active through both sources. Expired or future grants are ignored and never returned. ADMIN receives the whole catalog as `LOCAL` with unbounded envelopes. A null window means unbounded. Missing scopes respond 404. Audit fields (`grantedById`, `grantedAt`) are never returned.';

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
  '/api/v1/event-programs/{id}/collaborators/{userId}': {
    patch: {
      tags: ['Collaborators'],
      summary: 'Change an event program collaborator role',
      description: updateDescription,
      security: [{ bearerAuth: [] }],
      requestParams: { path: updateCollaboratorRoleSchema.shape.params },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: updateCollaboratorRoleSchema.shape.body } },
      },
      responses: updateResponses,
    },
    delete: {
      tags: ['Collaborators'],
      summary: 'Remove an event program collaborator',
      description: deleteDescription,
      security: [{ bearerAuth: [] }],
      requestParams: { path: collaboratorUserParamsSchema.shape.params },
      responses: deleteResponses,
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
  '/api/v1/activities/{id}/collaborators/{userId}': {
    patch: {
      tags: ['Collaborators'],
      summary: 'Change an activity collaborator role',
      description: updateDescription,
      security: [{ bearerAuth: [] }],
      requestParams: { path: updateCollaboratorRoleSchema.shape.params },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: updateCollaboratorRoleSchema.shape.body } },
      },
      responses: updateResponses,
    },
    delete: {
      tags: ['Collaborators'],
      summary: 'Remove an activity collaborator',
      description: deleteDescription,
      security: [{ bearerAuth: [] }],
      requestParams: { path: collaboratorUserParamsSchema.shape.params },
      responses: deleteResponses,
    },
  },
  '/api/v1/event-programs/{id}/permissions': {
    post: {
      tags: ['Collaborators'],
      summary: 'Grant a permission in an event program',
      description: grantDescription,
      security: [{ bearerAuth: [] }],
      requestParams: { path: grantPermissionSchema.shape.params },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: grantPermissionSchema.shape.body } },
      },
      responses: grantResponses,
    },
  },
  '/api/v1/activities/{id}/permissions': {
    post: {
      tags: ['Collaborators'],
      summary: 'Grant a permission in an activity',
      description: grantDescription,
      security: [{ bearerAuth: [] }],
      requestParams: { path: grantPermissionSchema.shape.params },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: grantPermissionSchema.shape.body } },
      },
      responses: grantResponses,
    },
  },
  '/api/v1/event-programs/{id}/permissions/{permission}': {
    delete: {
      tags: ['Collaborators'],
      summary: 'Revoke a permission in an event program',
      description: revokeDescription,
      security: [{ bearerAuth: [] }],
      requestParams: {
        path: revokePermissionSchema.shape.params,
        query: revokePermissionSchema.shape.query,
      },
      responses: revokeResponses,
    },
  },
  '/api/v1/activities/{id}/permissions/{permission}': {
    delete: {
      tags: ['Collaborators'],
      summary: 'Revoke a permission in an activity',
      description: revokeDescription,
      security: [{ bearerAuth: [] }],
      requestParams: {
        path: revokePermissionSchema.shape.params,
        query: revokePermissionSchema.shape.query,
      },
      responses: revokeResponses,
    },
  },
  '/api/v1/users/me/permissions': {
    get: {
      tags: ['Collaborators'],
      summary: 'Get the authenticated user permissions in a scope',
      description: ownPermissionsDescription,
      security: [{ bearerAuth: [] }],
      requestParams: { query: ownPermissionsQuerySchema.shape.query },
      responses: ownPermissionsResponses,
    },
  },
};
