import { Router } from 'express';

import { activitiesRoutes } from './modules/activities/activities.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { authorizationRoutes } from './modules/authorization/authorization.routes.js';
import { careersRoutes } from './modules/careers/careers.routes.js';
import { classroomsRoutes } from './modules/classrooms/classrooms.routes.js';
import { eventProgramsRoutes } from './modules/event-programs/event-programs.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { organizationalUnitsRoutes } from './modules/organizational-units/organizational-units.routes.js';
import { usersRoutes } from './modules/users/users.routes.js';

export const apiRoutes = Router();

apiRoutes.use(authRoutes);
apiRoutes.use(usersRoutes);
apiRoutes.use(authorizationRoutes);
apiRoutes.use(activitiesRoutes);
apiRoutes.use(classroomsRoutes);
apiRoutes.use(eventProgramsRoutes);
apiRoutes.use(organizationalUnitsRoutes);
apiRoutes.use(careersRoutes);
apiRoutes.use(healthRoutes);
