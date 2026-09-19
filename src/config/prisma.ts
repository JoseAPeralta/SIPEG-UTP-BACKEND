import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client.js';
import { env } from './env.js';

declare global {
  var __sipegPrisma: PrismaClient | undefined;
}

const createPrismaClient = (): PrismaClient => {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to initialize Prisma.');
  }

  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
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
