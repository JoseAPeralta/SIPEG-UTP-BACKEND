import type { RequestHandler } from 'express';

import { ApiError } from '../utils/ApiError.js';
import { requireAuthenticatedUser } from './authenticate.middleware.js';

export type GlobalRole = 'USER' | 'ADMIN';

export const requireRole = (...allowed: GlobalRole[]): RequestHandler => {
  return (req, _res, next) => {
    try {
      const user = requireAuthenticatedUser(req);
      if (!allowed.includes(user.globalRole)) {
        throw new ApiError(403, 'Insufficient privileges for this resource.');
      }
      next();
    } catch (error) {
      next(error);
    }
  };
};

export const requireAdmin: RequestHandler = requireRole('ADMIN');

export const requireOwnership = (
  selector: (req: Express.Request) => string | undefined,
): RequestHandler => {
  return (req, _res, next) => {
    try {
      const user = requireAuthenticatedUser(req);
      const ownerId = selector(req);
      if (!ownerId || ownerId !== user.id) {
        throw new ApiError(403, 'You do not own this resource.');
      }
      next();
    } catch (error) {
      next(error);
    }
  };
};
