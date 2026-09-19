import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface EventProgramsServiceMock {
  createEventProgram: ReturnType<typeof vi.fn>;
}

const buildServiceMock = (): EventProgramsServiceMock => ({ createEventProgram: vi.fn() });

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

const loadApp = async (service: EventProgramsServiceMock, prisma = createPrismaMock()) => {
  process.env['NODE_ENV'] = 'test';
  process.env['AUTH_SECRET'] = 'a'.repeat(32);
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
  process.env['AUTH_URL'] = 'http://localhost:3000';
  vi.resetModules();
  vi.doMock('../modules/event-programs/event-programs.service.js', () => service);
  vi.doMock('../config/prisma.js', () => ({ getPrismaClient: () => prisma }));
  vi.doMock('../utils/jwt-verifier.js', () => ({
    getJwtVerifier: () => ({
      verify: async (token: string) => ({ sub: token }),
      refresh: async () => {},
    }),
  }));
  vi.doMock('../lib/auth.js', () => ({
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
  vi.doMock('../modules/authorization/authorization.service.js', () => ({
    getEffectivePermissions: vi.fn().mockResolvedValue(new Set(['program:create'])),
  }));

  const { app } = await import('../app.js');
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

describe('event program routes', () => {
  afterEach(() => {
    vi.doUnmock('../modules/event-programs/event-programs.service.js');
    vi.doUnmock('../config/prisma.js');
    vi.doUnmock('../utils/jwt-verifier.js');
    vi.doUnmock('../lib/auth.js');
    vi.doUnmock('../modules/authorization/authorization.service.js');
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
