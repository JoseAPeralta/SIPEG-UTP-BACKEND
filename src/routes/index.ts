import { Router } from 'express';

import { eventRoutes } from './events.routes.js';
import { healthRoutes } from './health.routes.js';

export const apiRoutes = Router();

apiRoutes.use(eventRoutes);
apiRoutes.use(healthRoutes);
