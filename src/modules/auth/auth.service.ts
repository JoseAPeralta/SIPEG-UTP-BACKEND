import { APIError } from 'better-auth/api';
import { SignJWT, importJWK } from 'jose';

import { env } from '../../config/env.js';
import { auth } from '../../lib/auth.js';
import { getPrismaClient } from '../../config/prisma.js';
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

interface SignAccessTokenInput {
  userId: string;
  email: string;
  globalRole: string;
  facultyId: string | null;
  careerId: string | null;
  isActive: boolean;
}

const loadSigningKey = async () => {
  const prisma = getPrismaClient();
  const rows = await prisma.jwks.findMany();
  if (rows.length === 0) {
    throw new ApiError(500, 'No JWKS available for signing.');
  }
  const latest = rows[rows.length - 1];
  if (!latest) {
    throw new ApiError(500, 'No JWKS available for signing.');
  }
  const privateJwk = JSON.parse(latest.privateKey) as Record<string, unknown>;
  return importJWK({ ...privateJwk, alg: 'EdDSA' } as Parameters<typeof importJWK>[0], 'EdDSA');
};

const signAccessJwt = async (input: SignAccessTokenInput): Promise<string> => {
  const key = await loadSigningKey();
  const expiresIn = parseTtlToMs(env.AUTH_TOKEN_TTL);
  return new SignJWT({
    email: input.email,
    role: input.globalRole,
    facultyId: input.facultyId,
    careerId: input.careerId,
    isActive: input.isActive,
  })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
    .setIssuer(env.AUTH_ISSUER ?? env.AUTH_URL)
    .setAudience(env.AUTH_AUDIENCE ?? env.AUTH_URL)
    .setSubject(input.userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + Math.floor(expiresIn / 1000))
    .sign(key);
};

const fetchSessionExpiry = async (bearerToken: string): Promise<Date> => {
  const prisma = getPrismaClient();
  const session = await prisma.session.findFirst({
    where: { token: bearerToken },
    select: { expiresAt: true },
  });
  if (!session) {
    throw new ApiError(401, 'Session not found.');
  }
  return session.expiresAt;
};

export const loginWithPassword = async (body: LoginBody): Promise<AuthSuccess> => {
  try {
    const result = await auth.api.signInEmail({
      body: { email: body.email, password: body.password },
      headers: betterAuthHeaders(),
      asResponse: false,
    });
    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({
      where: { id: result.user.id },
      select: {
        id: true,
        email: true,
        globalRole: true,
        facultyId: true,
        careerId: true,
        isActive: true,
      },
    });
    if (!user) {
      throw new ApiError(401, 'User not found.');
    }
    const accessToken = await signAccessJwt({
      userId: user.id,
      email: user.email,
      globalRole: user.globalRole,
      facultyId: user.facultyId,
      careerId: user.careerId,
      isActive: user.isActive,
    });
    const refreshExpiresAt = await fetchSessionExpiry(result.token);
    return {
      accessToken,
      accessTokenExpiresAt: new Date(Date.now() + parseTtlToMs(env.AUTH_TOKEN_TTL)),
      refreshToken: result.token,
      refreshTokenExpiresAt: refreshExpiresAt,
    };
  } catch (error) {
    throwBetterAuthError(error);
    throw new Error('Failed to login.', { cause: error });
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
    throw new Error('Failed to register user.', { cause: error });
  }
};

export const refreshAccessToken = async (body: RefreshBody): Promise<AuthSuccess> => {
  try {
    const prisma = getPrismaClient();
    const session = await prisma.session.findFirst({
      where: { token: body.refreshToken },
      select: {
        expiresAt: true,
        userId: true,
        user: {
          select: {
            id: true,
            email: true,
            globalRole: true,
            facultyId: true,
            careerId: true,
            isActive: true,
          },
        },
      },
    });
    if (!session) {
      throw new ApiError(401, 'Refresh token is invalid.');
    }
    const accessToken = await signAccessJwt({
      userId: session.user.id,
      email: session.user.email,
      globalRole: session.user.globalRole,
      facultyId: session.user.facultyId,
      careerId: session.user.careerId,
      isActive: session.user.isActive,
    });
    return {
      accessToken,
      accessTokenExpiresAt: new Date(Date.now() + parseTtlToMs(env.AUTH_TOKEN_TTL)),
      refreshToken: body.refreshToken,
      refreshTokenExpiresAt: session.expiresAt,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throwBetterAuthError(error);
    throw new Error('Failed to refresh token.', { cause: error });
  }
};

export const logoutUser = async (_body: LogoutBody): Promise<void> => {
  try {
    const prisma = getPrismaClient();
    await prisma.session.deleteMany({
      where: { token: _body.refreshToken },
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
