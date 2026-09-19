import { Router } from 'express';

import { createActivity, getActivities } from '../controllers/activities.controller.js';
import { authenticate } from '../middlewares/authenticate.middleware.js';
import { requirePermission } from '../middlewares/authorize.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  createActivitySchema,
  listActivitiesQuerySchema,
} from '../modules/activities/activities.schemas.js';
import { PERMISSIONS } from '../modules/authorization/permissions.js';

export const activitiesRoutes = Router();

activitiesRoutes.get('/activities', validate(listActivitiesQuerySchema), getActivities);
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
