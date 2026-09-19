import { Router } from 'express';

import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { getCurrentUser, updateCurrentUser } from './users.controller.js';
import { updateProfileSchema } from './users.schemas.js';

export const usersRoutes = Router();

usersRoutes.get('/users/me', authenticate, getCurrentUser);
usersRoutes.patch('/users/me', authenticate, validate(updateProfileSchema), updateCurrentUser);
