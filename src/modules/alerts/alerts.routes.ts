import { Router } from 'express';

import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { getAlert, getAlerts, markAlertAsRead, markAllAlertsAsRead } from './alerts.controller.js';
import {
  alertParamsSchema,
  listAlertsQuerySchema,
  markAlertReadSchema,
  markAllAlertsReadSchema,
} from './alerts.schemas.js';

export const alertsRoutes = Router();

alertsRoutes.get('/alerts', authenticate, validate(listAlertsQuerySchema), getAlerts);

alertsRoutes.post(
  '/alerts/read-all',
  authenticate,
  validate(markAllAlertsReadSchema),
  markAllAlertsAsRead,
);

alertsRoutes.get('/alerts/:id', authenticate, validate(alertParamsSchema), getAlert);

alertsRoutes.patch(
  '/alerts/:id/read',
  authenticate,
  validate(markAlertReadSchema),
  markAlertAsRead,
);
