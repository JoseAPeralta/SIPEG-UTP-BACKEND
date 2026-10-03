import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../utils/ApiError.js';

interface PrismaMock {
  user: { findUnique: ReturnType<typeof vi.fn> };
}

const createPrismaMock = (): PrismaMock => ({ user: { findUnique: vi.fn() } });

const userRecord = {
  id: 'user-1',
  email: 'a@b.com',
  globalRole: 'USER',
  unitId: null,
  careerId: null,
  isActive: true,
};

const loadMiddleware = async (
  prisma: PrismaMock,
  verify: (token: string) => Promise<{ sub: string }> = async (token) => ({ sub: token }),
) => {
  process.env['NODE_ENV'] = 'test';
  process.env['AUTH_SECRET'] = 'a'.repeat(32);
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
  process.env['AUTH_URL'] = 'http://localhost:3000';
  vi.resetModules();
  vi.doMock('../config/prisma.js', () => ({ getPrismaClient: () => prisma }));
  vi.doMock('../utils/jwt-verifier.js', () => ({
    getJwtVerifier: () => ({ verify, refresh: async () => {} }),
  }));
  return import('./optionalAuthenticate.middleware.js');
};

describe('optionalAuthenticate middleware', () => {
  it('continues anonymously without an Authorization header', async () => {
    const prisma = createPrismaMock();
    const { optionalAuthenticate } = await loadMiddleware(prisma);
    const req = { headers: {} } as Request;
    const next = vi.fn();

    await optionalAuthenticate(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toBeUndefined();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a malformed Authorization header', async () => {
    const prisma = createPrismaMock();
    const { optionalAuthenticate } = await loadMiddleware(prisma);
    const next = vi.fn();

    await optionalAuthenticate(
      { headers: { authorization: 'Basic xyz' } } as Request,
      {} as Response,
      next,
    );

    const error = next.mock.calls[0]?.[0] as ApiError | undefined;
    expect(error?.statusCode).toBe(401);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an invalid or expired token', async () => {
    const prisma = createPrismaMock();
    const { optionalAuthenticate } = await loadMiddleware(prisma, async () => {
      throw new ApiError(401, 'Invalid or expired token.');
    });
    const next = vi.fn();

    await optionalAuthenticate(
      { headers: { authorization: 'Bearer broken' } } as Request,
      {} as Response,
      next,
    );

    const error = next.mock.calls[0]?.[0] as ApiError | undefined;
    expect(error?.statusCode).toBe(401);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects inactive users', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({ ...userRecord, isActive: false });
    const { optionalAuthenticate } = await loadMiddleware(prisma);
    const next = vi.fn();

    await optionalAuthenticate(
      { headers: { authorization: 'Bearer user-1' } } as Request,
      {} as Response,
      next,
    );

    const error = next.mock.calls[0]?.[0] as ApiError | undefined;
    expect(error?.statusCode).toBe(403);
  });

  it('attaches the authenticated user on success', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const { optionalAuthenticate } = await loadMiddleware(prisma);
    const req = { headers: { authorization: 'Bearer user-1' } } as Request;
    const next = vi.fn();

    await optionalAuthenticate(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual(userRecord);
  });
});
