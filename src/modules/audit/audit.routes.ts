import { Router } from 'express';

import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { requireAdmin } from '../../middlewares/authorize.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { getAuditEvents } from './audit.controller.js';
import { listAuditEventsQuerySchema } from './audit.schemas.js';

export const auditRoutes = Router();

auditRoutes.get(
  '/audit-events',
  authenticate,
  requireAdmin,
  validate(listAuditEventsQuerySchema),
  getAuditEvents,
);
