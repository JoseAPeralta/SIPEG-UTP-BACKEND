import { Router } from 'express';

import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { requirePermission } from '../../middlewares/authorize.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../authorization/permissions.js';
import {
  createEventProgram,
  getEventPrograms,
  updateEventProgram,
} from './event-programs.controller.js';
import {
  createEventProgramSchema,
  listEventProgramsQuerySchema,
  updateEventProgramSchema,
} from './event-programs.schemas.js';

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
