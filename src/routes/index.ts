import { Router } from 'express';

import { authRoutes } from '../modules/auth/auth.routes.js';
import { usersRoutes } from '../modules/users/users.routes.js';
import { activitiesRoutes } from './activities.routes.js';
import { eventProgramsRoutes } from './event-programs.routes.js';
import { healthRoutes } from './health.routes.js';

export const apiRoutes = Router();

apiRoutes.use(authRoutes);
apiRoutes.use(usersRoutes);
apiRoutes.use(activitiesRoutes);
apiRoutes.use(eventProgramsRoutes);
apiRoutes.use(healthRoutes);
