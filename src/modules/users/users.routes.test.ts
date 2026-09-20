import request from 'supertest';
import {
  calculateJwkThumbprint,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
} from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

interface PrismaMock {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  organizationalUnit: { findUnique: ReturnType<typeof vi.fn> };
  career: { findUnique: ReturnType<typeof vi.fn> };
  account: { create: ReturnType<typeof vi.fn> };
  session: { deleteMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
}

const authApiMock = {
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
  getToken: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
  verifyEmail: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  sendVerificationEmail: vi.fn(),
};

const createPrismaMock = (): PrismaMock => {
  const prisma: PrismaMock = {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    organizationalUnit: { findUnique: vi.fn() },
    career: { findUnique: vi.fn() },
    account: { create: vi.fn() },
    session: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (callback: (client: PrismaMock) => Promise<unknown>) => callback(prisma),
  );
  return prisma;
};

let accessToken: string;
let otherAccessToken: string;
let adminAccessToken: string;
let jwks: { keys: unknown[] };

const profileRecord = {
  id: 'user-001',
  firstName: 'Juan',
  lastName: 'Perez',
  identificationNumber: '8-123-4567',
  email: 'juan.perez@example.com',
  globalRole: 'USER',
  unit: { id: 'unit-001', name: 'Ingenieria', code: 'FIS' },
  career: { id: 'car-001', name: 'Sistemas', code: 'SIS' },
};

const authUserRecord = {
  id: 'user-001',
  email: 'juan.perez@example.com',
  globalRole: 'USER',
  unitId: null,
  careerId: null,
  isActive: true,
};

const otherAuthUserRecord = {
  id: 'user-002',
  email: 'maria.lopez@example.com',
  globalRole: 'USER',
  unitId: null,
  careerId: null,
  isActive: true,
};

const adminAuthUserRecord = {
  id: 'user-admin',
  email: 'admin@utp.ac.pa',
  globalRole: 'ADMIN',
  unitId: null,
  careerId: null,
  isActive: true,
};

const otherProfileRecord = {
  id: 'user-002',
  firstName: 'Maria',
  lastName: 'Lopez',
  identificationNumber: '8-765-4321',
  email: 'maria.lopez@example.com',
  globalRole: 'USER',
  unit: null,
  career: null,
};

const adminUserRecord = {
  id: 'user-001',
  firstName: 'Juan',
  lastName: 'Perez',
  identificationNumber: '8-123-4567',
  email: 'juan.perez@example.com',
  globalRole: 'USER',
  isActive: true,
  unit: { id: 'unit-001', name: 'Ingenieria', code: 'FIS' },
  career: { id: 'car-001', name: 'Sistemas', code: 'SIS' },
};

const targetUserRecord = {
  id: 'user-target',
  firstName: 'Ana',
  lastName: 'Gomez',
  identificationNumber: '8-555-1234',
  email: 'ana.gomez@example.com',
  globalRole: 'USER',
  isActive: false,
  unit: { id: 'unit-002', name: 'Ciencias', code: 'FCC' },
  career: null,
};

const ownerRecord = {
  id: 'user-001',
  unitId: 'unit-001',
  careerId: 'car-001',
  career: { unitId: 'unit-001' },
};

const otherOwnerRecord = {
  id: 'user-002',
  unitId: null,
  careerId: null,
  career: null,
};

const authUserRecords: Record<string, unknown> = {
  'user-001': authUserRecord,
  'user-002': otherAuthUserRecord,
  'user-admin': adminAuthUserRecord,
};

const ownerRecords: Record<string, unknown> = {
  'user-001': ownerRecord,
  'user-002': otherOwnerRecord,
};

const profileRecords: Record<string, unknown> = {
  'user-001': profileRecord,
  'user-002': otherProfileRecord,
};

interface UserLookupArgs {
  where: { id: string };
  select?: Record<string, unknown>;
}

const mockUserLookup = (prisma: PrismaMock): void => {
  prisma.user.findUnique.mockImplementation((args: UserLookupArgs) => {
    const select = args.select ?? {};

    if (args.where.id === 'user-target') {
      return Promise.resolve(targetUserRecord);
    }

    if ('isActive' in select) {
      return Promise.resolve(authUserRecords[args.where.id] ?? null);
    }

    if ('unitId' in select && 'careerId' in select) {
      return Promise.resolve(ownerRecords[args.where.id] ?? null);
    }

    return Promise.resolve(profileRecords[args.where.id] ?? null);
  });
};

const editableUserSnapshot = {
  id: 'user-target',
  globalRole: 'USER',
  isActive: true,
  unitId: 'unit-002',
  career: null,
};

const adminTargetSnapshot = {
  id: 'user-admin-target',
  globalRole: 'ADMIN',
  isActive: true,
  unitId: null,
  career: null,
};

const mockAdminUpdate = (
  prisma: PrismaMock,
  snapshot: Record<string, unknown> = editableUserSnapshot,
  updated: Record<string, unknown> = { ...targetUserRecord, isActive: true },
): void => {
  prisma.user.findUnique.mockImplementation((args: UserLookupArgs) => {
    if (args.where.id === 'user-admin-target') {
      return Promise.resolve(adminTargetSnapshot);
    }

    if (
      args.select &&
      'career' in args.select &&
      'globalRole' in args.select &&
      'firstName' in args.select
    ) {
      return Promise.resolve(targetUserRecord);
    }

    if (args.select && 'career' in args.select && 'globalRole' in args.select) {
      return Promise.resolve(args.where.id === snapshot['id'] ? snapshot : null);
    }

    return Promise.resolve(authUserRecords[args.where.id] ?? null);
  });
  prisma.user.update.mockResolvedValue(updated);
  prisma.user.count.mockResolvedValue(1);
  prisma.session.deleteMany.mockResolvedValue({ count: 1 });
};

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
  vi.doMock('../../lib/auth.js', () => ({ auth: { api: authApiMock } }));
  const { app } = await import('../../app.js');
  return app;
};

describe('users routes', () => {
  let privateKey: CryptoKey;

  beforeAll(async () => {
    const kp = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    privateKey = kp.privateKey;
    const publicJwk = await exportJWK(kp.publicKey);
    const kid = await calculateJwkThumbprint(publicJwk);
    publicJwk.kid = kid;
    publicJwk.alg = 'EdDSA';
    jwks = { keys: [publicJwk] };

    accessToken = await new SignJWT({
      email: 'juan.perez@example.com',
      role: 'USER',
      unitId: null,
      careerId: null,
      isActive: true,
    })
      .setProtectedHeader({ alg: 'EdDSA', kid, typ: 'JWT' })
      .setIssuer('http://localhost:3000')
      .setAudience('http://localhost:3000')
      .setSubject('user-001')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey);

    otherAccessToken = await new SignJWT({
      email: 'maria.lopez@example.com',
      role: 'USER',
      unitId: null,
      careerId: null,
      isActive: true,
    })
      .setProtectedHeader({ alg: 'EdDSA', kid, typ: 'JWT' })
      .setIssuer('http://localhost:3000')
      .setAudience('http://localhost:3000')
      .setSubject('user-002')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey);

    adminAccessToken = await new SignJWT({
      email: 'admin@utp.ac.pa',
      role: 'ADMIN',
      unitId: null,
      careerId: null,
      isActive: true,
    })
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

  it('rejects profile requests without a token', async () => {
    const app = await loadApp(createPrismaMock());
    await request(app).get('/api/v1/users/me').expect(401);
    await request(app).patch('/api/v1/users/me').send({ firstName: 'Juana' }).expect(401);
  });

  it('returns the authenticated user profile', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockImplementation((args: { select?: Record<string, unknown> }) => {
      if (args.select && 'unit' in args.select) return Promise.resolve(profileRecord);
      return Promise.resolve(authUserRecord);
    });
    const app = await loadApp(prisma);
    const response = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(response.body.data).not.toHaveProperty('passwordHash');
    expect(response.body.data.email).toBe('juan.perez@example.com');
  });

  it('updates the authenticated user profile', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockImplementation((args: { select?: Record<string, unknown> }) => {
      if (args.select && 'globalRole' in args.select) {
        return Promise.resolve(authUserRecord);
      }
      return Promise.resolve({
        id: 'user-001',
        unitId: 'unit-001',
        careerId: 'car-001',
        career: { unitId: 'unit-001' },
      });
    });
    prisma.user.update.mockResolvedValue({ ...profileRecord, firstName: 'Juana' });
    const app = await loadApp(prisma);
    const response = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'Juana' })
      .expect(200);
    expect(response.body.data.firstName).toBe('Juana');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-001' }, data: { firstName: 'Juana' } }),
    );
  });

  it('returns only the authenticated user profile for each token', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    const first = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const second = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${otherAccessToken}`)
      .expect(200);

    expect(first.body.data.id).toBe('user-001');
    expect(first.body.data.email).toBe('juan.perez@example.com');
    expect(second.body.data.id).toBe('user-002');
    expect(second.body.data.email).toBe('maria.lopez@example.com');
    expect(JSON.stringify(first.body)).not.toContain('maria.lopez@example.com');
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-001' } }),
    );
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-002' } }),
    );
  });

  it('updates only the authenticated user profile', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.user.update.mockResolvedValue({ ...otherProfileRecord, firstName: 'Mariana' });
    const app = await loadApp(prisma);

    const response = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${otherAccessToken}`)
      .send({ firstName: 'Mariana', id: 'user-001' })
      .expect(200);

    expect(response.body.data.id).toBe('user-002');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-002' }, data: { firstName: 'Mariana' } }),
    );
  });

  it('does not expose internal or credential fields', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.user.update.mockResolvedValue({ ...profileRecord, firstName: 'Juana' });
    const app = await loadApp(prisma);

    const getResponse = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const patchResponse = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'Juana' })
      .expect(200);

    for (const response of [getResponse, patchResponse]) {
      expect(response.body.data).not.toHaveProperty('name');
      expect(response.body.data).not.toHaveProperty('accounts');
      expect(response.body.data).not.toHaveProperty('password');
      expect(response.body.data).not.toHaveProperty('passwordHash');
      expect(response.body.data).not.toHaveProperty('emailVerified');
      expect(JSON.stringify(response.body)).not.toContain('$argon2');
    }
  });

  it('ignores extra fields and keeps only allowed profile fields', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.user.update.mockResolvedValue({ ...profileRecord, firstName: 'Juana' });
    const app = await loadApp(prisma);

    await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Juana',
        globalRole: 'ADMIN',
        isActive: false,
        email: 'attacker@example.com',
        id: 'user-002',
      })
      .expect(200);

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-001' }, data: { firstName: 'Juana' } }),
    );
  });

  it('rejects a body with only unknown fields', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    const response = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ globalRole: 'ADMIN' })
      .expect(400);

    expect(response.body.message).toBe('Validation error.');
    expect(response.body.errors).toEqual([
      { field: 'body', message: 'At least one field must be provided.' },
    ]);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects an empty update body', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects an unavailable organizational unit', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-002', isActive: false });
    const app = await loadApp(prisma);

    const response = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ unitId: 'unit-002' })
      .expect(400);

    expect(response.body.message).toBe('Organizational unit is not available.');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects a career that does not belong to the selected unit', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.career.findUnique.mockResolvedValue({ id: 'car-002', unitId: 'unit-002' });
    const app = await loadApp(prisma);

    const response = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ careerId: 'car-002' })
      .expect(400);

    expect(response.body.message).toBe('Career does not belong to the selected unit.');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('returns 404 when the authenticated profile no longer exists', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockImplementation((args: UserLookupArgs) => {
      if (args.select && 'isActive' in args.select) {
        return Promise.resolve(authUserRecord);
      }
      return Promise.resolve(null);
    });
    const app = await loadApp(prisma);

    await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);
  });

  it('rejects the admin user list without a token', async () => {
    const app = await loadApp(createPrismaMock());

    await request(app).get('/api/v1/admin/users').expect(401);
  });

  it('rejects the admin user list for non-admin users', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);

    expect(response.body.message).toBe('Insufficient privileges for this resource.');
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('returns a paginated user list for administrators', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.user.findMany.mockResolvedValue([adminUserRecord]);
    prisma.user.count.mockResolvedValue(30);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get('/api/v1/admin/users?page=2&limit=10')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);

    expect(response.body.data).toEqual({
      items: [adminUserRecord],
      page: 2,
      limit: 10,
      total: 30,
      totalPages: 3,
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
    expect(prisma.user.count).toHaveBeenCalled();
  });

  it('forwards role, status, unit, career and search filters', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);
    const app = await loadApp(prisma);

    await request(app)
      .get(
        '/api/v1/admin/users?globalRole=ADMIN&isActive=false&unitId=unit-001&careerId=car-001&q=perez',
      )
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          globalRole: 'ADMIN',
          isActive: false,
          unitId: 'unit-001',
          careerId: 'car-001',
          OR: [
            { firstName: { contains: 'perez', mode: 'insensitive' } },
            { lastName: { contains: 'perez', mode: 'insensitive' } },
            { email: { contains: 'perez', mode: 'insensitive' } },
            { identificationNumber: { contains: 'perez', mode: 'insensitive' } },
          ],
        }),
      }),
    );
  });

  it('queries only safe user fields for the admin list', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    let capturedArgs: { select: Record<string, unknown> } | undefined;
    prisma.user.findMany.mockImplementation((args: { select: Record<string, unknown> }) => {
      capturedArgs = args;
      return Promise.resolve([]);
    });
    prisma.user.count.mockResolvedValue(0);
    const app = await loadApp(prisma);

    await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);

    expect(capturedArgs?.select).toMatchObject({ id: true, isActive: true });
    expect(capturedArgs?.select).not.toHaveProperty('name');
    expect(capturedArgs?.select).not.toHaveProperty('accounts');
    expect(capturedArgs?.select).not.toHaveProperty('password');
    expect(capturedArgs?.select).not.toHaveProperty('passwordHash');
    expect(capturedArgs?.select).not.toHaveProperty('emailVerified');
  });

  it('does not expose internal or credential fields in the admin list', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.user.findMany.mockResolvedValue([adminUserRecord]);
    prisma.user.count.mockResolvedValue(1);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);

    expect(JSON.stringify(response.body)).not.toContain('$argon2');
    expect(response.body.data.items[0]).not.toHaveProperty('name');
    expect(response.body.data.items[0]).not.toHaveProperty('accounts');
    expect(response.body.data.items[0]).not.toHaveProperty('password');
    expect(response.body.data.items[0]).not.toHaveProperty('passwordHash');
    expect(response.body.data.items[0]).not.toHaveProperty('emailVerified');
  });

  it('rejects invalid admin list query parameters', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    for (const query of ['globalRole=SUPERADMIN', 'isActive=maybe', 'limit=51', 'unexpected=1']) {
      const response = await request(app)
        .get(`/api/v1/admin/users?${query}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(400);

      expect(response.body.message).toBe('Validation error.');
    }

    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('rejects the admin user detail without a token', async () => {
    const app = await loadApp(createPrismaMock());

    await request(app).get('/api/v1/admin/users/user-target').expect(401);
  });

  it('rejects the admin user detail for non-admin users', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get('/api/v1/admin/users/user-target')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);

    expect(response.body.message).toBe('Insufficient privileges for this resource.');
    expect(prisma.user.findUnique).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-target' } }),
    );
  });

  it('returns the administrative user detail for administrators', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get('/api/v1/admin/users/user-target')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);

    expect(response.body.data).toEqual(targetUserRecord);
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-target' } }),
    );
  });

  it('queries only safe user fields for the admin detail', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    let capturedArgs: { where: { id: string }; select: Record<string, unknown> } | undefined;
    prisma.user.findUnique.mockImplementation(
      (args: { where: { id: string }; select: Record<string, unknown> }) => {
        if (args.select && 'firstName' in args.select) {
          capturedArgs = args;
          return Promise.resolve(targetUserRecord);
        }

        return Promise.resolve(authUserRecords[args.where.id] ?? null);
      },
    );
    const app = await loadApp(prisma);

    await request(app)
      .get('/api/v1/admin/users/user-target')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);

    expect(capturedArgs?.select).toMatchObject({ id: true, isActive: true });
    expect(capturedArgs?.select).not.toHaveProperty('name');
    expect(capturedArgs?.select).not.toHaveProperty('accounts');
    expect(capturedArgs?.select).not.toHaveProperty('password');
    expect(capturedArgs?.select).not.toHaveProperty('passwordHash');
    expect(capturedArgs?.select).not.toHaveProperty('emailVerified');
  });

  it('does not expose internal or credential fields in the admin detail', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get('/api/v1/admin/users/user-target')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);

    expect(JSON.stringify(response.body)).not.toContain('$argon2');
    expect(response.body.data).not.toHaveProperty('name');
    expect(response.body.data).not.toHaveProperty('accounts');
    expect(response.body.data).not.toHaveProperty('password');
    expect(response.body.data).not.toHaveProperty('passwordHash');
    expect(response.body.data).not.toHaveProperty('emailVerified');
  });

  it('returns 404 for an unknown user id', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get('/api/v1/admin/users/user-does-not-exist')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(404);

    expect(response.body).toEqual({
      success: false,
      message: 'User not found.',
      errors: [],
    });
  });

  it('rejects a whitespace user id', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get('/api/v1/admin/users/%20')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(400);

    expect(response.body.message).toBe('Validation error.');
    expect(prisma.user.findUnique).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: '' } }),
    );
  });

  beforeEach(() => {
    authApiMock.sendVerificationEmail.mockClear();
  });

  const createUserBody = {
    email: 'ana.gomez@utp.ac.pa',
    password: 'SipegCreado2026*',
    firstName: 'Ana',
    lastName: 'Gomez',
    identificationNumber: '8-888-1234',
    globalRole: 'USER',
    isActive: true,
  };

  it('rejects user creation without a token', async () => {
    const app = await loadApp(createPrismaMock());

    await request(app).post('/api/v1/admin/users').send(createUserBody).expect(401);
  });

  it('rejects user creation for non-admin users', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    const response = await request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(createUserBody)
      .expect(403);

    expect(response.body.message).toBe('Insufficient privileges for this resource.');
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.account.create).not.toHaveBeenCalled();
  });

  it('creates a user account for administrators', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.user.create.mockResolvedValue(adminUserRecord);
    const app = await loadApp(prisma);

    const response = await request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ ...createUserBody, email: ' Ana.Gomez@UTP.AC.PA ' })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('User created successfully.');
    expect(response.body.data).toEqual(adminUserRecord);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'ana.gomez@utp.ac.pa',
          emailVerified: false,
          globalRole: 'USER',
          isActive: true,
        }),
      }),
    );

    const accountArgs = prisma.account.create.mock.calls[0]?.[0] as {
      data: { accountId: string; providerId: string; password: string };
    };
    expect(accountArgs.data.accountId).toBe('user-001');
    expect(accountArgs.data.providerId).toBe('credential');
    expect(accountArgs.data.password.startsWith('$argon2id$')).toBe(true);
    expect(authApiMock.sendVerificationEmail).toHaveBeenCalledWith({
      body: { email: 'ana.gomez@utp.ac.pa' },
    });
  });

  it('honors role, status, unit and career overrides', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-001', isActive: true });
    prisma.career.findUnique.mockResolvedValue({ id: 'car-001', unitId: 'unit-001' });
    prisma.user.create.mockResolvedValue(adminUserRecord);
    const app = await loadApp(prisma);

    await request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        ...createUserBody,
        globalRole: 'ADMIN',
        isActive: false,
        unitId: 'unit-001',
        careerId: 'car-001',
      })
      .expect(201);

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          globalRole: 'ADMIN',
          isActive: false,
          unitId: 'unit-001',
          careerId: 'car-001',
        }),
      }),
    );
  });

  it('does not expose internal or credential fields on creation', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.user.create.mockResolvedValue(adminUserRecord);
    const app = await loadApp(prisma);

    const response = await request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send(createUserBody)
      .expect(201);

    expect(JSON.stringify(response.body)).not.toContain('$argon2');
    expect(response.body.data).not.toHaveProperty('name');
    expect(response.body.data).not.toHaveProperty('accounts');
    expect(response.body.data).not.toHaveProperty('password');
    expect(response.body.data).not.toHaveProperty('passwordHash');
    expect(response.body.data).not.toHaveProperty('emailVerified');
  });

  it('rejects invalid user creation bodies without writing', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    for (const body of [
      { ...createUserBody, password: 'short' },
      { ...createUserBody, email: 'not-an-email' },
      { ...createUserBody, emailVerified: true },
      { ...createUserBody, globalRole: 'SUPERADMIN' },
    ]) {
      const response = await request(app)
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send(body)
        .expect(400);

      expect(response.body.message).toBe('Validation error.');
    }

    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('returns 409 for a duplicate email on creation', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockImplementation(
      (args: { where: { id?: string; email?: string } }) => {
        if (args.where.email) return Promise.resolve({ id: 'existing-user' });
        return Promise.resolve(authUserRecords[args.where.id ?? ''] ?? null);
      },
    );
    const app = await loadApp(prisma);

    const response = await request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send(createUserBody)
      .expect(409);

    expect(response.body.message).toBe('Email is already registered.');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('returns 409 for a duplicate identification number on creation', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockImplementation(
      (args: { where: { id?: string; identificationNumber?: string } }) => {
        if (args.where.identificationNumber) return Promise.resolve({ id: 'existing-user' });
        return Promise.resolve(authUserRecords[args.where.id ?? ''] ?? null);
      },
    );
    const app = await loadApp(prisma);

    const response = await request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send(createUserBody)
      .expect(409);

    expect(response.body.message).toBe('Identification number is already registered.');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects the admin user update without a token', async () => {
    const app = await loadApp(createPrismaMock());

    await request(app)
      .patch('/api/v1/admin/users/user-target')
      .send({ isActive: false })
      .expect(401);
  });

  it('rejects the admin user update for non-admin users', async () => {
    const prisma = createPrismaMock();
    mockAdminUpdate(prisma);
    const app = await loadApp(prisma);

    const response = await request(app)
      .patch('/api/v1/admin/users/user-target')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ isActive: false })
      .expect(403);

    expect(response.body.message).toBe('Insufficient privileges for this resource.');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('updates a user as administrator and returns the safe DTO', async () => {
    const prisma = createPrismaMock();
    mockAdminUpdate(prisma, editableUserSnapshot, { ...targetUserRecord, isActive: true });
    const app = await loadApp(prisma);

    const response = await request(app)
      .patch('/api/v1/admin/users/user-target')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ globalRole: 'ADMIN', isActive: true })
      .expect(200);

    expect(response.body.message).toBe('User updated successfully.');
    expect(response.body.data).toEqual({ ...targetUserRecord, isActive: true });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-target' },
        data: { globalRole: 'ADMIN', isActive: true },
      }),
    );
  });

  it('revokes the sessions when an administrator deactivates a user', async () => {
    const prisma = createPrismaMock();
    mockAdminUpdate(prisma, editableUserSnapshot, { ...targetUserRecord, isActive: false });
    const app = await loadApp(prisma);

    await request(app)
      .patch('/api/v1/admin/users/user-target')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ isActive: false })
      .expect(200);

    expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-target' } });
  });

  it('blocks self-deactivation', async () => {
    const prisma = createPrismaMock();
    mockAdminUpdate(prisma, { ...editableUserSnapshot, id: 'user-admin', globalRole: 'ADMIN' });
    const app = await loadApp(prisma);

    const response = await request(app)
      .patch('/api/v1/admin/users/user-admin')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ isActive: false })
      .expect(409);

    expect(response.body.message).toBe('You cannot deactivate your own account.');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('blocks self-demotion', async () => {
    const prisma = createPrismaMock();
    mockAdminUpdate(prisma, { ...editableUserSnapshot, id: 'user-admin', globalRole: 'ADMIN' });
    const app = await loadApp(prisma);

    const response = await request(app)
      .patch('/api/v1/admin/users/user-admin')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ globalRole: 'USER' })
      .expect(409);

    expect(response.body.message).toBe('You cannot change your own role.');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('blocks demoting the last active administrator', async () => {
    const prisma = createPrismaMock();
    mockAdminUpdate(prisma, adminTargetSnapshot);
    prisma.user.count.mockResolvedValue(0);
    const app = await loadApp(prisma);

    const response = await request(app)
      .patch('/api/v1/admin/users/user-admin-target')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ globalRole: 'USER' })
      .expect(409);

    expect(response.body.message).toBe('At least one active administrator is required.');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown user on update', async () => {
    const prisma = createPrismaMock();
    mockAdminUpdate(prisma);
    const app = await loadApp(prisma);

    const response = await request(app)
      .patch('/api/v1/admin/users/user-does-not-exist')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ isActive: false })
      .expect(404);

    expect(response.body).toEqual({
      success: false,
      message: 'User not found.',
      errors: [],
    });
  });

  it('rejects invalid admin update bodies', async () => {
    const prisma = createPrismaMock();
    mockAdminUpdate(prisma);
    const app = await loadApp(prisma);

    for (const body of [
      {},
      { firstName: 'Ana' },
      { globalRole: 'SUPERADMIN' },
      { isActive: 'yes' },
    ]) {
      const response = await request(app)
        .patch('/api/v1/admin/users/user-target')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send(body)
        .expect(400);

      expect(response.body.message).toBe('Validation error.');
    }

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('does not expose internal or credential fields in the admin update', async () => {
    const prisma = createPrismaMock();
    mockAdminUpdate(prisma);
    const app = await loadApp(prisma);

    const response = await request(app)
      .patch('/api/v1/admin/users/user-target')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ isActive: true })
      .expect(200);

    expect(JSON.stringify(response.body)).not.toContain('$argon2');
    expect(response.body.data).not.toHaveProperty('name');
    expect(response.body.data).not.toHaveProperty('accounts');
    expect(response.body.data).not.toHaveProperty('password');
    expect(response.body.data).not.toHaveProperty('passwordHash');
    expect(response.body.data).not.toHaveProperty('emailVerified');
  });
});
