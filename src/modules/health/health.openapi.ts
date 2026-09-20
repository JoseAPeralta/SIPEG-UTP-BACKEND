import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { apiSuccessResponse } from '../../docs/schemas.js';
import { healthResponseSchema } from './health.schemas.js';

export const healthPaths: ZodOpenApiPathsObject = {
  '/api/v1/health': {
    get: {
      tags: ['Health'],
      summary: 'Service health check',
      responses: {
        200: {
          description: 'Current health status of the API.',
          content: { 'application/json': { schema: apiSuccessResponse(healthResponseSchema) } },
        },
      },
    },
  },
};
