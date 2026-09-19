import { afterEach, describe, expect, it, vi } from 'vitest';

const originalDatabaseUrl = process.env['DATABASE_URL'];

describe('prisma config', () => {
  afterEach(() => {
    process.env['DATABASE_URL'] = originalDatabaseUrl;
    vi.resetModules();
    globalThis.__sipegPrisma = undefined;
  });

  it('does not require DATABASE_URL until Prisma is used', async () => {
    process.env['DATABASE_URL'] = '';
    vi.resetModules();

    const prismaConfig = await import('./prisma.js');

    expect(prismaConfig.isPrismaClientInitialized()).toBe(false);
    await expect(prismaConfig.disconnectPrisma()).resolves.toBeUndefined();
    expect(() => prismaConfig.getPrismaClient()).toThrow(
      'DATABASE_URL is required to initialize Prisma.',
    );
  });

  it('returns the same client across calls', async () => {
    process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
    vi.resetModules();

    const { getPrismaClient } = await import('./prisma.js');

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(first).toBe(second);
  });
});
