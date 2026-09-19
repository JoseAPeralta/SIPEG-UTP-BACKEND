import { calculateJwkThumbprint, exportJWK, generateKeyPair } from 'jose';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

interface AuthMock {
  api: {
    signInEmail: ReturnType<typeof vi.fn>;
    signUpEmail: ReturnType<typeof vi.fn>;
    getToken: ReturnType<typeof vi.fn>;
    getSession: ReturnType<typeof vi.fn>;
    signOut: ReturnType<typeof vi.fn>;
    verifyEmail: ReturnType<typeof vi.fn>;
    requestPasswordReset: ReturnType<typeof vi.fn>;
    resetPassword: ReturnType<typeof vi.fn>;
  };
}

const createAuthMock = (): AuthMock => ({
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
});

let jwksRows: Array<{ id: string; publicKey: string; privateKey: string }> = [];

const loadApp = async (authMock: AuthMock) => {
  process.env['NODE_ENV'] = 'test';
  process.env['AUTH_SECRET'] = 'a'.repeat(32);
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
  process.env['AUTH_URL'] = 'http://localhost:3000';
  vi.resetModules();
  vi.doMock('../../lib/auth.js', () => ({ auth: authMock }));
  vi.doMock('../../config/prisma.js', () => ({
    getPrismaClient: () => ({
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'u-1',
          email: 'a@b.com',
          globalRole: 'USER',
          facultyId: null,
          careerId: null,
          isActive: true,
        }),
      },
      session: {
        findFirst: vi.fn().mockImplementation(({ where }: { where?: { token?: string } }) => {
          if (where?.token === 'invalid') return Promise.resolve(null);
          return Promise.resolve({
            expiresAt: new Date(Date.now() + 86400000),
            userId: 'u-1',
            user: {
              id: 'u-1',
              email: 'a@b.com',
              globalRole: 'USER',
              facultyId: null,
              careerId: null,
              isActive: true,
            },
          });
        }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      jwks: {
        findMany: vi.fn().mockImplementation(() => Promise.resolve(jwksRows)),
        count: vi.fn().mockImplementation(() => Promise.resolve(jwksRows.length)),
      },
    }),
  }));
  const { app } = await import('../../app.js');
  return app;
};

describe('auth routes', () => {
  let authMock: AuthMock;

  beforeAll(async () => {
    const kp = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    const publicJwk = await exportJWK(kp.publicKey);
    const privateJwk = await exportJWK(kp.privateKey);
    const kid = await calculateJwkThumbprint(publicJwk);
    publicJwk.kid = kid;
    privateJwk.kid = kid;
    jwksRows = [
      {
        id: kid,
        publicKey: JSON.stringify(publicJwk),
        privateKey: JSON.stringify(privateJwk),
      },
    ];
  });

  beforeEach(() => {
    authMock = createAuthMock();
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.doUnmock('../../lib/auth.js');
    vi.doUnmock('../../config/prisma.js');
  });

  it('POST /login returns tokens on valid credentials', async () => {
    authMock.api.signInEmail.mockResolvedValue({
      token: 'refresh-token',
      redirect: false,
      user: { id: 'u-1' },
    });
    const app = await loadApp(authMock);
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'a@b.com', password: 'strongpass1234' })
      .expect(200);
    expect(response.body.data.refreshToken).toBe('refresh-token');
    expect(typeof response.body.data.accessToken).toBe('string');
  });

  it('POST /login returns 400 on invalid body', async () => {
    const app = await loadApp(authMock);
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email' })
      .expect(400);
    expect(response.body.success).toBe(false);
  });

  it('POST /login returns 401 on bad credentials', async () => {
    const { APIError } = await import('better-auth/api');
    authMock.api.signInEmail.mockRejectedValue(new APIError(401, { message: 'Invalid' }));
    const app = await loadApp(authMock);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'a@b.com', password: 'wrong' })
      .expect(401);
  });

  it('POST /refresh returns 401 when session not found', async () => {
    const app = await loadApp(authMock);
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'invalid' })
      .expect(401);
    expect(response.body.success).toBe(false);
  });

  it('POST /logout returns 200 even when session missing', async () => {
    const app = await loadApp(authMock);
    await request(app).post('/api/v1/auth/logout').send({ refreshToken: 'r' }).expect(200);
  });

  it('POST /register creates user', async () => {
    authMock.api.signUpEmail.mockResolvedValue({ user: { id: 'u-new' } });
    const app = await loadApp(authMock);
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'new@b.com',
        password: 'strongpass1234',
        firstName: 'Nuevo',
        lastName: 'Usuario',
        identificationNumber: '8-999-9999',
      })
      .expect(201);
    expect(response.body.data.userId).toBe('u-new');
  });

  it('POST /forgot-password always returns 200', async () => {
    authMock.api.requestPasswordReset.mockResolvedValue({ success: true });
    const app = await loadApp(authMock);
    await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody@example.com' })
      .expect(200);
  });

  it('POST /reset-password delegates', async () => {
    authMock.api.resetPassword.mockResolvedValue(undefined);
    const app = await loadApp(authMock);
    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 't', newPassword: 'newstrongpass12' })
      .expect(200);
  });

  it('POST /verify-email delegates', async () => {
    authMock.api.verifyEmail.mockResolvedValue(undefined);
    const app = await loadApp(authMock);
    await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ token: 'verify-token' })
      .expect(200);
  });
});
