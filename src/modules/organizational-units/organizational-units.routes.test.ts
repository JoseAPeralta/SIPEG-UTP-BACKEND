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
  organizationalUnit: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  eventProgram: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  activity: { count: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
}

const createPrismaMock = (): PrismaMock => {
  const prisma: PrismaMock = {
    user: { findUnique: vi.fn() },
    organizationalUnit: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    eventProgram: { create: vi.fn(), update: vi.fn() },
    activity: { count: vi.fn() },
    $transaction: vi.fn(),
  };

  prisma.$transaction.mockImplementation(
    async (callback: (client: PrismaMock) => Promise<unknown>) => callback(prisma),
  );

  return prisma;
};

const headRecord = { id: 'user-head', firstName: 'Ana', lastName: 'Gomez' };

const unitDetailRecord = {
  id: 'unit-001',
  name: 'Facultad de Ingenieria Civil',
  code: 'FIC',
  description: 'Facultad',
  type: 'FACULTY',
  isActive: true,
  head: headRecord,
  careers: [{ id: 'car-001', name: 'Ingenieria Civil', code: 'FIC-CIV' }],
  eventPrograms: [
    {
      id: 'program-001',
      name: 'Programa de Eventos - Facultad de Ingenieria Civil',
      status: 'ACTIVE',
    },
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
    if (args.where.id === 'user-head') {
      return Promise.resolve({ id: 'user-head', isActive: true });
    }
    if (args.where.id === 'user-inactive') {
      return Promise.resolve({ id: 'user-inactive', isActive: false });
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

describe('organizational units routes', () => {
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

  it('lists active units publicly', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findMany.mockResolvedValue([unitDetailRecord]);
    prisma.organizationalUnit.count.mockResolvedValue(1);
    const app = await loadApp(prisma);

    const response = await request(app).get('/api/v1/organizational-units').expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.items).toHaveLength(1);
    expect(prisma.organizationalUnit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });

  it('applies list filters and pagination', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findMany.mockResolvedValue([]);
    prisma.organizationalUnit.count.mockResolvedValue(0);
    const app = await loadApp(prisma);

    await request(app)
      .get('/api/v1/organizational-units?type=FACULTY&isActive=false&page=2&limit=5')
      .expect(200);

    expect(prisma.organizationalUnit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: false, type: 'FACULTY' },
        skip: 5,
        take: 5,
      }),
    );
  });

  it('rejects invalid list filters before touching Prisma', async () => {
    const prisma = createPrismaMock();
    const app = await loadApp(prisma);

    const response = await request(app).get('/api/v1/organizational-units?type=CENTER').expect(400);

    expect(response.body.message).toBe('Validation error.');
    expect(prisma.organizationalUnit.findMany).not.toHaveBeenCalled();
  });

  it('returns a public detail with careers and default program', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue(unitDetailRecord);
    const app = await loadApp(prisma);

    const response = await request(app).get('/api/v1/organizational-units/unit-001').expect(200);

    expect(response.body.data.careers).toEqual([
      { id: 'car-001', name: 'Ingenieria Civil', code: 'FIC-CIV' },
    ]);
    expect(response.body.data.defaultProgram).toEqual({
      id: 'program-001',
      name: 'Programa de Eventos - Facultad de Ingenieria Civil',
      status: 'ACTIVE',
    });
  });

  it('returns 404 for an unknown unit', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue(null);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get('/api/v1/organizational-units/unit-missing')
      .expect(404);

    expect(response.body.message).toBe('Organizational unit not found.');
  });

  it('rejects creating a unit without a token', async () => {
    const app = await loadApp(createPrismaMock());

    await request(app)
      .post('/api/v1/organizational-units')
      .send({ name: 'Unidad', code: 'TMP-1', type: 'FACULTY' })
      .expect(401);
  });

  it('rejects creating a unit as USER before touching Prisma', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    const response = await request(app)
      .post('/api/v1/organizational-units')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Unidad', code: 'TMP-1', type: 'FACULTY' })
      .expect(403);

    expect(response.body.message).toBe('Insufficient privileges for this resource.');
    expect(prisma.organizationalUnit.create).not.toHaveBeenCalled();
  });

  it('creates the unit and its default program as ADMIN', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.organizationalUnit.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(unitDetailRecord);
    prisma.organizationalUnit.create.mockResolvedValue({ id: 'unit-001' });
    prisma.eventProgram.create.mockResolvedValue({ id: 'program-001' });
    const app = await loadApp(prisma);

    const response = await request(app)
      .post('/api/v1/organizational-units')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        name: 'Facultad de Ingenieria Civil',
        code: 'fic',
        type: 'FACULTY',
        headId: 'user-head',
      })
      .expect(201);

    expect(response.body.message).toBe('Organizational unit created successfully.');
    expect(prisma.organizationalUnit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ code: 'FIC', headId: 'user-head', isActive: true }),
      }),
    );
    expect(prisma.eventProgram.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isDefault: true, status: 'ACTIVE' }),
      }),
    );
  });

  it('rejects a duplicated unit code with 409', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-001' });
    const app = await loadApp(prisma);

    const response = await request(app)
      .post('/api/v1/organizational-units')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Facultad', code: 'FIC', type: 'FACULTY' })
      .expect(409);

    expect(response.body.message).toBe('Organizational unit code already exists.');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an unknown or inactive head user', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    await request(app)
      .post('/api/v1/organizational-units')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Unidad', code: 'TMP-1', type: 'FACULTY', headId: 'user-missing' })
      .expect(404);

    const response = await request(app)
      .post('/api/v1/organizational-units')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Unidad', code: 'TMP-1', type: 'FACULTY', headId: 'user-inactive' })
      .expect(400);

    expect(response.body.message).toBe('Head user is inactive.');
  });

  it('updates the editable fields as ADMIN', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-001' });
    prisma.organizationalUnit.update.mockResolvedValue(unitDetailRecord);
    const app = await loadApp(prisma);

    await request(app)
      .patch('/api/v1/organizational-units/unit-001')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Facultad Renombrada', headId: 'user-head' })
      .expect(200);

    expect(prisma.organizationalUnit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'unit-001' },
        data: { name: 'Facultad Renombrada', headId: 'user-head' },
      }),
    );
  });

  it('rejects immutable fields on update', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    await request(app)
      .patch('/api/v1/organizational-units/unit-001')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ code: 'NEW' })
      .expect(400);
    await request(app)
      .patch('/api/v1/organizational-units/unit-001')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ type: 'SUBDIRECTORATE' })
      .expect(400);
    await request(app)
      .patch('/api/v1/organizational-units/unit-001')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ isActive: false })
      .expect(400);

    expect(prisma.organizationalUnit.update).not.toHaveBeenCalled();
  });

  it('rejects updating a missing unit', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.organizationalUnit.findUnique.mockResolvedValue(null);
    const app = await loadApp(prisma);

    await request(app)
      .patch('/api/v1/organizational-units/unit-missing')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Nueva' })
      .expect(404);
  });

  it('deactivates a unit and archives its default program in order', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.organizationalUnit.findUnique
      .mockResolvedValueOnce({
        id: 'unit-001',
        isActive: true,
        eventPrograms: [{ id: 'program-001' }],
      })
      .mockResolvedValueOnce({
        ...unitDetailRecord,
        isActive: false,
        eventPrograms: [{ ...unitDetailRecord.eventPrograms[0], status: 'ARCHIVED' }],
      });
    prisma.activity.count.mockResolvedValue(0);
    const app = await loadApp(prisma);

    const response = await request(app)
      .post('/api/v1/organizational-units/unit-001/deactivate')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);

    expect(response.body.message).toBe('Organizational unit deactivated successfully.');
    expect(response.body.data.isActive).toBe(false);
    expect(response.body.data.defaultProgram.status).toBe('ARCHIVED');
    expect(prisma.organizationalUnit.update.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.eventProgram.update.mock.invocationCallOrder[0] as number,
    );
  });

  it('rejects deactivation with scheduled or ongoing activities', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.organizationalUnit.findUnique.mockResolvedValue({
      id: 'unit-001',
      isActive: true,
      eventPrograms: [{ id: 'program-001' }],
    });
    prisma.activity.count.mockResolvedValue(1);
    const app = await loadApp(prisma);

    await request(app)
      .post('/api/v1/organizational-units/unit-001/deactivate')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(409);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects deactivating an already inactive unit', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.organizationalUnit.findUnique.mockResolvedValue({
      id: 'unit-001',
      isActive: false,
      eventPrograms: [{ id: 'program-001' }],
    });
    const app = await loadApp(prisma);

    await request(app)
      .post('/api/v1/organizational-units/unit-001/deactivate')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(409);
  });

  it('reactivates a unit as ADMIN', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.organizationalUnit.findUnique
      .mockResolvedValueOnce({
        id: 'unit-001',
        isActive: false,
        eventPrograms: [{ id: 'program-001' }],
      })
      .mockResolvedValueOnce(unitDetailRecord);
    const app = await loadApp(prisma);

    const response = await request(app)
      .post('/api/v1/organizational-units/unit-001/reactivate')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);

    expect(response.body.message).toBe('Organizational unit reactivated successfully.');
    expect(response.body.data.defaultProgram.status).toBe('ACTIVE');
    expect(prisma.eventProgram.update).not.toHaveBeenCalled();
  });

  it('rejects unit management as USER', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    await request(app)
      .patch('/api/v1/organizational-units/unit-001')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Nueva' })
      .expect(403);
    await request(app)
      .post('/api/v1/organizational-units/unit-001/deactivate')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    await request(app)
      .post('/api/v1/organizational-units/unit-001/reactivate')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);

    expect(prisma.organizationalUnit.update).not.toHaveBeenCalled();
  });

  it('returns 404 for deactivate and reactivate on unknown units', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.organizationalUnit.findUnique.mockResolvedValue(null);
    const app = await loadApp(prisma);

    await request(app)
      .post('/api/v1/organizational-units/unit-missing/deactivate')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(404);
    await request(app)
      .post('/api/v1/organizational-units/unit-missing/reactivate')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(404);
  });
});
