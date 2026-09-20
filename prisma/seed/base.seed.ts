import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { hashPassword } from '../../src/lib/password.js';
import { seedClassrooms } from './classrooms.seed.js';
import { logStep, readInitialAdminConfig, seedId, type InitialAdminConfig } from './helpers.js';
import { seedOrganizations } from './organizations.seed.js';

const ensureInitialAdmin = async (
  prisma: PrismaClient,
  config: InitialAdminConfig | null,
): Promise<void> => {
  if (!config) {
    const existingAdmin = await prisma.user.findFirst({
      where: { globalRole: 'ADMIN' },
      select: { id: true },
    });

    if (existingAdmin) {
      logStep('ADMIN existente detectado; bootstrap inicial omitido.');
      return;
    }

    throw new Error(
      'No ADMIN user exists. Set SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD and SEED_ADMIN_IDENTIFICATION_NUMBER to bootstrap the initial ADMIN.',
    );
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: config.email },
    select: { id: true },
  });

  if (existingUser) {
    logStep(`ADMIN ${config.email} ya existe; no se modifica.`);
    return;
  }

  const passwordHash = await hashPassword(config.password);
  const user = await prisma.user.create({
    data: {
      id: seedId('user', 'admin'),
      name: `${config.firstName} ${config.lastName}`,
      firstName: config.firstName,
      lastName: config.lastName,
      identificationNumber: config.identificationNumber,
      email: config.email,
      emailVerified: true,
      globalRole: 'ADMIN',
      isActive: true,
    },
    select: { id: true },
  });

  await prisma.account.create({
    data: {
      id: seedId('account', 'admin'),
      accountId: user.id,
      providerId: 'credential',
      userId: user.id,
      password: passwordHash,
    },
  });

  logStep(
    `ADMIN inicial creado: ${config.email}. Cambia la contrasena tras el primer inicio de sesion.`,
  );
};

export const seedBaseDatabase = async (prisma: PrismaClient): Promise<void> => {
  await seedOrganizations(prisma, 'ensure');
  await seedClassrooms(prisma, 'ensure');
  await ensureInitialAdmin(prisma, readInitialAdminConfig());

  const [units, careers, programs, classrooms, permissions, admins] = await Promise.all([
    prisma.organizationalUnit.count(),
    prisma.career.count(),
    prisma.eventProgram.count({ where: { isDefault: true } }),
    prisma.classroom.count(),
    prisma.permission.count(),
    prisma.user.count({ where: { globalRole: 'ADMIN' } }),
  ]);

  logStep('Seed base completado (modo ensure; no sobrescribe datos existentes).');
  logStep(`  unidades organizativas: ${units}`);
  logStep(`  carreras: ${careers}`);
  logStep(`  programas predeterminados: ${programs}`);
  logStep(`  aulas: ${classrooms}`);
  logStep(`  permisos: ${permissions}`);
  logStep(`  administradores: ${admins}`);
};
