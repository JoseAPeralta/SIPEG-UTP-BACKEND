import { Router } from 'express';

import { authenticate } from '../../middlewares/authenticate.middleware.js';
import {
  changePasswordRateLimit,
  emailVerificationRateLimit,
  forgotPasswordRateLimit,
  loginRateLimit,
  registerRateLimit,
  resetPasswordRateLimit,
} from '../../middlewares/rateLimit.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import {
  changePasswordHandler,
  forgotPasswordHandler,
  login,
  logout,
  refresh,
  register,
  resetPasswordHandler,
  verifyEmailHandler,
} from './auth.controller.js';
import {
  changePasswordSchema,
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
authRoutes.post(
  '/auth/verify-email',
  emailVerificationRateLimit,
  validate(verifyEmailSchema),
  verifyEmailHandler,
);
authRoutes.post(
  '/auth/forgot-password',
  forgotPasswordRateLimit,
  validate(forgotPasswordSchema),
  forgotPasswordHandler,
);
authRoutes.post(
  '/auth/reset-password',
  resetPasswordRateLimit,
  validate(resetPasswordSchema),
  resetPasswordHandler,
);
authRoutes.post(
  '/auth/change-password',
  authenticate,
  changePasswordRateLimit,
  validate(changePasswordSchema),
  changePasswordHandler,
);
