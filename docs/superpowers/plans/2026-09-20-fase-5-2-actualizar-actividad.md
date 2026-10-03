# Fase 5.2 - Actualizar actividad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar `PATCH /api/v1/activities/:id` con transiciones `DRAFT <-> SCHEDULED`, rechazo de edicion de `COMPLETED`/`CANCELLED`, validacion completa de aula/horario y reemplazo de ponentes/equipamiento, con permiso `activity:update` en el scope de la actividad.

**Architecture:** Se extiende el modulo autocontenido `src/modules/activities/` existente (schemas Zod, servicio, controlador, rutas, OpenAPI y pruebas). El servicio reutiliza `activityDetailWithCountSelect`/`toActivityDetail` de 5.1, extrae de `createActivity` el builder de ponentes (`connectOrCreate` + vinculacion de usuarios) y agrega un validador de reserva de aula que replica el criterio del constraint GiST `activities_classroom_no_overlap` y de `GET /classrooms/available`. El permiso se verifica con `requirePermission(PERMISSIONS.ACTIVITY_UPDATE, { activityId })`, que ya resuelve herencia del programa mediante `getEffectivePermissions`.

**Tech Stack:** TypeScript, Express 5, Prisma 7 (Postgres), Zod 4, Vitest, Supertest, OpenAPI 3.1 (zod-openapi), Bruno.

**Decisiones confirmadas (2026-09-20):**

1. `status` opcional en el body con transiciones `DRAFT -> SCHEDULED` (publicar) y `SCHEDULED -> DRAFT` (despublicar). `ONGOING`/`COMPLETED`/`CANCELLED` no son asignables (`400` de Zod por enum); desde `ONGOING` cualquier cambio de estado responde `400`; editar `COMPLETED`/`CANCELLED` responde `409`.
2. 5.2 incluye la validacion completa de aula/horario (aula existe/activa, ventana de disponibilidad, solape `409`, capacidad, rango del programa) en un helper reutilizable para 5.5/5.8, mas traduccion de la violacion GiST como backstop. La validacion de reserva solo aplica cuando el estado efectivo es `SCHEDULED`/`ONGOING` y cambio estado, fecha, horario o aula.
3. `speakers` y `equipment`, cuando vienen, reemplazan la lista completa (`[]` limpia); omitidos no cambian. Se reutiliza la logica de `POST`: `connectOrCreate` por email y vinculacion a `userId` cuando existe cuenta.
4. `eventProgramId` es inmutable (body `.strict()`, clave desconocida -> `400`). `id`, `enrolledCount`, `checkedInCount` tampoco se aceptan.
5. Respuesta `200` con `ActivityDetail` (mismos conteos que `GET/POST`). Sin migraciones, variables de entorno ni permisos nuevos.

**Reglas de negocio:**

- Orden de errores del servicio: `404 Activity not found.` -> `409 Completed or cancelled activities cannot be modified.` -> `409 Event programs must be active to modify their activities.` -> validaciones de campos/transicion.
- Transiciones validas: `DRAFT -> SCHEDULED`, `SCHEDULED -> DRAFT` y mismo estado (no-op). Cualquier otra con `status` provisto: `400 Activity status transition is not allowed.`
- Fecha resultante fuera del rango de un programa no-default: `400 Activity date must be within the event program date range.`
- `classroomId` provisto no nulo: inexistente `404 Classroom not found.`, inactiva `400 Classroom is not active.`; `null` limpia.
- Reserva de aula (estado efectivo `SCHEDULED`/`ONGOING`, cambio relevante y aula no nula):
  - ventana sin cobertura: `409 Classroom is not available in the requested time window.`
  - solape con otra actividad `SCHEDULED`/`ONGOING` del aula (excluyendo la propia, intervalos semiabiertos): `409 Classroom is already reserved for an overlapping activity.`
  - `classroom.capacity < maxCapacity` efectivo: `400 Classroom capacity is below the activity capacity.`
- Violacion de exclusion Postgres (`23P01` o mensaje con `activities_classroom_no_overlap`) -> `409 Classroom is already reserved for an overlapping activity.`
- No exponer `eventProgramId` crudo, codigos de check-in, ni detalles internos.

**Hallazgos de partida (2026-09-20):**

- `activities.service.ts` ya expone `listUpcomingActivities`, `getActivityById` y `createActivity`; `activitySelect`, `activityDetailSelect`, `activityDetailWithCountSelect`, `toActivityListItem` y `toActivityDetail` son reutilizables.
- `createActivity` hace el lookup de usuarios por email y el mapeo `connectOrCreate` inline (lineas 237-250 y 268-300), duplicable por el update.
- `PERMISSIONS.ACTIVITY_UPDATE` existe (`activity:update`) y esta en los defaults de `EDITOR`/`ORGANIZER`.
- El trigger `validate_activity_program` exige programa `ACTIVE` cuando cambia `date` o cuando el status pasa a `SCHEDULED`/`ONGOING`; el constraint `activities_classroom_no_overlap` reserva aula solo para `SCHEDULED`/`ONGOING`.
- `requirePermission` corre antes de `validate`; el resolver de scope puede leer `req.params.id`.
- `GET /classrooms/available` ya define el criterio de ventana (`startTime <= inicio AND endTime >= fin`) y de solape (`startTime < fin AND endTime > inicio`).
- Bruno `Activities` usa seq 1-8; el draft de la carpeta se captura en `draftActivityId` con el request seq 3. `userEmail`/`userPassword` existen en `local.bru`.

---

### Task 1: Esquema `updateActivitySchema` (TDD)

**Files:**

- Modify: `src/modules/activities/activities.schemas.ts`
- Test: `src/modules/activities/activities.schemas.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

Agregar al final de `activities.schemas.test.ts`:

```ts
describe('updateActivitySchema', () => {
  it('accepts a partial body and trims the name', () => {
    const parsed = updateActivitySchema.parse({
      params: { id: ' activity-001 ' },
      body: { name: '  Nuevo nombre  ' },
    });

    expect(parsed.params.id).toBe('activity-001');
    expect(parsed.body).toEqual({ name: 'Nuevo nombre' });
  });

  it('accepts null to clear nullable fields', () => {
    const parsed = updateActivitySchema.parse({
      params: { id: 'activity-001' },
      body: {
        description: null,
        bannerUrl: null,
        maxCapacity: null,
        classroomId: null,
      },
    });

    expect(parsed.body).toEqual({
      description: null,
      bannerUrl: null,
      maxCapacity: null,
      classroomId: null,
    });
  });

  it('accepts the publish and unpublish statuses', () => {
    expect(
      updateActivitySchema.parse({ params: { id: 'activity-001' }, body: { status: 'SCHEDULED' } })
        .body.status,
    ).toBe('SCHEDULED');
    expect(
      updateActivitySchema.parse({ params: { id: 'activity-001' }, body: { status: 'DRAFT' } }).body
        .status,
    ).toBe('DRAFT');
  });

  it.each(['ONGOING', 'COMPLETED', 'CANCELLED'])('rejects the %s status', (status) => {
    expect(() =>
      updateActivitySchema.parse({ params: { id: 'activity-001' }, body: { status } }),
    ).toThrow();
  });

  it('rejects an empty body', () => {
    expect(() =>
      updateActivitySchema.parse({ params: { id: 'activity-001' }, body: {} }),
    ).toThrow();
  });

  it('rejects unknown fields such as eventProgramId or counts', () => {
    expect(() =>
      updateActivitySchema.parse({
        params: { id: 'activity-001' },
        body: { eventProgramId: 'program-002' },
      }),
    ).toThrow();
    expect(() =>
      updateActivitySchema.parse({
        params: { id: 'activity-001' },
        body: { enrolledCount: 3 },
      }),
    ).toThrow();
  });

  it('rejects an end time not after the provided start time', () => {
    expect(() =>
      updateActivitySchema.parse({
        params: { id: 'activity-001' },
        body: { startTime: '10:00', endTime: '08:00' },
      }),
    ).toThrow();
  });

  it('accepts only one time boundary at a time', () => {
    const parsed = updateActivitySchema.parse({
      params: { id: 'activity-001' },
      body: { endTime: '18:00' },
    });

    expect(parsed.body).toEqual({ endTime: '18:00' });
  });

  it('rejects duplicated equipment and speakers', () => {
    expect(() =>
      updateActivitySchema.parse({
        params: { id: 'activity-001' },
        body: { equipment: ['Proyector', 'Proyector'] },
      }),
    ).toThrow();
    expect(() =>
      updateActivitySchema.parse({
        params: { id: 'activity-001' },
        body: {
          speakers: [
            { firstName: 'Ana', lastName: 'Gomez', email: 'ana@example.com' },
            { firstName: 'Ana', lastName: 'Gomez', email: 'ANA@example.com' },
          ],
        },
      }),
    ).toThrow();
  });
});
```

Agregar `updateActivitySchema` al import existente.

- [ ] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/activities/activities.schemas.test.ts`
Expected: FAIL porque `updateActivitySchema` no existe.

- [ ] **Step 3: Implementar**

En `activities.schemas.ts`, despues de `createActivitySchema`:

```ts
export const updateActivitySchema = z.object({
  params: activityParamsSchema.shape.params,
  body: z
    .object({
      name: z
        .string()
        .trim()
        .min(1, 'Name is required.')
        .max(200, 'Name cannot exceed 200 characters.')
        .optional(),
      description: z
        .string()
        .trim()
        .max(2000, 'Description cannot exceed 2000 characters.')
        .nullish(),
      type: z.enum(['WORKSHOP', 'SEMINAR', 'TALK', 'OTHER'], 'Type is invalid.').optional(),
      date: z
        .string()
        .regex(datePattern, 'Date must be in YYYY-MM-DD format.')
        .refine(isValidCalendarDate, 'Date must be a valid calendar date.')
        .optional(),
      startTime: z.string().regex(timePattern, 'Start time must be in HH:mm format.').optional(),
      endTime: z.string().regex(timePattern, 'End time must be in HH:mm format.').optional(),
      maxCapacity: z
        .number('Capacity must be a number.')
        .int('Capacity must be an integer.')
        .positive('Capacity must be greater than 0.')
        .max(100000, 'Capacity is too large.')
        .nullish(),
      bannerUrl: z.string().url('Banner URL must be a valid URL.').max(500).nullish(),
      classroomId: z
        .string()
        .trim()
        .min(1, 'Classroom identifier is invalid.')
        .max(100, 'Classroom identifier cannot exceed 100 characters.')
        .nullish(),
      status: z.enum(['DRAFT', 'SCHEDULED'], 'Status is invalid.').optional(),
      speakers: z
        .array(activitySpeakerInputSchema)
        .max(10, 'No more than 10 speakers are allowed.')
        .refine(uniqueSpeakerEmails, 'Speaker emails must be unique.')
        .optional(),
      equipment: z
        .array(z.string().trim().min(1, 'Equipment name cannot be empty.').max(255))
        .max(20, 'No more than 20 equipment items are allowed.')
        .refine((items) => new Set(items).size === items.length, 'Equipment items must be unique.')
        .optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
      message: 'At least one field must be provided.',
    })
    .refine((value) => !value.startTime || !value.endTime || value.endTime > value.startTime, {
      message: 'End time must be after start time.',
      path: ['endTime'],
    }),
});

export type UpdateActivityBody = z.infer<typeof updateActivitySchema>['body'];
```

- [ ] **Step 4: Verificar el verde**

Run: `pnpm exec vitest run src/modules/activities/activities.schemas.test.ts`
Expected: PASS.

---

### Task 2: Extraer builders compartidos de ponentes (refactor)

**Files:**

- Modify: `src/modules/activities/activities.service.ts`
- Test: `src/modules/activities/activities.service.test.ts` (sin cambios; debe seguir verde)

- [ ] **Step 1: Extraer `buildSpeakerCreates`**

En `activities.service.ts`, antes de `createActivity`:

```ts
type SpeakerInput = NonNullable<CreateActivityBody['speakers']>[number];

const buildSpeakerCreates = async (speakers: SpeakerInput[]) => {
  const prisma = getPrismaClient();
  const emails = speakers
    .map((speaker) => speaker.email)
    .filter((email): email is string => typeof email === 'string');

  const usersByEmail = emails.length
    ? await prisma.user.findMany({
        where: { email: { in: emails } },
        select: { id: true, email: true },
      })
    : [];

  const userIdByEmail = new Map(
    usersByEmail.map((user) => [user.email.toLowerCase(), user.id] as const),
  );

  return speakers.map((speaker) =>
    speaker.email
      ? {
          speaker: {
            connectOrCreate: {
              where: { email: speaker.email },
              create: {
                firstName: speaker.firstName,
                lastName: speaker.lastName,
                email: speaker.email,
                organization: speaker.organization ?? null,
                userId: userIdByEmail.get(speaker.email) ?? null,
              },
            },
          },
        }
      : {
          speaker: {
            create: {
              firstName: speaker.firstName,
              lastName: speaker.lastName,
              email: null,
              organization: speaker.organization ?? null,
              userId: null,
            },
          },
        },
  );
};
```

Reemplazar en `createActivity` el bloque inline de lookup/mapping por:

```ts
      ...(input.speakers?.length
        ? { speakers: { create: await buildSpeakerCreates(input.speakers) } }
        : {}),
```

- [ ] **Step 2: Verificar que el refactor no cambia comportamiento**

Run: `pnpm exec vitest run src/modules/activities/activities.service.test.ts`
Expected: PASS (los tests de 5.1 y de creacion siguen verdes).

---

### Task 3: Servicio `updateActivity` (TDD)

**Files:**

- Modify: `src/modules/activities/activities.service.ts`
- Test: `src/modules/activities/activities.service.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

Agregar al final de `activities.service.test.ts`:

```ts
interface UpdatePrismaMock {
  activity: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  classroom: { findUnique: ReturnType<typeof vi.fn> };
  classroomAvailability: { findFirst: ReturnType<typeof vi.fn> };
  user: { findMany: ReturnType<typeof vi.fn> };
  attendance: { count: ReturnType<typeof vi.fn> };
}

const createUpdatePrismaMock = (): UpdatePrismaMock => ({
  activity: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  classroom: { findUnique: vi.fn() },
  classroomAvailability: { findFirst: vi.fn() },
  user: { findMany: vi.fn() },
  attendance: { count: vi.fn() },
});

const loadUpdateService = async (prisma: UpdatePrismaMock) => {
  vi.resetModules();
  vi.doMock('../../config/prisma.js', () => ({
    getPrismaClient: () => prisma,
  }));

  return import('./activities.service.js');
};

const updateRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'activity-001',
  name: 'Taller de Inteligencia Artificial',
  description: 'Introduccion a modelos generativos.',
  type: 'WORKSHOP' as const,
  date: new Date('2026-10-05T00:00:00.000Z'),
  startTime: new Date('1970-01-01T14:00:00.000Z'),
  endTime: new Date('1970-01-01T17:00:00.000Z'),
  maxCapacity: 35,
  bannerUrl: null,
  status: 'SCHEDULED' as const,
  classroomId: 'classroom-001',
  equipment: [{ name: 'Proyector' }],
  speakers: [],
  classroom: { id: 'classroom-001', name: 'Laboratorio 3', building: 'Edificio B' },
  eventProgram: {
    id: 'program-001',
    name: 'Programa de Ingenieria',
    label: null,
    status: 'ACTIVE' as const,
    isDefault: true,
    startDate: null,
    endDate: null,
    organizationalUnit: {
      id: 'faculty-001',
      name: 'Ingenieria de Sistemas Computacionales',
      type: 'FACULTY' as const,
    },
  },
  _count: { attendance: 6 },
  ...overrides,
});

describe('updateActivity', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
  });

  it('throws 404 when the activity does not exist', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(null);
    const { updateActivity } = await loadUpdateService(prisma);

    await expect(updateActivity('missing', { name: 'X' })).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(prisma.activity.update).not.toHaveBeenCalled();
  });

  it.each(['COMPLETED', 'CANCELLED'] as const)(
    'rejects updates of %s activities with 409',
    async (status) => {
      const prisma = createUpdatePrismaMock();
      prisma.activity.findUnique.mockResolvedValue({ ...updateRecord(), status });
      const { updateActivity } = await loadUpdateService(prisma);

      await expect(updateActivity('activity-001', { name: 'X' })).rejects.toMatchObject({
        statusCode: 409,
        message: 'Completed or cancelled activities cannot be modified.',
      });
      expect(prisma.activity.update).not.toHaveBeenCalled();
    },
  );

  it.each(['ARCHIVED', 'DRAFT'] as const)(
    'rejects updates when the program is %s with 409',
    async (programStatus) => {
      const prisma = createUpdatePrismaMock();
      prisma.activity.findUnique.mockResolvedValue(
        updateRecord({ eventProgram: { ...updateRecord().eventProgram, status: programStatus } }),
      );
      const { updateActivity } = await loadUpdateService(prisma);

      await expect(updateActivity('activity-001', { name: 'X' })).rejects.toMatchObject({
        statusCode: 409,
        message: 'Event programs must be active to modify their activities.',
      });
    },
  );

  it('updates scalar fields with parsed date and time and returns the detail with counts', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord({ status: 'DRAFT' }));
    prisma.activity.update.mockResolvedValue(
      updateRecord({ name: 'Taller actualizado', status: 'DRAFT' }),
    );
    prisma.attendance.count.mockResolvedValue(4);
    const { updateActivity } = await loadUpdateService(prisma);

    const result = await updateActivity('activity-001', {
      name: 'Taller actualizado',
      date: '2026-10-05',
      startTime: '15:00',
      endTime: '18:00',
      maxCapacity: 40,
      description: null,
      classroomId: null,
    });

    expect(prisma.activity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'activity-001' },
        data: expect.objectContaining({
          name: 'Taller actualizado',
          description: null,
          date: new Date('2026-10-05T00:00:00.000Z'),
          startTime: new Date('1970-01-01T15:00:00.000Z'),
          endTime: new Date('1970-01-01T18:00:00.000Z'),
          maxCapacity: 40,
          classroomId: null,
        }),
      }),
    );
    expect(result).toMatchObject({
      id: 'activity-001',
      name: 'Taller actualizado',
      enrolledCount: 6,
      checkedInCount: 4,
    });
  });

  it('rejects a partial time change that leaves the range invalid', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord({ status: 'DRAFT' }));
    const { updateActivity } = await loadUpdateService(prisma);

    await expect(updateActivity('activity-001', { startTime: '18:00' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'End time must be after start time.',
    });
    expect(prisma.activity.update).not.toHaveBeenCalled();
  });

  it('publishes a DRAFT activity and validates the classroom booking', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord({ status: 'DRAFT' }));
    prisma.classroom.findUnique.mockResolvedValue({
      id: 'classroom-001',
      isActive: true,
      capacity: 60,
    });
    prisma.classroomAvailability.findFirst.mockResolvedValue({ id: 'slot-001' });
    prisma.activity.findFirst.mockResolvedValue(null);
    prisma.activity.update.mockResolvedValue(updateRecord({ status: 'SCHEDULED' }));
    prisma.attendance.count.mockResolvedValue(0);
    const { updateActivity } = await loadUpdateService(prisma);

    const result = await updateActivity('activity-001', { status: 'SCHEDULED' });

    expect(prisma.classroomAvailability.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          classroomId: 'classroom-001',
          dayOfWeek: 1,
          startTime: { lte: new Date('1970-01-01T14:00:00.000Z') },
          endTime: { gte: new Date('1970-01-01T17:00:00.000Z') },
        }),
      }),
    );
    expect(prisma.activity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { not: 'activity-001' },
          classroomId: 'classroom-001',
          date: new Date('2026-10-05T00:00:00.000Z'),
          status: { in: ['SCHEDULED', 'ONGOING'] },
          startTime: { lt: new Date('1970-01-01T17:00:00.000Z') },
          endTime: { gt: new Date('1970-01-01T14:00:00.000Z') },
        }),
      }),
    );
    expect(result.status).toBe('SCHEDULED');
  });

  it('accepts SCHEDULED <-> DRAFT transitions and no-ops on the same status', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord({ status: 'SCHEDULED' }));
    prisma.classroomAvailability.findFirst.mockResolvedValue({ id: 'slot-001' });
    prisma.activity.findFirst.mockResolvedValue(null);
    prisma.activity.update.mockResolvedValue(updateRecord({ status: 'DRAFT' }));
    prisma.attendance.count.mockResolvedValue(0);
    const { updateActivity } = await loadUpdateService(prisma);

    const result = await updateActivity('activity-001', { status: 'DRAFT' });

    expect(result.status).toBe('DRAFT');
  });

  it('rejects status transitions from ONGOING with 400', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord({ status: 'ONGOING' }));
    const { updateActivity } = await loadUpdateService(prisma);

    await expect(updateActivity('activity-001', { status: 'SCHEDULED' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Activity status transition is not allowed.',
    });
    expect(prisma.activity.update).not.toHaveBeenCalled();
  });

  it.each(['SCHEDULED', 'DRAFT'] as const)(
    'accepts the same %s status as a no-op',
    async (status) => {
      const prisma = createUpdatePrismaMock();
      prisma.activity.findUnique.mockResolvedValue(updateRecord({ status }));
      prisma.activity.update.mockResolvedValue(updateRecord({ status }));
      prisma.attendance.count.mockResolvedValue(0);
      const { updateActivity } = await loadUpdateService(prisma);

      const result = await updateActivity('activity-001', { status, name: 'Mismo estado' });

      expect(result.status).toBe(status);
    },
  );

  it('rejects a date outside a non-default program range', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(
      updateRecord({
        status: 'DRAFT',
        eventProgram: {
          ...updateRecord().eventProgram,
          isDefault: false,
          startDate: new Date('2026-10-01T00:00:00.000Z'),
          endDate: new Date('2026-10-31T00:00:00.000Z'),
        },
      }),
    );
    const { updateActivity } = await loadUpdateService(prisma);

    await expect(updateActivity('activity-001', { date: '2026-11-15' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Activity date must be within the event program date range.',
    });
  });

  it('rejects a missing or inactive classroom when classroomId is provided', async () => {
    const missing = createUpdatePrismaMock();
    missing.activity.findUnique.mockResolvedValue(updateRecord({ status: 'DRAFT' }));
    missing.classroom.findUnique.mockResolvedValue(null);
    const { updateActivity: updateWithMissing } = await loadUpdateService(missing);

    await expect(
      updateWithMissing('activity-001', { classroomId: 'classroom-missing' }),
    ).rejects.toMatchObject({ statusCode: 404 });

    const inactive = createUpdatePrismaMock();
    inactive.activity.findUnique.mockResolvedValue(updateRecord({ status: 'DRAFT' }));
    inactive.classroom.findUnique.mockResolvedValue({
      id: 'classroom-001',
      isActive: false,
      capacity: 60,
    });
    const { updateActivity: updateWithInactive } = await loadUpdateService(inactive);

    await expect(
      updateWithInactive('activity-001', { classroomId: 'classroom-001' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects a classroom without an availability window that covers the schedule', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord());
    prisma.classroom.findUnique.mockResolvedValue({
      id: 'classroom-001',
      isActive: true,
      capacity: 60,
    });
    prisma.classroomAvailability.findFirst.mockResolvedValue(null);
    const { updateActivity } = await loadUpdateService(prisma);

    await expect(updateActivity('activity-001', { endTime: '18:00' })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Classroom is not available in the requested time window.',
    });
  });

  it('rejects an overlapping classroom reservation with 409', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord());
    prisma.classroom.findUnique.mockResolvedValue({
      id: 'classroom-001',
      isActive: true,
      capacity: 60,
    });
    prisma.classroomAvailability.findFirst.mockResolvedValue({ id: 'slot-001' });
    prisma.activity.findFirst.mockResolvedValue({ id: 'activity-999' });
    const { updateActivity } = await loadUpdateService(prisma);

    await expect(updateActivity('activity-001', { date: '2026-10-06' })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Classroom is already reserved for an overlapping activity.',
    });
  });

  it('rejects a classroom with less capacity than the activity', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord());
    prisma.classroom.findUnique.mockResolvedValue({
      id: 'classroom-001',
      isActive: true,
      capacity: 20,
    });
    const { updateActivity } = await loadUpdateService(prisma);

    await expect(updateActivity('activity-001', { maxCapacity: 30 })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Classroom capacity is below the activity capacity.',
    });
  });

  it('skips booking validation when the resulting status is DRAFT', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord({ status: 'DRAFT' }));
    prisma.activity.update.mockResolvedValue(updateRecord({ status: 'DRAFT' }));
    prisma.attendance.count.mockResolvedValue(0);
    const { updateActivity } = await loadUpdateService(prisma);

    await updateActivity('activity-001', { date: '2026-12-01' });

    expect(prisma.classroomAvailability.findFirst).not.toHaveBeenCalled();
    expect(prisma.activity.findFirst).not.toHaveBeenCalled();
  });

  it('clears the classroom with null without booking validation', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord());
    prisma.activity.update.mockResolvedValue(updateRecord({ classroom: null }));
    prisma.attendance.count.mockResolvedValue(0);
    const { updateActivity } = await loadUpdateService(prisma);

    await updateActivity('activity-001', { classroomId: null });

    expect(prisma.classroom.findUnique).not.toHaveBeenCalled();
    expect(prisma.activity.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ classroomId: null }) }),
    );
  });

  it('replaces equipment and speakers atomically', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord({ status: 'DRAFT' }));
    prisma.user.findMany.mockResolvedValue([{ id: 'user-001', email: 'ana@example.com' }]);
    prisma.activity.update.mockResolvedValue(updateRecord({ status: 'DRAFT' }));
    prisma.attendance.count.mockResolvedValue(0);
    const { updateActivity } = await loadUpdateService(prisma);

    await updateActivity('activity-001', {
      equipment: ['Pizarra'],
      speakers: [{ firstName: 'Ana', lastName: 'Gomez', email: 'ana@example.com' }],
    });

    expect(prisma.activity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          equipment: {
            deleteMany: {},
            createMany: { data: [{ name: 'Pizarra' }], skipDuplicates: true },
          },
          speakers: {
            deleteMany: {},
            create: [
              {
                speaker: {
                  connectOrCreate: {
                    where: { email: 'ana@example.com' },
                    create: {
                      firstName: 'Ana',
                      lastName: 'Gomez',
                      email: 'ana@example.com',
                      organization: null,
                      userId: 'user-001',
                    },
                  },
                },
              },
            ],
          },
        }),
      }),
    );
  });

  it('clears equipment and speakers with empty arrays', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord({ status: 'DRAFT' }));
    prisma.activity.update.mockResolvedValue(updateRecord({ status: 'DRAFT' }));
    prisma.attendance.count.mockResolvedValue(0);
    const { updateActivity } = await loadUpdateService(prisma);

    await updateActivity('activity-001', { equipment: [], speakers: [] });

    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.activity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          equipment: { deleteMany: {} },
          speakers: { deleteMany: {} },
        }),
      }),
    );
  });

  it('translates an exclusion constraint violation into a 409', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord());
    prisma.classroomAvailability.findFirst.mockResolvedValue({ id: 'slot-001' });
    prisma.activity.findFirst.mockResolvedValue(null);
    prisma.activity.update.mockRejectedValue({ code: '23P01' });
    const { updateActivity } = await loadUpdateService(prisma);

    await expect(updateActivity('activity-001', { date: '2026-10-06' })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Classroom is already reserved for an overlapping activity.',
    });
  });
});
```

- [ ] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/activities/activities.service.test.ts`
Expected: FAIL porque `updateActivity` no existe y el mock no expone los metodos.

- [ ] **Step 3: Implementar**

En `activities.service.ts`, agregar imports y helpers:

```ts
import { getInstitutionalDayOfWeek } from '../../utils/date.js';
import type {
  CreateActivityBody,
  ListActivitiesQuery,
  UpdateActivityBody,
} from './activities.schemas.js';
```

Despues de `toActivityDetail`:

```ts
const parseActivityDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

const parseActivityTime = (value: string): Date => new Date(`1970-01-01T${value}:00.000Z`);

const RESERVING_STATUSES = ['SCHEDULED', 'ONGOING'] as const;

const isExclusionViolation = (error: unknown): boolean => {
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

const assertActivityScheduleIsAvailable = async (input: {
  activityId: string;
  classroomId: string;
  date: Date;
  startTime: Date;
  endTime: Date;
  maxCapacity: number | null;
}): Promise<void> => {
  const prisma = getPrismaClient();

  const classroom = await prisma.classroom.findUnique({
    where: { id: input.classroomId },
    select: { id: true, isActive: true, capacity: true },
  });

  if (!classroom) {
    throw new ApiError(404, 'Classroom not found.');
  }
  if (!classroom.isActive) {
    throw new ApiError(400, 'Classroom is not active.');
  }
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
```

Y al final del archivo:

```ts
export const updateActivity = async (
  id: string,
  input: UpdateActivityBody,
): Promise<ActivityDetail> => {
  const prisma = getPrismaClient();

  const current = await prisma.activity.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      date: true,
      startTime: true,
      endTime: true,
      classroomId: true,
      maxCapacity: true,
      eventProgram: {
        select: {
          id: true,
          status: true,
          isDefault: true,
          startDate: true,
          endDate: true,
        },
      },
    },
  });

  if (!current) {
    throw new ApiError(404, 'Activity not found.');
  }
  if (current.status === 'COMPLETED' || current.status === 'CANCELLED') {
    throw new ApiError(409, 'Completed or cancelled activities cannot be modified.');
  }
  if (current.eventProgram.status !== 'ACTIVE') {
    throw new ApiError(409, 'Event programs must be active to modify their activities.');
  }

  const status = input.status ?? current.status;
  if (input.status !== undefined && input.status !== current.status) {
    const allowed =
      (current.status === 'DRAFT' && input.status === 'SCHEDULED') ||
      (current.status === 'SCHEDULED' && input.status === 'DRAFT');

    if (!allowed) {
      throw new ApiError(400, 'Activity status transition is not allowed.');
    }
  }

  const date = input.date !== undefined ? parseActivityDate(input.date) : current.date;
  const startTime =
    input.startTime !== undefined ? parseActivityTime(input.startTime) : current.startTime;
  const endTime = input.endTime !== undefined ? parseActivityTime(input.endTime) : current.endTime;

  if (endTime <= startTime) {
    throw new ApiError(400, 'End time must be after start time.');
  }

  if (
    input.date !== undefined &&
    !current.eventProgram.isDefault &&
    ((current.eventProgram.startDate && date < current.eventProgram.startDate) ||
      (current.eventProgram.endDate && date > current.eventProgram.endDate))
  ) {
    throw new ApiError(400, 'Activity date must be within the event program date range.');
  }

  const classroomId =
    input.classroomId !== undefined ? (input.classroomId ?? null) : current.classroomId;
  const maxCapacity =
    input.maxCapacity !== undefined ? (input.maxCapacity ?? null) : current.maxCapacity;
  const statusChanged = input.status !== undefined && input.status !== current.status;
  const scheduleChanged =
    input.date !== undefined || input.startTime !== undefined || input.endTime !== undefined;
  const classroomChanged = input.classroomId !== undefined;
  const requiresBooking =
    RESERVING_STATUSES.includes(status as (typeof RESERVING_STATUSES)[number]) &&
    (statusChanged || scheduleChanged || classroomChanged) &&
    classroomId !== null;

  if (requiresBooking && classroomId) {
    await assertActivityScheduleIsAvailable({
      activityId: id,
      classroomId,
      date,
      startTime,
      endTime,
      maxCapacity,
    });
  } else if (classroomChanged && classroomId) {
    const classroom = await prisma.classroom.findUnique({
      where: { id: classroomId },
      select: { id: true, isActive: true },
    });

    if (!classroom) {
      throw new ApiError(404, 'Classroom not found.');
    }
    if (!classroom.isActive) {
      throw new ApiError(400, 'Classroom is not active.');
    }
  }

  const data = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.type !== undefined ? { type: input.type } : {}),
    ...(input.date !== undefined ? { date } : {}),
    ...(input.startTime !== undefined ? { startTime } : {}),
    ...(input.endTime !== undefined ? { endTime } : {}),
    ...(input.maxCapacity !== undefined ? { maxCapacity } : {}),
    ...(input.bannerUrl !== undefined ? { bannerUrl: input.bannerUrl } : {}),
    ...(input.classroomId !== undefined ? { classroomId } : {}),
    ...(status !== current.status ? { status } : {}),
    ...(input.equipment !== undefined
      ? {
          equipment:
            input.equipment.length > 0
              ? {
                  deleteMany: {},
                  createMany: {
                    data: input.equipment.map((name) => ({ name })),
                    skipDuplicates: true,
                  },
                }
              : { deleteMany: {} },
        }
      : {}),
    ...(input.speakers !== undefined
      ? {
          speakers:
            input.speakers.length > 0
              ? { deleteMany: {}, create: await buildSpeakerCreates(input.speakers) }
              : { deleteMany: {} },
        }
      : {}),
  };

  let record: ActivityDetailRecord & {
    eventProgram: { status: string };
    _count: { attendance: number };
  };

  try {
    record = await prisma.activity.update({
      where: { id },
      data,
      select: activityDetailWithCountSelect,
    });
  } catch (error) {
    if (isExclusionViolation(error)) {
      throw new ApiError(409, 'Classroom is already reserved for an overlapping activity.');
    }
    throw error;
  }

  const checkedInCount = await prisma.attendance.count({
    where: { activityId: id, checkedInAt: { not: null } },
  });

  return toActivityDetail(record, record._count.attendance, checkedInCount);
};
```

Ajustar el tipo de `record` al tipado real del select (`ActivityDetailRecord & { eventProgram: { status: ProgramStatus }, _count: { attendance: number } }`) importando `ProgramStatus`; el typecheck manda.

- [ ] **Step 4: Verificar el verde**

Run: `pnpm exec vitest run src/modules/activities/activities.service.test.ts`
Expected: PASS.

---

### Task 4: Controlador y ruta (TDD)

**Files:**

- Modify: `src/modules/activities/activities.controller.ts`
- Modify: `src/modules/activities/activities.routes.ts`
- Test: `src/modules/activities/activities.routes.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

Extender `ActivitiesServiceMock` con `updateActivity: vi.fn()` y agregar:

```ts
it('rejects update requests without a token', async () => {
  const service = buildServiceMock();
  const app = await loadApp({ service });

  await request(app)
    .patch('/api/v1/activities/activity-002')
    .send({ name: 'Nuevo nombre' })
    .expect(401);
  expect(service.updateActivity).not.toHaveBeenCalled();
});

it('rejects update requests when the user lacks activity:update', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(userRecord);
  const authorization: AuthorizationMock = {
    getEffectivePermissions: vi.fn().mockResolvedValue(new Set()),
  };
  const app = await loadApp({ service, prisma, authorization });

  await request(app)
    .patch('/api/v1/activities/activity-002')
    .set('Authorization', `Bearer ${userToken}`)
    .send({ name: 'Nuevo nombre' })
    .expect(403);
  expect(service.updateActivity).not.toHaveBeenCalled();
});

it('updates an activity for a collaborator with activity:update in the activity scope', async () => {
  const service = buildServiceMock();
  service.updateActivity.mockResolvedValue(activityDetail);
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(userRecord);
  const authorization: AuthorizationMock = {
    getEffectivePermissions: vi.fn().mockResolvedValue(new Set(['activity:update'])),
  };
  const app = await loadApp({ service, prisma, authorization });

  const response = await request(app)
    .patch('/api/v1/activities/activity-002')
    .set('Authorization', `Bearer ${userToken}`)
    .send({ name: '  Nuevo nombre  ', maxCapacity: 25 })
    .expect(200);

  expect(authorization.getEffectivePermissions).toHaveBeenCalledWith(userRecord, {
    activityId: 'activity-002',
  });
  expect(service.updateActivity).toHaveBeenCalledWith('activity-002', {
    name: 'Nuevo nombre',
    maxCapacity: 25,
  });
  expect(response.body).toEqual({
    success: true,
    message: 'Activity updated successfully.',
    data: activityDetail,
  });
});

it('updates an activity for an admin without a permission lookup', async () => {
  const service = buildServiceMock();
  service.updateActivity.mockResolvedValue(activityDetail);
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminRecord);
  const authorization: AuthorizationMock = {
    getEffectivePermissions: vi.fn().mockResolvedValue(new Set()),
  };
  const app = await loadApp({ service, prisma, authorization });

  await request(app)
    .patch('/api/v1/activities/activity-002')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ status: 'SCHEDULED' })
    .expect(200);

  expect(authorization.getEffectivePermissions).not.toHaveBeenCalled();
  expect(service.updateActivity).toHaveBeenCalledWith('activity-002', { status: 'SCHEDULED' });
});

it('rejects update bodies without fields or with unknown keys before the service', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminRecord);
  const app = await loadApp({ service, prisma });

  await request(app)
    .patch('/api/v1/activities/activity-002')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({})
    .expect(400);
  await request(app)
    .patch('/api/v1/activities/activity-002')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ eventProgramId: 'program-002' })
    .expect(400);

  expect(service.updateActivity).not.toHaveBeenCalled();
});

it('rejects a blank activity id on update before the service', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminRecord);
  const app = await loadApp({ service, prisma });

  await request(app)
    .patch('/api/v1/activities/%20')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'X' })
    .expect(400);

  expect(service.updateActivity).not.toHaveBeenCalled();
});

it('propagates the service 404 and 409 errors on update', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminRecord);
  const app = await loadApp({ service, prisma });
  const { ApiError } = await import('../../utils/ApiError.js');

  service.updateActivity.mockRejectedValue(new ApiError(404, 'Activity not found.'));
  await request(app)
    .patch('/api/v1/activities/missing')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'X' })
    .expect(404);

  service.updateActivity.mockRejectedValue(
    new ApiError(409, 'Completed or cancelled activities cannot be modified.'),
  );
  const conflict = await request(app)
    .patch('/api/v1/activities/activity-002')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'X' })
    .expect(409);

  expect(conflict.body).toMatchObject({
    success: false,
    message: 'Completed or cancelled activities cannot be modified.',
  });
});
```

- [ ] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/activities/activities.routes.test.ts`
Expected: FAIL porque la ruta no existe (404) y el mock no expone `updateActivity`.

- [ ] **Step 3: Implementar**

Controlador:

```ts
export const updateActivity: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as ActivityParams;
  const body = req.body as UpdateActivityBody;
  const result = await updateActivityService(id, body);

  res.status(200).json(successResponse('Activity updated successfully.', result));
});
```

Ruta:

```ts
const activityScope: ScopeResolver = (req) => {
  const id = (req.params as { id?: string }).id;

  return typeof id === 'string' && id.length > 0 ? { activityId: id } : undefined;
};

activitiesRoutes.patch(
  '/activities/:id',
  authenticate,
  requirePermission(PERMISSIONS.ACTIVITY_UPDATE, activityScope),
  validate(updateActivitySchema),
  updateActivity,
);
```

- [ ] **Step 4: Verificar el verde**

Run: `pnpm exec vitest run src/modules/activities/activities.routes.test.ts`
Expected: PASS.

---

### Task 5: OpenAPI y contrato

**Files:**

- Modify: `src/modules/activities/activities.openapi.ts`
- Modify: `src/docs/openapi.test.ts`
- Regenerate: `openapi.json`

- [ ] **Step 1: Agregar la operacion**

En `activitiesPaths['/api/v1/activities/{id}']`, despues de `get`:

```ts
    patch: {
      tags: ['Activities'],
      summary: 'Update an activity',
      description:
        'Partially updates an activity. Requires the activity:update permission on the activity scope (or the ADMIN role). COMPLETED and CANCELLED activities respond 409. The status field accepts DRAFT or SCHEDULED to unpublish or publish; ONGOING, COMPLETED and CANCELLED are rejected. When the resulting activity reserves a classroom (SCHEDULED/ONGOING), the availability window, overlaps and classroom capacity are validated. Event program is immutable.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: activityParamsSchema.shape.params },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: updateActivitySchema.shape.body } },
      },
      responses: {
        200: {
          description: 'Activity updated successfully.',
          content: { 'application/json': { schema: apiSuccessResponse(activityDetailSchema) } },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
```

Agregar `updateActivitySchema` al import.

- [ ] **Step 2: Actualizar el test de contrato**

En `openapi.test.ts`: agregar `'PATCH /api/v1/activities/{id}'` a `expectedOperations` y:

```ts
it('documents the activity update with bearer security and its conflicts', () => {
  const operation = openApiDocument.paths?.['/api/v1/activities/{id}']?.patch;

  expect(operation?.security).toEqual([{ bearerAuth: [] }]);
  expect(operation?.responses?.['200']).toBeDefined();
  expect(operation?.responses?.['400']).toBeDefined();
  expect(operation?.responses?.['401']).toBeDefined();
  expect(operation?.responses?.['403']).toBeDefined();
  expect(operation?.responses?.['404']).toBeDefined();
  expect(operation?.responses?.['409']).toBeDefined();
});
```

- [ ] **Step 3: Regenerar y verificar**

Run: `pnpm exec vitest run src/docs/openapi.test.ts && pnpm run docs:generate && pnpm run docs:check`
Expected: PASS y sin drift.

---

### Task 6: Bruno y documentacion

**Files:**

- Create: `bruno/Activities/Log in as a user without permission.bru` (seq 9)
- Create: `bruno/Activities/Update a draft activity.bru` (seq 10)
- Create: `bruno/Activities/Publish a draft activity.bru` (seq 11)
- Create: `bruno/Activities/Update a completed activity returns 409.bru` (seq 12)
- Create: `bruno/Activities/Update an activity without a token returns 401.bru` (seq 13)
- Create: `bruno/Activities/Update an unknown activity returns 404.bru` (seq 14)
- Create: `bruno/Activities/Update an activity as a user without permission returns 403.bru` (seq 15)
- Modify: `README.md`, `CONTEXT.md`

- [ ] **Step 1: Requests Bruno**

Cada request PATCH usa `auth: bearer` con `{{token}}` y `body: json`; capturar `userToken` en el login sin permiso (`/auth/login` con `userEmail`/`userPassword`). Tests: status, `success`, `data.status`/`data.name` y ausencia de campos sensibles. El request de conflicto usa `{{seedActivityId}}` (COMPLETED); el 404 usa `{{unknownActivityId}}`; el 403 usa `{{userToken}}`; el 400 de `status: ONGOING` puede ir dentro del request de update de draft con un segundo request o reutilizar el 409 (decidir en ejecucion con seq 16 si hace falta).

- [ ] **Step 2: Documentar**

README (seccion Actividades) y CONTEXT: describir el PATCH, las transiciones `DRAFT <-> SCHEDULED`, el `409` de `COMPLETED`/`CANCELLED`, la validacion de aula/ventana/solape/capacidad y el reemplazo total de `speakers`/`equipment`.

- [ ] **Step 3: Correr Bruno**

Run: `pnpm --dir bruno exec bru run Activities --env local`
Expected: todos los requests/tests en verde. Limpiar despues las actividades draft creadas por Bruno con psql (ver T7).

---

### Task 7: Verificacion real, gates y cierre

- [ ] **Step 1: Gates**

Run: `pnpm test`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, `pnpm run build`, `pnpm run docs:check`
Expected: todo en verde.

- [ ] **Step 2: E2E Docker + psql**

Con el stack dev arriba: login admin; crear draft temporal; PATCH nombre/equipo/ponentes (verificar en psql); publicar (verificar `status=SCHEDULED` y reserva de aula); solape con `lab-electronica` en la fecha/hora de `fic-taller-drones` -> `409`; `COMPLETED` -> `409`; `status: ONGOING` -> `400`; sin token -> `401`; USER sin permiso (`estudiante01`) -> `403`; id desconocido -> `404`; aula sin ventana -> `409`. Restaurar/limpiar filas temporales con psql y confirmar conteos.

- [ ] **Step 3: Registro**

Marcar `5.2` en `docs/superpowers/plans/plan-maestro-sipeg-utp.md`, actualizar el estado de Actividades y agregar la bitacora de ejecucion (pruebas, gates, E2E, Bruno, hallazgos). Sin commit salvo pedido explicito.
