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
  career: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  organizationalUnit: { findUnique: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
}

const createPrismaMock = (): PrismaMock => {
  const prisma: PrismaMock = {
    career: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    organizationalUnit: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  };

  prisma.$transaction.mockImplementation(
    async (callback: (client: PrismaMock) => Promise<unknown>) => callback(prisma),
  );

  return prisma;
};

const unitRecord = { id: 'unit-001', name: 'Facultad de Ingenieria Civil', code: 'FIC' };

const careerRecord = {
  id: 'car-001',
  name: 'Ingenieria Civil',
  code: 'FIC-CIV',
  description: 'Licenciatura',
  unit: unitRecord,
};

const otrosRecord = {
  id: 'car-otros',
  name: 'Otros',
  code: 'OTROS',
  description: null,
  unit: null,
};

const careerLookup = { id: 'car-001', code: 'FIC-CIV', unitId: 'unit-001' };

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

describe('careers routes', () => {
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

  it('lists careers publicly', async () => {
    const prisma = createPrismaMock();
    prisma.career.findMany.mockResolvedValue([careerRecord, otrosRecord]);
    prisma.career.count.mockResolvedValue(2);
    const app = await loadApp(prisma);

    const response = await request(app).get('/api/v1/careers').expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.items).toHaveLength(2);
    expect(response.body.data.items[1].unit).toBeNull();
    expect(prisma.career.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, skip: 0, take: 20 }),
    );
  });

  it('applies unit, search and pagination filters', async () => {
    const prisma = createPrismaMock();
    prisma.career.findMany.mockResolvedValue([]);
    prisma.career.count.mockResolvedValue(0);
    const app = await loadApp(prisma);

    await request(app).get('/api/v1/careers?unitId=unit-001&q=civil&page=2&limit=5').expect(200);

    expect(prisma.career.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { OR: [{ unitId: 'unit-001' }, { unitId: null }] },
            {
              OR: [
                { name: { contains: 'civil', mode: 'insensitive' } },
                { code: { contains: 'civil', mode: 'insensitive' } },
              ],
            },
          ],
        },
        skip: 5,
        take: 5,
      }),
    );
  });

  it('filters only global careers with the global sentinel', async () => {
    const prisma = createPrismaMock();
    prisma.career.findMany.mockResolvedValue([otrosRecord]);
    prisma.career.count.mockResolvedValue(1);
    const app = await loadApp(prisma);

    await request(app).get('/api/v1/careers?unitId=global').expect(200);

    expect(prisma.career.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { AND: [{ unitId: null }] } }),
    );
  });

  it('rejects invalid list filters before touching Prisma', async () => {
    const prisma = createPrismaMock();
    const app = await loadApp(prisma);

    const response = await request(app).get('/api/v1/careers?limit=51').expect(400);

    expect(response.body.message).toBe('Validation error.');
    expect(prisma.career.findMany).not.toHaveBeenCalled();
  });

  it('rejects creating a career without a token', async () => {
    const app = await loadApp(createPrismaMock());

    await request(app).post('/api/v1/careers').send({ name: 'Carrera', code: 'TMP-1' }).expect(401);
  });

  it('rejects creating a career as USER before touching Prisma', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    const response = await request(app)
      .post('/api/v1/careers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Carrera', code: 'TMP-1' })
      .expect(403);

    expect(response.body.message).toBe('Insufficient privileges for this resource.');
    expect(prisma.career.create).not.toHaveBeenCalled();
  });

  it('creates a career as ADMIN', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.organizationalUnit.findUnique.mockResolvedValue({
      id: 'unit-001',
      type: 'FACULTY',
      isActive: true,
    });
    prisma.career.findUnique.mockResolvedValue(null);
    prisma.career.create.mockResolvedValue(careerRecord);
    const app = await loadApp(prisma);

    const response = await request(app)
      .post('/api/v1/careers')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Ingenieria Civil', code: ' fic-civ ', unitId: 'unit-001' })
      .expect(201);

    expect(response.body.message).toBe('Career created successfully.');
    expect(response.body.data.unit).toEqual(unitRecord);
    expect(prisma.career.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          name: 'Ingenieria Civil',
          code: 'FIC-CIV',
          description: null,
          unitId: 'unit-001',
        },
      }),
    );
  });

  it('rejects a career outside a faculty', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.organizationalUnit.findUnique.mockResolvedValue({
      id: 'unit-sub',
      type: 'SUBDIRECTORATE',
      isActive: true,
    });
    const app = await loadApp(prisma);

    const response = await request(app)
      .post('/api/v1/careers')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Carrera', code: 'TMP-1', unitId: 'unit-sub' })
      .expect(400);

    expect(response.body.message).toBe('Careers can only belong to a faculty.');
    expect(prisma.career.create).not.toHaveBeenCalled();
  });

  it('rejects a career in an inactive unit', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.organizationalUnit.findUnique.mockResolvedValue({
      id: 'unit-001',
      type: 'FACULTY',
      isActive: false,
    });
    const app = await loadApp(prisma);

    const response = await request(app)
      .post('/api/v1/careers')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Carrera', code: 'TMP-1', unitId: 'unit-001' })
      .expect(400);

    expect(response.body.message).toBe('Organizational unit is inactive.');
  });

  it('rejects a duplicated career code with 409', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.career.findUnique.mockResolvedValue({ id: 'car-existing' });
    const app = await loadApp(prisma);

    const response = await request(app)
      .post('/api/v1/careers')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Ingenieria Civil', code: 'FIC-CIV' })
      .expect(409);

    expect(response.body.message).toBe('Career code already exists.');
    expect(prisma.career.create).not.toHaveBeenCalled();
  });

  it('updates a career as ADMIN', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.career.findUnique.mockResolvedValue(careerLookup);
    prisma.career.update.mockResolvedValue(careerRecord);
    const app = await loadApp(prisma);

    await request(app)
      .patch('/api/v1/careers/car-001')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Ingenieria Civil Renombrada' })
      .expect(200);

    expect(prisma.career.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'car-001' },
        data: { name: 'Ingenieria Civil Renombrada' },
      }),
    );
  });

  it('rejects renaming the Otros career', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.career.findUnique.mockResolvedValue({ id: 'car-otros', code: 'OTROS', unitId: null });
    const app = await loadApp(prisma);

    const response = await request(app)
      .patch('/api/v1/careers/car-otros')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ code: 'OTRO' })
      .expect(409);

    expect(response.body.message).toBe('The Otros career code cannot be changed.');
    expect(prisma.career.update).not.toHaveBeenCalled();
  });

  it('rejects changing the unit of a career with users', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.career.findUnique.mockResolvedValue(careerLookup);
    prisma.organizationalUnit.findUnique.mockResolvedValue({
      id: 'unit-002',
      type: 'FACULTY',
      isActive: true,
    });
    prisma.user.count.mockResolvedValue(4);
    const app = await loadApp(prisma);

    const response = await request(app)
      .patch('/api/v1/careers/car-001')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ unitId: 'unit-002' })
      .expect(409);

    expect(response.body.message).toBe('Cannot change the unit of a career with associated users.');
    expect(prisma.career.update).not.toHaveBeenCalled();
  });

  it('returns 404 for updating an unknown career', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.career.findUnique.mockResolvedValue(null);
    const app = await loadApp(prisma);

    const response = await request(app)
      .patch('/api/v1/careers/car-missing')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Nueva' })
      .expect(404);

    expect(response.body.message).toBe('Career not found.');
  });

  it('rejects an empty update body', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    await request(app)
      .patch('/api/v1/careers/car-001')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({})
      .expect(400);

    expect(prisma.career.findUnique).not.toHaveBeenCalled();
  });

  it('rejects deleting a career without a token or as USER', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    await request(app).delete('/api/v1/careers/car-001').expect(401);
    await request(app)
      .delete('/api/v1/careers/car-001')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);

    expect(prisma.career.delete).not.toHaveBeenCalled();
  });

  it('deletes a career without users with 204', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.career.findUnique.mockResolvedValue({ id: 'car-001', code: 'FIC-CIV' });
    prisma.user.count.mockResolvedValue(0);
    prisma.career.delete.mockResolvedValue({ id: 'car-001' });
    const app = await loadApp(prisma);

    const response = await request(app)
      .delete('/api/v1/careers/car-001')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(204);

    expect(response.body).toEqual({});
    expect(prisma.career.delete).toHaveBeenCalledWith({ where: { id: 'car-001' } });
  });

  it('rejects deleting a career with users', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.career.findUnique.mockResolvedValue({ id: 'car-001', code: 'FIC-CIV' });
    prisma.user.count.mockResolvedValue(1);
    const app = await loadApp(prisma);

    const response = await request(app)
      .delete('/api/v1/careers/car-001')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(409);

    expect(response.body.message).toBe('Career has associated users.');
    expect(prisma.career.delete).not.toHaveBeenCalled();
  });

  it('protects the Otros career from deletion', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.career.findUnique.mockResolvedValue({ id: 'car-otros', code: 'OTROS' });
    const app = await loadApp(prisma);

    const response = await request(app)
      .delete('/api/v1/careers/car-otros')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(409);

    expect(response.body.message).toBe('The global Otros career cannot be deleted.');
  });

  it('returns 404 for deleting an unknown career', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.career.findUnique.mockResolvedValue(null);
    const app = await loadApp(prisma);

    await request(app)
      .delete('/api/v1/careers/car-missing')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(404);
  });
});
