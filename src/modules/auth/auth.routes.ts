import { Router } from 'express';

import { authRateLimiter } from '../../middlewares/rateLimit.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { login, register } from './auth.controller.js';
import { loginUserSchema, registerUserSchema } from './auth.schemas.js';

export const authRoutes = Router();

authRoutes.post('/auth/register', authRateLimiter, validate(registerUserSchema), register);
authRoutes.post('/auth/login', authRateLimiter, validate(loginUserSchema), login);
