import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface DelegationServiceMock {
  addCollaborator: ReturnType<typeof vi.fn>;
  listCollaborators: ReturnType<typeof vi.fn>;
}

const buildServiceMock = (): DelegationServiceMock => ({
  addCollaborator: vi.fn(),
  listCollaborators: vi.fn(),
});

interface PrismaMock {
  user: { findUnique: ReturnType<typeof vi.fn> };
}

const createPrismaMock = (): PrismaMock => ({ user: { findUnique: vi.fn() } });

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
  vi.doMock('./authorization.service.js', () => ({ getEffectivePermissions }));

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
});
