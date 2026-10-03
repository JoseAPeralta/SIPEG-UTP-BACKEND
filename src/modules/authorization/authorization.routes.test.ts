import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ROLE_DEFAULTS } from './permissions.js';

interface DelegationServiceMock {
  addCollaborator: ReturnType<typeof vi.fn>;
  grantPermission: ReturnType<typeof vi.fn>;
  listCollaborators: ReturnType<typeof vi.fn>;
  removeCollaborator: ReturnType<typeof vi.fn>;
  revokePermission: ReturnType<typeof vi.fn>;
  updateCollaboratorRole: ReturnType<typeof vi.fn>;
}

const buildServiceMock = (): DelegationServiceMock => ({
  addCollaborator: vi.fn(),
  grantPermission: vi.fn(),
  listCollaborators: vi.fn(),
  removeCollaborator: vi.fn(),
  revokePermission: vi.fn(),
  updateCollaboratorRole: vi.fn(),
});

const auditContext = (actorId: string) =>
  expect.objectContaining({
    actorId,
    actorType: 'USER',
    requestId: expect.any(String) as unknown as string,
  });

interface PrismaMock {
  user: { findUnique: ReturnType<typeof vi.fn> };
  collaboration: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findUniqueOrThrow: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  collaborationPermission: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
  };
  activity: { findUnique: ReturnType<typeof vi.fn> };
  eventProgram: { findUnique: ReturnType<typeof vi.fn> };
  permission: { findMany: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  auditEvent: { create: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
}

const createPrismaMock = (): PrismaMock => {
  const prisma: PrismaMock = {
    user: { findUnique: vi.fn() },
    collaboration: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    collaborationPermission: {
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
      upsert: vi.fn(),
      createMany: vi.fn(),
    },
    activity: { findUnique: vi.fn() },
    eventProgram: { findUnique: vi.fn() },
    permission: { findMany: vi.fn(), findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  };

  prisma.$transaction.mockImplementation(
    async (callback: (client: PrismaMock) => Promise<unknown>) => callback(prisma),
  );

  return prisma;
};

const adminRecord = {
  id: 'admin-001',
  email: 'admin@example.com',
  globalRole: 'ADMIN',
  unitId: null,
  careerId: null,
  isActive: true,
};

const userRecord = { ...adminRecord, id: 'user-001', globalRole: 'USER' };

const collaboratorDetail = {
  userId: 'user-002',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  role: 'VIEWER',
  createdAt: '2026-09-19T12:00:00.000Z',
  permissions: [
    {
      name: 'activity:read',
      source: 'ROLE_DEFAULT',
      validFrom: null,
      validUntil: null,
    },
  ],
};

const addBody = { userId: 'user-002', role: 'VIEWER' };

const loadApp = async (
  service: DelegationServiceMock,
  prisma = createPrismaMock(),
  permissions: string[] = [],
  getEffectivePermissions = vi.fn(),
  listOwnPermissions = vi.fn(),
) => {
  getEffectivePermissions.mockResolvedValue(new Set(permissions));
  process.env['NODE_ENV'] = 'test';
  process.env['AUTH_SECRET'] = 'a'.repeat(32);
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
  process.env['AUTH_URL'] = 'http://localhost:3000';
  vi.resetModules();
  vi.doMock('./delegation.service.js', () => service);
  vi.doMock('../../config/prisma.js', () => ({ getPrismaClient: () => prisma }));
  vi.doMock('../../utils/jwt-verifier.js', () => ({
    getJwtVerifier: () => ({
      verify: async (token: string) => ({ sub: token }),
      refresh: async () => {},
    }),
  }));
  vi.doMock('../../lib/auth.js', () => ({
    auth: {
      api: {
        signInEmail: vi.fn(),
        signUpEmail: vi.fn(),
        getToken: vi.fn(),
        getSession: vi.fn(),
        signOut: vi.fn(),
        verifyEmail: vi.fn(),
        requestPasswordReset: vi.fn(),
        resetPassword: vi.fn(),
      },
    },
  }));
  vi.doMock('./authorization.service.js', () => ({ getEffectivePermissions, listOwnPermissions }));

  const { app } = await import('../../app.js');
  return app;
};

const loadAppWithRealAuthorization = async (
  service: DelegationServiceMock,
  prisma = createPrismaMock(),
) => {
  process.env['NODE_ENV'] = 'test';
  process.env['AUTH_SECRET'] = 'a'.repeat(32);
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
  process.env['AUTH_URL'] = 'http://localhost:3000';
  vi.resetModules();
  vi.doMock('./delegation.service.js', () => service);
  vi.doMock('../../config/prisma.js', () => ({ getPrismaClient: () => prisma }));
  vi.doMock('../../utils/jwt-verifier.js', () => ({
    getJwtVerifier: () => ({
      verify: async (token: string) => ({ sub: token }),
      refresh: async () => {},
    }),
  }));
  vi.doMock('../../lib/auth.js', () => ({
    auth: {
      api: {
        signInEmail: vi.fn(),
        signUpEmail: vi.fn(),
        getToken: vi.fn(),
        getSession: vi.fn(),
        signOut: vi.fn(),
        verifyEmail: vi.fn(),
        requestPasswordReset: vi.fn(),
        resetPassword: vi.fn(),
      },
    },
  }));

  const { app } = await import('../../app.js');
  return app;
};

const loadAppWithRealDelegation = async (prisma = createPrismaMock()) => {
  process.env['NODE_ENV'] = 'test';
  process.env['AUTH_SECRET'] = 'a'.repeat(32);
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
  process.env['AUTH_URL'] = 'http://localhost:3000';
  vi.resetModules();
  vi.doMock('../../config/prisma.js', () => ({ getPrismaClient: () => prisma }));
  vi.doMock('../../utils/jwt-verifier.js', () => ({
    getJwtVerifier: () => ({
      verify: async (token: string) => ({ sub: token }),
      refresh: async () => {},
    }),
  }));
  vi.doMock('../../lib/auth.js', () => ({
    auth: {
      api: {
        signInEmail: vi.fn(),
        signUpEmail: vi.fn(),
        getToken: vi.fn(),
        getSession: vi.fn(),
        signOut: vi.fn(),
        verifyEmail: vi.fn(),
        requestPasswordReset: vi.fn(),
        resetPassword: vi.fn(),
      },
    },
  }));

  const { app } = await import('../../app.js');
  return app;
};

describe('collaborator routes', () => {
  afterEach(() => {
    vi.doUnmock('./delegation.service.js');
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../../utils/jwt-verifier.js');
    vi.doUnmock('../../lib/auth.js');
    vi.doUnmock('./authorization.service.js');
  });

  it('rejects listing collaborators without a token', async () => {
    const service = buildServiceMock();
    const app = await loadApp(service);

    await request(app).get('/api/v1/event-programs/program-001/collaborators').expect(401);
    expect(service.listCollaborators).not.toHaveBeenCalled();
  });

  it('rejects listing collaborators without permission:grant in the scope', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const app = await loadApp(service, prisma, ['activity:read']);

    await request(app)
      .get('/api/v1/event-programs/program-001/collaborators')
      .set('Authorization', 'Bearer user-001')
      .expect(403);
    expect(service.listCollaborators).not.toHaveBeenCalled();
  });

  it('lists event program collaborators for a permission:grant holder', async () => {
    const service = buildServiceMock();
    service.listCollaborators.mockResolvedValue({ items: [collaboratorDetail] });
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const getEffectivePermissions = vi.fn();
    const app = await loadApp(service, prisma, ['permission:grant'], getEffectivePermissions);

    const response = await request(app)
      .get('/api/v1/event-programs/program-001/collaborators')
      .set('Authorization', 'Bearer user-001')
      .expect(200);

    expect(getEffectivePermissions).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-001' }),
      { eventProgramId: 'program-001' },
    );
    expect(service.listCollaborators).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-001' }),
      { eventProgramId: 'program-001' },
    );
    expect(response.body).toEqual({
      success: true,
      message: 'Collaborators retrieved successfully.',
      data: { items: [collaboratorDetail] },
    });
  });

  it('resolves the activity scope when listing activity collaborators', async () => {
    const service = buildServiceMock();
    service.listCollaborators.mockResolvedValue({ items: [] });
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const getEffectivePermissions = vi.fn();
    const app = await loadApp(service, prisma, ['permission:grant'], getEffectivePermissions);

    await request(app)
      .get('/api/v1/activities/activity-001/collaborators')
      .set('Authorization', 'Bearer user-001')
      .expect(200);

    expect(getEffectivePermissions).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-001' }),
      {
        activityId: 'activity-001',
      },
    );
  });

  it('propagates a missing scope as 404', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);
    const { ApiError } = await import('../../utils/ApiError.js');
    service.listCollaborators.mockRejectedValue(new ApiError(404, 'Event program not found.'));

    await request(app)
      .get('/api/v1/event-programs/missing/collaborators')
      .set('Authorization', 'Bearer admin-001')
      .expect(404);
  });

  it('adds a collaborator as ADMIN', async () => {
    const service = buildServiceMock();
    service.addCollaborator.mockResolvedValue(collaboratorDetail);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    const response = await request(app)
      .post('/api/v1/event-programs/program-001/collaborators')
      .set('Authorization', 'Bearer admin-001')
      .send(addBody)
      .expect(201);

    expect(service.addCollaborator).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin-001' }),
      { eventProgramId: 'program-001' },
      'user-002',
      'VIEWER',
      undefined,
      auditContext('admin-001'),
    );
    expect(response.body).toEqual({
      success: true,
      message: 'Collaborator added successfully.',
      data: collaboratorDetail,
    });
  });

  it('adds an activity collaborator with the activity scope', async () => {
    const service = buildServiceMock();
    service.addCollaborator.mockResolvedValue(collaboratorDetail);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .post('/api/v1/activities/activity-001/collaborators')
      .set('Authorization', 'Bearer admin-001')
      .send(addBody)
      .expect(201);

    expect(service.addCollaborator).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin-001' }),
      { activityId: 'activity-001' },
      'user-002',
      'VIEWER',
      undefined,
      auditContext('admin-001'),
    );
  });

  it('rejects adding a collaborator without a token', async () => {
    const service = buildServiceMock();
    const app = await loadApp(service);

    await request(app)
      .post('/api/v1/event-programs/program-001/collaborators')
      .send(addBody)
      .expect(401);
    expect(service.addCollaborator).not.toHaveBeenCalled();
  });

  it('rejects a non-admin without permission:grant', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const app = await loadApp(service, prisma, ['activity:read']);

    await request(app)
      .post('/api/v1/event-programs/program-001/collaborators')
      .set('Authorization', 'Bearer user-001')
      .send(addBody)
      .expect(403);
    expect(service.addCollaborator).not.toHaveBeenCalled();
  });

  it('rejects an invalid role before the service', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .post('/api/v1/event-programs/program-001/collaborators')
      .set('Authorization', 'Bearer admin-001')
      .send({ userId: 'user-002', role: 'OWNER' })
      .expect(400);
    expect(service.addCollaborator).not.toHaveBeenCalled();
  });

  it('rejects unknown body keys before the service', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .post('/api/v1/event-programs/program-001/collaborators')
      .set('Authorization', 'Bearer admin-001')
      .send({ ...addBody, validUntil: '2026-12-31T00:00:00.000Z' })
      .expect(400);
    expect(service.addCollaborator).not.toHaveBeenCalled();
  });

  it('propagates a conflicting collaborator as 409', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);
    const { ApiError } = await import('../../utils/ApiError.js');
    service.addCollaborator.mockRejectedValue(
      new ApiError(409, 'User already collaborates in this scope.'),
    );

    await request(app)
      .post('/api/v1/event-programs/program-001/collaborators')
      .set('Authorization', 'Bearer admin-001')
      .send(addBody)
      .expect(409);
  });

  it('propagates the role subset rejection as 403', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);
    const { ApiError } = await import('../../utils/ApiError.js');
    service.addCollaborator.mockRejectedValue(
      new ApiError(403, 'Cannot assign a role that exceeds your own permissions.'),
    );

    await request(app)
      .post('/api/v1/activities/activity-001/collaborators')
      .set('Authorization', 'Bearer admin-001')
      .send({ userId: 'user-002', role: 'ORGANIZER' })
      .expect(403);
  });

  const updateBody = { role: 'EDITOR' };
  const updatedCollaborator = { ...collaboratorDetail, role: 'EDITOR' };

  it('updates a program collaborator role for a permission:grant holder', async () => {
    const service = buildServiceMock();
    service.updateCollaboratorRole.mockResolvedValue(updatedCollaborator);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const getEffectivePermissions = vi.fn();
    const app = await loadApp(service, prisma, ['permission:grant'], getEffectivePermissions);

    const response = await request(app)
      .patch('/api/v1/event-programs/program-001/collaborators/user-002')
      .set('Authorization', 'Bearer user-001')
      .send(updateBody)
      .expect(200);

    expect(getEffectivePermissions).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-001' }),
      { eventProgramId: 'program-001' },
    );
    expect(service.updateCollaboratorRole).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-001' }),
      { eventProgramId: 'program-001' },
      'user-002',
      'EDITOR',
      undefined,
      auditContext('user-001'),
    );
    expect(response.body).toEqual({
      success: true,
      message: 'Collaborator role updated successfully.',
      data: updatedCollaborator,
    });
  });

  it('resolves the activity scope when updating an activity collaborator role', async () => {
    const service = buildServiceMock();
    service.updateCollaboratorRole.mockResolvedValue(updatedCollaborator);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .patch('/api/v1/activities/activity-001/collaborators/user-002')
      .set('Authorization', 'Bearer admin-001')
      .send(updateBody)
      .expect(200);

    expect(service.updateCollaboratorRole).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin-001' }),
      { activityId: 'activity-001' },
      'user-002',
      'EDITOR',
      undefined,
      auditContext('admin-001'),
    );
  });

  it('rejects updating a role without a token', async () => {
    const service = buildServiceMock();
    const app = await loadApp(service);

    await request(app)
      .patch('/api/v1/event-programs/program-001/collaborators/user-002')
      .send(updateBody)
      .expect(401);
    expect(service.updateCollaboratorRole).not.toHaveBeenCalled();
  });

  it('rejects updating a role without permission:grant', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const app = await loadApp(service, prisma, ['activity:read']);

    await request(app)
      .patch('/api/v1/event-programs/program-001/collaborators/user-002')
      .set('Authorization', 'Bearer user-001')
      .send(updateBody)
      .expect(403);
    expect(service.updateCollaboratorRole).not.toHaveBeenCalled();
  });

  it('rejects an invalid role before the service on update', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .patch('/api/v1/event-programs/program-001/collaborators/user-002')
      .set('Authorization', 'Bearer admin-001')
      .send({ role: 'OWNER' })
      .expect(400);
    expect(service.updateCollaboratorRole).not.toHaveBeenCalled();
  });

  it('rejects unknown body keys before the service on update', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .patch('/api/v1/event-programs/program-001/collaborators/user-002')
      .set('Authorization', 'Bearer admin-001')
      .send({ ...updateBody, source: 'OVERRIDE' })
      .expect(400);
    expect(service.updateCollaboratorRole).not.toHaveBeenCalled();
  });

  it('propagates a missing collaborator as 404 on update', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);
    const { ApiError } = await import('../../utils/ApiError.js');
    service.updateCollaboratorRole.mockRejectedValue(new ApiError(404, 'Collaborator not found.'));

    await request(app)
      .patch('/api/v1/event-programs/program-001/collaborators/user-002')
      .set('Authorization', 'Bearer admin-001')
      .send(updateBody)
      .expect(404);
  });

  it('propagates an archived program as 409 on update', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);
    const { ApiError } = await import('../../utils/ApiError.js');
    service.updateCollaboratorRole.mockRejectedValue(
      new ApiError(409, 'Archived event programs cannot be modified.'),
    );

    await request(app)
      .patch('/api/v1/event-programs/program-001/collaborators/user-002')
      .set('Authorization', 'Bearer admin-001')
      .send(updateBody)
      .expect(409);
  });

  it('propagates the role subset rejection as 403 on update', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const app = await loadApp(service, prisma, ['permission:grant']);
    const { ApiError } = await import('../../utils/ApiError.js');
    service.updateCollaboratorRole.mockRejectedValue(
      new ApiError(403, 'Cannot remove a collaborator with permissions you do not hold.'),
    );

    await request(app)
      .patch('/api/v1/activities/activity-001/collaborators/user-002')
      .set('Authorization', 'Bearer user-001')
      .send({ role: 'VIEWER' })
      .expect(403);
  });

  it('deletes a program collaborator with 204', async () => {
    const service = buildServiceMock();
    service.removeCollaborator.mockResolvedValue(undefined);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const getEffectivePermissions = vi.fn();
    const app = await loadApp(service, prisma, ['permission:grant'], getEffectivePermissions);

    await request(app)
      .delete('/api/v1/event-programs/program-001/collaborators/user-002')
      .set('Authorization', 'Bearer user-001')
      .expect(204);

    expect(getEffectivePermissions).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-001' }),
      { eventProgramId: 'program-001' },
    );
    expect(service.removeCollaborator).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-001' }),
      { eventProgramId: 'program-001' },
      'user-002',
      undefined,
      auditContext('user-001'),
    );
  });

  it('resolves the activity scope when deleting an activity collaborator', async () => {
    const service = buildServiceMock();
    service.removeCollaborator.mockResolvedValue(undefined);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .delete('/api/v1/activities/activity-001/collaborators/user-002')
      .set('Authorization', 'Bearer admin-001')
      .expect(204);

    expect(service.removeCollaborator).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin-001' }),
      { activityId: 'activity-001' },
      'user-002',
      undefined,
      auditContext('admin-001'),
    );
  });

  it('rejects deleting a collaborator without a token', async () => {
    const service = buildServiceMock();
    const app = await loadApp(service);

    await request(app)
      .delete('/api/v1/event-programs/program-001/collaborators/user-002')
      .expect(401);
    expect(service.removeCollaborator).not.toHaveBeenCalled();
  });

  it('rejects deleting a collaborator without permission:grant', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const app = await loadApp(service, prisma, ['activity:read']);

    await request(app)
      .delete('/api/v1/event-programs/program-001/collaborators/user-002')
      .set('Authorization', 'Bearer user-001')
      .expect(403);
    expect(service.removeCollaborator).not.toHaveBeenCalled();
  });

  it('rejects a blank user identifier before the service on delete', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .delete('/api/v1/event-programs/program-001/collaborators/%20%20')
      .set('Authorization', 'Bearer admin-001')
      .expect(400);
    expect(service.removeCollaborator).not.toHaveBeenCalled();
  });

  it('propagates a missing collaborator as 404 on delete', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);
    const { ApiError } = await import('../../utils/ApiError.js');
    service.removeCollaborator.mockRejectedValue(new ApiError(404, 'Collaborator not found.'));

    await request(app)
      .delete('/api/v1/event-programs/program-001/collaborators/user-002')
      .set('Authorization', 'Bearer admin-001')
      .expect(404);
  });

  it('propagates the last delegator rejection as 409 on delete', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);
    const { ApiError } = await import('../../utils/ApiError.js');
    service.removeCollaborator.mockRejectedValue(
      new ApiError(409, 'Cannot remove the last collaborator able to delegate in this scope.'),
    );

    await request(app)
      .delete('/api/v1/activities/activity-001/collaborators/user-002')
      .set('Authorization', 'Bearer admin-001')
      .expect(409);
  });

  const grantBody = {
    userId: 'user-002',
    permission: 'report:export',
    validFrom: '2026-09-20T00:00:00.000Z',
    validUntil: '2026-10-20T00:00:00.000Z',
  };

  it('rejects granting a permission without a token', async () => {
    const service = buildServiceMock();
    const app = await loadApp(service);

    await request(app)
      .post('/api/v1/event-programs/program-001/permissions')
      .send(grantBody)
      .expect(401);
    expect(service.grantPermission).not.toHaveBeenCalled();
  });

  it('rejects granting a permission without permission:grant in the scope', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const app = await loadApp(service, prisma, ['activity:read']);

    await request(app)
      .post('/api/v1/event-programs/program-001/permissions')
      .set('Authorization', 'Bearer user-001')
      .send(grantBody)
      .expect(403);
    expect(service.grantPermission).not.toHaveBeenCalled();
  });

  it('grants a permission in an event program for a permission:grant holder', async () => {
    const service = buildServiceMock();
    service.grantPermission.mockResolvedValue(collaboratorDetail);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const getEffectivePermissions = vi.fn();
    const app = await loadApp(service, prisma, ['permission:grant'], getEffectivePermissions);

    const response = await request(app)
      .post('/api/v1/event-programs/program-001/permissions')
      .set('Authorization', 'Bearer user-001')
      .send(grantBody)
      .expect(200);

    expect(getEffectivePermissions).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-001' }),
      { eventProgramId: 'program-001' },
    );
    expect(service.grantPermission).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-001' }),
      { eventProgramId: 'program-001' },
      'user-002',
      'report:export',
      {
        validFrom: new Date('2026-09-20T00:00:00.000Z'),
        validUntil: new Date('2026-10-20T00:00:00.000Z'),
      },
      undefined,
      auditContext('user-001'),
    );
    expect(response.body).toEqual({
      success: true,
      message: 'Permission granted successfully.',
      data: collaboratorDetail,
    });
  });

  it('resolves the activity scope and defaults omitted windows to null', async () => {
    const service = buildServiceMock();
    service.grantPermission.mockResolvedValue(collaboratorDetail);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .post('/api/v1/activities/activity-001/permissions')
      .set('Authorization', 'Bearer admin-001')
      .send({ userId: 'user-002', permission: 'activity:update' })
      .expect(200);

    expect(service.grantPermission).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin-001' }),
      { activityId: 'activity-001' },
      'user-002',
      'activity:update',
      { validFrom: null, validUntil: null },
      undefined,
      auditContext('admin-001'),
    );
  });

  it('rejects an unknown permission before the service', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .post('/api/v1/event-programs/program-001/permissions')
      .set('Authorization', 'Bearer admin-001')
      .send({ ...grantBody, permission: 'nope:nope' })
      .expect(400);
    expect(service.grantPermission).not.toHaveBeenCalled();
  });

  it('rejects a malformed window before the service', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .post('/api/v1/event-programs/program-001/permissions')
      .set('Authorization', 'Bearer admin-001')
      .send({ ...grantBody, validUntil: 'tomorrow' })
      .expect(400);
    expect(service.grantPermission).not.toHaveBeenCalled();
  });

  it('propagates an archived event program as 409 on grant', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);
    const { ApiError } = await import('../../utils/ApiError.js');
    service.grantPermission.mockRejectedValue(
      new ApiError(409, 'Archived event programs cannot be modified.'),
    );

    await request(app)
      .post('/api/v1/event-programs/program-001/permissions')
      .set('Authorization', 'Bearer admin-001')
      .send(grantBody)
      .expect(409);
  });

  it('propagates a missing collaborator as 404 on grant', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);
    const { ApiError } = await import('../../utils/ApiError.js');
    service.grantPermission.mockRejectedValue(new ApiError(404, 'Collaborator not found.'));

    await request(app)
      .post('/api/v1/activities/activity-001/permissions')
      .set('Authorization', 'Bearer admin-001')
      .send(grantBody)
      .expect(404);
  });

  const revokeUrl = '/api/v1/event-programs/program-001/permissions/report:export?userId=user-002';

  it('rejects revoking a permission without a token', async () => {
    const service = buildServiceMock();
    const app = await loadApp(service);

    await request(app).delete(revokeUrl).expect(401);
    expect(service.revokePermission).not.toHaveBeenCalled();
  });

  it('rejects revoking a permission without permission:grant in the scope', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const app = await loadApp(service, prisma, ['activity:read']);

    await request(app).delete(revokeUrl).set('Authorization', 'Bearer user-001').expect(403);
    expect(service.revokePermission).not.toHaveBeenCalled();
  });

  it('revokes a permission in an event program for a permission:grant holder', async () => {
    const service = buildServiceMock();
    service.revokePermission.mockResolvedValue(undefined);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const getEffectivePermissions = vi.fn();
    const app = await loadApp(service, prisma, ['permission:grant'], getEffectivePermissions);

    const response = await request(app)
      .delete(revokeUrl)
      .set('Authorization', 'Bearer user-001')
      .expect(204);

    expect(getEffectivePermissions).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-001' }),
      { eventProgramId: 'program-001' },
    );
    expect(service.revokePermission).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-001' }),
      { eventProgramId: 'program-001' },
      'user-002',
      'report:export',
      undefined,
      auditContext('user-001'),
    );
    expect(response.text).toBe('');
  });

  it('resolves the activity scope when revoking an activity permission', async () => {
    const service = buildServiceMock();
    service.revokePermission.mockResolvedValue(undefined);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .delete('/api/v1/activities/activity-001/permissions/activity:read?userId=user-002')
      .set('Authorization', 'Bearer admin-001')
      .expect(204);

    expect(service.revokePermission).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin-001' }),
      { activityId: 'activity-001' },
      'user-002',
      'activity:read',
      undefined,
      auditContext('admin-001'),
    );
  });

  it('rejects an unknown revoke permission before the service', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .delete('/api/v1/event-programs/program-001/permissions/nope:nope?userId=user-002')
      .set('Authorization', 'Bearer admin-001')
      .expect(400);
    expect(service.revokePermission).not.toHaveBeenCalled();
  });

  it('rejects a missing user query parameter before the service', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .delete('/api/v1/event-programs/program-001/permissions/report:export')
      .set('Authorization', 'Bearer admin-001')
      .expect(400);
    expect(service.revokePermission).not.toHaveBeenCalled();
  });

  it('propagates an inherited permission conflict as 409', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);
    const { ApiError } = await import('../../utils/ApiError.js');
    service.revokePermission.mockRejectedValue(
      new ApiError(409, 'Cannot revoke a permission inherited from the event program.'),
    );

    await request(app)
      .delete('/api/v1/activities/activity-001/permissions/report:export?userId=user-002')
      .set('Authorization', 'Bearer admin-001')
      .expect(409);
  });

  it('propagates a missing collaborator as 404 on revoke', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);
    const { ApiError } = await import('../../utils/ApiError.js');
    service.revokePermission.mockRejectedValue(new ApiError(404, 'Collaborator not found.'));

    await request(app).delete(revokeUrl).set('Authorization', 'Bearer admin-001').expect(404);
  });

  const ownPermissionsResult = {
    scope: { type: 'program', id: 'program-001' },
    permissions: [
      { name: 'activity:read', validFrom: null, validUntil: null },
      {
        name: 'report:export',
        validFrom: '2026-09-01T00:00:00.000Z',
        validUntil: '2026-10-01T00:00:00.000Z',
      },
    ],
  };

  it('rejects reading own permissions without a token', async () => {
    const service = buildServiceMock();
    const listOwnPermissions = vi.fn();
    const app = await loadApp(service, createPrismaMock(), [], vi.fn(), listOwnPermissions);

    await request(app).get('/api/v1/users/me/permissions?scope=program&id=program-001').expect(401);
    expect(listOwnPermissions).not.toHaveBeenCalled();
  });

  it('rejects an invalid scope before the service', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const listOwnPermissions = vi.fn();
    const app = await loadApp(service, prisma, [], vi.fn(), listOwnPermissions);

    await request(app)
      .get('/api/v1/users/me/permissions?scope=team&id=program-001')
      .set('Authorization', 'Bearer user-001')
      .expect(400);
    expect(listOwnPermissions).not.toHaveBeenCalled();
  });

  it('returns the own permissions of the authenticated user in a program scope', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const listOwnPermissions = vi.fn().mockResolvedValue(ownPermissionsResult);
    const app = await loadApp(service, prisma, [], vi.fn(), listOwnPermissions);

    const response = await request(app)
      .get('/api/v1/users/me/permissions?scope=program&id=program-001')
      .set('Authorization', 'Bearer user-001')
      .expect(200);

    expect(listOwnPermissions).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-001' }), {
      type: 'program',
      id: 'program-001',
    });
    expect(response.body).toEqual({
      success: true,
      message: 'Permissions retrieved successfully.',
      data: ownPermissionsResult,
    });
  });

  it('passes the activity scope to the service', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const listOwnPermissions = vi.fn().mockResolvedValue({
      scope: { type: 'activity', id: 'activity-001' },
      permissions: [],
    });
    const app = await loadApp(service, prisma, [], vi.fn(), listOwnPermissions);

    await request(app)
      .get('/api/v1/users/me/permissions?scope=activity&id=activity-001')
      .set('Authorization', 'Bearer user-001')
      .expect(200);

    expect(listOwnPermissions).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-001' }), {
      type: 'activity',
      id: 'activity-001',
    });
  });

  it('rejects a missing scope identifier before the service', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const listOwnPermissions = vi.fn();
    const app = await loadApp(service, prisma, [], vi.fn(), listOwnPermissions);

    await request(app)
      .get('/api/v1/users/me/permissions?scope=program')
      .set('Authorization', 'Bearer user-001')
      .expect(400);
    expect(listOwnPermissions).not.toHaveBeenCalled();
  });

  it('propagates a missing scope as 404', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const listOwnPermissions = vi.fn();
    const app = await loadApp(service, prisma, [], vi.fn(), listOwnPermissions);
    const { ApiError } = await import('../../utils/ApiError.js');
    listOwnPermissions.mockRejectedValue(new ApiError(404, 'Event program not found.'));

    await request(app)
      .get('/api/v1/users/me/permissions?scope=program&id=missing')
      .set('Authorization', 'Bearer user-001')
      .expect(404);
  });

  it('does not expose audit fields in the own permissions response', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'program-001' });
    prisma.collaboration.findMany.mockResolvedValue([
      {
        eventProgramId: 'program-001',
        activityId: null,
        permissions: [
          {
            validFrom: null,
            validUntil: null,
            grantedById: 'actor-001',
            grantedAt: new Date('2026-09-19T10:00:00.000Z'),
            permission: { name: 'activity:read' },
          },
        ],
      },
    ]);
    const app = await loadAppWithRealAuthorization(service, prisma);

    const response = await request(app)
      .get('/api/v1/users/me/permissions?scope=program&id=program-001')
      .set('Authorization', 'Bearer user-001')
      .expect(200);

    expect(response.body.data.permissions).toEqual([
      { name: 'activity:read', origin: 'LOCAL', validFrom: null, validUntil: null },
    ]);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.to.include('grantedBy');
    expect(serialized).not.to.include('grantedAt');
  });

  it('does not expose audit fields in the collaborator creation response', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'program-001', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue(null);
    prisma.permission.findMany.mockResolvedValue(
      ROLE_DEFAULTS.VIEWER.map((name, index) => ({ id: `perm-${index}`, name })),
    );
    prisma.collaboration.create.mockResolvedValue({
      userId: 'user-002',
      role: 'VIEWER',
      createdAt: new Date('2026-09-19T12:00:00.000Z'),
      eventProgramId: 'program-001',
      activityId: null,
      grantedById: 'actor-001',
      grantedAt: new Date('2026-09-19T12:00:00.000Z'),
      user: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
      permissions: [
        {
          source: 'ROLE_DEFAULT',
          validFrom: null,
          validUntil: null,
          grantedById: 'actor-001',
          grantedAt: new Date('2026-09-19T12:00:00.000Z'),
          permission: { name: 'activity:read' },
        },
      ],
    });
    const app = await loadAppWithRealDelegation(prisma);

    const response = await request(app)
      .post('/api/v1/event-programs/program-001/collaborators')
      .set('Authorization', 'Bearer user-001')
      .send({ userId: 'user-002', role: 'VIEWER' })
      .expect(201);

    expect(response.body.data).toEqual({
      userId: 'user-002',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      role: 'VIEWER',
      createdAt: '2026-09-19T12:00:00.000Z',
      permissions: [
        { name: 'activity:read', source: 'ROLE_DEFAULT', validFrom: null, validUntil: null },
      ],
    });
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.to.include('grantedBy');
    expect(serialized).not.to.include('grantedAt');
  });
});

const HOUR_MS = 60 * 60 * 1000;
const CLOCK = new Date('2026-09-19T12:00:00.000Z');

describe('authorization routes expiry with the real resolver and a controlled clock', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('./delegation.service.js');
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../../utils/jwt-verifier.js');
    vi.doUnmock('../../lib/auth.js');
    vi.doUnmock('./authorization.service.js');
  });

  it('denies a request when the only permission:grant expires at the boundary', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(CLOCK.getTime() - 1));
    const service = buildServiceMock();
    service.listCollaborators.mockResolvedValue({ items: [] });
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    prisma.collaboration.findMany.mockResolvedValue([
      {
        permissions: [
          { validFrom: null, validUntil: CLOCK, permission: { name: 'permission:grant' } },
        ],
      },
    ]);
    const app = await loadAppWithRealAuthorization(service, prisma);

    await request(app)
      .get('/api/v1/event-programs/program-001/collaborators')
      .set('Authorization', 'Bearer user-001')
      .expect(200);
    expect(service.listCollaborators).toHaveBeenCalledTimes(1);

    vi.setSystemTime(CLOCK);

    await request(app)
      .get('/api/v1/event-programs/program-001/collaborators')
      .set('Authorization', 'Bearer user-001')
      .expect(403);
    expect(service.listCollaborators).toHaveBeenCalledTimes(1);

    expect(prisma.collaborationPermission.create).not.toHaveBeenCalled();
    expect(prisma.collaborationPermission.update).not.toHaveBeenCalled();
    expect(prisma.collaborationPermission.deleteMany).not.toHaveBeenCalled();
  });

  it('omits expired and future grants from own permissions as the clock advances', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(CLOCK);
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'program-001' });
    prisma.collaboration.findMany.mockResolvedValue([
      {
        eventProgramId: 'program-001',
        activityId: null,
        permissions: [
          {
            validFrom: null,
            validUntil: null,
            permission: { name: 'report:view' },
          },
          {
            validFrom: null,
            validUntil: CLOCK,
            permission: { name: 'report:export' },
          },
          {
            validFrom: new Date(CLOCK.getTime() + HOUR_MS),
            validUntil: null,
            permission: { name: 'activity:read' },
          },
        ],
      },
    ]);
    const app = await loadAppWithRealAuthorization(service, prisma);

    const active = await request(app)
      .get('/api/v1/users/me/permissions?scope=program&id=program-001')
      .set('Authorization', 'Bearer user-001')
      .expect(200);

    expect(active.body.data).toEqual({
      scope: { type: 'program', id: 'program-001' },
      permissions: [{ name: 'report:view', origin: 'LOCAL', validFrom: null, validUntil: null }],
    });

    vi.setSystemTime(new Date(CLOCK.getTime() + HOUR_MS));

    const advanced = await request(app)
      .get('/api/v1/users/me/permissions?scope=program&id=program-001')
      .set('Authorization', 'Bearer user-001')
      .expect(200);

    expect(advanced.body.data.permissions).toEqual([
      {
        name: 'activity:read',
        origin: 'LOCAL',
        validFrom: '2026-09-19T13:00:00.000Z',
        validUntil: null,
      },
      { name: 'report:view', origin: 'LOCAL', validFrom: null, validUntil: null },
    ]);

    expect(prisma.collaborationPermission.create).not.toHaveBeenCalled();
    expect(prisma.collaborationPermission.update).not.toHaveBeenCalled();
    expect(prisma.collaborationPermission.deleteMany).not.toHaveBeenCalled();
  });
});
