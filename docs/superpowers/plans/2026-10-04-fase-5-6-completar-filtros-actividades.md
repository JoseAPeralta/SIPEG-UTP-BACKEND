# Fase 5.6 - Completar filtros del listado de actividades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extender `GET /api/v1/activities` con filtros de proximas/pasadas, programa, unidad, tipo de unidad, tipo de actividad, aula, rango de fechas y estado, con paginacion, preservando el listado publico y su visibilidad.

**Architecture:** El modulo autocontenido `src/modules/activities/` agrega `optionalAuthenticate` a la ruta publica y campos al `listActivitiesQuerySchema`. El servicio `listActivities(query, viewer, now)` resuelve el conjunto de estados segun el actor (publico vs `ADMIN`), arma el rango de fecha institucional y combina los filtros con AND. `ActivityListItem` gana `status`. Sin migraciones, permisos, variables de entorno ni endpoints nuevos.

**Tech Stack:** TypeScript 6, Express 5, Prisma 7 (SQL/Postgres), Zod 4, Vitest, Supertest, OpenAPI 3.1 (zod-openapi), Bruno.

**Estado de partida (2026-10-04):**

- `GET /api/v1/activities` es publico (solo `validate`), acepta `page`/`limit` y `listUpcomingActivities` fija `status ∈ {SCHEDULED,ONGOING}`, `eventProgram.status='ACTIVE'`, `date >= startOfInstitutionalDay(now)`.
- `optionalAuthenticate` vive en `src/middlewares/optionalAuthenticate.middleware.ts` y ya se usa en `GET /event-programs` (4.5) y `GET /event-programs/:id` (4.1).
- El patron 4.5/4.6 ya resolvio `status` solo para `ADMIN` con `200` silencioso para el resto, y la convivencia de un `ZodObject` para OpenAPI mas un `.refine()` para validacion.
- `activitySelect`/`toActivityListItem` se comparten con `GET /event-programs/:id/activities`, que ya devuelve `status` (`EventProgramActivityItem`).
- La carpeta Bruno `Activities/List upcoming activities.bru` ya asertaba `activity.status` de forma vacua (el campo no existia); ahora pasara a ser real.

**Decisiones de diseno (2026-10-04, confirmadas con el usuario):**

1. Se extiende `GET /api/v1/activities`; no se crea endpoint nuevo.
2. `ActivityListItem` expone `status`; `EventProgramActivityItem` se conserva por compatibilidad (mismo shape).
3. `when=upcoming|past|all`, default `upcoming`. El publico ve `SCHEDULED|ONGOING|COMPLETED`; solo `ADMIN` ve `DRAFT|CANCELLED` y puede usar `status`.
4. El listado global siempre restringe a programas `ACTIVE`, incluso `ADMIN`. Las actividades de programas no `ACTIVE` siguen accesibles por `GET /event-programs/:id/activities`.
5. No se agrega busqueda `q`.

**Reglas de negocio:**

- Estados: `ADMIN` con `status` distinto de `ALL` -> `[status]`; `ADMIN` con `ALL` -> los cinco estados; cualquier otro actor (o sin `status`) -> `[SCHEDULED, ONGOING, COMPLETED]`. Un `status` no publico enviado por no-admin se ignora en silencio (`200`); un valor fuera del enum responde `400` (Zod).
- Fecha: `when=upcoming` -> cota inferior `gte` el inicio del dia institucional de hoy; `when=past` -> cota superior `lte` el inicio del dia institucional de ayer (inclusive) y orden `date desc`; `when=all` -> sin cota. `dateFrom`/`dateTo` intersecan con `max`/`min` (inferior = la mayor, superior = la menor). `dateFrom > dateTo` -> `400`.
- Programa: `eventProgram: { status:'ACTIVE', ...(organizationalUnitId), ...(unitType) }`; ademas `eventProgramId`, `type` y `classroomId` como igualdades.
- Auth opcional nueva en la ruta: Bearer invalido/vencido -> `401`; cuenta desactivada -> `403`; sin header el listado sigue publico.
- Orden: `upcoming`/`all` -> `[date asc, startTime asc, id asc]`; `past` -> `[date desc, startTime desc, id asc]`.

---

### Task 1: Esquema de query y `status` en el item (TDD)

**Files:**

- Modify: `src/modules/activities/activities.schemas.ts:11-29,125-178`
- Test: `src/modules/activities/activities.schemas.test.ts:18-135,588-603`

- [x] **Step 1: Escribir las pruebas que fallan**

En `activities.schemas.test.ts`:

1. Agregar `status: 'SCHEDULED'` al objeto `activityPayload` (linea 48) para que `activityListItemSchema` lo acepte.
2. Dentro de `describe('listActivitiesQuerySchema')`, reemplazar `rejects unknown query parameters` (usa `sort`, que sigue siendo desconocido) y agregar:

```ts
it('defaults when to upcoming and keeps the other filters optional', () => {
  const parsed = listActivitiesQuerySchema.parse({ query: {} });

  expect(parsed.query).toEqual({ page: 1, limit: 20 });
});

it('accepts every when value and every public filter', () => {
  const parsed = listActivitiesQuerySchema.parse({
    query: {
      when: 'past',
      eventProgramId: 'program-001',
      organizationalUnitId: 'unit-001',
      unitType: 'FACULTY',
      type: 'SEMINAR',
      classroomId: 'classroom-001',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
      status: 'CANCELLED',
    },
  });

  expect(parsed.query).toMatchObject({
    when: 'past',
    eventProgramId: 'program-001',
    organizationalUnitId: 'unit-001',
    unitType: 'FACULTY',
    type: 'SEMINAR',
    classroomId: 'classroom-001',
    dateFrom: '2026-09-01',
    dateTo: '2026-09-30',
    status: 'CANCELLED',
  });
});

it('rejects an invalid when, status, unit type, activity type or date', () => {
  expect(() => listActivitiesQuerySchema.parse({ query: { when: 'later' } })).toThrow();
  expect(() => listActivitiesQuerySchema.parse({ query: { status: 'PENDING' } })).toThrow();
  expect(() => listActivitiesQuerySchema.parse({ query: { unitType: 'CAMPUS' } })).toThrow();
  expect(() => listActivitiesQuerySchema.parse({ query: { type: 'WEBINAR' } })).toThrow();
  expect(() => listActivitiesQuerySchema.parse({ query: { dateFrom: '2026-02-30' } })).toThrow();
});

it('rejects a range that starts after it ends', () => {
  const result = listActivitiesQuerySchema.safeParse({
    query: { dateFrom: '2026-10-01', dateTo: '2026-09-01' },
  });

  expect(result.success).toBe(false);
});
```

3. En `describe('activityListItemSchema')`, agregar:

```ts
it('exposes the lifecycle status', () => {
  expect(activityListItemSchema.parse(activityPayload).status).toBe('SCHEDULED');
  expect(activityListItemSchema.safeParse({ ...activityPayload, status: 'PENDING' }).success).toBe(
    false,
  );
});
```

- [x] **Step 2: Correr las pruebas y verificar el rojo**

```bash
pnpm exec vitest run src/modules/activities/activities.schemas.test.ts
```

Resultado esperado: fallan las pruebas nuevas porque `when`/`status`/`unitType`/`type`/`classroomId`/`dateFrom`/`dateTo` son claves desconocidas (objeto estricto) y `activityListItemSchema` no exige `status`.

- [x] **Step 3: Implementar el esquema**

En `activities.schemas.ts`:

- Definir cerca del inicio:

```ts
const activityStatusSchema = z.enum(
  ['DRAFT', 'SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED'],
  'Status is invalid.',
);
const activityTypeSchema = z.enum(
  ['WORKSHOP', 'SEMINAR', 'TALK', 'CONFERENCE', 'PANEL', 'COURSE', 'COMPETITION', 'OTHER'],
  'Type is invalid.',
);
```

- Reemplazar `listActivitiesQuerySchema` por:

```ts
export const activitiesListQuerySchema = z
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
    when: z.enum(['upcoming', 'past', 'all'], 'When is invalid.').optional(),
    eventProgramId: z
      .string()
      .trim()
      .min(1, 'Event program is invalid.')
      .max(100, 'Event program cannot exceed 100 characters.')
      .optional(),
    organizationalUnitId: z
      .string()
      .trim()
      .min(1, 'Organizational unit is invalid.')
      .max(100, 'Organizational unit cannot exceed 100 characters.')
      .optional(),
    unitType: z.enum(['FACULTY', 'SUBDIRECTORATE'], 'Unit type is invalid.').optional(),
    type: activityTypeSchema.optional(),
    classroomId: z
      .string()
      .trim()
      .min(1, 'Classroom is invalid.')
      .max(100, 'Classroom cannot exceed 100 characters.')
      .optional(),
    dateFrom: z
      .string()
      .regex(datePattern, 'Date from must be in YYYY-MM-DD format.')
      .refine(isValidCalendarDate, 'Date from must be a valid calendar date.')
      .optional(),
    dateTo: z
      .string()
      .regex(datePattern, 'Date to must be in YYYY-MM-DD format.')
      .refine(isValidCalendarDate, 'Date to must be a valid calendar date.')
      .optional(),
    status: z
      .enum(
        ['DRAFT', 'SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED', 'ALL'],
        'Status is invalid.',
      )
      .optional(),
  })
  .strict();

export const listActivitiesQuerySchema = z.object({
  query: activitiesListQuerySchema.refine(
    (value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo,
    { message: 'dateFrom cannot be after dateTo.', path: ['dateTo'] },
  ),
});

export type ListActivitiesQuery = z.infer<typeof activitiesListQuerySchema>;
```

Nota: `datePattern`/`isValidCalendarDate` ya existen mas abajo en el archivo; hay que moverlos arriba o dejar el esquema despues de su definicion. Alternativa simple: mover el bloque de `datePattern`/`isValidCalendarDate` antes de `activitiesListQuerySchema`.

- En `activityListItemSchema`, anadir `status`:

```ts
export const activityListItemSchema = z
  .object({ ...activityListItemShape, status: activityStatusSchema })
  .meta({
    id: 'ActivityListItem',
    description: 'Activity summary with its lifecycle status.',
  }) satisfies z.ZodType<ActivityListItem>;
```

- `eventProgramActivityItemSchema` puede reusar `activityStatusSchema` para su `status`.

- [x] **Step 4: Correr las pruebas y verificar el verde**

```bash
pnpm exec vitest run src/modules/activities/activities.schemas.test.ts
```

---

### Task 2: Tipos (TDD)

**Files:**

- Modify: `src/modules/activities/activities.types.ts:50-68`
- Test: cubierto por el typecheck de la Task 1 (los tests importan los esquemas con `satisfies z.ZodType<...>`).

- [x] **Step 1: Implementar**

En `activities.types.ts` agregar `status: ActivityStatus;` a `ActivityListItem` y simplificar `EventProgramActivityItem` a `export type EventProgramActivityItem = ActivityListItem;` (mismo shape).

---

### Task 3: Servicio `listActivities(query, viewer, now)` (TDD)

**Files:**

- Modify: `src/modules/activities/activities.service.ts:30-311`
- Test: `src/modules/activities/activities.service.test.ts:88-180,1434-1600`

- [x] **Step 1: Escribir las pruebas que fallan**

En `activities.service.test.ts` (usa el `createPrismaMock` existente con `activity.findMany`/`count`):

1. Actualizar `queries upcoming active activities with pagination` para reflejar el set publico y el `status` en el resultado:

```ts
expect(prisma.activity.findMany).toHaveBeenCalledWith(
  expect.objectContaining({
    where: {
      status: { in: ['SCHEDULED', 'ONGOING', 'COMPLETED'] },
      eventProgram: { status: 'ACTIVE' },
      date: { gte: new Date('2026-09-19T00:00:00.000Z') },
    },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
    skip: 20,
    take: 20,
  }),
);
```

2. Agregar pruebas nuevas:

```ts
it('filters past activities with an inclusive upper bound and descending order', async () => {
  const prisma = createPrismaMock();
  prisma.activity.findMany.mockResolvedValue([]);
  prisma.activity.count.mockResolvedValue(0);
  const { listActivities } = await loadService(prisma);

  await listActivities({ page: 1, limit: 20, when: 'past' }, null, NOW);

  expect(prisma.activity.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ['SCHEDULED', 'ONGOING', 'COMPLETED'] },
        date: { lte: new Date('2026-09-18T00:00:00.000Z') },
      }),
      orderBy: [{ date: 'desc' }, { startTime: 'desc' }, { id: 'asc' }],
    }),
  );
});

it('drops the date boundary when when is all', async () => {
  const prisma = createPrismaMock();
  prisma.activity.findMany.mockResolvedValue([]);
  prisma.activity.count.mockResolvedValue(0);
  const { listActivities } = await loadService(prisma);

  await listActivities({ page: 1, limit: 20, when: 'all' }, null, NOW);

  const where = prisma.activity.findMany.mock.calls[0]?.[0]?.where;
  expect(where).not.toHaveProperty('date');
});

it('intersects when with an explicit date range', async () => {
  const prisma = createPrismaMock();
  prisma.activity.findMany.mockResolvedValue([]);
  prisma.activity.count.mockResolvedValue(0);
  const { listActivities } = await loadService(prisma);

  await listActivities(
    { page: 1, limit: 20, when: 'upcoming', dateFrom: '2026-12-01', dateTo: '2026-12-31' },
    null,
    NOW,
  );

  expect(prisma.activity.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        date: {
          gte: new Date('2026-12-01T00:00:00.000Z'),
          lte: new Date('2026-12-31T00:00:00.000Z'),
        },
      }),
    }),
  );
});

it('applies the program, unit, type and classroom filters', async () => {
  const prisma = createPrismaMock();
  prisma.activity.findMany.mockResolvedValue([]);
  prisma.activity.count.mockResolvedValue(0);
  const { listActivities } = await loadService(prisma);

  await listActivities(
    {
      page: 1,
      limit: 20,
      when: 'all',
      eventProgramId: 'program-001',
      organizationalUnitId: 'unit-001',
      unitType: 'FACULTY',
      type: 'SEMINAR',
      classroomId: 'classroom-001',
    },
    null,
    NOW,
  );

  expect(prisma.activity.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        eventProgramId: 'program-001',
        type: 'SEMINAR',
        classroomId: 'classroom-001',
        eventProgram: {
          status: 'ACTIVE',
          organizationalUnitId: 'unit-001',
          organizationalUnit: { type: 'FACULTY' },
        },
      }),
    }),
  );
});

it('lets an admin filter a non public status and ALL', async () => {
  const prisma = createPrismaMock();
  prisma.activity.findMany.mockResolvedValue([]);
  prisma.activity.count.mockResolvedValue(0);
  const { listActivities } = await loadService(prisma);

  await listActivities({ page: 1, limit: 20, when: 'all', status: 'DRAFT' }, adminViewer, NOW);
  expect(prisma.activity.findMany.mock.calls[0]?.[0]?.where?.status).toEqual({ in: ['DRAFT'] });

  await listActivities({ page: 1, limit: 20, when: 'all', status: 'ALL' }, adminViewer, NOW);
  expect(prisma.activity.findMany.mock.calls[1]?.[0]?.where?.status).toEqual({
    in: ['DRAFT', 'SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED'],
  });
});

it('ignores a non public status filter for non admins', async () => {
  const prisma = createPrismaMock();
  prisma.activity.findMany.mockResolvedValue([]);
  prisma.activity.count.mockResolvedValue(0);
  const { listActivities } = await loadService(prisma);

  await listActivities({ page: 1, limit: 20, when: 'all', status: 'DRAFT' }, regularViewer, NOW);

  expect(prisma.activity.findMany.mock.calls[0]?.[0]?.where?.status).toEqual({
    in: ['SCHEDULED', 'ONGOING', 'COMPLETED'],
  });
});
```

Definir `adminViewer`/`regularViewer` como `Express.AuthenticatedUser` (patron de 4.5) si no existen ya en el archivo.

- [x] **Step 2: Correr y verificar el rojo**

```bash
pnpm exec vitest run src/modules/activities/activities.service.test.ts -t "listActivities"
```

- [x] **Step 3: Implementar**

En `activities.service.ts`:

- Agregar `status: true` a `activitySelect` y `status: ActivityStatus` a `ActivityRecord`; mapear `status` en `toActivityListItem`.
- Eliminar `programActivitySelect` y `toProgramActivityItem`; en `listEventProgramActivities` usar `activitySelect` y `toActivityListItem`.
- Renombrar `listUpcomingActivities` a `listActivities(query, viewer = null, now = new Date())`.
- Implementar la logica de estados/fechas/filtros descrita en "Reglas de negocio". Usar `PROGRAM_PUBLIC_ACTIVITY_STATUSES` y `ALL_ACTIVITY_STATUSES` ya existentes.
- Mantener el contrato de retorno `PaginatedActivities`.

- [x] **Step 4: Correr y verificar el verde**

```bash
pnpm exec vitest run src/modules/activities/activities.service.test.ts
```

---

### Task 4: Ruta y controlador (TDD)

**Files:**

- Modify: `src/modules/activities/activities.routes.ts:34`, `src/modules/activities/activities.controller.ts:25-30`
- Test: `src/modules/activities/activities.routes.test.ts:222-...`

- [x] **Step 1: Escribir las pruebas que fallan**

En `activities.routes.test.ts`:

```ts
it('forwards the list query and the optional viewer', async () => {
  service.listActivities.mockResolvedValue({
    items: [],
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });

  await request(app)
    .get('/api/v1/activities?when=past&type=SEMINAR&status=DRAFT')
    .set('Authorization', 'Bearer valid-token')
    .expect(200);

  expect(service.listActivities).toHaveBeenCalledWith(
    expect.objectContaining({ when: 'past', type: 'SEMINAR', status: 'DRAFT' }),
    expect.objectContaining({ id: 'user-001' }),
  );
});

it('rejects an invalid token on the public list', async () => {
  await request(app).get('/api/v1/activities').set('Authorization', 'Bearer broken').expect(401);
  expect(service.listActivities).not.toHaveBeenCalled();
});
```

Ajustar el mock del servicio: renombrar `listUpcomingActivities` a `listActivities` en el `vi.mock` y en `beforeEach`.

- [x] **Step 2: Rojo**

```bash
pnpm exec vitest run src/modules/activities/activities.routes.test.ts -t "list"
```

- [x] **Step 3: Implementar**

- `activities.routes.ts:34`:

```ts
activitiesRoutes.get(
  '/activities',
  optionalAuthenticate,
  validate(listActivitiesQuerySchema),
  getActivities,
);
```

- `activities.controller.ts`: importar `listActivities` y llamar `listActivities(query, req.user ?? null)`.

- [x] **Step 4: Verde**

```bash
pnpm exec vitest run src/modules/activities/activities.routes.test.ts
```

---

### Task 5: OpenAPI y contrato

**Files:**

- Modify: `src/modules/activities/activities.openapi.ts:22-39`, `src/docs/openapi.test.ts:131-135,411-417`

- [x] **Step 1: Implementar**

- En `activities.openapi.ts`, importar `activitiesListQuerySchema` y usarlo en `requestParams.query` (el `ZodObject`, no el refinado). Actualizar `summary`/`description` para describir `when`, los filtros, la visibilidad publica vs `ADMIN` y el `200` silencioso. Agregar respuestas `401` y `403`.
- En `src/docs/openapi.test.ts`:
  - Extender `documents the activity pagination query parameters` con los nombres nuevos.
  - Agregar una prueba que verifique `status` en `ActivityListItem` y las respuestas `401`/`403` del `GET`.

- [x] **Step 2: Verificar**

```bash
pnpm exec vitest run src/docs/openapi.test.ts
pnpm run docs:generate
pnpm run docs:check
```

---

### Task 6: Bruno y documentacion

**Files:**

- Modify: `bruno/Activities/List upcoming activities.bru`, `bruno/Activities/folder.bru`, `README.md:336`, `CONTEXT.md:165`
- Create: requests nuevos en `bruno/Activities/`

- [x] **Step 1: Actualizar `List upcoming activities.bru`**

- Anadir `when: upcoming` a `params:query` y a los ejemplos.
- Agregar `status` al ejemplo 200.
- Mantener las aserciones de no `DRAFT` y no codigos de check-in (ahora reales).

- [x] **Step 2: Requests nuevos**

Agregar requests (con `seq` unicos y ascendentes) para: `when=past`, `eventProgramId`, `organizationalUnitId`, `unitType`, `type`, `classroomId`, rango de fechas, `status=DRAFT` como admin, `status=PENDING` `400`, token invalido `401`. Usar `X-Forwarded-For` propio en logins para no agotar el bucket de 5/min.

- [x] **Step 3: README/CONTEXT**

Documentar en ambos el listado completo: `when`, filtros, visibilidad publica vs `ADMIN`, `200` silencioso, `400`/`401`/`403`.

---

### Task 7: Gates y verificacion real

- [x] `pnpm test`
- [x] `pnpm run typecheck`
- [x] `pnpm run lint`
- [x] `pnpm run build`
- [x] `pnpm run format:check`
- [x] `pnpm run docs:generate` + `pnpm run docs:check`
- [x] `pnpm run prisma:validate` + `pnpm run prisma:migrate:status` (sin cambios de schema)
- [x] `bru run Activities --env local`
- [x] Verificacion E2E con Docker + psql: contrastar `when=upcoming|past|all`, cada filtro, `status` admin vs no-admin, `400`/`401`/`403`, y confirmar cero escrituras. Limpiar residuos con `pnpm run prisma:cleanup:dev -- --pattern='Actividad temporal%' --apply`.

**Fuera de alcance:** `q`, resolver estados temporales (5.7), validaciones de `POST` (5.8), permisos/migraciones/env nuevas.

---

## Registro de ejecucion (2026-10-04)

- [x] Ciclo TDD rojo/verde en esquemas (7 pruebas nuevas/actualizadas), servicio (8), rutas (4) y contrato OpenAPI (2). Baseline previo: `pnpm test` 1504 en 70 archivos (1 omitido) al cierre.
- [x] Implementacion: `activitiesListQuerySchema` (ZodObject estricto con `when`, `eventProgramId`, `organizationalUnitId`, `unitType`, `type`, `classroomId`, `dateFrom`, `dateTo`, `status`) mas `listActivitiesQuerySchema` refinado (`dateFrom <= dateTo`); `ActivityListItem` gana `status` y `EventProgramActivityItem` pasa a alias; `listActivities(query, viewer, now)` resuelve el set de estados (publico vs `ADMIN`), el rango de fecha con `max`/`min` y ordena `past` descendente; `optionalAuthenticate` en la ruta; `listEventProgramActivities` reutiliza `activitySelect`/`toActivityListItem` (se elimino `programActivitySelect`/`toProgramActivityItem`).
- [x] Pruebas: `pnpm test` 1504 en 70 archivos (1 omitido, 7 skip de auditoria sin `AUDIT_TEST_DATABASE_URL`) en verde; `typecheck`, `lint`, `build`, `docs:generate` y `docs:check` en verde. `format:check` global solo reporta 3 archivos ajenos preexistentes (`compose.prod.yaml`, `docs/despliegue.md`, `src/modules/auth/auth.cookie.test.ts`); todos los archivos de 5.6 y el plan quedan formateados.
- [x] Contrato: `openapi.json` regenerado sin drift; el `GET /api/v1/activities` documenta los 11 parametros, `security` ausente, respuestas 200/400/401/403, y `ActivityListItem` expone `status`. Sin migraciones, permisos, dependencias ni variables de entorno nuevas.
- [x] Verificacion real (stack Docker dev, seed demo, contenedor recargado con `docker cp` + `restart` por el bind mount congelado): 21/21 checks con admin y `estudiante01`. `when=upcoming` (fechas >= hoy, set publico), `past` (fechas <= ayer, descendente), `all`; filtros `eventProgramId`/`organizationalUnitId`/`unitType`/`type`/`classroomId`/rango de fechas; admin `status=DRAFT` y `status=ALL` (incluye `DRAFT` y `CANCELLED`), `estudiante01` con `status=DRAFT` recibe el set publico; `400` por status y rango invalidos; `401` por token invalido; `403 Account is disabled.` con la cuenta `estudiante01` desactivada por SQL y restaurada; `activities` 40 -> 40 (cero escrituras).
- [x] Bruno: `List upcoming activities` con `when` y `status` real, mas 10 requests nuevos (past, programa, unidad+tipo, tipo, aula, rango, `status=DRAFT` admin, status invalido 400, rango invalido 400, token invalido 401) con `seq` 39-48; `bru run Activities --env local` 48/48 requests y 51/51 tests en verde. Residuo de la corrida purgado con `pnpm run prisma:cleanup:dev -- --pattern='Actividad temporal%' --apply` (1 actividad) y `ana.prueba@utp.ac.pa` borrado del catalogo (40 actividades restauradas).
- [x] Documentacion: README y CONTEXT describen los filtros, la semantica `when`, la visibilidad publica vs `ADMIN`, el `200` silencioso y los `400`/`401`/`403`.
- [x] Hallazgo de entorno `F5.6-A` (mismo que `F5.5-A`): el bind mount de Docker Desktop/WSL sigue congelado; la verificacion requirio `docker cp` de los 6 archivos tocados mas `docker compose -f compose.dev.yaml restart api`. Sin commit: el usuario no lo solicito.
