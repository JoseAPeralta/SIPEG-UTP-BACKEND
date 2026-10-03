# Fase 5.1 - Consultar actividad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar `GET /api/v1/activities/:id` con `enrolledCount` y `checkedInCount`, visibilidad publica para actividades no-DRAFT de programas ACTIVE y lectura privada completa para ADMIN o colaboradores con `activity:read` en el scope.

**Architecture:** Modulo autocontenido `src/modules/activities/` con el patron de `classrooms`/`organizational-units`. Se extiende `ActivityDetail` (compartido con `POST /activities`) y se agrega un middleware reutilizable `optionalAuthenticate` que convierte el header `Authorization` en autenticacion opcional: ausente = anonimo, presente = se valida y sus errores propagan 401/403. El servicio reutiliza `getEffectivePermissions` de `authorization.service` con scope `{ activityId }` (incluye herencia del programa y envelope temporal).

**Tech Stack:** TypeScript 6, Express 5, Prisma 7 (SQL/Postgres), Zod 4, Vitest, Supertest, OpenAPI 3.1 (zod-openapi), Bruno.

**Decisiones confirmadas (2026-09-20):**

1. Anonimo ve actividad si `status !== 'DRAFT'` y el programa esta `ACTIVE` (incluye `SCHEDULED`, `ONGOING`, `COMPLETED` y `CANCELLED`). Si no cumple visibilidad responde `404` para no revelar existencia.
2. Bearer valido de `ADMIN` o con `activity:read` efectivo en el scope ve cualquier estado y programas archivados/DRAFT. Header presente pero invalido/expirado responde `401`.
3. La respuesta incluye `enrolledCount` (filas de `attendance`) y `checkedInCount` (`checkedInAt != null`).
4. `ActivityDetail` se comparte con `POST /activities`, que devolvera `enrolledCount: 0` y `checkedInCount: 0`.
5. Sin migraciones, variables de entorno ni permisos nuevos.

**Reglas de negocio:**

- **Visibilidad publica:** `activity.status !== 'DRAFT'` y `activity.eventProgram.status === 'ACTIVE'`.
- **Acceso privado:** bypass `ADMIN`; en otro caso `getEffectivePermissions(viewer, { activityId })` debe contener `activity:read`.
- **Oculta existencia:** un autenticado sin permiso sobre una actividad no publica recibe `404 Activity not found.`
- **Conteos:** `enrolledCount = attendance.count({ activityId })`; `checkedInCount = attendance.count({ activityId, checkedInAt: { not: null } })`.
- **No exponer:** codigos de check-in, emails de ponentes ni `grantedById`/`grantedAt`.

**Hallazgos de partida (2026-09-20):**

- `activities.service.ts` ya define `activitySelect`/`activityDetailSelect`, `toActivityListItem`/`toActivityDetail` y `createActivity`; no existe `getActivityById`.
- `ActivityDetail` no incluye conteos; `ActivityStatus` incluye `DRAFT`.
- `authenticate.middleware.ts` expone `authenticate` y `requireAuthenticatedUser`; no existe variante opcional.
- `getEffectivePermissions(user, scope)` resuelve el programa padre desde `activityId` y une colaboraciones de programa y actividad con sus ventanas.
- `Activity._count` esta disponible en el Prisma Client generado (`src/generated/prisma/models/Activity.ts`).
- Seed: `seed_activity_fic-charla-puentes` esta `COMPLETED` en el programa predeterminado FIC (`ACTIVE`) con 6 asistencias y 4 check-ins; `seed_activity_fic-charla-cancelada` esta `CANCELLED`. No hay actividades `DRAFT` sembradas.

---

### Task 1: Tipos y esquemas Zod (TDD)

**Files:**

- Modify: `src/modules/activities/activities.types.ts`
- Modify: `src/modules/activities/activities.schemas.ts`
- Test: `src/modules/activities/activities.schemas.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

Agregar a `activities.schemas.test.ts`:

```ts
import { activityParamsSchema, ... } from './activities.schemas.js';

describe('activityParamsSchema', () => {
  it('trims the activity id', () => {
    expect(activityParamsSchema.parse({ params: { id: '  activity-001  ' } }).params.id).toBe(
      'activity-001',
    );
  });

  it('rejects a blank activity id', () => {
    expect(() => activityParamsSchema.parse({ params: { id: '   ' } })).toThrow();
  });

  it('rejects an activity id above 100 characters', () => {
    expect(() => activityParamsSchema.parse({ params: { id: 'a'.repeat(101) } })).toThrow();
  });
});
```

Extender `activityDetailPayload` con `enrolledCount: 6, checkedInCount: 4` y agregar:

```ts
it('rejects missing or negative counts', () => {
  expect(() =>
    activityDetailSchema.parse({ ...activityDetailPayload, enrolledCount: -1 }),
  ).toThrow();
  expect(() =>
    activityDetailSchema.parse({ ...activityDetailPayload, checkedInCount: 1.5 }),
  ).toThrow();
});
```

- [ ] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/activities/activities.schemas.test.ts`
Expected: FAIL porque `activityParamsSchema` no existe y el detalle no acepta conteos.

- [ ] **Step 3: Implementar**

`activities.types.ts`: agregar a `ActivityDetail`:

```ts
enrolledCount: number;
checkedInCount: number;
```

`activities.schemas.ts`:

```ts
export const activityParamsSchema = z.object({
  params: z.object({
    id: z
      .string()
      .trim()
      .min(1, 'Activity id is required.')
      .max(100, 'Activity id cannot exceed 100 characters.'),
  }),
});

export type ActivityParams = z.infer<typeof activityParamsSchema>['params'];
```

Y en `activityDetailSchema`, despues de `capacity`:

```ts
enrolledCount: z.number().int().nonnegative().meta({ description: 'Registered attendees.' }),
checkedInCount: z.number().int().nonnegative().meta({ description: 'Attendees who checked in.' }),
```

- [ ] **Step 4: Verificar el verde**

Run: `pnpm exec vitest run src/modules/activities/activities.schemas.test.ts`
Expected: PASS.

- [ ] **Step 5: Actualizar el fixture de rutas y servicio**

Agregar `enrolledCount: 0, checkedInCount: 0` a `activityDetail` en `activities.routes.test.ts` y a los fixtures de detalle del servicio para que el typecheck siga en verde.

---

### Task 2: Middleware `optionalAuthenticate` (TDD)

**Files:**

- Modify: `src/middlewares/authenticate.middleware.ts`
- Test: `src/middlewares/authenticate.middleware.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
it('passes through without an Authorization header', async () => {
  const prisma = createPrismaMock();
  const { optionalAuthenticate } = await loadAuthMiddleware(prisma);
  const next = vi.fn();
  const req = { headers: {} } as Request;

  await optionalAuthenticate(req, {} as Response, next);

  expect(next).toHaveBeenCalledWith();
  expect(req.user).toBeUndefined();
  expect(prisma.user.findUnique).not.toHaveBeenCalled();
});

it('rejects a malformed Authorization header', async () => {
  const prisma = createPrismaMock();
  const { optionalAuthenticate } = await loadAuthMiddleware(prisma);
  const next = vi.fn();

  await optionalAuthenticate(
    { headers: { authorization: 'Basic xyz' } } as Request,
    {} as Response,
    next,
  );

  const error = next.mock.calls[0]?.[0] as ApiError | undefined;
  expect(error?.statusCode).toBe(401);
});

it('attaches the user when a valid token is present', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue({
    id: 'user-1',
    email: 'a@b.com',
    globalRole: 'USER',
    unitId: null,
    careerId: null,
    isActive: true,
  });
  const { optionalAuthenticate } = await loadAuthMiddleware(prisma);
  const token = await signToken();
  const req = { headers: { authorization: `Bearer ${token}` } } as Request;
  const next = vi.fn();

  await optionalAuthenticate(req, {} as Response, next);

  expect(next).toHaveBeenCalledWith();
  expect(req.user?.id).toBe('user-1');
});
```

- [ ] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/middlewares/authenticate.middleware.test.ts`
Expected: FAIL porque `optionalAuthenticate` no existe.

- [ ] **Step 3: Implementar**

```ts
export const optionalAuthenticate: RequestHandler = (req, res, next) => {
  if (!req.headers.authorization) {
    next();
    return;
  }

  void authenticate(req, res, next);
};
```

- [ ] **Step 4: Verificar el verde**

Run: `pnpm exec vitest run src/middlewares/authenticate.middleware.test.ts`
Expected: PASS.

---

### Task 3: Servicio `getActivityById` con visibilidad (TDD)

**Files:**

- Modify: `src/modules/activities/activities.service.ts`
- Test: `src/modules/activities/activities.service.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

Extender `PrismaMock` con `findUnique` y `attendance.count`. Fixture `buildRecord` con `programStatus: 'ACTIVE'` y `status: 'SCHEDULED'`. Pruebas:

```ts
it('returns the detail with enrollment and check-in counts', ...);
it('throws 404 when the activity does not exist', ...);
it('hides DRAFT activities from anonymous viewers', ...);
it('hides activities of non ACTIVE programs from anonymous viewers', ...);
it('exposes COMPLETED and CANCELLED activities publicly', ...);
it('lets a collaborator with activity:read see a DRAFT activity', ...);
it('lets an ADMIN see a DRAFT activity without a permission lookup', ...);
it('falls back to the public rule for an authenticated viewer without permission', ...);
```

Las pruebas de permiso mockean `../authorization/authorization.service.js` con `getEffectivePermissions`.

- [ ] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/activities/activities.service.test.ts`
Expected: FAIL porque `getActivityById` no existe.

- [ ] **Step 3: Implementar**

En `activities.service.ts`:

```ts
import { getEffectivePermissions } from '../authorization/authorization.service.js';
import { PERMISSIONS } from '../authorization/permissions.js';

const PUBLIC_HIDDEN_STATUS: ActivityStatus = 'DRAFT';

const assertPublicVisibility = (record: {
  status: ActivityStatus;
  eventProgram: { status: ProgramStatus };
}): void => {
  if (record.status === PUBLIC_HIDDEN_STATUS || record.eventProgram.status !== 'ACTIVE') {
    throw new ApiError(404, 'Activity not found.');
  }
};

export const getActivityById = async (
  id: string,
  viewer?: Express.AuthenticatedUser,
): Promise<ActivityDetail> => {
  const prisma = getPrismaClient();
  const record = await prisma.activity.findUnique({
    where: { id },
    select: activityDetailWithCountSelect,
  });

  if (!record) {
    throw new ApiError(404, 'Activity not found.');
  }

  if (!viewer || viewer.globalRole !== 'ADMIN') {
    const canReadAll = viewer
      ? (await getEffectivePermissions(viewer, { activityId: id })).has(PERMISSIONS.ACTIVITY_READ)
      : false;

    if (!canReadAll) {
      assertPublicVisibility(record);
    }
  }

  const checkedInCount = await prisma.attendance.count({
    where: { activityId: id, checkedInAt: { not: null } },
  });

  return toActivityDetail(record, record._count.attendance, checkedInCount);
};
```

`activityDetailWithCountSelect` = `activityDetailSelect` + `eventProgram.status: true` + `_count: { select: { attendance: true } }`. El mapper `toActivityDetail(record, enrolledCount, checkedInCount)` toma los conteos; `createActivity` llama `toActivityDetail(record, 0, 0)`.

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

Agregar `getActivityById` al `ActivitiesServiceMock` y pruebas:

```ts
it('returns a public activity without authentication', ...);
it('rejects a blank activity id before the service', ...);
it('returns 404 for an unknown activity', ...);
it('rejects an invalid bearer token with 401', ...);
it('forwards the authenticated viewer to the service', ...);
```

- [ ] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/activities/activities.routes.test.ts`
Expected: FAIL porque la ruta no existe (404) y el mock no expone `getActivityById`.

- [ ] **Step 3: Implementar**

Controlador:

```ts
export const getActivity: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as ActivityParams;
  const result = await getActivityByIdService(id, req.user);

  res.status(200).json(successResponse('Activity retrieved successfully.', result));
});
```

Ruta (despues del listado):

```ts
activitiesRoutes.get(
  '/activities/:id',
  optionalAuthenticate,
  validate(activityParamsSchema),
  getActivity,
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

`activities.openapi.ts`: path `/api/v1/activities/{id}` con `get`, tags `Activities`, descripcion de visibilidad publica/privada, `requestParams: { path: activityParamsSchema.shape.params }`, respuestas 200 (`apiSuccessResponse(activityDetailSchema)`), 400, 401, 404. Sin `security` (acceso anonimo), documentando el bearer opcional en la descripcion.

- [ ] **Step 2: Actualizar el test de contrato**

`openapi.test.ts`: agregar `'GET /api/v1/activities/{id}'` a `expectedOperations` y aserciones de param `id`, ausencia de `security` y respuestas 200/404.

- [ ] **Step 3: Verificar rojo y regenerar**

Run: `pnpm exec vitest run src/docs/openapi.test.ts`
Expected: FAIL hasta agregar la operacion; luego `pnpm run docs:generate` y `pnpm run docs:check` en verde.

---

### Task 6: Bruno y documentacion

**Files:**

- Create: `bruno/Activities/Log in as admin.bru`
- Create: `bruno/Activities/Get an activity.bru`
- Create: `bruno/Activities/Get an unknown activity returns 404.bru`
- Create: `bruno/Activities/Create a draft activity.bru` (o reutilizar el existente)
- Create: `bruno/Activities/Get a draft activity anonymously returns 404.bru`
- Create: `bruno/Activities/Get a draft activity as admin.bru`
- Modify: `README.md`, `CONTEXT.md`

- [ ] **Step 1: Requests Bruno** con assertions de status/conteos y captura de `token`/`draftActivityId`.
- [ ] **Step 2: README/CONTEXT** describen el endpoint, la visibilidad y los conteos.
- [ ] **Step 3: Correr** `bru run Activities --env local` con el stack local.

---

### Task 7: Verificacion real y cierre

- [ ] **Step 1: Gates** `pnpm test`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, `pnpm run build`, `pnpm run docs:check`.
- [ ] **Step 2: E2E Docker + psql** conteos de `seed_activity_fic-charla-puentes`, 404 desconocida/id en blanco, DRAFT anonimo 404 y con admin 200, token invalido 401; limpieza de la actividad temporal.
- [ ] **Step 3: Registro** actualizar checklist 5.1 y bitacora en `docs/superpowers/plans/plan-maestro-sipeg-utp.md`.
