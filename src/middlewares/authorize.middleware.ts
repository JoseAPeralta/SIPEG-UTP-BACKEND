import type { Request, RequestHandler } from 'express';

import type { CollaborationRole } from '../generated/prisma/enums.js';
import {
  hasRequiredRole,
  resolveActivityAccess,
  resolveProgramAccess,
} from '../services/authorization.service.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuthenticatedUser } from './auth.middleware.js';

const forbiddenError = (): ApiError => {
  return new ApiError(403, 'You do not have permission to perform this action.');
};

const requireRouteParam = (req: Request, name: string, label: string): string => {
  const value = req.params[name];

  if (typeof value !== 'string' || value.length === 0) {
    throw new ApiError(400, `${label} is required.`);
  }

  return value;
};

export const requireProgramRole = (requiredRole: CollaborationRole): RequestHandler => {
  return asyncHandler(async (req, _res, next) => {
    const user = requireAuthenticatedUser(req);
    const eventProgramId = requireRouteParam(req, 'eventProgramId', 'Event program ID');

    const access = await resolveProgramAccess(user, eventProgramId);

    if (!access || !hasRequiredRole(access.role, requiredRole)) {
      throw forbiddenError();
    }

    next();
  });
};

export const requireActivityRole = (requiredRole: CollaborationRole): RequestHandler => {
  return asyncHandler(async (req, _res, next) => {
    const user = requireAuthenticatedUser(req);
    const activityId = requireRouteParam(req, 'activityId', 'Activity ID');

    const access = await resolveActivityAccess(user, activityId);

    if (!access || !hasRequiredRole(access.role, requiredRole)) {
      throw forbiddenError();
    }

    next();
  });
};
