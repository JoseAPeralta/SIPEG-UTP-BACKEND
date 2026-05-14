import { Router } from 'express';

import { authRateLimiter } from '../../middlewares/rateLimit.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { register } from './auth.controller.js';
import { registerUserSchema } from './auth.schemas.js';

export const authRoutes = Router();

authRoutes.post('/auth/register', authRateLimiter, validate(registerUserSchema), register);
