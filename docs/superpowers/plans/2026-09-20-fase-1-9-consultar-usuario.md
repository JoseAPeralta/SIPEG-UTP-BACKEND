# Fase 1.9 - Consultar usuario (`GET /api/v1/admin/users/:id`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar el checklist 1.9 del plan maestro implementando `GET /api/v1/admin/users/:id` con acceso exclusivo `ADMIN`, DTO administrativo seguro y `404` para un identificador inexistente.

**Architecture:** El endpoint vive en el modulo autocontenido `src/modules/users/` y sigue el patron de 1.8: `authenticate -> requireAdmin -> validate(params) -> controller -> service -> Prisma`. El servicio reutiliza `adminUserSelect` y el contrato reutiliza los esquemas `adminUserSchema`/`AdminUser`, por lo que no hay componentes OpenAPI nuevos ni breaking changes.

**Tech Stack:** TypeScript 6, Express 5, Prisma 7, Zod 4, Vitest, Supertest, OpenAPI 3.1, Bruno.

**Hallazgos de partida (2026-09-20):**

- `src/modules/users/` tiene `GET/PATCH /users/me` y `GET /admin/users` (80 pruebas en 5 archivos; 83 con `src/docs`), todas en verde.
- `requireAdmin` responde `403 Insufficient privileges for this resource.` a `USER` antes de tocar Prisma.
- `adminUserSelect` (`users.service.ts:17`) ya excluye `name`, `accounts`, `password`, `passwordHash` y `emailVerified`; `adminUserSchema` (`AdminUser`) ya esta documentado en OpenAPI.
- `mockUserLookup` (`users.routes.test.ts:130`) discrimina por `select` (la autenticacion usa `isActive`); para el detalle hace falta discriminar tambien por `where.id`.
- No se requieren migraciones ni variables de entorno nuevas.
- Trabajo concurrente de 1.7 sin commitear en `src/modules/auth/`; si los gates globales fallan alli, se documentara y se usaran gates dirigidos al modulo `users` y `src/docs`.

---

### Task 1: Esquema de params (TDD)

**Files:**

- Modify: `src/modules/users/users.schemas.ts`
- Modify: `src/modules/users/users.schemas.test.ts`

- [x] **Step 1: Escribir las pruebas rojas del esquema**

Agregar al final de `src/modules/users/users.schemas.test.ts`:

```ts
describe('adminUserParamsSchema', () => {
  it('accepts and trims a user id', () => {
    expect(adminUserParamsSchema.parse({ params: { id: ' user-001 ' } })).toEqual({
      params: { id: 'user-001' },
    });
  });

  it('rejects an empty or whitespace user id', () => {
    expect(() => adminUserParamsSchema.parse({ params: { id: '' } })).toThrow();
    expect(() => adminUserParamsSchema.parse({ params: { id: '   ' } })).toThrow();
  });

  it('rejects an oversized user id', () => {
    expect(() => adminUserParamsSchema.parse({ params: { id: 'a'.repeat(101) } })).toThrow();
  });
});
```

Actualizar el import del encabezado:

```ts
import {
  adminUserParamsSchema,
  adminUserSchema,
  listUsersQuerySchema,
  updateProfileSchema,
  userProfileSchema,
} from './users.schemas.js';
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/users/users.schemas.test.ts`

Expected: FAIL porque `adminUserParamsSchema` no existe.

- [x] **Step 3: Implementar el esquema**

En `src/modules/users/users.schemas.ts`, agregar despues de `listUsersQuerySchema`:

```ts
export const adminUserParamsSchema = z.object({
  params: z.object({
    id: z
      .string()
      .trim()
      .min(1, 'User id is required.')
      .max(100, 'User id cannot exceed 100 characters.'),
  }),
});

export type AdminUserParams = z.infer<typeof adminUserParamsSchema>['params'];
```

- [x] **Step 4: Verificar el verde**

Run: `pnpm exec vitest run src/modules/users/users.schemas.test.ts`

Expected: PASS.

### Task 2: Servicio de detalle (TDD)

**Files:**

- Modify: `src/modules/users/users.service.ts`
- Modify: `src/modules/users/users.service.test.ts`

- [x] **Step 1: Escribir las pruebas rojas del servicio**

Agregar al final del `describe('users service')` en `src/modules/users/users.service.test.ts`:

```ts
it('returns the administrative view of an existing user', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminUserRecord);
  const { getUserById } = await loadService(prisma);

  const user = await getUserById('user-001');

  expect(user).toEqual(adminUserRecord);
  expect(prisma.user.findUnique).toHaveBeenCalledWith({
    where: { id: 'user-001' },
    select: expect.objectContaining({ id: true, isActive: true }),
  });
});

it('fails when the requested user does not exist', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(null);
  const { getUserById } = await loadService(prisma);

  await expect(getUserById('missing')).rejects.toMatchObject({
    statusCode: 404,
    message: 'User not found.',
  });
});

it('selects only safe fields for the administrative detail', async () => {
  const prisma = createPrismaMock();
  let capturedArgs: { select: Record<string, unknown> } | undefined;
  prisma.user.findUnique.mockImplementation((args: { select: Record<string, unknown> }) => {
    capturedArgs = args;
    return Promise.resolve(adminUserRecord);
  });
  const { getUserById } = await loadService(prisma);

  await getUserById('user-001');

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

Expected: FAIL porque `getUserById` no existe.

- [x] **Step 3: Implementar el servicio**

En `src/modules/users/users.service.ts`, importar `AdminUserResponse` y agregar la funcion despues de `listUsers`:

```ts
export const getUserById = async (userId: string): Promise<AdminUserResponse> => {
  const prisma = getPrismaClient();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: adminUserSelect,
  });

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  return user;
};
```

Import actualizado:

```ts
import type {
  AdminUserResponse,
  PaginatedUsers,
  UpdateProfileInput,
  UserProfileResponse,
} from './users.types.js';
```

- [x] **Step 4: Verificar el verde**

Run: `pnpm exec vitest run src/modules/users/users.service.test.ts`

Expected: PASS.

### Task 3: Controlador y ruta admin (TDD)

**Files:**

- Modify: `src/modules/users/users.controller.ts`
- Modify: `src/modules/users/users.routes.ts`
- Modify: `src/modules/users/users.routes.test.ts`

- [x] **Step 1: Extender el arnes de pruebas de ruta**

En `src/modules/users/users.routes.test.ts`:

1. Extender `mockUserLookup` para el detalle administrativo antes de la rama de autenticacion:

```ts
const mockUserLookup = (prisma: PrismaMock): void => {
  prisma.user.findUnique.mockImplementation((args: UserLookupArgs) => {
    const select = args.select ?? {};

    if (args.where.id === 'user-target') {
      return Promise.resolve(adminUserRecord);
    }

    if ('isActive' in select) {
      return Promise.resolve(authUserRecords[args.where.id] ?? null);
    }

    if ('unitId' in select && 'careerId' in select) {
      return Promise.resolve(ownerRecords[args.where.id] ?? null);
    }

    return Promise.resolve(profileRecords[args.where.id] ?? null);
  });
};
```

1. Declarar el registro objetivo junto a `adminUserRecord`:

```ts
const targetUserRecord = {
  id: 'user-target',
  firstName: 'Ana',
  lastName: 'Gomez',
  identificationNumber: '8-555-1234',
  email: 'ana.gomez@example.com',
  globalRole: 'USER',
  isActive: false,
  unit: { id: 'unit-002', name: 'Ciencias', code: 'FCC' },
  career: null,
};
```

- [x] **Step 2: Escribir las pruebas rojas de ruta**

Agregar al final del `describe('users routes')`:

```ts
it('rejects the admin user detail without a token', async () => {
  const app = await loadApp(createPrismaMock());

  await request(app).get('/api/v1/admin/users/user-target').expect(401);
});

it('rejects the admin user detail for non-admin users', async () => {
  const prisma = createPrismaMock();
  mockUserLookup(prisma);
  const app = await loadApp(prisma);

  const response = await request(app)
    .get('/api/v1/admin/users/user-target')
    .set('Authorization', `Bearer ${accessToken}`)
    .expect(403);

  expect(response.body.message).toBe('Insufficient privileges for this resource.');
  expect(prisma.user.findUnique).not.toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 'user-target' } }),
  );
});

it('returns the administrative user detail for administrators', async () => {
  const prisma = createPrismaMock();
  mockUserLookup(prisma);
  const app = await loadApp(prisma);

  const response = await request(app)
    .get('/api/v1/admin/users/user-target')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .expect(200);

  expect(response.body.data).toEqual(targetUserRecord);
  expect(prisma.user.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 'user-target' } }),
  );
});

it('queries only safe user fields for the admin detail', async () => {
  const prisma = createPrismaMock();
  mockUserLookup(prisma);
  let capturedArgs: { where: { id: string }; select: Record<string, unknown> } | undefined;
  prisma.user.findUnique.mockImplementation(
    (args: { where: { id: string }; select: Record<string, unknown> }) => {
      if (args.select && 'firstName' in args.select) {
        capturedArgs = args;
      }
      return Promise.resolve(authUserRecords[args.where.id] ?? null);
    },
  );
  const app = await loadApp(prisma);

  await request(app)
    .get('/api/v1/admin/users/user-target')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .expect(200);

  expect(capturedArgs?.select).toMatchObject({ id: true, isActive: true });
  expect(capturedArgs?.select).not.toHaveProperty('name');
  expect(capturedArgs?.select).not.toHaveProperty('accounts');
  expect(capturedArgs?.select).not.toHaveProperty('password');
  expect(capturedArgs?.select).not.toHaveProperty('passwordHash');
  expect(capturedArgs?.select).not.toHaveProperty('emailVerified');
});

it('does not expose internal or credential fields in the admin detail', async () => {
  const prisma = createPrismaMock();
  mockUserLookup(prisma);
  const app = await loadApp(prisma);

  const response = await request(app)
    .get('/api/v1/admin/users/user-target')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .expect(200);

  expect(JSON.stringify(response.body)).not.toContain('$argon2');
  expect(response.body.data).not.toHaveProperty('name');
  expect(response.body.data).not.toHaveProperty('accounts');
  expect(response.body.data).not.toHaveProperty('password');
  expect(response.body.data).not.toHaveProperty('passwordHash');
  expect(response.body.data).not.toHaveProperty('emailVerified');
});

it('returns 404 for an unknown user id', async () => {
  const prisma = createPrismaMock();
  mockUserLookup(prisma);
  const app = await loadApp(prisma);

  const response = await request(app)
    .get('/api/v1/admin/users/user-does-not-exist')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .expect(404);

  expect(response.body).toEqual({
    success: false,
    message: 'User not found.',
    errors: [],
  });
});

it('rejects a whitespace user id', async () => {
  const prisma = createPrismaMock();
  mockUserLookup(prisma);
  const app = await loadApp(prisma);

  const response = await request(app)
    .get('/api/v1/admin/users/%20')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .expect(400);

  expect(response.body.message).toBe('Validation error.');
  expect(prisma.user.findUnique).not.toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: '' } }),
  );
});
```

- [x] **Step 3: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/users/users.routes.test.ts`

Expected: FAIL con 404 en `/api/v1/admin/users/user-target` (la ruta no existe).

- [x] **Step 4: Implementar el controlador**

En `src/modules/users/users.controller.ts`:

```ts
import { getUserById as getUserByIdService, ... } from './users.service.js';

export const getUser = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const user = await getUserByIdService(id);

  res.status(200).json(successResponse('User retrieved successfully.', user));
});
```

- [x] **Step 5: Implementar la ruta**

En `src/modules/users/users.routes.ts`, registrar despues del listado:

```ts
usersRoutes.get(
  '/admin/users/:id',
  authenticate,
  requireAdmin,
  validate(adminUserParamsSchema),
  getUser,
);
```

Import actualizado:

```ts
import { getCurrentUser, getUser, listUsers, updateCurrentUser } from './users.controller.js';
import {
  adminUserParamsSchema,
  listUsersQuerySchema,
  updateProfileSchema,
} from './users.schemas.js';
```

- [x] **Step 6: Verificar el verde**

Run: `pnpm exec vitest run src/modules/users/users.routes.test.ts`

Expected: PASS.

### Task 4: Contrato OpenAPI (TDD)

**Files:**

- Modify: `src/modules/users/users.openapi.ts`
- Modify: `src/docs/openapi.test.ts`
- Modify: `openapi.json` (generado)

- [x] **Step 1: Escribir las pruebas rojas del contrato**

En `src/docs/openapi.test.ts`, agregar `'GET /api/v1/admin/users/{id}'` a `expectedOperations` y los tests:

```ts
it('marks the admin user detail with bearer security and a 404 response', () => {
  const operation = openApiDocument.paths?.['/api/v1/admin/users/{id}']?.get;

  expect(operation?.security).toEqual([{ bearerAuth: [] }]);
  expect(operation?.responses?.['200']).toBeDefined();
  expect(operation?.responses?.['401']).toBeDefined();
  expect(operation?.responses?.['403']).toBeDefined();
  expect(operation?.responses?.['404']).toBeDefined();
  expect(openApiDocument.components?.schemas).toHaveProperty('AdminUser');
});

it('documents the admin user detail path parameter', () => {
  const parameters = openApiDocument.paths?.['/api/v1/admin/users/{id}']?.get?.parameters ?? [];
  const names = parameters.map((parameter) => ('name' in parameter ? parameter.name : undefined));

  expect(names).toContain('id');
});
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/docs/openapi.test.ts`

Expected: FAIL porque la operacion no existe.

- [x] **Step 3: Documentar la ruta**

En `src/modules/users/users.openapi.ts`, importar `adminUserParamsSchema` y agregar la ruta despues de `/api/v1/admin/users`:

```ts
'/api/v1/admin/users/{id}': {
  get: {
    tags: ['Admin'],
    summary: 'Get a user by id',
    description: 'Administrative user detail. Requires the ADMIN role.',
    security: [{ bearerAuth: [] }],
    requestParams: { path: adminUserParamsSchema.shape.params },
    responses: {
      200: {
        description: 'Administrative view of the requested user account.',
        content: { 'application/json': { schema: apiSuccessResponse(adminUserSchema) } },
      },
      400: errorResponse,
      401: errorResponse,
      403: errorResponse,
      404: errorResponse,
    },
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

Expected: `openapi.json` con la operacion y el path param `id`; tests y check en verde.

### Task 5: Bruno con assertions y caso 404

**Files:**

- Create: `bruno/Admin/Get user by id.bru`
- Create: `bruno/Admin/Get unknown user returns 404.bru`
- Modify: `bruno/environments/local.bru`

- [x] **Step 1: Crear el detalle 200**

`bruno/Admin/Get user by id.bru` (seq 5, despues del caso 403, para reutilizar `adminToken`):

```bru
meta {
  name: Get user by id
  type: http
  seq: 5
  tags: [
    Admin
  ]
}

get {
  url: {{baseUrl}}/api/v1/admin/users/{{targetUserId}}
  body: none
  auth: bearer
}

auth:bearer {
  token: {{adminToken}}
}

tests {
  test("admin detail returns the safe administrative DTO", function () {
    expect(res.getStatus()).to.equal(200);
    const body = res.getBody();
    expect(body.success).to.equal(true);
    expect(body.message).to.equal("User retrieved successfully.");
    expect(body.data.id).to.equal(bru.getEnvVar("targetUserId"));
    expect(body.data).to.have.property("isActive");
    expect(JSON.stringify(body)).to.not.include("$argon2");
    expect(body.data).to.not.have.property("name");
    expect(body.data).to.not.have.property("accounts");
    expect(body.data).to.not.have.property("password");
    expect(body.data).to.not.have.property("passwordHash");
    expect(body.data).to.not.have.property("emailVerified");
  });
}
```

- [x] **Step 2: Crear el caso 404**

`bruno/Admin/Get unknown user returns 404.bru`:

```bru
meta {
  name: Get unknown user returns 404
  type: http
  seq: 6
  tags: [
    Admin
  ]
}

get {
  url: {{baseUrl}}/api/v1/admin/users/{{unknownUserId}}
  body: none
  auth: bearer
}

auth:bearer {
  token: {{adminToken}}
}

tests {
  test("unknown user ids produce a generic 404", function () {
    expect(res.getStatus()).to.equal(404);
    const body = res.getBody();
    expect(body.success).to.equal(false);
    expect(body.message).to.equal("User not found.");
  });
}
```

- [x] **Step 3: Agregar las variables de entorno**

En `bruno/environments/local.bru`, agregar:

```bru
targetUserId: seed_user_org-fic
unknownUserId: user-does-not-exist
```

- [x] **Step 4: Ejecutar la carpeta**

Run: `pnpm --dir bruno exec bru run Admin --env local`

Expected: 6/6 requests y 8/8 tests en verde. El script de captura del login de `Auth` no se modifica.

### Task 6: Verificacion real contra el stack local

**Files:**

- Create temporal: `.tmp-f19-integration.mts` (se elimina al terminar)

- [x] **Step 1: Confirmar el stack y los datos**

Run:

```bash
docker compose -f compose.dev.yaml ps --format '{{.Name}} {{.Status}}'
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg -c "SELECT id, email, is_active FROM users WHERE id = 'seed_user_org-fic';"
```

Expected: api/db arriba y la fila del usuario objetivo del seed demo.

- [x] **Step 2: Ejecutar la verificacion**

Contenido de `.tmp-f19-integration.mts` (login admin y organizador contra `http://localhost:3000`, sin imprimir tokens):

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
const targetUserId = 'seed_user_org-fic';

const detail = await get(`/api/v1/admin/users/${targetUserId}`, adminToken);
if (detail.status !== 200 || detail.body.data?.id !== targetUserId) {
  throw new Error(`Admin detail failed: ${detail.status} ${JSON.stringify(detail.body)}`);
}

const serialized = JSON.stringify(detail.body);
for (const forbidden of ['$argon2', 'passwordHash', '"accounts"', 'emailVerified']) {
  if (serialized.includes(forbidden)) {
    throw new Error(`Sensitive field leaked: ${forbidden}`);
  }
}
results.push(`200 detalle id=${detail.body.data.id} isActive=${detail.body.data.isActive}`);

const forbiddenUser = await get(`/api/v1/admin/users/${targetUserId}`, userToken);
if (forbiddenUser.status !== 403) {
  throw new Error(`Expected 403 for USER, got ${forbiddenUser.status}`);
}
results.push('USER -> 403');

const missing = await get('/api/v1/admin/users/user-does-not-exist', adminToken);
if (missing.status !== 404 || missing.body.message !== 'User not found.') {
  throw new Error(`Expected 404, got ${missing.status} ${JSON.stringify(missing.body)}`);
}
results.push('unknown id -> 404');

const invalid = await get('/api/v1/admin/users/%20', adminToken);
if (invalid.status !== 400) {
  throw new Error(`Expected 400 for whitespace id, got ${invalid.status}`);
}
results.push('whitespace id -> 400');

console.log(results.join('\n'));
```

Run: `pnpm exec tsx .tmp-f19-integration.mts`

Expected: todas las lineas de verificacion sin errores.

- [x] **Step 3: Contrastar contra la BD**

Run:

```bash
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg -c "SELECT count(*) FROM users WHERE id = 'seed_user_org-fic';"
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg -c "SELECT count(*) FROM users WHERE id = 'user-does-not-exist';"
```

Expected: `1` y `0`, consistentes con las respuestas de la API.

- [x] **Step 4: Eliminar el script temporal**

Run: `rm .tmp-f19-integration.mts`

Expected: el arbol no conserva artefactos temporales nuevos.

### Task 7: Calidad completa y cierre

**Files:**

- Modify: `README.md`
- Modify: `CONTEXT.md`
- Modify: `docs/superpowers/plans/2026-09-20-fase-1-9-consultar-usuario.md`
- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [x] **Step 1: Documentar el endpoint**

En `README.md`, agregar junto a los endpoints de usuarios:

```md
- `GET /api/v1/admin/users/{id}` (solo `ADMIN`) devuelve el DTO administrativo seguro de un usuario y responde `404` para un identificador inexistente; nunca expone `name`, `accounts`, `password`, `passwordHash` ni `emailVerified`.
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

Expected: todos en verde (si algo falla solo por el trabajo concurrente de 1.7, documentarlo con gates dirigidos).

- [x] **Step 3: Registrar evidencia y cerrar 1.9**

Marcar las tareas de este plan, marcar 1.9 en el maestro, actualizar la tabla de estado (faltaran 1.10-1.11) y agregar el registro con conteos de pruebas, evidencia real, resultados de Bruno y hallazgos. No hacer commit: el usuario no lo solicito.

---

## Threat model resumido

- **BFLA (Broken Function Level Authorization):** la ruta exige `authenticate` + `requireAdmin`; un `USER` recibe 403 antes de tocar Prisma y antes de la validacion de params.
- **IDOR / enumeracion:** el endpoint es administrativo; un id inexistente produce 404 generico sin revelar detalles internos.
- **Fuga de datos:** `adminUserSelect` excluye `name`, `accounts`, `password`, `passwordHash` y `emailVerified`; se fija con pruebas de servicio, ruta, Bruno y OpenAPI.
- **Inyeccion/abuso de params:** el id se recorta (trim), se exige 1-100 caracteres y Prisma lo parametriza; espacios producen 400 antes de la consulta.

## Self-review

- Cobertura 1.9: solo ADMIN (401/403), DTO seguro y 404 para identificador inexistente.
- Sin migraciones, variables de entorno ni componentes OpenAPI nuevos: se reutilizan `AdminUser` y `adminUserSelect`.
- Sin cambios de contrato en `/users/me` ni en `GET /admin/users`.
- El test de ruta discrimina la consulta de autenticacion de la consulta de detalle sin alterar el comportamiento de `authenticate`.

---

## Registro de ejecucion (2026-09-20)

- Plan detallado con ciclo TDD rojo/verde en las 4 capas: esquema (3 pruebas; rojo por export inexistente), servicio (3; rojo por funcion inexistente), ruta (7; rojo con 404 en todas las rutas nuevas) y contrato OpenAPI (3; rojo por operacion ausente).
- Implementacion: `adminUserParamsSchema`, `getUserById` con `adminUserSelect` y `ApiError(404, 'User not found.')`, controlador `getUser`, ruta `GET /admin/users/:id` y operacion OpenAPI reutilizando `adminUserSchema`/`AdminUser`.
- Pruebas: suite dirigida `src/modules/users src/docs` 96 en 6 archivos; `pnpm test` 372 en 32 archivos en verde.
- Verificacion real (stack Docker dev, seed demo, contenedor api reiniciado): admin 200 `id=seed_user_org-fic isActive=true` sin campos sensibles; `USER -> 403`; id inexistente 404 con mensaje generico; id de solo espacios 400 `Validation error.`; psql confirmo 1 fila para el id objetivo y 0 para el inexistente. `.tmp-f19-integration.mts` eliminado.
- Bruno: `Admin/Get user by id` y `Admin/Get unknown user returns 404` con variables `targetUserId`/`unknownUserId`; `bru run Admin --env local` 6/6 requests y 7/7 tests.
- Contrato: `pnpm run docs:generate` y `docs:check` sin drift; `openapi.json` con `/api/v1/admin/users/{id}`, el path param `id` y las respuestas 400/401/403/404.
- Calidad: `pnpm test`, `typecheck`, `lint`, `build`, `format:check` y `docs:check` en verde (el trabajo concurrente de 1.7 quedo commiteado en el arbol de trabajo antes de la corrida final, por lo que no hubo fallos globales).
- Nota: la regeneracion de `openapi.json` incorporo tambien la operacion `POST /api/v1/auth/change-password` que 1.7 habia dejado sin regenerar; sin drift posterior.
- Sin commit: el usuario no lo solicito.
