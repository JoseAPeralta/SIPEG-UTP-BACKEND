import type { Request, Response } from 'express';
import {
  createLocalJWKSet,
  generateKeyPair,
  exportJWK,
  calculateJwkThumbprint,
  SignJWT,
  type CryptoKey,
} from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { logger } from '../config/logger.js';
import { ApiError } from '../utils/ApiError.js';

const { loggerWarn } = vi.hoisted(() => ({ loggerWarn: vi.fn() }));

vi.mock('../config/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: loggerWarn },
  createChildLogger: vi.fn(() => ({ error: vi.fn(), info: vi.fn(), warn: loggerWarn })),
}));

interface PrismaMock {
  user: { findUnique: ReturnType<typeof vi.fn> };
}

const createPrismaMock = (): PrismaMock => ({ user: { findUnique: vi.fn() } });

const baseEnv = () => {
  process.env['NODE_ENV'] = 'test';
  process.env['AUTH_SECRET'] = 'a'.repeat(32);
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
  process.env['AUTH_URL'] = 'http://localhost:3000';
};

describe('authenticate middleware', () => {
  let privateKey: CryptoKey;
  let kid: string;
  let jwks: { keys: unknown[] };

  beforeAll(async () => {
    baseEnv();
    const kp = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    privateKey = kp.privateKey;
    const publicJwk = await exportJWK(kp.publicKey);
    kid = await calculateJwkThumbprint(publicJwk);
    jwks = { keys: [{ ...publicJwk, kid, alg: 'EdDSA' }] };
  });

  const loadAuthMiddleware = async (prisma: PrismaMock) => {
    vi.resetModules();
    vi.doMock('../config/prisma.js', () => ({ getPrismaClient: () => prisma }));
    vi.doMock('../utils/jwt-verifier.js', () => ({
      getJwtVerifier: () => ({
        async verify(token: string) {
          const resolver = createLocalJWKSet(jwks as Parameters<typeof createLocalJWKSet>[0]);
          const { payload } = await import('jose').then((j) =>
            j.jwtVerify(token, resolver, {
              issuer: 'http://localhost:3000',
              audience: 'http://localhost:3000',
              algorithms: ['EdDSA'],
            }),
          );
          return payload;
        },
        async refresh() {},
      }),
    }));
    return import('./authenticate.middleware.js');
  };

  const signToken = async (): Promise<string> => {
    return new SignJWT({
      email: 'a@b.com',
      role: 'USER',
      unitId: null,
      careerId: null,
      isActive: true,
    })
      .setProtectedHeader({ alg: 'EdDSA', kid, typ: 'JWT' })
      .setIssuer('http://localhost:3000')
      .setAudience('http://localhost:3000')
      .setSubject('user-1')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey);
  };

  it('rejects requests without an Authorization header', async () => {
    const prisma = createPrismaMock();
    const { authenticate } = await loadAuthMiddleware(prisma);
    const next = vi.fn();
    await authenticate({ headers: {} } as Request, {} as Response, next);
    const error = next.mock.calls[0]?.[0] as ApiError | undefined;
    expect(error?.statusCode).toBe(401);
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('rejects malformed Authorization headers', async () => {
    const prisma = createPrismaMock();
    const { authenticate } = await loadAuthMiddleware(prisma);
    const next = vi.fn();
    await authenticate(
      { headers: { authorization: 'Basic xyz' } } as Request,
      {} as Response,
      next,
    );
    const error = next.mock.calls[0]?.[0] as ApiError | undefined;
    expect(error?.statusCode).toBe(401);
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('rejects inactive users and logs auth.account.disabled with actorPseudonym', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'a@b.com',
      globalRole: 'USER',
      unitId: null,
      careerId: null,
      isActive: false,
    });
    const { authenticate } = await loadAuthMiddleware(prisma);
    const token = await signToken();
    const next = vi.fn();
    await authenticate(
      { headers: { authorization: `Bearer ${token}` } } as Request,
      {} as Response,
      next,
    );
    const error = next.mock.calls[0]?.[0] as ApiError | undefined;
    expect(error?.statusCode).toBe(403);
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'auth.account.disabled', actorPseudonym: expect.any(String) }),
      'auth.account.disabled',
    );
    expect(JSON.stringify(loggerWarn.mock.calls)).not.toContain('a@b.com');
  });

  it('logs auth.token.invalid without the token when JWT verification fails', async () => {
    const prisma = createPrismaMock();
    vi.doMock('../utils/jwt-verifier.js', () => ({
      getJwtVerifier: () => ({
        async verify() {
          throw new Error('jwt expired');
        },
        async refresh() {},
      }),
    }));
    const { authenticate } = await loadAuthMiddleware(prisma);
    const next = vi.fn();
    await authenticate(
      { headers: { authorization: 'Bearer expired-token-value' } } as Request,
      {} as Response,
      next,
    );
    const error = next.mock.calls[0]?.[0] as ApiError | undefined;
    expect(error?.statusCode).toBe(401);
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'auth.token.invalid' }),
      'auth.token.invalid',
    );
    expect(JSON.stringify(loggerWarn.mock.calls)).not.toContain('expired-token-value');
  });

  it('attaches the authenticated user on success', async () => {
    const prisma = createPrismaMock();
    const user = {
      id: 'user-1',
      email: 'a@b.com',
      globalRole: 'USER',
      unitId: null,
      careerId: null,
      isActive: true,
    };
    prisma.user.findUnique.mockResolvedValue(user);
    const { authenticate, requireAuthenticatedUser } = await loadAuthMiddleware(prisma);
    const token = await signToken();
    const req = { headers: { authorization: `Bearer ${token}` } } as Request;
    const next = vi.fn();
    await authenticate(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual(user);
    expect(requireAuthenticatedUser(req).id).toBe('user-1');
  });
});
