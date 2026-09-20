import { Router } from 'express';

import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { requirePermission, type ScopeResolver } from '../../middlewares/authorize.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import {
  addActivityCollaborator,
  addEventProgramCollaborator,
  getActivityCollaborators,
  getEventProgramCollaborators,
} from './authorization.controller.js';
import { addCollaboratorSchema, collaboratorParamsSchema } from './authorization.schemas.js';
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
