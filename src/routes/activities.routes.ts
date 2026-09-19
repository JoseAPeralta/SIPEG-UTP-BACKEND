import { Router } from 'express';

import { getActivities } from '../controllers/activities.controller.js';
import { validate } from '../middlewares/validate.middleware.js';
import { listActivitiesQuerySchema } from '../modules/activities/activities.schemas.js';

export const activitiesRoutes = Router();

activitiesRoutes.get('/activities', validate(listActivitiesQuerySchema), getActivities);
