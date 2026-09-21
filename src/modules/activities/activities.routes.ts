import { Router } from 'express';

import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { requirePermission, type ScopeResolver } from '../../middlewares/authorize.middleware.js';
import { optionalAuthenticate } from '../../middlewares/optionalAuthenticate.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../authorization/permissions.js';
import {
  cancelActivity,
  createActivity,
  getActivities,
  getActivity,
  getEventProgramActivities,
  updateActivity,
} from './activities.controller.js';
import {
  activityParamsSchema,
  cancelActivitySchema,
  createActivitySchema,
  listActivitiesQuerySchema,
  listEventProgramActivitiesSchema,
  updateActivitySchema,
} from './activities.schemas.js';

export const activitiesRoutes = Router();

const activityScope: ScopeResolver = (req) => {
  const id = (req.params as { id?: string }).id;

  return typeof id === 'string' && id.length > 0 ? { activityId: id } : undefined;
};

activitiesRoutes.get('/activities', validate(listActivitiesQuerySchema), getActivities);

activitiesRoutes.get(
  '/activities/:id',
  optionalAuthenticate,
  validate(activityParamsSchema),
  getActivity,
);

activitiesRoutes.get(
  '/event-programs/:id/activities',
  optionalAuthenticate,
  validate(listEventProgramActivitiesSchema),
  getEventProgramActivities,
);
activitiesRoutes.post(
  '/activities',
  authenticate,
  requirePermission(PERMISSIONS.ACTIVITY_CREATE, (req) => {
    const eventProgramId = (req.body as { eventProgramId?: unknown } | undefined)?.eventProgramId;

    return typeof eventProgramId === 'string' && eventProgramId.length > 0
      ? { eventProgramId }
      : undefined;
  }),
  validate(createActivitySchema),
  createActivity,
);
activitiesRoutes.patch(
  '/activities/:id',
  authenticate,
  requirePermission(PERMISSIONS.ACTIVITY_UPDATE, activityScope),
  validate(updateActivitySchema),
  updateActivity,
);

activitiesRoutes.post(
  '/activities/:id/cancel',
  authenticate,
  requirePermission(PERMISSIONS.ACTIVITY_CANCEL, activityScope),
  validate(cancelActivitySchema),
  cancelActivity,
);
