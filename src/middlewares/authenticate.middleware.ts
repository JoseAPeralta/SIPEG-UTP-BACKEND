import type { RequestHandler } from 'express';

import { getPrismaClient } from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { getJwtVerifier } from '../utils/jwt-verifier.js';

const extractBearerToken = (header: string | undefined): string => {
  if (!header) {
    throw new ApiError(401, 'Authorization header is required.');
  }
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new ApiError(401, 'Authorization header must be a Bearer token.');
  }
  return token;
};

const loadActiveUser = async (userId: string): Promise<Express.AuthenticatedUser> => {
  const prisma = getPrismaClient();
  const user = await prisma.user.findUnique({
    where: { id: userId },
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
    throw new ApiError(401, 'Authenticated user no longer exists.');
  }
  if (!user.isActive) {
    throw new ApiError(403, 'Account is disabled.');
  }

  return {
    id: user.id,
    email: user.email,
    globalRole: user.globalRole,
    facultyId: user.facultyId,
    careerId: user.careerId,
    isActive: user.isActive,
  };
};

export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const token = extractBearerToken(req.headers.authorization);
    const verifier = getJwtVerifier();
    const payload = await verifier.verify(token);
    const user = await loadActiveUser(payload.sub);
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

export const requireAuthenticatedUser = (req: Express.Request): Express.AuthenticatedUser => {
  if (!req.user) {
    throw new ApiError(401, 'Authentication required.');
  }
  return req.user;
};
