# Fase 1.6 - Consulta y actualizacion de perfil (`GET/PATCH /users/me`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Cerrar el checklist 1.6 del plan maestro probando aislamiento por usuario, validacion de unidad/carrera, proteccion contra mass assignment y ausencia de `password`, `accounts` y `name` interno en las respuestas de `GET/PATCH /api/v1/users/me`.

**Architecture:** Los endpoints ya existen y delegan en `users.service.ts`, que usa `select` acotado y valida unidad/carrera antes de escribir. Esta fase agrega pruebas de caracterizacion a nivel de ruta y esquema, documenta el 409 operativo de `Otros` en OpenAPI, agrega assertions a Bruno y verifica el flujo contra el stack local con dos usuarios reales. No se esperan cambios de contrato ni de logica de negocio; si una prueba revela una brecha, se corrige con el ciclo TDD.

**Tech Stack:** TypeScript 6, Express 5, Prisma 7, Zod 4, Vitest, Supertest, OpenAPI 3.1, Bruno.

**Hallazgos de partida (2026-09-19):**

- `GET/PATCH /api/v1/users/me` implementados con `authenticate`, `validate(updateProfileSchema)` y `users.service.ts`; 24 pruebas verdes en `src/modules/users/`.
- El baseline completo estaba rojo por un test duplicado fuera del `describe` en `src/modules/auth/auth.routes.test.ts` (trabajo 1.5 sin commitear). Ya fue eliminado: `pnpm test` = 306 pruebas en 32 archivos en verde.
- `PATCH` puede responder 409 (`The global Otros career is not configured.`) y OpenAPI no lo documenta.
- `bruno/Users/Update the authenticated user profile.bru` envia strings vacios (produciria 400) y ningun request de `Users` tiene assertions.
- El stack `compose.dev.yaml` esta arriba (api, db, mailpit) y el seed demo comparte password conocida; los usuarios demo tienen `emailVerified = true`.

---

### Task 0: Desbloquear el baseline

**Files:**

- Modify: `src/modules/auth/auth.routes.test.ts`

- [x] **Step 1: Eliminar el test duplicado fuera del `describe`**

El archivo tenia dos pruebas con el nombre `POST /verify-email returns 429 on the sixth request within a minute`; la segunda quedo despues del cierre del `describe`, produciendo un `});` sobrante y un `PARSE_ERROR`. Se elimino el bloque duplicado (lineas 616-635), conservando la version interna al `describe`.

- [x] **Step 2: Verificar la suite completa**

Run: `pnpm test`

Expected: PASS, 306 pruebas en 32 archivos.

### Task 1: Pruebas de ruta de aislamiento y validacion (TDD de caracterizacion)

**Files:**

- Modify: `src/modules/users/users.routes.test.ts`

- [x] **Step 1: Agregar el segundo token y el helper de lookup por usuario**

En `beforeAll`, firmar `otherAccessToken` con `sub = 'user-002'` y `email = 'maria.lopez@example.com'`. Agregar los registros del segundo usuario y un helper que distinga el `select` de `authenticate` (incluye `isActive`) del `select` del perfil (incluye `unit`):

```ts
const otherAuthUserRecord = {
  id: 'user-002',
  email: 'maria.lopez@example.com',
  globalRole: 'USER',
  unitId: null,
  careerId: null,
  isActive: true,
};

const otherProfileRecord = {
  id: 'user-002',
  firstName: 'Maria',
  lastName: 'Lopez',
  identificationNumber: '8-765-4321',
  email: 'maria.lopez@example.com',
  globalRole: 'USER',
  unit: null,
  career: null,
};

const authUserRecords: Record<string, unknown> = {
  'user-001': authUserRecord,
  'user-002': otherAuthUserRecord,
};

const profileRecords: Record<string, unknown> = {
  'user-001': profileRecord,
  'user-002': otherProfileRecord,
};

interface UserLookupArgs {
  where: { id: string };
  select?: Record<string, unknown>;
}

const mockUserLookup = (prisma: PrismaMock): void => {
  prisma.user.findUnique.mockImplementation((args: UserLookupArgs) => {
    if (args.select && 'isActive' in args.select) {
      return Promise.resolve(authUserRecords[args.where.id] ?? null);
    }
    return Promise.resolve(profileRecords[args.where.id] ?? null);
  });
};
```

- [x] **Step 2: Escribir las pruebas de aislamiento**

```ts
it('returns only the authenticated user profile for each token', async () => {
  const prisma = createPrismaMock();
  mockUserLookup(prisma);
  const app = await loadApp(prisma);

  const first = await request(app)
    .get('/api/v1/users/me')
    .set('Authorization', `Bearer ${accessToken}`)
    .expect(200);
  const second = await request(app)
    .get('/api/v1/users/me')
    .set('Authorization', `Bearer ${otherAccessToken}`)
    .expect(200);

  expect(first.body.data.id).toBe('user-001');
  expect(first.body.data.email).toBe('juan.perez@example.com');
  expect(second.body.data.id).toBe('user-002');
  expect(second.body.data.email).toBe('maria.lopez@example.com');
  expect(JSON.stringify(first.body)).not.toContain('maria.lopez@example.com');
  expect(prisma.user.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 'user-001' } }),
  );
  expect(prisma.user.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 'user-002' } }),
  );
});

it('updates only the authenticated user profile', async () => {
  const prisma = createPrismaMock();
  mockUserLookup(prisma);
  prisma.user.update.mockResolvedValue({ ...otherProfileRecord, firstName: 'Mariana' });
  const app = await loadApp(prisma);

  const response = await request(app)
    .patch('/api/v1/users/me')
    .set('Authorization', `Bearer ${otherAccessToken}`)
    .send({ firstName: 'Mariana', id: 'user-001' })
    .expect(200);

  expect(response.body.data.id).toBe('user-002');
  expect(prisma.user.update).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 'user-002' }, data: { firstName: 'Mariana' } }),
  );
});
```

- [x] **Step 3: Escribir las pruebas de campos internos y mass assignment**

```ts
it('does not expose internal or credential fields', async () => {
  const prisma = createPrismaMock();
  mockUserLookup(prisma);
  prisma.user.update.mockResolvedValue({ ...profileRecord, firstName: 'Juana' });
  const app = await loadApp(prisma);

  const getResponse = await request(app)
    .get('/api/v1/users/me')
    .set('Authorization', `Bearer ${accessToken}`)
    .expect(200);
  const patchResponse = await request(app)
    .patch('/api/v1/users/me')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ firstName: 'Juana' })
    .expect(200);

  for (const response of [getResponse, patchResponse]) {
    expect(response.body.data).not.toHaveProperty('name');
    expect(response.body.data).not.toHaveProperty('accounts');
    expect(response.body.data).not.toHaveProperty('password');
    expect(response.body.data).not.toHaveProperty('passwordHash');
    expect(response.body.data).not.toHaveProperty('emailVerified');
    expect(JSON.stringify(response.body)).not.toContain('$argon2');
  }
});

it('ignores extra fields and keeps only allowed profile fields', async () => {
  const prisma = createPrismaMock();
  mockUserLookup(prisma);
  prisma.user.update.mockResolvedValue({ ...profileRecord, firstName: 'Juana' });
  const app = await loadApp(prisma);

  await request(app)
    .patch('/api/v1/users/me')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      firstName: 'Juana',
      globalRole: 'ADMIN',
      isActive: false,
      email: 'attacker@example.com',
      id: 'user-002',
    })
    .expect(200);

  expect(prisma.user.update).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 'user-001' }, data: { firstName: 'Juana' } }),
  );
});

it('rejects a body with only unknown fields', async () => {
  const prisma = createPrismaMock();
  mockUserLookup(prisma);
  const app = await loadApp(prisma);

  const response = await request(app)
    .patch('/api/v1/users/me')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ globalRole: 'ADMIN' })
    .expect(400);

  expect(response.body.message).toBe('Validation error.');
  expect(response.body.errors).toEqual([
    { field: 'body', message: 'At least one field must be provided.' },
  ]);
  expect(prisma.user.update).not.toHaveBeenCalled();
});
```

- [x] **Step 4: Escribir las pruebas de validacion de unidad/carrera y 404**

```ts
it('rejects an empty update body', async () => {
  const prisma = createPrismaMock();
  mockUserLookup(prisma);
  const app = await loadApp(prisma);

  await request(app)
    .patch('/api/v1/users/me')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({})
    .expect(400);
  expect(prisma.user.update).not.toHaveBeenCalled();
});

it('rejects an unavailable organizational unit', async () => {
  const prisma = createPrismaMock();
  mockUserLookup(prisma);
  prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-002', isActive: false });
  const app = await loadApp(prisma);

  const response = await request(app)
    .patch('/api/v1/users/me')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ unitId: 'unit-002' })
    .expect(400);

  expect(response.body.message).toBe('Organizational unit is not available.');
  expect(prisma.user.update).not.toHaveBeenCalled();
});

it('rejects a career that does not belong to the selected unit', async () => {
  const prisma = createPrismaMock();
  mockUserLookup(prisma);
  prisma.career.findUnique.mockResolvedValue({ id: 'car-002', unitId: 'unit-002' });
  const app = await loadApp(prisma);

  const response = await request(app)
    .patch('/api/v1/users/me')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ careerId: 'car-002' })
    .expect(400);

  expect(response.body.message).toBe('Career does not belong to the selected unit.');
  expect(prisma.user.update).not.toHaveBeenCalled();
});

it('returns 404 when the authenticated profile no longer exists', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockImplementation((args: UserLookupArgs) => {
    if (args.select && 'isActive' in args.select) {
      return Promise.resolve(authUserRecord);
    }
    return Promise.resolve(null);
  });
  const app = await loadApp(prisma);

  await request(app)
    .get('/api/v1/users/me')
    .set('Authorization', `Bearer ${accessToken}`)
    .expect(404);
});
```

Nota: `updateProfile` consulta primero `unitId`/`careerId` del usuario actual; `mockUserLookup` devuelve `profileRecord`, cuyo `career` no expone `unitId`, por lo que la coherencia se evalua con `currentUser.unitId = 'unit-001'`.

- [x] **Step 5: Verificar verde dirigido**

Run: `pnpm exec vitest run src/modules/users/users.routes.test.ts`

Expected: PASS. Las pruebas de caracterizacion pasan porque el `select` y Zod ya protegen; si alguna falla, corregir la brecha minima en `users.service.ts` o `users.schemas.ts` antes de continuar.

### Task 2: Pruebas de esquema (strip de campos internos y body vacio)

**Files:**

- Modify: `src/modules/users/users.schemas.test.ts`

- [x] **Step 1: Escribir las pruebas de esquema**

Agregar a `userProfileSchema`:

```ts
it('strips internal Better Auth fields', () => {
  const parsed = userProfileSchema.parse({
    ...baseProfile,
    name: 'Internal Name',
    accounts: [{ password: '$argon2id$hash' }],
    passwordHash: '$argon2id$hash',
  });

  expect(parsed).not.toHaveProperty('name');
  expect(parsed).not.toHaveProperty('accounts');
  expect(parsed).not.toHaveProperty('passwordHash');
});
```

Agregar a `updateProfileSchema`:

```ts
it('rejects an empty body', () => {
  expect(() => updateProfileSchema.parse({ body: {} })).toThrow(
    'At least one field must be provided.',
  );
});

it('rejects a body with only unknown fields', () => {
  expect(() => updateProfileSchema.parse({ body: { globalRole: 'ADMIN' } })).toThrow(
    'At least one field must be provided.',
  );
});

it('strips unknown fields from a valid body', () => {
  const parsed = updateProfileSchema.parse({
    body: { firstName: 'Ana', globalRole: 'ADMIN', isActive: false },
  });

  expect(parsed.body).toEqual({ firstName: 'Ana' });
});

it('trims names before validating', () => {
  const parsed = updateProfileSchema.parse({ body: { firstName: '  Ana  ' } });

  expect(parsed.body.firstName).toBe('Ana');
});
```

- [x] **Step 2: Verificar verde dirigido**

Run: `pnpm exec vitest run src/modules/users/users.schemas.test.ts`

Expected: PASS.

### Task 3: Documentar el 409 operativo en OpenAPI

**Files:**

- Modify: `src/modules/users/users.openapi.ts`
- Modify: `src/docs/openapi.test.ts`
- Modify: `openapi.json` (generado)

- [x] **Step 1: Escribir la prueba roja del contrato**

En `src/docs/openapi.test.ts`:

```ts
it('documents the Otros career conflict on profile update', () => {
  const pathItem = openApiDocument.paths?.['/api/v1/users/me'];

  expect(pathItem?.patch?.responses?.['409']).toBeDefined();
});
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/docs/openapi.test.ts`

Expected: FAIL porque `PATCH` solo documenta 200, 400, 401 y 404.

- [x] **Step 3: Documentar el 409**

En `users.openapi.ts`, agregar `409: errorResponse` a las respuestas de `patch` (el servicio responde 409 cuando `unitId: null` y la carrera global `Otros` no esta configurada).

- [x] **Step 4: Regenerar y verificar el contrato**

Run:

```bash
pnpm run docs:generate
pnpm run docs:check
```

Expected: `openapi.json` con el 409 de PATCH y check sin drift.

### Task 4: Bruno con assertions y caso de unidad desconocida

**Files:**

- Modify: `bruno/Users/Get the authenticated user profile.bru`
- Modify: `bruno/Users/Update the authenticated user profile.bru`
- Create: `bruno/Users/Update profile with an unknown unit returns 400.bru`
- Modify: `bruno/environments/local.bru`

- [x] **Step 1: Assertions del GET**

Agregar `tests` al GET: status 200, `success`, campos del contrato y ausencia de `name`, `accounts`, `password`, `passwordHash` y `$argon2` en el cuerpo serializado.

- [x] **Step 2: PATCH ejecutable y con assertions**

Cambiar el body a valores validos tomados del entorno:

```json
{
  "firstName": "{{profileFirstName}}",
  "lastName": "{{profileLastName}}"
}
```

Agregar `tests`: status 200, `data.firstName`/`data.lastName` iguales a las variables y ausencia de campos internos/credenciales. Agregar `profileFirstName: Admin`, `profileLastName: SIPEG` y `unknownUnitId: unit-does-not-exist` a `bruno/environments/local.bru`.

- [x] **Step 3: Request de unidad desconocida**

Crear `bruno/Users/Update profile with an unknown unit returns 400.bru` con body `{ "unitId": "{{unknownUnitId}}" }` y tests: status 400, `success = false`, mensaje `Organizational unit is not available.`.

- [x] **Step 4: Ejecutar la coleccion**

Run: `pnpm --dir bruno exec bru run Auth Users --env local`

Expected: assertions de Auth y Users en verde; el login conserva el script que captura `token`/`refreshToken`.

### Task 5: Verificacion real contra el stack local

**Files:**

- Create temporal: `.tmp-f16-integration.mts` (se elimina al terminar)

- [x] **Step 1: Ejecutar la verificacion con dos usuarios del seed**

Login con `admin@utp.ac.pa` y `organizador.fic@utp.ac.pa` (password demo), y comprobar:

```text
GET /users/me de cada token -> 200 con id/email propios y sin name/accounts/password/$argon2
PATCH admin con { firstName, globalRole: 'ADMIN', isActive: false, id: organizador } -> 200
  respuesta conserva globalRole USER (admin ya es ADMIN) y la BD no cambia el otro usuario
PATCH organizador con { globalRole: 'ADMIN' } solo -> 400 Validation error.
PATCH organizador con { unitId: 'unit-does-not-exist' } -> 400 Organizational unit is not available.
PATCH organizador con { careerId: 'career-does-not-exist' } -> 400 Career not found.
PATCH organizador con su mismo unitId/careerId -> 200 (valores validos idempotentes)
GET del admin despues del PATCH del organizador -> sin cambios
```

Restaurar los `firstName`/`lastName` originales del organizador al terminar y verificar en BD (`global_role`, `unit_id`, `career_id`) que no hubo mutaciones inesperadas. No imprimir tokens completos.

- [x] **Step 2: Eliminar el script temporal**

Run: `rm .tmp-f16-integration.mts`

Expected: el arbol queda sin artefactos temporales nuevos.

### Task 6: Calidad completa y cierre

**Files:**

- Modify: `docs/superpowers/plans/2026-09-19-fase-1-6-perfil-usuario.md`
- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [x] **Step 1: Ejecutar los comandos de calidad**

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

- [x] **Step 2: Registrar evidencia y cerrar 1.6**

Marcar este plan, marcar 1.6 en el maestro y agregar el registro con conteos de pruebas, comandos, evidencia real, decisiones de seguridad y hallazgos diferidos. Actualizar la tabla de estado del maestro (1.6 verificado; 1.5 sigue pendiente por decision del usuario). No hacer commit: el usuario no lo solicito.

---

## Threat model resumido

- **BOLA/aislamiento:** los endpoints no aceptan identificador de destino; toda consulta y escritura usa `req.user.id` derivado del `sub` del JWT y verificado contra la BD.
- **Mass assignment:** Zod recorta claves desconocidas antes del `refine`; un body con solo claves desconocidas produce 400 y `globalRole`/`isActive`/`email`/`id` nunca llegan a Prisma.
- **Fuga de datos:** `profileSelect` no incluye `name`, `accounts`, `passwordHash` ni `emailVerified`; se fija con assertions de ruta, esquema y Bruno.
- **Validacion de catalogo:** unidad activa obligatoria; carrera existente y coherente con la unidad; `Otros` global forzada cuando `unitId` es `null`.

## Self-review

- Cobertura: aislamiento, mass assignment, campos internos, body vacio, unidad inactiva, carrera incoherente y 404 estan asociados a pruebas concretas.
- Sin cambios de logica esperados: los tests de caracterizacion documentan el comportamiento actual; cualquier rojo revela una brecha real que se corrige con TDD.
- Contrato: unico cambio, documentar el 409 ya emitido por el servicio; `docs:generate` mantiene `openapi.json` sincronizado.
- Bruno: no se ejecuta el import destructivo y el script de captura de tokens del login queda intacto.
- Sin secretos: la verificacion real no imprime tokens y restaura los datos demo.

## Registro de ejecucion (2026-09-19)

- Baseline: 306 pruebas en 32 archivos tras eliminar el duplicado de 1.5; cierre en 321 pruebas.
- Ruta: 9 pruebas nuevas (12 en total en el archivo); esquema: 6 nuevas (11 en total); contrato: 409 documentado con rojo previo.
- Bruno: `Auth` 17/17 requests y 21/21 tests; `Users` 3/3 requests y 5/5 tests contra el stack local.
- Verificacion real: dos usuarios del seed, aislamiento, mass assignment, 400s de unidad/carrera y restauracion de nombres; sin tokens en logs.
- Calidad: `pnpm test`, `typecheck`, `lint`, `build`, `format:check` y `docs:check` en verde.
- Nota operativa: las runtime vars de Bruno no cruzan carpetas en una misma invocacion (`bru run Auth Users`); se uso `--env-var token=...` para `Users`.
