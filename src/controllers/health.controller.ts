import type { RequestHandler } from 'express';

import { env } from '../config/env.js';
import type { HealthStatusResponse } from '../models/health.model.js';
import { successResponse } from '../utils/response.js';

export const getHealth: RequestHandler = (_req, res) => {
  const health: HealthStatusResponse = {
    status: 'ok',
    service: 'sipeg-utp-backend',
    environment: env.NODE_ENV,
  };

  res.status(200).json(successResponse('Service is healthy.', health));
};
