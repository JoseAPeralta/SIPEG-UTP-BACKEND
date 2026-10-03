import { afterEach, describe, expect, it, vi } from 'vitest';

const originalDatabaseUrl = process.env['DATABASE_URL'];
const POOL_ENV_KEYS = [
  'DATABASE_POOL_MAX',
  'DATABASE_POOL_CONNECTION_TIMEOUT_MS',
  'DATABASE_POOL_IDLE_TIMEOUT_MS',
] as const;
const originalPoolValues = new Map(POOL_ENV_KEYS.map((key) => [key, process.env[key]]));

describe('prisma config', () => {
  afterEach(() => {
    process.env['DATABASE_URL'] = originalDatabaseUrl;
    for (const key of POOL_ENV_KEYS) {
      const value = originalPoolValues.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
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

  it('sizes the pool for a 4 vCPU server by default', async () => {
    process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
    for (const key of POOL_ENV_KEYS) {
      delete process.env[key];
    }
    vi.resetModules();

    const { buildPrismaPoolConfig } = await import('./prisma.js');

    expect(buildPrismaPoolConfig()).toEqual({
      connectionString: 'postgresql://test:test@localhost:5432/test',
      max: 9,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
    });
  });

  it('honors the pool environment overrides', async () => {
    process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
    process.env['DATABASE_POOL_MAX'] = '12';
    process.env['DATABASE_POOL_CONNECTION_TIMEOUT_MS'] = '4000';
    process.env['DATABASE_POOL_IDLE_TIMEOUT_MS'] = '20000';
    vi.resetModules();

    const { buildPrismaPoolConfig } = await import('./prisma.js');

    expect(buildPrismaPoolConfig()).toEqual({
      connectionString: 'postgresql://test:test@localhost:5432/test',
      max: 12,
      connectionTimeoutMillis: 4000,
      idleTimeoutMillis: 20000,
    });
  });
});
