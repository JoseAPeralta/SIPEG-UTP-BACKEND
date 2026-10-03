import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { apiSuccessResponse, errorResponse } from '../../docs/schemas.js';
import {
  listMyCertificatesQuerySchema,
  paginatedMyCertificatesSchema,
} from './certificates.schemas.js';

export const certificatesPaths: ZodOpenApiPathsObject = {
  '/api/v1/users/me/certificates': {
    get: {
      tags: ['Certificates'],
      summary: 'List my certificates',
      description:
        'Paginated list of the certificates issued to the authenticated user, most recently issued first. Each item carries the certificate code, its issuance instant and the activity and event program it attests. Storage paths and attendance internals are not exposed, because certificate download does not exist yet. Supports filters by event program, activity and an issuance date range interpreted in the institutional calendar (America/Panama).',
      security: [{ bearerAuth: [] }],
      requestParams: { query: listMyCertificatesQuerySchema.shape.query },
      responses: {
        200: {
          description: 'Paginated list of own certificates.',
          content: {
            'application/json': { schema: apiSuccessResponse(paginatedMyCertificatesSchema) },
          },
        },
        400: errorResponse('Invalid query parameters.'),
        401: errorResponse('Authentication required.'),
      },
    },
  },
};
