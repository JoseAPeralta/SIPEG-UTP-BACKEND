import { Router } from 'express';

import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { requirePermission } from '../../middlewares/authorize.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../authorization/permissions.js';
import { createActivity, getActivities } from './activities.controller.js';
import { createActivitySchema, listActivitiesQuerySchema } from './activities.schemas.js';

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
