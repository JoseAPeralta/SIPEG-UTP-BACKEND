import { Router } from 'express';

import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { requirePermission, type ScopeResolver } from '../../middlewares/authorize.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import {
  addActivityCollaborator,
  addEventProgramCollaborator,
  getActivityCollaborators,
  getEventProgramCollaborators,
  getOwnPermissions,
  grantActivityPermission,
  grantEventProgramPermission,
  removeActivityCollaborator,
  removeEventProgramCollaborator,
  revokeActivityPermission,
  revokeEventProgramPermission,
  updateActivityCollaboratorRole,
  updateEventProgramCollaboratorRole,
} from './authorization.controller.js';
import {
  addCollaboratorSchema,
  collaboratorParamsSchema,
  collaboratorUserParamsSchema,
  grantPermissionSchema,
  ownPermissionsQuerySchema,
  revokePermissionSchema,
  updateCollaboratorRoleSchema,
} from './authorization.schemas.js';
import { PERMISSIONS } from './permissions.js';

const eventProgramScope: ScopeResolver = (req) => {
  const id = (req.params as { id?: string }).id;

  return typeof id === 'string' && id.length > 0 ? { eventProgramId: id } : undefined;
};

const activityScope: ScopeResolver = (req) => {
  const id = (req.params as { id?: string }).id;

  return typeof id === 'string' && id.length > 0 ? { activityId: id } : undefined;
};

export const authorizationRoutes = Router();

authorizationRoutes.get(
  '/event-programs/:id/collaborators',
  authenticate,
  requirePermission(PERMISSIONS.PERMISSION_GRANT, eventProgramScope),
  validate(collaboratorParamsSchema),
  getEventProgramCollaborators,
);

authorizationRoutes.post(
  '/event-programs/:id/collaborators',
  authenticate,
  requirePermission(PERMISSIONS.PERMISSION_GRANT, eventProgramScope),
  validate(addCollaboratorSchema),
  addEventProgramCollaborator,
);

authorizationRoutes.patch(
  '/event-programs/:id/collaborators/:userId',
  authenticate,
  requirePermission(PERMISSIONS.PERMISSION_GRANT, eventProgramScope),
  validate(updateCollaboratorRoleSchema),
  updateEventProgramCollaboratorRole,
);

authorizationRoutes.delete(
  '/event-programs/:id/collaborators/:userId',
  authenticate,
  requirePermission(PERMISSIONS.PERMISSION_GRANT, eventProgramScope),
  validate(collaboratorUserParamsSchema),
  removeEventProgramCollaborator,
);

authorizationRoutes.get(
  '/activities/:id/collaborators',
  authenticate,
  requirePermission(PERMISSIONS.PERMISSION_GRANT, activityScope),
  validate(collaboratorParamsSchema),
  getActivityCollaborators,
);

authorizationRoutes.post(
  '/activities/:id/collaborators',
  authenticate,
  requirePermission(PERMISSIONS.PERMISSION_GRANT, activityScope),
  validate(addCollaboratorSchema),
  addActivityCollaborator,
);

authorizationRoutes.patch(
  '/activities/:id/collaborators/:userId',
  authenticate,
  requirePermission(PERMISSIONS.PERMISSION_GRANT, activityScope),
  validate(updateCollaboratorRoleSchema),
  updateActivityCollaboratorRole,
);

authorizationRoutes.delete(
  '/activities/:id/collaborators/:userId',
  authenticate,
  requirePermission(PERMISSIONS.PERMISSION_GRANT, activityScope),
  validate(collaboratorUserParamsSchema),
  removeActivityCollaborator,
);

authorizationRoutes.post(
  '/event-programs/:id/permissions',
  authenticate,
  requirePermission(PERMISSIONS.PERMISSION_GRANT, eventProgramScope),
  validate(grantPermissionSchema),
  grantEventProgramPermission,
);

authorizationRoutes.post(
  '/activities/:id/permissions',
  authenticate,
  requirePermission(PERMISSIONS.PERMISSION_GRANT, activityScope),
  validate(grantPermissionSchema),
  grantActivityPermission,
);

authorizationRoutes.delete(
  '/event-programs/:id/permissions/:permission',
  authenticate,
  requirePermission(PERMISSIONS.PERMISSION_GRANT, eventProgramScope),
  validate(revokePermissionSchema),
  revokeEventProgramPermission,
);

authorizationRoutes.delete(
  '/activities/:id/permissions/:permission',
  authenticate,
  requirePermission(PERMISSIONS.PERMISSION_GRANT, activityScope),
  validate(revokePermissionSchema),
  revokeActivityPermission,
);

authorizationRoutes.get(
  '/users/me/permissions',
  authenticate,
  validate(ownPermissionsQuerySchema),
  getOwnPermissions,
);
