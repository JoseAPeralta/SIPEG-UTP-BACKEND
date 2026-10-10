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
  alert: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  user: { findUnique: ReturnType<typeof vi.fn> };
}

const createPrismaMock = (): PrismaMock => ({
  alert: {
    findMany: vi.fn(),
    count: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  user: { findUnique: vi.fn() },
});

const userRecord = {
  id: 'user-001',
  email: 'estudiante01@utp.ac.pa',
  globalRole: 'USER',
  unitId: 'unit-001',
  careerId: 'career-001',
  isActive: true,
};

const otherUserRecord = {
  id: 'user-002',
  email: 'estudiante02@utp.ac.pa',
  globalRole: 'USER',
  unitId: 'unit-001',
  careerId: 'career-001',
  isActive: true,
};

const mockUserLookup = (prisma: PrismaMock): void => {
  const records: Record<string, unknown> = {
    'user-001': userRecord,
    'user-002': otherUserRecord,
  };

  prisma.user.findUnique.mockImplementation((args: { where: { id: string } }) =>
    Promise.resolve(records[args.where.id] ?? null),
  );
};

const alertRecord = {
  id: 'alert-001',
  type: 'ACTIVITY_UPDATED',
  isRead: false,
  createdAt: new Date('2026-10-04T14:05:00.000Z'),
  proposalId: null,
  eventProgramId: null,
  activityId: 'activity-001',
  certificateId: null,
};

const expectedAlert = {
  id: 'alert-001',
  type: 'ACTIVITY_UPDATED',
  isRead: false,
  createdAt: '2026-10-04T14:05:00.000Z',
  target: { kind: 'ACTIVITY', id: 'activity-001' },
};

let privateKey: CryptoKey;
let kid: string;
let jwks: { keys: unknown[] };
let tokenUser1: string;
let tokenUser2: string;

const signToken = (subject: string): Promise<string> =>
  new SignJWT({ role: 'USER', isActive: true })
    .setProtectedHeader({ alg: 'EdDSA', kid, typ: 'JWT' })
    .setIssuer('http://localhost:3000')
    .setAudience('http://localhost:3000')
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(privateKey);

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

describe('alerts routes', () => {
  beforeAll(async () => {
    const keyPair = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    privateKey = keyPair.privateKey;
    const publicJwk = await exportJWK(keyPair.publicKey);
    kid = await calculateJwkThumbprint(publicJwk);
    publicJwk.kid = kid;
    publicJwk.alg = 'EdDSA';
    jwks = { keys: [publicJwk] };
    tokenUser1 = await signToken('user-001');
    tokenUser2 = await signToken('user-002');
  });

  afterAll(() => {
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../../utils/jwt-verifier.js');
    vi.doUnmock('../../lib/auth.js');
  });

  it('lists only the alerts of the authenticated user', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.alert.findMany.mockResolvedValue([alertRecord]);
    prisma.alert.count.mockResolvedValue(1);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get('/api/v1/alerts')
      .set('Authorization', `Bearer ${tokenUser1}`)
      .expect(200);

    expect(prisma.alert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { recipientId: 'user-001' },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
    );
    expect(response.body).toEqual({
      success: true,
      message: 'Alerts retrieved successfully.',
      data: { items: [expectedAlert], page: 1, limit: 20, total: 1, totalPages: 1 },
    });
  });

  it('applies the read state, type and pagination filters', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.alert.findMany.mockResolvedValue([]);
    prisma.alert.count.mockResolvedValue(0);
    const app = await loadApp(prisma);

    await request(app)
      .get('/api/v1/alerts?isRead=false&type=ACTIVITY_UPDATED&page=2&limit=10')
      .set('Authorization', `Bearer ${tokenUser1}`)
      .expect(200);

    expect(prisma.alert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { recipientId: 'user-001', isRead: false, type: 'ACTIVITY_UPDATED' },
        skip: 10,
        take: 10,
      }),
    );
  });

  it('cannot be redirected to another recipient through the query', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get('/api/v1/alerts?userId=user-002')
      .set('Authorization', `Bearer ${tokenUser1}`)
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(JSON.stringify(response.body)).to.include('userId');
    expect(prisma.alert.findMany).not.toHaveBeenCalled();
  });

  it('rejects an invalid read state filter', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    await request(app)
      .get('/api/v1/alerts?isRead=unread')
      .set('Authorization', `Bearer ${tokenUser1}`)
      .expect(400);
  });

  it('returns my alert detail', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.alert.findUnique.mockResolvedValue(alertRecord);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get('/api/v1/alerts/alert-001')
      .set('Authorization', `Bearer ${tokenUser1}`)
      .expect(200);

    expect(prisma.alert.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'alert-001', recipientId: 'user-001' } }),
    );
    expect(response.body.data).toEqual(expectedAlert);
  });

  it('returns the same 404 for a foreign alert and an unknown alert', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.alert.findUnique.mockImplementation(
      (args: { where: { id: string; recipientId: string } }) =>
        Promise.resolve(
          args.where.id === 'alert-001' && args.where.recipientId === 'user-001'
            ? alertRecord
            : null,
        ),
    );
    const app = await loadApp(prisma);

    const foreign = await request(app)
      .get('/api/v1/alerts/alert-001')
      .set('Authorization', `Bearer ${tokenUser2}`)
      .expect(404);
    const unknown = await request(app)
      .get('/api/v1/alerts/alert-999')
      .set('Authorization', `Bearer ${tokenUser1}`)
      .expect(404);

    expect(foreign.body).toEqual(unknown.body);
    expect(foreign.body.message).toBe('Alert not found.');
  });

  it('marks my alert as read', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.alert.update.mockResolvedValue({ ...alertRecord, isRead: true });
    const app = await loadApp(prisma);

    const response = await request(app)
      .patch('/api/v1/alerts/alert-001/read')
      .set('Authorization', `Bearer ${tokenUser1}`)
      .expect(200);

    expect(prisma.alert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'alert-001', recipientId: 'user-001' },
        data: { isRead: true },
      }),
    );
    expect(response.body.message).toBe('Alert marked as read successfully.');
    expect(response.body.data.isRead).toBe(true);
  });

  it('does not reveal a foreign alert when marking it as read', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.alert.update.mockRejectedValue({ code: 'P2025' });
    const app = await loadApp(prisma);

    const response = await request(app)
      .patch('/api/v1/alerts/alert-001/read')
      .set('Authorization', `Bearer ${tokenUser2}`)
      .expect(404);

    expect(response.body.message).toBe('Alert not found.');
    expect(prisma.alert.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'alert-001', recipientId: 'user-002' } }),
    );
  });

  it('marks every unread alert of the authenticated user as read', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.alert.updateMany.mockResolvedValue({ count: 2 });
    const app = await loadApp(prisma);

    const response = await request(app)
      .post('/api/v1/alerts/read-all')
      .set('Authorization', `Bearer ${tokenUser1}`)
      .expect(200);

    expect(prisma.alert.updateMany).toHaveBeenCalledWith({
      where: { recipientId: 'user-001', isRead: false },
      data: { isRead: true },
    });
    expect(response.body).toEqual({
      success: true,
      message: 'Alerts marked as read successfully.',
      data: { updatedCount: 2 },
    });
  });

  it('rejects a body that tries to modify another recipient', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    await request(app)
      .post('/api/v1/alerts/read-all')
      .set('Authorization', `Bearer ${tokenUser1}`)
      .send({ recipientId: 'user-002' })
      .expect(400);

    expect(prisma.alert.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a blank alert id', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    await request(app)
      .patch('/api/v1/alerts/%20/read')
      .set('Authorization', `Bearer ${tokenUser1}`)
      .expect(400);
  });

  it('requires a token on every alert operation', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    await request(app).get('/api/v1/alerts').expect(401);
    await request(app).get('/api/v1/alerts/alert-001').expect(401);
    await request(app).patch('/api/v1/alerts/alert-001/read').expect(401);
    await request(app).post('/api/v1/alerts/read-all').expect(401);
  });
});
