import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const loadApp = async (authMock: AuthMock) => {
  process.env['NODE_ENV'] = 'test';
  process.env['AUTH_SECRET'] = 'a'.repeat(32);
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
  process.env['AUTH_URL'] = 'http://localhost:3000';
  vi.resetModules();
  vi.doMock('../../lib/auth.js', () => ({ auth: authMock }));
  vi.doMock('../../config/prisma.js', () => ({
    getPrismaClient: () => ({ user: { findUnique: vi.fn() } }),
  }));
  const { app } = await import('../../app.js');
  return app;
};

describe('auth routes', () => {
  let authMock: AuthMock;
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
      token: 'refresh-token', redirect: false, user: { id: 'u-1' },
    });
    authMock.api.getToken.mockResolvedValue({
      token: 'access-jwt',
    });
    authMock.api.getSession.mockResolvedValue({
      session: { expiresAt: new Date(Date.now() + 86400000).toISOString() },
      user: { id: 'u-1' },
    });
    const app = await loadApp(authMock);
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'a@b.com', password: 'strongpass1234' })
      .expect(200);
    expect(response.body.data.accessToken).toBe('access-jwt');
    expect(response.body.data.refreshToken).toBe('refresh-token');
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

  it('POST /refresh returns new access token', async () => {
    authMock.api.getToken.mockResolvedValue({
      token: 'new-access', expiresAt: new Date(Date.now() + 900000).toISOString(),
    });
    authMock.api.getSession.mockResolvedValue({
      session: { expiresAt: new Date(Date.now() + 86400000).toISOString() },
    });
    const app = await loadApp(authMock);
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'valid' })
      .expect(200);
    expect(response.body.data.accessToken).toBe('new-access');
  });

  it('POST /logout invalidates refresh token', async () => {
    authMock.api.signOut.mockResolvedValue(undefined);
    const app = await loadApp(authMock);
    await request(app).post('/api/v1/auth/logout').send({ refreshToken: 'r' }).expect(200);
    expect(authMock.api.signOut).toHaveBeenCalled();
  });

  it('POST /register creates user', async () => {
    authMock.api.signUpEmail.mockResolvedValue({ user: { id: 'u-new' } });
    const app = await loadApp(authMock);
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'new@b.com', password: 'strongpass1234',
        firstName: 'Nuevo', lastName: 'Usuario', identificationNumber: '8-999-9999',
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
