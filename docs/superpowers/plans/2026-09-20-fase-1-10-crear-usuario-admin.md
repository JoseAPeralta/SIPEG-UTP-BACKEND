# Fase 1.10 - Crear usuario administrativo (`POST /api/v1/admin/users`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar el checklist 1.10 del plan maestro implementando `POST /api/v1/admin/users` con acceso exclusivo `ADMIN`, creacion transaccional de `users` + `accounts` con Argon2id, verificacion de email obligatoria y conflictos de email/identificacion normalizados a `409`.

**Architecture:** El endpoint vive en el modulo autocontenido `src/modules/users/` y sigue el patron de 1.8/1.9: `authenticate -> requireAdmin -> validate(schema) -> controller -> service -> Prisma`. La creacion NO usa `signUpEmail` porque `globalRole`/`isActive` son `input: false` en Better Auth y quedarian en un update posterior no atomico; en su lugar el servicio crea `users` + `accounts` en una transaccion Prisma con `hashPassword` (Argon2id) y luego dispara el correo con `auth.api.sendVerificationEmail` (endpoint oficial de Better Auth 1.7.5, que genera el token JWT y ejecuta el hook SMTP configurado). Se extrae `resolveOrganizationAssignment` de `updateProfile` para reutilizar las mismas reglas de unidad/carrera en la creacion (y dejarlas listas para 1.11).

**Tech Stack:** TypeScript 6, Express 5, Prisma 7, Better Auth 1.7.5, Argon2id, Zod 4, Vitest, Supertest, OpenAPI 3.1, Bruno.

**Hallazgos de partida (2026-09-20):**

- `src/modules/users/` tiene `GET/PATCH /users/me`, `GET /admin/users` y `GET /admin/users/:id` (1.9 ya en el arbol; el maestro aun no lo marca).
- `requireAdmin` responde `403 Insufficient privileges for this resource.` antes de validar body o tocar Prisma.
- `adminUserSelect` (`users.service.ts:22`) excluye `name`, `accounts`, `password`, `passwordHash` y `emailVerified`; `adminUserSchema` (`AdminUser`) ya esta documentado.
- `seed.base.ts` (`ensureInitialAdmin`) ya demuestra que crear `users` + `accounts` directo con `hashPassword` es compatible con el login de Better Auth (`accountId = user.id`, `providerId: 'credential'`).
- Better Auth 1.7.5: los llamados server-side via `auth.api` NO pasan por rate limiting; `auth.api.sendVerificationEmail` acepta `{ body: { email } }`, busca al usuario sin sesion, genera el token de verificacion y ejecuta `emailVerification.sendVerificationEmail` (nuestro hook SMTP). El token es un JWT firmado, no una fila en `verification`.
- `sendOnSignUp` no aplica porque no se usa `signUpEmail`.
- No se requieren migraciones, variables de entorno ni componentes OpenAPI eliminados; se agrega el componente `AdminUserCreate`.
- Trabajo concurrente sin commitear en todo el arbol (fases previas); no hacer commit salvo pedido explicito.

---

### Task 1: Esquema de creacion (TDD)

**Files:**

- Modify: `src/modules/users/users.schemas.ts`
- Modify: `src/modules/users/users.schemas.test.ts`

- [x] **Step 1: Escribir las pruebas rojas del esquema**

Actualizar el import del encabezado de `src/modules/users/users.schemas.test.ts`:

```ts
import {
  adminUserParamsSchema,
  adminUserSchema,
  createUserSchema,
  listUsersQuerySchema,
  updateProfileSchema,
  userProfileSchema,
} from './users.schemas.js';
```

Agregar al final del archivo:

```ts
describe('createUserSchema', () => {
  const baseCreate = {
    email: 'nuevo@utp.ac.pa',
    password: 'SipegNueva2026*',
    firstName: 'Ana',
    lastName: 'Gomez',
    identificationNumber: '8-888-1234',
  };

  it('applies USER and active defaults', () => {
    const parsed = createUserSchema.parse({ body: baseCreate });

    expect(parsed.body.globalRole).toBe('USER');
    expect(parsed.body.isActive).toBe(true);
  });

  it('accepts role, status, unit and career overrides', () => {
    const parsed = createUserSchema.parse({
      body: {
        ...baseCreate,
        globalRole: 'ADMIN',
        isActive: false,
        unitId: 'unit-001',
        careerId: 'car-001',
      },
    });

    expect(parsed.body).toMatchObject({
      globalRole: 'ADMIN',
      isActive: false,
      unitId: 'unit-001',
      careerId: 'car-001',
    });
  });

  it('rejects unknown fields such as id or emailVerified', () => {
    expect(() => createUserSchema.parse({ body: { ...baseCreate, id: 'user-999' } })).toThrow();
    expect(() =>
      createUserSchema.parse({ body: { ...baseCreate, emailVerified: true } }),
    ).toThrow();
  });

  it('rejects a short password', () => {
    expect(() => createUserSchema.parse({ body: { ...baseCreate, password: 'short' } })).toThrow();
  });

  it('rejects an invalid email', () => {
    expect(() =>
      createUserSchema.parse({ body: { ...baseCreate, email: 'not-an-email' } }),
    ).toThrow();
  });

  it('rejects an unknown role or a non-boolean status', () => {
    expect(() =>
      createUserSchema.parse({ body: { ...baseCreate, globalRole: 'SUPERADMIN' } }),
    ).toThrow();
    expect(() => createUserSchema.parse({ body: { ...baseCreate, isActive: 'false' } })).toThrow();
  });

  it('trims names and identification before validating', () => {
    const parsed = createUserSchema.parse({
      body: {
        ...baseCreate,
        firstName: '  Ana  ',
        lastName: ' Gomez ',
        identificationNumber: ' 8-888-1234 ',
      },
    });

    expect(parsed.body).toMatchObject({
      firstName: 'Ana',
      lastName: 'Gomez',
      identificationNumber: '8-888-1234',
    });
  });
});
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/users/users.schemas.test.ts`

Expected: FAIL porque `createUserSchema` no existe.

- [x] **Step 3: Implementar el esquema**

En `src/modules/users/users.schemas.ts`, agregar despues de `listUsersQuerySchema`:

```ts
export const createUserSchema = z.object({
  body: z
    .object({
      email: z.string().trim().email('Invalid email format.').max(254),
      password: z
        .string()
        .min(12, 'Password must be at least 12 characters.')
        .max(128, 'Password must not exceed 128 characters.'),
      firstName: trimmedString.min(2, 'First name must be at least 2 characters.').max(100),
      lastName: trimmedString.min(2, 'Last name must be at least 2 characters.').max(100),
      identificationNumber: trimmedString
        .min(5, 'Identification number must be at least 5 characters.')
        .max(30, 'Identification number must not exceed 30 characters.'),
      globalRole: z.enum(['USER', 'ADMIN'], 'Global role is invalid.').default('USER'),
      isActive: z.boolean().default(true),
      unitId: trimmedString
        .min(1, 'Unit ID is required.')
        .max(50, 'Unit ID must not exceed 50 characters.')
        .nullable()
        .optional(),
      careerId: trimmedString
        .min(1, 'Career ID is required.')
        .max(50, 'Career ID must not exceed 50 characters.')
        .optional(),
    })
    .strict()
    .meta({
      id: 'AdminUserCreate',
      description: 'Administrative payload used to create a user account.',
    }),
});

export type CreateUserSchemaBody = z.infer<typeof createUserSchema>['body'];
```

- [x] **Step 4: Verificar el verde**

Run: `pnpm exec vitest run src/modules/users/users.schemas.test.ts`

Expected: PASS.

### Task 2: Extraer `resolveOrganizationAssignment` (refactor sin cambio de comportamiento)

**Files:**

- Modify: `src/modules/users/users.service.ts`

- [x] **Step 1: Reemplazar el bloque de reglas organizacionales**

En `src/modules/users/users.service.ts`, eliminar la interfaz `ProfileUpdateData` y agregar, antes de `getProfile`, las interfaces y el helper:

```ts
interface OrganizationAssignment {
  unitId?: string | null;
  careerId?: string | null;
}

interface OrganizationContext {
  unitId: string | null;
  career: { unitId: string | null } | null;
}

interface OrganizationAssignmentInput {
  unitId?: string | null | undefined;
  careerId?: string | undefined;
}

const resolveOrganizationAssignment = async (
  prisma: ReturnType<typeof getPrismaClient>,
  input: OrganizationAssignmentInput,
  current: OrganizationContext | null,
): Promise<OrganizationAssignment> => {
  const data: OrganizationAssignment = {};

  if (input.unitId === null) {
    data.unitId = null;

    const otrosCareer = await prisma.career.findUnique({
      where: { code: OTROS_CAREER_CODE },
      select: { id: true },
    });

    if (!otrosCareer) {
      throw new ApiError(409, 'The global Otros career is not configured.');
    }

    if (input.careerId !== undefined && input.careerId !== otrosCareer.id) {
      throw new ApiError(
        400,
        'Only the Otros career is allowed when no organizational unit is selected.',
      );
    }

    data.careerId = otrosCareer.id;
    return data;
  }

  if (input.unitId !== undefined) {
    const unit = await prisma.organizationalUnit.findUnique({
      where: { id: input.unitId },
      select: { id: true, isActive: true },
    });

    if (!unit?.isActive) {
      throw new ApiError(400, 'Organizational unit is not available.');
    }

    data.unitId = unit.id;
  }

  if (input.careerId !== undefined) {
    const career = await prisma.career.findUnique({
      where: { id: input.careerId },
      select: { id: true, unitId: true },
    });

    if (!career) {
      throw new ApiError(400, 'Career not found.');
    }

    const effectiveUnitId = data.unitId ?? current?.unitId ?? null;

    if (career.unitId !== null && effectiveUnitId && career.unitId !== effectiveUnitId) {
      throw new ApiError(400, 'Career does not belong to the selected unit.');
    }

    if (career.unitId !== null && !effectiveUnitId) {
      data.unitId = career.unitId;
    }

    data.careerId = career.id;
  } else if (
    data.unitId !== undefined &&
    current?.career?.unitId != null &&
    current.career.unitId !== data.unitId
  ) {
    data.careerId = null;
  }

  return data;
};
```

- [x] **Step 2: Simplificar `updateProfile` para usar el helper**

El cuerpo de `updateProfile`, desde la busqueda de `currentUser` en adelante, queda asi:

```ts
export const updateProfile = async (
  userId: string,
  input: UpdateProfileInput,
): Promise<UserProfileResponse> => {
  const prisma = getPrismaClient();

  const currentUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      unitId: true,
      careerId: true,
      career: { select: { unitId: true } },
    },
  });

  if (!currentUser) {
    throw new ApiError(404, 'User not found.');
  }

  const data = await resolveOrganizationAssignment(prisma, input, currentUser);

  return prisma.user.update({
    where: { id: userId },
    data,
    select: profileSelect,
  });
};
```

- [x] **Step 3: Verificar que el refactor no cambia comportamiento**

Run: `pnpm exec vitest run src/modules/users/users.service.test.ts src/modules/users/users.routes.test.ts`

Expected: PASS con las pruebas 1.6 existentes (ninguna nueva).

### Task 3: Servicio `createUser` (TDD)

**Files:**

- Modify: `src/modules/users/users.types.ts`
- Modify: `src/modules/users/users.service.ts`
- Modify: `src/modules/users/users.service.test.ts`

- [x] **Step 1: Agregar el tipo de entrada**

En `src/modules/users/users.types.ts`, agregar despues de `UpdateProfileInput`:

```ts
export interface CreateUserInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  identificationNumber: string;
  globalRole: GlobalRole;
  isActive: boolean;
  unitId?: string | null | undefined;
  careerId?: string | undefined;
}
```

- [x] **Step 2: Extender el arnes de pruebas del servicio**

En `src/modules/users/users.service.test.ts`:

1. Reemplazar el bloque de imports/mocks inicial por:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { verifyPassword } from '../../lib/password.js';

interface UserModelMock {
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
}

interface OrganizationalUnitModelMock {
  findUnique: ReturnType<typeof vi.fn>;
}

interface CareerModelMock {
  findUnique: ReturnType<typeof vi.fn>;
}

interface AccountModelMock {
  create: ReturnType<typeof vi.fn>;
}

interface PrismaMock {
  user: UserModelMock;
  organizationalUnit: OrganizationalUnitModelMock;
  career: CareerModelMock;
  account: AccountModelMock;
  $transaction: ReturnType<typeof vi.fn>;
}

const sendVerificationEmailMock = vi.fn();

const createPrismaMock = (): PrismaMock => {
  const prisma: PrismaMock = {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    organizationalUnit: {
      findUnique: vi.fn(),
    },
    career: {
      findUnique: vi.fn(),
    },
    account: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (callback: (client: PrismaMock) => Promise<unknown>) => callback(prisma),
  );
  return prisma;
};

const loadService = async (prisma: PrismaMock) => {
  vi.resetModules();
  vi.doMock('../../config/prisma.js', () => ({
    getPrismaClient: () => prisma,
  }));
  vi.doMock('../../lib/auth.js', () => ({
    auth: { api: { sendVerificationEmail: sendVerificationEmailMock } },
  }));

  return import('./users.service.js');
};
```

1. Reemplazar el `afterEach` del `describe('users service')` por:

```ts
afterEach(() => {
  vi.doUnmock('../../config/prisma.js');
  vi.doUnmock('../../lib/auth.js');
  sendVerificationEmailMock.mockReset();
});
```

- [x] **Step 3: Escribir las pruebas rojas del servicio**

Agregar al final del `describe('users service')`:

```ts
const createInput = {
  email: 'ana.gomez@utp.ac.pa',
  password: 'SipegNueva2026*',
  firstName: 'Ana',
  lastName: 'Gomez',
  identificationNumber: '8-888-1234',
  globalRole: 'USER' as const,
  isActive: true,
};

it('creates the user and the credential account with an Argon2id hash', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(null);
  prisma.user.create.mockResolvedValue(adminUserRecord);
  const { createUser } = await loadService(prisma);

  const created = await createUser(createInput);

  expect(created).toEqual(adminUserRecord);
  expect(prisma.user.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      email: 'ana.gomez@utp.ac.pa',
      name: 'Ana Gomez',
      firstName: 'Ana',
      lastName: 'Gomez',
      identificationNumber: '8-888-1234',
      emailVerified: false,
      globalRole: 'USER',
      isActive: true,
      unitId: null,
      careerId: null,
    }),
    select: expect.objectContaining({ id: true, isActive: true }),
  });

  const accountArgs = prisma.account.create.mock.calls[0]?.[0] as {
    data: { id: string; accountId: string; providerId: string; userId: string; password: string };
  };
  expect(accountArgs.data.id).toEqual(expect.any(String));
  expect(accountArgs.data.accountId).toBe('user-001');
  expect(accountArgs.data.providerId).toBe('credential');
  expect(accountArgs.data.userId).toBe('user-001');
  expect(accountArgs.data.password.startsWith('$argon2id$')).toBe(true);
  expect(await verifyPassword(accountArgs.data.password, createInput.password)).toBe(true);
});

it('normalizes the email and sends the verification email', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(null);
  prisma.user.create.mockResolvedValue(adminUserRecord);
  const { createUser } = await loadService(prisma);

  await createUser({ ...createInput, email: '  Ana.Gomez@UTP.AC.PA  ' });

  expect(prisma.user.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ email: 'ana.gomez@utp.ac.pa' }) }),
  );
  expect(sendVerificationEmailMock).toHaveBeenCalledWith({
    body: { email: 'ana.gomez@utp.ac.pa' },
  });
});

it('rejects a duplicate email before writing', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockImplementation(({ where }: { where: { email?: string } }) =>
    Promise.resolve(where.email ? { id: 'existing' } : null),
  );
  const { createUser } = await loadService(prisma);

  await expect(createUser(createInput)).rejects.toMatchObject({
    statusCode: 409,
    message: 'Email is already registered.',
  });
  expect(prisma.user.create).not.toHaveBeenCalled();
  expect(prisma.account.create).not.toHaveBeenCalled();
});

it('rejects a duplicate identification number before writing', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockImplementation(
    ({ where }: { where: { email?: string; identificationNumber?: string } }) =>
      Promise.resolve(where.identificationNumber ? { id: 'existing' } : null),
  );
  const { createUser } = await loadService(prisma);

  await expect(createUser(createInput)).rejects.toMatchObject({
    statusCode: 409,
    message: 'Identification number is already registered.',
  });
  expect(prisma.user.create).not.toHaveBeenCalled();
});

it('rejects an unavailable organizational unit', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(null);
  prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-002', isActive: false });
  const { createUser } = await loadService(prisma);

  await expect(createUser({ ...createInput, unitId: 'unit-002' })).rejects.toMatchObject({
    statusCode: 400,
    message: 'Organizational unit is not available.',
  });
  expect(prisma.user.create).not.toHaveBeenCalled();
});

it('rejects an unknown career', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(null);
  prisma.career.findUnique.mockResolvedValue(null);
  const { createUser } = await loadService(prisma);

  await expect(createUser({ ...createInput, careerId: 'car-404' })).rejects.toMatchObject({
    statusCode: 400,
    message: 'Career not found.',
  });
  expect(prisma.user.create).not.toHaveBeenCalled();
});

it('rejects a career that does not belong to the selected unit', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(null);
  prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-001', isActive: true });
  prisma.career.findUnique.mockResolvedValue({ id: 'car-002', unitId: 'unit-002' });
  const { createUser } = await loadService(prisma);

  await expect(
    createUser({ ...createInput, unitId: 'unit-001', careerId: 'car-002' }),
  ).rejects.toMatchObject({
    statusCode: 400,
    message: 'Career does not belong to the selected unit.',
  });
  expect(prisma.user.create).not.toHaveBeenCalled();
});

it('derives the unit from the career when no unit is given', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(null);
  prisma.career.findUnique.mockResolvedValue({ id: 'car-002', unitId: 'unit-002' });
  prisma.user.create.mockResolvedValue(adminUserRecord);
  const { createUser } = await loadService(prisma);

  await createUser({ ...createInput, careerId: 'car-002' });

  expect(prisma.user.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ unitId: 'unit-002', careerId: 'car-002' }),
    }),
  );
});

it('forces the global OTROS career when the unit is null', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(null);
  prisma.career.findUnique.mockResolvedValue({ id: 'car-otros', unitId: null, code: 'OTROS' });
  prisma.user.create.mockResolvedValue(adminUserRecord);
  const { createUser } = await loadService(prisma);

  await createUser({ ...createInput, unitId: null });

  expect(prisma.user.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ unitId: null, careerId: 'car-otros' }),
    }),
  );
});

it('fails when the global OTROS career is not configured', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(null);
  prisma.career.findUnique.mockResolvedValue(null);
  const { createUser } = await loadService(prisma);

  await expect(createUser({ ...createInput, unitId: null })).rejects.toMatchObject({
    statusCode: 409,
    message: 'The global Otros career is not configured.',
  });
  expect(prisma.user.create).not.toHaveBeenCalled();
});

it('maps a unique constraint race to a conflict', async () => {
  const prisma = createPrismaMock();
  let emailLookups = 0;
  prisma.user.findUnique.mockImplementation(({ where }: { where: { email?: string } }) => {
    if (!where.email) return Promise.resolve(null);
    emailLookups += 1;
    return Promise.resolve(emailLookups > 1 ? { id: 'racer' } : null);
  });
  prisma.$transaction.mockRejectedValue(new Error('Unique constraint failed'));
  const { createUser } = await loadService(prisma);

  await expect(createUser(createInput)).rejects.toMatchObject({
    statusCode: 409,
    message: 'Email is already registered.',
  });
});

it('keeps the created user when the verification email fails', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(null);
  prisma.user.create.mockResolvedValue(adminUserRecord);
  sendVerificationEmailMock.mockRejectedValue(new Error('smtp down'));
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { createUser } = await loadService(prisma);

  await expect(createUser(createInput)).resolves.toEqual(adminUserRecord);
  expect(errorSpy).toHaveBeenCalledWith('Failed to send account verification email.');
  errorSpy.mockRestore();
});

it('selects only safe fields for the created user', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(null);
  prisma.user.create.mockResolvedValue(adminUserRecord);
  const { createUser } = await loadService(prisma);

  await createUser(createInput);

  const createArgs = prisma.user.create.mock.calls[0]?.[0] as {
    select: Record<string, unknown>;
  };
  expect(createArgs.select).toMatchObject({ id: true, isActive: true });
  expect(createArgs.select).not.toHaveProperty('name');
  expect(createArgs.select).not.toHaveProperty('accounts');
  expect(createArgs.select).not.toHaveProperty('password');
  expect(createArgs.select).not.toHaveProperty('passwordHash');
  expect(createArgs.select).not.toHaveProperty('emailVerified');
});
```

- [x] **Step 4: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/users/users.service.test.ts`

Expected: FAIL porque `createUser` no existe.

- [x] **Step 5: Implementar el servicio**

En `src/modules/users/users.service.ts`, actualizar el encabezado de imports:

```ts
import { randomUUID } from 'node:crypto';

import { getPrismaClient } from '../../config/prisma.js';
import { auth } from '../../lib/auth.js';
import { hashPassword } from '../../lib/password.js';
import { ApiError } from '../../utils/ApiError.js';
import type { ListUsersQuery } from './users.schemas.js';
import type {
  AdminUserResponse,
  CreateUserInput,
  PaginatedUsers,
  UpdateProfileInput,
  UserProfileResponse,
} from './users.types.js';
```

Agregar despues de `updateProfile`:

```ts
const sendAccountVerificationEmail = async (email: string): Promise<void> => {
  try {
    await auth.api.sendVerificationEmail({ body: { email } });
  } catch {
    console.error('Failed to send account verification email.');
  }
};

export const createUser = async (input: CreateUserInput): Promise<AdminUserResponse> => {
  const prisma = getPrismaClient();
  const email = input.email.trim().toLowerCase();

  const duplicateEmail = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (duplicateEmail) {
    throw new ApiError(409, 'Email is already registered.');
  }

  const duplicateIdentification = await prisma.user.findUnique({
    where: { identificationNumber: input.identificationNumber },
    select: { id: true },
  });
  if (duplicateIdentification) {
    throw new ApiError(409, 'Identification number is already registered.');
  }

  const organization = await resolveOrganizationAssignment(prisma, input, null);
  const passwordHash = await hashPassword(input.password);
  const name = `${input.firstName} ${input.lastName}`;

  let created: AdminUserResponse;

  try {
    created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name,
          firstName: input.firstName,
          lastName: input.lastName,
          identificationNumber: input.identificationNumber,
          email,
          emailVerified: false,
          globalRole: input.globalRole,
          isActive: input.isActive,
          unitId: organization.unitId ?? null,
          careerId: organization.careerId ?? null,
        },
        select: adminUserSelect,
      });

      await tx.account.create({
        data: {
          id: randomUUID(),
          accountId: user.id,
          providerId: 'credential',
          userId: user.id,
          password: passwordHash,
        },
      });

      return user;
    });
  } catch (error) {
    const [raceEmail, raceIdentification] = await Promise.all([
      prisma.user.findUnique({ where: { email }, select: { id: true } }),
      prisma.user.findUnique({
        where: { identificationNumber: input.identificationNumber },
        select: { id: true },
      }),
    ]);

    if (raceEmail) {
      throw new ApiError(409, 'Email is already registered.');
    }
    if (raceIdentification) {
      throw new ApiError(409, 'Identification number is already registered.');
    }

    throw error;
  }

  await sendAccountVerificationEmail(email);

  return created;
};
```

- [x] **Step 6: Verificar el verde**

Run: `pnpm exec vitest run src/modules/users/users.service.test.ts`

Expected: PASS.

### Task 4: Controlador y ruta admin (TDD)

**Files:**

- Modify: `src/modules/users/users.controller.ts`
- Modify: `src/modules/users/users.routes.ts`
- Modify: `src/modules/users/users.routes.test.ts`

- [x] **Step 1: Extender el arnes de pruebas de ruta**

En `src/modules/users/users.routes.test.ts`:

1. Actualizar imports de vitest:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
```

1. Reemplazar `interface PrismaMock` y `createPrismaMock` por:

```ts
interface PrismaMock {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  organizationalUnit: { findUnique: ReturnType<typeof vi.fn> };
  career: { findUnique: ReturnType<typeof vi.fn> };
  account: { create: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
}

const authApiMock = {
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
  getToken: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
  verifyEmail: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  sendVerificationEmail: vi.fn(),
};

const createPrismaMock = (): PrismaMock => {
  const prisma: PrismaMock = {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    organizationalUnit: { findUnique: vi.fn() },
    career: { findUnique: vi.fn() },
    account: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (callback: (client: PrismaMock) => Promise<unknown>) => callback(prisma),
  );
  return prisma;
};
```

1. Reemplazar el bloque `vi.doMock('../../lib/auth.js', ...)` dentro de `loadApp` por:

```ts
vi.doMock('../../lib/auth.js', () => ({ auth: { api: authApiMock } }));
```

- [x] **Step 2: Escribir las pruebas rojas de ruta**

Agregar dentro del `describe('users routes')`, antes del cierre:

```ts
beforeEach(() => {
  authApiMock.sendVerificationEmail.mockClear();
});

const createUserBody = {
  email: 'ana.gomez@utp.ac.pa',
  password: 'SipegCreado2026*',
  firstName: 'Ana',
  lastName: 'Gomez',
  identificationNumber: '8-888-1234',
  globalRole: 'USER',
  isActive: true,
};

it('rejects user creation without a token', async () => {
  const app = await loadApp(createPrismaMock());

  await request(app).post('/api/v1/admin/users').send(createUserBody).expect(401);
});

it('rejects user creation for non-admin users', async () => {
  const prisma = createPrismaMock();
  mockUserLookup(prisma);
  const app = await loadApp(prisma);

  const response = await request(app)
    .post('/api/v1/admin/users')
    .set('Authorization', `Bearer ${accessToken}`)
    .send(createUserBody)
    .expect(403);

  expect(response.body.message).toBe('Insufficient privileges for this resource.');
  expect(prisma.user.create).not.toHaveBeenCalled();
  expect(prisma.account.create).not.toHaveBeenCalled();
});

it('creates a user account for administrators', async () => {
  const prisma = createPrismaMock();
  mockUserLookup(prisma);
  prisma.user.create.mockResolvedValue(adminUserRecord);
  const app = await loadApp(prisma);

  const response = await request(app)
    .post('/api/v1/admin/users')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({ ...createUserBody, email: ' Ana.Gomez@UTP.AC.PA ' })
    .expect(201);

  expect(response.body.success).toBe(true);
  expect(response.body.message).toBe('User created successfully.');
  expect(response.body.data).toEqual(adminUserRecord);
  expect(prisma.user.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        email: 'ana.gomez@utp.ac.pa',
        emailVerified: false,
        globalRole: 'USER',
        isActive: true,
      }),
    }),
  );

  const accountArgs = prisma.account.create.mock.calls[0]?.[0] as {
    data: { accountId: string; providerId: string; password: string };
  };
  expect(accountArgs.data.accountId).toBe('user-001');
  expect(accountArgs.data.providerId).toBe('credential');
  expect(accountArgs.data.password.startsWith('$argon2id$')).toBe(true);
  expect(authApiMock.sendVerificationEmail).toHaveBeenCalledWith({
    body: { email: 'ana.gomez@utp.ac.pa' },
  });
});

it('honors role, status, unit and career overrides', async () => {
  const prisma = createPrismaMock();
  mockUserLookup(prisma);
  prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-001', isActive: true });
  prisma.career.findUnique.mockResolvedValue({ id: 'car-001', unitId: 'unit-001' });
  prisma.user.create.mockResolvedValue(adminUserRecord);
  const app = await loadApp(prisma);

  await request(app)
    .post('/api/v1/admin/users')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      ...createUserBody,
      globalRole: 'ADMIN',
      isActive: false,
      unitId: 'unit-001',
      careerId: 'car-001',
    })
    .expect(201);

  expect(prisma.user.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        globalRole: 'ADMIN',
        isActive: false,
        unitId: 'unit-001',
        careerId: 'car-001',
      }),
    }),
  );
});

it('does not expose internal or credential fields on creation', async () => {
  const prisma = createPrismaMock();
  mockUserLookup(prisma);
  prisma.user.create.mockResolvedValue(adminUserRecord);
  const app = await loadApp(prisma);

  const response = await request(app)
    .post('/api/v1/admin/users')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send(createUserBody)
    .expect(201);

  expect(JSON.stringify(response.body)).not.toContain('$argon2');
  expect(response.body.data).not.toHaveProperty('name');
  expect(response.body.data).not.toHaveProperty('accounts');
  expect(response.body.data).not.toHaveProperty('password');
  expect(response.body.data).not.toHaveProperty('passwordHash');
  expect(response.body.data).not.toHaveProperty('emailVerified');
});

it('rejects invalid user creation bodies without writing', async () => {
  const prisma = createPrismaMock();
  mockUserLookup(prisma);
  const app = await loadApp(prisma);

  for (const body of [
    { ...createUserBody, password: 'short' },
    { ...createUserBody, email: 'not-an-email' },
    { ...createUserBody, emailVerified: true },
    { ...createUserBody, globalRole: 'SUPERADMIN' },
  ]) {
    const response = await request(app)
      .post('/api/v1/admin/users')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send(body)
      .expect(400);

    expect(response.body.message).toBe('Validation error.');
  }

  expect(prisma.user.create).not.toHaveBeenCalled();
});

it('returns 409 for a duplicate email on creation', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockImplementation((args: { where: { id?: string; email?: string } }) => {
    if (args.where.email) return Promise.resolve({ id: 'existing-user' });
    return Promise.resolve(authUserRecords[args.where.id ?? ''] ?? null);
  });
  const app = await loadApp(prisma);

  const response = await request(app)
    .post('/api/v1/admin/users')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send(createUserBody)
    .expect(409);

  expect(response.body.message).toBe('Email is already registered.');
  expect(prisma.user.create).not.toHaveBeenCalled();
});

it('returns 409 for a duplicate identification number on creation', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockImplementation(
    (args: { where: { id?: string; identificationNumber?: string } }) => {
      if (args.where.identificationNumber) return Promise.resolve({ id: 'existing-user' });
      return Promise.resolve(authUserRecords[args.where.id ?? ''] ?? null);
    },
  );
  const app = await loadApp(prisma);

  const response = await request(app)
    .post('/api/v1/admin/users')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send(createUserBody)
    .expect(409);

  expect(response.body.message).toBe('Identification number is already registered.');
  expect(prisma.user.create).not.toHaveBeenCalled();
});
```

- [x] **Step 3: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/users/users.routes.test.ts`

Expected: FAIL con 404 en `POST /api/v1/admin/users` (la ruta no existe).

- [x] **Step 4: Implementar el controlador**

En `src/modules/users/users.controller.ts`, actualizar imports y agregar el handler:

```ts
import { requireAuthenticatedUser } from '../../middlewares/authenticate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { successResponse } from '../../utils/response.js';
import type {
  CreateUserSchemaBody,
  ListUsersQuery,
  UpdateProfileSchemaBody,
} from './users.schemas.js';
import {
  createUser as createUserService,
  getProfile,
  getUserById as getUserByIdService,
  listUsers as listUsersService,
  updateProfile,
} from './users.service.js';

export const createUser = asyncHandler(async (req, res) => {
  const body = req.body as CreateUserSchemaBody;
  const user = await createUserService(body);

  res.status(201).json(successResponse('User created successfully.', user));
});
```

- [x] **Step 5: Implementar la ruta**

En `src/modules/users/users.routes.ts`, registrar despues del `GET /admin/users`:

```ts
usersRoutes.post(
  '/admin/users',
  authenticate,
  requireAdmin,
  validate(createUserSchema),
  createUser,
);
```

Imports actualizados:

```ts
import { Router } from 'express';

import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { requireAdmin } from '../../middlewares/authorize.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import {
  createUser,
  getCurrentUser,
  getUser,
  listUsers,
  updateCurrentUser,
} from './users.controller.js';
import {
  adminUserParamsSchema,
  createUserSchema,
  listUsersQuerySchema,
  updateProfileSchema,
} from './users.schemas.js';
```

- [x] **Step 6: Verificar el verde**

Run: `pnpm exec vitest run src/modules/users/users.routes.test.ts`

Expected: PASS.

### Task 5: Contrato OpenAPI (TDD)

**Files:**

- Modify: `src/modules/users/users.openapi.ts`
- Modify: `src/docs/openapi.test.ts`
- Modify: `openapi.json` (generado)

- [x] **Step 1: Escribir las pruebas rojas del contrato**

En `src/docs/openapi.test.ts`, agregar `'POST /api/v1/admin/users'` a `expectedOperations` y los tests:

```ts
it('marks admin user creation with bearer security and a 201 response', () => {
  const operation = openApiDocument.paths?.['/api/v1/admin/users']?.post;

  expect(operation?.security).toEqual([{ bearerAuth: [] }]);
  expect(operation?.responses?.['201']).toBeDefined();
  expect(operation?.responses?.['400']).toBeDefined();
  expect(operation?.responses?.['401']).toBeDefined();
  expect(operation?.responses?.['403']).toBeDefined();
  expect(operation?.responses?.['409']).toBeDefined();
  expect(openApiDocument.components?.schemas).toHaveProperty('AdminUserCreate');
});

it('documents the admin user creation body', () => {
  const schema = openApiDocument.components?.schemas?.['AdminUserCreate'] as
    { properties?: Record<string, unknown>; required?: string[] } | undefined;

  expect(schema?.properties).toHaveProperty('email');
  expect(schema?.properties).toHaveProperty('password');
  expect(schema?.properties).toHaveProperty('unitId');
  expect(schema?.required).toEqual(
    expect.arrayContaining(['email', 'password', 'firstName', 'lastName', 'identificationNumber']),
  );
});
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/docs/openapi.test.ts`

Expected: FAIL porque la operacion `post` no existe.

- [x] **Step 3: Documentar la ruta**

En `src/modules/users/users.openapi.ts`, importar `createUserSchema` y agregar la operacion `post` dentro de `/api/v1/admin/users` (despues del `get`):

```ts
    post: {
      tags: ['Admin'],
      summary: 'Create a user',
      description:
        'Administrative user creation. Requires the ADMIN role. Creates the credential account with Argon2id and sends a verification email; the account cannot sign in until the email is verified.',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: createUserSchema.shape.body } },
      },
      responses: {
        201: {
          description: 'Created user account.',
          content: { 'application/json': { schema: apiSuccessResponse(adminUserSchema) } },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        409: errorResponse,
      },
    },
```

Import actualizado:

```ts
import {
  adminUserParamsSchema,
  adminUserSchema,
  createUserSchema,
  listUsersQuerySchema,
  paginatedUsersSchema,
  updateProfileSchema,
  userProfileSchema,
} from './users.schemas.js';
```

- [x] **Step 4: Regenerar y verificar el contrato**

Run:

```bash
pnpm run docs:generate
pnpm exec vitest run src/docs/openapi.test.ts
pnpm run docs:check
```

Expected: `openapi.json` con la operacion `POST /api/v1/admin/users` y el componente `AdminUserCreate`; tests y check en verde.

### Task 6: Bruno con assertions y casos 401/403/409

**Files:**

- Create: `bruno/Admin/Create user.bru`
- Create: `bruno/Admin/Create duplicate user returns 409.bru`
- Create: `bruno/Admin/Create user as USER returns 403.bru`
- Create: `bruno/Admin/Create user without a token returns 401.bru`

- [x] **Step 1: Crear el caso 201**

`bruno/Admin/Create user.bru` (seq 7, despues de `Get unknown user returns 404`):

```bru
meta {
  name: Create user
  type: http
  seq: 7
  tags: [
    Admin
  ]
}

post {
  url: {{baseUrl}}/api/v1/admin/users
  body: json
  auth: bearer
}

auth:bearer {
  token: {{adminToken}}
}

body:json {
  {
    "email": "{{createdUserEmail}}",
    "password": "SipegCreado2026*",
    "firstName": "Creado",
    "lastName": "PorAdmin",
    "identificationNumber": "{{createdUserIdentification}}",
    "globalRole": "USER",
    "isActive": true,
    "unitId": "seed_unit_fic",
    "careerId": "seed_career_fic-civ"
  }
}

script:pre-request {
  const suffix = bru.interpolate("{{$randomInt}}");
  bru.setVar("createdUserEmail", `creado.admin.${suffix}.${Date.now()}@utp.ac.pa`);
  bru.setVar("createdUserIdentification", `9-${Date.now()}-${suffix}`);
}

tests {
  test("admin creates an unverified user account", function () {
    expect(res.getStatus()).to.equal(201);
    const body = res.getBody();
    expect(body.success).to.equal(true);
    expect(body.message).to.equal("User created successfully.");
    expect(body.data).to.have.property("id");
    expect(body.data.email).to.equal(bru.getVar("createdUserEmail"));
    expect(body.data.globalRole).to.equal("USER");
    expect(JSON.stringify(body)).to.not.include("$argon2");
    expect(body.data).to.not.have.property("name");
    expect(body.data).to.not.have.property("accounts");
    expect(body.data).to.not.have.property("password");
    expect(body.data).to.not.have.property("passwordHash");
    expect(body.data).to.not.have.property("emailVerified");
    bru.setVar("createdUserId", body.data.id);
  });
}
```

- [x] **Step 2: Crear el caso 409 reutilizando el email del paso 1**

`bruno/Admin/Create duplicate user returns 409.bru`:

```bru
meta {
  name: Create duplicate user returns 409
  type: http
  seq: 8
  tags: [
    Admin
  ]
}

post {
  url: {{baseUrl}}/api/v1/admin/users
  body: json
  auth: bearer
}

auth:bearer {
  token: {{adminToken}}
}

body:json {
  {
    "email": "{{createdUserEmail}}",
    "password": "SipegCreado2026*",
    "firstName": "Duplicado",
    "lastName": "PorAdmin",
    "identificationNumber": "{{duplicateUserIdentification}}",
    "globalRole": "USER",
    "isActive": true
  }
}

script:pre-request {
  const suffix = bru.interpolate("{{$randomInt}}");
  bru.setVar("duplicateUserIdentification", `8-${Date.now()}-${suffix}`);
}

tests {
  test("duplicate emails produce a 409", function () {
    expect(res.getStatus()).to.equal(409);
    const body = res.getBody();
    expect(body.success).to.equal(false);
    expect(body.message).to.equal("Email is already registered.");
  });
}
```

- [x] **Step 3: Crear los casos 403 y 401**

`bruno/Admin/Create user as USER returns 403.bru`:

```bru
meta {
  name: Create user as USER returns 403
  type: http
  seq: 9
  tags: [
    Admin
  ]
}

post {
  url: {{baseUrl}}/api/v1/admin/users
  body: json
  auth: bearer
}

auth:bearer {
  token: {{regularToken}}
}

body:json {
  {
    "email": "{{forbiddenUserEmail}}",
    "password": "SipegCreado2026*",
    "firstName": "Sin",
    "lastName": "Permiso",
    "identificationNumber": "{{forbiddenUserIdentification}}"
  }
}

script:pre-request {
  const suffix = bru.interpolate("{{$randomInt}}");
  bru.setVar("forbiddenUserEmail", `prohibido.admin.${suffix}.${Date.now()}@utp.ac.pa`);
  bru.setVar("forbiddenUserIdentification", `7-${Date.now()}-${suffix}`);
}

tests {
  test("USER role cannot create users", function () {
    expect(res.getStatus()).to.equal(403);
    expect(res.getBody().message).to.equal("Insufficient privileges for this resource.");
  });
}
```

`bruno/Admin/Create user without a token returns 401.bru`:

```bru
meta {
  name: Create user without a token returns 401
  type: http
  seq: 10
  tags: [
    Admin
  ]
}

post {
  url: {{baseUrl}}/api/v1/admin/users
  body: json
  auth: none
}

body:json {
  {
    "email": "{{forbiddenUserEmail}}",
    "password": "SipegCreado2026*",
    "firstName": "Sin",
    "lastName": "Token",
    "identificationNumber": "{{forbiddenUserIdentification}}"
  }
}

tests {
  test("anonymous requests cannot create users", function () {
    expect(res.getStatus()).to.equal(401);
  });
}
```

- [x] **Step 4: Ejecutar la carpeta**

Run: `pnpm --dir bruno exec bru run Admin --env local`

Expected: 10/10 requests y 14/14 tests en verde (los casos 7-10 se suman a los 6 existentes). El script de captura de tokens del login de `Auth` no se modifica. Si se corrio Bruno en el ultimo minuto, esperar 60 s para no compartir los buckets de login.

### Task 7: Verificacion real contra el stack local

**Files:**

- Create temporal: `.tmp-f110-integration.mts` (se elimina al terminar)

- [x] **Step 1: Confirmar el stack y los datos**

Run:

```bash
docker compose -f compose.dev.yaml ps --format '{{.Name}} {{.Status}}'
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg_utp -c "SELECT id, code FROM organizational_units WHERE id = 'seed_unit_fic';"
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg_utp -c "SELECT id, code, unit_id FROM careers WHERE id = 'seed_career_fic-civ';"
```

Expected: api/db/mailpit arriba; unidad `FIC` activa y carrera `fic-civ` ligada a `seed_unit_fic`.

- [x] **Step 2: Ejecutar la verificacion**

Contenido de `.tmp-f110-integration.mts` (login admin, creacion, conflicto, ciclo de verificacion por Mailpit y limpieza; sin imprimir tokens):

```ts
import 'dotenv/config';

import argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './src/generated/prisma/client.js';

const baseUrl = 'http://localhost:3000';
const mailpitUrl = 'http://localhost:8025';

interface LoginResponse {
  data?: { accessToken?: string };
}

const login = async (email: string): Promise<string> => {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Sipeg2026*UTP' }),
  });

  if (response.status !== 200) {
    throw new Error(`Login failed for ${email}: ${response.status}`);
  }

  const body = (await response.json()) as LoginResponse;
  const token = body.data?.accessToken;
  if (!token) {
    throw new Error(`Login for ${email} did not return an access token.`);
  }

  return token;
};

const api = async (method: string, path: string, token: string | null, body?: unknown) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  return { status: response.status, body: (await response.json()) as Record<string, any> };
};

const loginNewUser = async (email: string, password: string) =>
  fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

const adminToken = await login('admin@utp.ac.pa');
const userToken = await login('organizador.fic@utp.ac.pa');

const suffix = `${Date.now()}`;
const newUser = {
  email: `creado.f110.${suffix}@utp.ac.pa`,
  password: 'CreadoF110*UTP',
  firstName: 'Cuenta',
  lastName: 'Creada',
  identificationNumber: `6-${suffix}`,
  globalRole: 'USER',
  isActive: true,
  unitId: 'seed_unit_fic',
  careerId: 'seed_career_fic-civ',
};

const results: string[] = [];

const anonymous = await api('POST', '/api/v1/admin/users', null, newUser);
if (anonymous.status !== 401) throw new Error(`anonymous -> ${anonymous.status}`);
results.push('sin token -> 401');

const forbidden = await api('POST', '/api/v1/admin/users', userToken, newUser);
if (forbidden.status !== 403) throw new Error(`USER -> ${forbidden.status}`);
results.push('USER -> 403');

const created = await api('POST', '/api/v1/admin/users', adminToken, newUser);
if (created.status !== 201 || created.body.data?.email !== newUser.email) {
  throw new Error(`create -> ${created.status} ${JSON.stringify(created.body)}`);
}
const createdId = created.body.data.id as string;
const serialized = JSON.stringify(created.body);
for (const forbiddenField of ['$argon2', 'passwordHash', '"accounts"', 'emailVerified', '"name"']) {
  if (serialized.includes(forbiddenField)) throw new Error(`leak: ${forbiddenField}`);
}
results.push(`201 id=${createdId}`);

const connectionString = process.env['DATABASE_URL'] ?? '';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const account = await prisma.account.findFirst({
  where: { userId: createdId },
  select: { providerId: true, password: true },
});
if (account?.providerId !== 'credential' || !account.password?.startsWith('$argon2id$')) {
  throw new Error('Credential account missing or not hashed with Argon2id.');
}
if (!(await argon2.verify(account.password, newUser.password))) {
  throw new Error('Argon2id verification failed for the stored hash.');
}
results.push('accounts.provider_id=credential y Argon2id verificado');

const storedUser = await prisma.user.findUnique({
  where: { id: createdId },
  select: { emailVerified: true, globalRole: true, isActive: true, unitId: true, careerId: true },
});
if (
  storedUser?.emailVerified !== false ||
  storedUser.globalRole !== 'USER' ||
  storedUser.unitId !== 'seed_unit_fic' ||
  storedUser.careerId !== 'seed_career_fic-civ'
) {
  throw new Error(`Stored user mismatch: ${JSON.stringify(storedUser)}`);
}
results.push('users.email_verified=false con rol, estado, unidad y carrera correctos');

const duplicateEmail = await api('POST', '/api/v1/admin/users', adminToken, {
  ...newUser,
  identificationNumber: `5-${suffix}`,
});
if (
  duplicateEmail.status !== 409 ||
  duplicateEmail.body.message !== 'Email is already registered.'
) {
  throw new Error(`duplicate email -> ${duplicateEmail.status}`);
}
results.push('email duplicado -> 409');

const duplicateIdentification = await api('POST', '/api/v1/admin/users', adminToken, {
  ...newUser,
  email: `creado.f110.otro.${suffix}@utp.ac.pa`,
});
if (
  duplicateIdentification.status !== 409 ||
  duplicateIdentification.body.message !== 'Identification number is already registered.'
) {
  throw new Error(`duplicate identification -> ${duplicateIdentification.status}`);
}
results.push('identificacion duplicada -> 409');

const invalidUnit = await api('POST', '/api/v1/admin/users', adminToken, {
  ...newUser,
  email: `creado.f110.unidad.${suffix}@utp.ac.pa`,
  identificationNumber: `4-${suffix}`,
  unitId: 'unit-does-not-exist',
});
if (invalidUnit.status !== 400) throw new Error(`invalid unit -> ${invalidUnit.status}`);
results.push('unidad invalida -> 400');

const unverifiedLogin = await loginNewUser(newUser.email, newUser.password);
if (unverifiedLogin.status !== 403) {
  throw new Error(`unverified login -> ${unverifiedLogin.status}`);
}
results.push('login sin verificar -> 403');

interface MailpitMessage {
  ID: string;
  To: { Address: string }[];
}

const messagesResponse = await fetch(`${mailpitUrl}/api/v1/messages`);
const messagesBody = (await messagesResponse.json()) as { messages?: MailpitMessage[] };
const message = (messagesBody.messages ?? []).find((item) =>
  item.To.some((to) => to.Address.toLowerCase() === newUser.email),
);
if (!message) throw new Error('Verification email not found in Mailpit.');

const messageResponse = await fetch(`${mailpitUrl}/api/v1/message/${message.ID}`);
const messageBody = (await messageResponse.json()) as { Text?: string };
const tokenMatch = /token=([^&\s]+)/.exec(messageBody.Text ?? '');
if (!tokenMatch?.[1]) throw new Error('Verification token not found in the email body.');

const verified = await api('POST', '/api/v1/auth/verify-email', null, {
  token: decodeURIComponent(tokenMatch[1]),
});
if (verified.status !== 200) throw new Error(`verify -> ${verified.status}`);
results.push('email verificado -> 200');

const verifiedLogin = await loginNewUser(newUser.email, newUser.password);
if (verifiedLogin.status !== 200) throw new Error(`verified login -> ${verifiedLogin.status}`);
results.push('login verificado -> 200');

await prisma.session.deleteMany({ where: { userId: createdId } });
await prisma.account.deleteMany({ where: { userId: createdId } });
await prisma.user.delete({ where: { id: createdId } });
await prisma.$disconnect();

const remaining = await fetch(`${baseUrl}/api/v1/admin/users/${createdId}`, {
  headers: { Authorization: `Bearer ${adminToken}` },
});
if (remaining.status !== 404) throw new Error(`cleanup left the user behind: ${remaining.status}`);
results.push('filas temporales eliminadas -> 404');

console.log(results.join('\n'));
```

Run: `pnpm exec tsx .tmp-f110-integration.mts`

Expected: todas las lineas de verificacion sin errores y sin tokens impresos.

- [x] **Step 3: Contrastar contra la BD**

Run:

```bash
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg_utp -c "SELECT count(*) FROM users WHERE email LIKE 'creado.f110.%@utp.ac.pa';"
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg_utp -c "SELECT count(*) FROM accounts WHERE provider_id = 'credential' AND password LIKE '\$argon2id\$%';"
```

Expected: `0` usuarios temporales restantes y los hashes de cuentas credencial siguen en Argon2id.

- [x] **Step 4: Eliminar el script temporal**

Run: `rm .tmp-f110-integration.mts`

Expected: el arbol no conserva artefactos temporales nuevos.

### Task 8: Calidad completa, documentacion y cierre

**Files:**

- Modify: `README.md`
- Modify: `CONTEXT.md`
- Modify: `docs/superpowers/plans/2026-09-20-fase-1-10-crear-usuario-admin.md`
- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [x] **Step 1: Documentar el endpoint**

En `README.md`, agregar junto a los endpoints de usuarios:

```md
- `POST /api/v1/admin/users` (solo `ADMIN`) crea la cuenta y su credencial Argon2id en una transaccion, valida conflictos de email e identificacion (`409`) y envia el correo de verificacion; la cuenta no puede iniciar sesion hasta verificar el email.
```

En `CONTEXT.md`, agregar la misma idea en la seccion de usuarios.

- [x] **Step 2: Ejecutar los comandos de calidad**

Run:

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run format:check
pnpm run docs:check
```

Expected: todos en verde. Aplicar `pnpm exec prettier --write` a los archivos tocados si `format:check` falla.

- [x] **Step 3: Registrar evidencia y cerrar 1.10**

Marcar las tareas de este plan, marcar 1.10 en el maestro, actualizar la tabla de estado y agregar el registro con conteos de pruebas, evidencia real, resultados de Bruno y hallazgos. Si 1.9 sigue sin registro, cerrarla tambien con su evidencia existente. No hacer commit: el usuario no lo solicito.

---

## Threat model resumido

- **BFLA:** `authenticate -> requireAdmin` responde 401/403 antes de validar body y antes de tocar Prisma; USER no puede crear cuentas ni escalar roles.
- **Mass assignment:** body `.strict()` rechaza `id`, `emailVerified` y cualquier campo no declarado; el servicio fija `emailVerified: false` siempre.
- **Fuga de datos:** la respuesta usa `adminUserSelect`; el hash Argon2id vive solo en `accounts.password` y no se devuelve ni se loguea.
- **Duplicados/carrera:** pre-chequeo normalizado de email e identificacion + re-chequeo post-carrera para mapear P2002 a 409.
- **Creacion parcial:** `users` + `accounts` en una transaccion; un fallo no deja cuentas sin credencial.
- **Abuso del correo:** el envio usa el flujo oficial de Better Auth, no bloquea la respuesta y los fallos se registran sin PII ni tokens.
- **Enumeracion:** `409` solo para un ADMIN autenticado; el flujo publico de registro conserva su respuesta generica.

## Self-review

- Cobertura 1.10: creacion de `users` y `accounts` con Argon2id, conflictos de email e identificacion, rol/estado/unidad/carrera, verificacion de email y contrato/Bruno/documentacion.
- Sin migraciones, variables de entorno ni breaking changes de componentes OpenAPI; se agrega `AdminUserCreate` y la operacion `POST`.
- El refactor de `resolveOrganizationAssignment` mantiene las reglas 1.6 y deja el helper listo para 1.11.
- La verificacion real comprueba Argon2id con `argon2.verify`, `emailVerified=false`, bloqueo de login 403, correo real por Mailpit, verificacion 200, login 200 y limpieza de filas temporales.

---

## Registro de cierre (2026-09-20)

- [x] TDD con rojos verificados: esquema (3 fallos por `createUserSchema` inexistente), servicio (13 por `createUser` inexistente), rutas (8 con 404 en `POST /api/v1/admin/users`) y contrato (3 por operacion/componente ausentes).
- [x] Implementacion: `createUserSchema` estricto (`AdminUserCreate`), `CreateUserInput`, extraccion de `resolveOrganizationAssignment` reutilizada por perfil y creacion, `createUser` con pre-chequeos normalizados, transaccion `users` + `accounts` con `hashPassword`, re-chequeo post-carrera para `P2002 -> 409` y `auth.api.sendVerificationEmail` tolerante a fallos; `POST /api/v1/admin/users` con `authenticate -> requireAdmin -> validate -> controlador`.
- [x] 1.10 suma 30 pruebas nuevas: 7 esquema, 13 servicio, 8 ruta y 2 contrato; suite dirigida `src/modules/users src/docs` 160 en 6 archivos (convive con las pruebas de 1.11) y `pnpm test` 492 en 35 archivos en verde.
- [x] Verificacion real (Docker dev + Mailpit, script temporal eliminado): 401 sin token, 403 con USER, 201 con DTO seguro, `accounts.provider_id=credential` y `argon2.verify=true` sobre el hash `$argon2id$`, `users.email_verified=false` con rol/estado/unidad/carrera correctos, email duplicado 409, identificacion duplicada 409, unidad inexistente 400, login sin verificar 403, token extraido de Mailpit -> `verify-email` 200 -> login 200 y limpieza verificada con 404. `SELECT count(*)` de usuarios temporales = 0.
- [x] Bruno: nuevos `Admin/Create user` (seq 7), `Create duplicate user returns 409` (8), `Create user as USER returns 403` (9) y `Create user without a token returns 401` (10); `bru run Admin --env local` 10/10 requests y 11/11 tests.
- [x] Contrato: `docs:generate` y `docs:check` sin drift; operacion `POST`, 201/400/401/403/409 y componente `AdminUserCreate` documentados.
- [x] Documentacion: README y CONTEXT describen la creacion administrativa, la verificacion obligatoria y los conflictos.
- [x] Hallazgos: `F1.10-A` `auth.api.sendVerificationEmail` aplica un piso constante de 500 ms por llamado (anti-enumeracion), por eso la creacion tarda ~0.7 s; `F1.10-B` el token de verificacion es un JWT firmado y no una fila en `verification`, asi que la extraccion E2E debe salir del correo (Mailpit); `F1.10-C` no existe endpoint de reenvio de verificacion; si el correo se pierde, el administrador no puede reenviarlo desde la API (diferido, Better Auth expone `send-verification-email`).
- [x] Concurrencia: los workstreams de 1.11 y 2.A editaron el mismo modulo en paralelo; se restauro el import de `createUserSchema` que 1.11 dejo fuera en `users.schemas.test.ts` y se corrigio `snapshot['id']` en `users.routes.test.ts(229)` (TS4111 del helper de 1.11, sin cambio de comportamiento). Gates finales globales en verde: `pnpm test` 492 en 35 archivos, `typecheck`, `lint`, `build`, `format:check` y `docs:check`.
- [x] Correccion operativa: la BD del stack dev es `sipeg_utp` (los comandos psql de este plan se ajustaron en ejecucion).
- [x] Sin commit: el usuario no lo solicito.
