import 'express';

import type { PermissionName } from '../modules/authorization/permissions.js';

declare global {
  namespace Express {
    interface AuthenticatedUser {
      id: string;
      email: string;
      globalRole: 'USER' | 'ADMIN';
      unitId: string | null;
      careerId: string | null;
      isActive: boolean;
    }

    interface RequestAuthorization {
      permissions: Set<PermissionName>;
    }

    interface Request {
      user?: AuthenticatedUser;
      authorization?: RequestAuthorization;
    }
  }
}

export {};
