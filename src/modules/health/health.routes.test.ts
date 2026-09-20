import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('health routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../../lib/auth.js');
    vi.doUnmock('../../config/prisma.js');
  });

  it('returns the service health status with authJwksReachable flag', async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['AUTH_SECRET'] = 'a'.repeat(32);
    process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
    process.env['AUTH_URL'] = 'http://localhost:3000';
    vi.resetModules();
    vi.doMock('../../lib/auth.js', () => ({
      auth: {
        options: { baseURL: 'http://localhost:3000' },
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
    vi.doMock('../../config/prisma.js', () => ({ getPrismaClient: () => ({}) }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    const { app } = await import('../../app.js');
    const response = await request(app).get('/api/v1/health').expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('ok');
    expect(response.body.data.service).toBe('sipeg-utp-backend');
    expect(response.body.data.environment).toBe('test');
    expect(typeof response.body.data.authJwksReachable).toBe('boolean');
  });
});
