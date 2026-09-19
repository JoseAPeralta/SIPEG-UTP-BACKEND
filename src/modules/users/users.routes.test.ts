import request from 'supertest';
import {
  calculateJwkThumbprint,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type KeyLike,
} from 'jose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

interface PrismaMock {
  user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  organizationalUnit: { findUnique: ReturnType<typeof vi.fn> };
  career: { findUnique: ReturnType<typeof vi.fn> };
}

const createPrismaMock = (): PrismaMock => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  organizationalUnit: { findUnique: vi.fn() },
  career: { findUnique: vi.fn() },
});

let accessToken: string;
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

describe('users routes', () => {
  let privateKey: KeyLike;

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
});
