import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { apiErrorResponseSchema, apiSuccessResponse } from '../../docs/schemas.js';
import { auditEventPageSchema, listAuditEventsQuerySchema } from './audit.schemas.js';

const errorResponse = {
  description: 'Error response.',
  content: { 'application/json': { schema: apiErrorResponseSchema } },
} as const;

export const auditPaths: ZodOpenApiPathsObject = {
  '/api/v1/audit-events': {
    get: {
      tags: ['Audit'],
      summary: 'List audit events',
      description:
        'Read-only listing of the durable audit log. Requires the ADMIN role. The log is append-only, so no create, update or delete operation exists for it. Events are ordered by occurredAt and id, both descending, and the response is paginated with an opaque cursor: pass the nextCursor of a page as the cursor of the following request. Filters can be combined freely; limit defaults to 20 and cannot exceed 100. The response carries identifiers only, never the personal data of the actors.',
      security: [{ bearerAuth: [] }],
      requestParams: { query: listAuditEventsQuerySchema.shape.query },
      responses: {
        200: {
          description: 'Page of audit events, most recent first.',
          content: { 'application/json': { schema: apiSuccessResponse(auditEventPageSchema) } },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
      },
    },
  },
};
