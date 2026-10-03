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
  certificate: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  user: { findUnique: ReturnType<typeof vi.fn> };
}

const createPrismaMock = (): PrismaMock => ({
  certificate: {
    findMany: vi.fn(),
    count: vi.fn(),
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

const certificateRecord = {
  id: 'cert-001',
  code: 'CERT-8F3A2B',
  issuedAt: new Date('2026-09-07T14:05:00.000Z'),
  attendance: {
    activity: {
      id: 'activity-001',
      name: 'Workshop de Ciberseguridad Defensiva',
      date: new Date('2026-09-07T00:00:00.000Z'),
      type: 'WORKSHOP',
      eventProgram: { id: 'program-001', name: 'Programa de Eventos - FISC' },
    },
  },
};

let privateKey: CryptoKey;
let kid: string;
let accessToken: string;
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

describe('my certificates route', () => {
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
  });

  afterAll(() => {
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../../utils/jwt-verifier.js');
    vi.doUnmock('../../lib/auth.js');
  });

  it('lists the authenticated user certificates', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.certificate.findMany.mockResolvedValue([certificateRecord]);
    prisma.certificate.count.mockResolvedValue(1);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get('/api/v1/users/me/certificates')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual({
      items: [
        {
          id: 'cert-001',
          code: 'CERT-8F3A2B',
          issuedAt: '2026-09-07T14:05:00.000Z',
          activity: {
            id: 'activity-001',
            name: 'Workshop de Ciberseguridad Defensiva',
            date: '2026-09-07',
            type: 'WORKSHOP',
          },
          eventProgram: { id: 'program-001', name: 'Programa de Eventos - FISC' },
        },
      ],
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
  });

  it('never exposes storage or attendance internals', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.certificate.findMany.mockResolvedValue([
      {
        ...certificateRecord,
        pdfUrl: '/certificates/CERT-8F3A2B.pdf',
        attendanceId: 'att-001',
      },
    ]);
    prisma.certificate.count.mockResolvedValue(1);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get('/api/v1/users/me/certificates')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.to.include('pdfUrl');
    expect(serialized).not.to.include('attendanceId');
  });

  it('scopes the query to the token subject', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.certificate.findMany.mockResolvedValue([]);
    prisma.certificate.count.mockResolvedValue(0);
    const app = await loadApp(prisma);

    await request(app)
      .get('/api/v1/users/me/certificates')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(prisma.certificate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { attendance: { userId: 'user-001' } } }),
    );
  });

  it('cannot be redirected to another user through the query', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.certificate.findMany.mockResolvedValue([]);
    prisma.certificate.count.mockResolvedValue(0);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get('/api/v1/users/me/certificates?userId=user-002')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(JSON.stringify(response.body)).to.include('userId');
    expect(prisma.certificate.findMany).not.toHaveBeenCalled();
  });

  it('requires a token', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    await request(app).get('/api/v1/users/me/certificates').expect(401);
  });

  it('rejects an invalid pagination limit', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    await request(app)
      .get('/api/v1/users/me/certificates?limit=51')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
  });

  it('rejects an impossible issued date', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    await request(app)
      .get('/api/v1/users/me/certificates?issuedFrom=2026-02-30')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
  });

  it('rejects an inverted issued range', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get('/api/v1/users/me/certificates?issuedFrom=2026-09-07&issuedTo=2026-08-26')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);

    expect(JSON.stringify(response.body)).to.include('issuedFrom cannot be after issuedTo.');
  });

  it('translates the issued range into institutional day bounds', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.certificate.findMany.mockResolvedValue([]);
    prisma.certificate.count.mockResolvedValue(0);
    const app = await loadApp(prisma);

    await request(app)
      .get('/api/v1/users/me/certificates?issuedFrom=2026-08-26&issuedTo=2026-09-07')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(prisma.certificate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          attendance: { userId: 'user-001' },
          issuedAt: {
            gte: new Date('2026-08-26T05:00:00.000Z'),
            lt: new Date('2026-09-08T05:00:00.000Z'),
          },
        },
      }),
    );
  });

  it('passes the scope filters to the query', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.certificate.findMany.mockResolvedValue([]);
    prisma.certificate.count.mockResolvedValue(0);
    const app = await loadApp(prisma);

    await request(app)
      .get(
        '/api/v1/users/me/certificates?eventProgramId=program-001&activityId=activity-001&page=2&limit=5',
      )
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(prisma.certificate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          attendance: {
            userId: 'user-001',
            activityId: 'activity-001',
            activity: { eventProgramId: 'program-001' },
          },
        },
        skip: 5,
        take: 5,
      }),
    );
  });

  it('returns an empty page when the user has no certificates', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.certificate.findMany.mockResolvedValue([]);
    prisma.certificate.count.mockResolvedValue(0);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get('/api/v1/users/me/certificates?eventProgramId=program-does-not-exist')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.data).toEqual({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
  });
});
