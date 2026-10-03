# Fase 4.1 - Consultar programa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exponer `GET /api/v1/event-programs/:id` publico para programas `ACTIVE`, con `activityCount` publico (`visible`) y desglose por estado (`total` + `byStatus`) cuando el llamador tiene `program:read` en el scope o es `ADMIN`.

**Architecture:** Se extiende el modulo autocontenido `src/modules/event-programs/` (tipos, esquemas, servicio, controlador, rutas y OpenAPI) y se agrega un middleware `optionalAuthenticate` reutilizando los helpers de `authenticate.middleware.ts`. El servicio resuelve autorizacion con `hasPermission` del modulo `authorization` (ADR-0001) y calcula los conteos con un unico `activity.groupBy` por estado. Sin migraciones, variables de entorno ni permisos nuevos.

**Tech Stack:** TypeScript 6, Express 5, Prisma 7 (SQL/Postgres), Zod 4, Vitest, Supertest, OpenAPI 3.1 (zod-openapi), Bruno.

**Estado de partida (2026-09-20):**

- `GET /api/v1/event-programs` lista solo `ACTIVE`; `PATCH /api/v1/event-programs/:id` actualiza. No existe `GET /api/v1/event-programs/:id`.
- Existe `GET /api/v1/event-programs/:id/collaborators` en `authorization.routes.ts`, montado antes de `eventProgramsRoutes`; no hay colision porque Express 5 compara la ruta exacta.
- `src/middlewares/` no tiene auth opcional; `extractBearerToken` y `loadActiveUser` son privados de `authenticate.middleware.ts`.
- `authorization.service.ts` expone `hasPermission(user, permission, scope)` con bypass total para `ADMIN`.
- Seed demo: `seed_program_congreso-cit` y `seed_program_jornada-bienestar` estan `ACTIVE`; `seed_program_foro-ipe` esta `ARCHIVED`; `seed_program_feria-tec` esta `DRAFT`.

**Decisiones confirmadas (2026-09-20):**

1. Solo programas `ACTIVE`: cualquier otro estado o id inexistente responde `404 Event program not found.`
2. Auth opcional fail-closed: sin `Authorization` la respuesta es publica; header malformado, token invalido/vencido o usuario inexistente responden `401`; cuenta desactivada responde `403` (reutiliza `loadActiveUser`, consistente con `authenticate`).
3. `activityCount.visible` cuenta `SCHEDULED`, `ONGOING` y `COMPLETED`; `DRAFT` y `CANCELLED` quedan fuera. Con `program:read` efectivo o `ADMIN` se agregan `total` (los 5 estados) y `byStatus` (los 5 estados, con `0` cuando no hay filas).
4. DTO nuevo `EventProgramPublicDetail` exclusivo del `GET`; el listado, `POST` y `PATCH` conservan `EventProgramDetail` sin cambios de contrato.

**Reglas de negocio:**

- El conteo por estado nunca se expone a anonimos ni a autenticados sin `program:read` en el scope del programa.
- El permiso se evalua con ventanas vigentes (`hasPermission` respeta `validFrom`/`validUntil`).
- No se exponen `createdById`, `archivedAt` ni datos internos.
- El `groupBy` es una sola consulta; el `visible` se deriva de ella en ambos casos.

---

### Task 1: Middleware `optionalAuthenticate` (TDD)

**Files:**

- Modify: `src/middlewares/authenticate.middleware.ts` (exportar helpers)
- Create: `src/middlewares/optionalAuthenticate.middleware.ts`
- Test: `src/middlewares/optionalAuthenticate.middleware.test.ts`

- [x] **Step 1: Exportar los helpers existentes**

En `src/middlewares/authenticate.middleware.ts`, cambiar:

```ts
const extractBearerToken = (header: string | undefined): string => {
```

por:

```ts
export const extractBearerToken = (header: string | undefined): string => {
```

y:

```ts
const loadActiveUser = async (userId: string): Promise<Express.AuthenticatedUser> => {
```

por:

```ts
export const loadActiveUser = async (userId: string): Promise<Express.AuthenticatedUser> => {
```

- [x] **Step 2: Escribir la prueba que falla**

Crear `src/middlewares/optionalAuthenticate.middleware.test.ts`:

```ts
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../utils/ApiError.js';

interface PrismaMock {
  user: { findUnique: ReturnType<typeof vi.fn> };
}

const createPrismaMock = (): PrismaMock => ({ user: { findUnique: vi.fn() } });

const userRecord = {
  id: 'user-1',
  email: 'a@b.com',
  globalRole: 'USER',
  unitId: null,
  careerId: null,
  isActive: true,
};

const loadMiddleware = async (
  prisma: PrismaMock,
  verify: (token: string) => Promise<{ sub: string }> = async (token) => ({ sub: token }),
) => {
  process.env['NODE_ENV'] = 'test';
  process.env['AUTH_SECRET'] = 'a'.repeat(32);
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
  process.env['AUTH_URL'] = 'http://localhost:3000';
  vi.resetModules();
  vi.doMock('../config/prisma.js', () => ({ getPrismaClient: () => prisma }));
  vi.doMock('../utils/jwt-verifier.js', () => ({
    getJwtVerifier: () => ({ verify, refresh: async () => {} }),
  }));
  return import('./optionalAuthenticate.middleware.js');
};

describe('optionalAuthenticate middleware', () => {
  it('continues anonymously without an Authorization header', async () => {
    const prisma = createPrismaMock();
    const { optionalAuthenticate } = await loadMiddleware(prisma);
    const req = { headers: {} } as Request;
    const next = vi.fn();

    await optionalAuthenticate(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toBeUndefined();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a malformed Authorization header', async () => {
    const prisma = createPrismaMock();
    const { optionalAuthenticate } = await loadMiddleware(prisma);
    const next = vi.fn();

    await optionalAuthenticate(
      { headers: { authorization: 'Basic xyz' } } as Request,
      {} as Response,
      next,
    );

    const error = next.mock.calls[0]?.[0] as ApiError | undefined;
    expect(error?.statusCode).toBe(401);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an invalid or expired token', async () => {
    const prisma = createPrismaMock();
    const { optionalAuthenticate } = await loadMiddleware(prisma, async () => {
      throw new ApiError(401, 'Invalid or expired token.');
    });
    const next = vi.fn();

    await optionalAuthenticate(
      { headers: { authorization: 'Bearer broken' } } as Request,
      {} as Response,
      next,
    );

    const error = next.mock.calls[0]?.[0] as ApiError | undefined;
    expect(error?.statusCode).toBe(401);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects inactive users', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({ ...userRecord, isActive: false });
    const { optionalAuthenticate } = await loadMiddleware(prisma);
    const next = vi.fn();

    await optionalAuthenticate(
      { headers: { authorization: 'Bearer user-1' } } as Request,
      {} as Response,
      next,
    );

    const error = next.mock.calls[0]?.[0] as ApiError | undefined;
    expect(error?.statusCode).toBe(403);
  });

  it('attaches the authenticated user on success', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const { optionalAuthenticate } = await loadMiddleware(prisma);
    const req = { headers: { authorization: 'Bearer user-1' } } as Request;
    const next = vi.fn();

    await optionalAuthenticate(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual(userRecord);
  });
});
```

- [x] **Step 3: Correr la prueba y verificar que falla**

Run: `pnpm exec vitest run src/middlewares/optionalAuthenticate.middleware.test.ts`
Expected: FAIL; el modulo `./optionalAuthenticate.middleware.js` no existe.

- [x] **Step 4: Implementacion minima**

Crear `src/middlewares/optionalAuthenticate.middleware.ts`:

```ts
import type { RequestHandler } from 'express';

import { getJwtVerifier } from '../utils/jwt-verifier.js';
import { extractBearerToken, loadActiveUser } from './authenticate.middleware.js';

export const optionalAuthenticate: RequestHandler = async (req, _res, next) => {
  if (!req.headers.authorization) {
    next();
    return;
  }

  try {
    const token = extractBearerToken(req.headers.authorization);
    const verifier = getJwtVerifier();
    const payload = await verifier.verify(token);
    req.user = await loadActiveUser(payload.sub);
    next();
  } catch (error) {
    next(error);
  }
};
```

- [x] **Step 5: Correr la prueba y verificar que pasa**

Run: `pnpm exec vitest run src/middlewares/optionalAuthenticate.middleware.test.ts src/middlewares/authenticate.middleware.test.ts`
Expected: PASS ambas suites.

---

### Task 2: Esquemas `eventProgramParamsSchema` y `EventProgramPublicDetail` (TDD)

**Files:**

- Modify: `src/modules/event-programs/event-programs.types.ts`
- Modify: `src/modules/event-programs/event-programs.schemas.ts`
- Test: `src/modules/event-programs/event-programs.schemas.test.ts`

- [x] **Step 1: Escribir las pruebas que fallan**

En `event-programs.schemas.test.ts`, ampliar el import:

```ts
import {
  createEventProgramSchema,
  eventProgramDetailSchema,
  eventProgramParamsSchema,
  eventProgramPublicDetailSchema,
  listEventProgramsQuerySchema,
  paginatedEventProgramsSchema,
  updateEventProgramSchema,
} from './event-programs.schemas.js';
```

Agregar antes del `describe('eventProgramDetailSchema')`:

```ts
describe('eventProgramParamsSchema', () => {
  it('accepts and trims the event program id', () => {
    const parsed = eventProgramParamsSchema.parse({ params: { id: '  program-001  ' } });

    expect(parsed.params).toEqual({ id: 'program-001' });
  });

  it('rejects an empty or blank id', () => {
    expect(() => eventProgramParamsSchema.parse({ params: { id: '   ' } })).toThrow();
  });

  it('rejects an id above 100 characters', () => {
    expect(() => eventProgramParamsSchema.parse({ params: { id: 'a'.repeat(101) } })).toThrow();
  });
});
```

Agregar despues del `describe('eventProgramDetailSchema')`:

```ts
describe('eventProgramPublicDetailSchema', () => {
  const detailPayload = {
    id: 'program-001',
    name: 'Congreso de Innovacion 2026',
    description: null,
    label: 'CI-2026',
    bannerUrl: null,
    isDefault: false,
    status: 'ACTIVE',
    startDate: '2026-10-12',
    endDate: '2026-10-16',
    organizationalUnit: {
      id: 'unit-001',
      name: 'Facultad de Ingenieria',
      type: 'FACULTY',
    },
  };

  it('accepts the public count payload', () => {
    const payload = { ...detailPayload, activityCount: { visible: 6 } };

    expect(eventProgramPublicDetailSchema.parse(payload)).toEqual(payload);
  });

  it('accepts the privileged payload with total and byStatus', () => {
    const activityCount = {
      visible: 6,
      total: 9,
      byStatus: { DRAFT: 2, SCHEDULED: 3, ONGOING: 1, COMPLETED: 2, CANCELLED: 1 },
    };
    const payload = { ...detailPayload, activityCount };

    expect(eventProgramPublicDetailSchema.parse(payload)).toEqual(payload);
  });

  it('rejects a negative count', () => {
    expect(() =>
      eventProgramPublicDetailSchema.parse({
        ...detailPayload,
        activityCount: { visible: -1 },
      }),
    ).toThrow();
  });

  it('rejects a byStatus payload with a missing status', () => {
    expect(() =>
      eventProgramPublicDetailSchema.parse({
        ...detailPayload,
        activityCount: {
          visible: 6,
          total: 9,
          byStatus: { DRAFT: 2, SCHEDULED: 3, ONGOING: 1, COMPLETED: 2 },
        },
      }),
    ).toThrow();
  });
});
```

- [x] **Step 2: Correr las pruebas y verificar que fallan**

Run: `pnpm exec vitest run src/modules/event-programs/event-programs.schemas.test.ts`
Expected: FAIL; `eventProgramParamsSchema` y `eventProgramPublicDetailSchema` no exportados.

- [x] **Step 3: Tipos**

En `event-programs.types.ts`, cambiar el import de enums por:

```ts
import type { ActivityStatus, ProgramStatus, UnitType } from '../../generated/prisma/enums.js';
```

y agregar al final:

```ts
export interface EventProgramActivityCount {
  visible: number;
  total?: number;
  byStatus?: Record<ActivityStatus, number>;
}

export interface EventProgramPublicDetail extends EventProgramDetail {
  activityCount: EventProgramActivityCount;
}
```

- [x] **Step 4: Esquemas**

En `event-programs.schemas.ts`, cambiar el import de tipos por:

```ts
import type {
  EventProgramDetail,
  EventProgramPublicDetail,
  PaginatedEventPrograms,
} from './event-programs.types.js';
```

Agregar antes de `listEventProgramsQuerySchema`:

```ts
const eventProgramIdSchema = z
  .string()
  .trim()
  .min(1, 'Event program id is required.')
  .max(100, 'Event program id cannot exceed 100 characters.');

export const eventProgramParamsSchema = z.object({
  params: z.object({ id: eventProgramIdSchema }),
});

export type EventProgramParams = z.infer<typeof eventProgramParamsSchema>['params'];
```

Reemplazar en `updateEventProgramSchema`:

```ts
  params: z.object({
    id: z.string().trim().min(1, 'Event program id is required.'),
  }),
```

por:

```ts
  params: z.object({ id: eventProgramIdSchema }),
```

Al final del archivo, reemplazar la definicion de `eventProgramDetailSchema` por el shape compartido y agregar el esquema publico:

```ts
const eventProgramDetailShape = {
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  label: z.string().nullable(),
  bannerUrl: z.string().nullable(),
  isDefault: z.boolean(),
  status: z.enum(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED']),
  startDate: z.string().nullable().meta({ description: 'Start date in YYYY-MM-DD format.' }),
  endDate: z.string().nullable().meta({ description: 'End date in YYYY-MM-DD format.' }),
  organizationalUnit: eventProgramOrganizationalUnitSchema,
};

export const eventProgramDetailSchema = z.object(eventProgramDetailShape).meta({
  id: 'EventProgramDetail',
  description: 'Event program detail returned by the event program endpoints.',
}) satisfies z.ZodType<EventProgramDetail>;

const eventProgramActivityCountSchema = z
  .object({
    visible: z.number().int().nonnegative(),
    total: z.number().int().nonnegative().optional(),
    byStatus: z
      .object({
        DRAFT: z.number().int().nonnegative(),
        SCHEDULED: z.number().int().nonnegative(),
        ONGOING: z.number().int().nonnegative(),
        COMPLETED: z.number().int().nonnegative(),
        CANCELLED: z.number().int().nonnegative(),
      })
      .optional(),
  })
  .meta({
    id: 'EventProgramActivityCount',
    description:
      'Activity count for an event program. Anonymous callers only receive the public visible count; authorized callers also receive the total and the per-status breakdown.',
  });

export const eventProgramPublicDetailSchema = z
  .object({
    ...eventProgramDetailShape,
    activityCount: eventProgramActivityCountSchema,
  })
  .meta({
    id: 'EventProgramPublicDetail',
    description: 'Public event program detail including activity counts.',
  }) satisfies z.ZodType<EventProgramPublicDetail>;
```

- [x] **Step 5: Correr las pruebas y verificar que pasan**

Run: `pnpm exec vitest run src/modules/event-programs/event-programs.schemas.test.ts`
Expected: PASS.

---

### Task 3: Servicio `getEventProgramById` (TDD)

**Files:**

- Modify: `src/modules/event-programs/event-programs.service.ts`
- Test: `src/modules/event-programs/event-programs.service.test.ts`

- [x] **Step 1: Escribir las pruebas que fallan**

En `event-programs.service.test.ts`:

1. Ampliar el import de enums si aplica y agregar el mock de `hasPermission` **antes** de `createPrismaMock`:

```ts
const hasPermissionMock = vi.fn();
```

2. Extender `PrismaMock` y `createPrismaMock`:

```ts
interface PrismaMock {
  activity: { groupBy: ReturnType<typeof vi.fn> };
  organizationalUnit: { findUnique: ReturnType<typeof vi.fn> };
  eventProgram: {
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

const createPrismaMock = (): PrismaMock => ({
  activity: { groupBy: vi.fn() },
  organizationalUnit: { findUnique: vi.fn() },
  eventProgram: {
    count: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
});
```

3. Reemplazar `loadService` por:

```ts
const loadService = async (prisma: PrismaMock) => {
  vi.resetModules();
  hasPermissionMock.mockReset();
  vi.doMock('../../config/prisma.js', () => ({ getPrismaClient: () => prisma }));
  vi.doMock('../authorization/authorization.service.js', () => ({
    hasPermission: hasPermissionMock,
  }));
  return import('./event-programs.service.js');
};
```

4. En cada `afterEach` existente de los describe actuales, agregar:

```ts
vi.doUnmock('../authorization/authorization.service.js');
```

5. Agregar al final del archivo:

```ts
describe('getEventProgramById', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../authorization/authorization.service.js');
  });

  const activeRecord = {
    id: 'program-001',
    name: 'Congreso de Innovacion 2026',
    description: null,
    label: 'CI-2026',
    bannerUrl: null,
    isDefault: false,
    status: 'ACTIVE' as const,
    startDate: new Date('2026-10-12T00:00:00.000Z'),
    endDate: new Date('2026-10-16T00:00:00.000Z'),
    organizationalUnit: {
      id: 'unit-001',
      name: 'Facultad de Ingenieria',
      type: 'FACULTY' as const,
    },
  };

  const statusGroups = [
    { status: 'DRAFT' as const, _count: { _all: 2 } },
    { status: 'SCHEDULED' as const, _count: { _all: 3 } },
    { status: 'ONGOING' as const, _count: { _all: 1 } },
    { status: 'COMPLETED' as const, _count: { _all: 2 } },
    { status: 'CANCELLED' as const, _count: { _all: 1 } },
  ];

  const viewer = {
    id: 'user-001',
    email: 'user@example.com',
    globalRole: 'USER' as const,
    unitId: null,
    careerId: null,
    isActive: true,
  };

  it('returns the public count for anonymous callers', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(activeRecord);
    prisma.activity.groupBy.mockResolvedValue(statusGroups);
    const { getEventProgramById } = await loadService(prisma);

    const result = await getEventProgramById('program-001');

    expect(prisma.eventProgram.findUnique).toHaveBeenCalledWith({
      where: { id: 'program-001' },
      select: expect.any(Object),
    });
    expect(prisma.activity.groupBy).toHaveBeenCalledWith({
      by: ['status'],
      where: { eventProgramId: 'program-001' },
      _count: { _all: true },
    });
    expect(hasPermissionMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      ...activeRecord,
      startDate: '2026-10-12',
      endDate: '2026-10-16',
      activityCount: { visible: 6 },
    });
  });

  it('adds the total and the per-status breakdown for authorized viewers', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(activeRecord);
    prisma.activity.groupBy.mockResolvedValue(statusGroups);
    const { getEventProgramById } = await loadService(prisma);
    const { PERMISSIONS } = await import('../authorization/permissions.js');
    hasPermissionMock.mockResolvedValue(true);

    const result = await getEventProgramById('program-001', viewer);

    expect(hasPermissionMock).toHaveBeenCalledWith(viewer, PERMISSIONS.PROGRAM_READ, {
      eventProgramId: 'program-001',
    });
    expect(result.activityCount).toEqual({
      visible: 6,
      total: 9,
      byStatus: { DRAFT: 2, SCHEDULED: 3, ONGOING: 1, COMPLETED: 2, CANCELLED: 1 },
    });
  });

  it('falls back to the public count when the viewer lacks program:read', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(activeRecord);
    prisma.activity.groupBy.mockResolvedValue(statusGroups);
    const { getEventProgramById } = await loadService(prisma);
    hasPermissionMock.mockResolvedValue(false);

    const result = await getEventProgramById('program-001', viewer);

    expect(result.activityCount).toEqual({ visible: 6 });
    expect(result.activityCount).not.toHaveProperty('total');
  });

  it('rejects a missing event program without counting activities', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(null);
    const { getEventProgramById } = await loadService(prisma);

    await expect(getEventProgramById('missing')).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.activity.groupBy).not.toHaveBeenCalled();
  });

  it('rejects non-active event programs as not found', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ ...activeRecord, status: 'DRAFT' });
    const { getEventProgramById } = await loadService(prisma);

    await expect(getEventProgramById('program-001', viewer)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(prisma.activity.groupBy).not.toHaveBeenCalled();
    expect(hasPermissionMock).not.toHaveBeenCalled();
  });

  it('returns zero visible activities when the program has none', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(activeRecord);
    prisma.activity.groupBy.mockResolvedValue([]);
    const { getEventProgramById } = await loadService(prisma);

    const result = await getEventProgramById('program-001');

    expect(result.activityCount).toEqual({ visible: 0 });
  });
});
```

- [x] **Step 2: Correr las pruebas y verificar que fallan**

Run: `pnpm exec vitest run src/modules/event-programs/event-programs.service.test.ts`
Expected: FAIL; `getEventProgramById` no exportado.

- [x] **Step 3: Implementacion minima**

En `event-programs.service.ts`, cambiar el import de enums y agregar imports:

```ts
import type { ActivityStatus, ProgramStatus, UnitType } from '../../generated/prisma/enums.js';
import { ApiError } from '../../utils/ApiError.js';
import { hasPermission } from '../authorization/authorization.service.js';
import { PERMISSIONS } from '../authorization/permissions.js';
```

Agregar el tipo al import de tipos del modulo:

```ts
import type {
  EventProgramActivityCount,
  EventProgramDetail,
  EventProgramPublicDetail,
  PaginatedEventPrograms,
} from './event-program.types.js';
```

(usar la ruta real `./event-programs.types.js`)

Agregar despues de `toEventProgramDetail`:

```ts
const PUBLIC_ACTIVITY_STATUSES = ['SCHEDULED', 'ONGOING', 'COMPLETED'] as const;
const ACTIVITY_STATUSES = ['DRAFT', 'SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED'] as const;

const countEventProgramActivities = async (
  eventProgramId: string,
  includeBreakdown: boolean,
): Promise<EventProgramActivityCount> => {
  const prisma = getPrismaClient();
  const groups = await prisma.activity.groupBy({
    by: ['status'],
    where: { eventProgramId },
    _count: { _all: true },
  });

  const byStatus = Object.fromEntries(ACTIVITY_STATUSES.map((status) => [status, 0])) as Record<
    ActivityStatus,
    number
  >;

  for (const group of groups) {
    byStatus[group.status] = group._count._all;
  }

  const visible = PUBLIC_ACTIVITY_STATUSES.reduce((total, status) => total + byStatus[status], 0);

  if (!includeBreakdown) {
    return { visible };
  }

  return {
    visible,
    total: ACTIVITY_STATUSES.reduce((total, status) => total + byStatus[status], 0),
    byStatus,
  };
};
```

Agregar despues de `listEventPrograms`:

```ts
export const getEventProgramById = async (
  id: string,
  viewer: Express.AuthenticatedUser | null = null,
): Promise<EventProgramPublicDetail> => {
  const prisma = getPrismaClient();
  const record = await prisma.eventProgram.findUnique({
    where: { id },
    select: eventProgramDetailSelect,
  });

  if (!record || record.status !== 'ACTIVE') {
    throw new ApiError(404, 'Event program not found.');
  }

  const includeBreakdown = viewer
    ? await hasPermission(viewer, PERMISSIONS.PROGRAM_READ, { eventProgramId: id })
    : false;

  return {
    ...toEventProgramDetail(record),
    activityCount: await countEventProgramActivities(id, includeBreakdown),
  };
};
```

- [x] **Step 4: Correr las pruebas y verificar que pasan**

Run: `pnpm exec vitest run src/modules/event-programs/event-programs.service.test.ts`
Expected: PASS.

---

### Task 4: Controlador y ruta `GET /event-programs/:id` (TDD)

**Files:**

- Modify: `src/modules/event-programs/event-programs.controller.ts`
- Modify: `src/modules/event-programs/event-programs.routes.ts`
- Test: `src/modules/event-programs/event-programs.routes.test.ts`

- [x] **Step 1: Escribir las pruebas que fallan**

En `event-programs.routes.test.ts`:

1. Ampliar `EventProgramsServiceMock` y `buildServiceMock`:

```ts
interface EventProgramsServiceMock {
  createEventProgram: ReturnType<typeof vi.fn>;
  getEventProgramById: ReturnType<typeof vi.fn>;
  listEventPrograms: ReturnType<typeof vi.fn>;
  updateEventProgram: ReturnType<typeof vi.fn>;
}

const buildServiceMock = (): EventProgramsServiceMock => ({
  createEventProgram: vi.fn(),
  getEventProgramById: vi.fn(),
  listEventPrograms: vi.fn(),
  updateEventProgram: vi.fn(),
});
```

2. Extender `loadApp` con un parametro `verify` opcional:

```ts
const loadApp = async (
  service: EventProgramsServiceMock,
  prisma = createPrismaMock(),
  permissions: string[] = ['program:create'],
  getEffectivePermissions = vi.fn(),
  verify: (token: string) => Promise<{ sub: string }> = async (token) => ({ sub: token }),
) => {
  getEffectivePermissions.mockResolvedValue(new Set(permissions));
  process.env['NODE_ENV'] = 'test';
  process.env['AUTH_SECRET'] = 'a'.repeat(32);
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
  process.env['AUTH_URL'] = 'http://localhost:3000';
  vi.resetModules();
  vi.doMock('./event-programs.service.js', () => service);
  vi.doMock('../../config/prisma.js', () => ({ getPrismaClient: () => prisma }));
  vi.doMock('../../utils/jwt-verifier.js', () => ({
    getJwtVerifier: () => ({
      verify,
      refresh: async () => {},
    }),
  }));
  vi.doMock('../../lib/auth.js', () => ({
    auth: {
      api: {
        signInEmail: vi.fn(),
        signUpEmail: vi.fn(),
        getToken: vi.fn(),
        getSession: vi.fn(),
        signOut: vi.fn(),
        verifyEmail: vi.fn(),
        requestPasswordReset: vi.fn(),
        resetPassword: vi.fn(),
      },
    },
  }));
  vi.doMock('../authorization/authorization.service.js', () => ({
    getEffectivePermissions,
  }));

  const { app } = await import('../../app.js');
  return app;
};
```

3. Agregar un `describe` nuevo antes de `describe('PATCH ...')`:

```ts
describe('GET /api/v1/event-programs/:id', () => {
  afterEach(() => {
    vi.doUnmock('./event-programs.service.js');
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../../utils/jwt-verifier.js');
    vi.doUnmock('../../lib/auth.js');
    vi.doUnmock('../authorization/authorization.service.js');
  });

  const publicDetail = {
    ...eventProgramListItem,
    activityCount: { visible: 6 },
  };

  it('returns the public detail without authentication', async () => {
    const service = buildServiceMock();
    service.getEventProgramById.mockResolvedValue(publicDetail);
    const app = await loadApp(service);

    const response = await request(app).get('/api/v1/event-programs/program-001').expect(200);

    expect(service.getEventProgramById).toHaveBeenCalledWith('program-001', null);
    expect(response.body).toEqual({
      success: true,
      message: 'Event program retrieved successfully.',
      data: publicDetail,
    });
  });

  it('passes the authenticated viewer to the service', async () => {
    const service = buildServiceMock();
    service.getEventProgramById.mockResolvedValue({
      ...publicDetail,
      activityCount: {
        visible: 6,
        total: 9,
        byStatus: { DRAFT: 2, SCHEDULED: 3, ONGOING: 1, COMPLETED: 2, CANCELLED: 1 },
      },
    });
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .get('/api/v1/event-programs/program-001')
      .set('Authorization', 'Bearer user-001')
      .expect(200);

    expect(service.getEventProgramById).toHaveBeenCalledWith('program-001', userRecord);
  });

  it('rejects a blank id before the service', async () => {
    const service = buildServiceMock();
    const app = await loadApp(service);

    await request(app).get('/api/v1/event-programs/%20').expect(400);
    expect(service.getEventProgramById).not.toHaveBeenCalled();
  });

  it('propagates a missing event program as 404', async () => {
    const service = buildServiceMock();
    const app = await loadApp(service);
    const { ApiError } = await import('../../utils/ApiError.js');
    service.getEventProgramById.mockRejectedValue(new ApiError(404, 'Event program not found.'));

    await request(app).get('/api/v1/event-programs/missing').expect(404);
  });

  it('rejects an invalid bearer token with 401 before the service', async () => {
    const service = buildServiceMock();
    const { ApiError } = await import('../../utils/ApiError.js');
    const verify = vi.fn().mockRejectedValue(new ApiError(401, 'Invalid or expired token.'));
    const app = await loadApp(service, createPrismaMock(), ['program:create'], vi.fn(), verify);

    await request(app)
      .get('/api/v1/event-programs/program-001')
      .set('Authorization', 'Bearer broken')
      .expect(401);

    expect(service.getEventProgramById).not.toHaveBeenCalled();
  });
});
```

Nota: `userRecord` ya existe en el archivo; el mock `user.findUnique` devuelve ese mismo objeto, por lo que `req.user` es igual a `userRecord`.

- [x] **Step 2: Correr las pruebas y verificar que fallan**

Run: `pnpm exec vitest run src/modules/event-programs/event-programs.routes.test.ts`
Expected: FAIL por 404/401/400 incorrecto; `getEventProgramById` no existe en el controlador.

- [x] **Step 3: Controlador**

En `event-programs.controller.ts`, ampliar imports:

```ts
import {
  createEventProgram as createEventProgramService,
  getEventProgramById as getEventProgramByIdService,
  listEventPrograms as listEventProgramsService,
  updateEventProgram as updateEventProgramService,
} from './event-programs.service.js';
```

y agregar:

```ts
export const getEventProgram: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const result = await getEventProgramByIdService(id, req.user ?? null);

  res.status(200).json(successResponse('Event program retrieved successfully.', result));
});
```

- [x] **Step 4: Ruta**

En `event-programs.routes.ts`, agregar imports:

```ts
import { optionalAuthenticate } from '../../middlewares/optionalAuthenticate.middleware.js';
import {
  createEventProgram,
  getEventProgram,
  getEventPrograms,
  updateEventProgram,
} from './event-programs.controller.js';
import {
  createEventProgramSchema,
  eventProgramParamsSchema,
  listEventProgramsQuerySchema,
  updateEventProgramSchema,
} from './event-programs.schemas.js';
```

y registrar despues del listado:

```ts
eventProgramsRoutes.get(
  '/event-programs/:id',
  optionalAuthenticate,
  validate(eventProgramParamsSchema),
  getEventProgram,
);
```

- [x] **Step 5: Correr las pruebas y verificar que pasan**

Run: `pnpm exec vitest run src/modules/event-programs/`
Expected: PASS.

---

### Task 5: OpenAPI, contrato y `openapi.json`

**Files:**

- Modify: `src/modules/event-programs/event-programs.openapi.ts`
- Test: `src/docs/openapi.test.ts`
- Regenerate: `openapi.json`

- [x] **Step 1: Escribir la prueba de contrato que falla**

En `src/docs/openapi.test.ts`, agregar a `expectedOperations` (mantener el orden actual del arreglo):

```ts
  'GET /api/v1/event-programs/{id}',
```

y agregar antes de la prueba de rate limiting:

```ts
it('documents the public event program detail with an optional bearer token', () => {
  const operation = openApiDocument.paths?.['/api/v1/event-programs/{id}']?.get;
  const parameters = operation?.parameters ?? [];
  const names = parameters.map((parameter) => ('name' in parameter ? parameter.name : undefined));

  expect(operation?.security).toBeUndefined();
  expect(names).toContain('id');
  expect(operation?.responses?.['200']).toBeDefined();
  expect(operation?.responses?.['401']).toBeDefined();
  expect(operation?.responses?.['404']).toBeDefined();
  expect(openApiDocument.components?.schemas).toHaveProperty('EventProgramPublicDetail');
  expect(openApiDocument.components?.schemas).toHaveProperty('EventProgramActivityCount');
});
```

- [x] **Step 2: Correr la prueba y verificar que falla**

Run: `pnpm exec vitest run src/docs/openapi.test.ts`
Expected: FAIL; falta la operacion `GET /api/v1/event-programs/{id}`.

- [x] **Step 3: Documentar la operacion**

En `event-programs.openapi.ts`, ampliar imports:

```ts
import {
  createEventProgramSchema,
  eventProgramDetailSchema,
  eventProgramParamsSchema,
  eventProgramPublicDetailSchema,
  listEventProgramsQuerySchema,
  paginatedEventProgramsSchema,
  updateEventProgramSchema,
} from './event-programs.schemas.js';
```

y agregar la operacion `get` dentro de `/api/v1/event-programs/{id}` antes de `patch`:

```ts
    get: {
      tags: ['Event Programs'],
      summary: 'Get an event program',
      description:
        'Public. Returns an ACTIVE event program with its activity count. Anonymous callers receive the public visible count (SCHEDULED, ONGOING and COMPLETED activities); ADMIN users and collaborators with program:read on the program also receive the total and the per-status breakdown. Non-active or missing programs respond 404. A present but invalid bearer token responds 401.',
      requestParams: { path: eventProgramParamsSchema.shape.params },
      responses: {
        200: {
          description: 'Event program detail.',
          content: {
            'application/json': { schema: apiSuccessResponse(eventProgramPublicDetailSchema) },
          },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
```

- [x] **Step 4: Correr la prueba y verificar que pasa**

Run: `pnpm exec vitest run src/docs/openapi.test.ts`
Expected: PASS.

- [x] **Step 5: Regenerar y verificar el contrato**

Run: `pnpm run docs:generate && pnpm run docs:check`
Expected: `openapi.json` actualizado y sin drift.

---

### Task 6: Bruno

**Files:**

- Modify: `bruno/environments/local.bru`
- Create: `bruno/Event_Programs/Log in as admin for event programs.bru`
- Create: `bruno/Event_Programs/Get an event program.bru`
- Create: `bruno/Event_Programs/Get an event program with an admin token shows the breakdown.bru`
- Create: `bruno/Event_Programs/Get an unknown event program returns 404.bru`
- Create: `bruno/Event_Programs/Get a non-active event program returns 404.bru`
- Create: `bruno/Event_Programs/Get an event program with an invalid token returns 401.bru`

- [x] **Step 1: Variables de entorno**

En `bruno/environments/local.bru`, agregar despues de `collaboratorsProgramId`:

```bru
  eventProgramId: seed_program_congreso-cit
```

- [x] **Step 2: Login de admin**

Crear `bruno/Event_Programs/Log in as admin for event programs.bru` (seq 4) con el patron de `Collaborators/Log in as admin again.bru`, guardando `token` con `bru.setVar` y testeando 200 + accessToken string.

- [x] **Step 3: GET publico**

Crear `bruno/Event_Programs/Get an event program.bru` (seq 5), `get` sin auth a `{{baseUrl}}/api/v1/event-programs/{{eventProgramId}}`. Tests:

```js
test('anonymous callers receive the public activity count', function () {
  expect(res.getStatus()).to.equal(200);
  const body = res.getBody();
  expect(body.success).to.equal(true);
  expect(body.message).to.equal('Event program retrieved successfully.');
  expect(body.data.id).to.equal(bru.getVar('eventProgramId'));
  expect(body.data.status).to.equal('ACTIVE');
  expect(body.data.organizationalUnit).to.be.an('object');
  expect(body.data.activityCount.visible).to.be.a('number');
  expect(body.data.activityCount.visible).to.be.at.least(1);
  expect(body.data.activityCount.total).to.equal(undefined);
  expect(body.data.activityCount.byStatus).to.equal(undefined);
});
```

- [x] **Step 4: GET privilegiado**

Crear `bruno/Event_Programs/Get an event program with an admin token shows the breakdown.bru` (seq 6) con `auth: bearer` y `{{token}}` (capturado por el login seq 4). Tests: 200; `activityCount.total` numero; `byStatus` con las 5 claves numericas; `total >= visible`; `visible` igual a `byStatus.SCHEDULED + ONGOING + COMPLETED`.

- [x] **Step 5: 404 desconocido**

Crear `bruno/Event_Programs/Get an unknown event program returns 404.bru` (seq 7) contra `{{unknownProgramId}}`; test 404 y mensaje `Event program not found.`.

- [x] **Step 6: 404 no activo**

Crear `bruno/Event_Programs/Get a non-active event program returns 404.bru` (seq 8) contra `{{archivedProgramId}}`; test 404.

- [x] **Step 7: 401 token invalido**

Crear `bruno/Event_Programs/Get an event program with an invalid token returns 401.bru` (seq 9) con `auth: bearer` `Bearer invalid-token`; test 401.

- [x] **Step 8: Correr la carpeta**

Run: `pnpm --dir bruno exec bru run Event_Programs --env local`
Expected: 7 requests (3 existentes + 4 de lectura) y todos los tests en verde. Nota: el login de admin agrega 1 request mas; el total real se registra en el cierre.

---

### Task 7: Documentacion y plan maestro

**Files:**

- Modify: `README.md`
- Modify: `CONTEXT.md`
- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [x] **Step 1: README**

Agregar en la seccion de programas, junto al listado publico: el detalle publico `GET /api/v1/event-programs/:id` (solo `ACTIVE`, 404 para otros estados), `activityCount.visible` publico (SCHEDULED+ONGOING+COMPLETED) y `total`/`byStatus` para `ADMIN` o `program:read`; token invalido 401.

- [x] **Step 2: CONTEXT**

Agregar el bullet correspondiente en `### Programas De Eventos Y Actividades`, con la semantica del conteo y la auth opcional fail-closed.

- [x] **Step 3: Plan maestro**

- Marcar `4.1` como `[x]`.
- Actualizar la tabla "Estado actual" (fila Programas) y la linea de "Endpoints existentes".
- Agregar el bloque "Registro de ejecucion (2026-09-20 - 4.1)" con pruebas, verificacion real, Bruno, contrato y hallazgos.

---

### Task 8: Verificacion real y gates

- [x] **Step 1: Stack dev**

Run: `docker compose -f compose.dev.yaml ps`
Expected: `api` y `db` arriba (si no, `docker compose -f compose.dev.yaml up -d`).

- [x] **Step 2: E2E anonimo y contraste psql**

- `curl -s localhost:3000/api/v1/event-programs/seed_program_congreso-cit` -> 200 sin `total`/`byStatus` y `visible` igual a la suma de `SCHEDULED+ONGOING+COMPLETED` segun psql.
- `curl -s localhost:3000/api/v1/event-programs/seed_program_foro-ipe` -> 404.
- `curl -s localhost:3000/api/v1/event-programs/program-does-not-exist` -> 404.
- `curl -s localhost:3000/api/v1/event-programs/%20` -> 400.
- `curl -s -H 'Authorization: Bearer broken' ...` -> 401.

- [x] **Step 3: E2E privilegiado**

- Login admin -> token; GET con token -> `total`/`byStatus` que cuadren con psql.
- Login `organizador.fisc@utp.ac.pa` -> GET -> desglose (tiene `program:read` en `seed_program_congreso-cit`).
- Login `estudiante01@utp.ac.pa` -> GET -> solo `visible`.

- [x] **Step 4: Gates**

Run: `pnpm test && pnpm run typecheck && pnpm run lint && pnpm run build && pnpm run format:check && pnpm run docs:check`
Expected: todo en verde.

- [x] **Step 5: Cierre**

- Registrar desviaciones/hallazgos en el plan maestro.
- Sin commit salvo solicitud explicita del usuario.

---

## Riesgos y notas

- `groupBy` con `_count: { _all: true }` es la unica consulta de conteo; en pruebas se mockea.
- El contrato publico no cambia para listado/POST/PATCH (`EventProgramDetail` intacto).
- El login de Bruno en la carpeta `Event_Programs` consume 1 intento del limiter de login; correr la carpeta una vez por ventana.
- `optionalAuthenticate` documenta `403` en OpenAPI por la cuenta desactivada, aunque el caso comun de token invalido sea `401`.
