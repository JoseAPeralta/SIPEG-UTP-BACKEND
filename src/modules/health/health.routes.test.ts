import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('health routes', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(32));
    vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/test');
    vi.stubEnv('AUTH_URL', 'http://localhost:3000');
    vi.stubEnv('CORS_ORIGIN', 'http://localhost:5173');
    vi.stubEnv('AUTH_PASSWORD_RESET_URL', 'http://localhost:5173/reset-password');
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.doUnmock('../../lib/auth.js');
    vi.doUnmock('../../config/prisma.js');
  });

  it('returns the service health status with authJwksReachable true when JWKS is reachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    const { app } = await import('../../app.js');
    const response = await request(app).get('/api/v1/health').expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('ok');
    expect(response.body.data.service).toBe('sipeg-utp-backend');
    expect(response.body.data.environment).toBe('test');
    expect(response.body.data.authJwksReachable).toBe(true);
  });

  it.each([404, 503])(
    'reports authJwksReachable false when JWKS responds with %s',
    async (status) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));

      const { app } = await import('../../app.js');
      const response = await request(app).get('/api/v1/health').expect(200);

      expect(response.body.data.authJwksReachable).toBe(false);
    },
  );

  it('reports authJwksReachable false and probes with a 3-second timeout when JWKS is unreachable', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const fetchMock = vi.fn().mockRejectedValue(new Error('aborted'));
    vi.stubGlobal('fetch', fetchMock);

    const { app } = await import('../../app.js');
    const response = await request(app).get('/api/v1/health').expect(200);

    expect(response.body.data.authJwksReachable).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/auth/jwks',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(timeoutSpy).toHaveBeenCalledWith(3_000);
  });
});
