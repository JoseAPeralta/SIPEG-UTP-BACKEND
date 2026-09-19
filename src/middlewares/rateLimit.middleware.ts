import type { Request, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';

import { ApiError } from '../utils/ApiError.js';

interface AuthRateLimitOptions {
  windowMs: number;
  max: number;
  message?: string;
}

const keyByUserOrIp = (req: Request): string => {
  if (req.user?.id) return `user:${req.user.id}`;
  return `ip:${req.ip ?? 'unknown'}`;
};

export const authRateLimit = ({ windowMs, max, message }: AuthRateLimitOptions): RequestHandler => {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: keyByUserOrIp,
    handler: (_req, _res, next) => {
      next(new ApiError(429, message ?? 'Too many requests, please try again later.'));
    },
  });
};

export const loginRateLimit = authRateLimit({
  windowMs: 60_000,
  max: 5,
  message: 'Too many login attempts. Try again in one minute.',
});

export const registerRateLimit = authRateLimit({
  windowMs: 60_000,
  max: 3,
  message: 'Too many registration attempts. Try again in one minute.',
});

export const passwordResetRateLimit = authRateLimit({
  windowMs: 60_000,
  max: 3,
  message: 'Too many password reset attempts. Try again in one minute.',
});
