import type { RequestHandler } from 'express';

import { requireAuthenticatedUser } from '../../middlewares/authenticate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { successResponse } from '../../utils/response.js';
import type {
  ChangePasswordBody,
  ForgotPasswordBody,
  LoginBody,
  LogoutBody,
  RefreshBody,
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

const formatAuthSuccess = (
  result: Awaited<ReturnType<typeof loginWithPassword>>,
): Record<string, unknown> => ({
  accessToken: result.accessToken,
  accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
  refreshToken: result.refreshToken,
  refreshTokenExpiresAt: result.refreshTokenExpiresAt.toISOString(),
  tokenType: 'Bearer',
});

export const login: RequestHandler = asyncHandler(async (req, res) => {
  const result = await loginWithPassword(req.body as LoginBody);
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
  const result = await refreshAccessToken(req.body as RefreshBody);
  res.status(200).json(successResponse('Token refreshed.', formatAuthSuccess(result)));
});

export const logout: RequestHandler = asyncHandler(async (req, res) => {
  await logoutUser(req.body as LogoutBody);
  res.status(200).json(successResponse('Logout successful.', {}));
});

export const changePasswordHandler: RequestHandler = asyncHandler(async (req, res) => {
  const user = requireAuthenticatedUser(req);
  await changePassword(user.id, req.body as ChangePasswordBody);
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
