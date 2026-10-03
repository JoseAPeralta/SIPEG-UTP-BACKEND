import type { Request, RequestHandler } from 'express';

import { getEffectivePermissions } from '../modules/authorization/authorization.service.js';
import type { AuthorizationScope } from '../modules/authorization/authorization.types.js';
import { PERMISSION_NAMES, type PermissionName } from '../modules/authorization/permissions.js';
import { createRequestLogger } from '../config/logger.js';
import { pseudonymize } from '../utils/pseudonymize.js';
import { ApiError } from '../utils/ApiError.js';
import { requireAuthenticatedUser } from './authenticate.middleware.js';

export type GlobalRole = 'USER' | 'ADMIN';

export type ScopeResolver = (
  req: Request,
) => Promise<AuthorizationScope | undefined> | AuthorizationScope | undefined;

export const requireRole = (...allowed: GlobalRole[]): RequestHandler => {
  return (req, _res, next) => {
    try {
      const user = requireAuthenticatedUser(req);
      if (!allowed.includes(user.globalRole)) {
        createRequestLogger({
          event: 'authorization.denied',
          logType: 'security',
          actorPseudonym: pseudonymize(user.id),
          requiredRole: allowed.join(','),
          actualRole: user.globalRole,
        }).warn('authorization.denied');
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
  selector: (req: Request) => string | undefined,
): RequestHandler => {
  return (req, _res, next) => {
    try {
      const user = requireAuthenticatedUser(req);
      const ownerId = selector(req);
      if (!ownerId || ownerId !== user.id) {
        createRequestLogger({
          event: 'authorization.denied',
          logType: 'security',
          actorPseudonym: pseudonymize(user.id),
        }).warn('authorization.denied');
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
        // Sin scope no hay nada que autorizar, pero el 403 sigue siendo una
        // denegacion: se registra con el permiso pedido para que el panel de
        // seguridad pueda explicarla. Los ids del scope no se emiten porque no
        // se conocen, que es justamente la causa de la denegacion.
        createRequestLogger({
          event: 'authorization.denied',
          logType: 'security',
          actorPseudonym: pseudonymize(user.id),
          requiredPermission: permission,
        }).warn('authorization.denied');
        throw new ApiError(403, 'Insufficient privileges for this resource.');
      }

      const permissions = await getEffectivePermissions(user, scope);
      req.authorization = { permissions };

      if (!permissions.has(permission)) {
        createRequestLogger({
          event: 'authorization.denied',
          logType: 'security',
          actorPseudonym: pseudonymize(user.id),
          requiredPermission: permission,
          eventProgramId: scope.eventProgramId,
          activityId: scope.activityId,
        }).warn('authorization.denied');
        throw new ApiError(403, 'Insufficient privileges for this resource.');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
