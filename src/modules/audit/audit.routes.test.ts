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
  auditEvent: {
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  user: { findUnique: ReturnType<typeof vi.fn> };
}

const createPrismaMock = (): PrismaMock => ({
  auditEvent: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
  user: { findUnique: vi.fn() },
});

const authUserRecords: Record<string, unknown> = {
  'user-admin': {
    id: 'user-admin',
    email: 'admin@utp.ac.pa',
    globalRole: 'ADMIN',
    unitId: null,
    careerId: null,
    isActive: true,
  },
  'user-001': {
    id: 'user-001',
    email: 'user@utp.ac.pa',
    globalRole: 'USER',
    unitId: null,
    careerId: null,
    isActive: true,
  },
};

interface UserLookupArgs {
  where: { id: string };
  select?: Record<string, unknown>;
}

const mockUserLookup = (prisma: PrismaMock): void => {
  prisma.user.findUnique.mockImplementation((args: UserLookupArgs) => {
    if (args.select && 'email' in args.select) {
      return Promise.resolve(authUserRecords[args.where.id] ?? null);
    }

    return Promise.resolve(null);
  });
};

const auditRow = {
  id: 'audit-001',
  action: 'user.role_changed',
  occurredAt: new Date('2026-09-27T18:00:00.000Z'),
  actorType: 'USER',
  actorId: 'user-admin',
  resourceType: 'user',
  resourceId: 'user-001',
  scopeType: null,
  scopeId: null,
  targetUserId: 'user-001',
  requestId: 'request-001',
  changes: { before: { globalRole: 'USER' }, after: { globalRole: 'ADMIN' } },
  metadata: null,
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
    auth: { api: { getSession: vi.fn(), signOut: vi.fn() } },
  }));
  const { app } = await import('../../app.js');
  return app;
};

describe('audit events routes', () => {
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

  it('lists audit events for an admin with the default page size', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.auditEvent.findMany.mockResolvedValue([auditRow]);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get('/api/v1/audit-events')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual({
      items: [
        {
          id: 'audit-001',
          action: 'user.role_changed',
          occurredAt: '2026-09-27T18:00:00.000Z',
          actorType: 'USER',
          actorId: 'user-admin',
          resourceType: 'user',
          resourceId: 'user-001',
          scopeType: null,
          scopeId: null,
          targetUserId: 'user-001',
          requestId: 'request-001',
          changes: { before: { globalRole: 'USER' }, after: { globalRole: 'ADMIN' } },
          metadata: null,
        },
      ],
      limit: 20,
      hasMore: false,
      nextCursor: null,
    });
    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, take: 21 }),
    );
  });

  it('rejects listing audit events without a token', async () => {
    const prisma = createPrismaMock();
    const app = await loadApp(prisma);

    const response = await request(app).get('/api/v1/audit-events').expect(401);

    expect(response.body.message).toBe('Authorization header is required.');
    expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
  });

  it('rejects listing audit events as a non admin before touching Prisma', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get('/api/v1/audit-events')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);

    expect(response.body.message).toBe('Insufficient privileges for this resource.');
    expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
  });

  it('exposes no write, update or delete operation on the audit log', async () => {
    const prisma = createPrismaMock();
    const app = await loadApp(prisma);

    for (const method of ['post', 'patch', 'put', 'delete'] as const) {
      const response = await request(app)
        [method]('/api/v1/audit-events')
        .set('Authorization', `Bearer ${adminAccessToken}`);

      expect(response.status).toBe(404);
    }

    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('forwards every validated filter to the query', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get(
        '/api/v1/audit-events' +
          '?limit=1&action=user.role_changed&actorId=user-001&resourceType=user' +
          '&resourceId=user-002&scopeType=event_program&scopeId=program-001' +
          '&from=2026-09-01T00:00:00.000Z&to=2026-09-30T00:00:00.000Z',
      )
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);

    expect(response.body.data.limit).toBe(1);
    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { action: 'user.role_changed' },
            { actorId: 'user-001' },
            { resourceType: 'user' },
            { resourceId: 'user-002' },
            { scopeType: 'event_program' },
            { scopeId: 'program-001' },
            {
              occurredAt: {
                gte: new Date('2026-09-01T00:00:00.000Z'),
                lte: new Date('2026-09-30T00:00:00.000Z'),
              },
            },
          ],
        },
        take: 2,
      }),
    );
  });

  it('rejects a limit out of bounds before touching Prisma', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    for (const limit of ['101', '0']) {
      const response = await request(app)
        .get(`/api/v1/audit-events?limit=${limit}`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(400);

      expect(response.body.message).toBe('Validation error.');
      expect(response.body.errors[0]).toEqual({
        field: 'query.limit',
        message: expect.any(String),
      });
    }

    expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
  });

  it('rejects filters outside the audit catalog', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    const action = await request(app)
      .get('/api/v1/audit-events?action=user.unknown')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(400);
    const resourceType = await request(app)
      .get('/api/v1/audit-events?resourceType=invoice')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(400);
    const scopeType = await request(app)
      .get('/api/v1/audit-events?scopeType=program')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(400);

    expect(action.body.errors[0].field).toBe('query.action');
    expect(resourceType.body.errors[0].field).toBe('query.resourceType');
    expect(scopeType.body.errors[0].field).toBe('query.scopeType');
    expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
  });

  it('rejects a malformed instant window', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    const malformed = await request(app)
      .get('/api/v1/audit-events?from=2026-09-01')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(400);
    const inverted = await request(app)
      .get('/api/v1/audit-events?from=2026-09-30T00:00:00.000Z&to=2026-09-01T00:00:00.000Z')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(400);

    expect(malformed.body.errors[0].field).toBe('query.from');
    expect(inverted.body.errors[0]).toEqual({
      field: 'query.to',
      message: 'from cannot be after to.',
    });
    expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
  });

  it('rejects an unknown query key', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get('/api/v1/audit-events?page=1')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(400);

    expect(response.body.errors[0].field).toBe('query');
    expect(response.body.errors[0].message).toEqual(expect.stringContaining('nrecognized'));
    expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
  });

  it('rejects a malformed cursor before touching Prisma', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get('/api/v1/audit-events?cursor=not-a-cursor')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(400);

    expect(response.body.message).toBe('Invalid cursor.');
    expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
  });

  it('walks the pages with the cursor it hands out', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.auditEvent.findMany.mockResolvedValue([
      auditRow,
      { ...auditRow, id: 'audit-000', occurredAt: new Date('2026-09-27T17:00:00.000Z') },
    ]);
    const app = await loadApp(prisma);

    const firstPage = await request(app)
      .get('/api/v1/audit-events?limit=1')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);

    expect(firstPage.body.data.items).toHaveLength(1);
    expect(firstPage.body.data.hasMore).toBe(true);
    expect(firstPage.body.data.nextCursor).toEqual(expect.any(String));

    const secondPage = await request(app)
      .get(
        `/api/v1/audit-events?limit=1&cursor=${encodeURIComponent(firstPage.body.data.nextCursor)}`,
      )
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);

    expect(secondPage.body.data.items).toHaveLength(1);
    expect(prisma.auditEvent.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [
                { occurredAt: { lt: new Date('2026-09-27T18:00:00.000Z') } },
                { occurredAt: new Date('2026-09-27T18:00:00.000Z'), id: { lt: 'audit-001' } },
              ],
            },
          ],
        },
        take: 2,
      }),
    );
  });
});
