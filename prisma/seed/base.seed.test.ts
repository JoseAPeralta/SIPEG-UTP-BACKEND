import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { PERMISSION_NAMES } from '../../src/modules/authorization/permissions.js';
import { seedBaseDatabase } from './base.seed.js';
import { CLASSROOMS, seedClassrooms } from './classrooms.seed.js';
import { seedId } from './helpers.js';
import { CAREERS, seedOrganizations, UNITS } from './organizations.seed.js';
import { createFakePrisma, type FakePrismaClient } from './test-helpers/fake-prisma.js';

const ADMIN_ENV = {
  SEED_ADMIN_EMAIL: 'admin.base@utp.ac.pa',
  SEED_ADMIN_PASSWORD: 'BaseSeedAdmin#2026',
  SEED_ADMIN_IDENTIFICATION_NUMBER: '8-000-9999',
  SEED_ADMIN_FIRST_NAME: 'Admin',
  SEED_ADMIN_LAST_NAME: 'Base',
} as const;

const asClient = (client: FakePrismaClient): PrismaClient => client as unknown as PrismaClient;

const setAdminEnv = (): void => {
  for (const [key, value] of Object.entries(ADMIN_ENV)) {
    process.env[key] = value;
  }
};

const clearAdminEnv = (): void => {
  for (const key of Object.keys(ADMIN_ENV)) {
    delete process.env[key];
  }
};

const seedExistingAdmin = async (client: FakePrismaClient): Promise<void> => {
  await client.user.create({
    data: { id: 'existing-admin', email: 'ops@utp.ac.pa', globalRole: 'ADMIN' },
  });
};

let originalNodeEnv: string | undefined;

beforeEach(() => {
  originalNodeEnv = process.env['NODE_ENV'];
  process.env['NODE_ENV'] = 'test';
  clearAdminEnv();
});

afterEach(() => {
  clearAdminEnv();
  if (originalNodeEnv === undefined) {
    delete process.env['NODE_ENV'];
  } else {
    process.env['NODE_ENV'] = originalNodeEnv;
  }
});

describe('seedBaseDatabase (modo ensure)', () => {
  it('crea el catalogo institucional y el ADMIN inicial en una base vacia sin SEED_ALLOW_PRODUCTION', async () => {
    setAdminEnv();
    process.env['NODE_ENV'] = 'production';
    const { client } = createFakePrisma();

    await seedBaseDatabase(asClient(client));

    expect(client.organizationalUnit.rows).toHaveLength(UNITS.length);
    expect(client.eventProgram.rows).toHaveLength(UNITS.length);
    expect(client.career.rows).toHaveLength(CAREERS.length);
    expect(client.classroom.rows).toHaveLength(CLASSROOMS.length);
    expect(client.permission.rows).toHaveLength(PERMISSION_NAMES.length);
    expect(client.user.rows).toHaveLength(1);

    const admin = client.user.rows[0]!;
    expect(admin['globalRole']).toBe('ADMIN');
    expect(admin['emailVerified']).toBe(true);
    expect(admin['email']).toBe(ADMIN_ENV.SEED_ADMIN_EMAIL.toLowerCase());
    expect(admin['identificationNumber']).toBe(ADMIN_ENV.SEED_ADMIN_IDENTIFICATION_NUMBER);

    const account = client.account.rows[0]!;
    expect(account['providerId']).toBe('credential');
    expect(account['userId']).toBe(admin['id']);
    expect(String(account['password'])).toMatch(/^\$argon2id\$/);
  });

  it('no actualiza filas existentes (unidad renombrada, programa editado y aula desactivada)', async () => {
    const { client } = createFakePrisma();
    await seedExistingAdmin(client);

    const unitId = seedId('unit', 'fic');
    const programId = seedId('program', 'fic', 'default');
    const classroomId = seedId('classroom', 'aula-101');

    await client.organizationalUnit.create({
      data: {
        id: unitId,
        code: 'FIC',
        name: 'Nombre editado por admin',
        type: 'FACULTY',
        isActive: false,
      },
    });
    await client.eventProgram.create({
      data: {
        id: programId,
        name: 'Programa editado',
        description: 'Editado por admin',
        organizationalUnitId: unitId,
        isDefault: true,
        status: 'ACTIVE',
      },
    });
    await client.classroom.create({
      data: {
        id: classroomId,
        name: 'Aula editada',
        type: 'CLASSROOM',
        capacity: 5,
        isActive: false,
      },
    });

    await seedBaseDatabase(asClient(client));

    const unit = await client.organizationalUnit.findUnique({ where: { code: 'FIC' } });
    expect(unit?.['name']).toBe('Nombre editado por admin');
    expect(unit?.['isActive']).toBe(false);

    const program = await client.eventProgram.findFirst({
      where: { organizationalUnitId: unitId, isDefault: true },
    });
    expect(program?.['id']).toBe(programId);
    expect(program?.['name']).toBe('Programa editado');

    const classroom = await client.classroom.findUnique({ where: { id: classroomId } });
    expect(classroom?.['name']).toBe('Aula editada');
    expect(classroom?.['isActive']).toBe(false);
    expect(client.classroomAmenity.rows.some((row) => row['classroomId'] === classroomId)).toBe(
      false,
    );
    expect(
      client.classroomAvailability.rows.some((row) => row['classroomId'] === classroomId),
    ).toBe(false);
  });

  it('es idempotente entre corridas sucesivas', async () => {
    setAdminEnv();
    const { client, counters } = createFakePrisma();

    await seedBaseDatabase(asClient(client));
    const createsAfterFirstRun = counters.creates;

    await seedBaseDatabase(asClient(client));

    expect(counters.creates).toBe(createsAfterFirstRun);
    expect(client.organizationalUnit.rows).toHaveLength(UNITS.length);
    expect(client.eventProgram.rows).toHaveLength(UNITS.length);
    expect(client.career.rows).toHaveLength(CAREERS.length);
    expect(client.classroom.rows).toHaveLength(CLASSROOMS.length);
    expect(client.permission.rows).toHaveLength(PERMISSION_NAMES.length);
    expect(client.user.rows).toHaveLength(1);
  });

  it('crea la carrera global Otros sin unidad', async () => {
    const { client } = createFakePrisma();
    await seedExistingAdmin(client);

    await seedBaseDatabase(asClient(client));

    const otros = client.career.rows.find((row) => row['code'] === 'OTROS');
    expect(otros).toBeDefined();
    expect(otros?.['name']).toBe('Otros');
    expect(otros?.['unitId']).toBeNull();
  });

  it('agrega permisos faltantes aunque existan otros', async () => {
    const { client } = createFakePrisma();
    await seedExistingAdmin(client);
    await client.permission.create({
      data: { id: 'legacy', name: PERMISSION_NAMES[0], description: 'descripcion vieja' },
    });

    await seedBaseDatabase(asClient(client));

    expect(client.permission.rows).toHaveLength(PERMISSION_NAMES.length);
    const refreshed = client.permission.rows.find((row) => row['name'] === PERMISSION_NAMES[0]);
    expect(refreshed?.['description']).not.toBe('descripcion vieja');
  });

  it('omite el admin si el email ya existe y conserva su password', async () => {
    setAdminEnv();
    const { client } = createFakePrisma();
    await client.user.create({
      data: {
        id: 'existing',
        email: ADMIN_ENV.SEED_ADMIN_EMAIL,
        globalRole: 'ADMIN',
      },
    });
    await client.account.create({
      data: {
        id: 'existing-account',
        userId: 'existing',
        providerId: 'credential',
        password: 'hash-original',
      },
    });

    await seedBaseDatabase(asClient(client));

    expect(client.user.rows).toHaveLength(1);
    expect(client.account.rows).toHaveLength(1);
    expect(client.account.rows[0]?.['password']).toBe('hash-original');
  });

  it('falla cuando no existe ningun ADMIN y no hay bootstrap configurado', async () => {
    const { client } = createFakePrisma();

    await expect(seedBaseDatabase(asClient(client))).rejects.toThrow(/ADMIN/);
  });

  it('rechaza configuracion parcial del admin', async () => {
    process.env['SEED_ADMIN_EMAIL'] = 'parcial@utp.ac.pa';
    const { client } = createFakePrisma();
    await seedExistingAdmin(client);

    await expect(seedBaseDatabase(asClient(client))).rejects.toThrow(/must be set together/);
  });
});

describe('modo sync (demo)', () => {
  it('seedOrganizations refresca nombres de unidades existentes', async () => {
    const { client } = createFakePrisma();
    await client.organizationalUnit.create({
      data: { id: 'old-unit', code: 'FIC', name: 'Nombre viejo', type: 'FACULTY' },
    });

    await seedOrganizations(asClient(client), 'sync');

    const expected = UNITS.find((unit) => unit.code === 'FIC')?.name;
    const unit = await client.organizationalUnit.findUnique({ where: { code: 'FIC' } });
    expect(unit?.['name']).toBe(expected);
  });

  it('seedClassrooms reactiva y reescribe amenidades existentes', async () => {
    const { client } = createFakePrisma();
    const classroomId = seedId('classroom', 'aula-101');
    await client.classroom.create({
      data: {
        id: classroomId,
        name: 'Aula vieja',
        type: 'CLASSROOM',
        capacity: 1,
        isActive: false,
      },
    });

    await seedClassrooms(asClient(client), 'sync');

    const classroom = await client.classroom.findUnique({ where: { id: classroomId } });
    expect(classroom?.['name']).toBe('Aula 101');
    expect(classroom?.['capacity']).toBe(40);
    expect(classroom?.['isActive']).toBe(true);
    expect(
      client.classroomAmenity.rows.filter((row) => row['classroomId'] === classroomId).length,
    ).toBeGreaterThan(0);
    expect(
      client.classroomAvailability.rows.filter((row) => row['classroomId'] === classroomId).length,
    ).toBeGreaterThan(0);
  });
});
