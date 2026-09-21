# Fase 5.3 - Cancelar actividad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar `POST /api/v1/activities/:id/cancel` con permiso `activity:cancel` en el scope, motivo opcional persistido (`cancelReason`), idempotencia sobre actividades ya canceladas y rechazo de actividades `COMPLETED` o de programas no `ACTIVE`.

**Architecture:** Se extiende el modulo autocontenido `src/modules/activities/` existente (schemas Zod, servicio, controlador, rutas, OpenAPI y pruebas). Se agrega la columna nullable `activities.cancel_reason` con migracion Prisma, se expone `cancelReason` en `ActivityDetail` (solo detalle, nunca en listados) y `cancelActivity` reutiliza `activityDetailWithCountSelect`/`toActivityDetail` de 5.1. El permiso se verifica con `requirePermission(PERMISSIONS.ACTIVITY_CANCEL, activityScope)`, que ya resuelve herencia del programa mediante `getEffectivePermissions`.

**Tech Stack:** TypeScript, Express 5, Prisma 7 (Postgres), Zod 4, Vitest, Supertest, OpenAPI 3.1 (zod-openapi), Bruno.

**Decisiones confirmadas con el usuario (2026-09-21):**

1. **Motivo:** migracion `20260921..._add_activity_cancel_reason` (`cancel_reason VARCHAR(500)` nullable) y `cancelReason` expuesto en `ActivityDetail` (`null` cuando no hay motivo). Disponible para las notificaciones de 12.1.
2. **Estados e idempotencia:** cancelable desde `DRAFT`, `SCHEDULED` y `ONGOING`; `COMPLETED` responde `409`; cancelar una ya `CANCELLED` responde `200` idempotente sin escribir ni pisar el motivo original (aunque se envie uno nuevo).
3. **Programa no `ACTIVE`:** `409 Event programs must be active to cancel their activities.`, consistente con el `409` de `PATCH` (5.2). El archivo del programa congela sus actividades.

**Reglas de negocio (orden de guardas):**

1. Actividad inexistente -> `404 Activity not found.`
2. `status = COMPLETED` -> `409 Completed activities cannot be cancelled.`
3. `status = CANCELLED` -> `200` idempotente, sin `update` ni cambio de `cancelReason`; no se evalua el programa.
4. Programa no `ACTIVE` -> `409 Event programs must be active to cancel their activities.`
5. `update { status: 'CANCELLED', cancelReason: reason ?? null }` con `activityDetailWithCountSelect` y `200` con `ActivityDetail` (incluye `enrolledCount` y `checkedInCount`).

Otras reglas:

- `reason` opcional: string recortado, 1-500 caracteres. Body ausente, `{}` o `{ "reason": "..." }` son validos; claves desconocidas o motivo vacio/sobrado responden `400`.
- El body no puede modificar otros campos (`status`, `classroomId`, etc. -> `400`).
- Cancelar libera el aula automaticamente: el constraint GiST `activities_classroom_no_overlap` solo cubre `SCHEDULED`/`ONGOING`.
- No hay notificacion a inscritos ni alertas en esta fase (diferido a 12.1) ni auditoria de actor (12.2).
- El trigger `validate_activity_program` no exige programa `ACTIVE` al pasar a `CANCELLED`; la guarda de la regla 4 es de API.

**Hallazgos de partida (2026-09-21):**

- `PERMISSIONS.ACTIVITY_CANCEL = 'activity:cancel'` ya existe en el catalogo y es `ROLE_DEFAULT` de `ORGANIZER`; no se toca el catalogo ni el seed.
- `activityDetailSelect`, `activityDetailWithCountSelect`, `toActivityDetail` y `activityParamsSchema` son reutilizables; `ActivityDetail` no expone `cancelReason` todavia.
- La carpeta Bruno `Activities` usa seq 1-16; `draftActivityId` se captura en seq 3 y queda `SCHEDULED` tras seq 12. `seedActivityId = seed_activity_fic-charla-puentes` es `COMPLETED` en el seed.
- La sesion concurrente de fase 4.6 cerro y el baseline dirigido quedo en verde (200 pruebas, 6 archivos). Re-leer los archivos antes de cada edicion.

---

### Task 1: Migracion `add_activity_cancel_reason`

**Files:**

- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Rojo SQL (la columna no existe)**

Run:

```bash
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg_utp -c "UPDATE activities SET cancel_reason = 'probe' WHERE id = 'seed_activity_fic-charla-puentes';"
```

Expected: `ERROR: column "cancel_reason" of relation "activities" does not exist`.

- [ ] **Step 2: Agregar la columna al schema**

En `model Activity`, despues de `status`:

```prisma
  cancelReason String?        @map("cancel_reason") @db.VarChar(500)
```

- [ ] **Step 3: Formatear, validar y migrar**

Run:

```bash
pnpm prisma format
pnpm prisma validate
pnpm prisma:migrate:dev --name add_activity_cancel_reason
pnpm prisma generate
pnpm prisma:migrate:status
```

Expected: nueva migracion aplicada, `Database schema is up to date!`.

- [ ] **Step 4: Verde SQL**

Run:

```bash
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg_utp -c "BEGIN; UPDATE activities SET cancel_reason = 'probe' WHERE id = 'seed_activity_fic-charla-puentes'; ROLLBACK;"
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg_utp -c "\d activities" | grep cancel_reason
```

Expected: `UPDATE 1` y `cancel_reason | character varying(500)`.

---

### Task 2: Esquemas Zod y tipos (TDD)

**Files:**

- Modify: `src/modules/activities/activities.schemas.ts`
- Modify: `src/modules/activities/activities.types.ts`
- Test: `src/modules/activities/activities.schemas.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

Agregar `cancelActivitySchema` al import de `activities.schemas.test.ts` y, antes del `describe('cancelActivitySchema')`, agregar `cancelReason: null` a `activityDetailPayload`. Al final:

```ts
describe('cancelActivitySchema', () => {
  it('accepts a missing body and trims the activity id', () => {
    const parsed = cancelActivitySchema.parse({ params: { id: '  activity-001  ' } });

    expect(parsed).toEqual({ params: { id: 'activity-001' }, body: {} });
  });

  it('accepts and trims an optional reason', () => {
    const parsed = cancelActivitySchema.parse({
      params: { id: 'activity-001' },
      body: { reason: '  Reprogramada por lluvia  ' },
    });

    expect(parsed.body).toEqual({ reason: 'Reprogramada por lluvia' });
  });

  it('rejects blank reasons, oversized reasons and unknown keys', () => {
    const parse = (body: unknown) =>
      cancelActivitySchema.safeParse({ params: { id: 'activity-001' }, body });

    expect(parse({ reason: '   ' }).success).toBe(false);
    expect(parse({ reason: 'x'.repeat(501) }).success).toBe(false);
    expect(parse({ motive: 'Lluvia' }).success).toBe(false);
  });

  it('rejects a blank or oversized activity id', () => {
    expect(cancelActivitySchema.safeParse({ params: { id: '   ' } }).success).toBe(false);
    expect(cancelActivitySchema.safeParse({ params: { id: 'x'.repeat(101) } }).success).toBe(false);
  });
});
```

Y dentro de `describe('activityDetailSchema')`:

```ts
it('accepts a cancelled activity with a reason', () => {
  const payload = { ...activityDetailPayload, status: 'CANCELLED', cancelReason: 'Lluvia' };

  expect(activityDetailSchema.parse(payload)).toEqual(payload);
});
```

- [ ] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/activities/activities.schemas.test.ts`

Expected: falla por `cancelActivitySchema` inexistente y por `cancelReason` ausente en el schema.

- [ ] **Step 3: Implementar**

En `activities.types.ts`, agregar `cancelReason: string | null;` a `ActivityDetail` despues de `status`.

En `activities.schemas.ts`, agregar `cancelReason` a `activityDetailSchema`:

```ts
    cancelReason: z
      .string()
      .nullable()
      .meta({ description: 'Reason recorded when the activity was cancelled; null otherwise.' }),
```

Y despues de `activityParamsSchema` (o antes de `createActivitySchema`):

```ts
export const cancelActivityBodySchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1, 'Reason cannot be empty.')
      .max(500, 'Reason cannot exceed 500 characters.')
      .optional(),
  })
  .strict();

export const cancelActivitySchema = z.object({
  params: activityParamsSchema.shape.params,
  body: cancelActivityBodySchema.optional().default({}),
});

export type CancelActivityBody = z.infer<typeof cancelActivityBodySchema>;
```

- [ ] **Step 4: Verde**

Run: `pnpm exec vitest run src/modules/activities/activities.schemas.test.ts`

Expected: todas en verde.

---

### Task 3: Servicio `cancelActivity` (TDD)

**Files:**

- Modify: `src/modules/activities/activities.service.ts`
- Test: `src/modules/activities/activities.service.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

Extender el helper `buildDetailRecord` con `cancelReason?: string | null` y `cancelReason: overrides.cancelReason ?? null` en el retorno. Al final del archivo:

```ts
interface CancelPrismaMock {
  activity: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  attendance: { count: ReturnType<typeof vi.fn> };
}

const createCancelPrismaMock = (): CancelPrismaMock => ({
  activity: { findUnique: vi.fn(), update: vi.fn() },
  attendance: { count: vi.fn() },
});

const loadCancelService = async (prisma: CancelPrismaMock) => {
  vi.resetModules();
  vi.doMock('../../config/prisma.js', () => ({ getPrismaClient: () => prisma }));

  return import('./activities.service.js');
};

describe('cancelActivity', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
  });

  it('throws 404 when the activity does not exist', async () => {
    const prisma = createCancelPrismaMock();
    prisma.activity.findUnique.mockResolvedValue(null);
    const { cancelActivity } = await loadCancelService(prisma);

    await expect(cancelActivity('missing', 'Lluvia')).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.activity.update).not.toHaveBeenCalled();
  });

  it('rejects COMPLETED activities with 409', async () => {
    const prisma = createCancelPrismaMock();
    prisma.activity.findUnique.mockResolvedValue(buildDetailRecord({ status: 'COMPLETED' }));
    const { cancelActivity } = await loadCancelService(prisma);

    await expect(cancelActivity('activity-001', 'Lluvia')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Completed activities cannot be cancelled.',
    });
    expect(prisma.activity.update).not.toHaveBeenCalled();
  });

  it.each(['DRAFT', 'SCHEDULED', 'ONGOING'] as const)(
    'cancels a %s activity and stores the reason',
    async (status) => {
      const prisma = createCancelPrismaMock();
      prisma.activity.findUnique.mockResolvedValue(buildDetailRecord({ status }));
      prisma.activity.update.mockResolvedValue(
        buildDetailRecord({ status: 'CANCELLED', cancelReason: 'Lluvia' }),
      );
      prisma.attendance.count.mockResolvedValue(4);
      const { cancelActivity } = await loadCancelService(prisma);

      const result = await cancelActivity('activity-001', 'Lluvia');

      expect(prisma.activity.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'activity-001' },
          data: { status: 'CANCELLED', cancelReason: 'Lluvia' },
        }),
      );
      expect(result).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'Lluvia',
        enrolledCount: 6,
        checkedInCount: 4,
      });
    },
  );

  it('stores a null reason when none is provided', async () => {
    const prisma = createCancelPrismaMock();
    prisma.activity.findUnique.mockResolvedValue(buildDetailRecord({ status: 'SCHEDULED' }));
    prisma.activity.update.mockResolvedValue(buildDetailRecord({ status: 'CANCELLED' }));
    prisma.attendance.count.mockResolvedValue(0);
    const { cancelActivity } = await loadCancelService(prisma);

    await cancelActivity('activity-001');

    expect(prisma.activity.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CANCELLED', cancelReason: null } }),
    );
  });

  it('returns the existing cancellation without writing when already CANCELLED', async () => {
    const prisma = createCancelPrismaMock();
    prisma.activity.findUnique.mockResolvedValue(
      buildDetailRecord({ status: 'CANCELLED', cancelReason: 'Motivo original' }),
    );
    prisma.attendance.count.mockResolvedValue(4);
    const { cancelActivity } = await loadCancelService(prisma);

    const result = await cancelActivity('activity-001', 'Motivo nuevo');

    expect(prisma.activity.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'CANCELLED', cancelReason: 'Motivo original' });
  });

  it('rejects DRAFT activities of non ACTIVE programs with 409', async () => {
    const prisma = createCancelPrismaMock();
    prisma.activity.findUnique.mockResolvedValue(
      buildDetailRecord({ status: 'DRAFT', programStatus: 'ARCHIVED' }),
    );
    const { cancelActivity } = await loadCancelService(prisma);

    await expect(cancelActivity('activity-001')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Event programs must be active to cancel their activities.',
    });
    expect(prisma.activity.update).not.toHaveBeenCalled();
  });

  it('checks COMPLETED before the program state', async () => {
    const prisma = createCancelPrismaMock();
    prisma.activity.findUnique.mockResolvedValue(
      buildDetailRecord({ status: 'COMPLETED', programStatus: 'ARCHIVED' }),
    );
    const { cancelActivity } = await loadCancelService(prisma);

    await expect(cancelActivity('activity-001')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Completed activities cannot be cancelled.',
    });
  });
});
```

- [ ] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/activities/activities.service.test.ts`

Expected: falla por `cancelActivity` inexistente (y, si el schema `cancelReason` no existe, por tipos).

- [ ] **Step 3: Implementar**

En `activityDetailSelect` agregar `cancelReason: true`; en `ActivityDetailRecord` agregar `cancelReason: string | null;`; en `toActivityDetail` agregar `cancelReason: record.cancelReason,`. Al final del servicio:

```ts
export const cancelActivity = async (id: string, reason?: string): Promise<ActivityDetail> => {
  const prisma = getPrismaClient();

  const current = await prisma.activity.findUnique({
    where: { id },
    select: activityDetailWithCountSelect,
  });

  if (!current) {
    throw new ApiError(404, 'Activity not found.');
  }
  if (current.status === 'COMPLETED') {
    throw new ApiError(409, 'Completed activities cannot be cancelled.');
  }

  let record = current;

  if (current.status !== 'CANCELLED') {
    if (current.eventProgram.status !== 'ACTIVE') {
      throw new ApiError(409, 'Event programs must be active to cancel their activities.');
    }

    record = await prisma.activity.update({
      where: { id },
      data: { status: 'CANCELLED', cancelReason: reason ?? null },
      select: activityDetailWithCountSelect,
    });
  }

  const checkedInCount = await prisma.attendance.count({
    where: { activityId: id, checkedInAt: { not: null } },
  });

  return toActivityDetail(record, record._count.attendance, checkedInCount);
};
```

- [ ] **Step 4: Verde**

Run: `pnpm exec vitest run src/modules/activities/activities.service.test.ts`

Expected: todas en verde.

---

### Task 4: Controlador y ruta (TDD)

**Files:**

- Modify: `src/modules/activities/activities.controller.ts`
- Modify: `src/modules/activities/activities.routes.ts`
- Test: `src/modules/activities/activities.routes.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

Agregar `cancelActivity` al `ActivitiesServiceMock`/`buildServiceMock`. Al final del `describe`:

```ts
it('rejects cancel requests without a token', async () => {
  const service = buildServiceMock();
  const app = await loadApp({ service });

  await request(app).post('/api/v1/activities/activity-002/cancel').send({}).expect(401);
  expect(service.cancelActivity).not.toHaveBeenCalled();
});

it('rejects cancel requests when the user lacks activity:cancel', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(userRecord);
  const authorization: AuthorizationMock = {
    getEffectivePermissions: vi.fn().mockResolvedValue(new Set()),
  };
  const app = await loadApp({ service, prisma, authorization });

  await request(app)
    .post('/api/v1/activities/activity-002/cancel')
    .set('Authorization', `Bearer ${userToken}`)
    .send({})
    .expect(403);

  expect(authorization.getEffectivePermissions).toHaveBeenCalledWith(userRecord, {
    activityId: 'activity-002',
  });
  expect(service.cancelActivity).not.toHaveBeenCalled();
});

it('cancels an activity for a collaborator with activity:cancel', async () => {
  const service = buildServiceMock();
  service.cancelActivity.mockResolvedValue({
    ...activityDetail,
    status: 'CANCELLED',
    cancelReason: 'Lluvia',
  });
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(userRecord);
  const authorization: AuthorizationMock = {
    getEffectivePermissions: vi.fn().mockResolvedValue(new Set(['activity:cancel'])),
  };
  const app = await loadApp({ service, prisma, authorization });

  const response = await request(app)
    .post('/api/v1/activities/activity-002/cancel')
    .set('Authorization', `Bearer ${userToken}`)
    .send({ reason: '  Lluvia  ' })
    .expect(200);

  expect(service.cancelActivity).toHaveBeenCalledWith('activity-002', 'Lluvia');
  expect(response.body).toEqual({
    success: true,
    message: 'Activity cancelled successfully.',
    data: { ...activityDetail, status: 'CANCELLED', cancelReason: 'Lluvia' },
  });
});

it('cancels an activity for an admin without a permission lookup and without a body', async () => {
  const service = buildServiceMock();
  service.cancelActivity.mockResolvedValue({
    ...activityDetail,
    status: 'CANCELLED',
    cancelReason: null,
  });
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminRecord);
  const authorization: AuthorizationMock = {
    getEffectivePermissions: vi.fn().mockResolvedValue(new Set()),
  };
  const app = await loadApp({ service, prisma, authorization });

  await request(app)
    .post('/api/v1/activities/activity-002/cancel')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({})
    .expect(200);

  expect(authorization.getEffectivePermissions).not.toHaveBeenCalled();
  expect(service.cancelActivity).toHaveBeenCalledWith('activity-002', undefined);
});

it('rejects cancel bodies with unknown keys, a blank reason or an oversized reason', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminRecord);
  const app = await loadApp({ service, prisma });

  await request(app)
    .post('/api/v1/activities/activity-002/cancel')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ motive: 'Lluvia' })
    .expect(400);
  await request(app)
    .post('/api/v1/activities/activity-002/cancel')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ reason: '   ' })
    .expect(400);
  await request(app)
    .post('/api/v1/activities/activity-002/cancel')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ reason: 'x'.repeat(501) })
    .expect(400);

  expect(service.cancelActivity).not.toHaveBeenCalled();
});

it('rejects a blank activity id on cancel before the service', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminRecord);
  const app = await loadApp({ service, prisma });

  await request(app)
    .post('/api/v1/activities/%20/cancel')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({})
    .expect(400);

  expect(service.cancelActivity).not.toHaveBeenCalled();
});

it('propagates the service 404 and 409 errors on cancel', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminRecord);
  const app = await loadApp({ service, prisma });
  const { ApiError } = await import('../../utils/ApiError.js');

  service.cancelActivity.mockRejectedValue(new ApiError(404, 'Activity not found.'));
  await request(app)
    .post('/api/v1/activities/missing/cancel')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({})
    .expect(404);

  service.cancelActivity.mockRejectedValue(
    new ApiError(409, 'Completed activities cannot be cancelled.'),
  );
  const conflict = await request(app)
    .post('/api/v1/activities/activity-002/cancel')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({})
    .expect(409);

  expect(conflict.body).toMatchObject({
    success: false,
    message: 'Completed activities cannot be cancelled.',
  });
});
```

Nota: `activityDetail` en el archivo de rutas hoy no incluye `cancelReason`; el `.toEqual` compara el DTO que devuelve el mock, por lo que no requiere cambios adicionales.

- [ ] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/activities/activities.routes.test.ts`

Expected: 404 en las rutas nuevas (6 fallos) y `service.cancelActivity` inexistente.

- [ ] **Step 3: Implementar**

Controlador:

```ts
export const cancelActivity: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as ActivityParams;
  const body = req.body as CancelActivityBody;
  const result = await cancelActivityService(id, body.reason);

  res.status(200).json(successResponse('Activity cancelled successfully.', result));
});
```

Importar `cancelActivity as cancelActivityService` y el tipo `CancelActivityBody`. Ruta, despues del `PATCH`:

```ts
activitiesRoutes.post(
  '/activities/:id/cancel',
  authenticate,
  requirePermission(PERMISSIONS.ACTIVITY_CANCEL, activityScope),
  validate(cancelActivitySchema),
  cancelActivity,
);
```

- [ ] **Step 4: Verde**

Run: `pnpm exec vitest run src/modules/activities`

Expected: todas en verde.

---

### Task 5: Contrato OpenAPI (TDD)

**Files:**

- Modify: `src/modules/activities/activities.openapi.ts`
- Test: `src/docs/openapi.test.ts`
- Generated: `openapi.json`

- [ ] **Step 1: Escribir las pruebas que fallan**

Agregar `'POST /api/v1/activities/{id}/cancel'` a `expectedOperations` y:

```ts
it('documents the activity cancellation with bearer security and its conflicts', () => {
  const operation = openApiDocument.paths?.['/api/v1/activities/{id}/cancel']?.post;
  const detail = openApiDocument.components?.schemas?.['ActivityDetail'] as
    { properties?: Record<string, unknown> } | undefined;

  expect(operation?.security).toEqual([{ bearerAuth: [] }]);
  expect(operation?.responses?.['200']).toBeDefined();
  expect(operation?.responses?.['400']).toBeDefined();
  expect(operation?.responses?.['401']).toBeDefined();
  expect(operation?.responses?.['403']).toBeDefined();
  expect(operation?.responses?.['404']).toBeDefined();
  expect(operation?.responses?.['409']).toBeDefined();
  expect(detail?.properties).toHaveProperty('cancelReason');
});
```

- [ ] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/docs/openapi.test.ts`

Expected: falla porque la operacion no existe.

- [ ] **Step 3: Implementar**

En `activities.openapi.ts`, agregar el path (importar `cancelActivityBodySchema`):

```ts
  '/api/v1/activities/{id}/cancel': {
    post: {
      tags: ['Activities'],
      summary: 'Cancel an activity',
      description:
        'Cancels an activity and optionally records a reason. Requires the activity:cancel permission on the activity scope (or the ADMIN role). DRAFT, SCHEDULED and ONGOING activities can be cancelled; COMPLETED activities respond 409 and activities of non ACTIVE event programs also respond 409. Cancelling an already cancelled activity is idempotent: it responds 200 without overwriting the recorded reason. The optional body accepts a trimmed reason of up to 500 characters.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: activityParamsSchema.shape.params },
      requestBody: {
        required: false,
        content: { 'application/json': { schema: cancelActivityBodySchema } },
      },
      responses: {
        200: {
          description: 'Cancelled activity.',
          content: { 'application/json': { schema: apiSuccessResponse(activityDetailSchema) } },
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

- [ ] **Step 4: Regenerar y verificar**

Run:

```bash
pnpm run docs:generate
pnpm exec vitest run src/docs/openapi.test.ts
pnpm run docs:check
```

Expected: sin drift y pruebas en verde.

---

### Task 6: Coleccion Bruno

**Files:**

- Create: `bruno/Activities/Cancel a scheduled activity.bru`
- Create: `bruno/Activities/Cancel an already cancelled activity returns 200.bru`
- Create: `bruno/Activities/Cancel a completed activity returns 409.bru`
- Create: `bruno/Activities/Cancel an activity without a token returns 401.bru`
- Create: `bruno/Activities/Cancel an activity as a user without permission returns 403.bru`
- Create: `bruno/Activities/Cancel an unknown activity returns 404.bru`
- Create: `bruno/Activities/Cancel an activity with an unknown field returns 400.bru`

- [ ] **Step 1: Crear los requests seq 17-23**

Cancelacion 200 con motivo recortado y captura de `cancelledActivityId` (o reutilizar `draftActivityId`):

```bru
meta {
  name: Cancel a scheduled activity
  type: http
  seq: 17
  tags: [Activities]
}

post {
  url: {{baseUrl}}/api/v1/activities/{{draftActivityId}}/cancel
  body: json
  auth: bearer
}

auth:bearer {
  token: {{token}}
}

body:json {
  { "reason": "  Reprogramada por disponibilidad del ponente  " }
}

tests {
  test("cancelling records the trimmed reason", function () {
    expect(res.getStatus()).to.equal(200);
    const body = res.getBody();
    expect(body.data.status).to.equal("CANCELLED");
    expect(body.data.cancelReason).to.equal("Reprogramada por disponibilidad del ponente");
    expect(body.data.enrolledCount).to.be.a("number");
  });
}
```

El resto sigue el mismo patron: repetido `200` conservando el motivo (`Cancel an already cancelled activity returns 200`), `{{seedActivityId}}` -> `409`, sin `Authorization` -> `401`, `{{userToken}}` -> `403`, `activity-does-not-exist` (`unknownActivityId`) -> `404`, y `{ "motive": "x" }` -> `400`.

- [ ] **Step 2: Correr la carpeta**

Run: `pnpm --dir bruno exec bru run Activities --env local`

Expected: requests/tests en verde (incluye los de 5.1/5.2). Si el rate limit de login molesta, usar `X-Forwarded-For` como en fases previas.

---

### Task 7: Documentacion y plan maestro

**Files:**

- Modify: `README.md`
- Modify: `CONTEXT.md`
- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [ ] **Step 1: README y CONTEXT**

Agregar en la seccion de Actividades: `POST /api/v1/activities/:id/cancel` privado, requiere `activity:cancel` (default de `ORGANIZER`), body opcional `{ reason }` (1-500), `cancelReason` en el detalle, idempotente sobre `CANCELLED`, `409` para `COMPLETED` y para programas no `ACTIVE`, y que cancelar libera el aula.

- [ ] **Step 2: Plan maestro**

Marcar 5.3 `[x]`, actualizar la fila de Actividades del "Estado actual", agregar la operacion a "Endpoints existentes" y un `Registro de ejecucion (2026-09-21 - 5.3)` con: plan, migracion, pruebas, verificacion real, Bruno, contrato, docs, hallazgos (`F5.3-A` sin notificacion a inscritos -> 12.1; `F5.3-B` sin auditoria de actor -> 12.2; `F5.3-C` actividades `DRAFT` en programas archivados quedan incancelables) y gates.

---

### Task 8: Verificacion real con Docker + psql

- [ ] **Step 1: Preparar el stack**

Run: `docker compose -f compose.dev.yaml up -d` y esperar salud; login admin y guardar token.

- [ ] **Step 2: E2E**

Comprobar: cancelar un draft con motivo (`200`, psql `CANCELLED|motivo`); repetir con otro motivo (`200`, motivo original intacto); `COMPLETED` (`seed_activity_fic-charla-puentes`) `409`; programa archivado (programa temporal archivado con una actividad `DRAFT`) `409`; id desconocido `404`; id en blanco y clave desconocida `400`; sin token `401`; `estudiante01` `403`; liberacion de aula (crear A `SCHEDULED`, bloqueo con B `409`, cancelar A, publicar B `200`); limpieza de filas temporales con psql y conteos baseline restaurados.

- [ ] **Step 3: Limpieza**

Deshabilitar el trigger `event_programs_prevent_delete` en una transaccion para borrar el programa temporal, restaurar triggers y confirmar conteos.

---

### Task 9: Gates finales

- [ ] `pnpm test`
- [ ] `pnpm run typecheck`
- [ ] `pnpm run lint`
- [ ] `pnpm run build`
- [ ] `pnpm run format:check` (los archivos de 5.3 deben pasar; reportar solo archivos ajenos)
- [ ] `pnpm run docs:generate` y `pnpm run docs:check`
