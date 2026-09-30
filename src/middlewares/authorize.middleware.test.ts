import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../utils/ApiError.js';

const { loggerWarn, createRequestLoggerSpy } = vi.hoisted(() => {
  const loggerWarn = vi.fn();
  const createRequestLoggerSpy = vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: loggerWarn,
  }));
  return { loggerWarn, createRequestLoggerSpy };
});

vi.mock('../config/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: loggerWarn },
  createChildLogger: vi.fn(() => ({ error: vi.fn(), info: vi.fn(), warn: loggerWarn })),
  createRequestLogger: createRequestLoggerSpy,
}));

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
      unitId: null,
      careerId: null,
      isActive: true,
    });
    const next = vi.fn();
    requireRole('ADMIN')(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('denies USER for ADMIN role gate and logs authorization.denied', async () => {
    const { requireRole } = await loadAuthz();
    const req = buildReq({
      id: 'u1',
      email: 'a@b.com',
      globalRole: 'USER',
      unitId: null,
      careerId: null,
      isActive: true,
    });
    const next = vi.fn();
    requireRole('ADMIN')(req, {} as Response, next);
    const error = next.mock.calls[0]?.[0] as ApiError | undefined;
    expect(error?.statusCode).toBe(403);
    expect(createRequestLoggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'authorization.denied',
        logType: 'security',
        actorPseudonym: expect.any(String),
        requiredRole: 'ADMIN',
        actualRole: 'USER',
      }),
    );
    expect(loggerWarn).toHaveBeenCalledWith('authorization.denied');
    expect(JSON.stringify(createRequestLoggerSpy.mock.calls)).not.toContain('a@b.com');
  });

  it('ownership rejects when ids differ and logs authorization.denied', async () => {
    const { requireOwnership } = await loadAuthz();
    const req = buildReq({
      id: 'u1',
      email: 'a@b.com',
      globalRole: 'USER',
      unitId: null,
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
    expect(createRequestLoggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'authorization.denied',
        logType: 'security',
        actorPseudonym: expect.any(String),
      }),
    );
    expect(loggerWarn).toHaveBeenCalledWith('authorization.denied');
  });

  it('ownership allows when ids match', async () => {
    const { requireOwnership } = await loadAuthz();
    const req = buildReq({
      id: 'u1',
      email: 'a@b.com',
      globalRole: 'USER',
      unitId: null,
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

interface AuthorizationServiceMock {
  getEffectivePermissions: ReturnType<typeof vi.fn>;
}

const loadPermissionMiddleware = async (service: AuthorizationServiceMock) => {
  vi.resetModules();
  vi.doMock('./authenticate.middleware.js', () => ({
    requireAuthenticatedUser: (req: Express.Request) => {
      if (!req.user) throw new ApiError(401, 'Authentication required.');
      return req.user;
    },
  }));
  vi.doMock('../modules/authorization/authorization.service.js', () => service);
  return import('./authorize.middleware.js');
};

describe('requirePermission middleware', () => {
  afterEach(() => {
    vi.doUnmock('./authenticate.middleware.js');
    vi.doUnmock('../modules/authorization/authorization.service.js');
  });

  it('denies when the user lacks the required permission and logs authorization.denied', async () => {
    const service = { getEffectivePermissions: vi.fn().mockResolvedValue(new Set()) };
    const { requirePermission } = await loadPermissionMiddleware(service);
    const req = buildReq({
      id: 'u1',
      email: 'a@b.com',
      globalRole: 'USER',
      unitId: null,
      careerId: null,
      isActive: true,
    });
    const next = vi.fn();

    await requirePermission('activity:update', () => ({ eventProgramId: 'p1' }))(
      req,
      {} as Response,
      next,
    );

    const error = next.mock.calls[0]?.[0] as ApiError | undefined;
    expect(error?.statusCode).toBe(403);
    expect(createRequestLoggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'authorization.denied',
        logType: 'security',
        actorPseudonym: expect.any(String),
        requiredPermission: 'activity:update',
        eventProgramId: 'p1',
      }),
    );
    expect(loggerWarn).toHaveBeenCalledWith('authorization.denied');
    expect(JSON.stringify(createRequestLoggerSpy.mock.calls)).not.toContain('a@b.com');
  });

  it('allows when the resolver finds the permission', async () => {
    const service = {
      getEffectivePermissions: vi.fn().mockResolvedValue(new Set(['activity:update'])),
    };
    const { requirePermission } = await loadPermissionMiddleware(service);
    const req = buildReq({
      id: 'u1',
      email: 'a@b.com',
      globalRole: 'USER',
      unitId: null,
      careerId: null,
      isActive: true,
    });
    const next = vi.fn();

    await requirePermission('activity:update', () => ({ eventProgramId: 'p1' }))(
      req,
      {} as Response,
      next,
    );

    expect(next).toHaveBeenCalledWith();
    expect(service.getEffectivePermissions).toHaveBeenCalledTimes(1);
  });

  it('stores effective permissions in req.authorization', async () => {
    const service = {
      getEffectivePermissions: vi.fn().mockResolvedValue(new Set(['activity:update'])),
    };
    const { requirePermission } = await loadPermissionMiddleware(service);
    const req = buildReq({
      id: 'u1',
      email: 'a@b.com',
      globalRole: 'USER',
      unitId: null,
      careerId: null,
      isActive: true,
    });

    await requirePermission('activity:update', () => ({ eventProgramId: 'p1' }))(
      req,
      {} as Response,
      vi.fn(),
    );

    expect(req.authorization?.permissions.has('activity:update')).toBe(true);
  });

  it('bypasses resolution for ADMIN', async () => {
    const service = { getEffectivePermissions: vi.fn() };
    const { requirePermission } = await loadPermissionMiddleware(service);
    const req = buildReq({
      id: 'u1',
      email: 'a@b.com',
      globalRole: 'ADMIN',
      unitId: null,
      careerId: null,
      isActive: true,
    });
    const next = vi.fn();

    await requirePermission('activity:update', () => ({ eventProgramId: 'p1' }))(
      req,
      {} as Response,
      next,
    );

    expect(next).toHaveBeenCalledWith();
    expect(service.getEffectivePermissions).not.toHaveBeenCalled();
    expect(req.authorization?.permissions.has('activity:update')).toBe(true);
  });

  it('denies when no scope resolver is provided for a non-admin', async () => {
    const service = { getEffectivePermissions: vi.fn() };
    const { requirePermission } = await loadPermissionMiddleware(service);
    const req = buildReq({
      id: 'u1',
      email: 'a@b.com',
      globalRole: 'USER',
      unitId: null,
      careerId: null,
      isActive: true,
    });
    const next = vi.fn();

    await requirePermission('report:view')(req, {} as Response, next);

    const error = next.mock.calls[0]?.[0] as ApiError | undefined;
    expect(error?.statusCode).toBe(403);
    // Sin este log el 403 solo era visible en el access log, sin motivo: el panel
    // de seguridad no podia explicar por que se denego.
    expect(createRequestLoggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'authorization.denied',
        logType: 'security',
        actorPseudonym: expect.any(String),
        requiredPermission: 'report:view',
      }),
    );
    expect(loggerWarn).toHaveBeenCalledWith('authorization.denied');
    // El scope no se pudo resolver, asi que sus ids no se conocen: emitirlos
    // seria inventarlos.
    expect(createRequestLoggerSpy).toHaveBeenCalledWith(
      expect.not.objectContaining({ eventProgramId: expect.anything() }),
    );
    expect(createRequestLoggerSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ activityId: expect.anything() }),
    );
    expect(service.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('requires an authenticated user', async () => {
    const service = { getEffectivePermissions: vi.fn() };
    const { requirePermission } = await loadPermissionMiddleware(service);
    const req = buildReq(undefined);
    const next = vi.fn();

    await requirePermission('activity:update', () => ({ eventProgramId: 'p1' }))(
      req,
      {} as Response,
      next,
    );

    const error = next.mock.calls[0]?.[0] as ApiError | undefined;
    expect(error?.statusCode).toBe(401);
  });
});
