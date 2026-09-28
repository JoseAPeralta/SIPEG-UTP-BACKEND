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
  listEventProgramActivities: ReturnType<typeof vi.fn>;
  createActivity: ReturnType<typeof vi.fn>;
  getActivityById: ReturnType<typeof vi.fn>;
  updateActivity: ReturnType<typeof vi.fn>;
  cancelActivity: ReturnType<typeof vi.fn>;
  deleteActivity: ReturnType<typeof vi.fn>;
}

const auditContext = (actorId: string) =>
  expect.objectContaining({
    actorId,
    actorType: 'USER',
    requestId: expect.any(String) as unknown as string,
  });

const buildServiceMock = (): ActivitiesServiceMock => ({
  listUpcomingActivities: vi.fn(),
  listEventProgramActivities: vi.fn(),
  createActivity: vi.fn(),
  getActivityById: vi.fn(),
  updateActivity: vi.fn(),
  cancelActivity: vi.fn(),
  deleteActivity: vi.fn(),
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
  vi.doMock('./activities.service.js', () => options.service);
  vi.doMock('../../config/prisma.js', () => ({
    getPrismaClient: () => options.prisma ?? createPrismaMock(),
  }));
  vi.doMock('../../utils/jwt-verifier.js', () => ({
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
  vi.doMock(
    '../authorization/authorization.service.js',
    () =>
      options.authorization ?? { getEffectivePermissions: vi.fn().mockResolvedValue(new Set()) },
  );
  const { app } = await import('../../app.js');
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
  speakers: [{ id: 'speaker-001', firstName: 'Carlos', lastName: 'Rivera' }],
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
  enrolledCount: 0,
  checkedInCount: 0,
  speakers: [],
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
  speakers: [{ firstName: ' Ana ', lastName: ' Gomez ', email: ' Ana.Gomez@Example.com ' }],
};

const parsedCreateBody = {
  ...validCreateBody,
  speakers: [{ firstName: 'Ana', lastName: 'Gomez', email: 'ana.gomez@example.com' }],
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
    vi.doUnmock('./activities.service.js');
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../../utils/jwt-verifier.js');
    vi.doUnmock('../../lib/auth.js');
    vi.doUnmock('../authorization/authorization.service.js');
  });

  afterAll(() => {
    vi.doUnmock('./activities.service.js');
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../../utils/jwt-verifier.js');
    vi.doUnmock('../../lib/auth.js');
    vi.doUnmock('../authorization/authorization.service.js');
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

    expect(service.createActivity).toHaveBeenCalledWith(
      parsedCreateBody,
      expect.objectContaining({ actorType: expect.any(String) }),
    );
    expect(response.body).toEqual({
      success: true,
      message: 'Activity created successfully.',
      data: activityDetail,
    });
  });

  it('rejects the legacy speakerId field before the service', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp({ service, prisma });

    await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validCreateBody, speakerId: 'user-001' })
      .expect(400);

    expect(service.createActivity).not.toHaveBeenCalled();
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

  it('returns a public activity without authentication', async () => {
    const service = buildServiceMock();
    service.getActivityById.mockResolvedValue(activityDetail);
    const app = await loadApp({ service });

    const response = await request(app).get('/api/v1/activities/activity-002').expect(200);

    expect(service.getActivityById).toHaveBeenCalledWith('activity-002', undefined);
    expect(response.body).toEqual({
      success: true,
      message: 'Activity retrieved successfully.',
      data: activityDetail,
    });
  });

  it('trims the activity id before the service', async () => {
    const service = buildServiceMock();
    service.getActivityById.mockResolvedValue(activityDetail);
    const app = await loadApp({ service });

    await request(app).get('/api/v1/activities/%20activity-002%20').expect(200);

    expect(service.getActivityById).toHaveBeenCalledWith('activity-002', undefined);
  });

  it('rejects a blank activity id before the service', async () => {
    const service = buildServiceMock();
    const app = await loadApp({ service });

    await request(app).get('/api/v1/activities/%20').expect(400);

    expect(service.getActivityById).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown activity', async () => {
    const service = buildServiceMock();
    const app = await loadApp({ service });
    const { ApiError } = await import('../../utils/ApiError.js');
    service.getActivityById.mockRejectedValue(new ApiError(404, 'Activity not found.'));

    const response = await request(app).get('/api/v1/activities/missing').expect(404);

    expect(response.body).toMatchObject({ success: false, message: 'Activity not found.' });
  });

  it('rejects a malformed Authorization header with 401', async () => {
    const service = buildServiceMock();
    const app = await loadApp({ service });

    await request(app)
      .get('/api/v1/activities/activity-002')
      .set('Authorization', 'Basic xyz')
      .expect(401);

    expect(service.getActivityById).not.toHaveBeenCalled();
  });

  it('forwards the authenticated viewer to the service', async () => {
    const service = buildServiceMock();
    service.getActivityById.mockResolvedValue(activityDetail);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const app = await loadApp({ service, prisma });

    await request(app)
      .get('/api/v1/activities/activity-002')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(service.getActivityById).toHaveBeenCalledWith('activity-002', userRecord);
  });

  it('rejects update requests without a token', async () => {
    const service = buildServiceMock();
    const app = await loadApp({ service });

    await request(app)
      .patch('/api/v1/activities/activity-002')
      .send({ name: 'Nuevo nombre' })
      .expect(401);
    expect(service.updateActivity).not.toHaveBeenCalled();
  });

  it('rejects update requests when the user lacks activity:update', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const authorization: AuthorizationMock = {
      getEffectivePermissions: vi.fn().mockResolvedValue(new Set()),
    };
    const app = await loadApp({ service, prisma, authorization });

    await request(app)
      .patch('/api/v1/activities/activity-002')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'Nuevo nombre' })
      .expect(403);
    expect(service.updateActivity).not.toHaveBeenCalled();
  });

  it('updates an activity for a collaborator with activity:update in the activity scope', async () => {
    const service = buildServiceMock();
    service.updateActivity.mockResolvedValue(activityDetail);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const authorization: AuthorizationMock = {
      getEffectivePermissions: vi.fn().mockResolvedValue(new Set(['activity:update'])),
    };
    const app = await loadApp({ service, prisma, authorization });

    const response = await request(app)
      .patch('/api/v1/activities/activity-002')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: '  Nuevo nombre  ', maxCapacity: 25 })
      .expect(200);

    expect(authorization.getEffectivePermissions).toHaveBeenCalledWith(userRecord, {
      activityId: 'activity-002',
    });
    expect(service.updateActivity).toHaveBeenCalledWith(
      'activity-002',
      {
        name: 'Nuevo nombre',
        maxCapacity: 25,
      },
      auditContext('user-001'),
    );
    expect(response.body).toEqual({
      success: true,
      message: 'Activity updated successfully.',
      data: activityDetail,
    });
  });

  it('updates an activity for an admin without a permission lookup', async () => {
    const service = buildServiceMock();
    service.updateActivity.mockResolvedValue(activityDetail);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const authorization: AuthorizationMock = {
      getEffectivePermissions: vi.fn().mockResolvedValue(new Set()),
    };
    const app = await loadApp({ service, prisma, authorization });

    await request(app)
      .patch('/api/v1/activities/activity-002')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'SCHEDULED' })
      .expect(200);

    expect(authorization.getEffectivePermissions).not.toHaveBeenCalled();
    expect(service.updateActivity).toHaveBeenCalledWith(
      'activity-002',
      { status: 'SCHEDULED' },
      auditContext('admin-001'),
    );
  });

  it('rejects update bodies without fields or with unknown keys before the service', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp({ service, prisma });

    await request(app)
      .patch('/api/v1/activities/activity-002')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(400);
    await request(app)
      .patch('/api/v1/activities/activity-002')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ eventProgramId: 'program-002' })
      .expect(400);

    expect(service.updateActivity).not.toHaveBeenCalled();
  });

  it('rejects a blank activity id on update before the service', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp({ service, prisma });

    await request(app)
      .patch('/api/v1/activities/%20')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'X' })
      .expect(400);

    expect(service.updateActivity).not.toHaveBeenCalled();
  });

  it('propagates the service 404 and 409 errors on update', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp({ service, prisma });
    const { ApiError } = await import('../../utils/ApiError.js');

    service.updateActivity.mockRejectedValue(new ApiError(404, 'Activity not found.'));
    await request(app)
      .patch('/api/v1/activities/missing')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'X' })
      .expect(404);

    service.updateActivity.mockRejectedValue(
      new ApiError(409, 'Completed or cancelled activities cannot be modified.'),
    );
    const conflict = await request(app)
      .patch('/api/v1/activities/activity-002')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'X' })
      .expect(409);

    expect(conflict.body).toMatchObject({
      success: false,
      message: 'Completed or cancelled activities cannot be modified.',
    });
  });

  it('returns paginated activities of an event program', async () => {
    const service = buildServiceMock();
    const programPage = {
      items: [{ ...activityItem, status: 'SCHEDULED' }],
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    };
    service.listEventProgramActivities.mockResolvedValue(programPage);
    const app = await loadApp({ service });

    const response = await request(app)
      .get('/api/v1/event-programs/program-001/activities')
      .expect(200);

    expect(service.listEventProgramActivities).toHaveBeenCalledWith(
      'program-001',
      { page: 1, limit: 20 },
      null,
    );
    expect(response.body).toEqual({
      success: true,
      message: 'Event program activities retrieved successfully.',
      data: programPage,
    });
  });

  it('forwards the parsed program activity filters', async () => {
    const service = buildServiceMock();
    service.listEventProgramActivities.mockResolvedValue({
      items: [],
      page: 2,
      limit: 5,
      total: 0,
      totalPages: 0,
    });
    const app = await loadApp({ service });

    await request(app)
      .get(
        '/api/v1/event-programs/program-001/activities?page=2&limit=5&status=DRAFT&type=TALK&q=ia&dateFrom=2026-09-01&dateTo=2026-09-30',
      )
      .expect(200);

    expect(service.listEventProgramActivities).toHaveBeenCalledWith(
      'program-001',
      {
        page: 2,
        limit: 5,
        status: 'DRAFT',
        type: 'TALK',
        q: 'ia',
        dateFrom: '2026-09-01',
        dateTo: '2026-09-30',
      },
      null,
    );
  });

  it('rejects an invalid program activity status before the service', async () => {
    const service = buildServiceMock();
    const app = await loadApp({ service });

    await request(app)
      .get('/api/v1/event-programs/program-001/activities?status=PENDING')
      .expect(400);

    expect(service.listEventProgramActivities).not.toHaveBeenCalled();
  });

  it('rejects a program activity limit above the maximum', async () => {
    const service = buildServiceMock();
    const app = await loadApp({ service });

    await request(app).get('/api/v1/event-programs/program-001/activities?limit=51').expect(400);

    expect(service.listEventProgramActivities).not.toHaveBeenCalled();
  });

  it('rejects a range that starts after it ends before the service', async () => {
    const service = buildServiceMock();
    const app = await loadApp({ service });

    await request(app)
      .get('/api/v1/event-programs/program-001/activities?dateFrom=2026-10-01&dateTo=2026-09-01')
      .expect(400);

    expect(service.listEventProgramActivities).not.toHaveBeenCalled();
  });

  it('rejects a blank event program id before the service', async () => {
    const service = buildServiceMock();
    const app = await loadApp({ service });

    await request(app).get('/api/v1/event-programs/%20/activities').expect(400);

    expect(service.listEventProgramActivities).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown event program activity listing', async () => {
    const service = buildServiceMock();
    const app = await loadApp({ service });
    const { ApiError } = await import('../../utils/ApiError.js');
    service.listEventProgramActivities.mockRejectedValue(
      new ApiError(404, 'Event program not found.'),
    );

    const response = await request(app)
      .get('/api/v1/event-programs/missing/activities')
      .expect(404);

    expect(response.body).toMatchObject({ success: false, message: 'Event program not found.' });
  });

  it('rejects an invalid token on the program activity listing', async () => {
    const service = buildServiceMock();
    const app = await loadApp({ service });

    await request(app)
      .get('/api/v1/event-programs/program-001/activities')
      .set('Authorization', 'Basic invalid-token')
      .expect(401);

    expect(service.listEventProgramActivities).not.toHaveBeenCalled();
  });

  it('forwards the authenticated viewer to the program activity service', async () => {
    const service = buildServiceMock();
    service.listEventProgramActivities.mockResolvedValue({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp({ service, prisma });

    await request(app)
      .get('/api/v1/event-programs/program-001/activities')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(service.listEventProgramActivities).toHaveBeenCalledWith(
      'program-001',
      { page: 1, limit: 20 },
      adminRecord,
    );
  });
});

describe('activity cancel route', () => {
  it('rejects cancel requests without a token', async () => {
    const service = buildServiceMock();
    const app = await loadApp({ service });

    await request(app).post('/api/v1/activities/activity-002/cancel').send({}).expect(401);
    expect(service.cancelActivity).not.toHaveBeenCalled();
  });

  it('rejects cancel requests when the user lacks activity:cancel', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const authorization: AuthorizationMock = {
      getEffectivePermissions: vi.fn().mockResolvedValue(new Set()),
    };
    const app = await loadApp({ service, prisma, authorization });

    await request(app)
      .post('/api/v1/activities/activity-002/cancel')
      .set('Authorization', `Bearer ${userToken}`)
      .send({})
      .expect(403);

    expect(authorization.getEffectivePermissions).toHaveBeenCalledWith(userRecord, {
      activityId: 'activity-002',
    });
    expect(service.cancelActivity).not.toHaveBeenCalled();
  });

  it('cancels an activity for a collaborator with activity:cancel', async () => {
    const service = buildServiceMock();
    service.cancelActivity.mockResolvedValue({
      ...activityDetail,
      status: 'CANCELLED',
      cancelReason: 'Lluvia',
    });
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const authorization: AuthorizationMock = {
      getEffectivePermissions: vi.fn().mockResolvedValue(new Set(['activity:cancel'])),
    };
    const app = await loadApp({ service, prisma, authorization });

    const response = await request(app)
      .post('/api/v1/activities/activity-002/cancel')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ reason: '  Lluvia  ' })
      .expect(200);

    expect(service.cancelActivity).toHaveBeenCalledWith(
      'activity-002',
      'Lluvia',
      auditContext('user-001'),
    );
    expect(response.body).toEqual({
      success: true,
      message: 'Activity cancelled successfully.',
      data: { ...activityDetail, status: 'CANCELLED', cancelReason: 'Lluvia' },
    });
  });

  it('cancels an activity for an admin without a permission lookup and without a body', async () => {
    const service = buildServiceMock();
    service.cancelActivity.mockResolvedValue({
      ...activityDetail,
      status: 'CANCELLED',
      cancelReason: null,
    });
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const authorization: AuthorizationMock = {
      getEffectivePermissions: vi.fn().mockResolvedValue(new Set()),
    };
    const app = await loadApp({ service, prisma, authorization });

    await request(app)
      .post('/api/v1/activities/activity-002/cancel')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(200);

    expect(authorization.getEffectivePermissions).not.toHaveBeenCalled();
    expect(service.cancelActivity).toHaveBeenCalledWith(
      'activity-002',
      undefined,
      auditContext('admin-001'),
    );
  });

  it('rejects cancel bodies with unknown keys, a blank reason or an oversized reason', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp({ service, prisma });

    await request(app)
      .post('/api/v1/activities/activity-002/cancel')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ motive: 'Lluvia' })
      .expect(400);
    await request(app)
      .post('/api/v1/activities/activity-002/cancel')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: '   ' })
      .expect(400);
    await request(app)
      .post('/api/v1/activities/activity-002/cancel')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'x'.repeat(501) })
      .expect(400);

    expect(service.cancelActivity).not.toHaveBeenCalled();
  });

  it('rejects a blank activity id on cancel before the service', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp({ service, prisma });

    await request(app)
      .post('/api/v1/activities/%20/cancel')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(400);

    expect(service.cancelActivity).not.toHaveBeenCalled();
  });

  it('propagates the service 404 and 409 errors on cancel', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp({ service, prisma });
    const { ApiError } = await import('../../utils/ApiError.js');

    service.cancelActivity.mockRejectedValue(new ApiError(404, 'Activity not found.'));
    await request(app)
      .post('/api/v1/activities/missing/cancel')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(404);

    service.cancelActivity.mockRejectedValue(
      new ApiError(409, 'Completed activities cannot be cancelled.'),
    );
    const conflict = await request(app)
      .post('/api/v1/activities/activity-002/cancel')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(409);

    expect(conflict.body).toMatchObject({
      success: false,
      message: 'Completed activities cannot be cancelled.',
    });
  });
});

describe('activity delete route', () => {
  it('rejects delete requests without a token', async () => {
    const service = buildServiceMock();
    const app = await loadApp({ service });

    await request(app).delete('/api/v1/activities/activity-002').expect(401);
    expect(service.deleteActivity).not.toHaveBeenCalled();
  });

  it('rejects delete requests when the user lacks activity:delete', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const authorization: AuthorizationMock = {
      getEffectivePermissions: vi.fn().mockResolvedValue(new Set(['activity:update'])),
    };
    const app = await loadApp({ service, prisma, authorization });

    await request(app)
      .delete('/api/v1/activities/activity-002')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);

    expect(authorization.getEffectivePermissions).toHaveBeenCalledWith(userRecord, {
      activityId: 'activity-002',
    });
    expect(service.deleteActivity).not.toHaveBeenCalled();
  });

  it('deletes a DRAFT activity for a collaborator with activity:delete', async () => {
    const service = buildServiceMock();
    service.deleteActivity.mockResolvedValue(undefined);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const authorization: AuthorizationMock = {
      getEffectivePermissions: vi.fn().mockResolvedValue(new Set(['activity:delete'])),
    };
    const app = await loadApp({ service, prisma, authorization });

    const response = await request(app)
      .delete('/api/v1/activities/activity-002')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(204);

    expect(service.deleteActivity).toHaveBeenCalledWith('activity-002', auditContext('user-001'));
    expect(response.text).toBe('');
  });

  it('deletes a DRAFT activity for an admin without a permission lookup', async () => {
    const service = buildServiceMock();
    service.deleteActivity.mockResolvedValue(undefined);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const authorization: AuthorizationMock = {
      getEffectivePermissions: vi.fn().mockResolvedValue(new Set()),
    };
    const app = await loadApp({ service, prisma, authorization });

    await request(app)
      .delete('/api/v1/activities/activity-002')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    expect(authorization.getEffectivePermissions).not.toHaveBeenCalled();
    expect(service.deleteActivity).toHaveBeenCalledWith('activity-002', auditContext('admin-001'));
  });

  it('rejects a blank activity id on delete before the service', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp({ service, prisma });

    await request(app)
      .delete('/api/v1/activities/%20')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    expect(service.deleteActivity).not.toHaveBeenCalled();
  });

  it('propagates the service 404 and 409 retention errors on delete', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp({ service, prisma });
    const { ApiError } = await import('../../utils/ApiError.js');

    service.deleteActivity.mockRejectedValue(new ApiError(404, 'Activity not found.'));
    await request(app)
      .delete('/api/v1/activities/missing')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);

    service.deleteActivity.mockRejectedValue(
      new ApiError(409, 'Only DRAFT activities can be deleted.'),
    );
    const conflict = await request(app)
      .delete('/api/v1/activities/activity-002')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);

    expect(conflict.body).toMatchObject({
      success: false,
      message: 'Only DRAFT activities can be deleted.',
    });
  });
});
