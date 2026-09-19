import { Router } from 'express';

import { getEvents } from '../controllers/events.controller.js';
import { validate } from '../middlewares/validate.middleware.js';
import { listEventsQuerySchema } from '../modules/events/events.schemas.js';

export const eventRoutes = Router();

eventRoutes.get('/events', validate(listEventsQuerySchema), getEvents);
