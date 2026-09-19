import { Router } from 'express';

import { getEvents } from '../controllers/events.controller.js';

export const eventRoutes = Router();

eventRoutes.get('/events', getEvents);
