# Fase 2.C - Aulas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los checklist 2.C.1 a 2.C.5 del plan maestro implementando el modulo `classrooms`: listado publico paginado con filtros, detalle con amenidades y ventanas, creacion/actualizacion solo ADMIN, gestion de amenidades y ventanas de disponibilidad sin duplicados ni solapes, y consulta de aulas disponibles por fecha, hora, capacidad, tipo y amenidad considerando la ventana semanal y las actividades `SCHEDULED`/`ONGOING`.

**Architecture:** Modulo autocontenido `src/modules/classrooms/` con el patron de `organizational-units`/`users`: `authenticate -> requireAdmin -> validate -> controlador -> servicio -> Prisma` para escrituras; lecturas publicas. Las mutaciones devuelven `ClassroomDetail` para que exista una unica superficie de lectura. La disponibilidad de aulas se deriva de `classroom_availability` (ventana semanal recurrente) y de las actividades que reservan aula (`SCHEDULED`/`ONGOING`, consistente con la restriccion de exclusion `activities_classroom_no_overlap` de la BD).

**Tech Stack:** TypeScript 6, Express 5, Prisma 7 (SQL/Postgres), Zod 4, Vitest, Supertest, OpenAPI 3.1 (zod-openapi), Bruno.

**Hallazgos de partida (2026-09-20):**

- No existe `src/modules/classrooms/`. El modelo `Classroom` ya tiene `name` (VarChar 50), `type` (`LABORATORY`/`CLASSROOM`), `capacity`, `building` (VarChar 50), `floor`, `isActive`, `amenities` (PK `classroomId+amenity`, VarChar 50) y `availability` (`dayOfWeek`, `startTime`/`endTime` `Time(3)`, `period` VarChar 30, unico por `classroomId+dayOfWeek+startTime+endTime`).
- `prisma/seed/classrooms.seed.ts` siembra 10 aulas con amenidades y ventanas (`dayOfWeek` 1-5 laborables, 6 sabado) y el seed base las crea en modo `ensure`.
- La migracion `20260919053739_initialize_event_program_schema` define `activities_classroom_no_overlap`: exclusion GiST por aula, fecha e intervalo `[)` que solo aplica a `status IN ('SCHEDULED','ONGOING')`. Las actividades `DRAFT`, `COMPLETED` y `CANCELLED` no reservan aula.
- `src/utils/date.ts` concentra las fechas institucionales (`America/Panama`); `src/utils/date.test.ts` ya existe.
- Patron de pruebas: `organizational-units.routes.test.ts` (JWT real con `jose`, `vi.doMock` de Prisma y del verificador) y `organizational-units.service.test.ts` (`vi.doMock('../../config/prisma.js')`).
- Baseline de calidad al 2026-09-20 (rama `dev`): `pnpm test` 557 pruebas en 38 archivos en verde.

**Decisiones confirmadas (2026-09-20):**

1. `GET /classrooms/:id` devuelve detalle con amenidades y ventanas; el listado incluye amenidades.
2. `PATCH /classrooms/:id` permite `isActive`; desactivar con actividades `SCHEDULED`/`ONGOING` responde 409 (espejo de 2.A.5).
3. `GET /classrooms/available` exige `date`, `startTime` y `endTime`; opcionales `minCapacity`, `type` y `amenity`.
4. `dayOfWeek` ISO-8601: 1=lunes ... 7=domingo.
5. Amenidad duplicada case-insensitive responde 409; se conserva el formato original.
6. Sin cambios de esquema, migraciones, variables de entorno ni catalogo de permisos (decision 7 del maestro: catalogos solo ADMIN). No se expone `DELETE /classrooms/:id`.

**Reglas de negocio:**

- **Ventana cubre solicitud:** `availability.startTime <= startTime` y `availability.endTime >= endTime` en el mismo `dayOfWeek` (fronteras inclusivas).
- **Solape de ventanas:** existe si `newStart < existing.endTime && newEnd > existing.startTime` en el mismo aula y dia (intervalos semiabiertos: 07:00-12:00 y 12:00-17:00 conviven).
- **Bloqueo de aula:** una actividad bloquea si su `date` es la fecha solicitada, su `status` es `SCHEDULED`/`ONGOING` y su intervalo horario solapa la solicitud.
- **Dia institucional:** `date` es un dia calendario de `America/Panama`; `dayOfWeek` se deriva de esa fecha con `institutionalDayOfWeek` (sin ambiguedad horaria).
- **Amenidades:** `trim` + colapso de espacios internos, 1-50 caracteres, formato `^\p{L}\p{N}[\p{L}\p{N} -]*$`; duplicado case-insensitive 409; el borrado busca case-insensitive y elimina la fila almacenada.

---

### Task 1: Utilidad `institutionalDayOfWeek` (TDD)

**Files:**

- Modify: `src/utils/date.ts`
- Test: `src/utils/date.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

Agregar a `src/utils/date.test.ts`:

```ts
import { getInstitutionalDayOfWeek, ... } from './date.js';

describe('getInstitutionalDayOfWeek', () => {
  it('maps weekdays with ISO numbering', () => {
    expect(getInstitutionalDayOfWeek('2026-09-21')).toBe(1); // lunes
    expect(getInstitutionalDayOfWeek('2026-09-26')).toBe(6); // sabado
  });

  it('maps Sunday to 7', () => {
    expect(getInstitutionalDayOfWeek('2026-09-27')).toBe(7); // domingo
  });

  it('is independent from the process time zone', () => {
    expect(getInstitutionalDayOfWeek('2026-01-01')).toBe(4); // jueves
  });
});
```

- [ ] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/utils/date.test.ts`
Expected: FAIL porque `getInstitutionalDayOfWeek` no existe.

- [ ] **Step 3: Implementar**

Agregar a `src/utils/date.ts`:

```ts
export const getInstitutionalDayOfWeek = (dateKey: string): number => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const dayOfWeek = new Date(
    Date.UTC(year as number, (month as number) - 1, day as number),
  ).getUTCDay();

  return dayOfWeek === 0 ? 7 : dayOfWeek;
};
```

- [ ] **Step 4: Verificar el verde**

Run: `pnpm exec vitest run src/utils/date.test.ts`
Expected: PASS.

---

### Task 2: Tipos y esquemas Zod (TDD)

**Files:**

- Create: `src/modules/classrooms/classrooms.types.ts`
- Create: `src/modules/classrooms/classrooms.schemas.ts`
- Test: `src/modules/classrooms/classrooms.schemas.test.ts`

- [ ] **Step 1: Escribir los tipos**

`classrooms.types.ts`:

```ts
import type { ClassroomType } from '../../generated/prisma/enums.js';

export interface ClassroomAvailabilitySlot {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  period: string | null;
}

export interface ClassroomSummary {
  id: string;
  name: string;
  type: ClassroomType;
  capacity: number;
  building: string | null;
  floor: number | null;
  isActive: boolean;
  amenities: string[];
}

export interface ClassroomDetail extends ClassroomSummary {
  availability: ClassroomAvailabilitySlot[];
}

export interface PaginatedClassrooms {
  items: ClassroomSummary[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CreateClassroomInput {
  name: string;
  type: ClassroomType;
  capacity: number;
  building?: string | null;
  floor?: number | null;
  isActive?: boolean;
}

export interface UpdateClassroomInput {
  name?: string;
  type?: ClassroomType;
  capacity?: number;
  building?: string | null;
  floor?: number | null;
  isActive?: boolean;
}

export interface AddClassroomAvailabilityInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  period?: string | null;
}
```

- [ ] **Step 2: Escribir esquemas compartidos y de escritura**

`classrooms.schemas.ts` (extracto con las reglas clave):

```ts
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const amenityPattern = /^[\p{L}\p{N}][\p{L}\p{N} -]*$/u;

const normalizeAmenity = (value: string): string => value.trim().replace(/\s+/g, ' ');

const amenitySchema = z
  .string()
  .transform(normalizeAmenity)
  .refine((value) => value.length >= 1, 'Amenity is required.')
  .refine((value) => value.length <= 50, 'Amenity cannot exceed 50 characters.')
  .refine(
    (value) => amenityPattern.test(value),
    'Amenity may only contain letters, numbers, spaces and hyphens.',
  );

export const listClassroomsQuerySchema = z.object({
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(20),
      type: z.enum(['LABORATORY', 'CLASSROOM'], 'Classroom type is invalid.').optional(),
      minCapacity: z.coerce
        .number()
        .int()
        .positive('Minimum capacity must be greater than 0.')
        .optional(),
      amenity: amenitySchema.optional(),
      isActive: z
        .enum(['true', 'false'], 'Status must be true or false.')
        .transform((v) => v === 'true')
        .optional(),
    })
    .strict(),
});

export const availableClassroomsQuerySchema = z.object({
  query: z
    .object({
      date: z
        .string()
        .regex(datePattern)
        .refine(isValidCalendarDate, 'Date must be a valid calendar date.'),
      startTime: z.string().regex(timePattern, 'Start time must be in HH:mm format.'),
      endTime: z.string().regex(timePattern, 'End time must be in HH:mm format.'),
      minCapacity: z.coerce
        .number()
        .int()
        .positive('Minimum capacity must be greater than 0.')
        .optional(),
      type: z.enum(['LABORATORY', 'CLASSROOM'], 'Classroom type is invalid.').optional(),
      amenity: amenitySchema.optional(),
    })
    .strict()
    .refine((v) => v.endTime > v.startTime, {
      message: 'End time must be after start time.',
      path: ['endTime'],
    }),
});

export const createClassroomSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(1).max(50),
      type: z.enum(['LABORATORY', 'CLASSROOM'], 'Classroom type is invalid.'),
      capacity: z.number().int().positive().max(100000),
      building: z.string().trim().max(50).nullish(),
      floor: z.number().int().min(-5).max(100).nullish(),
      isActive: z.boolean().optional(),
    })
    .strict(),
});

export const updateClassroomSchema = z.object({
  params: z.object({ id: classroomIdSchema }),
  body: createClassroomSchema.shape.body
    .partial()
    .refine((body) => Object.keys(body).length > 0, 'At least one field must be provided.'),
});

export const addClassroomAmenitySchema = z.object({
  params: z.object({ id: classroomIdSchema }),
  body: z.object({ amenity: amenitySchema }).strict(),
});

export const addClassroomAvailabilitySchema = z.object({
  params: z.object({ id: classroomIdSchema }),
  body: z
    .object({
      dayOfWeek: z.number().int().min(1).max(7, 'Day of week must be between 1 and 7.'),
      startTime: z.string().regex(timePattern, 'Start time must be in HH:mm format.'),
      endTime: z.string().regex(timePattern, 'End time must be in HH:mm format.'),
      period: z.string().trim().max(30).nullish(),
    })
    .strict()
    .refine((v) => v.endTime > v.startTime, {
      message: 'End time must be after start time.',
      path: ['endTime'],
    }),
});
```

Ademas: `classroomParamsSchema`, `classroomAvailabilityParamsSchema` (`id` + `availabilityId` 1-100), `classroomAmenityParamsSchema` (`id` + `amenity` normalizada), y los esquemas de respuesta con `.meta({ id })`:

- `classroomAvailabilitySchema` → `ClassroomAvailability`
- `classroomSummarySchema` → `ClassroomSummary` (`satisfies z.ZodType<ClassroomSummary>`)
- `classroomDetailSchema` → `ClassroomDetail`
- `paginatedClassroomsSchema` → `PaginatedClassrooms`

- [ ] **Step 3: Escribir las pruebas de esquema**

`classrooms.schemas.test.ts` cubre:

1. Listado: coercion de `page`/`limit`, rechazo de `limit=51`, `isActive` transformado a booleano, `.strict()` rechaza claves desconocidas, amenidad normalizada.
2. Disponibles: `date` invalida (2026-02-30) falla, `endTime <= startTime` falla, filtros opcionales.
3. Create/update: body vacio en update falla, `capacity` 0 falla, `floor` no entero falla, claves desconocidas fallan, `name` con trim.
4. Amenidades: `"  Aire   Acondicionado "` normaliza a `"Aire Acondicionado"`, amenidad con `@` falla, >50 caracteres falla.
5. Ventanas: `dayOfWeek` 0 y 8 fallan, `startTime >= endTime` falla, `period` >30 falla.

- [ ] **Step 4: Verificar rojo y luego verde**

Run: `pnpm exec vitest run src/modules/classrooms/classrooms.schemas.test.ts`
Expected: primero FAIL por archivos inexistentes; tras implementar, PASS.

---

### Task 3: Servicio CRUD (TDD)

**Files:**

- Create: `src/modules/classrooms/classrooms.service.ts`
- Test: `src/modules/classrooms/classrooms.service.test.ts`

Selects:

```ts
const classroomSummarySelect = {
  id: true,
  name: true,
  type: true,
  capacity: true,
  building: true,
  floor: true,
  isActive: true,
  amenities: { select: { amenity: true }, orderBy: { amenity: 'asc' } },
} as const;

const classroomDetailSelect = {
  ...classroomSummarySelect,
  availability: {
    select: { id: true, dayOfWeek: true, startTime: true, endTime: true, period: true },
    orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
  },
} as const;
```

Mapeo de horas: `formatTime = (value: Date) => value.toISOString().slice(11, 16)` (igual que `activities.service.ts`).

Funciones y reglas:

- `listClassrooms(query)`: `where.isActive = query.isActive ?? true`; `type`; `capacity: { gte: minCapacity }`; `amenities: { some: { amenity: { equals, mode: 'insensitive' } } }`; orden `name asc, id asc`; paginacion offset y `totalPages`.
- `getClassroomById(id)`: `findUnique`; `404 Classroom not found.`.
- `createClassroom(input)`: `create` con `isActive: input.isActive ?? true`; `building`/`floor` `?? null`.
- `updateClassroom(id, input)`: `findUnique` (404) y `update` solo con claves provistas.
- `assertClassroomDeactivationAllowed`: si `input.isActive === false`, contar actividades `where: { classroomId, status: { in: ['SCHEDULED','ONGOING'] } }`; si >0 → `409 Cannot deactivate a classroom with scheduled or ongoing activities.`.
- `isUniqueConstraintViolation` reutilizado del patron de unidades (P2002 → 409 si aplica).

Pruebas (`classrooms.service.test.ts`, Prisma mockeado con `vi.doMock('../../config/prisma.js')`):

1. Listado por defecto filtra `isActive: true` y mapea amenidades.
2. Listado con `type`, `minCapacity`, `amenity` (case-insensitive) y `isActive: false`.
3. Paginacion: `skip`/`take`, `totalPages` con y sin resultados.
4. Detalle 404 y detalle con ventanas ordenadas.
5. Create usa defaults (`isActive: true`, `building/floor null`) y devuelve detalle.
6. Update parcial solo envia claves provistas; 404 si no existe.
7. Update `isActive: false` con actividad `SCHEDULED` → 409; sin actividades → actualiza.

---

### Task 4: Servicio de amenidades (TDD)

**Files:**

- Modify: `src/modules/classrooms/classrooms.service.ts`
- Test: `src/modules/classrooms/classrooms.service.test.ts`

- `addClassroomAmenity(classroomId, amenity)`:
  1. `findUnique` aula → 404.
  2. `classroomAmenity.findFirst({ where: { classroomId, amenity: { equals, mode: 'insensitive' } } })` → `409 Amenity already exists for this classroom.`.
  3. `classroomAmenity.create({ data: { classroomId, amenity } })` (casing original) y devolver detalle.
  4. Catch `P2002` → 409 (carrera).
- `removeClassroomAmenity(classroomId, amenity)`:
  1. `findUnique` aula → 404.
  2. `findFirst` case-insensitive → si no existe `404 Amenity not found.`.
  3. `delete` por PK con el valor almacenado; devolver detalle.

Pruebas: 404 de aula; duplicado exacto y con distinto casing → 409 sin `create`; alta conserva casing; borrado con casing distinto elimina la fila almacenada; amenidad inexistente → 404.

---

### Task 5: Servicio de ventanas (TDD)

**Files:**

- Modify: `src/modules/classrooms/classrooms.service.ts`
- Test: `src/modules/classrooms/classrooms.service.test.ts`

- `addClassroomAvailability(classroomId, input)`:
  1. Aula → 404 (`Classroom not found.`).
  2. `startTime`/`endTime` como `new Date(\`1970-01-01T${hh:mm}:00.000Z\`)`.
  3. Solape: `findFirst({ where: { classroomId, dayOfWeek, startTime: { lt: endTime }, endTime: { gt: startTime } } })` → `409 Classroom availability overlaps an existing window.`.
  4. `create` con `period ?? null`; devolver detalle.
  5. Catch `P2002` → 409.
- `removeClassroomAvailability(classroomId, availabilityId)`:
  1. Aula → 404.
  2. `findFirst({ where: { id: availabilityId, classroomId } })` → `404 Classroom availability not found.`.
  3. `delete`; devolver detalle.

Pruebas: frontera `07:00-12:00` vs `12:00-17:00` no solapa (se crea); solape interno (`09:00-11:00`) y solape envolvente → 409; otro dia no solapa; aula/ventana inexistente → 404.

---

### Task 6: Servicio de aulas disponibles (TDD)

**Files:**

- Modify: `src/modules/classrooms/classrooms.service.ts`
- Test: `src/modules/classrooms/classrooms.service.test.ts`

`findAvailableClassrooms(query)`:

```ts
const dayOfWeek = getInstitutionalDayOfWeek(query.date);
const date = new Date(`${query.date}T00:00:00.000Z`);
const startTime = new Date(`1970-01-01T${query.startTime}:00.000Z`);
const endTime = new Date(`1970-01-01T${query.endTime}:00.000Z`);

const candidates = await prisma.classroom.findMany({
  where: {
    isActive: true,
    ...(query.type ? { type: query.type } : {}),
    ...(query.minCapacity ? { capacity: { gte: query.minCapacity } } : {}),
    ...(query.amenity
      ? { amenities: { some: { amenity: { equals: query.amenity, mode: 'insensitive' } } } }
      : {}),
    availability: {
      some: { dayOfWeek, startTime: { lte: startTime }, endTime: { gte: endTime } },
    },
  },
  orderBy: [{ capacity: 'asc' }, { name: 'asc' }, { id: 'asc' }],
  select: classroomSummarySelect,
});

const blocking = await prisma.activity.findMany({
  where: {
    date,
    status: { in: ['SCHEDULED', 'ONGOING'] },
    classroomId: { in: candidates.map((item) => item.id) },
    startTime: { lt: endTime },
    endTime: { gt: startTime },
  },
  select: { classroomId: true },
  distinct: ['classroomId'],
});

const blocked = new Set(blocking.map((item) => item.classroomId));
return candidates.filter((item) => !blocked.has(item.id));
```

Si no hay candidatos, no se consulta `activity` (evita `in: []`).

Pruebas: ventana que cubre exacto (`07:00-12:00` cubre `07:00-08:00` y `11:00-12:00`); ventana que no cubre (`12:30`); actividad `SCHEDULED` con solape excluye el aula; actividad `ONGOING` tambien; actividad en otro dia no excluye; `CANCELLED`/`COMPLETED`/`DRAFT` no aparecen en la consulta de bloqueo (verificar `where.status`); filtros `minCapacity`, `type`, `amenity`; `dayOfWeek` derivado (lunes y domingo); sin candidatos no consulta actividades.

---

### Task 7: Controlador, rutas y tests de ruta

**Files:**

- Create: `src/modules/classrooms/classrooms.controller.ts`
- Create: `src/modules/classrooms/classrooms.routes.ts`
- Create: `src/modules/classrooms/classrooms.routes.test.ts`
- Modify: `src/routes.ts`

Rutas (orden critico: `available` antes de `:id`):

```ts
classroomsRoutes.get('/classrooms', validate(listClassroomsQuerySchema), getClassrooms);
classroomsRoutes.get(
  '/classrooms/available',
  validate(availableClassroomsQuerySchema),
  getAvailableClassrooms,
);
classroomsRoutes.get('/classrooms/:id', validate(classroomParamsSchema), getClassroom);
classroomsRoutes.post(
  '/classrooms',
  authenticate,
  requireAdmin,
  validate(createClassroomSchema),
  createClassroom,
);
classroomsRoutes.patch(
  '/classrooms/:id',
  authenticate,
  requireAdmin,
  validate(updateClassroomSchema),
  updateClassroom,
);
classroomsRoutes.post(
  '/classrooms/:id/amenities',
  authenticate,
  requireAdmin,
  validate(addClassroomAmenitySchema),
  addClassroomAmenity,
);
classroomsRoutes.delete(
  '/classrooms/:id/amenities/:amenity',
  authenticate,
  requireAdmin,
  validate(classroomAmenityParamsSchema),
  removeClassroomAmenity,
);
classroomsRoutes.post(
  '/classrooms/:id/availability',
  authenticate,
  requireAdmin,
  validate(addClassroomAvailabilitySchema),
  addClassroomAvailability,
);
classroomsRoutes.delete(
  '/classrooms/:id/availability/:availabilityId',
  authenticate,
  requireAdmin,
  validate(classroomAvailabilityParamsSchema),
  removeClassroomAvailability,
);
```

Mensajes: `'Classrooms retrieved successfully.'`, `'Available classrooms retrieved successfully.'`, `'Classroom retrieved successfully.'`, `'Classroom created successfully.'` (201), `'Classroom updated successfully.'`, `'Classroom amenity added successfully.'` (201), `'Classroom amenity removed successfully.'`, `'Classroom availability added successfully.'` (201), `'Classroom availability removed successfully.'`.

Tests de ruta (patron `organizational-units.routes.test.ts`): admin y USER con JWT EdDSA real, Prisma mockeado, retorno de array crudo en `findMany` de actividades.

1. `POST /classrooms` sin token 401 y como USER 403 (el servicio no se invoca).
2. `POST /classrooms` admin 201 y body estricto (clave desconocida → 400).
3. `PATCH /classrooms/:id` admin 200; 404 desconocido.
4. `GET /classrooms` publico 200 sin bearer; filtros de query invalidos 400 (`limit=51`).
5. `GET /classrooms/available` responde la ruta correcta (no es interpretada como `:id`) aun con `id` desconocido; 400 si `endTime <= startTime`.
6. `GET /classrooms/:id` publico 200 y 404.
7. Amenidades: 201, 409, 404; USER 403.
8. Ventanas: 201, 409, 404; USER 403.
9. Montaje en `src/routes.ts` (agregar `apiRoutes.use(classroomsRoutes)`).

---

### Task 8: OpenAPI

**Files:**

- Create: `src/modules/classrooms/classrooms.openapi.ts`
- Modify: `src/docs/openapi.ts`
- Modify: `src/docs/openapi.test.ts`

- Tag `Classrooms` (`'Classroom catalog, amenities, availability and scheduling.'`).
- Registrar `classroomsPaths`.
- Documentar seguridad bearer en las 6 operaciones privadas, `201` en las tres creaciones, `409` en create/update-desactivar/amenidad duplicada/ventana solapada, `400` en query invalida y `404` donde aplica.
- `openapi.test.ts`: agregar las 9 operaciones al arreglo `expectedOperations` y pruebas de contrato: componentes `ClassroomSummary`, `ClassroomDetail`, `ClassroomAvailability`, `PaginatedClassrooms`; lecturas sin bearer; escrituras con bearer; query de `available` con `date`/`startTime`/`endTime`.
- Run: `pnpm run docs:generate && pnpm run docs:check && pnpm exec vitest run src/docs/openapi.test.ts`.

---

### Task 9: Coleccion Bruno

**Files:**

- Create: `bruno/Classrooms/` (folder.bru + requests)
- Modify: `bruno/environments/local.bru`

Variables nuevas: `classroomId: seed_classroom_aula-101`, `newClassroomId:`, `unknownClassroomId: classroom-does-not-exist`, `availabilityId:`.

Requests (~19):

1. Log in as admin (seq 1, captura `adminToken`).
2. Log in as a regular user (seq 2, captura `regularToken`).
3. List classrooms (seq 3).
4. List classrooms with filters (seq 4).
5. Get a classroom (seq 5).
6. Create a classroom (seq 6, `script:pre-request` con nombre unico, captura `newClassroomId`).
7. Update a classroom (seq 7).
8. Create a classroom as USER returns 403 (seq 8).
9. Create a classroom without a token returns 401 (seq 9).
10. Get an unknown classroom returns 404 (seq 10).
11. Add an amenity (seq 11).
12. Add a duplicate amenity returns 409 (seq 12, casing distinto).
13. Remove an amenity (seq 13).
14. Add an availability window (seq 14, captura `availabilityId`).
15. Add an overlapping window returns 409 (seq 15).
16. Remove an availability window (seq 16).
17. List available classrooms (seq 17).
18. List available classrooms with filters (seq 18).
19. List available classrooms with an invalid range returns 400 (seq 19).

Run: `pnpm --dir bruno exec bru run Classrooms --env local`
Expected: 19 requests en verde.

---

### Task 10: Verificacion real contra el stack local

**Files:**

- Create temporal: `.tmp-2c-integration.mts` (se elimina al terminar)

- [ ] Confirmar stack: `docker compose -f compose.dev.yaml ps` y `pnpm run api:run:smoke`.
- [ ] Script: login admin + USER; aula temporal `TMP-<timestamp>`; create/patch/detalle/listado con filtros; amenidad duplicada case-insensitive 409 y borrado; ventana lunes `08:00-10:00`, solape 409, adyacente `10:00-12:00` 201 y borrado; `available` contra una fecha con dia de semana sembrado; contraste psql de filas; 401/403/404/400; desactivar con actividad `SCHEDULED` 409 (si hay aula sembrada con actividad futura, solo lectura).
- [ ] Limpieza: `DELETE FROM classrooms WHERE name LIKE 'TMP-%'` (cascada de amenidades/ventanas) y eliminar el script temporal.

---

### Task 11: Documentacion, gates y cierre

**Files:**

- Modify: `README.md` (seccion `### Aulas` despues de `### Actividades`)
- Modify: `CONTEXT.md`
- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md` (checks 2.C.1-2.C.5, tabla de estado y registro de ejecucion)

Run: `pnpm test`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, `pnpm run format:check`, `pnpm run docs:check`.
Expected: todo en verde; sin commit salvo solicitud explicita.

---

## Threat model resumido

- **BFLA:** las 6 mutaciones exigen `authenticate` + `requireAdmin`; un `USER` recibe 403 antes de tocar Prisma.
- **Mass assignment:** create/update/amenity/availability usan `.strict()`; PATCH no permite cambiar `id`, amenidades ni ventanas.
- **Integridad:** solapes de ventanas 409 en servicio y unico en BD; desactivar con actividades reservadas 409; Prisma parametriza todas las consultas.
- **Fugas:** los DTO no exponen `createdAt`/`updatedAt`; no hay datos sensibles en aulas.
- **Concurrencia:** `P2002` traducido a 409 en amenidades y ventanas; la exclusion GiST de actividades sigue como ultima defensa.

## Self-review

- Cobertura 2.C.1 (listado con filtros y paginacion), 2.C.2 (create/update ADMIN con validaciones), 2.C.3 (amenidades sin duplicados), 2.C.4 (ventanas 1-7, `start < end`, solapes 409), 2.C.5 (available con ventanas y actividades `SCHEDULED`/`ONGOING`, `CANCELLED` no bloquea).
- Sin migraciones, variables de entorno ni permisos nuevos.
- Verificacion real cubre BD (cascadas, indices unicos) ademas de los mocks.

---

## Registro de ejecucion (2026-09-20)

- [x] Plan aprobado y ejecutado con TDD: rojos verificados en utilidad (3 fallos), esquemas (modulo inexistente), servicio (modulo inexistente) y rutas (arranque roto por trabajo concurrente).
- [x] Implementacion completa en `src/modules/classrooms/` (tipos, esquemas, servicio, controlador, rutas y OpenAPI), `getInstitutionalDayOfWeek` en `src/utils/date.ts` y montaje en `src/routes.ts`.
- [x] Decision ampliada: se agrego `GET /classrooms/:id` y `PATCH` admite `isActive` con guarda `409`; `available` acepta `type` y `amenity` ademas de `minCapacity`.
- [x] Pruebas: 3 (utilidad) + 24 (esquemas) + 23 (servicio) + 18 (rutas) + 3 nuevas de contrato; `pnpm test` completo en verde.
- [x] Verificacion real: 37/37 checks E2E; contraste psql y limpieza de aulas `TMP-*`/`Aula TMP *` (10 aulas, 24 amenidades, 105 ventanas).
- [x] Bruno: `Classrooms` 19/19 requests y 19/19 tests.
- [x] Contrato regenerado sin drift; README, CONTEXT, plan maestro y este plan actualizados.
- [x] Sin commit: el usuario no lo solicito.
