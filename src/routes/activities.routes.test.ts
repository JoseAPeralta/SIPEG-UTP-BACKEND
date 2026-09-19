import {
  calculateJwkThumbprint,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
} from 'jose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

interface ActivitiesServiceMock {
  listUpcomingActivities: ReturnType<typeof vi.fn>;
  createActivity: ReturnType<typeof vi.fn>;
}

const buildServiceMock = (): ActivitiesServiceMock => ({
  listUpcomingActivities: vi.fn(),
  createActivity: vi.fn(),
});

interface PrismaMock {
  user: { findUnique: ReturnType<typeof vi.fn> };
}

const createPrismaMock = (): PrismaMock => ({ user: { findUnique: vi.fn() } });

interface AuthorizationMock {
  getEffectivePermissions: ReturnType<typeof vi.fn>;
}

let userToken: string;
let adminToken: string;
let jwks: { keys: unknown[] };

const userRecord = {
  id: 'user-001',
  email: 'juan.perez@example.com',
  globalRole: 'USER',
  unitId: null,
  careerId: null,
  isActive: true,
};

const adminRecord = {
  id: 'admin-001',
  email: 'admin@example.com',
  globalRole: 'ADMIN',
  unitId: null,
  careerId: null,
  isActive: true,
};

const loadApp = async (options: {
  service: ActivitiesServiceMock;
  prisma?: PrismaMock;
  authorization?: AuthorizationMock;
}) => {
  process.env['NODE_ENV'] = 'test';
  process.env['AUTH_SECRET'] = 'a'.repeat(32);
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
  process.env['AUTH_URL'] = 'http://localhost:3000';
  vi.resetModules();
  vi.doMock('../modules/activities/activities.service.js', () => options.service);
  vi.doMock('../config/prisma.js', () => ({
    getPrismaClient: () => options.prisma ?? createPrismaMock(),
  }));
  vi.doMock('../utils/jwt-verifier.js', () => ({
    getJwtVerifier: () => ({
      verify: async (token: string) => {
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
  vi.doMock(
    '../modules/authorization/authorization.service.js',
    () =>
      options.authorization ?? { getEffectivePermissions: vi.fn().mockResolvedValue(new Set()) },
  );
  const { app } = await import('../app.js');
  return app;
};

const activityItem = {
  id: 'activity-001',
  name: 'Taller de Inteligencia Artificial',
  description: null,
  type: 'WORKSHOP',
  date: '2026-09-20',
  startTime: '14:00',
  endTime: '17:00',
  capacity: 35,
  bannerUrl: null,
  speaker: { id: 'user-001', firstName: 'Carlos', lastName: 'Rivera' },
  classroom: { id: 'classroom-001', name: 'Laboratorio 3', building: 'Edificio B' },
  eventProgram: { id: 'program-001', name: 'Programa de Ingenieria', label: null },
  organizationalUnit: {
    type: 'FACULTY',
    id: 'faculty-001',
    name: 'Ingenieria de Sistemas Computacionales',
  },
};

const activityDetail = {
  id: 'activity-002',
  name: 'Introduccion a TypeScript',
  description: null,
  type: 'WORKSHOP',
  date: '2026-09-20',
  startTime: '08:00',
  endTime: '10:00',
  capacity: null,
  bannerUrl: null,
  status: 'DRAFT',
  equipment: ['Proyector'],
  speaker: null,
  classroom: null,
  eventProgram: { id: 'program-001', name: 'Programa de Ingenieria', label: null },
  organizationalUnit: {
    type: 'FACULTY',
    id: 'faculty-001',
    name: 'Ingenieria de Sistemas Computacionales',
  },
};

const validCreateBody = {
  name: 'Introduccion a TypeScript',
  type: 'WORKSHOP',
  date: '2026-09-20',
  startTime: '08:00',
  endTime: '10:00',
  eventProgramId: 'program-001',
};

describe('activity routes', () => {
  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    const publicJwk = await exportJWK(publicKey);
    const kid = await calculateJwkThumbprint(publicJwk);
    publicJwk.kid = kid;
    publicJwk.alg = 'EdDSA';
    jwks = { keys: [publicJwk] };

    const sign = async (subject: string, privateKeyValue: CryptoKey) =>
      new SignJWT({})
        .setProtectedHeader({ alg: 'EdDSA', kid, typ: 'JWT' })
        .setIssuer('http://localhost:3000')
        .setAudience('http://localhost:3000')
        .setSubject(subject)
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(privateKeyValue);

    userToken = await sign('user-001', privateKey);
    adminToken = await sign('admin-001', privateKey);
  });

  afterEach(() => {
    vi.doUnmock('../modules/activities/activities.service.js');
    vi.doUnmock('../config/prisma.js');
    vi.doUnmock('../utils/jwt-verifier.js');
    vi.doUnmock('../lib/auth.js');
    vi.doUnmock('../modules/authorization/authorization.service.js');
  });

  afterAll(() => {
    vi.doUnmock('../modules/activities/activities.service.js');
    vi.doUnmock('../config/prisma.js');
    vi.doUnmock('../utils/jwt-verifier.js');
    vi.doUnmock('../lib/auth.js');
    vi.doUnmock('../modules/authorization/authorization.service.js');
  });

  it('returns paginated upcoming activities', async () => {
    const service = buildServiceMock();
    service.listUpcomingActivities.mockResolvedValue({
      items: [activityItem],
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
    const app = await loadApp({ service });

    const response = await request(app).get('/api/v1/activities').expect(200);

    expect(response.body).toEqual({
      success: true,
      message: 'Activities retrieved successfully.',
      data: {
        items: [activityItem],
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      },
    });
  });

  it('applies default pagination when no query is provided', async () => {
    const service = buildServiceMock();
    service.listUpcomingActivities.mockResolvedValue({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
    const app = await loadApp({ service });

    await request(app).get('/api/v1/activities').expect(200);

    expect(service.listUpcomingActivities).toHaveBeenCalledWith({ page: 1, limit: 20 });
  });

  it('forwards parsed pagination parameters', async () => {
    const service = buildServiceMock();
    service.listUpcomingActivities.mockResolvedValue({
      items: [],
      page: 3,
      limit: 50,
      total: 0,
      totalPages: 0,
    });
    const app = await loadApp({ service });

    await request(app).get('/api/v1/activities?page=3&limit=50').expect(200);

    expect(service.listUpcomingActivities).toHaveBeenCalledWith({ page: 3, limit: 50 });
  });

  it('rejects a limit above the maximum', async () => {
    const service = buildServiceMock();
    const app = await loadApp({ service });

    const response = await request(app).get('/api/v1/activities?limit=100').expect(400);

    expect(response.body).toMatchObject({ success: false, message: 'Validation error.' });
    expect(service.listUpcomingActivities).not.toHaveBeenCalled();
  });

  it('rejects an invalid page', async () => {
    const service = buildServiceMock();
    const app = await loadApp({ service });

    await request(app).get('/api/v1/activities?page=0').expect(400);
    expect(service.listUpcomingActivities).not.toHaveBeenCalled();
  });

  it('rejects create requests without a token', async () => {
    const service = buildServiceMock();
    const app = await loadApp({ service });

    await request(app).post('/api/v1/activities').send(validCreateBody).expect(401);
    expect(service.createActivity).not.toHaveBeenCalled();
  });

  it('rejects create requests when the user lacks the permission', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const authorization: AuthorizationMock = {
      getEffectivePermissions: vi.fn().mockResolvedValue(new Set()),
    };
    const app = await loadApp({ service, prisma, authorization });

    await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${userToken}`)
      .send(validCreateBody)
      .expect(403);
    expect(service.createActivity).not.toHaveBeenCalled();
  });

  it('creates an activity for an admin', async () => {
    const service = buildServiceMock();
    service.createActivity.mockResolvedValue(activityDetail);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp({ service, prisma });

    const response = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validCreateBody)
      .expect(201);

    expect(service.createActivity).toHaveBeenCalledWith(validCreateBody);
    expect(response.body).toEqual({
      success: true,
      message: 'Activity created successfully.',
      data: activityDetail,
    });
  });

  it('rejects an invalid create body before the service', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp({ service, prisma });

    await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validCreateBody, startTime: '10:00', endTime: '08:00' })
      .expect(400);

    expect(service.createActivity).not.toHaveBeenCalled();
  });
});
