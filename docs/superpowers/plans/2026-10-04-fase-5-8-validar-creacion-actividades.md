# Fase 5.8 - Validar creacion de actividades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar a `POST /activities` las mismas validaciones de aula y horario que ya aplica `PATCH /activities/:id`, reutilizando los helpers de `activities.schedule.ts`, y cerrar la Fase 5 (P5 y P6 del plan maestro).

**Architecture:** `createActivity` reemplaza el chequeo inline de aula por `assertClassroomIsAssignable`/`assertActivityScheduleIsAvailable`; el helper acepta crear sin `activityId` (no excluye ninguna actividad del chequeo de solape). Se anade `409` al contrato OpenAPI del POST y se documentan las reglas. Sin migraciones, permisos, dependencias ni variables de entorno nuevas.

**Tech Stack:** TypeScript, Express 5, Prisma 7 (Postgres), Zod 4, Vitest, Supertest, Bruno, Docker Compose.

**Decisiones confirmadas (2026-10-04):**

1. Alcance 5.8: validacion completa al crear con aula. `POST /activities` responde `404`/`400` por aula, `400` por capacidad, `409` por ventana y `409` por solape, con los mismos mensajes que `PATCH`.
2. La creacion sigue siendo siempre `DRAFT`; el chequeo de solape solo considera actividades `SCHEDULED`/`ONGOING`, igual que la reserva real.

**Hallazgos de partida:**

- `createActivity` (`activities.service.ts:459-471`) valida aula existe/activa inline y no aplica ventana/solape/capacidad (`F5.5-B`).
- `assertActivityScheduleIsAvailable` exige `activityId` obligatorio para excluir la propia actividad del chequeo de solape; en creacion no existe id todavia.
- El contrato OpenAPI del POST no declara `409` aunque ya declara `400/401/403/404/500`.
- Baseline previo al trabajo (2026-10-04, 5.6/5.7 sin commitear): `pnpm test` 1530 en 70 archivos + 1 omitido (7 skip de auditoria), `typecheck`, `lint`, `build` y `docs:check` en verde.

**Reglas que no cambian:**

- Orden de errores en creacion: `404 Event program not found.` -> `400 Activities can only be created in an active event program.` -> `400 Activity date must be within the event program date range.` -> `400 End time must be after start time.` -> `404 Classroom not found.` -> `400 Classroom is not active.` -> `400 Classroom capacity is below the activity capacity.` -> `409 Classroom is not available in the requested time window.` -> `409 Classroom is already reserved for an overlapping activity.`
- La actividad se persiste en `DRAFT` con su evento de auditoria `activity.created` dentro de la transaccion, sin escrituras cuando una validacion falla.

**File structure:**

- Modify: `src/modules/activities/activities.schedule.ts`
- Modify: `src/modules/activities/activities.schedule.test.ts`
- Modify: `src/modules/activities/activities.service.ts`
- Modify: `src/modules/activities/activities.service.test.ts`
- Modify: `src/modules/activities/activities.openapi.ts`
- Modify: `src/docs/openapi.test.ts`
- Modify: `openapi.json` (generado)
- Create: `bruno/Activities/Create an activity with a capacity above the classroom returns 400.bru`
- Create: `bruno/Activities/Create an activity outside the classroom window returns 409.bru`
- Create: `bruno/Activities/Create a reserving activity for the overlap check.bru`
- Create: `bruno/Activities/Publish the reserving activity.bru`
- Create: `bruno/Activities/Create an overlapping activity returns 409.bru`
- Create: `bruno/Activities/Unpublish the reserving activity.bru`
- Create: `bruno/Activities/Delete the reserving activity.bru`
- Modify: `README.md`, `CONTEXT.md`
- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

---

### Task 1: Helper reutilizable en creacion (TDD)

**Files:**

- Modify: `src/modules/activities/activities.schedule.test.ts`
- Modify: `src/modules/activities/activities.schedule.ts`

- [ ] **Step 1: Escribir la prueba que falla**

Agregar dentro de `describe('assertActivityScheduleIsAvailable')`, despues de `'resolves when the classroom covers the schedule without overlaps'`:

```ts
it('checks availability without excluding any activity when creating', async () => {
  const prisma = createSchedulePrismaMock();
  prisma.classroom.findUnique.mockResolvedValue(activeClassroom);
  prisma.classroomAvailability.findFirst.mockResolvedValue({ id: 'slot-001' });
  prisma.activity.findFirst.mockResolvedValue(null);
  const { assertActivityScheduleIsAvailable } = await loadSchedule(prisma);

  await expect(
    assertActivityScheduleIsAvailable({
      classroomId: scheduleInput.classroomId,
      date: scheduleInput.date,
      startTime: scheduleInput.startTime,
      endTime: scheduleInput.endTime,
      maxCapacity: scheduleInput.maxCapacity,
    }),
  ).resolves.toBeUndefined();

  const where = (prisma.activity.findFirst.mock.calls[0]?.[0] as { where: object }).where;
  expect(where).not.toHaveProperty('id');
});
```

- [ ] **Step 2: Verificar que falla por la razon esperada**

Run: `pnpm exec vitest run src/modules/activities/activities.schedule.test.ts`
Expected: FAIL — la implementacion actual arma `where` con `id: { not: undefined }`, por lo que `where` si tiene la propiedad `id`.

- [ ] **Step 3: Implementacion minima**

En `activities.schedule.ts`, cambiar la interfaz:

```ts
export interface ActivityScheduleInput {
  activityId?: string | null;
  classroomId: string;
  date: Date;
  startTime: Date;
  endTime: Date;
  maxCapacity: number | null;
}
```

y el filtro de solape:

```ts
const overlapping = await prisma.activity.findFirst({
  where: {
    ...(input.activityId ? { id: { not: input.activityId } } : {}),
    classroomId: input.classroomId,
    date: input.date,
    status: { in: [...RESERVING_STATUSES] },
    startTime: { lt: input.endTime },
    endTime: { gt: input.startTime },
  },
  select: { id: true },
});
```

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm exec vitest run src/modules/activities/activities.schedule.test.ts`
Expected: PASS (15 pruebas).

---

### Task 2: `createActivity` con validacion completa (TDD)

**Files:**

- Modify: `src/modules/activities/activities.service.test.ts`
- Modify: `src/modules/activities/activities.service.ts`

- [ ] **Step 1: Ampliar el mock de creacion**

En `activities.service.test.ts`, reemplazar la interfaz y la fabrica por:

```ts
interface CreatePrismaMock {
  eventProgram: { findUnique: ReturnType<typeof vi.fn> };
  classroom: { findUnique: ReturnType<typeof vi.fn> };
  classroomAvailability: { findFirst: ReturnType<typeof vi.fn> };
  user: { findMany: ReturnType<typeof vi.fn> };
  activity: { create: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  auditEvent: { create: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
}

const createCreatePrismaMock = (): CreatePrismaMock => {
  const prisma: CreatePrismaMock = {
    eventProgram: { findUnique: vi.fn() },
    classroom: { findUnique: vi.fn() },
    classroomAvailability: { findFirst: vi.fn() },
    user: { findMany: vi.fn() },
    activity: { create: vi.fn(), findFirst: vi.fn() },
    auditEvent: { create: vi.fn().mockResolvedValue({ id: 'audit-001' }) },
    $transaction: vi.fn(),
  };

  prisma.$transaction.mockImplementation(
    async (callback: (client: CreatePrismaMock) => Promise<unknown>) => callback(prisma),
  );

  return prisma;
};
```

- [ ] **Step 2: Escribir las pruebas que fallan**

En el `describe('createActivity')`, reemplazar `'rejects a missing or inactive classroom'` por la version que ademas verifica que no se consulta disponibilidad:

```ts
it('rejects a missing or inactive classroom before any availability query', async () => {
  const missing = createCreatePrismaMock();
  missing.eventProgram.findUnique.mockResolvedValue(activeProgram);
  missing.classroom.findUnique.mockResolvedValue(null);
  const { createActivity: createWithMissing } = await loadCreateService(missing);

  await expect(
    createWithMissing({ ...createBody, classroomId: 'classroom-001' }),
  ).rejects.toMatchObject({ statusCode: 404 });
  expect(missing.classroomAvailability.findFirst).not.toHaveBeenCalled();
  expect(missing.activity.findFirst).not.toHaveBeenCalled();

  const inactive = createCreatePrismaMock();
  inactive.eventProgram.findUnique.mockResolvedValue(activeProgram);
  inactive.classroom.findUnique.mockResolvedValue({
    id: 'classroom-001',
    isActive: false,
    capacity: 40,
  });
  const { createActivity: createWithInactive } = await loadCreateService(inactive);

  await expect(
    createWithInactive({ ...createBody, classroomId: 'classroom-001' }),
  ).rejects.toMatchObject({ statusCode: 400 });
  expect(inactive.classroomAvailability.findFirst).not.toHaveBeenCalled();
  expect(inactive.activity.findFirst).not.toHaveBeenCalled();
});
```

y agregar despues:

```ts
it('validates the classroom availability window when a classroom is requested', async () => {
  const prisma = createCreatePrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue(activeProgram);
  prisma.classroom.findUnique.mockResolvedValue({
    id: 'classroom-001',
    isActive: true,
    capacity: 60,
  });
  prisma.classroomAvailability.findFirst.mockResolvedValue({ id: 'slot-001' });
  prisma.activity.findFirst.mockResolvedValue(null);
  prisma.activity.create.mockResolvedValue(createdRecord);
  const { createActivity } = await loadCreateService(prisma);

  await createActivity({ ...createBody, classroomId: 'classroom-001', maxCapacity: 30 });

  expect(prisma.classroom.findUnique).toHaveBeenCalledWith({
    where: { id: 'classroom-001' },
    select: { id: true, isActive: true, capacity: true },
  });
  expect(prisma.classroomAvailability.findFirst).toHaveBeenCalledWith({
    where: {
      classroomId: 'classroom-001',
      dayOfWeek: expect.any(Number),
      startTime: { lte: new Date('1970-01-01T08:00:00.000Z') },
      endTime: { gte: new Date('1970-01-01T10:00:00.000Z') },
    },
    select: { id: true },
  });
  expect(prisma.activity.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ classroomId: 'classroom-001' }),
    }),
  );
});

it('rejects a classroom outside its availability window with 409', async () => {
  const prisma = createCreatePrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue(activeProgram);
  prisma.classroom.findUnique.mockResolvedValue({
    id: 'classroom-001',
    isActive: true,
    capacity: 60,
  });
  prisma.classroomAvailability.findFirst.mockResolvedValue(null);
  const { createActivity } = await loadCreateService(prisma);

  await expect(
    createActivity({ ...createBody, classroomId: 'classroom-001' }),
  ).rejects.toMatchObject({
    statusCode: 409,
    message: 'Classroom is not available in the requested time window.',
  });
  expect(prisma.activity.create).not.toHaveBeenCalled();
});

it('rejects an overlapping reservation with 409 without excluding any activity', async () => {
  const prisma = createCreatePrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue(activeProgram);
  prisma.classroom.findUnique.mockResolvedValue({
    id: 'classroom-001',
    isActive: true,
    capacity: 60,
  });
  prisma.classroomAvailability.findFirst.mockResolvedValue({ id: 'slot-001' });
  prisma.activity.findFirst.mockResolvedValue({ id: 'activity-999' });
  const { createActivity } = await loadCreateService(prisma);

  await expect(
    createActivity({ ...createBody, classroomId: 'classroom-001' }),
  ).rejects.toMatchObject({
    statusCode: 409,
    message: 'Classroom is already reserved for an overlapping activity.',
  });

  const where = (prisma.activity.findFirst.mock.calls[0]?.[0] as { where: object }).where;
  expect(where).not.toHaveProperty('id');
  expect(prisma.activity.create).not.toHaveBeenCalled();
});

it('rejects an activity capacity above the classroom capacity with 400', async () => {
  const prisma = createCreatePrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue(activeProgram);
  prisma.classroom.findUnique.mockResolvedValue({
    id: 'classroom-001',
    isActive: true,
    capacity: 20,
  });
  const { createActivity } = await loadCreateService(prisma);

  await expect(
    createActivity({ ...createBody, classroomId: 'classroom-001', maxCapacity: 30 }),
  ).rejects.toMatchObject({
    statusCode: 400,
    message: 'Classroom capacity is below the activity capacity.',
  });
  expect(prisma.classroomAvailability.findFirst).not.toHaveBeenCalled();
  expect(prisma.activity.create).not.toHaveBeenCalled();
});

it('rejects an invalid time range at the service boundary with 400', async () => {
  const prisma = createCreatePrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue(activeProgram);
  const { createActivity } = await loadCreateService(prisma);

  await expect(
    createActivity({ ...createBody, startTime: '10:00', endTime: '08:00' }),
  ).rejects.toMatchObject({
    statusCode: 400,
    message: 'End time must be after start time.',
  });
  expect(prisma.classroom.findUnique).not.toHaveBeenCalled();
  expect(prisma.activity.create).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Verificar que fallan**

Run: `pnpm exec vitest run src/modules/activities/activities.service.test.ts`
Expected: FAIL — las cinco pruebas nuevas fallan (el servicio no consulta ventana/solape/capacidad y no aplica `assertActivityTimeRange`); la prueba de aula ausente/inactiva puede fallar porque el mock viejo no tenia `classroomAvailability`/`activity.findFirst`.

- [ ] **Step 4: Implementacion minima en el servicio**

En `createActivity`, reemplazar el bloque inline de aula y el parseo de horas:

```ts
const startTime = new Date(`1970-01-01T${input.startTime}:00.000Z`);
const endTime = new Date(`1970-01-01T${input.endTime}:00.000Z`);

assertActivityTimeRange(startTime, endTime);

if (input.classroomId) {
  await assertActivityScheduleIsAvailable({
    classroomId: input.classroomId,
    date,
    startTime,
    endTime,
    maxCapacity: input.maxCapacity ?? null,
  });
}
```

y eliminar el bloque anterior:

```ts
if (input.classroomId) {
  const classroom = await prisma.classroom.findUnique({
    where: { id: input.classroomId },
    select: { id: true, isActive: true },
  });

  if (!classroom) {
    throw new ApiError(404, 'Classroom not found.');
  }
  if (!classroom.isActive) {
    throw new ApiError(400, 'Classroom is not active.');
  }
}
```

Conservar los imports existentes (`assertActivityScheduleIsAvailable`, `assertActivityTimeRange`, `assertClassroomIsAssignable`); `assertClassroomIsAssignable` sigue usandose en `updateActivity`.

- [ ] **Step 5: Verificar que pasan**

Run: `pnpm exec vitest run src/modules/activities`
Expected: PASS (toda la suite del modulo).

- [ ] **Step 6: Typecheck y lint dirigidos**

Run: `pnpm run typecheck && pnpm exec eslint src/modules/activities`
Expected: verde.

---

### Task 3: Contrato OpenAPI del POST

**Files:**

- Modify: `src/docs/openapi.test.ts`
- Modify: `src/modules/activities/activities.openapi.ts`
- Modify: `openapi.json` (generado)

- [ ] **Step 1: Escribir la prueba que falla**

Reemplazar en `src/docs/openapi.test.ts` la prueba `'marks the create activity operation with bearer security and a 201 response'` por:

```ts
it('marks the create activity operation with bearer security, a 201 response and its conflicts', () => {
  const operation = openApiDocument.paths?.['/api/v1/activities']?.post;

  expect(operation?.security).toEqual([{ bearerAuth: [] }]);
  expect(operation?.responses?.['201']).toBeDefined();
  expect(operation?.responses?.['409']).toBeDefined();
  expect(operation?.description).toContain('availability');
  expect(openApiDocument.components?.schemas).toHaveProperty('ActivityDetail');
});
```

- [ ] **Step 2: Verificar rojo**

Run: `pnpm exec vitest run src/docs/openapi.test.ts`
Expected: FAIL — el POST no declara `409` ni menciona `availability` en la descripcion.

- [ ] **Step 3: Actualizar el contrato**

En `activities.openapi.ts`, reemplazar la descripcion del POST y agregar `409`:

```ts
    post: {
      tags: ['Activities'],
      summary: 'Create an activity',
      description:
        'Creates an activity in DRAFT status inside an ACTIVE event program. Accepts inline speakers; a speaker is reused when the email matches an existing catalog entry and linked to a platform user when the email matches an account. Speakers do not need a platform account. When a classroom is requested, the same schedule validations as PATCH apply: the classroom must exist and be active (404/400), the activity capacity cannot exceed the classroom capacity (400), the schedule must fall inside one of its availability windows (409) and no SCHEDULED/ONGOING activity may reserve an overlapping interval (409). Requires the activity:create permission on the target program (or the ADMIN role).',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: createActivitySchema.shape.body } },
      },
      responses: {
        201: {
          description: 'Activity created successfully.',
          content: { 'application/json': { schema: apiSuccessResponse(activityDetailSchema) } },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
        500: errorResponse,
      },
    },
```

- [ ] **Step 4: Verificar verde y regenerar**

Run: `pnpm exec vitest run src/docs/openapi.test.ts`
Expected: PASS.

Run: `pnpm run docs:generate && pnpm run docs:check`
Expected: `openapi.json` con el `409` del POST; `docs:check` verde.

---

### Task 4: Bruno

**Files:**

- Create: `bruno/Activities/Create an activity with a capacity above the classroom returns 400.bru`
- Create: `bruno/Activities/Create an activity outside the classroom window returns 409.bru`
- Create: `bruno/Activities/Create a reserving activity for the overlap check.bru`
- Create: `bruno/Activities/Publish the reserving activity.bru`
- Create: `bruno/Activities/Create an overlapping activity returns 409.bru`
- Create: `bruno/Activities/Unpublish the reserving activity.bru`
- Create: `bruno/Activities/Delete the reserving activity.bru`

La fecha fija `2027-06-07` es lunes (14:00-16:00 cae en la ventana vespertina estandar de `aula-101`) y esta fuera del rango de offsets del seed, por lo que la cadena de solape no compite con datos base.

- [ ] **Step 1: Capacidad (seq 49)**

```bru
meta {
  name: Create an activity with a capacity above the classroom returns 400
  type: http
  seq: 49
  tags: [
    Activities
  ]
}

post {
  url: {{baseUrl}}/api/v1/activities
  body: json
  auth: bearer
}

auth:bearer {
  token: {{token}}
}

body:json {
  {
    "name": "Actividad temporal capacidad 5.8",
    "type": "WORKSHOP",
    "date": "2027-06-07",
    "startTime": "14:00",
    "endTime": "16:00",
    "maxCapacity": 1000,
    "eventProgramId": "seed_program_fic_default",
    "classroomId": "seed_classroom_aula-101"
  }
}

docs {
  Rejects the create before any write when the activity capacity exceeds the classroom capacity (40 in the seed). Requires an authenticated admin.
}

tests {
  test("capacity above the classroom is rejected with 400", function () {
    expect(res.getStatus()).to.equal(400);
    const body = res.getBody();
    expect(body.success).to.equal(false);
    expect(body.message).to.equal("Classroom capacity is below the activity capacity.");
  });
}
```

- [ ] **Step 2: Ventana (seq 50)**

```bru
meta {
  name: Create an activity outside the classroom window returns 409
  type: http
  seq: 50
  tags: [
    Activities
  ]
}

post {
  url: {{baseUrl}}/api/v1/activities
  body: json
  auth: bearer
}

auth:bearer {
  token: {{token}}
}

body:json {
  {
    "name": "Actividad temporal ventana 5.8",
    "type": "WORKSHOP",
    "date": "2027-06-07",
    "startTime": "18:00",
    "endTime": "19:00",
    "eventProgramId": "seed_program_fic_default",
    "classroomId": "seed_classroom_aula-101"
  }
}

docs {
  Rejects the create before any write when the schedule falls outside every availability window of the classroom. Requires an authenticated admin.
}

tests {
  test("a schedule outside the window is rejected with 409", function () {
    expect(res.getStatus()).to.equal(409);
    const body = res.getBody();
    expect(body.success).to.equal(false);
    expect(body.message).to.equal("Classroom is not available in the requested time window.");
  });
}
```

- [ ] **Step 3: Crear la actividad que reserva (seq 51)**

```bru
meta {
  name: Create a reserving activity for the overlap check
  type: http
  seq: 51
  tags: [
    Activities
  ]
}

post {
  url: {{baseUrl}}/api/v1/activities
  body: json
  auth: bearer
}

auth:bearer {
  token: {{token}}
}

body:json {
  {
    "name": "Actividad temporal solape 5.8",
    "type": "WORKSHOP",
    "date": "2027-06-07",
    "startTime": "14:00",
    "endTime": "16:00",
    "eventProgramId": "seed_program_fic_default",
    "classroomId": "seed_classroom_aula-101"
  }
}

script:post-response {
  const body = res.getBody();

  if (body?.success && body.data?.id) {
    bru.setVar("reservingActivityId", body.data.id);
  }
}

docs {
  Creates the DRAFT activity that the next requests publish, overlap and finally delete so the run leaves no residue. Requires an authenticated admin.
}

tests {
  test("the reserving activity starts as DRAFT", function () {
    expect(res.getStatus()).to.equal(201);
    const body = res.getBody();
    expect(body.data.status).to.equal("DRAFT");
  });
}
```

- [ ] **Step 4: Publicar (seq 52)**

```bru
meta {
  name: Publish the reserving activity
  type: http
  seq: 52
  tags: [
    Activities
  ]
}

patch {
  url: {{baseUrl}}/api/v1/activities/{{reservingActivityId}}
  body: json
  auth: bearer
}

auth:bearer {
  token: {{token}}
}

body:json {
  {
    "status": "SCHEDULED"
  }
}

docs {
  Publishes the reserving activity after the window and capacity validations pass. Requires the activity:update permission or the ADMIN role.
}

tests {
  test("the reserving activity becomes SCHEDULED", function () {
    expect(res.getStatus()).to.equal(200);
    expect(res.getBody().data.status).to.equal("SCHEDULED");
  });
}
```

- [ ] **Step 5: Solape (seq 53)**

```bru
meta {
  name: Create an overlapping activity returns 409
  type: http
  seq: 53
  tags: [
    Activities
  ]
}

post {
  url: {{baseUrl}}/api/v1/activities
  body: json
  auth: bearer
}

auth:bearer {
  token: {{token}}
}

body:json {
  {
    "name": "Actividad temporal solape duplicada 5.8",
    "type": "WORKSHOP",
    "date": "2027-06-07",
    "startTime": "14:30",
    "endTime": "15:30",
    "eventProgramId": "seed_program_fic_default",
    "classroomId": "seed_classroom_aula-101"
  }
}

docs {
  Rejects the create before any write because a SCHEDULED activity already reserves an overlapping interval in the same classroom and date. Requires an authenticated admin.
}

tests {
  test("an overlapping schedule is rejected with 409", function () {
    expect(res.getStatus()).to.equal(409);
    const body = res.getBody();
    expect(body.success).to.equal(false);
    expect(body.message).to.equal("Classroom is already reserved for an overlapping activity.");
  });
}
```

- [ ] **Step 6: Despublicar y borrar (seq 54 y 55)**

`Unpublish the reserving activity.bru`:

```bru
meta {
  name: Unpublish the reserving activity
  type: http
  seq: 54
  tags: [
    Activities
  ]
}

patch {
  url: {{baseUrl}}/api/v1/activities/{{reservingActivityId}}
  body: json
  auth: bearer
}

auth:bearer {
  token: {{token}}
}

body:json {
  {
    "status": "DRAFT"
  }
}

docs {
  Unpublishes the reserving activity so the retention rule allows deleting it. Requires the activity:update permission or the ADMIN role.
}

tests {
  test("the reserving activity returns to DRAFT", function () {
    expect(res.getStatus()).to.equal(200);
    expect(res.getBody().data.status).to.equal("DRAFT");
  });
}
```

`Delete the reserving activity.bru`:

```bru
meta {
  name: Delete the reserving activity
  type: http
  seq: 55
  tags: [
    Activities
  ]
}

delete {
  url: {{baseUrl}}/api/v1/activities/{{reservingActivityId}}
  body: none
  auth: bearer
}

auth:bearer {
  token: {{token}}
}

docs {
  Deletes the DRAFT reserving activity so this chain leaves no residue. Requires the activity:delete permission or the ADMIN role.
}

tests {
  test("the reserving activity is deleted", function () {
    expect(res.getStatus()).to.equal(204);
  });
}
```

- [ ] **Step 7: Correr la carpeta**

Run: `pnpm exec bru run Activities --env local`
Expected: 55/55 requests y 58/58 tests en verde (48 requests y 51 tests previos mas los 7 nuevos).

---

### Task 5: Verificacion real con Docker + psql (y rebuild P5)

- [ ] **Step 1: Rebuild del stack (P5)**

Run: `docker compose -f compose.dev.yaml build api && docker compose -f compose.dev.yaml up -d`
Expected: contenedor sano; `GET /api/v1/health` 200 con `authJwksReachable: true`.

Nota: si el bind mount sigue congelado (`F5.5-A`/`F5.6-A`/`F5.7-B`), copiar los archivos tocados con `docker cp` y reiniciar `api`, como en las fases anteriores.

- [ ] **Step 2: Baseline**

Run: `psql` sobre la BD de desarrollo; confirmar 40 actividades y 24 base del seed demo. Login admin y guardar token.

- [ ] **Step 3: Checks E2E**

1. POST con `classroomId` valido y franja libre de `aula-101` (lunes a viernes, dentro de ventana, sin actividades base): `201 DRAFT`.
2. POST con la misma aula/fecha/hora que una actividad `SCHEDULED` existente -> `409 Classroom is already reserved for an overlapping activity.` y `count = 0` en psql.
3. POST con aula valida a las 18:00-19:00 -> `409 Classroom is not available in the requested time window.` y sin fila.
4. POST con `maxCapacity: 1000` sobre `aula-101` (capacidad 40) -> `400 Classroom capacity is below the activity capacity.` y sin fila.
5. POST con aula inexistente -> `404 Classroom not found.`; con aula inactiva (si hay una temporal via psql) -> `400 Classroom is not active.`
6. Publicar la actividad valida del punto 1 -> `200 SCHEDULED`; PATCH a la franja reservada -> `409` (regresion PATCH); despublicar -> `200 DRAFT`; `DELETE` -> `204`.
7. Logs recientes sin passwords, tokens ni headers.

- [ ] **Step 4: Limpieza**

`pnpm run prisma:cleanup:dev -- --pattern='Actividad temporal%' --apply` y psql hasta el baseline (40 actividades); sin ponentes temporales (los payloads E2E no crean speakers).

---

### Task 6: Documentacion y plan maestro

**Files:**

- Modify: `README.md:339`
- Modify: `CONTEXT.md:168`
- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [ ] **Step 1: README**

En la linea del POST agregar: "Si se indica `classroomId`, la creacion aplica las mismas validaciones de agenda que `PATCH`: aula existente/activa (`404`/`400`), capacidad del aula suficiente (`400`), horario dentro de una ventana de disponibilidad (`409`) y ausencia de solape con actividades `SCHEDULED`/`ONGOING` (`409`)."

- [ ] **Step 2: CONTEXT**

Misma nota en la linea del POST.

- [ ] **Step 3: Plan maestro**

- Marcar `- [ ] **5.8 Revisar creacion existente.**` como `[x]`.
- Actualizar la fila "Actividades" del "Estado actual" a `Completada: 5.1-5.8 implementados`.
- Marcar `P6` como `[x]` con la evidencia del cierre.
- Marcar `P5` como `[x]` si el rebuild del Step 1 quedo en verde.
- Agregar `**Registro de ejecucion (2026-10-04 - 5.8):**` con plan, decisiones, pruebas, E2E, Bruno, contrato, documentacion, hallazgos y "Sin commit: el usuario no lo solicito."

---

### Task 7: Gates finales

- [ ] `pnpm test`
- [ ] `pnpm run typecheck`
- [ ] `pnpm run lint`
- [ ] `pnpm run build`
- [ ] `pnpm run format:check`
- [ ] `pnpm run docs:generate` y `pnpm run docs:check`
- [ ] `pnpm prisma:validate` y `pnpm prisma:migrate:status`

---

## Estado de ejecucion

Ejecutado el 2026-10-04. Los pasos de arriba se dejan sin marcar a proposito: es la convencion de los planes de Fase 5 (5.1 a 5.7 registran 0 pasos marcados) y el registro con la evidencia vive en el plan maestro, en `Registro de ejecucion (2026-10-04 - 5.8)`.

Resultado: los 7 tasks completados. Suite dirigida `src/modules/activities` 261 en 5 archivos, suite completa 1562 en 70 archivos + 1 omitido (7 skip), 16/16 checks E2E, Bruno `Activities` 55/55 requests y 58/58 tests, `openapi.json` sin drift y gates en verde salvo `format:check` global, que solo reporta los 3 archivos ajenos preexistentes (`compose.prod.yaml`, `docs/despliegue.md` y `src/modules/auth/auth.cookie.test.ts`).

Desviaciones respecto del plan:

1. **Bind mount congelado:** el contenedor no veia `activities.schedule.ts`; el rebuild de `P5` (`docker compose -f compose.dev.yaml build api` + `up -d`) dejo el stack sano y sirviendo el codigo nuevo, sin necesidad de `docker cp`.
2. **Rango horario en E2E:** `POST` con fin antes de inicio responde `400 Validation error.` desde el schema; el chequeo defensivo del servicio (`assertActivityTimeRange`) queda cubierto por la prueba unitaria `rejects an invalid time range at the service boundary with 400`.
3. **Limpieza:** ademas de A/B/C, se purgo la actividad `CANCELLED` que deja la corrida Bruno con `pnpm run prisma:cleanup:dev -- --pattern='Actividad temporal%' --apply` y se borro el ponente huerfano `ana.prueba@utp.ac.pa`; la BD quedo en 40 actividades y 19 ponentes.
