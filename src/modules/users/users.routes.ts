import { Router } from 'express';

import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { requireAdmin } from '../../middlewares/authorize.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import {
  createUser,
  getCurrentUser,
  getUser,
  listUsers,
  updateCurrentUser,
  updateUser,
} from './users.controller.js';
import {
  adminUserParamsSchema,
  createUserSchema,
  listUsersQuerySchema,
  updateAdminUserSchema,
  updateProfileSchema,
} from './users.schemas.js';

export const usersRoutes = Router();

usersRoutes.get('/users/me', authenticate, getCurrentUser);
usersRoutes.patch('/users/me', authenticate, validate(updateProfileSchema), updateCurrentUser);
usersRoutes.get(
  '/admin/users',
  authenticate,
  requireAdmin,
  validate(listUsersQuerySchema),
  listUsers,
);

usersRoutes.post(
  '/admin/users',
  authenticate,
  requireAdmin,
  validate(createUserSchema),
  createUser,
);

usersRoutes.get(
  '/admin/users/:id',
  authenticate,
  requireAdmin,
  validate(adminUserParamsSchema),
  getUser,
);

usersRoutes.patch(
  '/admin/users/:id',
  authenticate,
  requireAdmin,
  validate(updateAdminUserSchema),
  updateUser,
);
