# Fase 4.6 - Listar actividades del programa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exponer `GET /api/v1/event-programs/:id/activities` con paginacion offset y filtros por
`status`, `type`, `q`, `dateFrom` y `dateTo`, respetando la visibilidad publica del programa y de
las actividades.

**Architecture:** El endpoint vive en el modulo `activities` (reutiliza `activitySelect`,
`toActivityListItem` y los esquemas de item ya existentes; precedente: `authorization` declara rutas
anidadas `/event-programs/:id/...`). La ruta usa `optionalAuthenticate`; el servicio resuelve
`activity:read` sobre el scope del programa con `getEffectivePermissions` y decide visibilidad. El
item reutiliza la forma de `ActivityListItem` mas `status`. No hay migraciones, variables de entorno,
permisos ni dependencias nuevas.

**Tech Stack:** TypeScript 6, Express 5, Prisma 7 (SQL/Postgres), Zod 4, Vitest 4, Supertest, OpenAPI
3.1 (zod-openapi), Bruno.

**Estado de partida (2026-09-21):**

- Baseline dirigido en verde: `pnpm exec vitest run src/modules/activities src/docs` -> 167 pruebas
  en 6 archivos.
- `activities.routes.ts:29` monta `GET /activities` publico con solo `page`/`limit`. No existe ningun
  endpoint `/event-programs/:id/activities` (verificado en `openapi.json` y en `*.routes.ts`).
- `activities.service.ts:16-39` define `activitySelect` (sin `status`); `:41-101` define
  `ActivityRecord` y `toActivityListItem`; `:136` define `parseActivityDate`.
- `getActivityById` (`activities.service.ts:247-277`) ya implementa la visibilidad por permiso:
  anonimo ve no-`DRAFT` de programas `ACTIVE`; ADMIN o `activity:read` en el scope ve todo.
- `event-programs.service.ts:65` define `PUBLIC_ACTIVITY_STATUSES = ['SCHEDULED', 'ONGOING',
'COMPLETED']`, usado por `activityCount.visible` del detalle del programa.
- `event-programs.service.ts:153-155` responde 404 si el programa no esta `ACTIVE`, para todos.

**Decisiones de diseno (2026-09-21, confirmadas con el usuario):**

1. **Programa no `ACTIVE`:** anonimos y autenticados sin `activity:read` reciben 404. ADMIN o
   colaborador con `activity:read` en el scope reciben 200 aunque el programa este `DRAFT` o
   `ARCHIVED` (consistente con `getActivityById`).
2. **Estados publicos por defecto:** `SCHEDULED`, `ONGOING` y `COMPLETED` (oculta `DRAFT` y
   `CANCELLED`). Cuadra con `activityCount.visible` del detalle del programa.
3. **Filtro `status` (incluye `ALL`):** solo lo honran ADMIN o `activity:read`. Los demas reciben en
   silencio el conjunto publico aunque envien `status` (patron de 4.5). Sin permiso, el default de
   autorizados es el conjunto completo de cinco estados.
4. **Item nuevo con `status`:** componentes `EventProgramActivityItem` (ActivityListItem + `status`)
   y `PaginatedEventProgramActivities`, sin alterar el contrato publico de `GET /activities`.
5. **Filtros adicionales:** `type`, `q` (nombre/descripcion, case-insensitive), `dateFrom`/`dateTo`
   inclusivos en fecha institucional; paginacion `page`/`limit` 1-50 (default 1/20).

**Reglas de negocio:**

- Programa inexistente -> `404 Event program not found.`
- Programa no `ACTIVE` sin `activity:read` -> `404 Event program not found.`
- Anonimo con `status=DRAFT` o `status=CANCELLED` -> recibe el conjunto publico (200).
- Autorizado con `status=ALL` o sin `status` -> los cinco estados.
- `dateFrom > dateTo` -> `400 Validation error.`
- Orden estable: `date asc, startTime asc, id asc`. `totalPages = 0` si no hay resultados.
- Ningun item expone codigos de check-in.

---

### Task 1: Esquemas de params/query y item con status (TDD)

**Files:**

- Modify: `src/modules/activities/activities.schemas.ts`
- Test: `src/modules/activities/activities.schemas.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

Agregar al final de `activities.schemas.test.ts`:

```ts
import {
  eventProgramActivitiesQuerySchema,
  eventProgramActivityItemSchema,
  listEventProgramActivitiesSchema,
  paginatedEventProgramActivitiesSchema,
} from './activities.schemas.js';

describe('eventProgramActivitiesQuerySchema', () => {
  it('applies pagination defaults', () => {
    expect(eventProgramActivitiesQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it('coerces pagination and rejects out-of-range values', () => {
    expect(eventProgramActivitiesQuerySchema.parse({ page: '3', limit: '50' })).toEqual({
      page: 3,
      limit: 50,
    });
    expect(eventProgramActivitiesQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
    expect(eventProgramActivitiesQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(eventProgramActivitiesQuerySchema.safeParse({ page: 'abc' }).success).toBe(false);
  });

  it('rejects unknown query keys', () => {
    expect(eventProgramActivitiesQuerySchema.safeParse({ sort: 'date' }).success).toBe(false);
  });

  it('accepts every status filter and rejects unknown ones', () => {
    for (const status of ['DRAFT', 'SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED', 'ALL']) {
      expect(eventProgramActivitiesQuerySchema.safeParse({ status }).success).toBe(true);
    }
    expect(eventProgramActivitiesQuerySchema.safeParse({ status: 'PENDING' }).success).toBe(false);
  });

  it('validates the activity type', () => {
    expect(eventProgramActivitiesQuerySchema.safeParse({ type: 'TALK' }).success).toBe(true);
    expect(eventProgramActivitiesQuerySchema.safeParse({ type: 'CONFERENCE' }).success).toBe(false);
  });

  it('rejects an empty search term', () => {
    expect(eventProgramActivitiesQuerySchema.safeParse({ q: '   ' }).success).toBe(false);
  });

  it('validates the institutional date range', () => {
    const parsed = eventProgramActivitiesQuerySchema.parse({
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
    });

    expect(parsed).toMatchObject({ dateFrom: '2026-09-01', dateTo: '2026-09-30' });
    expect(eventProgramActivitiesQuerySchema.safeParse({ dateFrom: '2026-02-30' }).success).toBe(
      false,
    );
    expect(eventProgramActivitiesQuerySchema.safeParse({ dateTo: '30-09-2026' }).success).toBe(
      false,
    );
  });

  it('rejects a range that starts after it ends', () => {
    const result = eventProgramActivitiesQuerySchema.safeParse({
      dateFrom: '2026-10-01',
      dateTo: '2026-09-01',
    });

    expect(result.success).toBe(false);
  });
});

describe('listEventProgramActivitiesSchema', () => {
  it('trims the program id and validates it', () => {
    const parsed = listEventProgramActivitiesSchema.parse({
      params: { id: '  program-001  ' },
      query: {},
    });

    expect(parsed.params.id).toBe('program-001');
    expect(parsed.query).toEqual({ page: 1, limit: 20 });
  });

  it('rejects a blank or oversized program id', () => {
    expect(
      listEventProgramActivitiesSchema.safeParse({ params: { id: '   ' }, query: {} }).success,
    ).toBe(false);
    expect(
      listEventProgramActivitiesSchema.safeParse({
        params: { id: 'x'.repeat(101) },
        query: {},
      }).success,
    ).toBe(false);
  });
});

describe('eventProgramActivityItemSchema', () => {
  it('accepts an item with status', () => {
    const item = {
      ...activityPayload,
      status: 'CANCELLED',
    };

    expect(eventProgramActivityItemSchema.parse(item)).toEqual(item);
  });

  it('rejects an unknown status', () => {
    expect(
      eventProgramActivityItemSchema.safeParse({ ...activityPayload, status: 'PENDING' }).success,
    ).toBe(false);
  });
});

describe('paginatedEventProgramActivitiesSchema', () => {
  it('wraps a page of program activities', () => {
    const page = {
      items: [{ ...activityPayload, status: 'SCHEDULED' }],
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    };

    expect(paginatedEventProgramActivitiesSchema.parse(page)).toEqual(page);
  });
});
```

Nota: `activityPayload` ya existe en el archivo de pruebas (fixture de `ActivityListItem`). Si no
esta exportado en el scope de esos describe, duplicar la constante al inicio del nuevo bloque con los
mismos 13 campos.

- [ ] **Step 2: Correr las pruebas y verificar el rojo**

Run: `pnpm exec vitest run src/modules/activities/activities.schemas.test.ts`
Expected: FAIL con `eventProgramActivitiesQuerySchema` sin exportar / no definido.

- [ ] **Step 3: Implementar los esquemas**

En `activities.schemas.ts`, extraer la forma del item para reutilizarla (reemplazar el cuerpo actual
de `activityListItemSchema`):

```ts
const activityListItemShape = {
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  type: z.enum(['WORKSHOP', 'SEMINAR', 'TALK', 'OTHER']),
  date: z.string().meta({ description: 'Institutional date in YYYY-MM-DD format.' }),
  startTime: z.string().meta({ description: 'Institutional start time in HH:mm format.' }),
  endTime: z.string().meta({ description: 'Institutional end time in HH:mm format.' }),
  capacity: z.number().int().nullable(),
  bannerUrl: z.string().nullable(),
  speakers: z.array(activitySpeakerSummarySchema),
  classroom: activityClassroomSummarySchema.nullable(),
  eventProgram: activityProgramSummarySchema,
  organizationalUnit: activityOrganizationalUnitSchema,
};

export const activityListItemSchema = z.object(activityListItemShape).meta({
  id: 'ActivityListItem',
  description: 'Activity as returned by the upcoming activities listing.',
}) satisfies z.ZodType<ActivityListItem>;
```

Despues de `paginatedActivitiesSchema` (linea 133), agregar el item y la pagina del nuevo endpoint:

```ts
export const eventProgramActivityItemSchema = z
  .object({
    ...activityListItemShape,
    status: z.enum(['DRAFT', 'SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED']).meta({
      description: 'Activity lifecycle status.',
    }),
  })
  .meta({
    id: 'EventProgramActivityItem',
    description: 'Activity of an event program including its lifecycle status.',
  }) satisfies z.ZodType<EventProgramActivityItem>;

export const paginatedEventProgramActivitiesSchema = z
  .object({
    items: z.array(eventProgramActivityItemSchema),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .meta({
    id: 'PaginatedEventProgramActivities',
    description: 'Paginated list of event program activities.',
  }) satisfies z.ZodType<PaginatedEventProgramActivities>;
```

En `activities.types.ts`, agregar:

```ts
export interface EventProgramActivityItem extends ActivityListItem {
  status: ActivityStatus;
}

export interface PaginatedEventProgramActivities {
  items: EventProgramActivityItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
```

Despues de `isValidCalendarDate` (linea 147) y antes de `createActivitySchema`, agregar el query, el
refinamiento y el esquema combinado params+query:

```ts
const programActivityStatuses = [
  'DRAFT',
  'SCHEDULED',
  'ONGOING',
  'COMPLETED',
  'CANCELLED',
  'ALL',
] as const;

export const eventProgramActivitiesQuerySchema = z
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
    status: z.enum(programActivityStatuses, 'Status is invalid.').optional(),
    type: z.enum(['WORKSHOP', 'SEMINAR', 'TALK', 'OTHER'], 'Type is invalid.').optional(),
    q: z
      .string()
      .trim()
      .min(1, 'Search term cannot be empty.')
      .max(200, 'Search term cannot exceed 200 characters.')
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
  })
  .strict();

export const listEventProgramActivitiesQuerySchema = eventProgramActivitiesQuerySchema.refine(
  (value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo,
  { message: 'dateFrom cannot be after dateTo.', path: ['dateTo'] },
);

export const eventProgramActivitiesParamsSchema = z.object({
  params: z.object({
    id: z
      .string()
      .trim()
      .min(1, 'Event program id is required.')
      .max(100, 'Event program id cannot exceed 100 characters.'),
  }),
});

export const listEventProgramActivitiesSchema = z.object({
  params: eventProgramActivitiesParamsSchema.shape.params,
  query: listEventProgramActivitiesQuerySchema,
});

export type ListEventProgramActivitiesQuery = z.infer<typeof eventProgramActivitiesQuerySchema>;
```

Importar `EventProgramActivityItem` y `PaginatedEventProgramActivities` desde `activities.types.js` en
el import de tipos existente.

- [ ] **Step 4: Correr las pruebas y verificar el verde**

Run: `pnpm exec vitest run src/modules/activities/activities.schemas.test.ts`
Expected: PASS.

---

### Task 2: Servicio `listEventProgramActivities` (TDD)

**Files:**

- Modify: `src/modules/activities/activities.service.ts`
- Test: `src/modules/activities/activities.service.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

Agregar al final de `activities.service.test.ts`:

```ts
interface ProgramActivitiesPrismaMock {
  eventProgram: { findUnique: ReturnType<typeof vi.fn> };
  activity: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
}

const createProgramActivitiesPrismaMock = (): ProgramActivitiesPrismaMock => ({
  eventProgram: { findUnique: vi.fn() },
  activity: { findMany: vi.fn(), count: vi.fn() },
});

const loadProgramActivitiesService = async ({
  prisma,
  permissions,
}: {
  prisma: ProgramActivitiesPrismaMock;
  permissions?: ReturnType<typeof vi.fn>;
}) => {
  vi.resetModules();
  vi.doMock('../../config/prisma.js', () => ({
    getPrismaClient: () => prisma,
  }));
  vi.doMock('../authorization/authorization.service.js', () => ({
    getEffectivePermissions: permissions ?? permissionsMock,
  }));

  return import('./activities.service.js');
};

const buildProgramActivityRecord = (
  overrides: { status?: 'DRAFT' | 'SCHEDULED' | 'ONGOING' | 'COMPLETED' | 'CANCELLED' } = {},
) => ({ ...buildRecord(), status: overrides.status ?? 'SCHEDULED' });

describe('listEventProgramActivities', () => {
  const publicStatuses = ['SCHEDULED', 'ONGOING', 'COMPLETED'];
  const allStatuses = ['DRAFT', 'SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED'];

  beforeEach(() => {
    permissionsMock.mockReset();
    permissionsMock.mockResolvedValue(new Set());
  });

  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../authorization/authorization.service.js');
    permissionsMock.mockReset();
  });

  it('throws 404 when the event program does not exist', async () => {
    const prisma = createProgramActivitiesPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(null);
    const { listEventProgramActivities } = await loadProgramActivitiesService({ prisma });

    await expect(
      listEventProgramActivities('missing', { page: 1, limit: 20 }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.activity.findMany).not.toHaveBeenCalled();
  });

  it('lists the public statuses for anonymous callers with pagination', async () => {
    const prisma = createProgramActivitiesPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'program-001', status: 'ACTIVE' });
    prisma.activity.findMany.mockResolvedValue([buildProgramActivityRecord()]);
    prisma.activity.count.mockResolvedValue(2);
    const { listEventProgramActivities } = await loadProgramActivitiesService({ prisma });

    const result = await listEventProgramActivities('program-001', { page: 1, limit: 20 });

    expect(prisma.eventProgram.findUnique).toHaveBeenCalledWith({
      where: { id: 'program-001' },
      select: { id: true, status: true },
    });
    expect(prisma.activity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventProgramId: 'program-001', status: { in: publicStatuses } },
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
        skip: 0,
        take: 20,
      }),
    );
    expect(result).toMatchObject({ page: 1, limit: 20, total: 2, totalPages: 1 });
    expect(result.items[0]).toMatchObject({ id: 'activity-001', status: 'SCHEDULED' });
    expect(JSON.stringify(result.items[0])).not.toContain('qrCode');
    expect(JSON.stringify(result.items[0])).not.toContain('manualCode');
  });

  it('returns 404 for anonymous callers when the program is not active', async () => {
    const prisma = createProgramActivitiesPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'program-001', status: 'DRAFT' });
    const { listEventProgramActivities } = await loadProgramActivitiesService({ prisma });

    await expect(
      listEventProgramActivities('program-001', { page: 1, limit: 20 }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.activity.findMany).not.toHaveBeenCalled();
  });

  it('ignores the status filter for anonymous callers', async () => {
    const prisma = createProgramActivitiesPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'program-001', status: 'ACTIVE' });
    prisma.activity.findMany.mockResolvedValue([]);
    prisma.activity.count.mockResolvedValue(0);
    const { listEventProgramActivities } = await loadProgramActivitiesService({ prisma });

    await listEventProgramActivities('program-001', { page: 1, limit: 20, status: 'DRAFT' });

    expect(prisma.activity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: publicStatuses } }),
      }),
    );
  });

  it('lets a collaborator with activity:read filter by status', async () => {
    const prisma = createProgramActivitiesPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'program-001', status: 'ACTIVE' });
    prisma.activity.findMany.mockResolvedValue([buildProgramActivityRecord({ status: 'DRAFT' })]);
    prisma.activity.count.mockResolvedValue(1);
    permissionsMock.mockResolvedValue(new Set(['activity:read']));
    const { listEventProgramActivities } = await loadProgramActivitiesService({ prisma });

    const result = await listEventProgramActivities('program-001', {
      page: 1,
      limit: 20,
      status: 'DRAFT',
    });

    expect(permissionsMock).toHaveBeenCalledWith(regularViewer, { eventProgramId: 'program-001' });
    expect(prisma.activity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['DRAFT'] } }),
      }),
    );
    expect(result.items[0]).toMatchObject({ status: 'DRAFT' });
  });

  it('shows every status to an authorized collaborator by default and with ALL', async () => {
    const prisma = createProgramActivitiesPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'program-001', status: 'ACTIVE' });
    prisma.activity.findMany.mockResolvedValue([]);
    prisma.activity.count.mockResolvedValue(0);
    permissionsMock.mockResolvedValue(new Set(['activity:read']));
    const { listEventProgramActivities } = await loadProgramActivitiesService({ prisma });

    await listEventProgramActivities('program-001', { page: 1, limit: 20 }, regularViewer);
    await listEventProgramActivities(
      'program-001',
      { page: 1, limit: 20, status: 'ALL' },
      regularViewer,
    );

    expect(prisma.activity.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: expect.objectContaining({ status: { in: allStatuses } }) }),
    );
    expect(prisma.activity.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: expect.objectContaining({ status: { in: allStatuses } }) }),
    );
  });

  it('lets an ADMIN see every status without a permission lookup', async () => {
    const prisma = createProgramActivitiesPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'program-001', status: 'ARCHIVED' });
    prisma.activity.findMany.mockResolvedValue([]);
    prisma.activity.count.mockResolvedValue(0);
    const { listEventProgramActivities } = await loadProgramActivitiesService({ prisma });

    await listEventProgramActivities('program-001', { page: 1, limit: 20 }, adminViewer);

    expect(permissionsMock).not.toHaveBeenCalled();
    expect(prisma.activity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { in: allStatuses } }) }),
    );
  });

  it('hides a non-active program from an authenticated viewer without permission', async () => {
    const prisma = createProgramActivitiesPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'program-001', status: 'ARCHIVED' });
    const { listEventProgramActivities } = await loadProgramActivitiesService({ prisma });

    await expect(
      listEventProgramActivities('program-001', { page: 1, limit: 20 }, regularViewer),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.activity.findMany).not.toHaveBeenCalled();
  });

  it('applies type, search and date range filters', async () => {
    const prisma = createProgramActivitiesPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'program-001', status: 'ACTIVE' });
    prisma.activity.findMany.mockResolvedValue([]);
    prisma.activity.count.mockResolvedValue(0);
    const { listEventProgramActivities } = await loadProgramActivitiesService({ prisma });

    await listEventProgramActivities('program-001', {
      page: 2,
      limit: 5,
      type: 'TALK',
      q: 'IA',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
    });

    expect(prisma.activity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          eventProgramId: 'program-001',
          status: { in: publicStatuses },
          type: 'TALK',
          OR: [
            { name: { contains: 'IA', mode: 'insensitive' } },
            { description: { contains: 'IA', mode: 'insensitive' } },
          ],
          date: {
            gte: new Date('2026-09-01T00:00:00.000Z'),
            lte: new Date('2026-09-30T00:00:00.000Z'),
          },
        },
        skip: 5,
        take: 5,
      }),
    );
  });

  it('returns zero total pages when there are no activities', async () => {
    const prisma = createProgramActivitiesPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'program-001', status: 'ACTIVE' });
    prisma.activity.findMany.mockResolvedValue([]);
    prisma.activity.count.mockResolvedValue(0);
    const { listEventProgramActivities } = await loadProgramActivitiesService({ prisma });

    const result = await listEventProgramActivities('program-001', { page: 1, limit: 20 });

    expect(result).toEqual({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
  });
});
```

- [ ] **Step 2: Correr las pruebas y verificar el rojo**

Run: `pnpm exec vitest run src/modules/activities/activities.service.test.ts -t listEventProgramActivities`
Expected: FAIL con `listEventProgramActivities` sin exportar.

- [ ] **Step 3: Implementar el servicio**

En `activities.service.ts`:

```ts
const PROGRAM_PUBLIC_ACTIVITY_STATUSES: ActivityStatus[] = ['SCHEDULED', 'ONGOING', 'COMPLETED'];
const ALL_ACTIVITY_STATUSES: ActivityStatus[] = [
  'DRAFT',
  'SCHEDULED',
  'ONGOING',
  'COMPLETED',
  'CANCELLED',
];

const programActivitySelect = {
  ...activitySelect,
  status: true,
} as const;

interface ProgramActivityRecord extends ActivityRecord {
  status: ActivityStatus;
}

const toProgramActivityItem = (record: ProgramActivityRecord): EventProgramActivityItem => ({
  ...toActivityListItem(record),
  status: record.status,
});

export const listEventProgramActivities = async (
  eventProgramId: string,
  query: ListEventProgramActivitiesQuery,
  viewer: Express.AuthenticatedUser | null = null,
): Promise<PaginatedEventProgramActivities> => {
  const prisma = getPrismaClient();

  const program = await prisma.eventProgram.findUnique({
    where: { id: eventProgramId },
    select: { id: true, status: true },
  });

  if (!program) {
    throw new ApiError(404, 'Event program not found.');
  }

  const canRead = viewer
    ? viewer.globalRole === 'ADMIN' ||
      (await getEffectivePermissions(viewer, { eventProgramId })).has(PERMISSIONS.ACTIVITY_READ)
    : false;

  if (!canRead && program.status !== 'ACTIVE') {
    throw new ApiError(404, 'Event program not found.');
  }

  const statuses = canRead
    ? query.status && query.status !== 'ALL'
      ? [query.status]
      : ALL_ACTIVITY_STATUSES
    : PROGRAM_PUBLIC_ACTIVITY_STATUSES;

  const dateFilter =
    query.dateFrom || query.dateTo
      ? {
          ...(query.dateFrom ? { gte: parseActivityDate(query.dateFrom) } : {}),
          ...(query.dateTo ? { lte: parseActivityDate(query.dateTo) } : {}),
        }
      : undefined;

  const where = {
    eventProgramId,
    status: { in: statuses },
    ...(query.type ? { type: query.type } : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' as const } },
            { description: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
    ...(dateFilter ? { date: dateFilter } : {}),
  };

  const skip = (query.page - 1) * query.limit;

  const [records, total] = await Promise.all([
    prisma.activity.findMany({
      where,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
      skip,
      take: query.limit,
      select: programActivitySelect,
    }),
    prisma.activity.count({ where }),
  ]);

  return {
    items: records.map((record) => toProgramActivityItem(record)),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  };
};
```

Importar `EventProgramActivityItem`, `PaginatedEventProgramActivities` y
`ListEventProgramActivitiesQuery` en los imports de tipos correspondientes.

- [ ] **Step 4: Correr las pruebas y verificar el verde**

Run: `pnpm exec vitest run src/modules/activities/activities.service.test.ts`
Expected: PASS.

---

### Task 3: Controlador y ruta (TDD)

**Files:**

- Modify: `src/modules/activities/activities.controller.ts`
- Modify: `src/modules/activities/activities.routes.ts`
- Test: `src/modules/activities/activities.routes.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

En `activities.routes.test.ts`, agregar `listEventProgramActivities` a `ActivitiesServiceMock`,
`buildServiceMock` y las pruebas al `describe('activity routes')`:

```ts
it('returns paginated activities of an event program', async () => {
  const service = buildServiceMock();
  const programPage = {
    items: [{ ...activityItem, status: 'SCHEDULED' }],
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
  };
  service.listEventProgramActivities.mockResolvedValue(programPage);
  const app = await loadApp({ service });

  const response = await request(app)
    .get('/api/v1/event-programs/program-001/activities')
    .expect(200);

  expect(service.listEventProgramActivities).toHaveBeenCalledWith(
    'program-001',
    { page: 1, limit: 20 },
    null,
  );
  expect(response.body).toEqual({
    success: true,
    message: 'Event program activities retrieved successfully.',
    data: programPage,
  });
});

it('forwards the parsed program activity filters', async () => {
  const service = buildServiceMock();
  service.listEventProgramActivities.mockResolvedValue({
    items: [],
    page: 2,
    limit: 5,
    total: 0,
    totalPages: 0,
  });
  const app = await loadApp({ service });

  await request(app)
    .get(
      '/api/v1/event-programs/program-001/activities?page=2&limit=5&status=DRAFT&type=TALK&q=ia&dateFrom=2026-09-01&dateTo=2026-09-30',
    )
    .expect(200);

  expect(service.listEventProgramActivities).toHaveBeenCalledWith(
    'program-001',
    {
      page: 2,
      limit: 5,
      status: 'DRAFT',
      type: 'TALK',
      q: 'ia',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
    },
    null,
  );
});

it('rejects an invalid program activity status before the service', async () => {
  const service = buildServiceMock();
  const app = await loadApp({ service });

  await request(app)
    .get('/api/v1/event-programs/program-001/activities?status=PENDING')
    .expect(400);

  expect(service.listEventProgramActivities).not.toHaveBeenCalled();
});

it('rejects a program activity limit above the maximum', async () => {
  const service = buildServiceMock();
  const app = await loadApp({ service });

  await request(app).get('/api/v1/event-programs/program-001/activities?limit=51').expect(400);

  expect(service.listEventProgramActivities).not.toHaveBeenCalled();
});

it('rejects a range that starts after it ends before the service', async () => {
  const service = buildServiceMock();
  const app = await loadApp({ service });

  await request(app)
    .get('/api/v1/event-programs/program-001/activities?dateFrom=2026-10-01&dateTo=2026-09-01')
    .expect(400);

  expect(service.listEventProgramActivities).not.toHaveBeenCalled();
});

it('rejects a blank event program id before the service', async () => {
  const service = buildServiceMock();
  const app = await loadApp({ service });

  await request(app).get('/api/v1/event-programs/%20/activities').expect(400);

  expect(service.listEventProgramActivities).not.toHaveBeenCalled();
});

it('returns 404 for an unknown event program activity listing', async () => {
  const service = buildServiceMock();
  const app = await loadApp({ service });
  const { ApiError } = await import('../../utils/ApiError.js');
  service.listEventProgramActivities.mockRejectedValue(
    new ApiError(404, 'Event program not found.'),
  );

  const response = await request(app).get('/api/v1/event-programs/missing/activities').expect(404);

  expect(response.body).toMatchObject({ success: false, message: 'Event program not found.' });
});

it('rejects an invalid token on the program activity listing', async () => {
  const service = buildServiceMock();
  const app = await loadApp({ service });

  await request(app)
    .get('/api/v1/event-programs/program-001/activities')
    .set('Authorization', 'Bearer invalid-token')
    .expect(401);

  expect(service.listEventProgramActivities).not.toHaveBeenCalled();
});

it('forwards the authenticated viewer to the program activity service', async () => {
  const service = buildServiceMock();
  service.listEventProgramActivities.mockResolvedValue({
    items: [],
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminRecord);
  const app = await loadApp({ service, prisma });

  await request(app)
    .get('/api/v1/event-programs/program-001/activities')
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);

  expect(service.listEventProgramActivities).toHaveBeenCalledWith(
    'program-001',
    { page: 1, limit: 20 },
    adminRecord,
  );
});
```

- [ ] **Step 2: Correr las pruebas y verificar el rojo**

Run: `pnpm exec vitest run src/modules/activities/activities.routes.test.ts -t "event program"`
Expected: FAIL con `listEventProgramActivities` sin definir en el mock y rutas 404.

- [ ] **Step 3: Implementar controlador y ruta**

`activities.controller.ts`:

```ts
export const getEventProgramActivities: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const query = req.query as unknown as ListEventProgramActivitiesQuery;
  const result = await listEventProgramActivitiesService(id, query, req.user ?? null);

  res.status(200).json(successResponse('Event program activities retrieved successfully.', result));
});
```

`activities.routes.ts`: agregar la ruta despues de `/activities/:id`:

```ts
activitiesRoutes.get(
  '/event-programs/:id/activities',
  optionalAuthenticate,
  validate(listEventProgramActivitiesSchema),
  getEventProgramActivities,
);
```

- [ ] **Step 4: Correr las pruebas y verificar el verde**

Run: `pnpm exec vitest run src/modules/activities/activities.routes.test.ts`
Expected: PASS.

---

### Task 4: Contrato OpenAPI (TDD)

**Files:**

- Modify: `src/modules/activities/activities.openapi.ts`
- Modify: `src/docs/openapi.test.ts`
- Modify: `openapi.json` (generado)

- [ ] **Step 1: Escribir la prueba de contrato**

En `src/docs/openapi.test.ts`, agregar `'GET /api/v1/event-programs/{id}/activities'` a
`expectedOperations` y la prueba:

```ts
it('documents the event program activity listing', () => {
  const operation = openApiDocument.paths?.['/api/v1/event-programs/{id}/activities']?.get;
  const parameters = operation?.parameters ?? [];
  const names = parameters.map((parameter) => ('name' in parameter ? parameter.name : undefined));

  expect(operation?.security).toBeUndefined();
  expect(names).toEqual(
    expect.arrayContaining(['id', 'page', 'limit', 'status', 'type', 'q', 'dateFrom', 'dateTo']),
  );
  expect(operation?.responses?.['200']).toBeDefined();
  expect(operation?.responses?.['400']).toBeDefined();
  expect(operation?.responses?.['401']).toBeDefined();
  expect(operation?.responses?.['404']).toBeDefined();
  expect(openApiDocument.components?.schemas).toHaveProperty('EventProgramActivityItem');
  expect(openApiDocument.components?.schemas).toHaveProperty('PaginatedEventProgramActivities');
});
```

- [ ] **Step 2: Correr la prueba y verificar el rojo**

Run: `pnpm exec vitest run src/docs/openapi.test.ts`
Expected: FAIL; falta la operacion en `expectedOperations` y el path.

- [ ] **Step 3: Implementar el path OpenAPI**

En `activities.openapi.ts`, importar los esquemas nuevos y agregar el path:

```ts
'/api/v1/event-programs/{id}/activities': {
  get: {
    tags: ['Activities'],
    summary: 'List activities of an event program',
    description:
      'Public. Returns the activities of an event program with offset pagination. Anonymous callers only see SCHEDULED, ONGOING and COMPLETED activities of ACTIVE programs; the status filter is honored only for an ADMIN or a collaborator with the activity:read permission on the program scope, while other callers silently receive the public statuses. Non ACTIVE programs respond 404 unless the caller is authorized. Supports optional type, case-insensitive name/description search and inclusive institutional date range filters.',
    requestParams: {
      path: eventProgramActivitiesParamsSchema.shape.params,
      query: eventProgramActivitiesQuerySchema.shape,
    },
    responses: {
      200: {
        description: 'Paginated list of event program activities.',
        content: {
          'application/json': {
            schema: apiSuccessResponse(paginatedEventProgramActivitiesSchema),
          },
        },
      },
      400: errorResponse,
      401: errorResponse,
      404: errorResponse,
    },
  },
},
```

- [ ] **Step 4: Regenerar y verificar**

Run: `pnpm run docs:generate && pnpm run docs:check && pnpm exec vitest run src/docs/openapi.test.ts`
Expected: sin drift y PASS.

---

### Task 5: Documentacion

**Files:**

- Modify: `CONTEXT.md`
- Modify: `README.md`

- [ ] **Step 1: CONTEXT.md**

En `### Programas De Eventos Y Actividades`, agregar:

```md
- `GET /api/v1/event-programs/:id/activities` es publico y lista las actividades del programa con paginacion offset (`?page` 1, `?limit` 20 maximo 50) y filtros opcionales `type`, `q` (nombre o descripcion, sin distinguir mayusculas) y `dateFrom`/`dateTo` (inclusivos, `YYYY-MM-DD`; `dateFrom > dateTo` responde `400`). Por defecto el publico ve `SCHEDULED`, `ONGOING` y `COMPLETED` (oculta `DRAFT` y `CANCELLED`, igual que `activityCount.visible` del detalle); el filtro `status` (incluido `ALL`) solo lo honran `ADMIN` o un colaborador con `activity:read` en el scope del programa, y el resto recibe en silencio el conjunto publico aunque lo envie. Un programa inexistente o no `ACTIVE` responde `404` salvo para `ADMIN` o colaborador con `activity:read`. Cada item agrega `status` a la forma del listado de actividades y nunca expone codigos de check-in.
```

- [ ] **Step 2: README.md**

En `### Programas De Eventos`, agregar:

```md
- `GET /api/v1/event-programs/:id/activities` es publico y devuelve las actividades del programa con paginacion (`?page`, `?limit`) y filtros `type`, `q`, `dateFrom` y `dateTo` (rango inclusivo; `dateFrom > dateTo` responde `400`). El publico recibe `SCHEDULED`, `ONGOING` y `COMPLETED`; el filtro `status` (o `ALL`) solo aplica a `ADMIN` o colaboradores con `activity:read` en el programa, que ademas pueden ver programas no `ACTIVE`. El resto de casos no visibles responde `404`. Cada item incluye `status`.
```

- [ ] **Step 3: Formato**

Run: `pnpm exec prettier --check CONTEXT.md README.md`
Expected: PASS.

---

### Task 6: Coleccion Bruno

**Files:**

- Create: `bruno/Activities/List program activities anonymously.bru`
- Create: `bruno/Activities/List program activities as admin.bru`
- Create: `bruno/Activities/List archived program activities anonymously returns 404.bru`
- Create: `bruno/Activities/List archived program activities as admin returns 200.bru`
- Create: `bruno/Activities/List program activities with an invalid status returns 400.bru`
- Create: `bruno/Activities/List program activities with an invalid token returns 401.bru`

- [ ] **Step 1: Crear los requests**

`List program activities anonymously.bru` (seq 17):

```bru
meta {
  name: List program activities anonymously
  type: http
  seq: 17
  tags: [
    Activities
  ]
}

get {
  url: {{baseUrl}}/api/v1/event-programs/{{defaultProgramId}}/activities?page=1&limit=20
  body: none
  auth: none
}

params:query {
  page: 1
  limit: 20
}

docs {
  Public. Returns SCHEDULED, ONGOING and COMPLETED activities of the program. DRAFT and CANCELLED are hidden.
}

tests {
  test("anonymous listing returns only public statuses", function () {
    expect(res.getStatus()).to.equal(200);
    const body = res.getBody();
    expect(body.success).to.equal(true);
    const publicStatuses = ["SCHEDULED", "ONGOING", "COMPLETED"];
    body.data.items.forEach(function (activity) {
      expect(publicStatuses).to.include(activity.status);
    });
  });
}
```

`List program activities as admin.bru` (seq 18):

```bru
meta {
  name: List program activities as admin
  type: http
  seq: 18
  tags: [
    Activities
  ]
}

get {
  url: {{baseUrl}}/api/v1/event-programs/{{eventProgramId}}/activities?page=1&limit=50&status=SCHEDULED
  body: none
  auth: bearer
}

auth:bearer {
  token: {{token}}
}

params:query {
  page: 1
  limit: 50
  status: SCHEDULED
}

docs {
  The status filter is honored only for ADMIN or a collaborator with activity:read on the program scope.
}

tests {
  test("admin status filter returns only SCHEDULED activities", function () {
    expect(res.getStatus()).to.equal(200);
    const body = res.getBody();
    expect(body.success).to.equal(true);
    expect(body.data.total).to.be.above(0);
    body.data.items.forEach(function (activity) {
      expect(activity.status).to.equal("SCHEDULED");
    });
  });
}
```

`List archived program activities anonymously returns 404.bru` (seq 19):

```bru
meta {
  name: List archived program activities anonymously returns 404
  type: http
  seq: 19
  tags: [
    Activities
  ]
}

get {
  url: {{baseUrl}}/api/v1/event-programs/{{archivedProgramId}}/activities
  body: none
  auth: none
}

tests {
  test("anonymous callers cannot list non active programs", function () {
    expect(res.getStatus()).to.equal(404);
    expect(res.getBody().success).to.equal(false);
  });
}
```

`List archived program activities as admin returns 200.bru` (seq 20):

```bru
meta {
  name: List archived program activities as admin returns 200
  type: http
  seq: 20
  tags: [
    Activities
  ]
}

get {
  url: {{baseUrl}}/api/v1/event-programs/{{archivedProgramId}}/activities?status=ALL
  body: none
  auth: bearer
}

auth:bearer {
  token: {{token}}
}

params:query {
  status: ALL
}

tests {
  test("admin callers can list non active programs", function () {
    expect(res.getStatus()).to.equal(200);
    expect(res.getBody().success).to.equal(true);
  });
}
```

`List program activities with an invalid status returns 400.bru` (seq 21):

```bru
meta {
  name: List program activities with an invalid status returns 400
  type: http
  seq: 21
  tags: [
    Activities
  ]
}

get {
  url: {{baseUrl}}/api/v1/event-programs/{{defaultProgramId}}/activities?status=PENDING
  body: none
  auth: none
}

params:query {
  status: PENDING
}

tests {
  test("unknown status is a validation error", function () {
    expect(res.getStatus()).to.equal(400);
    expect(res.getBody().success).to.equal(false);
  });
}
```

`List program activities with an invalid token returns 401.bru` (seq 22):

```bru
meta {
  name: List program activities with an invalid token returns 401
  type: http
  seq: 22
  tags: [
    Activities
  ]
}

get {
  url: {{baseUrl}}/api/v1/event-programs/{{defaultProgramId}}/activities
  body: none
  auth: none
}

headers {
  Authorization: Bearer invalid-token
}

tests {
  test("invalid bearer tokens are rejected", function () {
    expect(res.getStatus()).to.equal(401);
    expect(res.getBody().success).to.equal(false);
  });
}
```

- [ ] **Step 2: Correr la carpeta**

Run: `pnpm --dir bruno exec bru run Activities --env local`
Expected: requests y tests en verde (si el login devuelve 429 por rate limit, esperar 60 s y repetir).

---

### Task 7: E2E real con Docker + psql (solo lectura)

**Files:**

- Create: `/tmp/opencode/f46-e2e.mjs` (se elimina al final)

- [ ] **Step 1: Confirmar el stack**

Run: `docker ps --format '{{.Names}}' | grep sipeg`
Expected: contenedores `sipeg-utp-dev-api-1` y `sipeg-utp-dev-db-1`.

- [ ] **Step 2: Ejecutar el script**

Crear `/tmp/opencode/f46-e2e.mjs` que:

1. Cuenta por estado las actividades de `seed_program_fic_default` y `seed_program_congreso-cit`
   con `docker exec sipeg-utp-dev-db-1 psql -U sipeg -d sipeg_utp -t -A -c "..."`.
2. Anonimo `GET /event-programs/seed_program_fic_default/activities?limit=50` -> 200, items con
   `status` en `SCHEDULED|ONGOING|COMPLETED` y cantidad igual a la suma publica de psql.
3. Anonimo con `status=DRAFT` -> misma cantidad publica (filtro ignorado en silencio).
4. Login admin (`admin@utp.ac.pa` / `Sipeg2026*UTP`) -> token.
5. Admin `?limit=50` -> total igual a la suma de los cinco estados; admin `status=CANCELLED` ->
   total igual al conteo psql de `CANCELLED`; admin `status=ALL` -> mismo total que sin filtro.
6. Anonimo con `seed_program_foro-ipe` (archivado) -> 404; admin -> 200.
7. Programa desconocido -> 404; `status=PENDING` -> 400; `dateFrom > dateTo` -> 400; Bearer
   invalido -> 401.
8. `JSON.stringify(items)` no contiene `qrCode` ni `manualCode`.
9. Imprime `OK` por check y falla con `exit(1)` al primer desajuste.

Run: `node /tmp/opencode/f46-e2e.mjs`
Expected: todos los checks en verde.

- [ ] **Step 3: Limpiar**

Run: `rm /tmp/opencode/f46-e2e.mjs`

---

### Task 8: Gates finales y actualizacion del plan maestro

**Files:**

- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [ ] **Step 1: Gates**

Run: `pnpm test && pnpm run typecheck && pnpm run lint && pnpm run build && pnpm run format:check && pnpm run docs:check`
Expected: todo en verde (si un archivo ajeno falla por formato, reportarlo sin tocarlo).

- [ ] **Step 2: Actualizar el plan maestro**

- Tabla de estado: `Programas: ... Parcial: 4.1-4.6 implementados; faltan 4.7`.
- Lista de endpoints: agregar `GET /event-programs/:id/activities`.
- Marcar `- [x] **4.6 ...`.
- Insertar `**Registro de ejecucion (2026-09-21 - 4.6):**` antes de `**Criterio de salida:**` con
  evidencia real (baseline, pruebas, contrato, Bruno, E2E, hallazgos y "Sin commit: el usuario no lo
  solicito.").

---

## Self-review del plan

- **Cobertura de 4.6:** filtros (`status`, `type`, `q`, `dateFrom`, `dateTo`) y paginacion en
  `GET /event-programs/:id/activities`; visibilidad publica/privada alineada con `activityCount` y
  `getActivityById`.
- **Sin placeholders:** cada tarea tiene comandos y codigo concreto; los pasos E2E derivan los
  conteos de psql en lugar de fijarlos.
- **Consistencia de tipos:** `ListEventProgramActivitiesQuery`,
  `EventProgramActivityItem` y `PaginatedEventProgramActivities` se definen en Task 1 y se reutilizan
  en 2, 3 y 4. El query refinado se exporta sin efectos para `zod-openapi` mediante
  `eventProgramActivitiesQuerySchema`.
- **Riesgos conocidos:** `CANCELLED` sigue visible por detalle pero no en el listado publico; el
  filtro `status` ignorado en silencio se documenta en OpenAPI, README y CONTEXT; los componentes
  nuevos son contrato estable para el frontend.
