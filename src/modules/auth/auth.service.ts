import { randomBytes } from 'node:crypto';

import { APIError } from 'better-auth/api';
import { SignJWT, importJWK } from 'jose';

import { env } from '../../config/env.js';
import { auth } from '../../lib/auth.js';
import { getPrismaClient } from '../../config/prisma.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { ApiError } from '../../utils/ApiError.js';
import { parseTtlToMilliseconds } from '../../utils/ttl.js';
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

const throwBetterAuthError = (error: unknown): never => {
  if (error instanceof ApiError) {
    throw error;
  }
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
  unitId: string | null;
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
  const expiresIn = parseTtlToMilliseconds(env.AUTH_TOKEN_TTL);
  return new SignJWT({
    email: input.email,
    role: input.globalRole,
    unitId: input.unitId,
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
        unitId: true,
        careerId: true,
        isActive: true,
      },
    });
    if (!user) {
      await prisma.session.deleteMany({ where: { token: result.token } });
      throw new ApiError(401, 'Invalid credentials.');
    }
    if (!user.isActive) {
      await prisma.session.deleteMany({ where: { token: result.token } });
      throw new ApiError(401, 'Invalid email or password');
    }
    const accessToken = await signAccessJwt({
      userId: user.id,
      email: user.email,
      globalRole: user.globalRole,
      unitId: user.unitId,
      careerId: user.careerId,
      isActive: user.isActive,
    });
    const refreshExpiresAt = await fetchSessionExpiry(result.token);
    return {
      accessToken,
      accessTokenExpiresAt: new Date(Date.now() + parseTtlToMilliseconds(env.AUTH_TOKEN_TTL)),
      refreshToken: result.token,
      refreshTokenExpiresAt: refreshExpiresAt,
    };
  } catch (error) {
    throwBetterAuthError(error);
    throw new Error('Failed to login.', { cause: error });
  }
};

export const registerUser = async (body: RegisterBody): Promise<{ userId: string }> => {
  const prisma = getPrismaClient();
  const email = body.email.trim().toLowerCase();

  const duplicateEmail = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (duplicateEmail) {
    throw new ApiError(409, 'Email is already registered.');
  }

  const duplicateIdentification = await prisma.user.findUnique({
    where: { identificationNumber: body.identificationNumber },
    select: { id: true },
  });
  if (duplicateIdentification) {
    throw new ApiError(409, 'Identification number is already registered.');
  }

  try {
    const result = await auth.api.signUpEmail({
      body: {
        email,
        password: body.password,
        name: `${body.firstName} ${body.lastName}`,
        firstName: body.firstName,
        lastName: body.lastName,
        identificationNumber: body.identificationNumber,
        unitId: body.unitId,
        careerId: body.careerId,
      },
      headers: betterAuthHeaders(),
      asResponse: false,
    });
    const persisted = await prisma.user.findUnique({
      where: { id: result.user.id },
      select: { id: true },
    });
    if (!persisted) {
      throw new ApiError(409, 'Email is already registered.');
    }
    return { userId: result.user.id };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof APIError && error.statusCode === 422) {
      const raceEmail = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (raceEmail) {
        throw new ApiError(409, 'Email is already registered.');
      }
      const raceIdentification = await prisma.user.findUnique({
        where: { identificationNumber: body.identificationNumber },
        select: { id: true },
      });
      if (raceIdentification) {
        throw new ApiError(409, 'Identification number is already registered.');
      }
      throw new ApiError(422, error.message);
    }
    throwBetterAuthError(error);
    throw new Error('Failed to register user.', { cause: error });
  }
};

export const refreshAccessToken = async (body: RefreshBody): Promise<AuthSuccess> => {
  try {
    const prisma = getPrismaClient();
    const now = new Date();
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
            unitId: true,
            careerId: true,
            isActive: true,
          },
        },
      },
    });
    if (!session) {
      throw new ApiError(401, 'Refresh token is invalid.');
    }
    if (session.expiresAt.getTime() <= now.getTime()) {
      throw new ApiError(401, 'Refresh token has expired.');
    }
    if (!session.user.isActive) {
      await prisma.session.deleteMany({ where: { token: body.refreshToken } });
      throw new ApiError(401, 'Refresh token is invalid.');
    }
    const accessToken = await signAccessJwt({
      userId: session.user.id,
      email: session.user.email,
      globalRole: session.user.globalRole,
      unitId: session.user.unitId,
      careerId: session.user.careerId,
      isActive: session.user.isActive,
    });
    const rotatedToken = randomBytes(32).toString('base64url');
    const rotated = await prisma.session.updateMany({
      where: { token: body.refreshToken, expiresAt: { gt: now } },
      data: { token: rotatedToken },
    });
    if (rotated.count !== 1) {
      throw new ApiError(401, 'Refresh token is invalid.');
    }
    return {
      accessToken,
      accessTokenExpiresAt: new Date(Date.now() + parseTtlToMilliseconds(env.AUTH_TOKEN_TTL)),
      refreshToken: rotatedToken,
      refreshTokenExpiresAt: session.expiresAt,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throwBetterAuthError(error);
    throw new Error('Failed to refresh token.', { cause: error });
  }
};

export const changePassword = async (userId: string, body: ChangePasswordBody): Promise<void> => {
  const prisma = getPrismaClient();

  const account = await prisma.account.findFirst({
    where: { userId, providerId: 'credential' },
    select: { id: true, password: true },
  });

  if (!account?.password || !(await verifyPassword(account.password, body.currentPassword))) {
    throw new ApiError(400, 'Current password is incorrect.');
  }

  const currentSession = await prisma.session.findFirst({
    where: { token: body.refreshToken, userId },
    select: { id: true },
  });

  if (!currentSession) {
    throw new ApiError(400, 'Refresh token is invalid.');
  }

  const newHash = await hashPassword(body.newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.account.update({
      where: { id: account.id },
      data: { password: newHash },
    });
    await tx.session.deleteMany({
      where: { userId, token: { not: body.refreshToken } },
    });
  });
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
    if (error instanceof APIError && (error.statusCode ?? 500) < 500) {
      throw new ApiError(400, 'Email verification token is invalid or expired.');
    }
    throwBetterAuthError(error);
  }
};

export const requestPasswordReset = async (body: ForgotPasswordBody): Promise<void> => {
  try {
    await auth.api.requestPasswordReset({
      body: {
        email: body.email.trim().toLowerCase(),
        redirectTo: env.AUTH_PASSWORD_RESET_URL,
      },
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
    if (error instanceof APIError && (error.statusCode ?? 500) < 500) {
      throw new ApiError(400, 'Password reset token is invalid or expired.');
    }
    throwBetterAuthError(error);
  }
};
