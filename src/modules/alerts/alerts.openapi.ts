import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { apiSuccessResponse, errorResponse } from '../../docs/schemas.js';
import {
  alertParamsSchema,
  alertSchema,
  listAlertsQuerySchema,
  markAllAlertsReadResultSchema,
  paginatedAlertsSchema,
} from './alerts.schemas.js';

export const alertsPaths: ZodOpenApiPathsObject = {
  '/api/v1/alerts': {
    get: {
      tags: ['Alerts'],
      summary: 'List my alerts',
      description:
        'Paginated list of the alerts addressed to the authenticated user, most recent first. Supports filters by read state and alert type. A user only ever sees its own alerts; the recipient identifier is taken from the access token and cannot be overridden through the query.',
      security: [{ bearerAuth: [] }],
      requestParams: { query: listAlertsQuerySchema.shape.query },
      responses: {
        200: {
          description: 'Paginated list of own alerts.',
          content: {
            'application/json': { schema: apiSuccessResponse(paginatedAlertsSchema) },
          },
        },
        400: errorResponse('Invalid query parameters.'),
        401: errorResponse('Authentication required.'),
      },
    },
  },
  '/api/v1/alerts/read-all': {
    post: {
      tags: ['Alerts'],
      summary: 'Mark all my alerts as read',
      description:
        'Marks every unread alert of the authenticated user as read and reports how many alerts changed. Repeating the call reports zero. The operation is idempotent and never touches another recipient.',
      security: [{ bearerAuth: [] }],
      responses: {
        200: {
          description: 'All own unread alerts were marked as read.',
          content: {
            'application/json': { schema: apiSuccessResponse(markAllAlertsReadResultSchema) },
          },
        },
        400: errorResponse('Unexpected request body.'),
        401: errorResponse('Authentication required.'),
      },
    },
  },
  '/api/v1/alerts/{id}': {
    get: {
      tags: ['Alerts'],
      summary: 'Get my alert',
      description:
        'Returns a single alert owned by the authenticated user. A missing alert and an alert owned by another user both respond with the same 404, so the endpoint cannot be used to discover foreign alerts.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: alertParamsSchema.shape.params },
      responses: {
        200: {
          description: 'Own alert detail.',
          content: {
            'application/json': { schema: apiSuccessResponse(alertSchema) },
          },
        },
        400: errorResponse('Invalid alert id.'),
        401: errorResponse('Authentication required.'),
        404: errorResponse('Alert not found.'),
      },
    },
  },
  '/api/v1/alerts/{id}/read': {
    patch: {
      tags: ['Alerts'],
      summary: 'Mark my alert as read',
      description:
        'Marks a single alert owned by the authenticated user as read and returns the resulting alert. The operation is idempotent: marking an already read alert succeeds. A missing alert and an alert owned by another user both respond with the same 404.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: alertParamsSchema.shape.params },
      responses: {
        200: {
          description: 'Alert marked as read.',
          content: {
            'application/json': { schema: apiSuccessResponse(alertSchema) },
          },
        },
        400: errorResponse('Invalid alert id or unexpected request body.'),
        401: errorResponse('Authentication required.'),
        404: errorResponse('Alert not found.'),
      },
    },
  },
};
