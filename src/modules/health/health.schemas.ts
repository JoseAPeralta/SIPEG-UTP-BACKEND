import { z } from 'zod';

import type { HealthStatusResponse } from './health.model.js';

export const healthResponseSchema = z
  .object({
    status: z.literal('ok').meta({ description: 'Service liveness marker.' }),
    service: z.string().meta({ description: 'Service name.' }),
    environment: z.string().meta({ description: 'Runtime environment.' }),
    authJwksReachable: z.boolean().meta({ description: 'Whether the JWKS endpoint is reachable.' }),
  })
  .meta({
    id: 'HealthStatus',
    description: 'Current health status of the API.',
  }) satisfies z.ZodType<HealthStatusResponse>;
