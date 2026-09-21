# Fase 4.4 - Reactivar programa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar `POST /api/v1/event-programs/:id/reactivate` que devuelve un programa adicional `ARCHIVED` a `ACTIVE` validando coherencia de fechas, con permiso nuevo `program:reactivate`, contrato OpenAPI, Bruno y verificacion E2E.

**Architecture:** Se mantiene el modulo autocontenido `src/modules/event-programs/`. El servicio `reactivateEventProgram` carga el programa con su unidad (select de ciclo de vida reutilizado con archive), rechaza predeterminados y estados distintos de `ARCHIVED`, valida que exista un rango de fechas coherente (`startDate <= endDate`) y persiste `status: 'ACTIVE'` + `archivedAt: null` (el CHECK `(status = 'ARCHIVED') = (archived_at IS NOT NULL)` lo exige). La ruta reutiliza `authenticate -> requirePermission(program:reactivate, scope) -> validate(params) -> controlador`. Se agrega `PROGRAM_REACTIVATE` al catalogo canonico sin incluirlo en `ROLE_DEFAULTS`, por lo que solo `ADMIN` (bypass) o un `OVERRIDE` explicito pueden reactivar; el seed base y demo ya upsertean el catalogo a partir de `PERMISSION_NAMES`. No hay migraciones, dependencias ni variables de entorno nuevas.

**Tech Stack:** TypeScript 6, Express 5, Prisma 7 (SQL/Postgres), Zod 4, Vitest, Supertest, OpenAPI 3.1 (zod-openapi), Bruno.

**Estado de partida (2026-09-21):**

- `POST /api/v1/event-programs/:id/archive` (4.3) archiva con `program:archive`, idempotente sobre `ARCHIVED`, y sella `archivedAt`.
- `PATCH /api/v1/event-programs/:id` publica `DRAFT -> ACTIVE` y rechaza programas `ARCHIVED` con `409`.
- Trigger `validate_event_program_transition` solo actua al pasar a `ARCHIVED`; no bloquea `ARCHIVED -> ACTIVE`. Trigger `reactivate_default_event_program`: al reactivar una unidad restaura su programa predeterminado (`ACTIVE`, `archived_at = NULL`).
- CHECK de BD: `(status = 'ARCHIVED') = (archived_at IS NOT NULL)` y `NOT is_default OR status IN ('ACTIVE', 'ARCHIVED')`.
- `PERMISSIONS` no incluye `program:reactivate`; `ROLE_DEFAULTS` no lo tendra.
- Seed demo: `seed_program_foro-ipe` (`ARCHIVED`, adicional, fechas vencidas), `seed_program_congreso-cit` (`ACTIVE` adicional), `seed_program_fic_default` (predeterminado `ACTIVE`), `seed_program_jornada-bienestar` (`ACTIVE` adicional).
- Bruno `Event_Programs`: 20 requests / 17 tests; seq maximo 20; `userToken` se captura en seq 19.

**Decisiones de diseno (2026-09-21, confirmadas con el usuario):**

1. **Estado destino:** `ARCHIVED -> ACTIVE` directo (espejo de la reactivacion de unidad 2.A.6). No pasa por `DRAFT`.
2. **Fechas:** validar solo coherencia (existen y `startDate <= endDate`); no se rechaza por rango vencido. Un programa con fechas pasadas puede volver a `ACTIVE`.
3. **Permiso:** nuevo `program:reactivate` en el catalogo, fuera de `ROLE_DEFAULTS`: solo `ADMIN` u `OVERRIDE` explicito.
4. **Programa no archivado:** `409` siempre (sin idempotencia), incluido `ACTIVE`; consistente con `organizational-units/:id/reactivate` (`409 Organizational unit is already active.`).
5. **Predeterminados:** `409`; su reactivacion es via `POST /organizational-units/:id/reactivate`.
6. **Sin guarda de unidad activa:** los programas adicionales no se archivan al desactivar la unidad (`deactivateOrganizationalUnit` solo archiva el predeterminado), asi que reactivar bajo una unidad inactiva es coherente con el estado existente.
7. **DTO:** se reutiliza `EventProgramDetail` (ya expone `status: 'ACTIVE'`). No se expone `archivedAt`.
8. **Sin transaccion:** una sola escritura.

**Reglas de negocio:**

- Programa inexistente -> `404 Event program not found.`
- `isDefault = true` -> `409 Only additional event programs can be reactivated.`
- `status !== 'ARCHIVED'` -> `409 Only archived event programs can be reactivated.`
- `startDate` o `endDate` nulos, o `endDate < startDate` -> `400 Event program dates are invalid.`
- Caso valido -> `update { status: 'ACTIVE', archivedAt: null }` y `200` con el DTO.
- No hay body ni query; solo se valida el path param `id` (1-100 caracteres, trim).

---

### Task 1: Catalogo `program:reactivate` (TDD)

**Files:**

- Modify: `src/modules/authorization/permissions.ts`
- Test: `src/modules/authorization/permissions.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

En `src/modules/authorization/permissions.test.ts`, agregar despues del test `never grants permission:grant through role defaults` (linea 29):

```ts
it('keeps program:reactivate out of every role default', () => {
  expect(PERMISSIONS.PROGRAM_REACTIVATE).toBe('program:reactivate');

  for (const defaults of Object.values(ROLE_DEFAULTS)) {
    expect(defaults).not.toContain(PERMISSIONS.PROGRAM_REACTIVATE);
  }
});
```

- [ ] **Step 2: Correr y verificar el rojo**

```bash
pnpm exec vitest run src/modules/authorization/permissions.test.ts
```

Resultado esperado: el test nuevo falla (`PERMISSIONS.PROGRAM_REACTIVATE` es `undefined`); el resto en verde.

- [ ] **Step 3: Implementar el catalogo**

En `src/modules/authorization/permissions.ts`:

1. Agregar la clave despues de `PROGRAM_ARCHIVE`:

```ts
  PROGRAM_ARCHIVE: 'program:archive',
  PROGRAM_REACTIVATE: 'program:reactivate',
```

2. Agregar la descripcion despues de `PROGRAM_ARCHIVE`:

```ts
  [PERMISSIONS.PROGRAM_ARCHIVE]: 'Archivar programas de eventos.',
  [PERMISSIONS.PROGRAM_REACTIVATE]: 'Reactivar programas de eventos archivados.',
```

- [ ] **Step 4: Correr y verificar el verde**

```bash
pnpm exec vitest run src/modules/authorization/permissions.test.ts prisma/seed/base.seed.test.ts
```

Resultado esperado: todo en verde (el seed base cuenta permisos con `PERMISSION_NAMES.length`, sin cambios de codigo).

---

### Task 2: Servicio `reactivateEventProgram` (TDD)

**Files:**

- Modify: `src/modules/event-programs/event-programs.service.ts`
- Test: `src/modules/event-programs/event-programs.service.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

Agregar al final de `event-programs.service.test.ts`:

```ts
describe('reactivateEventProgram', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../authorization/authorization.service.js');
  });

  const archivedProgram = {
    ...createdRecord,
    status: 'ARCHIVED' as const,
    organizationalUnit: { ...createdRecord.organizationalUnit, isActive: true },
  };

  const reactivatedRecord = { ...archivedProgram, status: 'ACTIVE' as const };

  it('reactivates an archived additional program and clears archivedAt', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(archivedProgram);
    prisma.eventProgram.update.mockResolvedValue(reactivatedRecord);
    const { reactivateEventProgram } = await loadService(prisma);

    const result = await reactivateEventProgram('program-001');

    expect(prisma.eventProgram.update).toHaveBeenCalledWith({
      where: { id: 'program-001' },
      data: { status: 'ACTIVE', archivedAt: null },
      select: expect.any(Object),
    });
    expect(prisma.activity.count).not.toHaveBeenCalled();
    expect(result).toEqual({
      ...reactivatedRecord,
      startDate: '2026-10-12',
      endDate: '2026-10-16',
    });
  });

  it('rejects a missing event program with 404', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(null);
    const { reactivateEventProgram } = await loadService(prisma);

    await expect(reactivateEventProgram('missing')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Event program not found.',
    });
    expect(prisma.eventProgram.update).not.toHaveBeenCalled();
  });

  it('rejects default event programs with 409', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ ...archivedProgram, isDefault: true });
    const { reactivateEventProgram } = await loadService(prisma);

    await expect(reactivateEventProgram('program-001')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Only additional event programs can be reactivated.',
    });
    expect(prisma.eventProgram.update).not.toHaveBeenCalled();
  });

  it.each(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const)(
    'rejects an event program in %s status with 409',
    async (status) => {
      const prisma = createPrismaMock();
      prisma.eventProgram.findUnique.mockResolvedValue({ ...archivedProgram, status });
      const { reactivateEventProgram } = await loadService(prisma);

      await expect(reactivateEventProgram('program-001')).rejects.toMatchObject({
        statusCode: 409,
        message: 'Only archived event programs can be reactivated.',
      });
      expect(prisma.eventProgram.update).not.toHaveBeenCalled();
    },
  );

  it('rejects an archived program without dates', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({
      ...archivedProgram,
      startDate: null,
      endDate: null,
    });
    const { reactivateEventProgram } = await loadService(prisma);

    await expect(reactivateEventProgram('program-001')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Event program dates are invalid.',
    });
    expect(prisma.eventProgram.update).not.toHaveBeenCalled();
  });

  it('rejects an archived program whose end date precedes its start date', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({
      ...archivedProgram,
      startDate: new Date('2026-10-16T00:00:00.000Z'),
      endDate: new Date('2026-10-12T00:00:00.000Z'),
    });
    const { reactivateEventProgram } = await loadService(prisma);

    await expect(reactivateEventProgram('program-001')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Event program dates are invalid.',
    });
    expect(prisma.eventProgram.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr y verificar el rojo**

```bash
pnpm exec vitest run src/modules/event-programs/event-programs.service.test.ts -t reactivateEventProgram
```

Resultado esperado: 9 fallos con `TypeError: reactivateEventProgram is not a function`; ningun otro `describe` afectado.

- [ ] **Step 3: Implementar el servicio**

En `src/modules/event-programs/event-programs.service.ts`, renombrar el select de archivo (linea 31) para reutilizarlo:

```ts
const eventProgramLifecycleSelect = {
  ...eventProgramDetailSelect,
  organizationalUnit: { select: { id: true, name: true, type: true, isActive: true } },
} as const;
```

y actualizar la unica referencia en `archiveEventProgram` (`select: eventProgramArchiveSelect` -> `select: eventProgramLifecycleSelect`).

Agregar al final del archivo, despues de `archiveEventProgram`:

```ts
export const reactivateEventProgram = async (id: string): Promise<EventProgramDetail> => {
  const prisma = getPrismaClient();
  const program = await prisma.eventProgram.findUnique({
    where: { id },
    select: eventProgramLifecycleSelect,
  });

  if (!program) {
    throw new ApiError(404, 'Event program not found.');
  }

  if (program.isDefault) {
    throw new ApiError(409, 'Only additional event programs can be reactivated.');
  }

  if (program.status !== 'ARCHIVED') {
    throw new ApiError(409, 'Only archived event programs can be reactivated.');
  }

  if (!program.startDate || !program.endDate || program.endDate < program.startDate) {
    throw new ApiError(400, 'Event program dates are invalid.');
  }

  const record = await prisma.eventProgram.update({
    where: { id: program.id },
    data: { status: 'ACTIVE', archivedAt: null },
    select: eventProgramDetailSelect,
  });

  return toEventProgramDetail(record);
};
```

- [ ] **Step 4: Correr y verificar el verde**

```bash
pnpm exec vitest run src/modules/event-programs/event-programs.service.test.ts
```

Resultado esperado: todas en verde (las previas + las 9 nuevas).

---

### Task 3: Controlador y ruta `POST /api/v1/event-programs/:id/reactivate` (TDD)

**Files:**

- Modify: `src/modules/event-programs/event-programs.controller.ts`
- Modify: `src/modules/event-programs/event-programs.routes.ts`
- Test: `src/modules/event-programs/event-programs.routes.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

En `event-programs.routes.test.ts`:

1. Agregar `reactivateEventProgram: ReturnType<typeof vi.fn>;` a `EventProgramsServiceMock` (junto a `listEventPrograms`) y `reactivateEventProgram: vi.fn(),` a `buildServiceMock`.
2. Agregar al final del archivo (despues del `describe` de archive):

```ts
describe('POST /api/v1/event-programs/:id/reactivate', () => {
  afterEach(() => {
    vi.doUnmock('./event-programs.service.js');
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../../utils/jwt-verifier.js');
    vi.doUnmock('../../lib/auth.js');
    vi.doUnmock('../authorization/authorization.service.js');
  });

  const reactivatedEventProgramDetail = {
    ...eventProgramDetail,
    status: 'ACTIVE' as const,
  };

  it('rejects reactivation requests without a token', async () => {
    const service = buildServiceMock();
    const app = await loadApp(service);

    await request(app).post('/api/v1/event-programs/program-001/reactivate').expect(401);
    expect(service.reactivateEventProgram).not.toHaveBeenCalled();
  });

  it('rejects a non-admin without program:reactivate on the scope', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const app = await loadApp(service, prisma, ['program:archive']);

    await request(app)
      .post('/api/v1/event-programs/program-001/reactivate')
      .set('Authorization', 'Bearer user-001')
      .expect(403);
    expect(service.reactivateEventProgram).not.toHaveBeenCalled();
  });

  it('reactivates an event program for an admin', async () => {
    const service = buildServiceMock();
    service.reactivateEventProgram.mockResolvedValue(reactivatedEventProgramDetail);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    const response = await request(app)
      .post('/api/v1/event-programs/program-001/reactivate')
      .set('Authorization', 'Bearer admin-001')
      .expect(200);

    expect(service.reactivateEventProgram).toHaveBeenCalledWith('program-001');
    expect(response.body).toEqual({
      success: true,
      message: 'Event program reactivated successfully.',
      data: reactivatedEventProgramDetail,
    });
  });

  it('reactivates an event program for a collaborator with program:reactivate in scope', async () => {
    const service = buildServiceMock();
    service.reactivateEventProgram.mockResolvedValue(reactivatedEventProgramDetail);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const getEffectivePermissions = vi.fn();
    const app = await loadApp(service, prisma, ['program:reactivate'], getEffectivePermissions);

    await request(app)
      .post('/api/v1/event-programs/program-001/reactivate')
      .set('Authorization', 'Bearer user-001')
      .expect(200);

    expect(getEffectivePermissions).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-001' }),
      { eventProgramId: 'program-001' },
    );
    expect(service.reactivateEventProgram).toHaveBeenCalledWith('program-001');
  });

  it('rejects a blank id before the service', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .post('/api/v1/event-programs/%20/reactivate')
      .set('Authorization', 'Bearer admin-001')
      .expect(400);
    expect(service.reactivateEventProgram).not.toHaveBeenCalled();
  });

  it('propagates a missing event program as 404', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);
    const { ApiError } = await import('../../utils/ApiError.js');
    service.reactivateEventProgram.mockRejectedValue(new ApiError(404, 'Event program not found.'));

    await request(app)
      .post('/api/v1/event-programs/missing/reactivate')
      .set('Authorization', 'Bearer admin-001')
      .expect(404);
  });

  it('propagates a default event program as 409', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);
    const { ApiError } = await import('../../utils/ApiError.js');
    service.reactivateEventProgram.mockRejectedValue(
      new ApiError(409, 'Only additional event programs can be reactivated.'),
    );

    await request(app)
      .post('/api/v1/event-programs/program-001/reactivate')
      .set('Authorization', 'Bearer admin-001')
      .expect(409);
  });
});
```

- [ ] **Step 2: Correr y verificar el rojo**

```bash
pnpm exec vitest run src/modules/event-programs/event-programs.routes.test.ts -t reactivate
```

Resultado esperado: fallos 404 de supertest (la ruta no existe) y `TypeError` del mock; el resto del archivo sigue pasando.

- [ ] **Step 3: Implementar controlador y ruta**

En `src/modules/event-programs/event-programs.controller.ts`, agregar el import en el bloque de servicios:

```ts
import {
  archiveEventProgram as archiveEventProgramService,
  createEventProgram as createEventProgramService,
  getEventProgramById as getEventProgramByIdService,
  listEventPrograms as listEventProgramsService,
  reactivateEventProgram as reactivateEventProgramService,
  updateEventProgram as updateEventProgramService,
} from './event-programs.service.js';
```

Y al final:

```ts
export const reactivateEventProgram: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const result = await reactivateEventProgramService(id);

  res.status(200).json(successResponse('Event program reactivated successfully.', result));
});
```

En `src/modules/event-programs/event-programs.routes.ts`, agregar `reactivateEventProgram` al import del controlador y, despues de la ruta de archive:

```ts
eventProgramsRoutes.post(
  '/event-programs/:id/reactivate',
  authenticate,
  requirePermission(PERMISSIONS.PROGRAM_REACTIVATE, (req) => {
    const id = (req.params as { id?: string }).id;

    return typeof id === 'string' && id.length > 0 ? { eventProgramId: id } : undefined;
  }),
  validate(eventProgramParamsSchema),
  reactivateEventProgram,
);
```

- [ ] **Step 4: Correr y verificar el verde**

```bash
pnpm exec vitest run src/modules/event-programs/event-programs.routes.test.ts
```

Resultado esperado: todas en verde (las previas + las 7 nuevas).

---

### Task 4: Contrato OpenAPI (TDD)

**Files:**

- Modify: `src/modules/event-programs/event-programs.openapi.ts`
- Modify: `src/docs/openapi.test.ts`
- Modify: `openapi.json` (generado)

- [ ] **Step 1: Escribir la prueba de contrato que falla**

En `src/docs/openapi.test.ts`:

1. Agregar `'POST /api/v1/event-programs/{id}/reactivate',` a `expectedOperations` (despues de `'POST /api/v1/event-programs/{id}/archive',`).
2. Agregar, despues del test `documents event program archiving with bearer security and conflict responses`:

```ts
it('documents event program reactivation with bearer security and conflict responses', () => {
  const operation = openApiDocument.paths?.['/api/v1/event-programs/{id}/reactivate']?.post;
  const parameters = operation?.parameters ?? [];
  const names = parameters.map((parameter) => ('name' in parameter ? parameter.name : undefined));

  expect(operation?.security).toEqual([{ bearerAuth: [] }]);
  expect(names).toContain('id');
  expect(operation?.responses?.['200']).toBeDefined();
  expect(operation?.responses?.['400']).toBeDefined();
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

En `src/modules/event-programs/event-programs.openapi.ts`, agregar la entrada nueva al objeto `eventProgramsPaths` (despues del path `'/api/v1/event-programs/{id}/archive'`):

```ts
  '/api/v1/event-programs/{id}/reactivate': {
    post: {
      tags: ['Event Programs'],
      summary: 'Reactivate an event program',
      description:
        'Reactivates an ARCHIVED additional event program to ACTIVE and clears archivedAt. Requires the program:reactivate permission on the program scope, or the ADMIN role; no collaboration role grants this permission by default. Default event programs follow their organizational unit lifecycle and respond 409 (use POST /organizational-units/{id}/reactivate instead), and programs that are not ARCHIVED also respond 409. An ARCHIVED program without a coherent start and end date responds 400. Reactivating a program whose organizational unit is inactive is allowed.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: eventProgramParamsSchema.shape.params },
      responses: {
        200: {
          description: 'Reactivated event program.',
          content: {
            'application/json': { schema: apiSuccessResponse(eventProgramDetailSchema) },
          },
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

Resultado esperado: `openapi.json` actualizado (nueva operacion y nuevo valor `program:reactivate` en los enums de permisos), `docs:check` sin drift y el test de contrato en verde.

---

### Task 5: Documentacion

**Files:**

- Modify: `CONTEXT.md`
- Modify: `README.md`

- [ ] **Step 1: Actualizar `CONTEXT.md`**

Despues de la linea que describe `POST /api/v1/event-programs/:id/archive` (linea 158) agregar:

```md
- `POST /api/v1/event-programs/:id/reactivate` (privado) devuelve un programa adicional `ARCHIVED` a `ACTIVE` y limpia `archivedAt`. Requiere `program:reactivate` en el scope del programa o rol `ADMIN` (ningun rol de colaboracion incluye este permiso por defecto). Los programas predeterminados responden `409` porque siguen el ciclo de vida de su unidad (`POST /organizational-units/:id/reactivate`); cualquier estado distinto de `ARCHIVED` responde `409`; un rango de fechas ausente o incoherente (`endDate` anterior a `startDate`) responde `400`. Tras reactivar, el programa vuelve a `GET /event-programs` y admite actividades nuevas.
```

- [ ] **Step 2: Actualizar `README.md`**

Despues de la linea de `POST /api/v1/event-programs/:id/archive` (linea 275) agregar:

```md
- `POST /api/v1/event-programs/:id/reactivate` (privado) reactiva un programa adicional `ARCHIVED` y lo devuelve a `ACTIVE`, limpiando `archivedAt`. Requiere el permiso `program:reactivate` en el scope del programa (o rol `ADMIN`; ningun rol de colaboracion lo incluye por defecto). Responde `409` si el programa es predeterminado (su reactivacion es la de la unidad), si no esta `ARCHIVED`, y `400` si sus fechas son incoherentes. No hay idempotencia: repetir la operacion sobre un programa ya `ACTIVE` responde `409`.
```

- [ ] **Step 3: Verificar formato**

```bash
pnpm exec prettier --check CONTEXT.md README.md
```

---

### Task 6: Coleccion Bruno

**Files:**

- Create: `bruno/Event_Programs/Prepare a program for reactivation.bru`
- Create: `bruno/Event_Programs/Archive the prepared program.bru`
- Create: `bruno/Event_Programs/Reactivate the prepared program.bru`
- Create: `bruno/Event_Programs/Reactivate a default program returns 409.bru`
- Create: `bruno/Event_Programs/Reactivate an active event program returns 409.bru`
- Create: `bruno/Event_Programs/Reactivate an unknown event program returns 404.bru`
- Create: `bruno/Event_Programs/Reactivate without a token returns 401.bru`
- Create: `bruno/Event_Programs/Reactivate as a user without permission returns 403.bru`

No se modifica `bruno/environments/local.bru`: `reactivateProgramId` se captura en runtime con `bru.setVar` y `userToken` ya existe (capturado por `Log in as a user without archive permission`, seq 19).

- [ ] **Step 1: Crear `Prepare a program for reactivation.bru`**

```bru
meta {
  name: Prepare a program for reactivation
  type: http
  seq: 21
  tags: [
    Event_Programs
  ]
}

post {
  url: {{baseUrl}}/api/v1/event-programs
  body: json
  auth: bearer
}

auth:bearer {
  token: {{token}}
}

body:json {
  {
    "name": "TMP-F4.4 programa reactivable",
    "description": "Programa temporal creado por la coleccion Bruno.",
    "startDate": "2026-12-01",
    "endDate": "2026-12-05",
    "organizationalUnitId": "seed_unit_fic"
  }
}

script:post-response {
  const body = res.getBody();

  if (body?.success && body.data?.id) {
    bru.setVar("reactivateProgramId", body.data.id);
  }
}

tests {
  test("prepares a draft program for reactivation", function () {
    expect(res.getStatus()).to.equal(201);
    expect(res.getBody().data.status).to.equal("DRAFT");
  });
}
```

- [ ] **Step 2: Crear `Archive the prepared program.bru`**

```bru
meta {
  name: Archive the prepared program
  type: http
  seq: 22
  tags: [
    Event_Programs
  ]
}

post {
  url: {{baseUrl}}/api/v1/event-programs/{{reactivateProgramId}}/archive
  auth: bearer
}

auth:bearer {
  token: {{token}}
}

tests {
  test("the prepared program is archived", function () {
    expect(res.getStatus()).to.equal(200);
    expect(res.getBody().data.status).to.equal("ARCHIVED");
  });
}
```

- [ ] **Step 3: Crear `Reactivate the prepared program.bru`**

```bru
meta {
  name: Reactivate the prepared program
  type: http
  seq: 23
  tags: [
    Event_Programs
  ]
}

post {
  url: {{baseUrl}}/api/v1/event-programs/{{reactivateProgramId}}/reactivate
  auth: bearer
}

auth:bearer {
  token: {{token}}
}

tests {
  test("reactivating an archived program returns it to ACTIVE", function () {
    expect(res.getStatus()).to.equal(200);
    const body = res.getBody();
    expect(body.success).to.equal(true);
    expect(body.message).to.equal("Event program reactivated successfully.");
    expect(body.data.status).to.equal("ACTIVE");
  });
}
```

- [ ] **Step 4: Crear `Reactivate a default program returns 409.bru`**

```bru
meta {
  name: Reactivate a default program returns 409
  type: http
  seq: 24
  tags: [
    Event_Programs
  ]
}

post {
  url: {{baseUrl}}/api/v1/event-programs/{{defaultProgramId}}/reactivate
  auth: bearer
}

auth:bearer {
  token: {{token}}
}

tests {
  test("default programs follow their unit lifecycle", function () {
    expect(res.getStatus()).to.equal(409);
    const body = res.getBody();
    expect(body.success).to.equal(false);
    expect(body.message).to.equal("Only additional event programs can be reactivated.");
  });
}
```

- [ ] **Step 5: Crear `Reactivate an active event program returns 409.bru`**

```bru
meta {
  name: Reactivate an active event program returns 409
  type: http
  seq: 25
  tags: [
    Event_Programs
  ]
}

post {
  url: {{baseUrl}}/api/v1/event-programs/{{activeProgramId}}/reactivate
  auth: bearer
}

auth:bearer {
  token: {{token}}
}

tests {
  test("only archived programs can be reactivated", function () {
    expect(res.getStatus()).to.equal(409);
    const body = res.getBody();
    expect(body.success).to.equal(false);
    expect(body.message).to.equal("Only archived event programs can be reactivated.");
  });
}
```

- [ ] **Step 6: Crear `Reactivate an unknown event program returns 404.bru`**

```bru
meta {
  name: Reactivate an unknown event program returns 404
  type: http
  seq: 26
  tags: [
    Event_Programs
  ]
}

post {
  url: {{baseUrl}}/api/v1/event-programs/{{unknownProgramId}}/reactivate
  auth: bearer
}

auth:bearer {
  token: {{token}}
}

tests {
  test("unknown programs respond 404", function () {
    expect(res.getStatus()).to.equal(404);
  });
}
```

- [ ] **Step 7: Crear `Reactivate without a token returns 401.bru`**

```bru
meta {
  name: Reactivate without a token returns 401
  type: http
  seq: 27
  tags: [
    Event_Programs
  ]
}

post {
  url: {{baseUrl}}/api/v1/event-programs/{{archivedProgramId}}/reactivate
  auth: none
}

tests {
  test("reactivation requires authentication", function () {
    expect(res.getStatus()).to.equal(401);
  });
}
```

- [ ] **Step 8: Crear `Reactivate as a user without permission returns 403.bru`**

```bru
meta {
  name: Reactivate as a user without permission returns 403
  type: http
  seq: 28
  tags: [
    Event_Programs
  ]
}

post {
  url: {{baseUrl}}/api/v1/event-programs/{{archivedProgramId}}/reactivate
  auth: bearer
}

auth:bearer {
  token: {{userToken}}
}

tests {
  test("program:reactivate is required", function () {
    expect(res.getStatus()).to.equal(403);
  });
}
```

- [ ] **Step 9: Correr la carpeta**

```bash
pnpm --dir bruno exec bru run Event_Programs --env local
```

Resultado esperado: 28/28 requests y 25/25 tests en verde. Nota: los logins comparten el bucket de 5/min; si una corrida previa lo agoto, esperar 60 s. La corrida deja un programa temporal `TMP-F4.4` (no hay `DELETE` de programas); limpiarlo por psql al final de la sesion.

---

### Task 7: E2E real con Docker + psql

**Files:**

- Create temporal: `/tmp/opencode/f44-e2e.mjs` (se elimina al final)

- [ ] **Step 1: Confirmar el stack, sembrar el permiso nuevo y el baseline**

```bash
docker ps --format '{{.Names}}'
pnpm run prisma:seed:base
docker exec sipeg-utp-dev-db-1 psql -U sipeg -d sipeg_utp -t -A -c "SELECT COUNT(*) FROM permissions;"
docker exec sipeg-utp-dev-db-1 psql -U sipeg -d sipeg_utp -t -A -c "SELECT COUNT(*) || '|' || COUNT(*) FILTER (WHERE is_default) FROM event_programs;"
```

Baseline esperado: `20` permisos (19 previos + `program:reactivate`), programas `16|11` (u otro conteo si hay residuos de sesiones previas; registrar el valor).

- [ ] **Step 2: Escribir y correr el script E2E**

Contenido de `/tmp/opencode/f44-e2e.mjs`:

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
const head = await login('organizador.fisc@utp.ac.pa', 'Sipeg2026*UTP');

// 1) Permiso nuevo en el catalogo.
const permissionRow = psql(`SELECT COUNT(*) FROM permissions WHERE name = 'program:reactivate';`);
check('program:reactivate is in the permission catalog', permissionRow === '1', permissionRow);

// 2) Programa temporal creado en DRAFT.
const created = await api('POST', '/event-programs', {
  token: admin,
  body: {
    name: `TMP-F4.4 ${Date.now()}`,
    organizationalUnitId: 'seed_unit_fic',
    startDate: '2026-12-01',
    endDate: '2026-12-05',
  },
});
check(
  'temporary program created as DRAFT',
  created.status === 201 && created.body?.data?.status === 'DRAFT',
  `status=${created.status}`,
);
const tempId = created.body.data.id;

// 3) Reactivar un DRAFT -> 409.
const draftReactivation = await api('POST', `/event-programs/${tempId}/reactivate`, {
  token: admin,
});
check(
  'reactivating a draft program returns 409',
  draftReactivation.status === 409 &&
    draftReactivation.body?.message === 'Only archived event programs can be reactivated.',
  `status=${draftReactivation.status} message=${draftReactivation.body?.message}`,
);

// 4) Archivar el temporal.
const archive = await api('POST', `/event-programs/${tempId}/archive`, { token: admin });
const archivedAt = psql(`SELECT archived_at::text FROM event_programs WHERE id = '${tempId}';`);
check(
  'temporary program archived',
  archive.status === 200 &&
    archive.body?.data?.status === 'ARCHIVED' &&
    archivedAt !== 'NULL' &&
    archivedAt !== '',
  `status=${archive.status} archived_at=${archivedAt}`,
);

// 5) Reactivar -> 200 ACTIVE y archived_at NULL en psql.
const reactivated = await api('POST', `/event-programs/${tempId}/reactivate`, { token: admin });
const stateAfter = psql(
  `SELECT status || '|' || COALESCE(archived_at::text, 'NULL') FROM event_programs WHERE id = '${tempId}';`,
);
check(
  'reactivating returns 200 ACTIVE and clears archived_at',
  reactivated.status === 200 &&
    reactivated.body?.message === 'Event program reactivated successfully.' &&
    reactivated.body?.data?.status === 'ACTIVE' &&
    stateAfter === 'ACTIVE|NULL',
  `status=${reactivated.status} state=${stateAfter}`,
);

// 6) El programa reactivado vuelve a ser publico.
const publicGet = await api('GET', `/event-programs/${tempId}`);
check(
  'reactivated program is public again',
  publicGet.status === 200 && publicGet.body?.data?.status === 'ACTIVE',
  `status=${publicGet.status}`,
);

// 7) Segundo intento -> 409.
const again = await api('POST', `/event-programs/${tempId}/reactivate`, { token: admin });
check(
  'reactivating an active program returns 409',
  again.status === 409 &&
    again.body?.message === 'Only archived event programs can be reactivated.',
  `status=${again.status}`,
);

// 8) Predeterminado -> 409 especifico.
const defaultProgram = await api('POST', '/event-programs/seed_program_fic_default/reactivate', {
  token: admin,
});
check(
  'default programs cannot be reactivated individually',
  defaultProgram.status === 409 &&
    defaultProgram.body?.message === 'Only additional event programs can be reactivated.',
  `status=${defaultProgram.status} message=${defaultProgram.body?.message}`,
);

// 9) Adicional ACTIVO -> 409.
const activeCheck = await api('POST', '/event-programs/seed_program_congreso-cit/reactivate', {
  token: admin,
});
check(
  'active additional programs cannot be reactivated',
  activeCheck.status === 409 &&
    activeCheck.body?.message === 'Only archived event programs can be reactivated.',
  `status=${activeCheck.status}`,
);

// 10) Error cases: 404, 401 y 403 (USER y ORGANIZER).
const unknown = await api('POST', '/event-programs/program-does-not-exist/reactivate', {
  token: admin,
});
check('unknown program returns 404', unknown.status === 404, `status=${unknown.status}`);
const noToken = await api('POST', `/event-programs/${tempId}/reactivate`);
check(
  'reactivation without a token returns 401',
  noToken.status === 401,
  `status=${noToken.status}`,
);
const forbiddenUser = await api('POST', `/event-programs/${tempId}/reactivate`, {
  token: student,
});
check(
  'USER without permission returns 403',
  forbiddenUser.status === 403,
  `status=${forbiddenUser.status}`,
);
const forbiddenHead = await api('POST', `/event-programs/${tempId}/reactivate`, {
  token: head,
});
check(
  'ORGANIZER without the permission returns 403',
  forbiddenHead.status === 403,
  `status=${forbiddenHead.status}`,
);

// 11) Limpieza total.
psql(
  `BEGIN; ALTER TABLE event_programs DISABLE TRIGGER event_programs_prevent_delete; DELETE FROM activities WHERE event_program_id = '${tempId}'; DELETE FROM event_programs WHERE id = '${tempId}'; ALTER TABLE event_programs ENABLE TRIGGER event_programs_prevent_delete; COMMIT;`,
);
const remaining = psql(`SELECT COUNT(*) FROM event_programs WHERE id = '${tempId}';`);
check('temporary program removed', remaining === '0', remaining);

const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
```

Ejecutar:

```bash
node /tmp/opencode/f44-e2e.mjs
```

Resultado esperado: todos los checks en `PASS` y exit code 0.

- [ ] **Step 3: Eliminar el script temporal**

```bash
rm /tmp/opencode/f44-e2e.mjs
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

1. Tabla "Estado actual": cambiar la fila de Programas a `Parcial: 4.1-4.4 implementados; faltan 4.5-4.7` y anadir "reactivacion" al area.
2. Lista de endpoints existentes: agregar `POST /event-programs/:id/reactivate` despues de `POST /event-programs/:id/archive`.
3. Marcar `- [x] **4.4 Reactivar programa ...**`.
4. Agregar el bloque de registro despues del registro de 4.3 y antes de `**Criterio de salida:**`:

```md
**Registro de ejecucion (2026-09-21 - 4.4):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-21-fase-4-4-reactivar-programa.md` con ciclo TDD rojo/verde en catalogo (1 prueba), servicio (9), rutas (7) y contrato OpenAPI (1 nueva).
- [x] Implementacion: `reactivateEventProgram(id)` con guardas `404` / `409` predeterminado / `409` no archivado / `400` fechas incoherentes y `update { status: 'ACTIVE', archivedAt: null }`; select `eventProgramLifecycleSelect` reutilizado con archive; ruta `POST /api/v1/event-programs/:id/reactivate` con `authenticate -> requirePermission(program:reactivate, scope) -> validate(params) -> controlador`.
- [x] Decisiones confirmadas: destino `ACTIVE` validando solo coherencia de fechas (sin regla de vencimiento), permiso nuevo `program:reactivate` fuera de `ROLE_DEFAULTS` (solo ADMIN u OVERRIDE), `409` para cualquier estado distinto de `ARCHIVED` y sin guarda de unidad activa.
- [x] Pruebas: (completar con el total real de `pnpm test` y archivos) + gates `typecheck`, `lint`, `build`, `format:check`, `docs:generate` y `docs:check`.
- [x] Verificacion real (stack Docker dev, seed demo): (completar con el resultado del E2E).
- [x] Bruno: (completar con requests/tests y resultado de `bru run Event_Programs --env local`).
- [x] Contrato: `openapi.json` regenerado sin drift; operacion `POST`, path param `id`, respuestas 200/400/401/403/404/409 y componente `EventProgramDetail` reutilizado; enum de permisos con `program:reactivate`.
- [x] Documentacion: README y CONTEXT describen el endpoint, sus guardas y la ausencia de idempotencia.
- [x] Sin migraciones, dependencias ni variables de entorno nuevas. Sin commit: el usuario no lo solicito.
```

Completar los `(completar ...)` con la evidencia real antes de cerrar la fase.

---

## Self-review del plan

- **Cobertura del item 4.4:** "solo adicionales archivados" (guarda `isDefault` + `status !== 'ARCHIVED'`), "validar rango de fechas" (existen y `startDate <= endDate`), permiso nuevo, contrato, Bruno y E2E cubiertos.
- **Sin placeholders:** todo el codigo de produccion y de pruebas esta completo; los `(completar ...)` del registro del plan maestro dependen de la ejecucion.
- **Consistencia de tipos:** `reactivateEventProgram(id: string): Promise<EventProgramDetail>`, el mock de rutas incluye `reactivateEventProgram`, y la prueba de contrato usa la misma ruta `/api/v1/event-programs/{id}/reactivate`.
- **Riesgos conocidos:** no hay idempotencia (decision de producto); la reactivacion bajo unidad inactiva es intencional; Bruno deja un programa temporal por corrida (no existe `DELETE` de programas hasta 4.7).
