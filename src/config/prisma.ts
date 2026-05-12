import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client.js';
import { env } from './env.js';

let prismaClient: PrismaClient | undefined;

export const getPrismaClient = (): PrismaClient => {
  if (prismaClient) {
    return prismaClient;
  }

  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to initialize Prisma.');
  }

  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  prismaClient = new PrismaClient({ adapter });

  return prismaClient;
};

export const isPrismaClientInitialized = (): boolean => {
  return prismaClient !== undefined;
};

export const disconnectPrisma = async (): Promise<void> => {
  if (!prismaClient) {
    return;
  }

  await prismaClient.$disconnect();
  prismaClient = undefined;
};
