# Fase 1.11 - Actualizar usuario (`PATCH /api/v1/admin/users/:id`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar el checklist 1.11 del plan maestro con `PATCH /api/v1/admin/users/:id`: solo `ADMIN`, permite `globalRole`, `isActive`, `unitId` y `careerId`, revoca sesiones al desactivar y bloquea autodesactivación, autodegradación y la pérdida del último administrador activo.

**Architecture:** Se sigue el patrón 1.8/1.9 (`authenticate -> requireAdmin -> validate -> controller -> service -> Prisma`). La validación carrera/unidad de `updateProfile` se extrae a un helper compartido para no duplicar reglas. La mutación (`user.update` + `session.deleteMany`) corre en `prisma.$transaction` interactiva, como `changePassword` de 1.7. Se reutilizan `adminUserSelect`, `adminUserSchema`/`AdminUser` y `adminUserParamsSchema`, sin componentes OpenAPI nuevos.

**Tech Stack:** TypeScript 6, Express 5, Prisma 7, Zod 4, Vitest, Supertest, OpenAPI 3.1, Bruno, PostgreSQL.

**Hallazgos de partida (2026-09-20):**

- 1.10 (`POST /admin/users`) queda **fuera de alcance** por decisión del usuario; 1.11 no depende de él.
- `src/modules/users/` tiene `GET/PATCH /users/me`, `GET /admin/users` y `GET /admin/users/:id` (96 pruebas dirigidas con `src/docs`), todas en verde.
- `updateProfile` (`users.service.ts:58`) ya contiene la lógica de unidad/carrera (incluye `unitId: null` → carrera global `Otros`, 409 si no existe).
- `adminUserSelect` (`users.service.ts:22`) ya es el DTO seguro; `adminUserSchema` (`AdminUser`) ya está documentado.
- `session.deleteMany({ where: { userId } })` es el mecanismo de revocación server-side; `authenticate` ya responde 403 a cuentas desactivadas.
- **Decisión del usuario:** autodesactivación y **autodegradación siempre prohibidas** (409), aunque existan otros admins.
- Con ambas auto-protecciones, la guarda del último admin es defensa en profundidad: con un actor `ADMIN` activo, `count` de otros admins activos siempre es ≥ 1 cuando el objetivo es otro usuario. Se implementa y se cubre con pruebas unitarias, pero no es alcanzable vía API hoy (se documenta).
- Sin migraciones, sin variables de entorno nuevas, sin cambios en Prisma.
- Trabajo concurrente sin commitear en `src/modules/auth/` y `src/modules/users/`; si un gate global falla solo por eso, se documentará con gates dirigidos.
- Sin pasos de commit: el repo no commitea sin pedido explícito del usuario (convención de los registros 1.1-1.9).

---

### Task 1: Esquema Zod del PATCH admin (TDD)

**Files:**

- Modify: `src/modules/users/users.schemas.ts`
- Modify: `src/modules/users/users.schemas.test.ts`

- [x] **Step 1: Escribir las pruebas rojas del esquema**

Agregar al final de `src/modules/users/users.schemas.test.ts`:

```ts
describe('updateAdminUserSchema', () => {
  it('accepts role, status, unit and career updates', () => {
    const parsed = updateAdminUserSchema.parse({
      params: { id: ' user-001 ' },
      body: { globalRole: 'ADMIN', isActive: false, unitId: 'unit-001', careerId: 'car-001' },
    });

    expect(parsed).toEqual({
      params: { id: 'user-001' },
      body: { globalRole: 'ADMIN', isActive: false, unitId: 'unit-001', careerId: 'car-001' },
    });
  });

  it('accepts a null unit to select the Otro option', () => {
    const parsed = updateAdminUserSchema.parse({
      params: { id: 'user-001' },
      body: { unitId: null },
    });

    expect(parsed.body.unitId).toBeNull();
  });

  it('rejects an empty body', () => {
    expect(() => updateAdminUserSchema.parse({ params: { id: 'user-001' }, body: {} })).toThrow(
      'At least one field must be provided.',
    );
  });

  it('strips unknown fields and rejects a body with only unknown fields', () => {
    expect(() =>
      updateAdminUserSchema.parse({
        params: { id: 'user-001' },
        body: { firstName: 'Ana' },
      }),
    ).toThrow('At least one field must be provided.');

    const parsed = updateAdminUserSchema.parse({
      params: { id: 'user-001' },
      body: { isActive: true, firstName: 'Ana' },
    });

    expect(parsed.body).toEqual({ isActive: true });
  });

  it('rejects invalid update values', () => {
    expect(() =>
      updateAdminUserSchema.parse({
        params: { id: 'user-001' },
        body: { globalRole: 'SUPERADMIN' },
      }),
    ).toThrow();
    expect(() =>
      updateAdminUserSchema.parse({ params: { id: 'user-001' }, body: { isActive: 'yes' } }),
    ).toThrow();
    expect(() =>
      updateAdminUserSchema.parse({ params: { id: 'user-001' }, body: { unitId: '' } }),
    ).toThrow();
    expect(() =>
      updateAdminUserSchema.parse({
        params: { id: 'user-001' },
        body: { careerId: 'a'.repeat(51) },
      }),
    ).toThrow();
  });
});
```

Actualizar el import del encabezado:

```ts
import {
  adminUserParamsSchema,
  adminUserSchema,
  listUsersQuerySchema,
  updateAdminUserSchema,
  updateProfileSchema,
  userProfileSchema,
} from './users.schemas.js';
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/users/users.schemas.test.ts`
Expected: FAIL porque `updateAdminUserSchema` no existe.

- [x] **Step 3: Implementar el esquema**

En `src/modules/users/users.schemas.ts`, agregar después de `adminUserParamsSchema`:

```ts
export const updateAdminUserSchema = z.object({
  params: adminUserParamsSchema.shape.params,
  body: z
    .object({
      globalRole: z.enum(['USER', 'ADMIN'], 'Global role is invalid.').optional(),
      isActive: z.boolean('Status must be true or false.').optional(),
      unitId: trimmedString.min(1, 'Unit ID is required.').max(50).nullable().optional().meta({
        description:
          'Organizational unit identifier. Send null to select the "Otro" option, which forces the global "Otros" career.',
      }),
      careerId: trimmedString.min(1, 'Career ID is required.').max(50).optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field must be provided.',
    }),
});

export type UpdateAdminUserBody = z.infer<typeof updateAdminUserSchema>['body'];
```

- [x] **Step 4: Verificar el verde**

Run: `pnpm exec vitest run src/modules/users/users.schemas.test.ts`
Expected: PASS.

### Task 2: Extraer el helper de unidad/carrera (refactor sin cambio de contrato)

**Files:**

- Modify: `src/modules/users/users.service.ts`

- [x] **Step 1: Agregar interfaces y helper**

En `src/modules/users/users.service.ts`, después de `ProfileUpdateData`:

```ts
interface OrganizationUpdateInput {
  unitId?: string | null | undefined;
  careerId?: string | undefined;
}

interface OrganizationSnapshot {
  unitId: string | null;
  career: { unitId: string | null } | null;
}

type OrganizationUpdateData = Pick<ProfileUpdateData, 'unitId' | 'careerId'>;

const resolveOrganizationUpdate = async (
  prisma: ReturnType<typeof getPrismaClient>,
  current: OrganizationSnapshot,
  input: OrganizationUpdateInput,
): Promise<OrganizationUpdateData> => {
  const data: OrganizationUpdateData = {};

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

    const effectiveUnitId = data.unitId ?? current.unitId;

    if (career.unitId !== null && effectiveUnitId && career.unitId !== effectiveUnitId) {
      throw new ApiError(400, 'Career does not belong to the selected unit.');
    }

    if (career.unitId !== null && !effectiveUnitId) {
      data.unitId = career.unitId;
    }

    data.careerId = career.id;
    return data;
  }

  if (
    data.unitId !== undefined &&
    current.career?.unitId != null &&
    current.career.unitId !== data.unitId
  ) {
    data.careerId = null;
  }

  return data;
};
```

- [x] **Step 2: Reescribir `updateProfile` para usar el helper**

Reemplazar el cuerpo desde `const data: ProfileUpdateData = {};` hasta el `return prisma.user.update(...)` por:

```ts
const data: ProfileUpdateData = {};

if (input.firstName !== undefined) {
  data.firstName = input.firstName;
}

if (input.lastName !== undefined) {
  data.lastName = input.lastName;
}

Object.assign(data, await resolveOrganizationUpdate(prisma, currentUser, input));

return prisma.user.update({
  where: { id: userId },
  data,
  select: profileSelect,
});
```

Conservar el `select` del `findUnique` de `updateProfile` **con** `careerId: true` (`users.routes.test.ts` usa esa clave como discriminador del mock).

- [x] **Step 3: Verificar que el refactor no rompe nada**

Run: `pnpm exec vitest run src/modules/users/users.service.test.ts src/modules/users/users.routes.test.ts`
Expected: PASS (las 12 pruebas de organización de `updateProfile` siguen verdes).

### Task 3: Servicio `updateAdminUser` (TDD)

**Files:**

- Modify: `src/modules/users/users.types.ts`
- Modify: `src/modules/users/users.service.ts`
- Modify: `src/modules/users/users.service.test.ts`

- [x] **Step 1: Extender los mocks y escribir las pruebas rojas**

En `src/modules/users/users.service.test.ts`:

1. Reemplazar las interfaces y `createPrismaMock` por:

```ts
interface SessionModelMock {
  deleteMany: ReturnType<typeof vi.fn>;
}

interface PrismaMock {
  user: UserModelMock;
  organizationalUnit: OrganizationalUnitModelMock;
  career: CareerModelMock;
  session: SessionModelMock;
  $transaction: ReturnType<typeof vi.fn>;
}

const createPrismaMock = (): PrismaMock => {
  const prisma: PrismaMock = {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    organizationalUnit: {
      findUnique: vi.fn(),
    },
    career: {
      findUnique: vi.fn(),
    },
    session: {
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  prisma.$transaction.mockImplementation((callback: (tx: PrismaMock) => Promise<unknown>) =>
    callback(prisma),
  );

  return prisma;
};
```

1. Declarar junto a `adminUserRecord`:

```ts
const updateTargetRecord = {
  id: 'user-target',
  globalRole: 'USER',
  isActive: true,
  unitId: 'unit-001',
  career: { unitId: 'unit-001' },
};

const activeAdminRecord = {
  id: 'user-admin-target',
  globalRole: 'ADMIN',
  isActive: true,
  unitId: null,
  career: null,
};
```

1. Agregar al final del `describe('users service')`:

```ts
it('updates role and status and returns the administrative view', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(updateTargetRecord);
  prisma.user.update.mockResolvedValue({
    ...adminUserRecord,
    globalRole: 'ADMIN',
    isActive: false,
  });
  const { updateAdminUser } = await loadService(prisma);

  const updated = await updateAdminUser('user-admin', 'user-target', {
    globalRole: 'ADMIN',
    isActive: false,
  });

  expect(updated.globalRole).toBe('ADMIN');
  expect(updated.isActive).toBe(false);
  expect(prisma.user.update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 'user-target' },
      data: { globalRole: 'ADMIN', isActive: false },
    }),
  );
});

it('deletes every session of a deactivated user inside a transaction', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(updateTargetRecord);
  prisma.user.update.mockResolvedValue({ ...adminUserRecord, isActive: false });
  prisma.session.deleteMany.mockResolvedValue({ count: 2 });
  const { updateAdminUser } = await loadService(prisma);

  await updateAdminUser('user-admin', 'user-target', { isActive: false });

  expect(prisma.$transaction).toHaveBeenCalled();
  expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-target' } });
});

it('does not delete sessions when the user stays active', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(updateTargetRecord);
  prisma.user.update.mockResolvedValue(adminUserRecord);
  const { updateAdminUser } = await loadService(prisma);

  await updateAdminUser('user-admin', 'user-target', { globalRole: 'ADMIN' });

  expect(prisma.session.deleteMany).not.toHaveBeenCalled();
});

it('fails when the requested user does not exist', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(null);
  const { updateAdminUser } = await loadService(prisma);

  await expect(updateAdminUser('user-admin', 'missing', { isActive: false })).rejects.toMatchObject(
    { statusCode: 404, message: 'User not found.' },
  );
  expect(prisma.user.update).not.toHaveBeenCalled();
});

it('rejects self-deactivation', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue({
    ...updateTargetRecord,
    id: 'user-admin',
    globalRole: 'ADMIN',
  });
  const { updateAdminUser } = await loadService(prisma);

  await expect(
    updateAdminUser('user-admin', 'user-admin', { isActive: false }),
  ).rejects.toMatchObject({
    statusCode: 409,
    message: 'You cannot deactivate your own account.',
  });
  expect(prisma.user.update).not.toHaveBeenCalled();
});

it('rejects self-demotion', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue({
    ...updateTargetRecord,
    id: 'user-admin',
    globalRole: 'ADMIN',
  });
  const { updateAdminUser } = await loadService(prisma);

  await expect(
    updateAdminUser('user-admin', 'user-admin', { globalRole: 'USER' }),
  ).rejects.toMatchObject({ statusCode: 409, message: 'You cannot change your own role.' });
  expect(prisma.user.update).not.toHaveBeenCalled();
});

it('rejects demoting or deactivating the last active administrator', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(activeAdminRecord);
  prisma.user.count.mockResolvedValue(0);
  const { updateAdminUser } = await loadService(prisma);

  await expect(
    updateAdminUser('user-admin', 'user-admin-target', { globalRole: 'USER' }),
  ).rejects.toMatchObject({
    statusCode: 409,
    message: 'At least one active administrator is required.',
  });

  await expect(
    updateAdminUser('user-admin', 'user-admin-target', { isActive: false }),
  ).rejects.toMatchObject({
    statusCode: 409,
    message: 'At least one active administrator is required.',
  });

  expect(prisma.user.count).toHaveBeenCalledWith({
    where: { globalRole: 'ADMIN', isActive: true, id: { not: 'user-admin-target' } },
  });
  expect(prisma.user.update).not.toHaveBeenCalled();
});

it('allows demoting an administrator when another active administrator exists', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(activeAdminRecord);
  prisma.user.count.mockResolvedValue(1);
  prisma.user.update.mockResolvedValue({ ...adminUserRecord, globalRole: 'USER' });
  const { updateAdminUser } = await loadService(prisma);

  await updateAdminUser('user-admin', 'user-admin-target', { globalRole: 'USER' });

  expect(prisma.user.count).toHaveBeenCalled();
  expect(prisma.user.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: { globalRole: 'USER' } }),
  );
});

it('does not check the administrator count for regular users', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(updateTargetRecord);
  prisma.user.update.mockResolvedValue({ ...adminUserRecord, isActive: false });
  const { updateAdminUser } = await loadService(prisma);

  await updateAdminUser('user-admin', 'user-target', { isActive: false });

  expect(prisma.user.count).not.toHaveBeenCalled();
});

it('rejects an unavailable organizational unit when updating a user', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(updateTargetRecord);
  prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-002', isActive: false });
  const { updateAdminUser } = await loadService(prisma);

  await expect(
    updateAdminUser('user-admin', 'user-target', { unitId: 'unit-002' }),
  ).rejects.toMatchObject({
    statusCode: 400,
    message: 'Organizational unit is not available.',
  });
  expect(prisma.user.update).not.toHaveBeenCalled();
});

it('forces the global OTROS career when the unit is null', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(updateTargetRecord);
  prisma.career.findUnique.mockResolvedValue({ id: 'car-otros', unitId: null, code: 'OTROS' });
  prisma.user.update.mockResolvedValue({ ...adminUserRecord, unit: null, career: null });
  const { updateAdminUser } = await loadService(prisma);

  await updateAdminUser('user-admin', 'user-target', { unitId: null });

  expect(prisma.user.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: { unitId: null, careerId: 'car-otros' } }),
  );
});

it('selects only safe fields for the administrative update response', async () => {
  const prisma = createPrismaMock();
  let capturedArgs: { select: Record<string, unknown> } | undefined;
  prisma.user.findUnique.mockResolvedValue(updateTargetRecord);
  prisma.user.update.mockImplementation((args: { select: Record<string, unknown> }) => {
    capturedArgs = args;
    return Promise.resolve(adminUserRecord);
  });
  const { updateAdminUser } = await loadService(prisma);

  await updateAdminUser('user-admin', 'user-target', { isActive: false });

  expect(capturedArgs?.select).toMatchObject({ id: true, isActive: true });
  expect(capturedArgs?.select).not.toHaveProperty('name');
  expect(capturedArgs?.select).not.toHaveProperty('accounts');
  expect(capturedArgs?.select).not.toHaveProperty('password');
  expect(capturedArgs?.select).not.toHaveProperty('passwordHash');
  expect(capturedArgs?.select).not.toHaveProperty('emailVerified');
});
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/users/users.service.test.ts`
Expected: FAIL porque `updateAdminUser` no existe.

- [x] **Step 3: Agregar el tipo de entrada**

En `src/modules/users/users.types.ts`, después de `UpdateProfileInput`:

```ts
export interface UpdateAdminUserInput {
  globalRole?: GlobalRole | undefined;
  isActive?: boolean | undefined;
  unitId?: string | null | undefined;
  careerId?: string | undefined;
}
```

- [x] **Step 4: Implementar el servicio**

En `src/modules/users/users.service.ts`:

1. Importar el enum y el tipo nuevo:

```ts
import type { GlobalRole } from '../../generated/prisma/enums.js';
import type {
  AdminUserResponse,
  PaginatedUsers,
  UpdateAdminUserInput,
  UpdateProfileInput,
  UserProfileResponse,
} from './users.types.js';
```

1. Agregar junto a `ProfileUpdateData`:

```ts
interface AdminUserUpdateData {
  globalRole?: GlobalRole;
  isActive?: boolean;
  unitId?: string | null;
  careerId?: string | null;
}
```

1. Agregar al final del archivo:

```ts
export const updateAdminUser = async (
  actorUserId: string,
  targetUserId: string,
  input: UpdateAdminUserInput,
): Promise<AdminUserResponse> => {
  const prisma = getPrismaClient();

  const currentUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      globalRole: true,
      isActive: true,
      unitId: true,
      career: { select: { unitId: true } },
    },
  });

  if (!currentUser) {
    throw new ApiError(404, 'User not found.');
  }

  if (actorUserId === targetUserId) {
    if (input.isActive === false) {
      throw new ApiError(409, 'You cannot deactivate your own account.');
    }

    if (input.globalRole !== undefined && input.globalRole !== currentUser.globalRole) {
      throw new ApiError(409, 'You cannot change your own role.');
    }
  }

  const data: AdminUserUpdateData = {};

  if (input.globalRole !== undefined) {
    data.globalRole = input.globalRole;
  }

  if (input.isActive !== undefined) {
    data.isActive = input.isActive;
  }

  Object.assign(data, await resolveOrganizationUpdate(prisma, currentUser, input));

  const removesActiveAdmin =
    currentUser.globalRole === 'ADMIN' &&
    currentUser.isActive &&
    ((input.globalRole !== undefined && input.globalRole !== 'ADMIN') || input.isActive === false);

  if (removesActiveAdmin) {
    const otherActiveAdmins = await prisma.user.count({
      where: { globalRole: 'ADMIN', isActive: true, id: { not: targetUserId } },
    });

    if (otherActiveAdmins === 0) {
      throw new ApiError(409, 'At least one active administrator is required.');
    }
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: targetUserId },
      data,
      select: adminUserSelect,
    });

    if (data.isActive === false) {
      await tx.session.deleteMany({ where: { userId: targetUserId } });
    }

    return updated;
  });
};
```

- [x] **Step 5: Verificar el verde**

Run: `pnpm exec vitest run src/modules/users/users.service.test.ts`
Expected: PASS.

### Task 4: Controlador y ruta admin (TDD)

**Files:**

- Modify: `src/modules/users/users.controller.ts`
- Modify: `src/modules/users/users.routes.ts`
- Modify: `src/modules/users/users.routes.test.ts`

- [x] **Step 1: Extender el arnés de pruebas de ruta**

En `src/modules/users/users.routes.test.ts`:

1. Extender `PrismaMock` y `createPrismaMock`:

```ts
interface PrismaMock {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  organizationalUnit: { findUnique: ReturnType<typeof vi.fn> };
  career: { findUnique: ReturnType<typeof vi.fn> };
  session: { deleteMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
}

const createPrismaMock = (): PrismaMock => {
  const prisma: PrismaMock = {
    user: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    organizationalUnit: { findUnique: vi.fn() },
    career: { findUnique: vi.fn() },
    session: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
  };

  prisma.$transaction.mockImplementation((callback: (tx: PrismaMock) => Promise<unknown>) =>
    callback(prisma),
  );

  return prisma;
};
```

1. Declarar fixtures y helper junto a `targetUserRecord`:

```ts
const editableUserSnapshot = {
  id: 'user-target',
  globalRole: 'USER',
  isActive: true,
  unitId: 'unit-002',
  career: null,
};

const adminTargetSnapshot = {
  id: 'user-admin-target',
  globalRole: 'ADMIN',
  isActive: true,
  unitId: null,
  career: null,
};

const mockAdminUpdate = (
  prisma: PrismaMock,
  snapshot: Record<string, unknown> = editableUserSnapshot,
  updated: Record<string, unknown> = { ...targetUserRecord, isActive: true },
): void => {
  prisma.user.findUnique.mockImplementation((args: UserLookupArgs) => {
    if (args.where.id === 'user-admin-target') {
      return Promise.resolve(adminTargetSnapshot);
    }

    if (
      args.select &&
      'career' in args.select &&
      'globalRole' in args.select &&
      'firstName' in args.select
    ) {
      return Promise.resolve(targetUserRecord);
    }

    if (args.select && 'career' in args.select && 'globalRole' in args.select) {
      return Promise.resolve(snapshot);
    }

    return Promise.resolve(authUserRecords[args.where.id] ?? null);
  });
  prisma.user.update.mockResolvedValue(updated);
  prisma.user.count.mockResolvedValue(1);
  prisma.session.deleteMany.mockResolvedValue({ count: 1 });
};
```

1. Agregar al final del `describe('users routes')`:

```ts
it('rejects the admin user update without a token', async () => {
  const app = await loadApp(createPrismaMock());

  await request(app).patch('/api/v1/admin/users/user-target').send({ isActive: false }).expect(401);
});

it('rejects the admin user update for non-admin users', async () => {
  const prisma = createPrismaMock();
  mockAdminUpdate(prisma);
  const app = await loadApp(prisma);

  const response = await request(app)
    .patch('/api/v1/admin/users/user-target')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ isActive: false })
    .expect(403);

  expect(response.body.message).toBe('Insufficient privileges for this resource.');
  expect(prisma.user.update).not.toHaveBeenCalled();
});

it('updates a user as administrator and returns the safe DTO', async () => {
  const prisma = createPrismaMock();
  mockAdminUpdate(prisma, editableUserSnapshot, { ...targetUserRecord, isActive: true });
  const app = await loadApp(prisma);

  const response = await request(app)
    .patch('/api/v1/admin/users/user-target')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({ globalRole: 'ADMIN', isActive: true })
    .expect(200);

  expect(response.body.message).toBe('User updated successfully.');
  expect(response.body.data).toEqual({ ...targetUserRecord, isActive: true });
  expect(prisma.user.update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 'user-target' },
      data: { globalRole: 'ADMIN', isActive: true },
    }),
  );
});

it('revokes the sessions when an administrator deactivates a user', async () => {
  const prisma = createPrismaMock();
  mockAdminUpdate(prisma, editableUserSnapshot, { ...targetUserRecord, isActive: false });
  const app = await loadApp(prisma);

  await request(app)
    .patch('/api/v1/admin/users/user-target')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({ isActive: false })
    .expect(200);

  expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-target' } });
});

it('blocks self-deactivation', async () => {
  const prisma = createPrismaMock();
  mockAdminUpdate(prisma, { ...editableUserSnapshot, id: 'user-admin', globalRole: 'ADMIN' });
  const app = await loadApp(prisma);

  const response = await request(app)
    .patch('/api/v1/admin/users/user-admin')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({ isActive: false })
    .expect(409);

  expect(response.body.message).toBe('You cannot deactivate your own account.');
  expect(prisma.user.update).not.toHaveBeenCalled();
});

it('blocks self-demotion', async () => {
  const prisma = createPrismaMock();
  mockAdminUpdate(prisma, { ...editableUserSnapshot, id: 'user-admin', globalRole: 'ADMIN' });
  const app = await loadApp(prisma);

  const response = await request(app)
    .patch('/api/v1/admin/users/user-admin')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({ globalRole: 'USER' })
    .expect(409);

  expect(response.body.message).toBe('You cannot change your own role.');
  expect(prisma.user.update).not.toHaveBeenCalled();
});

it('blocks demoting the last active administrator', async () => {
  const prisma = createPrismaMock();
  mockAdminUpdate(prisma, adminTargetSnapshot);
  prisma.user.count.mockResolvedValue(0);
  const app = await loadApp(prisma);

  const response = await request(app)
    .patch('/api/v1/admin/users/user-admin-target')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({ globalRole: 'USER' })
    .expect(409);

  expect(response.body.message).toBe('At least one active administrator is required.');
  expect(prisma.user.update).not.toHaveBeenCalled();
});

it('returns 404 for an unknown user on update', async () => {
  const prisma = createPrismaMock();
  mockAdminUpdate(prisma);
  const app = await loadApp(prisma);

  const response = await request(app)
    .patch('/api/v1/admin/users/user-does-not-exist')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({ isActive: false })
    .expect(404);

  expect(response.body).toEqual({
    success: false,
    message: 'User not found.',
    errors: [],
  });
});

it('rejects invalid admin update bodies', async () => {
  const prisma = createPrismaMock();
  mockAdminUpdate(prisma);
  const app = await loadApp(prisma);

  for (const body of [
    {},
    { firstName: 'Ana' },
    { globalRole: 'SUPERADMIN' },
    { isActive: 'yes' },
  ]) {
    const response = await request(app)
      .patch('/api/v1/admin/users/user-target')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send(body)
      .expect(400);

    expect(response.body.message).toBe('Validation error.');
  }

  expect(prisma.user.update).not.toHaveBeenCalled();
});

it('does not expose internal or credential fields in the admin update', async () => {
  const prisma = createPrismaMock();
  mockAdminUpdate(prisma);
  const app = await loadApp(prisma);

  const response = await request(app)
    .patch('/api/v1/admin/users/user-target')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({ isActive: true })
    .expect(200);

  expect(JSON.stringify(response.body)).not.toContain('$argon2');
  expect(response.body.data).not.toHaveProperty('name');
  expect(response.body.data).not.toHaveProperty('accounts');
  expect(response.body.data).not.toHaveProperty('password');
  expect(response.body.data).not.toHaveProperty('passwordHash');
  expect(response.body.data).not.toHaveProperty('emailVerified');
});
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/users/users.routes.test.ts`
Expected: FAIL con 404 en `PATCH /api/v1/admin/users/:id` (la ruta no existe).

- [x] **Step 3: Implementar el controlador**

En `src/modules/users/users.controller.ts`:

```ts
import type {
  ListUsersQuery,
  UpdateAdminUserBody,
  UpdateProfileSchemaBody,
} from './users.schemas.js';
import {
  getProfile,
  getUserById as getUserByIdService,
  listUsers as listUsersService,
  updateAdminUser as updateAdminUserService,
  updateProfile,
} from './users.service.js';
```

```ts
export const updateUser = asyncHandler(async (req, res) => {
  const actor = requireAuthenticatedUser(req);
  const { id } = req.params as { id: string };
  const user = await updateAdminUserService(actor.id, id, req.body as UpdateAdminUserBody);

  res.status(200).json(successResponse('User updated successfully.', user));
});
```

- [x] **Step 4: Implementar la ruta**

En `src/modules/users/users.routes.ts`, registrar después del `GET` del detalle:

```ts
usersRoutes.patch(
  '/admin/users/:id',
  authenticate,
  requireAdmin,
  validate(updateAdminUserSchema),
  updateUser,
);
```

Import actualizado:

```ts
import {
  getCurrentUser,
  getUser,
  listUsers,
  updateCurrentUser,
  updateUser,
} from './users.controller.js';
import {
  adminUserParamsSchema,
  listUsersQuerySchema,
  updateAdminUserSchema,
  updateProfileSchema,
} from './users.schemas.js';
```

- [x] **Step 5: Verificar el verde**

Run: `pnpm exec vitest run src/modules/users/users.routes.test.ts`
Expected: PASS.

### Task 5: Contrato OpenAPI (TDD)

**Files:**

- Modify: `src/modules/users/users.openapi.ts`
- Modify: `src/docs/openapi.test.ts`
- Modify: `openapi.json` (generado)

- [x] **Step 1: Escribir las pruebas rojas del contrato**

En `src/docs/openapi.test.ts`, agregar `'PATCH /api/v1/admin/users/{id}'` a `expectedOperations` y al final del describe:

```ts
it('marks the admin user update with bearer security and conflict responses', () => {
  const operation = openApiDocument.paths?.['/api/v1/admin/users/{id}']?.patch;

  expect(operation?.security).toEqual([{ bearerAuth: [] }]);
  expect(operation?.responses?.['200']).toBeDefined();
  expect(operation?.responses?.['400']).toBeDefined();
  expect(operation?.responses?.['401']).toBeDefined();
  expect(operation?.responses?.['403']).toBeDefined();
  expect(operation?.responses?.['404']).toBeDefined();
  expect(operation?.responses?.['409']).toBeDefined();
  expect(openApiDocument.components?.schemas).toHaveProperty('AdminUser');
});

it('documents the admin user update path parameter and request body', () => {
  const operation = openApiDocument.paths?.['/api/v1/admin/users/{id}']?.patch;
  const parameters = operation?.parameters ?? [];
  const names = parameters.map((parameter) => ('name' in parameter ? parameter.name : undefined));

  expect(names).toContain('id');
  expect(operation?.requestBody).toBeDefined();
});
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/docs/openapi.test.ts`
Expected: FAIL porque la operación `patch` no existe.

- [x] **Step 3: Documentar la ruta**

En `src/modules/users/users.openapi.ts`, importar `updateAdminUserSchema` y agregar `patch` dentro del path item existente `'/api/v1/admin/users/{id}'`, después del `get`:

```ts
    patch: {
      tags: ['Admin'],
      summary: 'Update a user',
      description:
        'Administrative user update. Requires the ADMIN role. Allows changing the global role, active status, organizational unit and career. Deactivating a user revokes all of their sessions; administrators cannot deactivate or demote themselves and the last active administrator cannot be demoted or deactivated.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: adminUserParamsSchema.shape.params },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: updateAdminUserSchema.shape.body } },
      },
      responses: {
        200: {
          description: 'Updated administrative view of the user account.',
          content: { 'application/json': { schema: apiSuccessResponse(adminUserSchema) } },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
```

- [x] **Step 4: Regenerar y verificar el contrato**

Run:

```bash
pnpm run docs:generate
pnpm exec vitest run src/docs/openapi.test.ts
pnpm run docs:check
```

Expected: `openapi.json` con `PATCH /api/v1/admin/users/{id}`, body y respuestas 400/401/403/404/409; tests y check en verde.

### Task 6: Bruno con assertions y casos de conflicto

**Files:**

- Create: `bruno/Admin/Update user.bru`
- Create: `bruno/Admin/Update unknown user returns 404.bru`
- Create: `bruno/Admin/Update own account returns 409.bru`
- Create: `bruno/Admin/Update user as USER returns 403.bru`
- Modify: `bruno/environments/local.bru`

- [x] **Step 1: Crear el caso 200 (idempotente sobre el seed demo)**

`bruno/Admin/Update user.bru`:

```bru
meta {
  name: Update user
  type: http
  seq: 7
  tags: [
    Admin
  ]
}

patch {
  url: {{baseUrl}}/api/v1/admin/users/{{targetUserId}}
  body: json
  auth: bearer
}

auth:bearer {
  token: {{adminToken}}
}

body:json {
  {
    "globalRole": "USER",
    "isActive": true
  }
}

tests {
  test("admin update returns the safe administrative DTO", function () {
    expect(res.getStatus()).to.equal(200);
    const body = res.getBody();
    expect(body.success).to.equal(true);
    expect(body.message).to.equal("User updated successfully.");
    expect(body.data.id).to.equal(bru.getEnvVar("targetUserId"));
    expect(body.data.globalRole).to.equal("USER");
    expect(body.data.isActive).to.equal(true);
    expect(JSON.stringify(body)).to.not.include("$argon2");
    expect(body.data).to.not.have.property("name");
    expect(body.data).to.not.have.property("accounts");
    expect(body.data).to.not.have.property("password");
    expect(body.data).to.not.have.property("passwordHash");
    expect(body.data).to.not.have.property("emailVerified");
  });
}
```

- [x] **Step 2: Crear los casos 404, 409 y 403**

`bruno/Admin/Update unknown user returns 404.bru`:

```bru
meta {
  name: Update unknown user returns 404
  type: http
  seq: 8
  tags: [
    Admin
  ]
}

patch {
  url: {{baseUrl}}/api/v1/admin/users/{{unknownUserId}}
  body: json
  auth: bearer
}

auth:bearer {
  token: {{adminToken}}
}

body:json {
  {
    "isActive": true
  }
}

tests {
  test("unknown user ids produce a generic 404 on update", function () {
    expect(res.getStatus()).to.equal(404);
    const body = res.getBody();
    expect(body.success).to.equal(false);
    expect(body.message).to.equal("User not found.");
  });
}
```

`bruno/Admin/Update own account returns 409.bru`:

```bru
meta {
  name: Update own account returns 409
  type: http
  seq: 9
  tags: [
    Admin
  ]
}

patch {
  url: {{baseUrl}}/api/v1/admin/users/{{adminUserId}}
  body: json
  auth: bearer
}

auth:bearer {
  token: {{adminToken}}
}

body:json {
  {
    "isActive": false
  }
}

tests {
  test("administrators cannot deactivate themselves", function () {
    expect(res.getStatus()).to.equal(409);
    const body = res.getBody();
    expect(body.success).to.equal(false);
    expect(body.message).to.equal("You cannot deactivate your own account.");
  });
}
```

`bruno/Admin/Update user as USER returns 403.bru`:

```bru
meta {
  name: Update user as USER returns 403
  type: http
  seq: 10
  tags: [
    Admin
  ]
}

patch {
  url: {{baseUrl}}/api/v1/admin/users/{{targetUserId}}
  body: json
  auth: bearer
}

auth:bearer {
  token: {{regularToken}}
}

body:json {
  {
    "isActive": false
  }
}

tests {
  test("regular users cannot update other users", function () {
    expect(res.getStatus()).to.equal(403);
    const body = res.getBody();
    expect(body.success).to.equal(false);
    expect(body.message).to.equal("Insufficient privileges for this resource.");
  });
}
```

- [x] **Step 3: Agregar la variable de entorno**

En `bruno/environments/local.bru`, agregar:

```bru
adminUserId: seed_user_admin
```

- [x] **Step 4: Ejecutar la carpeta**

Run: `pnpm --dir bruno exec bru run Admin --env local`
Expected: 10/10 requests y 11/11 tests en verde. El script de captura del login de `Auth` no se modifica.

### Task 7: Verificación real contra el stack local

**Files:**

- Create temporal: `.tmp-f111-integration.mts` (se elimina al terminar)

- [x] **Step 1: Confirmar el stack y el usuario objetivo**

Run:

```bash
docker compose -f compose.dev.yaml ps --format '{{.Name}} {{.Status}}'
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg -c "SELECT global_role, is_active FROM users WHERE email = 'organizador.fie@utp.ac.pa';"
```

Expected: api/db arriba; usuario demo `USER`, activo.

- [x] **Step 2: Crear el script de verificación**

Contenido de `.tmp-f111-integration.mts` (modo `verify` deja al usuario desactivado; modo `restore` lo reactiva y comprueba login):

```ts
const baseUrl = 'http://localhost:3000';
const demoPassword = 'Sipeg2026*UTP';
const mode = process.argv[2] ?? 'verify';

interface Envelope {
  success?: boolean;
  message?: string;
  data?: Record<string, unknown>;
}

interface LoginTokens {
  accessToken: string;
  refreshToken: string;
}

const send = async (
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: Envelope }> => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  return { status: response.status, body: (await response.json()) as Envelope };
};

const login = async (email: string): Promise<LoginTokens> => {
  const response = await send('POST', '/api/v1/auth/login', {
    body: { email, password: demoPassword },
  });
  const tokens = response.body.data as Partial<LoginTokens> | undefined;

  if (response.status !== 200 || !tokens?.accessToken || !tokens.refreshToken) {
    throw new Error(`Login failed for ${email}: ${response.status}`);
  }

  return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
};

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const resolveTargetId = async (adminToken: string): Promise<string> => {
  const list = await send('GET', '/api/v1/admin/users?q=organizador.fie', { token: adminToken });
  const items =
    (list.body.data as { items?: { id: string; email: string }[] } | undefined)?.items ?? [];
  const target = items.find((item) => item.email === 'organizador.fie@utp.ac.pa');

  if (!target) {
    throw new Error('Demo target user was not found.');
  }

  return target.id;
};

const admin = await login('admin@utp.ac.pa');
const targetId = await resolveTargetId(admin.accessToken);

if (mode === 'restore') {
  const reactivated = await send('PATCH', `/api/v1/admin/users/${targetId}`, {
    token: admin.accessToken,
    body: { isActive: true },
  });
  assert(reactivated.status === 200, `Reactivation failed: ${reactivated.status}`);

  const relogin = await login('organizador.fie@utp.ac.pa');
  assert(relogin.accessToken.length > 0, 'Login after reactivation failed.');

  const detail = await send('GET', `/api/v1/admin/users/${targetId}`, { token: admin.accessToken });
  const restored = detail.body.data as { isActive: boolean; globalRole: string };
  assert(
    restored.isActive === true && restored.globalRole === 'USER',
    'Target user was not restored to active USER.',
  );

  console.log(`restore ok: id=${targetId} isActive=true globalRole=USER login=200`);
} else {
  const target = await login('organizador.fie@utp.ac.pa');
  const results: string[] = [];

  const detail = await send('GET', `/api/v1/admin/users/${targetId}`, { token: admin.accessToken });
  const snapshot = detail.body.data as {
    unit: { id: string } | null;
    career: { id: string } | null;
    globalRole: string;
    isActive: boolean;
  };
  assert(
    snapshot.unit !== null &&
      snapshot.career !== null &&
      snapshot.isActive &&
      snapshot.globalRole === 'USER',
    'Target snapshot is not the expected active USER with unit and career.',
  );

  const forbidden = await send('PATCH', `/api/v1/admin/users/${targetId}`, {
    token: target.accessToken,
    body: { isActive: true },
  });
  assert(forbidden.status === 403, `Expected 403 for USER, got ${forbidden.status}`);
  results.push('USER -> 403');

  const missing = await send('PATCH', '/api/v1/admin/users/user-does-not-exist', {
    token: admin.accessToken,
    body: { isActive: true },
  });
  assert(missing.status === 404, `Expected 404, got ${missing.status}`);

  const empty = await send('PATCH', `/api/v1/admin/users/${targetId}`, {
    token: admin.accessToken,
    body: {},
  });
  assert(empty.status === 400, `Expected 400 for empty body, got ${empty.status}`);

  const unknownField = await send('PATCH', `/api/v1/admin/users/${targetId}`, {
    token: admin.accessToken,
    body: { firstName: 'Ana' },
  });
  assert(unknownField.status === 400, `Expected 400 for unknown field, got ${unknownField.status}`);
  results.push('unknown id -> 404; empty/unknown body -> 400');

  const otros = await send('PATCH', `/api/v1/admin/users/${targetId}`, {
    token: admin.accessToken,
    body: { unitId: null },
  });
  const otrosData = otros.body.data as { unit: unknown; career: { code: string } | null };
  assert(
    otros.status === 200 && otrosData.unit === null && otrosData.career?.code === 'OTROS',
    `Unit null update failed: ${otros.status}`,
  );

  const restored = await send('PATCH', `/api/v1/admin/users/${targetId}`, {
    token: admin.accessToken,
    body: { unitId: snapshot.unit.id, careerId: snapshot.career.id },
  });
  const restoredData = restored.body.data as {
    unit: { id: string } | null;
    career: { id: string } | null;
  };
  assert(
    restored.status === 200 &&
      restoredData.unit?.id === snapshot.unit.id &&
      restoredData.career?.id === snapshot.career.id,
    `Organization restore failed: ${restored.status}`,
  );
  results.push('unit null -> OTROS -> restore');

  const badUnit = await send('PATCH', `/api/v1/admin/users/${targetId}`, {
    token: admin.accessToken,
    body: { unitId: 'unit-does-not-exist' },
  });
  assert(badUnit.status === 400, `Expected 400 for unknown unit, got ${badUnit.status}`);

  const badCareer = await send('PATCH', `/api/v1/admin/users/${targetId}`, {
    token: admin.accessToken,
    body: { careerId: 'career-does-not-exist' },
  });
  assert(badCareer.status === 400, `Expected 400 for unknown career, got ${badCareer.status}`);

  const ficList = await send('GET', '/api/v1/admin/users?q=organizador.fic', {
    token: admin.accessToken,
  });
  const ficItems =
    (ficList.body.data as { items?: { id: string; email: string }[] } | undefined)?.items ?? [];
  const ficTarget = ficItems.find((item) => item.email === 'organizador.fic@utp.ac.pa');
  assert(ficTarget !== undefined, 'FIC demo user was not found.');
  const ficDetail = await send('GET', `/api/v1/admin/users/${ficTarget.id}`, {
    token: admin.accessToken,
  });
  const ficCareer = (ficDetail.body.data as { career: { id: string } }).career;
  const mismatch = await send('PATCH', `/api/v1/admin/users/${targetId}`, {
    token: admin.accessToken,
    body: { careerId: ficCareer.id },
  });
  assert(mismatch.status === 400, `Expected 400 for cross-unit career, got ${mismatch.status}`);
  results.push('unknown unit/career and cross-unit career -> 400');

  const promoted = await send('PATCH', `/api/v1/admin/users/${targetId}`, {
    token: admin.accessToken,
    body: { globalRole: 'ADMIN' },
  });
  assert(promoted.status === 200, `Expected 200 promoting, got ${promoted.status}`);
  const demoted = await send('PATCH', `/api/v1/admin/users/${targetId}`, {
    token: admin.accessToken,
    body: { globalRole: 'USER' },
  });
  assert(demoted.status === 200, `Expected 200 demoting, got ${demoted.status}`);
  results.push('promote/demote another admin -> 200 (actor remains admin)');

  const adminProfile = await send('GET', '/api/v1/users/me', { token: admin.accessToken });
  const adminId = (adminProfile.body.data as { id: string }).id;

  const selfDeactivate = await send('PATCH', `/api/v1/admin/users/${adminId}`, {
    token: admin.accessToken,
    body: { isActive: false },
  });
  assert(
    selfDeactivate.status === 409 &&
      selfDeactivate.body.message === 'You cannot deactivate your own account.',
    `Self-deactivation was not blocked: ${selfDeactivate.status}`,
  );

  const selfDemote = await send('PATCH', `/api/v1/admin/users/${adminId}`, {
    token: admin.accessToken,
    body: { globalRole: 'USER' },
  });
  assert(
    selfDemote.status === 409 && selfDemote.body.message === 'You cannot change your own role.',
    `Self-demotion was not blocked: ${selfDemote.status}`,
  );

  const adminStillWorks = await send('GET', '/api/v1/admin/users?limit=1', {
    token: admin.accessToken,
  });
  assert(
    adminStillWorks.status === 200,
    'The administrator lost access after blocked self-updates.',
  );
  results.push('self-deactivation/self-demotion -> 409');

  const deactivated = await send('PATCH', `/api/v1/admin/users/${targetId}`, {
    token: admin.accessToken,
    body: { isActive: false },
  });
  const deactivatedData = deactivated.body.data as { isActive: boolean };
  assert(
    deactivated.status === 200 && deactivatedData.isActive === false,
    `Deactivation failed: ${deactivated.status}`,
  );

  const staleAccess = await send('GET', '/api/v1/users/me', { token: target.accessToken });
  assert(
    staleAccess.status === 403,
    `Expected 403 for stale access token, got ${staleAccess.status}`,
  );

  const staleRefresh = await send('POST', '/api/v1/auth/refresh', {
    body: { refreshToken: target.refreshToken },
  });
  assert(
    staleRefresh.status === 401,
    `Expected 401 for revoked refresh token, got ${staleRefresh.status}`,
  );

  const blockedLogin = await send('POST', '/api/v1/auth/login', {
    body: { email: 'organizador.fie@utp.ac.pa', password: demoPassword },
  });
  assert(
    blockedLogin.status === 401,
    `Expected 401 for disabled account login, got ${blockedLogin.status}`,
  );
  results.push('deactivation -> sessions revoked (403/401/401)');

  console.log(results.join('\n'));
  console.log(`verify ok, target left deactivated: id=${targetId}`);
}
```

- [x] **Step 3: Ejecutar el modo `verify`**

Run:

```bash
pnpm exec tsx .tmp-f111-integration.mts verify
```

Expected: todas las verificaciones sin excepciones; el usuario queda desactivado.

- [x] **Step 4: Confirmar en BD que las sesiones fueron eliminadas**

Run:

```bash
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg -c "SELECT count(*) FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = 'organizador.fie@utp.ac.pa');"
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg -c "SELECT global_role, is_active FROM users WHERE email = 'organizador.fie@utp.ac.pa';"
```

Expected: `0` sesiones y `USER | f` (desactivado).

- [x] **Step 5: Ejecutar el modo `restore` y confirmar el estado final**

Run:

```bash
pnpm exec tsx .tmp-f111-integration.mts restore
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg -c "SELECT global_role, is_active FROM users WHERE email = 'organizador.fie@utp.ac.pa';"
```

Expected: `restore ok` (login 200) y `USER | t`.

- [x] **Step 6: Eliminar el script temporal**

Run: `rm .tmp-f111-integration.mts`
Expected: el árbol no conserva artefactos temporales nuevos.

### Task 8: Documentación y cierre

**Files:**

- Modify: `README.md`
- Modify: `CONTEXT.md`
- Modify: `docs/superpowers/plans/2026-09-20-fase-1-11-actualizar-usuario.md` (este plan)
- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [x] **Step 1: Documentar el endpoint**

En `README.md`, después de la línea de `GET /api/v1/admin/users/{id}` (línea 243):

```md
- `PATCH /api/v1/admin/users/{id}` (solo `ADMIN`) actualiza `globalRole`, `isActive`, `unitId` y `careerId`; al desactivar revoca todas las sesiones del usuario; no permite autodesactivación ni autodegradación y protege al último administrador activo (409). Devuelve el mismo DTO seguro y responde 400/404.
```

En `CONTEXT.md`, después de la línea del detalle administrativo (línea 117):

```md
- `PATCH /api/v1/admin/users/{id}` es exclusivo de `ADMIN`: permite `globalRole`, `isActive`, `unitId` y `careerId`; reutiliza la validación de unidad/carrera de `PATCH /users/me`; al desactivar ejecuta `user.update` + `session.deleteMany` en una transacción; autodesactivación y autodegradación responden `409`, igual que degradar o desactivar al último administrador activo.
```

- [x] **Step 2: Actualizar el plan maestro**

En `plan-maestro-sipeg-utp.md`:

1. Marcar el checklist 1.11 como `[x]` con el resumen de pruebas.
2. Actualizar la fila "Usuarios" de la tabla de estado: 1.11 verificado; falta 1.10 (creación).
3. Agregar `PATCH /admin/users/:id` a la línea de endpoints existentes.
4. Agregar el bloque "Registro de ejecución (2026-09-20 - 1.11)" con: plan detallado, implementación, rojos/verdes por capa, conteos de `pnpm test`, verificación real, resultados Bruno, contrato sin drift y "Sin commit: el usuario no lo solicitó".

- [x] **Step 3: Ejecutar los comandos de calidad**

Run:

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run format:check
pnpm run docs:check
```

Expected: todos en verde (si algo falla solo por trabajo concurrente ajeno al módulo, documentarlo con gates dirigidos `pnpm exec vitest run src/modules/users src/docs`).

---

## Threat model resumido

- **BFLA:** la ruta exige `authenticate -> requireAdmin`; un `USER` recibe 403 antes de validar body o tocar Prisma.
- **Auto-bloqueo del sistema:** autodesactivación y autodegradación siempre 409; guarda adicional del último admin activo (defensa en profundidad, inalcanzable hoy porque el actor siempre es un admin activo y distinto del objetivo).
- **Mass assignment:** el esquema solo acepta `globalRole`, `isActive`, `unitId`, `careerId`; claves desconocidas se descartan y un body sin campos permitidos responde 400.
- **Fuga de datos:** la respuesta usa `adminUserSelect` (sin `name`, `accounts`, `password`, `passwordHash`, `emailVerified`).
- **Sesiones:** al desactivar se eliminan todas las sesiones del objetivo en la misma transacción del update; un refresh token revocado responde 401 y el access token responde 403.
- **IDOR/enumeración:** solo ADMIN; id inexistente responde 404 genérico; id vacío/espacios 400.

## Self-review

- Cobertura 1.11: rol, estado, unidad y carrera (200); revocación de sesiones al desactivar; autodesactivación, autodegradación y último ADMIN (409); 401/403/404/400.
- Se reutilizan `adminUserSelect`, `AdminUser`, `adminUserParamsSchema` y la lógica de organización existente; sin migraciones ni env vars.
- El refactor de `updateProfile` se valida con las pruebas existentes antes de agregar código nuevo.
- 1.10 queda explícitamente fuera de alcance.

---

## Registro de ejecución (2026-09-20)

- Ciclo TDD rojo/verde en las 4 capas: esquema (5 pruebas; rojo por export inexistente), servicio (12; rojo por función inexistente), ruta (10; rojo con 404 en la ruta nueva) y contrato OpenAPI (2; rojo por operación ausente).
- Implementación: `updateAdminUserSchema`, `UpdateAdminUserInput`, `updateAdminUser` con auto-protecciones y `$transaction` (`user.update` + `session.deleteMany`), controlador `updateUser`, ruta `PATCH /admin/users/:id` y operación OpenAPI con respuestas 400/401/403/404/409.
- El helper de organización ya existía en el árbol por el trabajo concurrente de 1.10 (`resolveOrganizationAssignment`); se reutilizó sin duplicar reglas y las 12 pruebas de `updateProfile` siguieron verdes.
- Pruebas: suite dirigida `src/modules/users src/docs` 160 en 6 archivos; `pnpm test` 492 en 35 archivos; `typecheck`, `lint`, `build`, `format:check` y `docs:check` en verde.
- Verificación real (stack Docker dev, seed demo, `organizador.fie`): `USER -> 403`; 404; 400; `unitId: null` → `OTROS` → restauración; 400 de unidad/carrera inválida y carrera cruzada; promoción/degradación 200; auto-protecciones 409; desactivación con `sessions = 0` en psql y 403/401/401; reactivación con login 200. `.tmp-f111-integration.mts` eliminado.
- Bruno: 4 requests nuevos y `adminUserId`; `bru run Admin --env local` 14/14 requests y 15/15 tests.
- Desviación: el login de cuenta desactivada respondió 429 en el primer intento por el rate limit de IP agotado por Bruno; reintentado tras 60 s respondió 401.
- Hallazgo `F1.11-A`: la guarda del último admin activo es defensa en profundidad inalcanzable vía API hoy; cubierta por pruebas unitarias.
- Sin commit: el usuario no lo solicitó.
