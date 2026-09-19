import type { RequestHandler } from 'express';

import { getEffectivePermissions } from '../modules/authorization/authorization.service.js';
import type { AuthorizationScope } from '../modules/authorization/authorization.types.js';
import {
  PERMISSION_NAMES,
  type PermissionName,
} from '../modules/authorization/permissions.js';
import { ApiError } from '../utils/ApiError.js';
import { requireAuthenticatedUser } from './authenticate.middleware.js';

export type GlobalRole = 'USER' | 'ADMIN';

export type ScopeResolver = (
  req: Express.Request,
) => Promise<AuthorizationScope | undefined> | AuthorizationScope | undefined;

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

export const requirePermission = (
  permission: PermissionName,
  resolveScope?: ScopeResolver,
): RequestHandler => {
  return async (req, _res, next) => {
    try {
      const user = requireAuthenticatedUser(req);

      if (user.globalRole === 'ADMIN') {
        req.authorization = { permissions: new Set(PERMISSION_NAMES) };
        next();
        return;
      }

      const scope = resolveScope ? await resolveScope(req) : undefined;
      if (!scope) {
        throw new ApiError(403, 'Insufficient privileges for this resource.');
      }

      const permissions = await getEffectivePermissions(user, scope);
      req.authorization = { permissions };

      if (!permissions.has(permission)) {
        throw new ApiError(403, 'Insufficient privileges for this resource.');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
