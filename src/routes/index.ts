import { Router } from 'express';

import { authRoutes } from '../modules/auth/auth.routes.js';
import { usersRoutes } from '../modules/users/users.routes.js';
import { eventRoutes } from './events.routes.js';
import { healthRoutes } from './health.routes.js';

export const apiRoutes = Router();

apiRoutes.use(authRoutes);
apiRoutes.use(usersRoutes);
apiRoutes.use(eventRoutes);
apiRoutes.use(healthRoutes);
