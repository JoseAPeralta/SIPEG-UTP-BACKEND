import { afterEach, describe, expect, it, vi } from 'vitest';

const originalDatabaseUrl = process.env['DATABASE_URL'];

describe('prisma config', () => {
  afterEach(() => {
    process.env['DATABASE_URL'] = originalDatabaseUrl;
    vi.resetModules();
  });

  it('does not require DATABASE_URL until Prisma is used', async () => {
    delete process.env['DATABASE_URL'];
    vi.resetModules();

    const prismaConfig = await import('./prisma.js');

    expect(prismaConfig.isPrismaClientInitialized()).toBe(false);
    await expect(prismaConfig.disconnectPrisma()).resolves.toBeUndefined();
    expect(() => prismaConfig.getPrismaClient()).toThrow(
      'DATABASE_URL is required to initialize Prisma.',
    );
  });
});
