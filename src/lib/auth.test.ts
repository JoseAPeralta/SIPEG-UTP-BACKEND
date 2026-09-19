import { describe, expect, it, vi } from 'vitest';

describe('auth instance', () => {
  it('boots with required env vars', async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['AUTH_SECRET'] = 'a'.repeat(32);
    process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
    process.env['AUTH_URL'] = 'http://localhost:3000';
    vi.resetModules();

    vi.doMock('../config/prisma.js', () => ({
      getPrismaClient: () => ({}),
    }));

    const { auth } = await import('./auth.js');

    expect(auth.options.baseURL).toBe('http://localhost:3000');
    expect(auth.options.plugins.length).toBeGreaterThan(0);
  });
});
