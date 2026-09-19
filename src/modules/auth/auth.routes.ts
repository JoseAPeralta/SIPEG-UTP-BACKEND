import { Router } from 'express';

import {
  loginRateLimit,
  passwordResetRateLimit,
  registerRateLimit,
} from '../../middlewares/rateLimit.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import {
  forgotPasswordHandler,
  login,
  logout,
  refresh,
  register,
  resetPasswordHandler,
  verifyEmailHandler,
} from './auth.controller.js';
import {
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from './auth.schemas.js';

export const authRoutes = Router();

authRoutes.post('/auth/login', loginRateLimit, validate(loginSchema), login);
authRoutes.post('/auth/register', registerRateLimit, validate(registerSchema), register);
authRoutes.post('/auth/refresh', loginRateLimit, validate(refreshSchema), refresh);
authRoutes.post('/auth/logout', validate(logoutSchema), logout);
authRoutes.post('/auth/verify-email', validate(verifyEmailSchema), verifyEmailHandler);
authRoutes.post(
  '/auth/forgot-password',
  passwordResetRateLimit,
  validate(forgotPasswordSchema),
  forgotPasswordHandler,
);
authRoutes.post(
  '/auth/reset-password',
  passwordResetRateLimit,
  validate(resetPasswordSchema),
  resetPasswordHandler,
);
