import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client.js';
import { logger } from './logger.js';
import { env } from './env.js';

declare global {
  var __sipegPrisma: PrismaClient | undefined;
}

export const buildPrismaPoolConfig = (): {
  connectionString: string | undefined;
  max: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
} => ({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  connectionTimeoutMillis: env.DATABASE_POOL_CONNECTION_TIMEOUT_MS,
  idleTimeoutMillis: env.DATABASE_POOL_IDLE_TIMEOUT_MS,
});

const createPrismaClient = (): PrismaClient => {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to initialize Prisma.');
  }

  const adapter = new PrismaPg(buildPrismaPoolConfig());

  const client = new PrismaClient({
    adapter,
    log: [
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });

  client.$on('warn', (event) => {
    logger.warn({ event: 'prisma.warn', message: event.message }, 'prisma.warn');
  });
  client.$on('error', (event) => {
    logger.error({ event: 'prisma.error', message: event.message }, 'prisma.error');
  });

  return client;
};

export const getPrismaClient = (): PrismaClient => {
  if (globalThis.__sipegPrisma) {
    return globalThis.__sipegPrisma;
  }

  const client = createPrismaClient();
  globalThis.__sipegPrisma = client;
  return client;
};

export const isPrismaClientInitialized = (): boolean => {
  return globalThis.__sipegPrisma !== undefined;
};

export const disconnectPrisma = async (): Promise<void> => {
  if (!globalThis.__sipegPrisma) {
    return;
  }

  await globalThis.__sipegPrisma.$disconnect();
  globalThis.__sipegPrisma = undefined;
};
