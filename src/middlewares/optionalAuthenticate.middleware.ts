import type { RequestHandler } from 'express';

import { getJwtVerifier } from '../utils/jwt-verifier.js';
import { extractBearerToken, loadActiveUser } from './authenticate.middleware.js';

export const optionalAuthenticate: RequestHandler = async (req, _res, next) => {
  if (!req.headers.authorization) {
    next();
    return;
  }

  try {
    const token = extractBearerToken(req.headers.authorization);
    const verifier = getJwtVerifier();
    const payload = await verifier.verify(token);
    req.user = await loadActiveUser(payload.sub);
    next();
  } catch (error) {
    next(error);
  }
};
