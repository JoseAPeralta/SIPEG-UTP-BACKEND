import request from 'supertest';
import {
  calculateJwkThumbprint,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
} from 'jose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

interface PrismaMock {
  user: { findUnique: ReturnType<typeof vi.fn> };
  classroom: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  classroomAmenity: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  classroomAvailability: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  activity: { findMany: ReturnType<typeof vi.fn> };
}

const createPrismaMock = (): PrismaMock => ({
  user: { findUnique: vi.fn() },
  classroom: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  classroomAmenity: {
    findFirst: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
  classroomAvailability: {
    findFirst: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
  activity: { findMany: vi.fn() },
});

const classroomDetailRecord = {
  id: 'classroom-001',
  name: 'Aula 101',
  type: 'CLASSROOM',
  capacity: 40,
  building: 'Edificio 1',
  floor: 1,
  isActive: true,
  amenities: [{ amenity: 'Proyector' }],
  availability: [
    {
      id: 'slot-1',
      dayOfWeek: 1,
      startTime: new Date('1970-01-01T07:00:00.000Z'),
      endTime: new Date('1970-01-01T12:00:00.000Z'),
      period: 'Matutino',
    },
  ],
};

const expectedDetail = {
  id: 'classroom-001',
  name: 'Aula 101',
  type: 'CLASSROOM',
  capacity: 40,
  building: 'Edificio 1',
  floor: 1,
  isActive: true,
  amenities: ['Proyector'],
  availability: [
    { id: 'slot-1', dayOfWeek: 1, startTime: '07:00', endTime: '12:00', period: 'Matutino' },
  ],
};

const adminAuthUserRecord = {
  id: 'user-admin',
  email: 'admin@utp.ac.pa',
  globalRole: 'ADMIN',
  unitId: null,
  careerId: null,
  isActive: true,
};

const regularAuthUserRecord = {
  id: 'user-001',
  email: 'user@utp.ac.pa',
  globalRole: 'USER',
  unitId: null,
  careerId: null,
  isActive: true,
};

const authUserRecords: Record<string, unknown> = {
  'user-admin': adminAuthUserRecord,
  'user-001': regularAuthUserRecord,
};

interface UserLookupArgs {
  where: { id: string };
  select?: Record<string, unknown>;
}

const mockUserLookup = (prisma: PrismaMock): void => {
  prisma.user.findUnique.mockImplementation((args: UserLookupArgs) => {
    const select = args.select ?? {};

    if ('email' in select) {
      return Promise.resolve(authUserRecords[args.where.id] ?? null);
    }

    return Promise.resolve(null);
  });
};

let accessToken: string;
let adminAccessToken: string;
let jwks: { keys: unknown[] };

const loadApp = async (prisma: PrismaMock) => {
  process.env['NODE_ENV'] = 'test';
  process.env['AUTH_SECRET'] = 'a'.repeat(32);
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
  process.env['AUTH_URL'] = 'http://localhost:3000';
  vi.resetModules();
  vi.doMock('../../config/prisma.js', () => ({ getPrismaClient: () => prisma }));
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
  const { app } = await import('../../app.js');
  return app;
};

describe('classroom routes', () => {
  let privateKey: CryptoKey;
  let kid: string;

  beforeAll(async () => {
    const keyPair = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    privateKey = keyPair.privateKey;
    const publicJwk = await exportJWK(keyPair.publicKey);
    kid = await calculateJwkThumbprint(publicJwk);
    publicJwk.kid = kid;
    publicJwk.alg = 'EdDSA';
    jwks = { keys: [publicJwk] };

    accessToken = await new SignJWT({ role: 'USER', isActive: true })
      .setProtectedHeader({ alg: 'EdDSA', kid, typ: 'JWT' })
      .setIssuer('http://localhost:3000')
      .setAudience('http://localhost:3000')
      .setSubject('user-001')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey);

    adminAccessToken = await new SignJWT({ role: 'ADMIN', isActive: true })
      .setProtectedHeader({ alg: 'EdDSA', kid, typ: 'JWT' })
      .setIssuer('http://localhost:3000')
      .setAudience('http://localhost:3000')
      .setSubject('user-admin')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey);
  });

  afterAll(() => {
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../../utils/jwt-verifier.js');
    vi.doUnmock('../../lib/auth.js');
  });

  it('lists active classrooms publicly', async () => {
    const prisma = createPrismaMock();
    prisma.classroom.findMany.mockResolvedValue([classroomDetailRecord]);
    prisma.classroom.count.mockResolvedValue(1);
    const app = await loadApp(prisma);

    const response = await request(app).get('/api/v1/classrooms').expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.items[0]).toMatchObject({ id: 'classroom-001' });
    expect(prisma.classroom.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });

  it('applies classroom list filters and pagination', async () => {
    const prisma = createPrismaMock();
    prisma.classroom.findMany.mockResolvedValue([]);
    prisma.classroom.count.mockResolvedValue(0);
    const app = await loadApp(prisma);

    await request(app)
      .get(
        '/api/v1/classrooms?type=LABORATORY&minCapacity=25&amenity=Proyector&isActive=false&page=2&limit=5',
      )
      .expect(200);

    expect(prisma.classroom.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: false,
          type: 'LABORATORY',
          capacity: { gte: 25 },
          amenities: { some: { amenity: { equals: 'Proyector', mode: 'insensitive' } } },
        },
        skip: 5,
        take: 5,
      }),
    );
  });

  it('rejects invalid classroom list filters before touching Prisma', async () => {
    const prisma = createPrismaMock();
    const app = await loadApp(prisma);

    await request(app).get('/api/v1/classrooms?limit=51').expect(400);
    await request(app).get('/api/v1/classrooms?type=CENTER').expect(400);

    expect(prisma.classroom.findMany).not.toHaveBeenCalled();
  });

  it('routes the availability search before the classroom detail', async () => {
    const prisma = createPrismaMock();
    prisma.classroom.findMany.mockResolvedValue([classroomDetailRecord]);
    prisma.activity.findMany.mockResolvedValue([]);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get('/api/v1/classrooms/available?date=2026-09-21&startTime=08:00&endTime=10:00')
      .expect(200);

    expect(response.body.message).toBe('Available classrooms retrieved successfully.');
    expect(prisma.classroom.findUnique).not.toHaveBeenCalled();
    expect(prisma.classroom.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          availability: {
            some: {
              dayOfWeek: 1,
              startTime: { lte: new Date('1970-01-01T08:00:00.000Z') },
              endTime: { gte: new Date('1970-01-01T10:00:00.000Z') },
            },
          },
        }),
      }),
    );
  });

  it('validates the availability search query', async () => {
    const prisma = createPrismaMock();
    const app = await loadApp(prisma);

    await request(app).get('/api/v1/classrooms/available').expect(400);
    await request(app)
      .get('/api/v1/classrooms/available?date=2026-02-30&startTime=08:00&endTime=10:00')
      .expect(400);
    await request(app)
      .get('/api/v1/classrooms/available?date=2026-09-21&startTime=10:00&endTime=10:00')
      .expect(400);

    expect(prisma.classroom.findMany).not.toHaveBeenCalled();
  });

  it('returns a public classroom detail', async () => {
    const prisma = createPrismaMock();
    prisma.classroom.findUnique.mockResolvedValue(classroomDetailRecord);
    const app = await loadApp(prisma);

    const response = await request(app).get('/api/v1/classrooms/classroom-001').expect(200);

    expect(response.body.data).toEqual(expectedDetail);
  });

  it('returns 404 for an unknown classroom', async () => {
    const prisma = createPrismaMock();
    prisma.classroom.findUnique.mockResolvedValue(null);
    const app = await loadApp(prisma);

    const response = await request(app).get('/api/v1/classrooms/classroom-missing').expect(404);

    expect(response.body.message).toBe('Classroom not found.');
  });

  it('rejects creating a classroom without a token', async () => {
    const app = await loadApp(createPrismaMock());

    await request(app)
      .post('/api/v1/classrooms')
      .send({ name: 'Aula 303', type: 'CLASSROOM', capacity: 30 })
      .expect(401);
  });

  it('rejects creating a classroom as USER before touching Prisma', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    const response = await request(app)
      .post('/api/v1/classrooms')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Aula 303', type: 'CLASSROOM', capacity: 30 })
      .expect(403);

    expect(response.body.message).toBe('Insufficient privileges for this resource.');
    expect(prisma.classroom.create).not.toHaveBeenCalled();
  });

  it('creates a classroom as ADMIN', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.classroom.create.mockResolvedValue(classroomDetailRecord);
    const app = await loadApp(prisma);

    const response = await request(app)
      .post('/api/v1/classrooms')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Aula 101', type: 'CLASSROOM', capacity: 40, building: 'Edificio 1', floor: 1 })
      .expect(201);

    expect(response.body.message).toBe('Classroom created successfully.');
    expect(prisma.classroom.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Aula 101', isActive: true }),
      }),
    );
  });

  it('rejects an invalid classroom body before touching Prisma', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    await request(app)
      .post('/api/v1/classrooms')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Aula 303', type: 'CLASSROOM', capacity: 0 })
      .expect(400);

    expect(prisma.classroom.create).not.toHaveBeenCalled();
  });

  it('updates a classroom as ADMIN and returns 404 for unknown ids', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.classroom.findUnique
      .mockResolvedValueOnce({ id: 'classroom-001' })
      .mockResolvedValueOnce({ id: 'classroom-001' });
    prisma.classroom.update.mockResolvedValue(classroomDetailRecord);
    const app = await loadApp(prisma);

    await request(app)
      .patch('/api/v1/classrooms/classroom-001')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ capacity: 45 })
      .expect(200);

    expect(prisma.classroom.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'classroom-001' }, data: { capacity: 45 } }),
    );

    prisma.classroom.findUnique.mockReset();
    prisma.classroom.findUnique.mockResolvedValue(null);

    await request(app)
      .patch('/api/v1/classrooms/classroom-missing')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ capacity: 45 })
      .expect(404);
  });

  it('rejects an empty classroom update body', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    await request(app)
      .patch('/api/v1/classrooms/classroom-001')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({})
      .expect(400);
  });

  it('adds and removes classroom amenities as ADMIN', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.classroom.findUnique
      .mockResolvedValueOnce({ id: 'classroom-001' })
      .mockResolvedValueOnce(classroomDetailRecord)
      .mockResolvedValueOnce({ id: 'classroom-001' })
      .mockResolvedValueOnce(classroomDetailRecord);
    prisma.classroomAmenity.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ amenity: 'Proyector' });
    prisma.classroomAmenity.create.mockResolvedValue({ classroomId: 'classroom-001' });
    prisma.classroomAmenity.delete.mockResolvedValue({ classroomId: 'classroom-001' });
    const app = await loadApp(prisma);

    const created = await request(app)
      .post('/api/v1/classrooms/classroom-001/amenities')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ amenity: 'Proyector' })
      .expect(201);

    expect(created.body.message).toBe('Classroom amenity added successfully.');

    const removed = await request(app)
      .delete('/api/v1/classrooms/classroom-001/amenities/proyector')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);

    expect(removed.body.message).toBe('Classroom amenity removed successfully.');
    expect(prisma.classroomAmenity.delete).toHaveBeenCalledWith({
      where: { classroomId_amenity: { classroomId: 'classroom-001', amenity: 'Proyector' } },
    });
  });

  it('rejects a duplicate classroom amenity with 409', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.classroom.findUnique.mockResolvedValue({ id: 'classroom-001' });
    prisma.classroomAmenity.findFirst.mockResolvedValue({ amenity: 'Proyector' });
    const app = await loadApp(prisma);

    await request(app)
      .post('/api/v1/classrooms/classroom-001/amenities')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ amenity: 'proyector' })
      .expect(409);
  });

  it('adds and removes classroom availability as ADMIN', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.classroom.findUnique
      .mockResolvedValueOnce({ id: 'classroom-001' })
      .mockResolvedValueOnce(classroomDetailRecord)
      .mockResolvedValueOnce({ id: 'classroom-001' })
      .mockResolvedValueOnce(classroomDetailRecord);
    prisma.classroomAvailability.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'slot-1' });
    prisma.classroomAvailability.create.mockResolvedValue({ id: 'slot-2' });
    prisma.classroomAvailability.delete.mockResolvedValue({ id: 'slot-1' });
    const app = await loadApp(prisma);

    await request(app)
      .post('/api/v1/classrooms/classroom-001/availability')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ dayOfWeek: 1, startTime: '12:00', endTime: '17:00', period: 'Vespertino' })
      .expect(201);

    expect(prisma.classroomAvailability.create).toHaveBeenCalledWith({
      data: {
        classroomId: 'classroom-001',
        dayOfWeek: 1,
        startTime: new Date('1970-01-01T12:00:00.000Z'),
        endTime: new Date('1970-01-01T17:00:00.000Z'),
        period: 'Vespertino',
      },
    });

    await request(app)
      .delete('/api/v1/classrooms/classroom-001/availability/slot-1')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);

    expect(prisma.classroomAvailability.delete).toHaveBeenCalledWith({ where: { id: 'slot-1' } });
  });

  it('rejects an overlapping classroom window with 409', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.classroom.findUnique.mockResolvedValue({ id: 'classroom-001' });
    prisma.classroomAvailability.findFirst.mockResolvedValue({ id: 'slot-1' });
    const app = await loadApp(prisma);

    const response = await request(app)
      .post('/api/v1/classrooms/classroom-001/availability')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ dayOfWeek: 1, startTime: '09:00', endTime: '11:00' })
      .expect(409);

    expect(response.body.message).toBe('Classroom availability overlaps an existing window.');
  });

  it('rejects classroom management as USER before touching Prisma', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    await request(app)
      .patch('/api/v1/classrooms/classroom-001')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ capacity: 45 })
      .expect(403);

    await request(app)
      .post('/api/v1/classrooms/classroom-001/amenities')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ amenity: 'Proyector' })
      .expect(403);

    expect(prisma.classroom.update).not.toHaveBeenCalled();
    expect(prisma.classroomAmenity.create).not.toHaveBeenCalled();
  });
});
