# Fase 5.5 - Validar aula y horario Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidar y endurecer la validacion de aula/horario de actividades: extraer el validador a un modulo con pruebas directas, cerrar el hueco de equipamiento duplicado sin distinguir mayusculas y verificar los seis checks de 5.5 con evidencia real.

**Architecture:** Nuevo `src/modules/activities/activities.schedule.ts` que concentra `assertActivityTimeRange`, `assertClassroomIsAssignable`, `assertActivityScheduleIsAvailable`, `RESERVING_STATUSES` e `isExclusionViolation`; `activities.service.ts` los consume sin cambio de contrato. `equipment` en los schemas de crear/actualizar compara en minusculas. Sin migraciones, permisos, env vars, rutas nuevas ni cambios de OpenAPI.

**Tech Stack:** TypeScript, Express 5, Prisma 7 (Postgres), Zod 4, Vitest, Supertest, Bruno.

**Decisiones confirmadas (2026-10-04):**

1. Alcance 5.5: solo PATCH + helper; `POST /activities` queda para 5.8.
2. `equipment` rechaza duplicados sin distinguir mayusculas con `400` y el mismo mensaje.

**Hallazgos de partida:**

- 5.2 ya implemento los seis checks en `PATCH /activities/:id`: `endTime > startTime` (schema + servicio), aula existe/activa, ventana `409`, solape `409` con backstop GiST y capacidad `400`.
- `assertActivityScheduleIsAvailable` (`activities.service.ts:213-269`) solo tiene pruebas indirectas via `updateActivity`; `createActivity` duplica el chequeo de aula existe/activa inline (`:492-504`) y lo reutilizara en 5.8.
- `equipment` usa `new Set(items).size` case-sensitive en create (`:321`) y update (`:383`); `['Proyector','proyector']` se persiste como dos filas.
- El constraint GiST solo cubre solapes; ventana/capacidad corren antes de la transaccion (se acepta: el trigger de BD no cubre esos dos).

**Reglas de negocio que no cambian:**

- Orden de errores: `404 Activity not found.` -> `409 Completed or cancelled...` -> `409 Event programs must be active...` -> campos/transicion -> `400 End time must be after start time.` -> reserva.
- Reserva solo cuando el estado efectivo es `SCHEDULED`/`ONGOING` y cambio estado/fecha/horario/aula/capacidad, con aula no nula.
- Mensajes exactos: `Classroom not found.` (404), `Classroom is not active.` (400), `Classroom capacity is below the activity capacity.` (400), `Classroom is not available in the requested time window.` (409), `Classroom is already reserved for an overlapping activity.` (409).

**File structure:**

- Create: `src/modules/activities/activities.schedule.ts`
- Create: `src/modules/activities/activities.schedule.test.ts`
- Modify: `src/modules/activities/activities.service.ts`
- Modify: `src/modules/activities/activities.schemas.ts`
- Modify: `src/modules/activities/activities.schemas.test.ts`
- Modify: `src/modules/activities/activities.routes.test.ts`
- Create: `bruno/Activities/Create an activity with duplicated equipment returns 400.bru`
- Modify: `README.md`, `CONTEXT.md`, `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

---

### Task 1: Modulo `activities.schedule.ts` con pruebas directas (TDD)

**Files:**

- Create: `src/modules/activities/activities.schedule.test.ts`
- Create: `src/modules/activities/activities.schedule.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `activities.schedule.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

interface SchedulePrismaMock {
  classroom: { findUnique: ReturnType<typeof vi.fn> };
  classroomAvailability: { findFirst: ReturnType<typeof vi.fn> };
  activity: { findFirst: ReturnType<typeof vi.fn> };
}

const createSchedulePrismaMock = (): SchedulePrismaMock => ({
  classroom: { findUnique: vi.fn() },
  classroomAvailability: { findFirst: vi.fn() },
  activity: { findFirst: vi.fn() },
});

const loadSchedule = async (prisma: SchedulePrismaMock) => {
  vi.resetModules();
  vi.doMock('../../config/prisma.js', () => ({
    getPrismaClient: () => prisma,
  }));

  return import('./activities.schedule.js');
};

const START = new Date('1970-01-01T14:00:00.000Z');
const END = new Date('1970-01-01T17:00:00.000Z');
const DATE = new Date('2026-10-05T00:00:00.000Z');

const scheduleInput = {
  activityId: 'activity-001',
  classroomId: 'classroom-001',
  date: DATE,
  startTime: START,
  endTime: END,
  maxCapacity: 35,
};

const activeClassroom = { id: 'classroom-001', isActive: true, capacity: 60 };

describe('assertActivityTimeRange', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
  });

  it('accepts an end time after the start time', async () => {
    const { assertActivityTimeRange } = await loadSchedule(createSchedulePrismaMock());

    expect(() => assertActivityTimeRange(START, END)).not.toThrow();
  });

  it('rejects an end time equal to or before the start time', async () => {
    const { assertActivityTimeRange } = await loadSchedule(createSchedulePrismaMock());

    expect(() => assertActivityTimeRange(END, START)).toThrow('End time must be after start time.');
    expect(() => assertActivityTimeRange(START, START)).toThrow(
      'End time must be after start time.',
    );
  });
});

describe('assertClassroomIsAssignable', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
  });

  it('resolves for an active classroom', async () => {
    const prisma = createSchedulePrismaMock();
    prisma.classroom.findUnique.mockResolvedValue(activeClassroom);
    const { assertClassroomIsAssignable } = await loadSchedule(prisma);

    await expect(assertClassroomIsAssignable('classroom-001')).resolves.toBeUndefined();
    expect(prisma.classroom.findUnique).toHaveBeenCalledWith({
      where: { id: 'classroom-001' },
      select: { id: true, isActive: true, capacity: true },
    });
  });

  it('rejects a missing classroom with 404', async () => {
    const prisma = createSchedulePrismaMock();
    prisma.classroom.findUnique.mockResolvedValue(null);
    const { assertClassroomIsAssignable } = await loadSchedule(prisma);

    await expect(assertClassroomIsAssignable('classroom-missing')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Classroom not found.',
    });
  });

  it('rejects an inactive classroom with 400', async () => {
    const prisma = createSchedulePrismaMock();
    prisma.classroom.findUnique.mockResolvedValue({ ...activeClassroom, isActive: false });
    const { assertClassroomIsAssignable } = await loadSchedule(prisma);

    await expect(assertClassroomIsAssignable('classroom-001')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Classroom is not active.',
    });
  });
});

describe('assertActivityScheduleIsAvailable', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
  });

  it('resolves when the classroom covers the schedule without overlaps', async () => {
    const prisma = createSchedulePrismaMock();
    prisma.classroom.findUnique.mockResolvedValue(activeClassroom);
    prisma.classroomAvailability.findFirst.mockResolvedValue({ id: 'slot-001' });
    prisma.activity.findFirst.mockResolvedValue(null);
    const { assertActivityScheduleIsAvailable } = await loadSchedule(prisma);

    await expect(assertActivityScheduleIsAvailable(scheduleInput)).resolves.toBeUndefined();

    expect(prisma.classroomAvailability.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          classroomId: 'classroom-001',
          dayOfWeek: 1,
          startTime: { lte: START },
          endTime: { gte: END },
        },
      }),
    );
    expect(prisma.activity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { not: 'activity-001' },
          classroomId: 'classroom-001',
          date: DATE,
          status: { in: ['SCHEDULED', 'ONGOING'] },
          startTime: { lt: END },
          endTime: { gt: START },
        },
      }),
    );
  });

  it('rejects a missing classroom with 404 before any availability query', async () => {
    const prisma = createSchedulePrismaMock();
    prisma.classroom.findUnique.mockResolvedValue(null);
    const { assertActivityScheduleIsAvailable } = await loadSchedule(prisma);

    await expect(assertActivityScheduleIsAvailable(scheduleInput)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Classroom not found.',
    });
    expect(prisma.classroomAvailability.findFirst).not.toHaveBeenCalled();
    expect(prisma.activity.findFirst).not.toHaveBeenCalled();
  });

  it('rejects an inactive classroom with 400', async () => {
    const prisma = createSchedulePrismaMock();
    prisma.classroom.findUnique.mockResolvedValue({ ...activeClassroom, isActive: false });
    const { assertActivityScheduleIsAvailable } = await loadSchedule(prisma);

    await expect(assertActivityScheduleIsAvailable(scheduleInput)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Classroom is not active.',
    });
    expect(prisma.classroomAvailability.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a classroom with less capacity than the activity', async () => {
    const prisma = createSchedulePrismaMock();
    prisma.classroom.findUnique.mockResolvedValue({ ...activeClassroom, capacity: 20 });
    const { assertActivityScheduleIsAvailable } = await loadSchedule(prisma);

    await expect(assertActivityScheduleIsAvailable(scheduleInput)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Classroom capacity is below the activity capacity.',
    });
    expect(prisma.classroomAvailability.findFirst).not.toHaveBeenCalled();
  });

  it('skips the capacity check when the activity has no capacity', async () => {
    const prisma = createSchedulePrismaMock();
    prisma.classroom.findUnique.mockResolvedValue({ ...activeClassroom, capacity: 1 });
    prisma.classroomAvailability.findFirst.mockResolvedValue({ id: 'slot-001' });
    prisma.activity.findFirst.mockResolvedValue(null);
    const { assertActivityScheduleIsAvailable } = await loadSchedule(prisma);

    await expect(
      assertActivityScheduleIsAvailable({ ...scheduleInput, maxCapacity: null }),
    ).resolves.toBeUndefined();
  });

  it('rejects a schedule outside the classroom availability windows with 409', async () => {
    const prisma = createSchedulePrismaMock();
    prisma.classroom.findUnique.mockResolvedValue(activeClassroom);
    prisma.classroomAvailability.findFirst.mockResolvedValue(null);
    const { assertActivityScheduleIsAvailable } = await loadSchedule(prisma);

    await expect(assertActivityScheduleIsAvailable(scheduleInput)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Classroom is not available in the requested time window.',
    });
    expect(prisma.activity.findFirst).not.toHaveBeenCalled();
  });

  it('rejects an overlapping reservation with 409', async () => {
    const prisma = createSchedulePrismaMock();
    prisma.classroom.findUnique.mockResolvedValue(activeClassroom);
    prisma.classroomAvailability.findFirst.mockResolvedValue({ id: 'slot-001' });
    prisma.activity.findFirst.mockResolvedValue({ id: 'activity-999' });
    const { assertActivityScheduleIsAvailable } = await loadSchedule(prisma);

    await expect(assertActivityScheduleIsAvailable(scheduleInput)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Classroom is already reserved for an overlapping activity.',
    });
  });
});

describe('isExclusionViolation', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
  });

  it('detects the classroom exclusion constraint through code, meta or message', async () => {
    const { isExclusionViolation } = await loadSchedule(createSchedulePrismaMock());

    expect(isExclusionViolation({ code: '23P01' })).toBe(true);
    expect(isExclusionViolation({ meta: { code: '23P01' } })).toBe(true);
    expect(
      isExclusionViolation({
        message:
          'conflicting key value violates exclusion constraint "activities_classroom_no_overlap"',
      }),
    ).toBe(true);
  });

  it('ignores unrelated errors', async () => {
    const { isExclusionViolation } = await loadSchedule(createSchedulePrismaMock());

    expect(isExclusionViolation(null)).toBe(false);
    expect(isExclusionViolation('boom')).toBe(false);
    expect(isExclusionViolation({ code: 'P2002' })).toBe(false);
  });
});
```

- [ ] **Step 2: Verificar que falla por la razon esperada**

Run: `pnpm exec vitest run src/modules/activities/activities.schedule.test.ts`
Expected: FAIL — no existe `./activities.schedule.js` (error de resolucion de modulo).

- [ ] **Step 3: Implementacion minima**

Crear `activities.schedule.ts`:

```ts
import { getPrismaClient } from '../../config/prisma.js';
import type { ActivityStatus } from '../../generated/prisma/enums.js';
import { ApiError } from '../../utils/ApiError.js';
import { getInstitutionalDayOfWeek } from '../../utils/date.js';

export const RESERVING_STATUSES: ActivityStatus[] = ['SCHEDULED', 'ONGOING'];

export interface ActivityScheduleInput {
  activityId: string;
  classroomId: string;
  date: Date;
  startTime: Date;
  endTime: Date;
  maxCapacity: number | null;
}

export const assertActivityTimeRange = (startTime: Date, endTime: Date): void => {
  if (endTime <= startTime) {
    throw new ApiError(400, 'End time must be after start time.');
  }
};

const loadAssignableClassroom = async (
  classroomId: string,
): Promise<{ id: string; isActive: boolean; capacity: number }> => {
  const prisma = getPrismaClient();

  const classroom = await prisma.classroom.findUnique({
    where: { id: classroomId },
    select: { id: true, isActive: true, capacity: true },
  });

  if (!classroom) {
    throw new ApiError(404, 'Classroom not found.');
  }
  if (!classroom.isActive) {
    throw new ApiError(400, 'Classroom is not active.');
  }

  return classroom;
};

export const assertClassroomIsAssignable = async (classroomId: string): Promise<void> => {
  await loadAssignableClassroom(classroomId);
};

export const assertActivityScheduleIsAvailable = async (
  input: ActivityScheduleInput,
): Promise<void> => {
  const prisma = getPrismaClient();
  const classroom = await loadAssignableClassroom(input.classroomId);

  if (input.maxCapacity !== null && classroom.capacity < input.maxCapacity) {
    throw new ApiError(400, 'Classroom capacity is below the activity capacity.');
  }

  const dateKey = input.date.toISOString().slice(0, 10);

  const window = await prisma.classroomAvailability.findFirst({
    where: {
      classroomId: input.classroomId,
      dayOfWeek: getInstitutionalDayOfWeek(dateKey),
      startTime: { lte: input.startTime },
      endTime: { gte: input.endTime },
    },
    select: { id: true },
  });

  if (!window) {
    throw new ApiError(409, 'Classroom is not available in the requested time window.');
  }

  const overlapping = await prisma.activity.findFirst({
    where: {
      id: { not: input.activityId },
      classroomId: input.classroomId,
      date: input.date,
      status: { in: [...RESERVING_STATUSES] },
      startTime: { lt: input.endTime },
      endTime: { gt: input.startTime },
    },
    select: { id: true },
  });

  if (overlapping) {
    throw new ApiError(409, 'Classroom is already reserved for an overlapping activity.');
  }
};

export const isExclusionViolation = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown; meta?: { code?: unknown } };

  return (
    candidate.code === '23P01' ||
    candidate.meta?.code === '23P01' ||
    (typeof candidate.message === 'string' &&
      candidate.message.includes('activities_classroom_no_overlap'))
  );
};
```

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm exec vitest run src/modules/activities/activities.schedule.test.ts`
Expected: PASS (14 pruebas).

---

### Task 2: Refactor de `activities.service.ts` sin cambio de comportamiento

**Files:**

- Modify: `src/modules/activities/activities.service.ts`

- [ ] **Step 1: Baseline verde antes de tocar**

Run: `pnpm exec vitest run src/modules/activities`
Expected: PASS.

- [ ] **Step 2: Ajustar imports**

Reemplazar:

```ts
import { getInstitutionalDayOfWeek, startOfInstitutionalDay } from '../../utils/date.js';
```

por:

```ts
import { startOfInstitutionalDay } from '../../utils/date.js';
```

y agregar antes de `import type { CreateActivityBody ... } from './activities.schemas.js';`:

```ts
import {
  assertActivityScheduleIsAvailable,
  assertActivityTimeRange,
  assertClassroomIsAssignable,
  isExclusionViolation,
  RESERVING_STATUSES,
} from './activities.schedule.js';
```

- [ ] **Step 3: Borrar los bloques locales movidos**

Eliminar del servicio: la constante `RESERVING_STATUSES` (`:169`), la funcion `isExclusionViolation` (`:175-188`) y la funcion `assertActivityScheduleIsAvailable` (`:213-269`).

- [ ] **Step 4: Reemplazar el chequeo inline de horario**

Reemplazar:

```ts
if (endTime <= startTime) {
  throw new ApiError(400, 'End time must be after start time.');
}
```

por:

```ts
assertActivityTimeRange(startTime, endTime);
```

- [ ] **Step 5: Reemplazar el chequeo inline de aula asignable**

Reemplazar el cuerpo del `else if (classroomChanged && classroomId)` por:

```ts
  } else if (classroomChanged && classroomId) {
    await assertClassroomIsAssignable(classroomId);
  }
```

- [ ] **Step 6: Verificar que la suite existente sigue verde sin tocarla**

Run: `pnpm exec vitest run src/modules/activities`
Expected: PASS (mismos tests que el baseline; ningun cambio de contrato).

- [ ] **Step 7: Typecheck y lint dirigidos**

Run: `pnpm run typecheck && pnpm exec eslint src/modules/activities`
Expected: verde.

---

### Task 3: `equipment` sin duplicados por mayusculas (TDD)

**Files:**

- Modify: `src/modules/activities/activities.schemas.ts`
- Modify: `src/modules/activities/activities.schemas.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

Agregar tras `rejects duplicated equipment names` (create):

```ts
it('rejects equipment names that differ only in case', () => {
  expect(() =>
    createActivitySchema.parse({
      body: { ...createPayload, equipment: ['Proyector', 'proyector'] },
    }),
  ).toThrow();
});
```

Agregar al final del `describe('updateActivitySchema')`:

```ts
it('rejects equipment names that differ only in case', () => {
  expect(() =>
    updateActivitySchema.parse({
      params: { id: 'activity-001' },
      body: { equipment: ['Proyector', 'proyector'] },
    }),
  ).toThrow();
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `pnpm exec vitest run src/modules/activities/activities.schemas.test.ts`
Expected: FAIL en las dos pruebas nuevas.

- [ ] **Step 3: Cambiar los dos refines**

En create (`:321`) y update (`:383`) reemplazar:

```ts
.refine((items) => new Set(items).size === items.length, 'Equipment items must be unique.')
```

por:

```ts
.refine(
  (items) => new Set(items.map((item) => item.toLowerCase())).size === items.length,
  'Equipment items must be unique.',
)
```

- [ ] **Step 4: Verificar que pasan**

Run: `pnpm exec vitest run src/modules/activities/activities.schemas.test.ts`
Expected: PASS.

---

### Task 4: Cobertura de ruta (TDD)

**Files:**

- Modify: `src/modules/activities/activities.routes.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

Agregar despues de `rejects update bodies without fields or with unknown keys before the service`:

```ts
it('rejects duplicated equipment regardless of case before the service', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminRecord);
  const app = await loadApp({ service, prisma });

  await request(app)
    .patch('/api/v1/activities/activity-002')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ equipment: ['Proyector', 'proyector'] })
    .expect(400);

  expect(service.updateActivity).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Verificar rojo**

Run: `pnpm exec vitest run src/modules/activities/activities.routes.test.ts`
Expected: FAIL (el refine aun es case-sensitive; la ruta responde 200 con el mock).

- [ ] **Step 3: Verificar verde con el cambio de Task 3**

Run: `pnpm exec vitest run src/modules/activities/activities.routes.test.ts`
Expected: PASS.

---

### Task 5: Bruno

**Files:**

- Create: `bruno/Activities/Create an activity with duplicated equipment returns 400.bru`

- [ ] **Step 1: Crear el request (seq 38, el maximo actual es 37; responde 400 antes del servicio, no deja residuo)**

```bru
meta {
  name: Create an activity with duplicated equipment returns 400
  type: http
  seq: 38
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
    "name": "Actividad con equipo duplicado",
    "type": "WORKSHOP",
    "date": "2026-12-16",
    "startTime": "14:00",
    "endTime": "16:00",
    "eventProgramId": "seed_program_fic_default",
    "equipment": ["Proyector", "proyector"]
  }
}

docs {
  Rejects equipment names that only differ in case before any write. Requires an authenticated admin.
}

tests {
  test("equipment duplicated ignoring case is rejected", function () {
    expect(res.getStatus()).to.equal(400);
    const body = res.getBody();
    expect(body.success).to.equal(false);
    expect(body.message).to.equal("Validation error.");
  });
}
```

- [ ] **Step 2: Correr la carpeta**

Run: `pnpm exec bru run Activities --env local`
Expected: 38/38 requests y 38/38 tests en verde.

---

### Task 6: Documentacion y plan maestro

**Files:**

- Modify: `README.md` (seccion Actividades, `:340` y `:343`)
- Modify: `CONTEXT.md` (`:168` y `:169`)
- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [ ] **Step 1: README**

En `:340` (PATCH) y `:343` (cuerpo de creacion) agregar que `equipment` no admite duplicados aunque difieran solo en mayusculas.

- [ ] **Step 2: CONTEXT**

En `:168` y `:169` agregar la misma nota.

- [ ] **Step 3: Plan maestro**

- Marcar `- [ ] **5.5 Validar aula y horario.**` como `[x]` con referencia al registro.
- Actualizar la fila "Actividades" del "Estado actual" a `5.1-5.5 implementados; faltan 5.6-5.8`.
- Agregar el bloque `**Registro de ejecucion (2026-10-04 - 5.5):**` con plan, hallazgo (5.2 ya cubria los checks; se extrajo el helper y se cerro el hueco de casing), pruebas, E2E, Bruno, contrato sin drift y gates.

---

### Task 7: Verificacion real con Docker + psql

- [ ] **Step 1: Stack y baseline**

`docker compose -f compose.dev.yaml up -d`; `GET /api/v1/health` -> 200 con `authJwksReachable: true`. Login admin y guardar token.

- [ ] **Step 2: E2E de los seis checks en PATCH**

1. Crear `DRAFT` A en `seed_program_fic_default` con aula y horario dentro de una ventana real (`SELECT classroom_id, day_of_week, start_time, end_time FROM classroom_availability` para elegir aula/dia).
2. PATCH `{ "startTime": "23:00" }` sobre A (fin 17:00) -> `400 End time must be after start time.` (ejercita el chequeo del servicio sobre valores resultantes, que Zod no cubre con una sola frontera).
3. Publicar A (`status: SCHEDULED`) -> `200`; PATCH A a un aula sin ventana ese dia o fuera de ventana -> `409 Classroom is not available...`.
4. Crear `DRAFT` B en el mismo aula/fecha/horario que A; PATCH B `status: SCHEDULED` -> `409 Classroom is already reserved...` y B sigue `DRAFT`; editar B en `DRAFT` (aula/horario) -> `200` sin reserva.
5. PATCH A `maxCapacity` mayor que `classroom.capacity` -> `400 Classroom capacity is below...`.
6. PATCH con `speakers` de email duplicado por casing -> `400`; POST con `equipment: ["Proyector","proyector"]` -> `400` sin residuo.
7. `estudiante01` PATCH -> `403`; sin token -> `401`; id inexistente -> `404`; `endTime` invalido -> `400`.

- [ ] **Step 3: Limpieza**

Despublicar A (`status: DRAFT`), `DELETE` A y B por API -> `204`; psql confirma 24 actividades base, `activity_equipment`/`activity_speakers` sin filas temporales y logs sin tokens.

---

### Task 8: Gates finales

- [ ] `pnpm test`
- [ ] `pnpm run typecheck`
- [ ] `pnpm run lint`
- [ ] `pnpm run build`
- [ ] `pnpm run format:check` (reportar solo archivos ajenos si los hay)
- [ ] `pnpm run docs:generate` y `pnpm run docs:check` (sin drift esperado)
- [ ] `pnpm prisma:validate` y `pnpm prisma:migrate:status`

---

## Estado de ejecucion

Ejecutado el 2026-10-04. Los pasos de arriba se dejan sin marcar a proposito: es la convencion de los planes de Fase 5 (5.1 a 5.4 registran 0 pasos marcados) y el registro con la evidencia vive en el plan maestro, en `Registro de ejecucion (2026-10-04 - 5.5)`.

Resultado: los 8 tasks completados. Suite dirigida `src/modules/activities` 223/223, suite completa 1490 en 69 archivos + 1 omitido (7 skip), 18/18 checks E2E, Bruno `Activities` 38/38 requests y 41/41 tests, `openapi.json` sin drift y gates en verde salvo `format:check` global, que solo reporta 3 archivos ajenos preexistentes (`compose.prod.yaml`, `docs/despliegue.md` y `src/modules/auth/auth.cookie.test.ts`, limpios en git).

Desviaciones respecto del plan:

1. **Prerrequisito de entorno:** el cliente Prisma generado no existia (`src/generated/prisma`), se ejecuto `pnpm prisma generate` antes del baseline.
2. **Baseline de Task 2:** la primera corrida fallo por el cliente Prisma ausente, no por el codigo; tras regenerarlo quedo en 220/220 (con las 14 pruebas nuevas de Task 1).
3. **Task 4 (rojo):** el test de ruta se agrego despues del fix de Task 3, asi que paso directo; el rojo de casing quedo demostrado en las 2 pruebas de schema de Task 3.
4. **Entorno de Docker:** el bind mount estaba congelado y el host no tenia `.env`; se restauro el `.env` local (gitignored) y se copiaron los 3 archivos al contenedor con `docker cp` para la verificacion E2E. Registrado como `F5.5-A` en el plan maestro.
5. **Limpieza:** ademas de A y B, se purgaron los 2 residuos `CANCELLED` de las corridas Bruno con el procedimiento documentado; la BD quedo en las 40 actividades base.
