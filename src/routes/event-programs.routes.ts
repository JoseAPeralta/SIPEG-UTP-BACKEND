import { Router } from 'express';

import {
  createEventProgram,
  getEventPrograms,
  updateEventProgram,
} from '../controllers/event-programs.controller.js';
import { authenticate } from '../middlewares/authenticate.middleware.js';
import { requirePermission } from '../middlewares/authorize.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../modules/authorization/permissions.js';
import {
  createEventProgramSchema,
  listEventProgramsQuerySchema,
  updateEventProgramSchema,
} from '../modules/event-programs/event-programs.schemas.js';

export const eventProgramsRoutes = Router();

eventProgramsRoutes.get(
  '/event-programs',
  validate(listEventProgramsQuerySchema),
  getEventPrograms,
);

eventProgramsRoutes.post(
  '/event-programs',
  authenticate,
  requirePermission(PERMISSIONS.PROGRAM_CREATE),
  validate(createEventProgramSchema),
  createEventProgram,
);

eventProgramsRoutes.patch(
  '/event-programs/:id',
  authenticate,
  requirePermission(PERMISSIONS.PROGRAM_UPDATE, (req) => {
    const id = (req.params as { id?: string }).id;

    return typeof id === 'string' && id.length > 0 ? { eventProgramId: id } : undefined;
  }),
  validate(updateEventProgramSchema),
  updateEventProgram,
);
