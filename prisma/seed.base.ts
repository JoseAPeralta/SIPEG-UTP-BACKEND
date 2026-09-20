import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client.js';
import { seedBaseDatabase } from './seed/base.seed.js';

const connectionString = process.env['DATABASE_URL'] ?? '';

if (!connectionString) {
  throw new Error('DATABASE_URL is required to seed the database.');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

seedBaseDatabase(prisma)
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error('Database base seed failed.', error);
    await prisma.$disconnect();
    process.exit(1);
  });
