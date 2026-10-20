import { env } from './env.js';

export const resolveJwksUrl = (): string =>
  env.AUTH_JWKS_URL ?? new URL('/api/auth/jwks', env.AUTH_URL).toString();
