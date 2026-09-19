import type { RequestHandler } from 'express';

import { env } from '../config/env.js';
import type { HealthStatusResponse } from '../models/health.model.js';
import { successResponse } from '../utils/response.js';

const checkJwks = async (): Promise<boolean> => {
  try {
    const url = new URL('/api/auth/jwks', env.AUTH_URL).toString();
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
};

export const getHealth: RequestHandler = async (_req, res) => {
  const authJwksReachable = await checkJwks();
  const health: HealthStatusResponse = {
    status: 'ok',
    service: 'sipeg-utp-backend',
    environment: env.NODE_ENV,
    authJwksReachable,
  };

  res.status(200).json(successResponse('Service is healthy.', health));
};
