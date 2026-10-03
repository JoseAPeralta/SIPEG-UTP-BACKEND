import { Router } from 'express';

import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { noStore } from '../../middlewares/noStore.middleware.js';
import {
  changePasswordRateLimit,
  emailVerificationRateLimit,
  forgotPasswordRateLimit,
  loginRateLimit,
  refreshRateLimit,
  registerRateLimit,
  resetPasswordRateLimit,
} from '../../middlewares/rateLimit.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { requireTrustedOrigin } from '../../middlewares/trustedOrigin.middleware.js';
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

authRoutes.post(
  '/auth/login',
  noStore,
  requireTrustedOrigin,
  loginRateLimit,
  validate(loginSchema),
  login,
);
authRoutes.post('/auth/register', registerRateLimit, validate(registerSchema), register);
// `requireTrustedOrigin` va antes del limitador: un origen no permitido es un
// intento, no trafico legitimo, y no debe gastar cuota ni quedar registrado como
// un 429 por el frontend.
authRoutes.post(
  '/auth/refresh',
  noStore,
  requireTrustedOrigin,
  refreshRateLimit,
  validate(refreshSchema),
  refresh,
);
authRoutes.post('/auth/logout', noStore, requireTrustedOrigin, validate(logoutSchema), logout);
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
  requireTrustedOrigin,
  authenticate,
  changePasswordRateLimit,
  refreshRateLimit,
  validate(changePasswordSchema),
  changePasswordHandler,
);
