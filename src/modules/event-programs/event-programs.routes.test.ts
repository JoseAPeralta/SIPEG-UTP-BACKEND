import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface EventProgramsServiceMock {
  archiveEventProgram: ReturnType<typeof vi.fn>;
  createEventProgram: ReturnType<typeof vi.fn>;
  getEventProgramById: ReturnType<typeof vi.fn>;
  listEventPrograms: ReturnType<typeof vi.fn>;
  reactivateEventProgram: ReturnType<typeof vi.fn>;
  updateEventProgram: ReturnType<typeof vi.fn>;
}

const buildServiceMock = (): EventProgramsServiceMock => ({
  archiveEventProgram: vi.fn(),
  createEventProgram: vi.fn(),
  getEventProgramById: vi.fn(),
  listEventPrograms: vi.fn(),
  reactivateEventProgram: vi.fn(),
  updateEventProgram: vi.fn(),
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

const loadApp = async (
  service: EventProgramsServiceMock,
  prisma = createPrismaMock(),
  permissions: string[] = ['program:create'],
  getEffectivePermissions = vi.fn(),
  verify: (token: string) => Promise<{ sub: string }> = async (token) => ({ sub: token }),
) => {
  getEffectivePermissions.mockResolvedValue(new Set(permissions));
  process.env['NODE_ENV'] = 'test';
  process.env['AUTH_SECRET'] = 'a'.repeat(32);
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
  process.env['AUTH_URL'] = 'http://localhost:3000';
  vi.resetModules();
  vi.doMock('./event-programs.service.js', () => service);
  vi.doMock('../../config/prisma.js', () => ({ getPrismaClient: () => prisma }));
  vi.doMock('../../utils/jwt-verifier.js', () => ({
    getJwtVerifier: () => ({
      verify,
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
  vi.doMock('../authorization/authorization.service.js', () => ({
    getEffectivePermissions,
  }));

  const { app } = await import('../../app.js');
  return app;
};

const validCreateBody = {
  name: 'Congreso de Innovacion 2026',
  organizationalUnitId: 'unit-001',
  startDate: '2026-10-12',
  endDate: '2026-10-16',
};

const eventProgramDetail = {
  id: 'program-001',
  name: validCreateBody.name,
  description: null,
  label: null,
  bannerUrl: null,
  isDefault: false,
  status: 'DRAFT',
  startDate: validCreateBody.startDate,
  endDate: validCreateBody.endDate,
  organizationalUnit: {
    id: 'unit-001',
    name: 'Facultad de Ingenieria',
    type: 'FACULTY',
  },
};

const eventProgramListItem = {
  ...eventProgramDetail,
  status: 'ACTIVE',
};

describe('event program routes', () => {
  afterEach(() => {
    vi.doUnmock('./event-programs.service.js');
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../../utils/jwt-verifier.js');
    vi.doUnmock('../../lib/auth.js');
    vi.doUnmock('../authorization/authorization.service.js');
  });

  it('returns paginated active event programs without authentication', async () => {
    const service = buildServiceMock();
    service.listEventPrograms.mockResolvedValue({
      items: [eventProgramListItem],
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
    const app = await loadApp(service);

    const response = await request(app).get('/api/v1/event-programs').expect(200);

    expect(response.body).toEqual({
      success: true,
      message: 'Event programs retrieved successfully.',
      data: {
        items: [eventProgramListItem],
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      },
    });
  });

  it('applies default pagination when no query is provided', async () => {
    const service = buildServiceMock();
    service.listEventPrograms.mockResolvedValue({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
    const app = await loadApp(service);

    await request(app).get('/api/v1/event-programs').expect(200);

    expect(service.listEventPrograms).toHaveBeenCalledWith({ page: 1, limit: 20 }, null);
  });

  it('forwards parsed pagination and filters', async () => {
    const service = buildServiceMock();
    service.listEventPrograms.mockResolvedValue({
      items: [],
      page: 2,
      limit: 10,
      total: 0,
      totalPages: 0,
    });
    const app = await loadApp(service);

    await request(app)
      .get(
        '/api/v1/event-programs?page=2&limit=10&organizationalUnitId=unit-001&unitType=FACULTY&q=congreso',
      )
      .expect(200);

    expect(service.listEventPrograms).toHaveBeenCalledWith(
      {
        page: 2,
        limit: 10,
        organizationalUnitId: 'unit-001',
        unitType: 'FACULTY',
        q: 'congreso',
      },
      null,
    );
  });

  it('rejects an invalid unit type before the service', async () => {
    const service = buildServiceMock();
    const app = await loadApp(service);

    await request(app).get('/api/v1/event-programs?unitType=CAMPUS').expect(400);

    expect(service.listEventPrograms).not.toHaveBeenCalled();
  });

  it('forwards the status filter and the admin viewer', async () => {
    const service = buildServiceMock();
    service.listEventPrograms.mockResolvedValue({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .get('/api/v1/event-programs?status=ALL')
      .set('Authorization', 'Bearer admin-001')
      .expect(200);

    expect(service.listEventPrograms).toHaveBeenCalledWith(
      { page: 1, limit: 20, status: 'ALL' },
      adminRecord,
    );
  });

  it('rejects an invalid status before the service', async () => {
    const service = buildServiceMock();
    const app = await loadApp(service);

    await request(app).get('/api/v1/event-programs?status=PENDING').expect(400);
    expect(service.listEventPrograms).not.toHaveBeenCalled();
  });

  it('rejects an invalid bearer token with 401 before the service', async () => {
    const service = buildServiceMock();
    const verify = vi.fn();
    const app = await loadApp(service, createPrismaMock(), ['program:create'], vi.fn(), verify);
    const { ApiError } = await import('../../utils/ApiError.js');
    verify.mockRejectedValue(new ApiError(401, 'Invalid or expired token.'));

    await request(app)
      .get('/api/v1/event-programs')
      .set('Authorization', 'Bearer broken')
      .expect(401);

    expect(service.listEventPrograms).not.toHaveBeenCalled();
  });

  it('rejects create requests without a token', async () => {
    const service = buildServiceMock();
    const app = await loadApp(service);

    await request(app).post('/api/v1/event-programs').send(validCreateBody).expect(401);
    expect(service.createEventProgram).not.toHaveBeenCalled();
  });

  it('rejects non-admin users because program:create has no scope', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .post('/api/v1/event-programs')
      .set('Authorization', 'Bearer user-001')
      .send(validCreateBody)
      .expect(403);
    expect(service.createEventProgram).not.toHaveBeenCalled();
  });

  it('creates an event program for an admin', async () => {
    const service = buildServiceMock();
    service.createEventProgram.mockResolvedValue(eventProgramDetail);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    const response = await request(app)
      .post('/api/v1/event-programs')
      .set('Authorization', 'Bearer admin-001')
      .send(validCreateBody)
      .expect(201);

    expect(service.createEventProgram).toHaveBeenCalledWith(validCreateBody, 'admin-001');
    expect(response.body).toEqual({
      success: true,
      message: 'Event program created successfully.',
      data: eventProgramDetail,
    });
  });

  it('rejects an invalid body before the service', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .post('/api/v1/event-programs')
      .set('Authorization', 'Bearer admin-001')
      .send({ ...validCreateBody, endDate: '2026-10-01' })
      .expect(400);
    expect(service.createEventProgram).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/event-programs/:id', () => {
  afterEach(() => {
    vi.doUnmock('./event-programs.service.js');
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../../utils/jwt-verifier.js');
    vi.doUnmock('../../lib/auth.js');
    vi.doUnmock('../authorization/authorization.service.js');
  });

  const publicDetail = {
    ...eventProgramListItem,
    activityCount: { visible: 6 },
  };

  it('returns the public detail without authentication', async () => {
    const service = buildServiceMock();
    service.getEventProgramById.mockResolvedValue(publicDetail);
    const app = await loadApp(service);

    const response = await request(app).get('/api/v1/event-programs/program-001').expect(200);

    expect(service.getEventProgramById).toHaveBeenCalledWith('program-001', null);
    expect(response.body).toEqual({
      success: true,
      message: 'Event program retrieved successfully.',
      data: publicDetail,
    });
  });

  it('passes the authenticated viewer to the service', async () => {
    const service = buildServiceMock();
    service.getEventProgramById.mockResolvedValue({
      ...publicDetail,
      activityCount: {
        visible: 6,
        total: 9,
        byStatus: { DRAFT: 2, SCHEDULED: 3, ONGOING: 1, COMPLETED: 2, CANCELLED: 1 },
      },
    });
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .get('/api/v1/event-programs/program-001')
      .set('Authorization', 'Bearer user-001')
      .expect(200);

    expect(service.getEventProgramById).toHaveBeenCalledWith('program-001', userRecord);
  });

  it('rejects a blank id before the service', async () => {
    const service = buildServiceMock();
    const app = await loadApp(service);

    await request(app).get('/api/v1/event-programs/%20').expect(400);
    expect(service.getEventProgramById).not.toHaveBeenCalled();
  });

  it('propagates a missing event program as 404', async () => {
    const service = buildServiceMock();
    const app = await loadApp(service);
    const { ApiError } = await import('../../utils/ApiError.js');
    service.getEventProgramById.mockRejectedValue(new ApiError(404, 'Event program not found.'));

    await request(app).get('/api/v1/event-programs/missing').expect(404);
  });

  it('rejects an invalid bearer token with 401 before the service', async () => {
    const service = buildServiceMock();
    const verify = vi.fn();
    const app = await loadApp(service, createPrismaMock(), ['program:create'], vi.fn(), verify);
    const { ApiError } = await import('../../utils/ApiError.js');
    verify.mockRejectedValue(new ApiError(401, 'Invalid or expired token.'));

    await request(app)
      .get('/api/v1/event-programs/program-001')
      .set('Authorization', 'Bearer broken')
      .expect(401);

    expect(service.getEventProgramById).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/v1/event-programs/:id', () => {
  afterEach(() => {
    vi.doUnmock('./event-programs.service.js');
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../../utils/jwt-verifier.js');
    vi.doUnmock('../../lib/auth.js');
    vi.doUnmock('../authorization/authorization.service.js');
  });

  const updateBody = { name: '  Congreso actualizado  ', label: 'CI-2026' };
  const parsedUpdateBody = { name: 'Congreso actualizado', label: 'CI-2026' };

  const updatedEventProgramDetail = {
    ...eventProgramDetail,
    name: parsedUpdateBody.name,
    label: parsedUpdateBody.label,
    status: 'ACTIVE',
  };

  it('rejects update requests without a token', async () => {
    const service = buildServiceMock();
    const app = await loadApp(service);

    await request(app).patch('/api/v1/event-programs/program-001').send(updateBody).expect(401);
    expect(service.updateEventProgram).not.toHaveBeenCalled();
  });

  it('rejects a non-admin without program:update on the scope', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const app = await loadApp(service, prisma, ['program:create']);

    await request(app)
      .patch('/api/v1/event-programs/program-001')
      .set('Authorization', 'Bearer user-001')
      .send(updateBody)
      .expect(403);
    expect(service.updateEventProgram).not.toHaveBeenCalled();
  });

  it('updates an event program for an authorized collaborator in scope', async () => {
    const service = buildServiceMock();
    service.updateEventProgram.mockResolvedValue(updatedEventProgramDetail);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const getEffectivePermissions = vi.fn();
    const app = await loadApp(service, prisma, ['program:update'], getEffectivePermissions);

    const response = await request(app)
      .patch('/api/v1/event-programs/program-001')
      .set('Authorization', 'Bearer user-001')
      .send(updateBody)
      .expect(200);

    expect(getEffectivePermissions).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-001' }),
      { eventProgramId: 'program-001' },
    );
    expect(service.updateEventProgram).toHaveBeenCalledWith('program-001', parsedUpdateBody);
    expect(response.body).toEqual({
      success: true,
      message: 'Event program updated successfully.',
      data: updatedEventProgramDetail,
    });
  });

  it('updates an event program for an admin', async () => {
    const service = buildServiceMock();
    service.updateEventProgram.mockResolvedValue(updatedEventProgramDetail);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .patch('/api/v1/event-programs/program-001')
      .set('Authorization', 'Bearer admin-001')
      .send(updateBody)
      .expect(200);

    expect(service.updateEventProgram).toHaveBeenCalledWith('program-001', parsedUpdateBody);
  });

  it('rejects an empty body before the service', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .patch('/api/v1/event-programs/program-001')
      .set('Authorization', 'Bearer admin-001')
      .send({})
      .expect(400);
    expect(service.updateEventProgram).not.toHaveBeenCalled();
  });

  it('forwards an ACTIVE status transition to the service', async () => {
    const service = buildServiceMock();
    service.updateEventProgram.mockResolvedValue({
      ...updatedEventProgramDetail,
      status: 'ACTIVE',
    });
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .patch('/api/v1/event-programs/program-001')
      .set('Authorization', 'Bearer admin-001')
      .send({ status: 'ACTIVE' })
      .expect(200);

    expect(service.updateEventProgram).toHaveBeenCalledWith('program-001', { status: 'ACTIVE' });
  });

  it('rejects a status other than ACTIVE before the service', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .patch('/api/v1/event-programs/program-001')
      .set('Authorization', 'Bearer admin-001')
      .send({ status: 'ARCHIVED' })
      .expect(400);
    expect(service.updateEventProgram).not.toHaveBeenCalled();
  });

  it('rejects immutable fields before the service', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .patch('/api/v1/event-programs/program-001')
      .set('Authorization', 'Bearer admin-001')
      .send({ isDefault: true, organizationalUnitId: 'unit-002' })
      .expect(400);
    expect(service.updateEventProgram).not.toHaveBeenCalled();
  });

  it('propagates a missing event program as 404', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);
    const { ApiError } = await import('../../utils/ApiError.js');
    service.updateEventProgram.mockRejectedValue(new ApiError(404, 'Event program not found.'));

    await request(app)
      .patch('/api/v1/event-programs/missing')
      .set('Authorization', 'Bearer admin-001')
      .send(updateBody)
      .expect(404);
  });

  it('propagates an archived event program as 409', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);
    const { ApiError } = await import('../../utils/ApiError.js');
    service.updateEventProgram.mockRejectedValue(
      new ApiError(409, 'Archived event programs cannot be modified.'),
    );

    await request(app)
      .patch('/api/v1/event-programs/program-001')
      .set('Authorization', 'Bearer admin-001')
      .send(updateBody)
      .expect(409);
  });
});

describe('POST /api/v1/event-programs/:id/archive', () => {
  afterEach(() => {
    vi.doUnmock('./event-programs.service.js');
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../../utils/jwt-verifier.js');
    vi.doUnmock('../../lib/auth.js');
    vi.doUnmock('../authorization/authorization.service.js');
  });

  const archivedEventProgramDetail = {
    ...eventProgramDetail,
    status: 'ARCHIVED' as const,
  };

  it('rejects archive requests without a token', async () => {
    const service = buildServiceMock();
    const app = await loadApp(service);

    await request(app).post('/api/v1/event-programs/program-001/archive').expect(401);
    expect(service.archiveEventProgram).not.toHaveBeenCalled();
  });

  it('rejects a non-admin without program:archive on the scope', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const app = await loadApp(service, prisma, ['program:update']);

    await request(app)
      .post('/api/v1/event-programs/program-001/archive')
      .set('Authorization', 'Bearer user-001')
      .expect(403);
    expect(service.archiveEventProgram).not.toHaveBeenCalled();
  });

  it('archives an event program for an admin', async () => {
    const service = buildServiceMock();
    service.archiveEventProgram.mockResolvedValue(archivedEventProgramDetail);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    const response = await request(app)
      .post('/api/v1/event-programs/program-001/archive')
      .set('Authorization', 'Bearer admin-001')
      .expect(200);

    expect(service.archiveEventProgram).toHaveBeenCalledWith('program-001');
    expect(response.body).toEqual({
      success: true,
      message: 'Event program archived successfully.',
      data: archivedEventProgramDetail,
    });
  });

  it('archives an event program for a collaborator with program:archive in scope', async () => {
    const service = buildServiceMock();
    service.archiveEventProgram.mockResolvedValue(archivedEventProgramDetail);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const getEffectivePermissions = vi.fn();
    const app = await loadApp(service, prisma, ['program:archive'], getEffectivePermissions);

    await request(app)
      .post('/api/v1/event-programs/program-001/archive')
      .set('Authorization', 'Bearer user-001')
      .expect(200);

    expect(getEffectivePermissions).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-001' }),
      { eventProgramId: 'program-001' },
    );
    expect(service.archiveEventProgram).toHaveBeenCalledWith('program-001');
  });

  it('rejects a blank id before the service', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .post('/api/v1/event-programs/%20/archive')
      .set('Authorization', 'Bearer admin-001')
      .expect(400);
    expect(service.archiveEventProgram).not.toHaveBeenCalled();
  });

  it('propagates a missing event program as 404', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);
    const { ApiError } = await import('../../utils/ApiError.js');
    service.archiveEventProgram.mockRejectedValue(new ApiError(404, 'Event program not found.'));

    await request(app)
      .post('/api/v1/event-programs/missing/archive')
      .set('Authorization', 'Bearer admin-001')
      .expect(404);
  });
});

describe('POST /api/v1/event-programs/:id/reactivate', () => {
  afterEach(() => {
    vi.doUnmock('./event-programs.service.js');
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../../utils/jwt-verifier.js');
    vi.doUnmock('../../lib/auth.js');
    vi.doUnmock('../authorization/authorization.service.js');
  });

  const reactivatedEventProgramDetail = {
    ...eventProgramDetail,
    status: 'ACTIVE' as const,
  };

  it('rejects reactivation requests without a token', async () => {
    const service = buildServiceMock();
    const app = await loadApp(service);

    await request(app).post('/api/v1/event-programs/program-001/reactivate').expect(401);
    expect(service.reactivateEventProgram).not.toHaveBeenCalled();
  });

  it('rejects a non-admin without program:reactivate on the scope', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const app = await loadApp(service, prisma, ['program:archive']);

    await request(app)
      .post('/api/v1/event-programs/program-001/reactivate')
      .set('Authorization', 'Bearer user-001')
      .expect(403);
    expect(service.reactivateEventProgram).not.toHaveBeenCalled();
  });

  it('reactivates an event program for an admin', async () => {
    const service = buildServiceMock();
    service.reactivateEventProgram.mockResolvedValue(reactivatedEventProgramDetail);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    const response = await request(app)
      .post('/api/v1/event-programs/program-001/reactivate')
      .set('Authorization', 'Bearer admin-001')
      .expect(200);

    expect(service.reactivateEventProgram).toHaveBeenCalledWith('program-001');
    expect(response.body).toEqual({
      success: true,
      message: 'Event program reactivated successfully.',
      data: reactivatedEventProgramDetail,
    });
  });

  it('reactivates an event program for a collaborator with program:reactivate in scope', async () => {
    const service = buildServiceMock();
    service.reactivateEventProgram.mockResolvedValue(reactivatedEventProgramDetail);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const getEffectivePermissions = vi.fn();
    const app = await loadApp(service, prisma, ['program:reactivate'], getEffectivePermissions);

    await request(app)
      .post('/api/v1/event-programs/program-001/reactivate')
      .set('Authorization', 'Bearer user-001')
      .expect(200);

    expect(getEffectivePermissions).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-001' }),
      { eventProgramId: 'program-001' },
    );
    expect(service.reactivateEventProgram).toHaveBeenCalledWith('program-001');
  });

  it('rejects a blank id before the service', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .post('/api/v1/event-programs/%20/reactivate')
      .set('Authorization', 'Bearer admin-001')
      .expect(400);
    expect(service.reactivateEventProgram).not.toHaveBeenCalled();
  });

  it('propagates a missing event program as 404', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);
    const { ApiError } = await import('../../utils/ApiError.js');
    service.reactivateEventProgram.mockRejectedValue(new ApiError(404, 'Event program not found.'));

    await request(app)
      .post('/api/v1/event-programs/missing/reactivate')
      .set('Authorization', 'Bearer admin-001')
      .expect(404);
  });

  it('propagates a default event program as 409', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);
    const { ApiError } = await import('../../utils/ApiError.js');
    service.reactivateEventProgram.mockRejectedValue(
      new ApiError(409, 'Only additional event programs can be reactivated.'),
    );

    await request(app)
      .post('/api/v1/event-programs/program-001/reactivate')
      .set('Authorization', 'Bearer admin-001')
      .expect(409);
  });

  it('rejects deleting an event program with 405 and an Allow header', async () => {
    const service = buildServiceMock();
    const app = await loadApp(service);

    const response = await request(app).delete('/api/v1/event-programs/program-001').expect(405);

    expect(response.headers['allow']).toBe('GET, PATCH');
    expect(response.body).toEqual({ success: false, message: 'Method not allowed.', errors: [] });
    expect(service.updateEventProgram).not.toHaveBeenCalled();
    expect(service.archiveEventProgram).not.toHaveBeenCalled();
    expect(service.reactivateEventProgram).not.toHaveBeenCalled();
  });

  it('rejects deleting the event program collection with 405 and an Allow header', async () => {
    const service = buildServiceMock();
    const app = await loadApp(service);

    const response = await request(app).delete('/api/v1/event-programs').expect(405);

    expect(response.headers['allow']).toBe('GET, POST');
    expect(response.body).toEqual({ success: false, message: 'Method not allowed.', errors: [] });
    expect(service.createEventProgram).not.toHaveBeenCalled();
    expect(service.listEventPrograms).not.toHaveBeenCalled();
  });

  it('keeps rejecting deletion for an admin token and for an unknown program', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .delete('/api/v1/event-programs/program-001')
      .set('Authorization', 'Bearer admin-001')
      .expect(405);
    await request(app).delete('/api/v1/event-programs/does-not-exist').expect(405);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
