import { Router } from 'express';

import { activitiesRoutes } from './modules/activities/activities.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { eventProgramsRoutes } from './modules/event-programs/event-programs.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { usersRoutes } from './modules/users/users.routes.js';

export const apiRoutes = Router();

apiRoutes.use(authRoutes);
apiRoutes.use(usersRoutes);
apiRoutes.use(activitiesRoutes);
apiRoutes.use(eventProgramsRoutes);
apiRoutes.use(healthRoutes);
