import { Router } from 'express';

import { createEventProgram } from '../controllers/event-programs.controller.js';
import { authenticate } from '../middlewares/authenticate.middleware.js';
import { requirePermission } from '../middlewares/authorize.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../modules/authorization/permissions.js';
import { createEventProgramSchema } from '../modules/event-programs/event-programs.schemas.js';

export const eventProgramsRoutes = Router();

eventProgramsRoutes.post(
  '/event-programs',
  authenticate,
  requirePermission(PERMISSIONS.PROGRAM_CREATE),
  validate(createEventProgramSchema),
  createEventProgram,
);
