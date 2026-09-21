# Fase 4.3 - Archivar programa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar `POST /api/v1/event-programs/:id/archive` con guardas de negocio (programa predeterminado con unidad activa y programa adicional con actividades `SCHEDULED`/`ONGOING`), `archivedAt` persistido, comportamiento idempotente, permiso `program:archive` en el scope, contrato OpenAPI, Bruno y verificacion E2E.

**Architecture:** Se mantiene el modulo autocontenido `src/modules/event-programs/`. El servicio `archiveEventProgram` carga el programa con su unidad, corta la idempotencia si ya esta `ARCHIVED` (sin escribir), pre-valida las mismas reglas que el trigger `validate_event_program_transition` y persiste `status: 'ARCHIVED'` + `archivedAt`. La ruta reutiliza `authenticate -> requirePermission(program:archive, scope) -> validate(params) -> controlador`. No hay migraciones, dependencias, variables de entorno ni permisos nuevos: `PROGRAM_ARCHIVE` ya existe en el catalogo canonico y no esta en ningun `ROLE_DEFAULT`, por lo que por defecto solo `ADMIN` (bypass) o un `OVERRIDE` explicito pueden archivar.

**Tech Stack:** TypeScript 6, Express 5, Prisma 7 (SQL/Postgres), Zod 4, Vitest, Supertest, OpenAPI 3.1 (zod-openapi), Bruno.

**Estado de partida (2026-09-21):**

- `POST /api/v1/event-programs` crea programas adicionales `DRAFT`; `PATCH` publica `DRAFT -> ACTIVE` y rechaza programas `ARCHIVED` con `409`.
- No existe endpoint de archivado; el unico camino que archiva hoy es `POST /organizational-units/:id/deactivate`, que dentro de una transaccion actualiza la unidad y el programa predeterminado (`status + archivedAt`).
- Trigger `validate_event_program_transition` (migracion `20260919093000_unify_organizational_units`): en la transicion a `ARCHIVED` rechaza predeterminados cuya unidad siga activa y adicionales con actividades `SCHEDULED`/`ONGOING`; solo dispara cuando el estado cambia a `ARCHIVED` desde otro estado, por lo que un segundo archivado es un no-op a nivel BD.
- Trigger `reactivate_default_event_program`: al reactivar una unidad restaura su programa predeterminado (`ACTIVE`, `archived_at = NULL`).
- `createActivity` exige programa `ACTIVE` (`400 Activities can only be created in an active event program.`) y `updateActivity` exige programa `ACTIVE` (`409`).
- Seed demo: `seed_program_fic_default` (predeterminado, FIC activa), `seed_program_congreso-cit` (`ACTIVE` con 3 actividades `SCHEDULED`), `seed_program_foro-ipe` (`ARCHIVED` con `archivedAt` sellado), `feria-tec` (`DRAFT` sin actividades).
- `PERMISSIONS.PROGRAM_ARCHIVE = 'program:archive'` existe en `src/modules/authorization/permissions.ts` y no aparece en `ROLE_DEFAULTS`.

**Decisiones de diseno (2026-09-21):**

1. **Idempotencia:** si el programa ya esta `ARCHIVED`, responde `200` con el DTO actual sin ejecutar `update` ni la guarda de actividades; `archivedAt` no se modifica. Un reintento del cliente nunca falla ni mueve la marca de tiempo.
2. **Permiso:** `program:archive` en el scope `{ eventProgramId }`. Al no estar en ningun `ROLE_DEFAULT`, solo `ADMIN` o un `OVERRIDE` explicito (via 3.5) pueden archivar. No se toca el catalogo ni el seed.
3. **DTO:** se reutiliza `EventProgramDetail` (ya incluye `status: 'ARCHIVED'`). No se expone `archivedAt` para no ampliar el contrato de un componente compartido; su persistencia e inmutabilidad se verifican por pruebas unitarias (mocks) y por psql en el E2E.
4. **Orden de guardas:** `404` si no existe -> idempotencia `ARCHIVED` -> `409` predeterminado con unidad activa -> `409` actividades `SCHEDULED`/`ONGOING` (solo adicionales) -> `update`.
5. **Sin transaccion:** el archivado es una sola escritura; el pre-chequeo de actividades es espejo del trigger y la carrera residual queda documentada como hallazgo (mismo criterio que `F4.2-B`).
6. **Mensajes:** `A default event program cannot be archived while its organizational unit is active.` y `An event program with scheduled or ongoing activities cannot be archived.`, alineados con los del trigger de BD pero en estilo API. `404 Event program not found.`

**Reglas de negocio:**

- Programa inexistente -> `404 Event program not found.`
- Programa ya `ARCHIVED` -> `200` idempotente, sin escritura.
- Programa predeterminado con `organizationalUnit.isActive = true` -> `409 A default event program cannot be archived while its organizational unit is active.`
- Programa adicional con una o mas actividades `SCHEDULED`/`ONGOING` -> `409 An event program with scheduled or ongoing activities cannot be archived.` (`DRAFT`, `COMPLETED` y `CANCELLED` no bloquean).
- Programa adicional sin actividades o predeterminado con unidad inactiva -> `update { status: 'ARCHIVED', archivedAt: new Date() }`.
- No hay body ni query; solo se valida el path param `id` (1-100 caracteres, trim).

---

### Task 1: Servicio `archiveEventProgram` (TDD)

**Files:**

- Modify: `src/modules/event-programs/event-programs.service.ts`
- Test: `src/modules/event-programs/event-programs.service.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

Agregar al final de `event-programs.service.test.ts` (despues del `describe` de `getEventProgramById`, que hoy cierra en la linea 519):

```ts
describe('archiveEventProgram', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../authorization/authorization.service.js');
  });

  const archivableRecord = {
    ...createdRecord,
    status: 'ACTIVE' as const,
    organizationalUnit: { ...createdRecord.organizationalUnit, isActive: true },
  };

  const archivedRecord = {
    ...archivableRecord,
    status: 'ARCHIVED' as const,
  };

  it('archives an additional program and stamps archivedAt', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(archivableRecord);
    prisma.activity.count.mockResolvedValue(0);
    prisma.eventProgram.update.mockResolvedValue({ ...createdRecord, status: 'ARCHIVED' });
    const { archiveEventProgram } = await loadService(prisma);

    const result = await archiveEventProgram('program-001');

    expect(prisma.activity.count).toHaveBeenCalledWith({
      where: { eventProgramId: 'program-001', status: { in: ['SCHEDULED', 'ONGOING'] } },
    });
    expect(prisma.eventProgram.update).toHaveBeenCalledWith({
      where: { id: 'program-001' },
      data: { status: 'ARCHIVED', archivedAt: expect.any(Date) },
      select: expect.any(Object),
    });
    expect(result.status).toBe('ARCHIVED');
  });

  it('is idempotent when the program is already archived', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(archivedRecord);
    const { archiveEventProgram } = await loadService(prisma);

    const result = await archiveEventProgram('program-001');

    expect(prisma.activity.count).not.toHaveBeenCalled();
    expect(prisma.eventProgram.update).not.toHaveBeenCalled();
    expect(result.status).toBe('ARCHIVED');
    expect(result.id).toBe('program-001');
  });

  it('rejects a default program while its organizational unit is active', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ ...archivableRecord, isDefault: true });
    const { archiveEventProgram } = await loadService(prisma);

    await expect(archiveEventProgram('program-001')).rejects.toMatchObject({
      statusCode: 409,
      message:
        'A default event program cannot be archived while its organizational unit is active.',
    });
    expect(prisma.activity.count).not.toHaveBeenCalled();
    expect(prisma.eventProgram.update).not.toHaveBeenCalled();
  });

  it('archives a default program when its organizational unit is inactive', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({
      ...archivableRecord,
      isDefault: true,
      organizationalUnit: { ...createdRecord.organizationalUnit, isActive: false },
    });
    prisma.eventProgram.update.mockResolvedValue({
      ...createdRecord,
      isDefault: true,
      status: 'ARCHIVED',
    });
    const { archiveEventProgram } = await loadService(prisma);

    const result = await archiveEventProgram('program-001');

    expect(prisma.activity.count).not.toHaveBeenCalled();
    expect(prisma.eventProgram.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ARCHIVED', archivedAt: expect.any(Date) } }),
    );
    expect(result.status).toBe('ARCHIVED');
  });

  it('rejects an additional program with scheduled or ongoing activities', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(archivableRecord);
    prisma.activity.count.mockResolvedValue(2);
    const { archiveEventProgram } = await loadService(prisma);

    await expect(archiveEventProgram('program-001')).rejects.toMatchObject({
      statusCode: 409,
      message: 'An event program with scheduled or ongoing activities cannot be archived.',
    });
    expect(prisma.eventProgram.update).not.toHaveBeenCalled();
  });

  it('rejects a missing program with 404', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(null);
    const { archiveEventProgram } = await loadService(prisma);

    await expect(archiveEventProgram('missing')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Event program not found.',
    });
    expect(prisma.activity.count).not.toHaveBeenCalled();
    expect(prisma.eventProgram.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr las pruebas y verificar el rojo**

```bash
pnpm exec vitest run src/modules/event-programs/event-programs.service.test.ts -t archiveEventProgram
```

Resultado esperado: 6 fallos con `TypeError: archiveEventProgram is not a function` (o error de import), ningun otro `describe` afectado.

- [ ] **Step 3: Implementar el servicio**

En `src/modules/event-programs/event-programs.service.ts`, despues de `eventProgramDetailSelect` (linea 29) agregar el select y el tipo del registro:

```ts
const eventProgramArchiveSelect = {
  ...eventProgramDetailSelect,
  organizationalUnit: { select: { id: true, name: true, type: true, isActive: true } },
} as const;

interface EventProgramArchiveRecord {
  id: string;
  name: string;
  description: string | null;
  label: string | null;
  bannerUrl: string | null;
  isDefault: boolean;
  status: ProgramStatus;
  startDate: Date | null;
  endDate: Date | null;
  organizationalUnit: { id: string; name: string; type: UnitType; isActive: boolean };
}
```

Y al final del archivo (despues de `updateEventProgram`):

```ts
export const archiveEventProgram = async (id: string): Promise<EventProgramDetail> => {
  const prisma = getPrismaClient();
  const program = await prisma.eventProgram.findUnique({
    where: { id },
    select: eventProgramArchiveSelect,
  });

  if (!program) {
    throw new ApiError(404, 'Event program not found.');
  }

  if (program.status === 'ARCHIVED') {
    return toEventProgramDetail(program);
  }

  if (program.isDefault && program.organizationalUnit.isActive) {
    throw new ApiError(
      409,
      'A default event program cannot be archived while its organizational unit is active.',
    );
  }

  if (!program.isDefault) {
    const blockingActivities = await prisma.activity.count({
      where: { eventProgramId: program.id, status: { in: ['SCHEDULED', 'ONGOING'] } },
    });

    if (blockingActivities > 0) {
      throw new ApiError(
        409,
        'An event program with scheduled or ongoing activities cannot be archived.',
      );
    }
  }

  const record = await prisma.eventProgram.update({
    where: { id: program.id },
    data: { status: 'ARCHIVED', archivedAt: new Date() },
    select: eventProgramDetailSelect,
  });

  return toEventProgramDetail(record);
};
```

- [ ] **Step 4: Correr las pruebas y verificar el verde**

```bash
pnpm exec vitest run src/modules/event-programs/event-programs.service.test.ts
```

Resultado esperado: todas en verde (las previas + las 6 nuevas).

---

### Task 2: Controlador y ruta `POST /api/v1/event-programs/:id/archive` (TDD)

**Files:**

- Modify: `src/modules/event-programs/event-programs.controller.ts`
- Modify: `src/modules/event-programs/event-programs.routes.ts`
- Test: `src/modules/event-programs/event-programs.routes.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

En `event-programs.routes.test.ts`:

1. Agregar `archiveEventProgram: ReturnType<typeof vi.fn>;` a `EventProgramsServiceMock` (linea 4-9) y `archiveEventProgram: vi.fn(),` a `buildServiceMock` (linea 11-16).
2. Agregar al final del archivo (despues del `describe` de `PATCH`, que cierra en la linea 510):

```ts
describe('POST /api/v1/event-programs/:id/archive', () => {
  afterEach(() => {
    vi.doUnmock('./event-programs.service.js');
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../../utils/jwt-verifier.js');
    vi.doUnmock('../../lib/auth.js');
    vi.doUnmock('../authorization/authorization.service.js');
  });

  const archivedEventProgramDetail = {
    ...eventProgramDetail,
    status: 'ARCHIVED' as const,
  };

  it('rejects archive requests without a token', async () => {
    const service = buildServiceMock();
    const app = await loadApp(service);

    await request(app).post('/api/v1/event-programs/program-001/archive').expect(401);
    expect(service.archiveEventProgram).not.toHaveBeenCalled();
  });

  it('rejects a non-admin without program:archive on the scope', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const app = await loadApp(service, prisma, ['program:update']);

    await request(app)
      .post('/api/v1/event-programs/program-001/archive')
      .set('Authorization', 'Bearer user-001')
      .expect(403);
    expect(service.archiveEventProgram).not.toHaveBeenCalled();
  });

  it('archives an event program for an admin', async () => {
    const service = buildServiceMock();
    service.archiveEventProgram.mockResolvedValue(archivedEventProgramDetail);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    const response = await request(app)
      .post('/api/v1/event-programs/program-001/archive')
      .set('Authorization', 'Bearer admin-001')
      .expect(200);

    expect(service.archiveEventProgram).toHaveBeenCalledWith('program-001');
    expect(response.body).toEqual({
      success: true,
      message: 'Event program archived successfully.',
      data: archivedEventProgramDetail,
    });
  });

  it('archives an event program for a collaborator with program:archive in scope', async () => {
    const service = buildServiceMock();
    service.archiveEventProgram.mockResolvedValue(archivedEventProgramDetail);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const getEffectivePermissions = vi.fn();
    const app = await loadApp(service, prisma, ['program:archive'], getEffectivePermissions);

    await request(app)
      .post('/api/v1/event-programs/program-001/archive')
      .set('Authorization', 'Bearer user-001')
      .expect(200);

    expect(getEffectivePermissions).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-001' }),
      { eventProgramId: 'program-001' },
    );
    expect(service.archiveEventProgram).toHaveBeenCalledWith('program-001');
  });

  it('rejects a blank id before the service', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .post('/api/v1/event-programs/%20/archive')
      .set('Authorization', 'Bearer admin-001')
      .expect(400);
    expect(service.archiveEventProgram).not.toHaveBeenCalled();
  });

  it('propagates a missing event program as 404', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);
    const { ApiError } = await import('../../utils/ApiError.js');
    service.archiveEventProgram.mockRejectedValue(new ApiError(404, 'Event program not found.'));

    await request(app)
      .post('/api/v1/event-programs/missing/archive')
      .set('Authorization', 'Bearer admin-001')
      .expect(404);
  });
});
```

- [ ] **Step 2: Correr las pruebas y verificar el rojo**

```bash
pnpm exec vitest run src/modules/event-programs/event-programs.routes.test.ts -t archive
```

Resultado esperado: fallos `404` de supertest (la ruta no existe) y `TypeError` del mock; el resto del archivo sigue pasando.

- [ ] **Step 3: Implementar controlador y ruta**

En `src/modules/event-programs/event-programs.controller.ts`, agregar el import en el bloque de servicios:

```ts
import {
  archiveEventProgram as archiveEventProgramService,
  createEventProgram as createEventProgramService,
  getEventProgramById as getEventProgramByIdService,
  listEventPrograms as listEventProgramsService,
  updateEventProgram as updateEventProgramService,
} from './event-programs.service.js';
```

Y al final:

```ts
export const archiveEventProgram: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const result = await archiveEventProgramService(id);

  res.status(200).json(successResponse('Event program archived successfully.', result));
});
```

En `src/modules/event-programs/event-programs.routes.ts`, agregar `archiveEventProgram` al import del controlador y, despues del `PATCH`:

```ts
eventProgramsRoutes.post(
  '/event-programs/:id/archive',
  authenticate,
  requirePermission(PERMISSIONS.PROGRAM_ARCHIVE, (req) => {
    const id = (req.params as { id?: string }).id;

    return typeof id === 'string' && id.length > 0 ? { eventProgramId: id } : undefined;
  }),
  validate(eventProgramParamsSchema),
  archiveEventProgram,
);
```

- [ ] **Step 4: Correr las pruebas y verificar el verde**

```bash
pnpm exec vitest run src/modules/event-programs/event-programs.routes.test.ts
```

Resultado esperado: todas en verde (las previas + las 6 nuevas).

---

### Task 3: Contrato OpenAPI (TDD)

**Files:**

- Modify: `src/modules/event-programs/event-programs.openapi.ts`
- Modify: `src/docs/openapi.test.ts`
- Modify: `openapi.json` (generado)

- [ ] **Step 1: Escribir la prueba de contrato que falla**

En `src/docs/openapi.test.ts`:

1. Agregar `'POST /api/v1/event-programs/{id}/archive',` a `expectedOperations` (despues de `'POST /api/v1/event-programs',`).
2. Agregar, despues del test `marks event program update with bearer security...` (linea 166):

```ts
it('documents event program archiving with bearer security and conflict responses', () => {
  const operation = openApiDocument.paths?.['/api/v1/event-programs/{id}/archive']?.post;
  const parameters = operation?.parameters ?? [];
  const names = parameters.map((parameter) => ('name' in parameter ? parameter.name : undefined));

  expect(operation?.security).toEqual([{ bearerAuth: [] }]);
  expect(names).toContain('id');
  expect(operation?.responses?.['200']).toBeDefined();
  expect(operation?.responses?.['401']).toBeDefined();
  expect(operation?.responses?.['403']).toBeDefined();
  expect(operation?.responses?.['404']).toBeDefined();
  expect(operation?.responses?.['409']).toBeDefined();
});
```

- [ ] **Step 2: Correr y verificar el rojo**

```bash
pnpm exec vitest run src/docs/openapi.test.ts
```

Resultado esperado: falla `contains exactly the expected operations` (operacion faltante) y el test nuevo (operacion `undefined`).

- [ ] **Step 3: Documentar la operacion**

En `src/modules/event-programs/event-programs.openapi.ts`, agregar una entrada nueva al objeto `eventProgramsPaths` (despues del path `'/api/v1/event-programs/{id}'`):

```ts
'/api/v1/event-programs/{id}/archive': {
  post: {
    tags: ['Event Programs'],
    summary: 'Archive an event program',
    description:
      'Archives an event program and stamps archivedAt. Requires the program:archive permission on the program scope, or the ADMIN role. Default programs cannot be archived while their organizational unit is active (409) and additional programs with SCHEDULED or ONGOING activities are rejected (409); DRAFT, COMPLETED and CANCELLED activities do not block. Archiving an already archived program is idempotent: it responds 200 without modifying archivedAt.',
    security: [{ bearerAuth: [] }],
    requestParams: { path: eventProgramParamsSchema.shape.params },
    responses: {
      200: {
        description: 'Archived event program.',
        content: { 'application/json': { schema: apiSuccessResponse(eventProgramDetailSchema) } },
      },
      400: errorResponse,
      401: errorResponse,
      403: errorResponse,
      404: errorResponse,
      409: errorResponse,
    },
  },
},
```

- [ ] **Step 4: Regenerar el contrato y verificar**

```bash
pnpm run docs:generate
pnpm run docs:check
pnpm exec vitest run src/docs/openapi.test.ts
```

Resultado esperado: `openapi.json` actualizado (nueva operacion), `docs:check` sin drift y el test de contrato en verde.

---

### Task 4: Documentacion

**Files:**

- Modify: `CONTEXT.md`
- Modify: `README.md`

- [ ] **Step 1: Actualizar `CONTEXT.md`**

Despues de la linea que describe `PATCH /api/v1/event-programs/:id` (linea 155, seccion "Programas de eventos" del bloque de endpoints) agregar:

```md
- `POST /api/v1/event-programs/:id/archive` (privado) archiva un programa y sella `archivedAt`. Requiere `program:archive` en el scope del programa o rol `ADMIN` (ningun rol de colaboracion incluye este permiso por defecto). Un programa predeterminado con su unidad activa responde `409`; un programa adicional con actividades `SCHEDULED`/`ONGOING` responde `409` (`DRAFT`, `COMPLETED` y `CANCELLED` no bloquean). Archivar un programa ya archivado responde `200` sin modificar `archivedAt` (idempotente). Tras archivar, `GET /event-programs/:id` responde `404` y `POST /activities` responde `400` porque el programa deja de estar `ACTIVE`.
```

- [ ] **Step 2: Actualizar `README.md`**

Despues de la linea de `PATCH /api/v1/event-programs/:id` (linea 274, seccion "Programas De Eventos") agregar:

```md
- `POST /api/v1/event-programs/:id/archive` (privado) archiva un programa y registra `archivedAt`. Requiere el permiso `program:archive` en el scope del programa (o rol `ADMIN`; ningun rol de colaboracion lo incluye por defecto). Responde `409` si el programa es predeterminado y su unidad sigue activa o si el programa es adicional y tiene actividades `SCHEDULED`/`ONGOING`. Repetir la operacion sobre un programa ya archivado responde `200` sin cambiar `archivedAt`.
```

- [ ] **Step 3: Verificar formato**

```bash
pnpm exec prettier --check CONTEXT.md README.md
```

---

### Task 5: Coleccion Bruno

**Files:**

- Create: `bruno/Event_Programs/Archive an already archived event program returns 200.bru`
- Create: `bruno/Event_Programs/Archive a program with scheduled activities returns 409.bru`
- Create: `bruno/Event_Programs/Archive a default program with an active unit returns 409.bru`
- Create: `bruno/Event_Programs/Archive without a token returns 401.bru`
- Create: `bruno/Event_Programs/Log in as a user without archive permission.bru`
- Create: `bruno/Event_Programs/Archive as a user without permission returns 403.bru`
- Modify: `bruno/environments/local.bru` (agregar `archiveProgramId` si no se reutiliza `archivedProgramId`)

Los requests nuevos usan datos del seed y no mutan estado (`foro-ipe` ya esta archivado y los `409` no escriben), de modo que la carpeta sigue siendo repetible.

- [ ] **Step 1: Crear `Archive an already archived event program returns 200.bru`**

```bru
meta {
  name: Archive an already archived event program returns 200
  type: http
  seq: 15
  tags: [
    Event_Programs
  ]
}

post {
  url: {{baseUrl}}/api/v1/event-programs/{{archivedProgramId}}/archive
  auth: bearer
}

auth:bearer {
  token: {{token}}
}

tests {
  test("archiving an archived program is idempotent", function () {
    expect(res.getStatus()).to.equal(200);
    const body = res.getBody();
    expect(body.success).to.equal(true);
    expect(body.message).to.equal("Event program archived successfully.");
    expect(body.data.status).to.equal("ARCHIVED");
  });
}
```

- [ ] **Step 2: Crear `Archive a program with scheduled activities returns 409.bru`**

```bru
meta {
  name: Archive a program with scheduled activities returns 409
  type: http
  seq: 16
  tags: [
    Event_Programs
  ]
}

post {
  url: {{baseUrl}}/api/v1/event-programs/{{activeProgramId}}/archive
  auth: bearer
}

auth:bearer {
  token: {{token}}
}

tests {
  test("programs with scheduled activities cannot be archived", function () {
    expect(res.getStatus()).to.equal(409);
    const body = res.getBody();
    expect(body.success).to.equal(false);
    expect(body.message).to.equal("An event program with scheduled or ongoing activities cannot be archived.");
  });
}
```

Nota: verificar antes de la corrida que `activeProgramId` (`seed_program_jornada-bienestar`) tenga actividades `SCHEDULED`/`ONGOING` en el seed; si no las tiene, usar `eventProgramId` (`seed_program_congreso-cit`, con 3 `SCHEDULED`).

- [ ] **Step 3: Crear `Archive a default program with an active unit returns 409.bru`**

```bru
meta {
  name: Archive a default program with an active unit returns 409
  type: http
  seq: 17
  tags: [
    Event_Programs
  ]
}

post {
  url: {{baseUrl}}/api/v1/event-programs/{{defaultProgramId}}/archive
  auth: bearer
}

auth:bearer {
  token: {{token}}
}

tests {
  test("default programs cannot be archived while their unit is active", function () {
    expect(res.getStatus()).to.equal(409);
    const body = res.getBody();
    expect(body.success).to.equal(false);
    expect(body.message).to.equal("A default event program cannot be archived while its organizational unit is active.");
  });
}
```

- [ ] **Step 4: Crear `Archive without a token returns 401.bru`**

```bru
meta {
  name: Archive without a token returns 401
  type: http
  seq: 18
  tags: [
    Event_Programs
  ]
}

post {
  url: {{baseUrl}}/api/v1/event-programs/{{archivedProgramId}}/archive
  auth: none
}

tests {
  test("archive requires authentication", function () {
    expect(res.getStatus()).to.equal(401);
  });
}
```

- [ ] **Step 5: Crear `Log in as a user without archive permission.bru`**

```bru
meta {
  name: Log in as a user without archive permission
  type: http
  seq: 19
  tags: [
    Event_Programs
  ]
}

post {
  url: {{baseUrl}}/api/v1/auth/login
  body: json
  auth: none
}

headers {
  X-Forwarded-For: 10.43.0.19
}

body:json {
  {
    "email": "{{userEmail}}",
    "password": "{{userPassword}}"
  }
}

script:post-response {
  const body = res.getBody();

  if (body?.success && body.data?.accessToken) {
    bru.setVar("userToken", body.data.accessToken);
  }
}

tests {
  test("user login returns an access token", function () {
    expect(res.getStatus()).to.equal(200);
    expect(res.getBody().data.accessToken).to.be.a("string");
  });
}
```

- [ ] **Step 6: Crear `Archive as a user without permission returns 403.bru`**

```bru
meta {
  name: Archive as a user without permission returns 403
  type: http
  seq: 20
  tags: [
    Event_Programs
  ]
}

post {
  url: {{baseUrl}}/api/v1/event-programs/{{archivedProgramId}}/archive
  auth: bearer
}

auth:bearer {
  token: {{userToken}}
}

tests {
  test("program:archive is required", function () {
    expect(res.getStatus()).to.equal(403);
  });
}
```

- [ ] **Step 7: Correr la carpeta**

```bash
pnpm --dir bruno exec bru run Event_Programs --env local
```

Resultado esperado: 20/20 requests y 16/16 tests en verde (los 6 tests nuevos se suman a los 11 existentes). Nota: los logins usan buckets de 5/min; si una corrida previa agoto el limite, esperar 60 s o ejecutar solo la carpeta.

---

### Task 6: E2E real con Docker + psql

**Files:**

- Create temporal: `/tmp/opencode/f43-e2e.mjs` (se elimina al final)

- [ ] **Step 1: Confirmar el stack y el baseline**

```bash
docker ps --format '{{.Names}}'
docker exec sipeg-utp-dev-db-1 psql -U sipeg -d sipeg_utp -t -A -c "SELECT COUNT(*) || '|' || COUNT(*) FILTER (WHERE is_default) FROM event_programs;"
```

Baseline esperado: `16|11` (tras el seed demo). Confirmar que el contenedor de la API esta arriba y recargado.

- [ ] **Step 2: Escribir y correr el script E2E**

Contenido de `/tmp/opencode/f43-e2e.mjs`:

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

const admin = await login('admin@utp.ac.pa', 'Sipeg2026*UTP');
const student = await login('estudiante01@utp.ac.pa', 'Sipeg2026*UTP');

const createProgram = async (suffix) => {
  const response = await api('POST', '/event-programs', {
    token: admin,
    body: {
      name: `TMP-F4.3 ${suffix} ${Date.now()}`,
      organizationalUnitId: 'seed_unit_fic',
      startDate: '2026-12-01',
      endDate: '2026-12-05',
    },
  });
  if (response.status !== 201) throw new Error(`create program -> ${response.status}`);
  return response.body.data.id;
};

const tempId = await createProgram('directo');
const draftActivityProgramId = await createProgram('con-borrador');
check('temporary programs created as DRAFT', Boolean(tempId) && Boolean(draftActivityProgramId));

// 1) Archivado exitoso de un programa DRAFT sin actividades.
const archive = await api('POST', `/event-programs/${tempId}/archive`, { token: admin });
check(
  'archive a draft program returns 200 ARCHIVED',
  archive.status === 200 &&
    archive.body?.message === 'Event program archived successfully.' &&
    archive.body?.data?.status === 'ARCHIVED',
  `status=${archive.status} program=${archive.body?.data?.status}`,
);
const archivedAtFirst = psql(
  `SELECT archived_at::text FROM event_programs WHERE id = '${tempId}';`,
);
check(
  'psql stamps archived_at',
  archivedAtFirst !== '' && archivedAtFirst !== 'NULL',
  archivedAtFirst,
);

// 2) Idempotencia: segundo archivado no mueve archived_at.
const archiveAgain = await api('POST', `/event-programs/${tempId}/archive`, { token: admin });
const archivedAtSecond = psql(
  `SELECT archived_at::text FROM event_programs WHERE id = '${tempId}';`,
);
check(
  'second archive returns 200 and keeps archived_at',
  archiveAgain.status === 200 &&
    archiveAgain.body?.data?.status === 'ARCHIVED' &&
    archivedAtFirst === archivedAtSecond,
  `status=${archiveAgain.status} first=${archivedAtFirst} second=${archivedAtSecond}`,
);

// 3) Un programa archivado deja de ser visible y no admite actividades.
const publicGet = await api('GET', `/event-programs/${tempId}`);
check(
  'archived program is hidden from GET',
  publicGet.status === 404,
  `status=${publicGet.status}`,
);
const createInArchived = await api('POST', '/activities', {
  token: admin,
  body: {
    name: `TMP-F4.3 actividad ${Date.now()}`,
    type: 'TALK',
    date: '2026-12-02',
    startTime: '10:00',
    endTime: '11:00',
    eventProgramId: tempId,
  },
});
check(
  'activities cannot be created in an archived program',
  createInArchived.status === 400 &&
    createInArchived.body?.message === 'Activities can only be created in an active event program.',
  `status=${createInArchived.status} message=${createInArchived.body?.message}`,
);

// 4) Actividades DRAFT no bloquean el archivado.
const activate = await api('PATCH', `/event-programs/${draftActivityProgramId}`, {
  token: admin,
  body: { status: 'ACTIVE' },
});
check('temporary program activated', activate.status === 200, `status=${activate.status}`);
const draftActivity = await api('POST', '/activities', {
  token: admin,
  body: {
    name: `TMP-F4.3 actividad ${Date.now()}`,
    type: 'TALK',
    date: '2026-12-02',
    startTime: '10:00',
    endTime: '11:00',
    eventProgramId: draftActivityProgramId,
  },
});
check('draft activity created', draftActivity.status === 201, `status=${draftActivity.status}`);
const archiveWithDraft = await api('POST', `/event-programs/${draftActivityProgramId}/archive`, {
  token: admin,
});
check(
  'draft activities do not block archiving',
  archiveWithDraft.status === 200 && archiveWithDraft.body?.data?.status === 'ARCHIVED',
  `status=${archiveWithDraft.status}`,
);

// 5) Programa adicional con actividades SCHEDULED -> 409.
const scheduled = await api('POST', '/event-programs/seed_program_congreso-cit/archive', {
  token: admin,
});
check(
  'scheduled activities block archiving',
  scheduled.status === 409 &&
    scheduled.body?.message ===
      'An event program with scheduled or ongoing activities cannot be archived.',
  `status=${scheduled.status} message=${scheduled.body?.message}`,
);
const citStatus = psql(`SELECT status FROM event_programs WHERE id = 'seed_program_congreso-cit';`);
check('congreso-cit stays ACTIVE', citStatus === 'ACTIVE', citStatus);

// 6) Programa predeterminado con unidad activa -> 409.
const defaultArchive = await api('POST', '/event-programs/seed_program_fic_default/archive', {
  token: admin,
});
check(
  'default program with an active unit cannot be archived',
  defaultArchive.status === 409 &&
    defaultArchive.body?.message ===
      'A default event program cannot be archived while its organizational unit is active.',
  `status=${defaultArchive.status} message=${defaultArchive.body?.message}`,
);

// 7) 404, 401 y 403.
const unknown = await api('POST', '/event-programs/program-does-not-exist/archive', {
  token: admin,
});
check('unknown program returns 404', unknown.status === 404, `status=${unknown.status}`);
const noToken = await api('POST', `/event-programs/${tempId}/archive`);
check('archive without a token returns 401', noToken.status === 401, `status=${noToken.status}`);
const forbidden = await api('POST', `/event-programs/${tempId}/archive`, { token: student });
check(
  'archive as USER without permission returns 403',
  forbidden.status === 403,
  `status=${forbidden.status}`,
);

// 8) Idempotencia sobre un programa archivado del seed no mueve archived_at.
const foroBefore = psql(
  `SELECT archived_at::text FROM event_programs WHERE id = 'seed_program_foro-ipe';`,
);
const foroArchive = await api('POST', '/event-programs/seed_program_foro-ipe/archive', {
  token: admin,
});
const foroAfter = psql(
  `SELECT archived_at::text FROM event_programs WHERE id = 'seed_program_foro-ipe';`,
);
check(
  'archiving the seeded archived program keeps archived_at',
  foroArchive.status === 200 &&
    foroArchive.body?.data?.status === 'ARCHIVED' &&
    foroBefore === foroAfter,
  `status=${foroArchive.status} before=${foroBefore} after=${foroAfter}`,
);

// 9) Limpieza total.
psql(
  `BEGIN; ALTER TABLE event_programs DISABLE TRIGGER event_programs_prevent_delete; DELETE FROM activities WHERE event_program_id IN ('${tempId}', '${draftActivityProgramId}'); DELETE FROM event_programs WHERE id IN ('${tempId}', '${draftActivityProgramId}'); ALTER TABLE event_programs ENABLE TRIGGER event_programs_prevent_delete; COMMIT;`,
);
const remaining = psql(
  `SELECT COUNT(*) FROM event_programs WHERE id IN ('${tempId}', '${draftActivityProgramId}');`,
);
check('temporary programs removed', remaining === '0', remaining);
const totals = psql(
  `SELECT COUNT(*) || '|' || COUNT(*) FILTER (WHERE is_default) FROM event_programs;`,
);
console.log(`program totals (total|default): ${totals}`);

const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
```

Ejecutar:

```bash
node /tmp/opencode/f43-e2e.mjs
```

Resultado esperado: todos los checks en `PASS`, `program totals (total|default): 16|11` y exit code 0.

- [ ] **Step 3: Eliminar el script temporal**

```bash
rm /tmp/opencode/f43-e2e.mjs
```

---

### Task 7: Gates finales y actualizacion del plan maestro

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

1. Tabla "Estado actual": cambiar la fila de Programas a `Parcial: 4.1-4.3 implementados; faltan 4.4-4.7`.
2. Lista de endpoints existentes: agregar `POST /event-programs/:id/archive` antes de los subrecursos de colaboradores.
3. Marcar `- [x] **4.3 Archivar programa ...**`.
4. Agregar el bloque de registro despues del registro de 4.2 y antes de `**Criterio de salida:**`:

```md
**Registro de ejecucion (2026-09-21 - 4.3):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-21-fase-4-3-archivar-programa.md` con ciclo TDD rojo/verde en servicio (6 pruebas), rutas (6), contrato OpenAPI (1 nueva) y pruebas previas intactas.
- [x] Implementacion: `archiveEventProgram(id)` con idempotencia sobre `ARCHIVED` (sin escritura), `409` para predeterminados con unidad activa, `409` para adicionales con actividades `SCHEDULED`/`ONGOING` y `update { status, archivedAt }`; ruta `POST /api/v1/event-programs/:id/archive` con `authenticate -> requirePermission(program:archive, scope) -> validate(params) -> controlador`.
- [x] Decisiones: sin cambios de catalogo (program:archive ya existia y no esta en ningun ROLE_DEFAULT); DTO reutiliza `EventProgramDetail` sin exponer `archivedAt`; sin migraciones ni variables de entorno.
- [x] Pruebas: (completar con el total real de `pnpm test` y archivos) + gates `typecheck`, `lint`, `build`, `format:check`, `docs:generate` y `docs:check`.
- [x] Verificacion real (stack Docker dev, seed demo): (completar con el resultado del E2E).
- [x] Bruno: (completar con requests/tests y resultado de `bru run Event_Programs --env local`).
- [x] Contrato: `openapi.json` regenerado sin drift; operacion `POST`, path param `id`, respuestas 200/400/401/403/404/409 y componente `EventProgramDetail` reutilizado.
- [x] Documentacion: README y CONTEXT describen el endpoint, las guardas y la idempotencia.
- [x] Hallazgo `F4.3-A`: carrera entre el pre-chequeo de actividades y el archivado (el trigger `validate_event_program_transition` queda como ultima linea, igual que `F4.2-B`).
- [x] Sin commit: el usuario no lo solicito.
```

Completar los `(completar ...)` con la evidencia real antes de cerrar la fase.

---

## Self-review del plan

- **Cobertura del item 4.3:** predeterminado con unidad activa -> `409` (Task 1 tests 3/4); adicional con `SCHEDULED`/`ONGOING` -> `409` (Task 1 test 5, E2E check 5); `archivedAt` persistido (Task 1 test 1, E2E checks 1); idempotencia (Task 1 test 2, E2E checks 2/8); endpoint + permiso (Task 2); contrato (Task 3); Bruno (Task 5); E2E (Task 6).
- **Sin placeholders:** todo el codigo de produccion y de pruebas esta completo; el unico texto a completar es la evidencia del registro del plan maestro, que depende de la ejecucion.
- **Consistencia de tipos:** `archiveEventProgram(id: string): Promise<EventProgramDetail>`, `eventProgramArchiveSelect` reutiliza `eventProgramDetailSelect`, el mock de rutas incluye `archiveEventProgram`, y la prueba de contrato usa la misma ruta `/api/v1/event-programs/{id}/archive`.
- **Riesgos conocidos:** el trigger solo dispara en el cambio de estado, por lo que la idempotencia no depende de el; la carrera con un alta concurrente de actividad queda documentada como `F4.3-A`; los logins de Bruno comparten el bucket de 5/min por IP, mitigado con `X-Forwarded-For` en el login nuevo.
