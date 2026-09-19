import type { Request, Response } from 'express';
import { createLocalJWKSet, generateKeyPair, exportJWK, calculateJwkThumbprint, SignJWT, type KeyLike } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../utils/ApiError.js';

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
  let privateKey: KeyLike;
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
      facultyId: null,
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
  });

  it('rejects malformed Authorization headers', async () => {
    const prisma = createPrismaMock();
    const { authenticate } = await loadAuthMiddleware(prisma);
    const next = vi.fn();
    await authenticate({ headers: { authorization: 'Basic xyz' } } as Request, {} as Response, next);
    const error = next.mock.calls[0]?.[0] as ApiError | undefined;
    expect(error?.statusCode).toBe(401);
  });

  it('rejects inactive users', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1', email: 'a@b.com', globalRole: 'USER',
      facultyId: null, careerId: null, isActive: false,
    });
    const { authenticate } = await loadAuthMiddleware(prisma);
    const token = await signToken();
    const next = vi.fn();
    await authenticate({ headers: { authorization: `Bearer ${token}` } } as Request, {} as Response, next);
    const error = next.mock.calls[0]?.[0] as ApiError | undefined;
    expect(error?.statusCode).toBe(403);
  });

  it('attaches the authenticated user on success', async () => {
    const prisma = createPrismaMock();
    const user = {
      id: 'user-1', email: 'a@b.com', globalRole: 'USER',
      facultyId: null, careerId: null, isActive: true,
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
