# Fase 4.5 - Completar filtros del listado de programas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que `ADMIN` filtre `GET /api/v1/event-programs` por `status` (incluido `ALL`), manteniendo el listado publico siempre limitado a `ACTIVE` y sin filtrar existencia de estados no publicos a otros actores.

**Architecture:** El modulo autocontenido `src/modules/event-programs/` agrega el query param `status` (enum de los cinco estados + pseudo-valor `ALL`) y `optionalAuthenticate` en la ruta publica para conocer al viewer. El servicio `listEventPrograms(query, viewer)` solo honra `status` cuando `viewer.globalRole === 'ADMIN'`; para cualquier otro actor (anonimo o `USER`) ignora el valor y aplica `ACTIVE` (200 silencioso). `ALL` omite la restriccion de estado (solo admin). No hay migraciones, variables de entorno, permisos ni endpoints nuevos.

**Tech Stack:** TypeScript 6, Express 5, Prisma 7 (SQL/Postgres), Zod 4, Vitest, Supertest, OpenAPI 3.1 (zod-openapi), Bruno.

**Estado de partida (2026-09-21):**

- `GET /api/v1/event-programs` es publico (sin `optionalAuthenticate`), valida `listEventProgramsQuerySchema` estricto (`page`, `limit`, `organizationalUnitId`, `unitType`, `q`) y `listEventPrograms` fija `where.status = 'ACTIVE'`.
- La ruta hermana `GET /event-programs/:id` ya usa `optionalAuthenticate` (`req.user` opcional, token invalido 401, cuenta desactivada 403) y el servicio `getEventProgramById(id, viewer)`.
- `optionalAuthenticate` vive en `src/middlewares/optionalAuthenticate.middleware.ts` y reutiliza `extractBearerToken`/`loadActiveUser`.
- El enum Prisma de estados de programa es `DRAFT | ACTIVE | COMPLETED | CANCELLED | ARCHIVED` (`ProgramStatus`).
- `PaginatedEventPrograms.items` usa `EventProgramDetail`, que ya expone `status`; no cambia el DTO de respuesta.
- La fase 4.4 (reactivar) ya sumo `reactivateEventProgram`, la ruta `POST /event-programs/:id/reactivate` y el permiso `program:reactivate`; 4.5 no los toca.

**Decisiones de diseno (2026-09-21, confirmadas con el usuario):**

1. **Forma del filtro:** un unico `status` con enum `['DRAFT','ACTIVE','COMPLETED','CANCELLED','ARCHIVED','ALL']`. Sin `status`, el listado es `ACTIVE` para todos (admin incluido): comportamiento actual preservado. `ALL` (solo admin) omite la restriccion de estado y permite ver todos los programas.
2. **Actores no admin:** si anonimo o `USER` envia `status` no publico (o `ALL`), la respuesta es `200` con el listado `ACTIVE`; el filtro se ignora en silencio, sin `403`. Decision de producto para no revelar la regla ni estados no publicos. Un valor fuera del enum si responde `400` (validacion Zod).
3. **Autorizacion:** solo `viewer.globalRole === 'ADMIN'` honra el filtro. No se agregan permisos al catalogo; un colaborador con `program:read` no filtra estados no publicos en el listado global (evita fuga horizontal).
4. **Auth opcional en el listado:** se agrega `optionalAuthenticate` antes de `validate`. Efecto de contrato nuevo: un Bearer invalido/vencido responde `401` y una cuenta desactivada `403`; sin header todo sigue publico. Se documentan ambos codigos.
5. **Sin cambios de DTO:** `EventProgramDetail.status` ya viaja en cada item; el admin distingue el estado sin campos nuevos.

**Reglas de negocio:**

- `status` ausente -> `where.status = 'ACTIVE'` para cualquier actor.
- `status='ACTIVE'` -> `where.status = 'ACTIVE'` para cualquier actor.
- Admin con `status` no publico -> `where.status = <estado>`.
- Admin con `status='ALL'` -> `where` sin clave `status` (paginacion y filtros restantes siguen aplicando).
- No admin (incluido anonimo) con `status` no publico o `ALL` -> `where.status = 'ACTIVE'` (200 silencioso).
- `status` fuera del enum -> `400` antes del servicio.
- Todos los filtros combinables entre si (`organizationalUnitId`, `unitType`, `q`, `status`).

---

### Task 1: Esquema `status` en el listado (TDD)

**Files:**

- Modify: `src/modules/event-programs/event-programs.schemas.ts:39-63`
- Test: `src/modules/event-programs/event-programs.schemas.test.ts:13-51`

- [ ] **Step 1: Escribir las pruebas que fallan**

En `event-programs.schemas.test.ts`, reemplazar el test `rejects unknown query parameters` (linea 40) porque hoy usa `status: 'DRAFT'` como clave desconocida, y agregar dos pruebas nuevas despues de `rejects an invalid unit type`:

```ts
it('rejects unknown query parameters', () => {
  expect(() => listEventProgramsQuerySchema.parse({ query: { isDefault: 'true' } })).toThrow();
});

it('accepts every program status and the ALL pseudo-status', () => {
  for (const status of ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED', 'ALL']) {
    expect(listEventProgramsQuerySchema.parse({ query: { status } }).query.status).toBe(status);
  }
});

it('rejects an invalid status', () => {
  expect(() => listEventProgramsQuerySchema.parse({ query: { status: 'PENDING' } })).toThrow();
});
```

- [ ] **Step 2: Correr las pruebas y verificar el rojo**

```bash
pnpm exec vitest run src/modules/event-programs/event-programs.schemas.test.ts -t "status"
```

Resultado esperado: `accepts every program status...` falla porque `status` es una clave desconocida (el objeto estricto la rechaza) y `rejects an invalid status` falla porque `PENDING` tambien es desconocida, no por el enum.

- [ ] **Step 3: Implementar el esquema**

En `src/modules/event-programs/event-programs.schemas.ts`, dentro de `listEventProgramsQuerySchema`, despues de `unitType` (linea 54) y antes de `q`, agregar:

```ts
      status: z
        .enum(
          ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED', 'ALL'],
          'Status is invalid.',
        )
        .optional(),
```

- [ ] **Step 4: Correr las pruebas y verificar el verde**

```bash
pnpm exec vitest run src/modules/event-programs/event-programs.schemas.test.ts
```

Resultado esperado: todas en verde.

---

### Task 2: Servicio `listEventPrograms` con viewer (TDD)

**Files:**

- Modify: `src/modules/event-programs/event-programs.service.ts:101-138`
- Test: `src/modules/event-programs/event-programs.service.test.ts:74-140`

- [ ] **Step 1: Escribir las pruebas que fallan**

En `event-programs.service.test.ts`, agregar despues de `listedRecord` (linea 72) los viewers de prueba:

```ts
const adminViewer: Express.AuthenticatedUser = {
  id: 'admin-001',
  email: 'admin@example.com',
  globalRole: 'ADMIN',
  unitId: null,
  careerId: null,
  isActive: true,
};

const regularViewer: Express.AuthenticatedUser = {
  ...adminViewer,
  id: 'user-001',
  email: 'user@example.com',
  globalRole: 'USER',
};
```

Y dentro del `describe('listEventPrograms', ...)` (despues del test `applies organizational unit, unit type and search filters`, que cierra en la linea 139), agregar:

```ts
it('honors the status filter for an admin', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findMany.mockResolvedValue([]);
  prisma.eventProgram.count.mockResolvedValue(0);
  const { listEventPrograms } = await loadService(prisma);

  await listEventPrograms({ page: 1, limit: 20, status: 'DRAFT' }, adminViewer);

  expect(prisma.eventProgram.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { status: 'DRAFT' } }),
  );
  expect(prisma.eventProgram.count).toHaveBeenCalledWith({ where: { status: 'DRAFT' } });
});

it('omits the status constraint for an admin requesting ALL', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findMany.mockResolvedValue([]);
  prisma.eventProgram.count.mockResolvedValue(0);
  const { listEventPrograms } = await loadService(prisma);

  await listEventPrograms({ page: 1, limit: 20, status: 'ALL' }, adminViewer);

  expect(prisma.eventProgram.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  expect(prisma.eventProgram.count).toHaveBeenCalledWith({ where: {} });
});

it('keeps the ACTIVE default when an admin omits the status filter', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findMany.mockResolvedValue([]);
  prisma.eventProgram.count.mockResolvedValue(0);
  const { listEventPrograms } = await loadService(prisma);

  await listEventPrograms({ page: 1, limit: 20 }, adminViewer);

  expect(prisma.eventProgram.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { status: 'ACTIVE' } }),
  );
});

it('ignores a non-active status filter from an anonymous caller', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findMany.mockResolvedValue([]);
  prisma.eventProgram.count.mockResolvedValue(0);
  const { listEventPrograms } = await loadService(prisma);

  await listEventPrograms({ page: 1, limit: 20, status: 'ARCHIVED' });

  expect(prisma.eventProgram.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { status: 'ACTIVE' } }),
  );
});

it('ignores a non-active status filter from a non-admin viewer', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findMany.mockResolvedValue([]);
  prisma.eventProgram.count.mockResolvedValue(0);
  const { listEventPrograms } = await loadService(prisma);

  await listEventPrograms({ page: 1, limit: 20, status: 'ALL' }, regularViewer);

  expect(prisma.eventProgram.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { status: 'ACTIVE' } }),
  );
});

it('combines the admin status filter with other filters', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findMany.mockResolvedValue([]);
  prisma.eventProgram.count.mockResolvedValue(0);
  const { listEventPrograms } = await loadService(prisma);

  await listEventPrograms(
    { page: 1, limit: 20, status: 'COMPLETED', organizationalUnitId: 'unit-001', q: 'foro' },
    adminViewer,
  );

  expect(prisma.eventProgram.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        status: 'COMPLETED',
        organizationalUnitId: 'unit-001',
        OR: [
          { name: { contains: 'foro', mode: 'insensitive' } },
          { label: { contains: 'foro', mode: 'insensitive' } },
        ],
      },
    }),
  );
});
```

- [ ] **Step 2: Correr las pruebas y verificar el rojo**

```bash
pnpm exec vitest run src/modules/event-programs/event-programs.service.test.ts -t listEventPrograms
```

Resultado esperado: los tests de admin fallan porque el servicio ignora el segundo argumento y siempre filtra `ACTIVE`; los de no-admin puede que pasen de forma accidental (el `where` ya es ACTIVE), pero deben quedar como regresion explicita.

- [ ] **Step 3: Implementar el servicio**

En `src/modules/event-programs/event-programs.service.ts`, reemplazar la firma y el armado del `where` (lineas 101-117):

```ts
export const listEventPrograms = async (
  query: ListEventProgramsQuery,
  viewer: Express.AuthenticatedUser | null = null,
): Promise<PaginatedEventPrograms> => {
  const prisma = getPrismaClient();
  const requestedStatus = viewer?.globalRole === 'ADMIN' ? query.status : undefined;
  const status = requestedStatus ?? 'ACTIVE';
  const where = {
    ...(status === 'ALL' ? {} : { status }),
    ...(query.organizationalUnitId ? { organizationalUnitId: query.organizationalUnitId } : {}),
    ...(query.unitType ? { organizationalUnit: { type: query.unitType } } : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' as const } },
            { label: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
```

- [ ] **Step 4: Correr las pruebas y verificar el verde**

```bash
pnpm exec vitest run src/modules/event-programs/event-programs.service.test.ts
```

Resultado esperado: todas en verde.

---

### Task 3: Controlador y ruta con `optionalAuthenticate` (TDD)

**Files:**

- Modify: `src/modules/event-programs/event-programs.controller.ts:20-25`
- Modify: `src/modules/event-programs/event-programs.routes.ts:25-29`
- Test: `src/modules/event-programs/event-programs.routes.test.ts:111-253`

- [ ] **Step 1: Escribir/actualizar las pruebas**

En `event-programs.routes.test.ts`:

1. Actualizar los dos asserts existentes que esperan una sola llamada (lineas 157 y 177-183) para incluir el viewer anonimo `null`:

```ts
expect(service.listEventPrograms).toHaveBeenCalledWith({ page: 1, limit: 20 }, null);
```

```ts
expect(service.listEventPrograms).toHaveBeenCalledWith(
  {
    page: 2,
    limit: 10,
    organizationalUnitId: 'unit-001',
    unitType: 'FACULTY',
    q: 'congreso',
  },
  null,
);
```

2. Agregar despues del test `rejects an invalid unit type before the service` (linea 193):

```ts
it('forwards the status filter and the admin viewer', async () => {
  const service = buildServiceMock();
  service.listEventPrograms.mockResolvedValue({
    items: [],
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminRecord);
  const app = await loadApp(service, prisma);

  await request(app)
    .get('/api/v1/event-programs?status=ALL')
    .set('Authorization', 'Bearer admin-001')
    .expect(200);

  expect(service.listEventPrograms).toHaveBeenCalledWith(
    { page: 1, limit: 20, status: 'ALL' },
    adminRecord,
  );
});

it('rejects an invalid status before the service', async () => {
  const service = buildServiceMock();
  const app = await loadApp(service);

  await request(app).get('/api/v1/event-programs?status=PENDING').expect(400);
  expect(service.listEventPrograms).not.toHaveBeenCalled();
});

it('rejects an invalid bearer token with 401 before the service', async () => {
  const service = buildServiceMock();
  const verify = vi.fn();
  const app = await loadApp(service, createPrismaMock(), ['program:create'], vi.fn(), verify);
  const { ApiError } = await import('../../utils/ApiError.js');
  verify.mockRejectedValue(new ApiError(401, 'Invalid or expired token.'));

  await request(app)
    .get('/api/v1/event-programs')
    .set('Authorization', 'Bearer broken')
    .expect(401);

  expect(service.listEventPrograms).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Correr las pruebas y verificar el rojo**

```bash
pnpm exec vitest run src/modules/event-programs/event-programs.routes.test.ts
```

Resultado esperado: los dos asserts actualizados fallan (el servicio recibe `null` pero hoy solo un argumento) y `forwards the status filter and the admin viewer` falla porque `req.user` no se propaga; `rejects an invalid bearer token...` falla con 200 en lugar de 401.

- [ ] **Step 3: Implementar controlador y ruta**

En `src/modules/event-programs/event-programs.controller.ts`:

```ts
export const getEventPrograms: RequestHandler = asyncHandler(async (req, res) => {
  const query = req.query as unknown as ListEventProgramsQuery;
  const result = await listEventProgramsService(query, req.user ?? null);

  res.status(200).json(successResponse('Event programs retrieved successfully.', result));
});
```

En `src/modules/event-programs/event-programs.routes.ts`:

```ts
eventProgramsRoutes.get(
  '/event-programs',
  optionalAuthenticate,
  validate(listEventProgramsQuerySchema),
  getEventPrograms,
);
```

- [ ] **Step 4: Correr las pruebas y verificar el verde**

```bash
pnpm exec vitest run src/modules/event-programs/event-programs.routes.test.ts
```

Resultado esperado: todas en verde.

---

### Task 4: Contrato OpenAPI (TDD)

**Files:**

- Modify: `src/modules/event-programs/event-programs.openapi.ts:20-36`
- Modify: `src/docs/openapi.test.ts:327-335`
- Modify: `openapi.json` (generado)

- [ ] **Step 1: Escribir la prueba de contrato que falla**

En `src/docs/openapi.test.ts`, actualizar el test `documents the event program list query parameters` para incluir `status`:

```ts
expect(names).toEqual(
  expect.arrayContaining(['page', 'limit', 'organizationalUnitId', 'unitType', 'q', 'status']),
);
```

Y agregar despues:

```ts
it('documents the admin-only status filter on the event program list', () => {
  const operation = openApiDocument.paths?.['/api/v1/event-programs']?.get;
  const parameters = operation?.parameters ?? [];
  const statusParameter = parameters.find(
    (parameter) => 'name' in parameter && parameter.name === 'status',
  );

  expect(statusParameter).toBeDefined();
  expect(operation?.security).toBeUndefined();
  expect(operation?.responses?.['400']).toBeDefined();
  expect(operation?.responses?.['401']).toBeDefined();
  expect(operation?.responses?.['403']).toBeDefined();
});
```

- [ ] **Step 2: Correr y verificar el rojo**

```bash
pnpm exec vitest run src/docs/openapi.test.ts
```

Resultado esperado: ambos tests fallan porque la operacion todavia no declara `status` ni las respuestas 401/403.

- [ ] **Step 3: Documentar la operacion**

En `src/modules/event-programs/event-programs.openapi.ts`, actualizar la operacion `get` del path `'/api/v1/event-programs'`:

```ts
    get: {
      tags: ['Event Programs'],
      summary: 'List event programs',
      description:
        'Public. Returns ACTIVE event programs ordered by name. The status filter (DRAFT, ACTIVE, COMPLETED, CANCELLED, ARCHIVED or ALL) is honored only for ADMIN users; anonymous callers and non-admin users always receive ACTIVE programs even when they send another status. Supports filters by organizational unit, unit type and a name/label search term. An invalid status responds 400; a present but invalid bearer token responds 401 and an inactive account responds 403.',
      requestParams: { query: listEventProgramsQuerySchema.shape.query },
      responses: {
        200: {
          description: 'Paginated list of event programs.',
          content: {
            'application/json': { schema: apiSuccessResponse(paginatedEventProgramsSchema) },
          },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
      },
    },
```

- [ ] **Step 4: Regenerar el contrato y verificar**

```bash
pnpm run docs:generate
pnpm run docs:check
pnpm exec vitest run src/docs/openapi.test.ts
```

Resultado esperado: `openapi.json` actualizado (param `status` y respuestas 401/403 en el GET publico), `docs:check` sin drift y el test de contrato en verde.

---

### Task 5: Documentacion

**Files:**

- Modify: `CONTEXT.md:155`
- Modify: `README.md:269`

- [ ] **Step 1: Actualizar `CONTEXT.md`**

Reemplazar la linea 155 por:

```md
- `GET /api/v1/event-programs` es publico y devuelve programas `ACTIVE` con paginacion y filtros opcionales por unidad organizativa, tipo de unidad y busqueda en nombre o etiqueta. Acepta `status` (cualquier estado del programa o `ALL`), pero solo los `ADMIN` lo aplican: anonimos y `USER` reciben siempre el listado `ACTIVE` aunque envien otro estado, sin error. Un `status` fuera del enum responde `400`; un Bearer invalido `401` y una cuenta desactivada `403` (auth opcional fail-closed).
```

- [ ] **Step 2: Actualizar `README.md`**

Reemplazar la linea 269 por:

```md
- `GET /api/v1/event-programs` es publico y devuelve programas con estado `ACTIVE`, ordenados por nombre. Acepta el filtro `status` (cualquier estado o `ALL`), pero solo los `ADMIN` lo aplican: anonimos y `USER` siempre reciben el listado `ACTIVE` aunque envien otro estado, sin error. Un `status` invalido responde `400`, un Bearer invalido `401` y una cuenta desactivada `403`.
```

- [ ] **Step 3: Verificar formato**

```bash
pnpm exec prettier --check CONTEXT.md README.md
```

---

### Task 6: Coleccion Bruno

**Files:**

- Create: `bruno/Event_Programs/List event programs by status as admin.bru`
- Create: `bruno/Event_Programs/List a non-active status without a token stays active-only.bru`
- Create: `bruno/Event_Programs/List event programs with an invalid status returns 400.bru`
- Create: `bruno/Event_Programs/List event programs with an invalid token returns 401.bru`
- Modify: `bruno/Event_Programs/List active event programs.bru` (parametro opcional `status` y docs)

No se agregan variables de entorno: el `token` del admin ya lo captura `Log in as admin for event programs.bru` (seq 4) y los estados van inline.

- [ ] **Step 1: Crear `List event programs by status as admin.bru`**

```bru
meta {
  name: List event programs by status as admin
  type: http
  seq: 29
  tags: [
    Event_Programs
  ]
}

get {
  url: {{baseUrl}}/api/v1/event-programs?page=1&limit=50&status=DRAFT
  body: none
  auth: bearer
}

auth:bearer {
  token: {{token}}
}

params:query {
  page: 1
  limit: 50
  status: DRAFT
}

tests {
  test("admin status filter returns only DRAFT programs", function () {
    expect(res.getStatus()).to.equal(200);
    const body = res.getBody();
    expect(body.success).to.equal(true);
    expect(body.data.total).to.be.above(0);
    body.data.items.forEach(function (program) {
      expect(program.status).to.equal("DRAFT");
    });
  });
}
```

- [ ] **Step 2: Crear `List a non-active status without a token stays active-only.bru`**

```bru
meta {
  name: List a non-active status without a token stays active-only
  type: http
  seq: 30
  tags: [
    Event_Programs
  ]
}

get {
  url: {{baseUrl}}/api/v1/event-programs?limit=50&status=ARCHIVED
  body: none
  auth: none
}

params:query {
  limit: 50
  status: ARCHIVED
}

tests {
  test("anonymous callers always receive ACTIVE programs", function () {
    expect(res.getStatus()).to.equal(200);
    const body = res.getBody();
    expect(body.data.total).to.be.above(0);
    body.data.items.forEach(function (program) {
      expect(program.status).to.equal("ACTIVE");
    });
  });
}
```

- [ ] **Step 3: Crear `List event programs with an invalid status returns 400.bru`**

```bru
meta {
  name: List event programs with an invalid status returns 400
  type: http
  seq: 31
  tags: [
    Event_Programs
  ]
}

get {
  url: {{baseUrl}}/api/v1/event-programs?status=PENDING
  body: none
  auth: none
}

params:query {
  status: PENDING
}

tests {
  test("an unknown status is rejected by validation", function () {
    expect(res.getStatus()).to.equal(400);
    expect(res.getBody().success).to.equal(false);
  });
}
```

- [ ] **Step 4: Crear `List event programs with an invalid token returns 401.bru`**

```bru
meta {
  name: List event programs with an invalid token returns 401
  type: http
  seq: 32
  tags: [
    Event_Programs
  ]
}

get {
  url: {{baseUrl}}/api/v1/event-programs
  body: none
  auth: bearer
}

auth:bearer {
  token: not-a-real-token
}

tests {
  test("a present but invalid token is rejected", function () {
    expect(res.getStatus()).to.equal(401);
  });
}
```

- [ ] **Step 5: Actualizar `List active event programs.bru`**

Agregar el query param opcional y ajustar `docs`:

```bru
params:query {
  page: 1
  limit: 20
  organizationalUnitId: seed_unit_fisc
  ~unitType: SUBDIRECTORATE
  ~status: ALL
  ~q:
}

docs {
  Public. Returns ACTIVE event programs ordered by name. The status filter is honored only for ADMIN users; other callers always receive ACTIVE programs.
}
```

- [ ] **Step 6: Correr la carpeta**

```bash
pnpm --dir bruno exec bru run Event_Programs --env local
```

Resultado esperado: 24/24 requests y 21/21 tests en verde (los 4 requests nuevos se suman a los 20/17 de 4.3 mas los 8 de 4.4 si estan presentes; el total real se registra en la evidencia). Nota: los logins usan buckets de 5/min; si una corrida previa agoto el limite, esperar 60 s.

---

### Task 7: E2E real con Docker + psql (solo lectura)

**Files:**

- Create temporal: `/tmp/opencode/f45-e2e.mjs` (se elimina al final)

No hay escrituras: todos los checks son GET y consultas `SELECT`; no se requiere limpieza.

- [ ] **Step 1: Confirmar el stack y el baseline**

```bash
docker ps --format '{{.Names}}'
docker exec sipeg-utp-dev-db-1 psql -U sipeg -d sipeg_utp -t -A -c "SELECT status || '=' || COUNT(*) FROM event_programs GROUP BY status ORDER BY status;"
```

Baseline esperado (seed demo): `ACTIVE` con la mayoria, `ARCHIVED=1` (`seed_program_foro-ipe`) y `DRAFT=1` (`feria-tec`). Confirmar que la API responde `/api/v1/health`.

- [ ] **Step 2: Escribir y correr el script E2E**

Contenido de `/tmp/opencode/f45-e2e.mjs`:

```js
import { execSync } from 'node:child_process';

const BASE = 'http://localhost:3000/api/v1';
const DB = 'sipeg-utp-dev-db-1';
const results = [];

const psql = (sql) =>
  execSync(`docker exec ${DB} psql -U sipeg -d sipeg_utp -t -A -c ${JSON.stringify(sql)}`, {
    encoding: 'utf8',
  }).trim();

const check = (name, condition, detail = '') => {
  results.push({ name, pass: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} - ${name}${detail ? ` :: ${detail}` : ''}`);
};

const api = async (method, path, { token, body } = {}) => {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  return { status: response.status, body: await response.json().catch(() => null) };
};

const login = async (email, password) => {
  const response = await api('POST', '/auth/login', { body: { email, password } });
  if (response.status !== 200) throw new Error(`login ${email} -> ${response.status}`);
  return response.body.data.accessToken;
};

const allActive = (items) => items.every((item) => item.status === 'ACTIVE');

const expectedActive = Number(psql(`SELECT COUNT(*) FROM event_programs WHERE status = 'ACTIVE';`));
const expectedDraft = Number(psql(`SELECT COUNT(*) FROM event_programs WHERE status = 'DRAFT';`));
const expectedArchived = Number(
  psql(`SELECT COUNT(*) FROM event_programs WHERE status = 'ARCHIVED';`),
);
const expectedAll = Number(psql('SELECT COUNT(*) FROM event_programs;'));
const expectedFicDraft = Number(
  psql(
    `SELECT COUNT(*) FROM event_programs WHERE status = 'DRAFT' AND organizational_unit_id = 'seed_unit_fic';`,
  ),
);

const admin = await login('admin@utp.ac.pa', 'Sipeg2026*UTP');
const student = await login('estudiante01@utp.ac.pa', 'Sipeg2026*UTP');

const anon = await api('GET', '/event-programs?limit=50');
check(
  'anonymous default lists only ACTIVE',
  anon.status === 200 &&
    anon.body?.data?.total === expectedActive &&
    allActive(anon.body.data.items),
  `status=${anon.status} total=${anon.body?.data?.total} expected=${expectedActive}`,
);

const anonDraft = await api('GET', '/event-programs?status=DRAFT&limit=50');
check(
  'anonymous status=DRAFT silently stays ACTIVE',
  anonDraft.status === 200 &&
    anonDraft.body?.data?.total === expectedActive &&
    allActive(anonDraft.body.data.items),
  `status=${anonDraft.status} total=${anonDraft.body?.data?.total}`,
);

const anonAll = await api('GET', '/event-programs?status=ALL&limit=50');
check(
  'anonymous status=ALL silently stays ACTIVE',
  anonAll.status === 200 && anonAll.body?.data?.total === expectedActive,
  `status=${anonAll.status} total=${anonAll.body?.data?.total}`,
);

const userArchived = await api('GET', '/event-programs?status=ARCHIVED&limit=50', {
  token: student,
});
check(
  'non-admin token with status=ARCHIVED stays ACTIVE',
  userArchived.status === 200 &&
    userArchived.body?.data?.total === expectedActive &&
    allActive(userArchived.body.data.items),
  `status=${userArchived.status} total=${userArchived.body?.data?.total}`,
);

const adminActive = await api('GET', '/event-programs?limit=50', { token: admin });
check(
  'admin default stays ACTIVE',
  adminActive.status === 200 && adminActive.body?.data?.total === expectedActive,
  `status=${adminActive.status} total=${adminActive.body?.data?.total}`,
);

const adminDraft = await api('GET', '/event-programs?status=DRAFT&limit=50', { token: admin });
check(
  'admin status=DRAFT matches psql and includes feria-tec',
  adminDraft.status === 200 &&
    adminDraft.body?.data?.total === expectedDraft &&
    adminDraft.body.data.items.every((item) => item.status === 'DRAFT') &&
    adminDraft.body.data.items.some((item) => item.id === 'seed_program_feria-tec'),
  `status=${adminDraft.status} total=${adminDraft.body?.data?.total} expected=${expectedDraft}`,
);

const adminArchived = await api('GET', '/event-programs?status=ARCHIVED&limit=50', {
  token: admin,
});
check(
  'admin status=ARCHIVED matches psql and includes foro-ipe',
  adminArchived.status === 200 &&
    adminArchived.body?.data?.total === expectedArchived &&
    adminArchived.body.data.items.some((item) => item.id === 'seed_program_foro-ipe'),
  `status=${adminArchived.status} total=${adminArchived.body?.data?.total} expected=${expectedArchived}`,
);

const adminAll = await api('GET', '/event-programs?status=ALL&limit=50', { token: admin });
check(
  'admin status=ALL matches psql total and includes non-active states',
  adminAll.status === 200 &&
    adminAll.body?.data?.total === expectedAll &&
    adminAll.body.data.items.some((item) => item.status !== 'ACTIVE'),
  `status=${adminAll.status} total=${adminAll.body?.data?.total} expected=${expectedAll}`,
);

const combined = await api(
  'GET',
  '/event-programs?status=DRAFT&organizationalUnitId=seed_unit_fic&limit=50',
  { token: admin },
);
check(
  'admin combines status and organizational unit',
  combined.status === 200 &&
    combined.body?.data?.total === expectedFicDraft &&
    combined.body.data.items.every(
      (item) => item.status === 'DRAFT' && item.organizationalUnit.id === 'seed_unit_fic',
    ),
  `status=${combined.status} total=${combined.body?.data?.total} expected=${expectedFicDraft}`,
);

const invalidStatus = await api('GET', '/event-programs?status=PENDING');
check('invalid status returns 400', invalidStatus.status === 400, `status=${invalidStatus.status}`);

const invalidStatusAdmin = await api('GET', '/event-programs?status=PENDING', { token: admin });
check(
  'invalid status returns 400 for admins too',
  invalidStatusAdmin.status === 400,
  `status=${invalidStatusAdmin.status}`,
);

const invalidUnitType = await api('GET', '/event-programs?unitType=CAMPUS');
check(
  'invalid unit type still returns 400',
  invalidUnitType.status === 400,
  `status=${invalidUnitType.status}`,
);

const invalidToken = await api('GET', '/event-programs?status=ALL', { token: 'not-a-real-token' });
check('invalid token returns 401', invalidToken.status === 401, `status=${invalidToken.status}`);

const pagination = await api('GET', '/event-programs?page=1&limit=5&status=ALL', { token: admin });
check(
  'ALL keeps pagination metadata',
  pagination.status === 200 &&
    pagination.body?.data?.items?.length === Math.min(5, expectedAll) &&
    pagination.body?.data?.total === expectedAll &&
    pagination.body?.data?.page === 1 &&
    pagination.body?.data?.limit === 5,
  `items=${pagination.body?.data?.items?.length} total=${pagination.body?.data?.total}`,
);

const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
```

Ejecutar:

```bash
node /tmp/opencode/f45-e2e.mjs
```

Resultado esperado: todos los checks en `PASS` y exit code 0. Contrastar manualmente que `expectedActive + expectedDraft + expectedArchived == expectedAll`.

- [ ] **Step 3: Eliminar el script temporal**

```bash
rm /tmp/opencode/f45-e2e.mjs
```

---

### Task 8: Gates finales y actualizacion del plan maestro

**Files:**

- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [ ] **Step 1: Correr los gates**

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run format:check
pnpm run docs:check
```

Resultado esperado: todo en verde. Si `format:check` o `typecheck` fallan solo por archivos de sesiones concurrentes ajenas al modulo, registrar la excepcion con el archivo exacto.

- [ ] **Step 2: Actualizar el plan maestro**

1. Tabla "Estado actual": cambiar la fila de Programas a `Parcial: 4.1-4.5 implementados; faltan 4.6-4.7`.
2. Marcar `- [x] **4.5 Completar filtros ...**`.
3. Agregar el bloque de registro despues del ultimo registro de la fase 4 (4.4 si ya esta, si no despues de 4.3) y antes de `**Criterio de salida:**`:

```md
**Registro de ejecucion (2026-09-21 - 4.5):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-21-fase-4-5-completar-filtros.md` con ciclo TDD rojo/verde en esquemas (3), servicio (6), rutas (3) y contrato OpenAPI (2).
- [x] Implementacion: `status` en `listEventProgramsQuerySchema` (cinco estados + `ALL`), `listEventPrograms(query, viewer)` que solo honra el filtro para `ADMIN` (no-admin y anonimo reciben `ACTIVE`, 200 silencioso; `ALL` omite la restriccion), `optionalAuthenticate` en `GET /event-programs` y `req.user ?? null` en el controlador.
- [x] Decisiones confirmadas: default `ACTIVE` para todos, silencio para no-admin (sin 403), solo `ADMIN` ve estados no publicos, sin permisos, migraciones ni variables de entorno nuevas.
- [x] Pruebas: (completar con el total real de `pnpm test` y archivos) + gates `typecheck`, `lint`, `build`, `format:check`, `docs:generate` y `docs:check`.
- [x] Verificacion real (stack Docker dev, seed demo, solo lectura): (completar con el resultado del E2E).
- [x] Bruno: (completar con requests/tests y resultado de `bru run Event_Programs --env local`).
- [x] Contrato: `openapi.json` regenerado sin drift; param `status`, respuestas 400/401/403 y `security` ausente en el GET publico.
- [x] Documentacion: README y CONTEXT describen el filtro, el silencio para no-admin y los 400/401/403.
- [x] Sin commit: el usuario no lo solicito.
```

Completar los `(completar ...)` con la evidencia real antes de cerrar la fase.

---

## Self-review del plan

- **Cobertura del item 4.5:** "ADMIN filtra estados no publicos" (Task 2 tests 1/2/3 y Task 7 checks DRAFT/ARCHIVED/ALL), "listado publico limitado a ACTIVE" (Task 2 tests 4/5 y Task 7 checks anonimos), contrato (Task 4), Bruno (Task 6), E2E (Task 7).
- **Sin placeholders:** todo el codigo de produccion y de pruebas esta completo; los `(completar ...)` del registro dependen de la ejecucion.
- **Consistencia de tipos:** `listEventPrograms(query, viewer = null)` coincide con el controlador (`req.user ?? null`) y con los mocks de rutas (`(query, null)`); el enum del esquema incluye `ALL` que el servicio usa como pseudo-valor.
- **Riesgos conocidos:** el silencio para no-admin puede confundir a un cliente con bug, queda documentado en OpenAPI/README/CONTEXT; `format:check` puede reportar archivos de la sesion concurrente 4.4; agregar `optionalAuthenticate` cambia el contrato del listado (401/403 nuevos), documentado y cubierto con pruebas.
