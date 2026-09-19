import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const loadApp = async (docsEnabled?: string) => {
  process.env['NODE_ENV'] = 'test';
  process.env['AUTH_SECRET'] = 'a'.repeat(32);
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
  process.env['AUTH_URL'] = 'http://localhost:3000';

  if (docsEnabled === undefined) {
    delete process.env['DOCS_ENABLED'];
  } else {
    process.env['DOCS_ENABLED'] = docsEnabled;
  }

  vi.resetModules();
  vi.doMock('./lib/auth.js', () => ({
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
  vi.doMock('./config/prisma.js', () => ({ getPrismaClient: () => ({}) }));

  return import('./app.js');
};

describe('API documentation routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('./lib/auth.js');
    vi.doUnmock('./config/prisma.js');
    delete process.env['DOCS_ENABLED'];
  });

  it('serves the OpenAPI document', async () => {
    const { app } = await loadApp();
    const response = await request(app).get('/api/openapi.json').expect(200);

    expect(response.body.openapi).toBe('3.1.0');
    expect(response.body.paths).toHaveProperty('/api/v1/auth/login');
  });

  it('serves the Scalar reference UI', async () => {
    const { app } = await loadApp();
    const response = await request(app).get('/api/docs').expect(200);

    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toContain('Scalar');
  });

  it('disables both routes when DOCS_ENABLED is false', async () => {
    const { app } = await loadApp('false');

    await request(app).get('/api/openapi.json').expect(404);
    await request(app).get('/api/docs').expect(404);
  });
});
