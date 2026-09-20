# Fase 1.8 - Listar usuarios (`GET /api/v1/admin/users`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar el checklist 1.8 del plan maestro implementando `GET /api/v1/admin/users` con acceso exclusivo `ADMIN`, paginacion, busqueda y filtros por rol, estado, unidad y carrera, sin exponer campos sensibles.

**Architecture:** El endpoint vive en el modulo autocontenido `src/modules/users/` y sigue el patron de `/event-programs`: `authenticate -> requireAdmin -> validate(schema) -> controller -> service -> Prisma`. El servicio usa un `select` acotado (sin `name`, `accounts`, `password`, `emailVerified`) y paginacion offset con `Promise.all(findMany, count)`. El contrato Zod es la fuente unica de OpenAPI (`AdminUser`, `PaginatedUsers`, tag `Admin`).

**Tech Stack:** TypeScript 6, Express 5, Prisma 7, Zod 4, Vitest, Supertest, OpenAPI 3.1, Bruno.

**Hallazgos de partida (2026-09-19):**

- `src/modules/users/` tiene solo `GET/PATCH /users/me` (24 pruebas verdes). No existe ningun endpoint `/admin/*` ni tag `Admin` en OpenAPI.
- `requireAdmin` ya existe en `src/middlewares/authorize.middleware.ts:29` y responde `403 Insufficient privileges for this resource.` a `USER`.
- El patron de listado paginado vigente (`event-programs`) usa `page/limit` con `.strict()`, `Promise.all([findMany, count])`, `totalPages = total === 0 ? 0 : ceil(total/limit)` y `orderBy` estable.
- El `select` de perfil actual (`users.service.ts:5`) ya excluye campos internos; se extiende con `isActive` para el listado admin.
- El stack `compose.dev.yaml` esta arriba (api, db, mailpit); el seed demo tiene 30 usuarios, password conocida y `emailVerified = true`; ids deterministicos `seed_unit_*`, `seed_career_*`, `seed_user_*`.
- `AUTH_REFRESH_TTL`, Mailpit y demas infraestructura no se tocan; 1.8 no requiere migraciones ni variables de entorno nuevas.

---

### Task 1: Schemas de query y DTO (TDD)

**Files:**

- Modify: `src/modules/users/users.types.ts`
- Modify: `src/modules/users/users.schemas.ts`
- Modify: `src/modules/users/users.schemas.test.ts`

- [x] **Step 1: Escribir las pruebas rojas de esquema**

Agregar al final de `src/modules/users/users.schemas.test.ts` (reutilizando `baseProfile`):

```ts
describe('listUsersQuerySchema', () => {
  it('applies default pagination', () => {
    const parsed = listUsersQuerySchema.parse({ query: {} });

    expect(parsed.query).toEqual({ page: 1, limit: 20 });
  });

  it('parses isActive as a real boolean', () => {
    expect(listUsersQuerySchema.parse({ query: { isActive: 'false' } }).query.isActive).toBe(false);
    expect(listUsersQuerySchema.parse({ query: { isActive: 'true' } }).query.isActive).toBe(true);
  });

  it('trims the search term', () => {
    expect(listUsersQuerySchema.parse({ query: { q: '  perez  ' } }).query.q).toBe('perez');
  });

  it('rejects invalid pagination and filters', () => {
    expect(() => listUsersQuerySchema.parse({ query: { page: '0' } })).toThrow();
    expect(() => listUsersQuerySchema.parse({ query: { limit: '51' } })).toThrow();
    expect(() => listUsersQuerySchema.parse({ query: { globalRole: 'SUPERADMIN' } })).toThrow();
    expect(() => listUsersQuerySchema.parse({ query: { isActive: 'maybe' } })).toThrow();
    expect(() => listUsersQuerySchema.parse({ query: { unitId: '' } })).toThrow();
    expect(() => listUsersQuerySchema.parse({ query: { q: '' } })).toThrow();
  });

  it('rejects unknown query parameters', () => {
    expect(() => listUsersQuerySchema.parse({ query: { name: 'Juan' } })).toThrow();
  });
});

describe('adminUserSchema', () => {
  const baseAdminUser = { ...baseProfile, isActive: true };

  it('accepts an administrative user view', () => {
    expect(adminUserSchema.parse(baseAdminUser)).toEqual(baseAdminUser);
  });

  it('rejects an unknown global role', () => {
    expect(() => adminUserSchema.parse({ ...baseAdminUser, globalRole: 'SUPERADMIN' })).toThrow();
  });

  it('strips internal Better Auth fields', () => {
    const parsed = adminUserSchema.parse({
      ...baseAdminUser,
      name: 'Internal Name',
      accounts: [{ password: '$argon2id$hash' }],
      passwordHash: '$argon2id$hash',
      emailVerified: true,
    });

    expect(parsed).not.toHaveProperty('name');
    expect(parsed).not.toHaveProperty('accounts');
    expect(parsed).not.toHaveProperty('passwordHash');
    expect(parsed).not.toHaveProperty('emailVerified');
  });
});
```

Actualizar el import del encabezado:

```ts
import {
  adminUserSchema,
  listUsersQuerySchema,
  updateProfileSchema,
  userProfileSchema,
} from './users.schemas.js';
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/users/users.schemas.test.ts`

Expected: FAIL por `listUsersQuerySchema`/`adminUserSchema` no exportados.

- [x] **Step 3: Agregar los tipos**

En `src/modules/users/users.types.ts`, agregar:

```ts
export interface AdminUserResponse {
  id: string;
  firstName: string;
  lastName: string;
  identificationNumber: string;
  email: string;
  globalRole: GlobalRole;
  isActive: boolean;
  unit: UserProfileOrganization | null;
  career: UserProfileOrganization | null;
}

export interface PaginatedUsers {
  items: AdminUserResponse[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
```

- [x] **Step 4: Implementar los esquemas**

En `src/modules/users/users.schemas.ts`, exportar `organizationReferenceSchema` (quitar el `const` privado) e importar los tipos nuevos:

```ts
import type { AdminUserResponse, PaginatedUsers, UserProfileResponse } from './users.types.js';
```

Agregar despues de `userProfileSchema`:

```ts
export const listUsersQuerySchema = z.object({
  query: z
    .object({
      page: z.coerce
        .number('Page must be a number.')
        .int('Page must be an integer.')
        .min(1, 'Page must be at least 1.')
        .default(1),
      limit: z.coerce
        .number('Limit must be a number.')
        .int('Limit must be an integer.')
        .min(1, 'Limit must be at least 1.')
        .max(50, 'Limit cannot exceed 50.')
        .default(20),
      globalRole: z.enum(['USER', 'ADMIN'], 'Global role is invalid.').optional(),
      isActive: z
        .enum(['true', 'false'], 'Status must be true or false.')
        .transform((value) => value === 'true')
        .optional(),
      unitId: z.string().trim().min(1, 'Organizational unit is invalid.').optional(),
      careerId: z.string().trim().min(1, 'Career is invalid.').optional(),
      q: z
        .string()
        .trim()
        .min(1, 'Search term cannot be empty.')
        .max(200, 'Search term cannot exceed 200 characters.')
        .optional(),
    })
    .strict(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>['query'];

export const adminUserSchema = z
  .object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    identificationNumber: z.string(),
    email: z.string().email(),
    globalRole: z.enum(['USER', 'ADMIN']),
    isActive: z.boolean(),
    unit: organizationReferenceSchema.nullable(),
    career: organizationReferenceSchema.nullable(),
  })
  .meta({
    id: 'AdminUser',
    description: 'Administrative view of a user account.',
  }) satisfies z.ZodType<AdminUserResponse>;

export const paginatedUsersSchema = z
  .object({
    items: z.array(adminUserSchema),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .meta({
    id: 'PaginatedUsers',
    description: 'Paginated list of user accounts.',
  }) satisfies z.ZodType<PaginatedUsers>;
```

- [x] **Step 5: Verificar el verde**

Run: `pnpm exec vitest run src/modules/users/users.schemas.test.ts`

Expected: PASS.

### Task 2: Servicio de listado (TDD)

**Files:**

- Modify: `src/modules/users/users.service.ts`
- Modify: `src/modules/users/users.service.test.ts`

- [x] **Step 1: Escribir las pruebas rojas del servicio**

En `src/modules/users/users.service.test.ts`, extender `UserModelMock` y `createPrismaMock`:

```ts
interface UserModelMock {
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
}
```

```ts
const createPrismaMock = (): PrismaMock => ({
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
});
```

Agregar el registro y las pruebas al final del `describe('users service')`:

```ts
const adminUserRecord = {
  id: 'user-001',
  firstName: 'Juan',
  lastName: 'Perez',
  identificationNumber: '8-123-4567',
  email: 'juan.perez@example.com',
  globalRole: 'USER',
  isActive: true,
  unit: { id: 'unit-001', name: 'Ingenieria', code: 'FIS' },
  career: { id: 'car-001', name: 'Sistemas', code: 'SIS' },
};

it('lists users with offset pagination metadata', async () => {
  const prisma = createPrismaMock();
  prisma.user.findMany.mockResolvedValue([adminUserRecord]);
  prisma.user.count.mockResolvedValue(21);
  const { listUsers } = await loadService(prisma);

  const result = await listUsers({ page: 2, limit: 10 });

  expect(result).toEqual({
    items: [adminUserRecord],
    page: 2,
    limit: 10,
    total: 21,
    totalPages: 3,
  });
  expect(prisma.user.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      skip: 10,
      take: 10,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
    }),
  );
  expect(prisma.user.count).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.any(Object) }),
  );
});

it('applies role, status, unit, career and search filters', async () => {
  const prisma = createPrismaMock();
  prisma.user.findMany.mockResolvedValue([]);
  prisma.user.count.mockResolvedValue(0);
  const { listUsers } = await loadService(prisma);

  await listUsers({
    page: 1,
    limit: 20,
    globalRole: 'ADMIN',
    isActive: false,
    unitId: 'unit-001',
    careerId: 'car-001',
    q: 'perez',
  });

  expect(prisma.user.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        globalRole: 'ADMIN',
        isActive: false,
        unitId: 'unit-001',
        careerId: 'car-001',
        OR: [
          { firstName: { contains: 'perez', mode: 'insensitive' } },
          { lastName: { contains: 'perez', mode: 'insensitive' } },
          { email: { contains: 'perez', mode: 'insensitive' } },
          { identificationNumber: { contains: 'perez', mode: 'insensitive' } },
        ],
      },
    }),
  );
});

it('returns an empty page when no users match', async () => {
  const prisma = createPrismaMock();
  prisma.user.findMany.mockResolvedValue([]);
  prisma.user.count.mockResolvedValue(0);
  const { listUsers } = await loadService(prisma);

  const result = await listUsers({ page: 1, limit: 20 });

  expect(result).toEqual({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
});

it('selects only safe user fields', async () => {
  const prisma = createPrismaMock();
  let capturedArgs: { select: Record<string, unknown> } | undefined;
  prisma.user.findMany.mockImplementation((args: { select: Record<string, unknown> }) => {
    capturedArgs = args;
    return Promise.resolve([]);
  });
  prisma.user.count.mockResolvedValue(0);
  const { listUsers } = await loadService(prisma);

  await listUsers({ page: 1, limit: 20 });

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

Expected: FAIL porque `listUsers` no existe.

- [x] **Step 3: Implementar el servicio**

En `src/modules/users/users.service.ts`, importar el tipo de query y los tipos de respuesta:

```ts
import type { ListUsersQuery } from './users.schemas.js';
import type { PaginatedUsers, UpdateProfileInput, UserProfileResponse } from './users.types.js';
```

Agregar el `select` junto a `profileSelect` y la funcion al final del archivo:

```ts
const adminUserSelect = {
  id: true,
  firstName: true,
  lastName: true,
  identificationNumber: true,
  email: true,
  globalRole: true,
  isActive: true,
  unit: { select: { id: true, name: true, code: true } },
  career: { select: { id: true, name: true, code: true } },
} as const;

export const listUsers = async (query: ListUsersQuery): Promise<PaginatedUsers> => {
  const prisma = getPrismaClient();
  const where = {
    ...(query.globalRole ? { globalRole: query.globalRole } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    ...(query.unitId ? { unitId: query.unitId } : {}),
    ...(query.careerId ? { careerId: query.careerId } : {}),
    ...(query.q
      ? {
          OR: [
            { firstName: { contains: query.q, mode: 'insensitive' as const } },
            { lastName: { contains: query.q, mode: 'insensitive' as const } },
            { email: { contains: query.q, mode: 'insensitive' as const } },
            { identificationNumber: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
  const skip = (query.page - 1) * query.limit;

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
      skip,
      take: query.limit,
      select: adminUserSelect,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    items,
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  };
};
```

- [x] **Step 4: Verificar el verde**

Run: `pnpm exec vitest run src/modules/users/users.service.test.ts`

Expected: PASS.

### Task 3: Controlador y ruta admin (TDD)

**Files:**

- Modify: `src/modules/users/users.controller.ts`
- Modify: `src/modules/users/users.routes.ts`
- Modify: `src/modules/users/users.routes.test.ts`

- [x] **Step 1: Extender el arnés de pruebas de ruta**

En `src/modules/users/users.routes.test.ts`:

1. Agregar `findMany`/`count` a `PrismaMock` y `createPrismaMock`:

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
}

const createPrismaMock = (): PrismaMock => ({
  user: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  organizationalUnit: { findUnique: vi.fn() },
  career: { findUnique: vi.fn() },
});
```

2. Declarar `let adminAccessToken: string;` junto a los otros tokens y firmarlo en `beforeAll`:

```ts
adminAccessToken = await new SignJWT({
  email: 'admin@utp.ac.pa',
  role: 'ADMIN',
  unitId: null,
  careerId: null,
  isActive: true,
})
  .setProtectedHeader({ alg: 'EdDSA', kid, typ: 'JWT' })
  .setIssuer('http://localhost:3000')
  .setAudience('http://localhost:3000')
  .setSubject('user-admin')
  .setIssuedAt()
  .setExpirationTime('15m')
  .sign(privateKey);
```

3. Agregar el registro admin al mapa de usuarios autenticados:

```ts
const adminAuthUserRecord = {
  id: 'user-admin',
  email: 'admin@utp.ac.pa',
  globalRole: 'ADMIN',
  unitId: null,
  careerId: null,
  isActive: true,
};

const authUserRecords: Record<string, unknown> = {
  'user-001': authUserRecord,
  'user-002': otherAuthUserRecord,
  'user-admin': adminAuthUserRecord,
};
```

- [x] **Step 2: Escribir las pruebas rojas de ruta**

Agregar al final del `describe('users routes')`:

```ts
const adminUserRecord = {
  id: 'user-001',
  firstName: 'Juan',
  lastName: 'Perez',
  identificationNumber: '8-123-4567',
  email: 'juan.perez@example.com',
  globalRole: 'USER',
  isActive: true,
  unit: { id: 'unit-001', name: 'Ingenieria', code: 'FIS' },
  career: { id: 'car-001', name: 'Sistemas', code: 'SIS' },
};

it('rejects the admin user list without a token', async () => {
  const app = await loadApp(createPrismaMock());

  await request(app).get('/api/v1/admin/users').expect(401);
});

it('rejects the admin user list for non-admin users', async () => {
  const prisma = createPrismaMock();
  mockUserLookup(prisma);
  const app = await loadApp(prisma);

  const response = await request(app)
    .get('/api/v1/admin/users')
    .set('Authorization', `Bearer ${accessToken}`)
    .expect(403);

  expect(response.body.message).toBe('Insufficient privileges for this resource.');
  expect(prisma.user.findMany).not.toHaveBeenCalled();
});

it('returns a paginated user list for administrators', async () => {
  const prisma = createPrismaMock();
  mockUserLookup(prisma);
  prisma.user.findMany.mockResolvedValue([adminUserRecord]);
  prisma.user.count.mockResolvedValue(30);
  const app = await loadApp(prisma);

  const response = await request(app)
    .get('/api/v1/admin/users?page=2&limit=10')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .expect(200);

  expect(response.body.data).toEqual({
    items: [adminUserRecord],
    page: 2,
    limit: 10,
    total: 30,
    totalPages: 3,
  });
  expect(prisma.user.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ skip: 10, take: 10 }),
  );
  expect(prisma.user.count).toHaveBeenCalled();
});

it('forwards role, status, unit, career and search filters', async () => {
  const prisma = createPrismaMock();
  mockUserLookup(prisma);
  prisma.user.findMany.mockResolvedValue([]);
  prisma.user.count.mockResolvedValue(0);
  const app = await loadApp(prisma);

  await request(app)
    .get(
      '/api/v1/admin/users?globalRole=ADMIN&isActive=false&unitId=unit-001&careerId=car-001&q=perez',
    )
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .expect(200);

  expect(prisma.user.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        globalRole: 'ADMIN',
        isActive: false,
        unitId: 'unit-001',
        careerId: 'car-001',
        OR: [
          { firstName: { contains: 'perez', mode: 'insensitive' } },
          { lastName: { contains: 'perez', mode: 'insensitive' } },
          { email: { contains: 'perez', mode: 'insensitive' } },
          { identificationNumber: { contains: 'perez', mode: 'insensitive' } },
        ],
      }),
    }),
  );
});

it('queries only safe user fields for the admin list', async () => {
  const prisma = createPrismaMock();
  mockUserLookup(prisma);
  let capturedArgs: { select: Record<string, unknown> } | undefined;
  prisma.user.findMany.mockImplementation((args: { select: Record<string, unknown> }) => {
    capturedArgs = args;
    return Promise.resolve([]);
  });
  prisma.user.count.mockResolvedValue(0);
  const app = await loadApp(prisma);

  await request(app)
    .get('/api/v1/admin/users')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .expect(200);

  expect(capturedArgs?.select).toMatchObject({ id: true, isActive: true });
  expect(capturedArgs?.select).not.toHaveProperty('name');
  expect(capturedArgs?.select).not.toHaveProperty('accounts');
  expect(capturedArgs?.select).not.toHaveProperty('password');
  expect(capturedArgs?.select).not.toHaveProperty('passwordHash');
  expect(capturedArgs?.select).not.toHaveProperty('emailVerified');
});

it('does not expose internal or credential fields in the admin list', async () => {
  const prisma = createPrismaMock();
  mockUserLookup(prisma);
  prisma.user.findMany.mockResolvedValue([adminUserRecord]);
  prisma.user.count.mockResolvedValue(1);
  const app = await loadApp(prisma);

  const response = await request(app)
    .get('/api/v1/admin/users')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .expect(200);

  expect(JSON.stringify(response.body)).not.toContain('$argon2');
  expect(response.body.data.items[0]).not.toHaveProperty('name');
  expect(response.body.data.items[0]).not.toHaveProperty('accounts');
  expect(response.body.data.items[0]).not.toHaveProperty('password');
  expect(response.body.data.items[0]).not.toHaveProperty('passwordHash');
  expect(response.body.data.items[0]).not.toHaveProperty('emailVerified');
});

it('rejects invalid admin list query parameters', async () => {
  const prisma = createPrismaMock();
  mockUserLookup(prisma);
  const app = await loadApp(prisma);

  for (const query of ['globalRole=SUPERADMIN', 'isActive=maybe', 'limit=51', 'unexpected=1']) {
    const response = await request(app)
      .get(`/api/v1/admin/users?${query}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(400);

    expect(response.body.message).toBe('Validation error.');
  }

  expect(prisma.user.findMany).not.toHaveBeenCalled();
});
```

- [x] **Step 3: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/users/users.routes.test.ts`

Expected: FAIL con 404 en `/api/v1/admin/users` (la ruta no existe).

- [x] **Step 4: Implementar el controlador**

En `src/modules/users/users.controller.ts`:

```ts
import type { ListUsersQuery, UpdateProfileSchemaBody } from './users.schemas.js';
import { getProfile, listUsers as listUsersService, updateProfile } from './users.service.js';

export const listUsers = asyncHandler(async (req, res) => {
  const query = req.query as unknown as ListUsersQuery;
  const result = await listUsersService(query);

  res.status(200).json(successResponse('Users retrieved successfully.', result));
});
```

- [x] **Step 5: Implementar la ruta**

En `src/modules/users/users.routes.ts`:

```ts
import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { requireAdmin } from '../../middlewares/authorize.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { getCurrentUser, listUsers, updateCurrentUser } from './users.controller.js';
import { listUsersQuerySchema, updateProfileSchema } from './users.schemas.js';

export const usersRoutes = Router();

usersRoutes.get('/users/me', authenticate, getCurrentUser);
usersRoutes.patch('/users/me', authenticate, validate(updateProfileSchema), updateCurrentUser);
usersRoutes.get(
  '/admin/users',
  authenticate,
  requireAdmin,
  validate(listUsersQuerySchema),
  listUsers,
);
```

- [x] **Step 6: Verificar el verde**

Run: `pnpm exec vitest run src/modules/users/users.routes.test.ts`

Expected: PASS.

### Task 4: Contrato OpenAPI (TDD)

**Files:**

- Modify: `src/modules/users/users.openapi.ts`
- Modify: `src/docs/openapi.ts`
- Modify: `src/docs/openapi.test.ts`
- Modify: `openapi.json` (generado)

- [x] **Step 1: Escribir las pruebas rojas del contrato**

En `src/docs/openapi.test.ts`, agregar `'GET /api/v1/admin/users'` a `expectedOperations` y los tests:

```ts
it('marks the admin user list with bearer security and a paginated response', () => {
  const operation = openApiDocument.paths?.['/api/v1/admin/users']?.get;

  expect(operation?.security).toEqual([{ bearerAuth: [] }]);
  expect(operation?.responses?.['200']).toBeDefined();
  expect(operation?.responses?.['401']).toBeDefined();
  expect(operation?.responses?.['403']).toBeDefined();
  expect(openApiDocument.components?.schemas).toHaveProperty('AdminUser');
  expect(openApiDocument.components?.schemas).toHaveProperty('PaginatedUsers');
});

it('documents the admin user list query parameters', () => {
  const parameters = openApiDocument.paths?.['/api/v1/admin/users']?.get?.parameters ?? [];
  const names = parameters.map((parameter) => ('name' in parameter ? parameter.name : undefined));

  expect(names).toEqual(
    expect.arrayContaining(['page', 'limit', 'globalRole', 'isActive', 'unitId', 'careerId', 'q']),
  );
});
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/docs/openapi.test.ts`

Expected: FAIL porque la operacion no existe.

- [x] **Step 3: Documentar la ruta y el tag**

En `src/modules/users/users.openapi.ts`, importar los esquemas nuevos y agregar la ruta:

```ts
import {
  listUsersQuerySchema,
  paginatedUsersSchema,
  updateProfileSchema,
  userProfileSchema,
} from './users.schemas.js';
```

```ts
'/api/v1/admin/users': {
  get: {
    tags: ['Admin'],
    summary: 'List users',
    description:
      'Administrative user listing. Requires the ADMIN role. Supports pagination, case-insensitive search by name, email or identification number, and filters by role, status, organizational unit and career.',
    security: [{ bearerAuth: [] }],
    requestParams: { query: listUsersQuerySchema.shape.query },
    responses: {
      200: {
        description: 'Paginated list of user accounts.',
        content: { 'application/json': { schema: apiSuccessResponse(paginatedUsersSchema) } },
      },
      400: errorResponse,
      401: errorResponse,
      403: errorResponse,
    },
  },
},
```

En `src/docs/openapi.ts`, registrar el tag despues de `Users`:

```ts
{ name: 'Admin', description: 'Administrative operations.' },
```

- [x] **Step 4: Regenerar y verificar el contrato**

Run:

```bash
pnpm run docs:generate
pnpm exec vitest run src/docs/openapi.test.ts
pnpm run docs:check
```

Expected: `openapi.json` con `AdminUser`, `PaginatedUsers` y la operacion; tests y check en verde.

### Task 5: Bruno con assertions y caso 403

**Files:**

- Create: `bruno/Admin/folder.bru`
- Create: `bruno/Admin/Log in as admin.bru`
- Create: `bruno/Admin/List users.bru`
- Create: `bruno/Admin/Log in as a regular user.bru`
- Create: `bruno/Admin/List users as USER returns 403.bru`
- Modify: `bruno/environments/local.bru`

- [x] **Step 1: Crear la carpeta y los logins**

`bruno/Admin/folder.bru`:

```bru
meta {
  name: Admin
}

auth {
  mode: inherit
}

docs {
  Administrative operations.
}
```

`bruno/Admin/Log in as admin.bru` (guarda `adminToken` sin pisar `token`):

```bru
meta {
  name: Log in as admin
  type: http
  seq: 1
  tags: [
    Admin
  ]
}

post {
  url: {{baseUrl}}/api/v1/auth/login
  body: json
  auth: none
}

body:json {
  {
    "email": "{{demoEmail}}",
    "password": "{{demoPassword}}"
  }
}

script:post-response {
  const body = res.getBody();

  if (body?.success && body.data?.accessToken) {
    bru.setVar("adminToken", body.data.accessToken);
  }
}

tests {
  test("admin login returns an access token", function () {
    expect(res.getStatus()).to.equal(200);
    expect(res.getBody().data.accessToken).to.be.a("string");
  });
}
```

`bruno/Admin/Log in as a regular user.bru`:

```bru
meta {
  name: Log in as a regular user
  type: http
  seq: 3
  tags: [
    Admin
  ]
}

post {
  url: {{baseUrl}}/api/v1/auth/login
  body: json
  auth: none
}

body:json {
  {
    "email": "{{regularEmail}}",
    "password": "{{demoPassword}}"
  }
}

script:post-response {
  const body = res.getBody();

  if (body?.success && body.data?.accessToken) {
    bru.setVar("regularToken", body.data.accessToken);
  }
}

tests {
  test("regular user login returns an access token", function () {
    expect(res.getStatus()).to.equal(200);
    expect(res.getBody().data.accessToken).to.be.a("string");
  });
}
```

- [x] **Step 2: Crear el listado con assertions**

`bruno/Admin/List users.bru`:

```bru
meta {
  name: List users
  type: http
  seq: 2
  tags: [
    Admin
  ]
}

get {
  url: {{baseUrl}}/api/v1/admin/users?page=1&limit=5
  body: none
  auth: bearer
}

params:query {
  page: 1
  limit: 5
}

auth:bearer {
  token: {{adminToken}}
}

tests {
  test("admin list returns a paginated envelope", function () {
    expect(res.getStatus()).to.equal(200);
    const body = res.getBody();
    expect(body.success).to.equal(true);
    expect(body.data.items).to.be.an("array");
    expect(body.data.page).to.equal(1);
    expect(body.data.limit).to.equal(5);
    expect(body.data.total).to.be.a("number");
    expect(body.data.totalPages).to.be.a("number");
  });

  test("admin list does not leak internal or credential fields", function () {
    const body = res.getBody();
    const serialized = JSON.stringify(body);
    expect(serialized).to.not.include("$argon2");
    for (const item of body.data.items) {
      expect(item).to.have.property("isActive");
      expect(item).to.not.have.property("name");
      expect(item).to.not.have.property("accounts");
      expect(item).to.not.have.property("password");
      expect(item).to.not.have.property("passwordHash");
      expect(item).to.not.have.property("emailVerified");
    }
  });
}
```

- [x] **Step 3: Crear el caso 403**

`bruno/Admin/List users as USER returns 403.bru`:

```bru
meta {
  name: List users as USER returns 403
  type: http
  seq: 4
  tags: [
    Admin
  ]
}

get {
  url: {{baseUrl}}/api/v1/admin/users
  body: none
  auth: bearer
}

auth:bearer {
  token: {{regularToken}}
}

tests {
  test("regular users cannot list all users", function () {
    expect(res.getStatus()).to.equal(403);
    const body = res.getBody();
    expect(body.success).to.equal(false);
    expect(body.message).to.equal("Insufficient privileges for this resource.");
  });
}
```

- [x] **Step 4: Agregar la variable del usuario regular**

En `bruno/environments/local.bru`, agregar:

```bru
regularEmail: organizador.fic@utp.ac.pa
```

- [x] **Step 5: Ejecutar la carpeta**

Run: `pnpm --dir bruno exec bru run Admin --env local`

Expected: 4/4 requests y 4/4 tests en verde. El script de captura del login de `Auth` no se modifica.

### Task 6: Verificacion real contra el stack local

**Files:**

- Create temporal: `.tmp-f18-integration.mts` (se elimina al terminar)

- [x] **Step 1: Confirmar el stack y los datos**

Run:

```bash
docker compose -f compose.dev.yaml ps --format '{{.Name}} {{.Status}}'
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg -c "SELECT count(*) FROM users;"
```

Expected: api/db arriba y el conteo de usuarios del seed (30 en el seed demo).

- [x] **Step 2: Ejecutar la verificacion**

Contenido de `.tmp-f18-integration.mts` (login admin y organizador contra `http://localhost:3000`, sin imprimir tokens):

```ts
const baseUrl = 'http://localhost:3000';

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

const adminToken = await login('admin@utp.ac.pa');
const userToken = await login('organizador.fic@utp.ac.pa');

const get = async (path: string, token: string) => {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  return { status: response.status, body };
};

const results: string[] = [];

const list = await get('/api/v1/admin/users?page=1&limit=5', adminToken);
if (list.status !== 200 || !Array.isArray(list.body.data?.items)) {
  throw new Error(`Admin list failed: ${list.status} ${JSON.stringify(list.body)}`);
}
if (list.body.data.items.length !== 5) {
  throw new Error(`Expected 5 items, got ${list.body.data.items.length}`);
}
results.push(
  `200 admin list total=${list.body.data.total} totalPages=${list.body.data.totalPages}`,
);

const serialized = JSON.stringify(list.body);
for (const forbidden of ['$argon2', 'passwordHash', '"accounts"', 'emailVerified']) {
  if (serialized.includes(forbidden)) {
    throw new Error(`Sensitive field leaked: ${forbidden}`);
  }
}
results.push('sin campos sensibles');

const forbiddenUser = await get('/api/v1/admin/users', userToken);
if (forbiddenUser.status !== 403) {
  throw new Error(`Expected 403 for USER, got ${forbiddenUser.status}`);
}
results.push('USER -> 403');

const admins = await get('/api/v1/admin/users?globalRole=ADMIN', adminToken);
if (
  admins.status !== 200 ||
  admins.body.data.items.length === 0 ||
  admins.body.data.items.some((item: { globalRole: string }) => item.globalRole !== 'ADMIN')
) {
  throw new Error('globalRole filter failed.');
}
results.push(`globalRole=ADMIN -> ${admins.body.data.total}`);

const byUnit = await get('/api/v1/admin/users?unitId=seed_unit_fic', adminToken);
if (byUnit.status !== 200 || byUnit.body.data.items.length === 0) {
  throw new Error('unitId filter failed.');
}
results.push(`unitId=seed_unit_fic -> ${byUnit.body.data.total}`);

const bySearch = await get('/api/v1/admin/users?q=arosemena', adminToken);
if (bySearch.status !== 200 || bySearch.body.data.items.length === 0) {
  throw new Error('q filter failed.');
}
results.push(`q=arosemena -> ${bySearch.body.data.total}`);

const invalid = await get('/api/v1/admin/users?limit=51', adminToken);
if (invalid.status !== 400) {
  throw new Error(`Expected 400 for limit=51, got ${invalid.status}`);
}
results.push('limit=51 -> 400');

console.log(results.join('\n'));
```

Run: `pnpm exec tsx .tmp-f18-integration.mts`

Expected: todas las lineas de verificacion sin errores.

- [x] **Step 3: Contrastar filtros contra la BD**

Run:

```bash
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg -c "SELECT count(*) FROM users WHERE global_role = 'ADMIN';"
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg -c "SELECT count(*) FROM users WHERE unit_id = 'seed_unit_fic';"
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg -c "SELECT count(*) FROM users WHERE last_name ILIKE '%arosemena%';"
```

Expected: los totales coinciden con la salida del script.

- [x] **Step 4: Eliminar el script temporal**

Run: `rm .tmp-f18-integration.mts`

Expected: el arbol no conserva artefactos temporales nuevos.

### Task 7: Calidad completa y cierre

**Files:**

- Modify: `README.md`
- Modify: `CONTEXT.md`
- Modify: `docs/superpowers/plans/2026-09-19-fase-1-8-listar-usuarios.md`
- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [x] **Step 1: Documentar el endpoint**

En `README.md`, agregar junto a los endpoints de usuarios:

```md
- `GET /api/v1/admin/users` (solo `ADMIN`) lista usuarios con paginacion (`page`/`limit`), busqueda `q` (nombre, apellido, email o identificacion) y filtros `globalRole`, `isActive`, `unitId` y `careerId`; no expone `name`, `accounts`, `password` ni `emailVerified`.
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

Expected: todos en verde.

- [x] **Step 3: Registrar evidencia y cerrar 1.8**

Marcar las tareas de este plan, marcar 1.8 en el maestro, actualizar la tabla de estado (administracion de usuarios en curso) y agregar el registro con conteos de pruebas, evidencia real, resultados de Bruno y hallazgos. No hacer commit: el usuario no lo solicito.

---

## Threat model resumido

- **BFLA (Broken Function Level Authorization):** la ruta exige `authenticate` + `requireAdmin`; un `USER` recibe 403 antes de tocar Prisma y antes de la validacion de query.
- **Fuga de datos:** `adminUserSelect` excluye `name`, `accounts`, `password`, `passwordHash` y `emailVerified`; se fija con pruebas de servicio, ruta, Bruno y OpenAPI.
- **Inyeccion/abuso de filtros:** Zod `.strict()` rechaza claves desconocidas; `isActive` se transforma a booleano real (no se usa `z.coerce.boolean()`, que acepta `"false"` como verdadero); `page`/`limit` acotados a 1 y 50.
- **Enumeracion masiva:** el endpoint es administrativo y no revela si un `unitId`/`careerId` existe (filtro vacio, no 404).

## Self-review

- Cobertura 1.8: solo ADMIN (401/403), paginacion, busqueda `q`, filtros rol/estado/unidad/carrera, ausencia de campos sensibles y contrato OpenAPI/Bruno.
- Sin migraciones ni variables de entorno: el modelo `User` ya expone `isActive`, `unitId` y `careerId`.
- Sin cambios de contrato en `/users/me`: los componentes nuevos son `AdminUser` y `PaginatedUsers`; renombrarlos seria un breaking change futuro.
- El servicio devuelve registros de Prisma con `select` acotado, consistente con `getProfile`; la proteccion se verifica inspeccionando el `select` enviado a Prisma.

## Registro de ejecucion (2026-09-19)

- Plan detallado con ciclo TDD rojo/verde en las 4 capas: esquemas (5 pruebas), servicio (4), ruta (7) y contrato OpenAPI (2); red inicial verificada en cada caso (funciones/esquemas inexistentes y 404 en la ruta antes de implementar).
- Implementacion: `listUsersQuerySchema` (`.strict()`, `isActive` transformado a booleano real, `page`/`limit` 1-50), `adminUserSchema`/`paginatedUsersSchema` (`AdminUser`/`PaginatedUsers`), `adminUserSelect` sin campos internos, `listUsers` con `Promise.all(findMany, count)` y `GET /api/v1/admin/users` con `authenticate -> requireAdmin -> validate -> controlador`.
- Pruebas: suite completa `pnpm test` con 346 pruebas en 32 archivos en verde; suite dirigida `src/modules/users src/docs` con 82 pruebas en 6 archivos.
- Verificacion real (stack Docker, seed demo): admin 200 con `total=45`, `totalPages=9` y sin `$argon2`/`passwordHash`/`accounts`/`emailVerified`; `USER -> 403` con mensaje generico; contrastado con psql: `globalRole=ADMIN -> 1`, `unitId=seed_unit_fic -> 17`, `q=arosemena -> 1`, `isActive=true -> 45`; `limit=51 -> 400`. Script temporal eliminado.
- Bruno: `bru run Admin --env local` con 4/4 requests y 5/5 tests (login admin, listado 200 con assertions de campos sensibles, login regular y 403); `Admin` es carpeta propia porque las runtime vars no cruzan carpetas.
- Contrato: `pnpm run docs:generate` y `docs:check` sin drift; `openapi.json` con la operacion, los parametros de query y los componentes nuevos; tag `Admin` registrado.
- Calidad: `pnpm test`, `pnpm run build`, `format` de los archivos tocados y `docs:check` en verde. `pnpm run typecheck` y `pnpm run lint` fallan unicamente por archivos del trabajo concurrente de 1.7 (`src/modules/auth/auth.service.test.ts` con imports sin usar y mock incompleto, `src/modules/auth/auth.schemas.test.ts` y el plan de 1.7 sin formatear); `eslint` dirigido a `src/modules/users src/docs/openapi.ts src/docs/openapi.test.ts` pasa.
- Hallazgo operativo: `tsx watch` dentro del contenedor si detecto los cambios de `src/`; el servidor se reinicio por ediciones concurrentes de 1.7 durante la verificacion y la primera corrida de integracion fallo con `UND_ERR_SOCKET`; se reintento con el contenedor estable.
- Sin commit: el usuario no lo solicito.
