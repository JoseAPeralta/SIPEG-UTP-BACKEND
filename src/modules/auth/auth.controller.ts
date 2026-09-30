import type { RequestHandler } from 'express';

import { requireAuthenticatedUser } from '../../middlewares/authenticate.middleware.js';
import { ApiError } from '../../utils/ApiError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { successResponse } from '../../utils/response.js';
import type {
  ChangePasswordBody,
  ForgotPasswordBody,
  LoginBody,
  RegisterBody,
  ResetPasswordBody,
  VerifyEmailBody,
} from './auth.schemas.js';
import {
  changePassword,
  loginWithPassword,
  logoutUser,
  refreshAccessToken,
  registerUser,
  requestPasswordReset,
  resetPassword,
  verifyEmail,
} from './auth.service.js';
import { clearRefreshCookie, readRefreshToken, writeRefreshCookie } from './auth.cookie.js';
import { env } from '../../config/env.js';
import { resolveRefreshCookiePolicy } from './auth.cookie.js';

/**
 * La cookie de refresco es la unica credencial de larga duracion y va marcada
 * como `HttpOnly`, asi que el body ya no la lleva: `formatAuthSuccess` expone solo
 * el access token, que es de 15 minutos y vive en memoria en el cliente.
 */
const formatAuthSuccess = (
  result: Awaited<ReturnType<typeof loginWithPassword>>,
): Record<string, unknown> => ({
  accessToken: result.accessToken,
  accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
  refreshTokenExpiresAt: result.refreshTokenExpiresAt.toISOString(),
  tokenType: 'Bearer',
});

const refreshCookiePolicy = resolveRefreshCookiePolicy(env);

/** Sin cookie no hay nada que rotar ni cerrar. 401 explicito, nunca un 500. */
const requireRefreshToken = (req: Parameters<typeof readRefreshToken>[0]): string => {
  const token = readRefreshToken(req);

  if (token === undefined) {
    throw new ApiError(401, 'Refresh token is invalid.');
  }

  return token;
};

export const login: RequestHandler = asyncHandler(async (req, res) => {
  const result = await loginWithPassword(req.body as LoginBody);
  writeRefreshCookie(
    res,
    result.refreshToken,
    result.refreshTokenExpiresAt,
    new Date(),
    refreshCookiePolicy,
  );
  res.status(200).json(successResponse('Login successful.', formatAuthSuccess(result)));
});

export const register: RequestHandler = asyncHandler(async (req, res) => {
  const result = await registerUser(req.body as RegisterBody);
  res.status(201).json(
    successResponse('Registration successful. Check your email to verify your account.', {
      userId: result.userId,
    }),
  );
});

export const refresh: RequestHandler = asyncHandler(async (req, res) => {
  const result = await refreshAccessToken(requireRefreshToken(req));
  writeRefreshCookie(
    res,
    result.refreshToken,
    result.refreshTokenExpiresAt,
    new Date(),
    refreshCookiePolicy,
  );
  res.status(200).json(successResponse('Token refreshed.', formatAuthSuccess(result)));
});

export const logout: RequestHandler = asyncHandler(async (req, res) => {
  // Se limpia la cookie aunque la sesion ya no exista: sin ella, un logout
  // repetido dejaria una credencial valida en el navegador sin poder usarla.
  await logoutUser(requireRefreshToken(req)).catch(() => undefined);
  clearRefreshCookie(res);
  res.status(200).json(successResponse('Logout successful.', {}));
});

export const changePasswordHandler: RequestHandler = asyncHandler(async (req, res) => {
  const user = requireAuthenticatedUser(req);
  await changePassword(user.id, req.body as ChangePasswordBody, requireRefreshToken(req));
  res.status(200).json(successResponse('Password updated successfully.', {}));
});

export const verifyEmailHandler: RequestHandler = asyncHandler(async (req, res) => {
  await verifyEmail(req.body as VerifyEmailBody);
  res.status(200).json(successResponse('Email verified successfully.', {}));
});

export const forgotPasswordHandler: RequestHandler = asyncHandler(async (req, res) => {
  await requestPasswordReset(req.body as ForgotPasswordBody);
  res
    .status(200)
    .json(successResponse('If the email is registered, a reset link has been sent.', {}));
});

export const resetPasswordHandler: RequestHandler = asyncHandler(async (req, res) => {
  await resetPassword(req.body as ResetPasswordBody);
  res.status(200).json(successResponse('Password reset successfully.', {}));
});
