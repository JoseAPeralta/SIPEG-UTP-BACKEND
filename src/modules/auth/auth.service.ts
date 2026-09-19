import { APIError } from 'better-auth/api';

import { env } from '../../config/env.js';
import { auth } from '../../lib/auth.js';
import { ApiError } from '../../utils/ApiError.js';
import type {
  ForgotPasswordBody,
  LoginBody,
  LogoutBody,
  RefreshBody,
  RegisterBody,
  ResetPasswordBody,
  VerifyEmailBody,
} from './auth.schemas.js';

export interface AuthSuccess {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

const betterAuthHeaders = (extra?: Record<string, string>): Record<string, string> => ({
  'content-type': 'application/json',
  origin: env.AUTH_URL,
  ...extra,
});

const parseTtlToMs = (ttl: string): number => {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) return 15 * 60 * 1000;
  const value = Number(match[1]);
  const unit = match[2];
  if (unit === 's') return value * 1000;
  if (unit === 'm') return value * 60 * 1000;
  if (unit === 'h') return value * 60 * 60 * 1000;
  return value * 24 * 60 * 60 * 1000;
};

const throwBetterAuthError = (error: unknown): never => {
  if (error instanceof APIError) {
    throw new ApiError(error.statusCode ?? 400, error.message);
  }
  if (error instanceof Error) {
    throw new ApiError(401, 'Invalid credentials.');
  }
  throw new ApiError(500, 'Authentication error.');
};

const issueAccessToken = async (bearerToken: string): Promise<{ token: string; expiresAt: Date }> => {
  const tokenResponse = await auth.api.getToken({
    headers: betterAuthHeaders({ authorization: `Bearer ${bearerToken}` }),
    asResponse: false,
  });
  return {
    token: tokenResponse.token,
    expiresAt: new Date(Date.now() + parseTtlToMs(env.AUTH_TOKEN_TTL)),
  };
};

const fetchSessionExpiry = async (bearerToken: string): Promise<Date> => {
  const session = await auth.api.getSession({
    headers: betterAuthHeaders({ authorization: `Bearer ${bearerToken}` }),
    asResponse: false,
  });
  if (!session) {
    throw new ApiError(401, 'Session not found.');
  }
  return new Date(session.session.expiresAt);
};

export const loginWithPassword = async (body: LoginBody): Promise<AuthSuccess> => {
  try {
    const result = await auth.api.signInEmail({
      body: { email: body.email, password: body.password },
      headers: betterAuthHeaders(),
      asResponse: false,
    });
    const access = await issueAccessToken(result.token);
    const refreshExpiresAt = await fetchSessionExpiry(result.token);
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: result.token,
      refreshTokenExpiresAt: refreshExpiresAt,
    };
  } catch (error) {
    throwBetterAuthError(error);
    throw new Error('unreachable');
  }
};

export const registerUser = async (body: RegisterBody): Promise<{ userId: string }> => {
  try {
    const result = await auth.api.signUpEmail({
      body: {
        email: body.email,
        password: body.password,
        name: `${body.firstName} ${body.lastName}`,
        firstName: body.firstName,
        lastName: body.lastName,
        identificationNumber: body.identificationNumber,
        facultyId: body.facultyId,
        careerId: body.careerId,
      },
      headers: betterAuthHeaders(),
      asResponse: false,
    });
    return { userId: result.user.id };
  } catch (error) {
    throwBetterAuthError(error);
    throw new Error('unreachable');
  }
};

export const refreshAccessToken = async (body: RefreshBody): Promise<AuthSuccess> => {
  try {
    const access = await issueAccessToken(body.refreshToken);
    const refreshExpiresAt = await fetchSessionExpiry(body.refreshToken);
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: body.refreshToken,
      refreshTokenExpiresAt: refreshExpiresAt,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throwBetterAuthError(error);
    throw new Error('unreachable');
  }
};

export const logoutUser = async (_body: LogoutBody): Promise<void> => {
  try {
    await auth.api.signOut({
      headers: betterAuthHeaders({ authorization: `Bearer ${_body.refreshToken}` }),
      asResponse: false,
    });
  } catch (error) {
    throwBetterAuthError(error);
  }
};

export const verifyEmail = async (body: VerifyEmailBody): Promise<void> => {
  try {
    await auth.api.verifyEmail({
      query: { token: body.token },
      headers: betterAuthHeaders(),
      asResponse: false,
    });
  } catch (error) {
    throwBetterAuthError(error);
  }
};

export const requestPasswordReset = async (body: ForgotPasswordBody): Promise<void> => {
  try {
    await auth.api.requestPasswordReset({
      body: { email: body.email, redirectTo: `${env.AUTH_URL}/reset-password` },
      headers: betterAuthHeaders(),
      asResponse: false,
    });
  } catch (error) {
    throwBetterAuthError(error);
  }
};

export const resetPassword = async (body: ResetPasswordBody): Promise<void> => {
  try {
    await auth.api.resetPassword({
      body: { token: body.token, newPassword: body.newPassword },
      headers: betterAuthHeaders(),
      asResponse: false,
    });
  } catch (error) {
    throwBetterAuthError(error);
  }
};
