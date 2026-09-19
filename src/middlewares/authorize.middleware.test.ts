import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../utils/ApiError.js';

const buildReq = (user?: Express.AuthenticatedUser) => ({ user }) as unknown as Request;

const loadAuthz = async () => {
  vi.resetModules();
  vi.doMock('./authenticate.middleware.js', () => ({
    requireAuthenticatedUser: (req: Express.Request) => {
      if (!req.user) throw new ApiError(401, 'Authentication required.');
      return req.user;
    },
  }));
  return import('./authorize.middleware.js');
};

describe('authorize middleware', () => {
  it('allows admin for ADMIN role gate', async () => {
    const { requireRole } = await loadAuthz();
    const req = buildReq({
      id: 'u1',
      email: 'a@b.com',
      globalRole: 'ADMIN',
      facultyId: null,
      careerId: null,
      isActive: true,
    });
    const next = vi.fn();
    requireRole('ADMIN')(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('denies USER for ADMIN role gate', async () => {
    const { requireRole } = await loadAuthz();
    const req = buildReq({
      id: 'u1',
      email: 'a@b.com',
      globalRole: 'USER',
      facultyId: null,
      careerId: null,
      isActive: true,
    });
    const next = vi.fn();
    requireRole('ADMIN')(req, {} as Response, next);
    const error = next.mock.calls[0]?.[0] as ApiError | undefined;
    expect(error?.statusCode).toBe(403);
  });

  it('ownership rejects when ids differ', async () => {
    const { requireOwnership } = await loadAuthz();
    const req = buildReq({
      id: 'u1',
      email: 'a@b.com',
      globalRole: 'USER',
      facultyId: null,
      careerId: null,
      isActive: true,
    }) as Request & { params: Record<string, string> };
    req.params = { userId: 'u2' };
    const next = vi.fn();
    requireOwnership((r) => (r as Request & { params: { userId?: string } }).params.userId)(
      req,
      {} as Response,
      next,
    );
    const error = next.mock.calls[0]?.[0] as ApiError | undefined;
    expect(error?.statusCode).toBe(403);
  });

  it('ownership allows when ids match', async () => {
    const { requireOwnership } = await loadAuthz();
    const req = buildReq({
      id: 'u1',
      email: 'a@b.com',
      globalRole: 'USER',
      facultyId: null,
      careerId: null,
      isActive: true,
    }) as Request & { params: Record<string, string> };
    req.params = { userId: 'u1' };
    const next = vi.fn();
    requireOwnership((r) => (r as Request & { params: { userId?: string } }).params.userId)(
      req,
      {} as Response,
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });

  it('requires authenticated user', async () => {
    const { requireRole } = await loadAuthz();
    const req = buildReq(undefined);
    const next = vi.fn();
    requireRole('ADMIN')(req, {} as Response, next);
    const error = next.mock.calls[0]?.[0] as ApiError | undefined;
    expect(error?.statusCode).toBe(401);
  });
});
