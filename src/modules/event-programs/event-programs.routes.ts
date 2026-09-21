import { Router } from 'express';

import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { requirePermission } from '../../middlewares/authorize.middleware.js';
import { methodNotAllowed } from '../../middlewares/methodNotAllowed.middleware.js';
import { optionalAuthenticate } from '../../middlewares/optionalAuthenticate.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { PERMISSIONS } from '../authorization/permissions.js';
import {
  archiveEventProgram,
  createEventProgram,
  getEventProgram,
  getEventPrograms,
  reactivateEventProgram,
  updateEventProgram,
} from './event-programs.controller.js';
import {
  createEventProgramSchema,
  eventProgramParamsSchema,
  listEventProgramsQuerySchema,
  updateEventProgramSchema,
} from './event-programs.schemas.js';

export const eventProgramsRoutes = Router();

eventProgramsRoutes.get(
  '/event-programs',
  optionalAuthenticate,
  validate(listEventProgramsQuerySchema),
  getEventPrograms,
);

eventProgramsRoutes.get(
  '/event-programs/:id',
  optionalAuthenticate,
  validate(eventProgramParamsSchema),
  getEventProgram,
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

eventProgramsRoutes.post(
  '/event-programs/:id/archive',
  authenticate,
  requirePermission(PERMISSIONS.PROGRAM_ARCHIVE, (req) => {
    const id = (req.params as { id?: string }).id;

    return typeof id === 'string' && id.length > 0 ? { eventProgramId: id } : undefined;
  }),
  validate(eventProgramParamsSchema),
  archiveEventProgram,
);

eventProgramsRoutes.post(
  '/event-programs/:id/reactivate',
  authenticate,
  requirePermission(PERMISSIONS.PROGRAM_REACTIVATE, (req) => {
    const id = (req.params as { id?: string }).id;

    return typeof id === 'string' && id.length > 0 ? { eventProgramId: id } : undefined;
  }),
  validate(eventProgramParamsSchema),
  reactivateEventProgram,
);

eventProgramsRoutes.delete('/event-programs', methodNotAllowed(['GET', 'POST']));

eventProgramsRoutes.delete('/event-programs/:id', methodNotAllowed(['GET', 'PATCH']));
