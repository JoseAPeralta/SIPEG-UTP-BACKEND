import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';

import { env } from '../config/env.js';
import { ApiError } from './ApiError.js';

export interface AuthenticatedTokenPayload extends JWTPayload {
  sub: string;
  email: string;
  role: string;
  unitId: string | null;
  careerId: string | null;
  isActive: boolean;
}

interface VerifierConfig {
  jwksUrl: string;
  issuer: string;
  audience: string;
}

export interface JwtVerifier {
  verify(token: string): Promise<AuthenticatedTokenPayload>;
  refresh(): Promise<void>;
}

const buildConfig = (): VerifierConfig => ({
  jwksUrl: new URL('/api/auth/jwks', env.AUTH_URL).toString(),
  issuer: env.AUTH_ISSUER ?? env.AUTH_URL,
  audience: env.AUTH_AUDIENCE ?? env.AUTH_URL,
});

const assertPayload = (payload: JWTPayload): AuthenticatedTokenPayload => {
  if (typeof payload.sub !== 'string' || typeof payload['email'] !== 'string') {
    throw new ApiError(401, 'Invalid token payload.');
  }
  return payload as AuthenticatedTokenPayload;
};

export const createJwtVerifier = (overrides?: Partial<VerifierConfig>): JwtVerifier => {
  const config = { ...buildConfig(), ...overrides };
  let resolver: JWTVerifyGetKey = createRemoteJWKSet(new URL(config.jwksUrl), {
    cooldownDuration: 30_000,
    cacheMaxAge: 600_000,
  });

  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, resolver, {
          issuer: config.issuer,
          audience: config.audience,
          algorithms: ['EdDSA'],
        });
        return assertPayload(payload);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(401, 'Invalid or expired token.');
      }
    },
    async refresh() {
      resolver = createRemoteJWKSet(new URL(config.jwksUrl), {
        cooldownDuration: 30_000,
        cacheMaxAge: 600_000,
      });
    },
  };
};

export const createJwtVerifierWithLocalJwks = (
  jwks: unknown,
  overrides?: Partial<VerifierConfig>,
): JwtVerifier => {
  const config = { ...buildConfig(), ...overrides };
  const resolver = createLocalJWKSet(jwks as Parameters<typeof createLocalJWKSet>[0]);

  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, resolver, {
          issuer: config.issuer,
          audience: config.audience,
          algorithms: ['EdDSA'],
        });
        return assertPayload(payload);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(401, 'Invalid or expired token.');
      }
    },
    async refresh() {
      // No-op: la JWKS es local (helper de test).
    },
  };
};

let cachedVerifier: JwtVerifier | null = null;

export const getJwtVerifier = (): JwtVerifier => {
  if (!cachedVerifier) {
    cachedVerifier = createJwtVerifier();
  }
  return cachedVerifier;
};
