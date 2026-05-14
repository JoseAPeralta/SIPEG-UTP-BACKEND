import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';

import { env } from '../config/env.js';
import { ApiError } from './ApiError.js';

const jwtIssuer = 'sipeg-utp-backend';
const jwtAudience = 'sipeg-utp-api';

interface AccessTokenPayload {
  userId: string;
  correo: string;
}

export const signAccessToken = ({ userId, correo }: AccessTokenPayload): string => {
  if (!env.JWT_ACCESS_SECRET) {
    throw new ApiError(500, 'Authentication is not configured.');
  }

  const options: SignOptions = {
    algorithm: 'HS256',
    audience: jwtAudience,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as NonNullable<SignOptions['expiresIn']>,
    issuer: jwtIssuer,
    subject: userId,
  };

  return jwt.sign({ correo }, env.JWT_ACCESS_SECRET, options);
};
