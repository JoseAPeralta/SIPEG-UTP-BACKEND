# Fase 3.5 - Otorgar permiso Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exponer `POST /event-programs/:id/permissions` y `POST /activities/:id/permissions` que crean o reemplazan un grant local `OVERRIDE` para un colaborador existente, con subconjunto simetrico, atenuacion temporal y `200` + `Collaborator`.

**Architecture:** Se extiende `src/modules/authorization/` (servicio de delegacion y capa HTTP 3.1-3.4). Las rutas siguen `authenticate -> requirePermission(permission:grant, resolver) -> validate -> controlador -> servicio`. El servicio re-lee el colaborador dentro de una transaccion y devuelve el DTO local. Sin migraciones, variables de entorno ni permisos nuevos.

**Tech Stack:** TypeScript 6, Express 5, Prisma 7 (SQL/Postgres), Zod 4, Vitest, Supertest, OpenAPI 3.1 (zod-openapi), Bruno.

**Hallazgos de partida (2026-09-20):**

- `grantPermission` ya existe en `delegation.service.ts:423` con subconjunto simetrico (`assertWindowWithinEnvelope`), atenuacion temporal y ventana invertida probados; devuelve `void` y no valida programa inexistente/archivado.
- El catalogo `PERMISSION_NAMES` esta tipado como `PermissionName[]`; `z.enum(PERMISSION_NAMES, 'Permission is invalid.')` funciona en Zod 4 (verificado en runtime).
- `z.iso.datetime({ offset: true, error: '...' })` funciona en Zod 4 (verificado en runtime) y el transform a `Date` convive con `zod-openapi` (que documenta el lado de entrada, como `AddClassroomAmenity`).
- Precedentes: `POST /collaborators` responde `201` + DTO, `PATCH` responde `200` + DTO; `GET`/`PATCH` de colaboradores agregaron `loadScopeProgram` (404/409). El seed demo otorga a `seed_user_org-fisc` un `OVERRIDE` de `permission:grant` en `congreso-cit` con ventana `[seedNow, seedNow + 60d]`.
- Bruno `Collaborators` termina en seq 32 con token admin vigente; `collaboratorUserId` se crea en seq 7 (runtime var de esa corrida).

**Decisiones confirmadas (2026-09-20):**

1. Alcance: solo 3.5. 3.6 (revocar) va en su propia sesion por la regla de herencia.
2. Respuesta: `200` + `Collaborator` (el upsert refleja el estado final de los grants locales; no se distingue creacion de reemplazo).
3. `validFrom`/`validUntil` opcionales y nullable en el body; ISO 8601 con offset o `Z`; se transforman a `Date` en el esquema.
4. `grantPermission` agrega las guardas de programa (`404 Event program not found.` / `409 Archived event programs cannot be modified.`) por consistencia con 3.1-3.4.
5. `F3.5-A` diferido: un grant con ventana totalmente pasada se acepta si el actor tiene envelope; el resolver lo ignora y no se agrega validacion extra en 3.5.

---

### Task 1: Servicio (TDD)

**Files:**

- Modify: `src/modules/authorization/delegation.service.ts`
- Test: `src/modules/authorization/delegation.service.test.ts`

- [x] **Step 1: Pruebas que fallan**

Actualizar los 3 tests existentes de `grantPermission` que llegan al servicio:

1. `writes OVERRIDE rows with grantedById set`: agregar
   `prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });` y
   `prisma.collaboration.findUniqueOrThrow.mockResolvedValue(collaboratorRecord());`
2. `allows delegating permission:grant when the actor holds it`: los mismos dos mocks.
3. `rejects granting to a missing collaboration`: agregar solo el mock de `eventProgram` (`ACTIVE`).

Agregar las pruebas nuevas:

```ts
it('rejects grants on a missing event program', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue(null);
  const { grantPermission } = await loadService(prisma);

  await expect(
    grantPermission(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
      PERMISSIONS.ACTIVITY_UPDATE,
      {},
      NOW,
    ),
  ).rejects.toMatchObject({ statusCode: 404, message: 'Event program not found.' });
  expect(prisma.collaborationPermission.upsert).not.toHaveBeenCalled();
});

it('rejects grants on an archived event program', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ARCHIVED' });
  const { grantPermission } = await loadService(prisma);

  await expect(
    grantPermission(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
      PERMISSIONS.ACTIVITY_UPDATE,
      {},
      NOW,
    ),
  ).rejects.toMatchObject({
    statusCode: 409,
    message: 'Archived event programs cannot be modified.',
  });
  expect(prisma.collaborationPermission.upsert).not.toHaveBeenCalled();
});

it('resolves the activity scope to its parent program before granting', async () => {
  const prisma = createPrismaMock();
  prisma.activity.findUnique.mockResolvedValue({ eventProgramId: 'p1' });
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
  prisma.collaboration.findFirst.mockResolvedValue({ id: 'collab-001' });
  prisma.permission.findUnique.mockResolvedValue({
    id: 'perm-update',
    name: PERMISSIONS.ACTIVITY_UPDATE,
  });
  prisma.collaboration.findUniqueOrThrow.mockResolvedValue(collaboratorRecord());
  const { grantPermission } = await loadService(prisma);

  await grantPermission(
    buildUser({ globalRole: 'ADMIN' }),
    { activityId: 'a1' },
    'user-002',
    PERMISSIONS.ACTIVITY_UPDATE,
    {},
    NOW,
  );

  expect(prisma.collaboration.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({ where: { userId: 'user-002', activityId: 'a1' } }),
  );
});

it('returns the updated collaborator detail after granting', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
  prisma.collaboration.findFirst.mockResolvedValue({ id: 'collab-001' });
  prisma.permission.findUnique.mockResolvedValue({
    id: 'perm-update',
    name: PERMISSIONS.ACTIVITY_UPDATE,
  });
  prisma.collaborationPermission.upsert.mockResolvedValue({});
  prisma.collaboration.findUniqueOrThrow.mockResolvedValue(
    collaboratorRecord({
      permissions: [
        {
          source: 'OVERRIDE',
          validFrom: null,
          validUntil: new Date('2026-09-30T00:00:00.000Z'),
          permission: { name: PERMISSIONS.ACTIVITY_UPDATE },
        },
      ],
    }),
  );
  const { grantPermission } = await loadService(prisma);

  const result = await grantPermission(
    buildUser({ globalRole: 'ADMIN' }),
    { eventProgramId: 'p1' },
    'user-002',
    PERMISSIONS.ACTIVITY_UPDATE,
    { validUntil: new Date('2026-09-30T00:00:00.000Z') },
    NOW,
  );

  expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({
    userId: 'user-002',
    permissions: [
      {
        name: PERMISSIONS.ACTIVITY_UPDATE,
        source: 'OVERRIDE',
        validUntil: '2026-09-30T00:00:00.000Z',
      },
    ],
  });
});
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/authorization/delegation.service.test.ts`
Expected: FAIL por las guardas nuevas y los mocks faltantes.

- [x] **Step 3: Implementar**

Reescribir `grantPermission` manteniendo las validaciones actuales y agregando `loadScopeProgram`, la guarda de archivado, la transaccion y el retorno del DTO:

```ts
export const grantPermission = async (
  actor: Express.AuthenticatedUser,
  scope: AuthorizationScope,
  targetUserId: string,
  permission: PermissionName,
  window: GrantWindowInput = {},
  now: Date = new Date(),
): Promise<CollaboratorDetail> => {
  const envelopes = await assertActorCanDelegate(actor, scope, now);
  const validFrom = window.validFrom ?? null;
  const validUntil = window.validUntil ?? null;

  assertWindowValid(validFrom, validUntil);
  assertWindowWithinEnvelope(envelopes.get(permission), validFrom, validUntil);

  const resolved = await resolveScope(scope);
  const program = await loadScopeProgram(resolved);

  if (program.status === 'ARCHIVED') {
    throw new ApiError(409, 'Archived event programs cannot be modified.');
  }

  const prisma = getPrismaClient();

  const collaboration = await prisma.collaboration.findFirst({
    where: { userId: targetUserId, ...scopeWhere(resolved) },
    select: { id: true },
  });

  if (!collaboration) {
    throw new ApiError(404, 'Collaborator not found.');
  }

  const permissionId = await loadPermissionId(permission);

  return prisma.$transaction(async (tx) => {
    await tx.collaborationPermission.upsert({
      where: {
        collaborationId_permissionId: {
          collaborationId: collaboration.id,
          permissionId,
        },
      },
      update: {
        source: 'OVERRIDE',
        validFrom,
        validUntil,
        grantedById: actor.id,
        grantedAt: now,
      },
      create: {
        collaborationId: collaboration.id,
        permissionId,
        source: 'OVERRIDE',
        validFrom,
        validUntil,
        grantedById: actor.id,
        grantedAt: now,
      },
    });

    const updated = await tx.collaboration.findUniqueOrThrow({
      where: { id: collaboration.id },
      select: collaboratorSelect,
    });

    return toCollaboratorDetail(updated);
  });
};
```

- [x] **Step 4: Verificar el verde**

Run: `pnpm exec vitest run src/modules/authorization/delegation.service.test.ts`
Expected: PASS.

---

### Task 2: Esquemas (TDD)

**Files:**

- Modify: `src/modules/authorization/authorization.schemas.ts`
- Test: `src/modules/authorization/authorization.schemas.test.ts`

- [x] **Step 1: Pruebas que fallan**

```ts
describe('grant permission schema', () => {
  const body = {
    userId: 'user-002',
    permission: 'report:export',
    validFrom: '2026-09-20T00:00:00.000Z',
    validUntil: '2026-10-20T00:00:00.000Z',
  };

  it('trims the scope identifier and parses the windows into dates', () => {
    const parsed = grantPermissionSchema.parse({ params: { id: '  program-001  ' }, body });

    expect(parsed.params.id).toBe('program-001');
    expect(parsed.body.validFrom).toEqual(new Date('2026-09-20T00:00:00.000Z'));
    expect(parsed.body.validUntil).toEqual(new Date('2026-10-20T00:00:00.000Z'));
  });

  it('accepts an offset datetime and explicit null windows', () => {
    const parsed = grantPermissionSchema.parse({
      params: { id: 'p1' },
      body: {
        userId: 'user-002',
        permission: 'activity:read',
        validFrom: '2026-09-20T00:00:00-05:00',
        validUntil: null,
      },
    });

    expect(parsed.body.validFrom).toEqual(new Date('2026-09-20T05:00:00.000Z'));
    expect(parsed.body.validUntil).toBeNull();
  });

  it('rejects an unknown permission', () => {
    expect(() =>
      grantPermissionSchema.parse({
        params: { id: 'p1' },
        body: { ...body, permission: 'nope:nope' },
      }),
    ).toThrow();
  });

  it('rejects a malformed window', () => {
    expect(() =>
      grantPermissionSchema.parse({
        params: { id: 'p1' },
        body: { ...body, validUntil: 'tomorrow' },
      }),
    ).toThrow();
  });

  it('rejects unknown body keys', () => {
    expect(() =>
      grantPermissionSchema.parse({
        params: { id: 'p1' },
        body: { ...body, grantedById: 'admin-001' },
      }),
    ).toThrow();
  });

  it('rejects a blank user identifier', () => {
    expect(() =>
      grantPermissionSchema.parse({ params: { id: 'p1' }, body: { ...body, userId: '   ' } }),
    ).toThrow();
  });
});
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/authorization/authorization.schemas.test.ts`
Expected: FAIL porque `grantPermissionSchema` no existe.

- [x] **Step 3: Implementar**

Agregar el import de `PERMISSION_NAMES` y el esquema:

```ts
import { PERMISSION_NAMES } from './permissions.js';

const grantWindowSchema = z.iso
  .datetime({ offset: true, error: 'Grant window must be an ISO 8601 datetime.' })
  .transform((value) => new Date(value));

export const grantPermissionSchema = z.object({
  params: z.object({ id: scopeIdSchema }),
  body: z
    .object({
      userId: userIdSchema,
      permission: z.enum(PERMISSION_NAMES, 'Permission is invalid.'),
      validFrom: grantWindowSchema.nullable().optional(),
      validUntil: grantWindowSchema.nullable().optional(),
    })
    .strict(),
});

export type GrantPermissionBody = z.infer<typeof grantPermissionSchema>['body'];
```

- [x] **Step 4: Verificar el verde**

Run: `pnpm exec vitest run src/modules/authorization/authorization.schemas.test.ts`
Expected: PASS.

---

### Task 3: Controlador, rutas y montaje (TDD)

**Files:**

- Modify: `src/modules/authorization/authorization.controller.ts`
- Modify: `src/modules/authorization/authorization.routes.ts`
- Test: `src/modules/authorization/authorization.routes.test.ts`

- [x] **Step 1: Pruebas que fallan**

Agregar `grantPermission: vi.fn()` al `DelegationServiceMock` y a `buildServiceMock`. Agregar las pruebas:

```ts
const grantBody = {
  userId: 'user-002',
  permission: 'report:export',
  validFrom: '2026-09-20T00:00:00.000Z',
  validUntil: '2026-10-20T00:00:00.000Z',
};

it('rejects granting a permission without a token', async () => {
  const service = buildServiceMock();
  const app = await loadApp(service);

  await request(app)
    .post('/api/v1/event-programs/program-001/permissions')
    .send(grantBody)
    .expect(401);
  expect(service.grantPermission).not.toHaveBeenCalled();
});

it('rejects granting a permission without permission:grant in the scope', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(userRecord);
  const app = await loadApp(service, prisma, ['activity:read']);

  await request(app)
    .post('/api/v1/event-programs/program-001/permissions')
    .set('Authorization', 'Bearer user-001')
    .send(grantBody)
    .expect(403);
  expect(service.grantPermission).not.toHaveBeenCalled();
});

it('grants a permission in an event program for a permission:grant holder', async () => {
  const service = buildServiceMock();
  service.grantPermission.mockResolvedValue(collaboratorDetail);
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(userRecord);
  const getEffectivePermissions = vi.fn();
  const app = await loadApp(service, prisma, ['permission:grant'], getEffectivePermissions);

  const response = await request(app)
    .post('/api/v1/event-programs/program-001/permissions')
    .set('Authorization', 'Bearer user-001')
    .send(grantBody)
    .expect(200);

  expect(getEffectivePermissions).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'user-001' }),
    { eventProgramId: 'program-001' },
  );
  expect(service.grantPermission).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'user-001' }),
    { eventProgramId: 'program-001' },
    'user-002',
    'report:export',
    {
      validFrom: new Date('2026-09-20T00:00:00.000Z'),
      validUntil: new Date('2026-10-20T00:00:00.000Z'),
    },
  );
  expect(response.body).toEqual({
    success: true,
    message: 'Permission granted successfully.',
    data: collaboratorDetail,
  });
});

it('resolves the activity scope and defaults omitted windows to null', async () => {
  const service = buildServiceMock();
  service.grantPermission.mockResolvedValue(collaboratorDetail);
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminRecord);
  const app = await loadApp(service, prisma);

  await request(app)
    .post('/api/v1/activities/activity-001/permissions')
    .set('Authorization', 'Bearer admin-001')
    .send({ userId: 'user-002', permission: 'activity:update' })
    .expect(200);

  expect(service.grantPermission).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'admin-001' }),
    { activityId: 'activity-001' },
    'user-002',
    'activity:update',
    { validFrom: null, validUntil: null },
  );
});

it('rejects an unknown permission before the service', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminRecord);
  const app = await loadApp(service, prisma);

  await request(app)
    .post('/api/v1/event-programs/program-001/permissions')
    .set('Authorization', 'Bearer admin-001')
    .send({ ...grantBody, permission: 'nope:nope' })
    .expect(400);
  expect(service.grantPermission).not.toHaveBeenCalled();
});

it('rejects a malformed window before the service', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminRecord);
  const app = await loadApp(service, prisma);

  await request(app)
    .post('/api/v1/event-programs/program-001/permissions')
    .set('Authorization', 'Bearer admin-001')
    .send({ ...grantBody, validUntil: 'tomorrow' })
    .expect(400);
  expect(service.grantPermission).not.toHaveBeenCalled();
});

it('propagates an archived event program as 409', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminRecord);
  const app = await loadApp(service, prisma);
  const { ApiError } = await import('../../utils/ApiError.js');
  service.grantPermission.mockRejectedValue(
    new ApiError(409, 'Archived event programs cannot be modified.'),
  );

  await request(app)
    .post('/api/v1/event-programs/program-001/permissions')
    .set('Authorization', 'Bearer admin-001')
    .send(grantBody)
    .expect(409);
});

it('propagates a missing collaborator as 404', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminRecord);
  const app = await loadApp(service, prisma);
  const { ApiError } = await import('../../utils/ApiError.js');
  service.grantPermission.mockRejectedValue(new ApiError(404, 'Collaborator not found.'));

  await request(app)
    .post('/api/v1/activities/activity-001/permissions')
    .set('Authorization', 'Bearer admin-001')
    .send(grantBody)
    .expect(404);
});
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/authorization/authorization.routes.test.ts`
Expected: FAIL con 404 en las rutas nuevas.

- [x] **Step 3: Implementar controlador y rutas**

Controlador:

```ts
export const grantEventProgramPermission: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const body = req.body as GrantPermissionBody;
  const user = requireAuthenticatedUser(req);
  const result = await grantPermissionService(
    user,
    { eventProgramId: id },
    body.userId,
    body.permission,
    { validFrom: body.validFrom ?? null, validUntil: body.validUntil ?? null },
  );

  res.status(200).json(successResponse('Permission granted successfully.', result));
});

export const grantActivityPermission: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const body = req.body as GrantPermissionBody;
  const user = requireAuthenticatedUser(req);
  const result = await grantPermissionService(
    user,
    { activityId: id },
    body.userId,
    body.permission,
    { validFrom: body.validFrom ?? null, validUntil: body.validUntil ?? null },
  );

  res.status(200).json(successResponse('Permission granted successfully.', result));
});
```

Rutas:

```ts
authorizationRoutes.post(
  '/event-programs/:id/permissions',
  authenticate,
  requirePermission(PERMISSIONS.PERMISSION_GRANT, eventProgramScope),
  validate(grantPermissionSchema),
  grantEventProgramPermission,
);

authorizationRoutes.post(
  '/activities/:id/permissions',
  authenticate,
  requirePermission(PERMISSIONS.PERMISSION_GRANT, activityScope),
  validate(grantPermissionSchema),
  grantActivityPermission,
);
```

- [x] **Step 4: Verificar el verde**

Run: `pnpm exec vitest run src/modules/authorization/authorization.routes.test.ts`
Expected: PASS.

- [x] **Step 5: Suite dirigida**

Run: `pnpm exec vitest run src/modules/authorization src/modules/event-programs src/modules/activities`
Expected: PASS sin regresiones.

---

### Task 4: OpenAPI (TDD)

**Files:**

- Modify: `src/modules/authorization/authorization.openapi.ts`
- Modify: `src/docs/openapi.test.ts`
- Generate: `openapi.json`

- [x] **Step 1: Prueba de contrato que falla**

Agregar a `expectedOperations` (la lista aplica `.sort()` al final):

```ts
'POST /api/v1/activities/{id}/permissions',
'POST /api/v1/event-programs/{id}/permissions',
```

Y la prueba:

```ts
it('documents permission grants with bearer security and the collaborator contract', () => {
  const programPost = openApiDocument.paths?.['/api/v1/event-programs/{id}/permissions']?.post;
  const activityPost = openApiDocument.paths?.['/api/v1/activities/{id}/permissions']?.post;
  const parameters = programPost?.parameters ?? [];
  const names = parameters.map((parameter) => ('name' in parameter ? parameter.name : undefined));

  expect(programPost?.security).toEqual([{ bearerAuth: [] }]);
  expect(programPost?.responses?.['200']).toBeDefined();
  expect(programPost?.responses?.['403']).toBeDefined();
  expect(programPost?.responses?.['409']).toBeDefined();
  expect(names).toContain('id');
  expect(activityPost?.security).toEqual([{ bearerAuth: [] }]);
  expect(activityPost?.responses?.['200']).toBeDefined();
  expect(openApiDocument.components?.schemas).toHaveProperty('Collaborator');
});
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/docs/openapi.test.ts`
Expected: FAIL: operaciones POST no documentadas.

- [x] **Step 3: Implementar las rutas OpenAPI**

Agregar `grantResponses`, `grantDescription` y los dos paths `post` (tag `Collaborators`), reutilizando `collaboratorSchema` en la respuesta `200` y `grantPermissionSchema.shape.params`/`.shape.body`.

- [x] **Step 4: Verificar el verde y regenerar el contrato**

Run: `pnpm exec vitest run src/docs/openapi.test.ts && pnpm run docs:generate && pnpm run docs:check`
Expected: PASS y `openapi.json` sin drift.

---

### Task 5: Bruno y verificacion E2E

**Files:**

- Create: `bruno/Collaborators/Add a collaborator to grant permissions.bru` (seq 33)
- Create: `bruno/Collaborators/Grant a permission.bru` (seq 34)
- Create: `bruno/Collaborators/Grant the same permission with a new window.bru` (seq 35)
- Create: `bruno/Collaborators/Grant an unknown permission returns 400.bru` (seq 36)
- Create: `bruno/Collaborators/Grant a permission to an unknown collaborator returns 404.bru` (seq 37)
- Create: `bruno/Collaborators/Grant a permission on an archived program returns 409.bru` (seq 38)
- Create: `bruno/Collaborators/Grant a permission without a token returns 401.bru` (seq 39)
- Create: `bruno/Collaborators/Log in as FISC head to grant.bru` (seq 40)
- Create: `bruno/Collaborators/Grant a permission within the delegator window.bru` (seq 41)
- Create: `bruno/Collaborators/Grant an unbounded permission as a bounded delegator returns 403.bru` (seq 42)
- Create: `bruno/Collaborators/Grant a permission beyond the delegator window returns 403.bru` (seq 43)
- Create: `bruno/Collaborators/Log in as admin to clean up grants.bru` (seq 44)
- Create: `bruno/Collaborators/Delete the grant collaborator.bru` (seq 45)

- [x] **Step 1: Crear los requests**

Patron de los existentes (bearer `{{token}}`, carpeta `Collaborators`). Los requests 34/35 usan `script:pre-request` para fijar `grantFrom`/`grantUntil`; 41/42/43 usan el mismo patron con `headGrantFrom`/`headGrantUntil`. En 41-43 el permiso es `permission:grant` (envelope acotado del head).

- [x] **Step 2: Correr Bruno**

Run: `pnpm exec bru run Collaborators --env local`
Expected: 45 requests y 47 tests en verde. Si se agota el rate limit de login, esperar 60 s.

- [x] **Step 3: Verificacion real E2E (Docker + psql)**

1. Login admin; crear usuario temporal T; agregarlo como VIEWER a `seed_program_congreso-cit`.
2. Admin `POST /event-programs/seed_program_congreso-cit/permissions` con `report:export` y ventana → 200; psql confirma `source='OVERRIDE'`, `granted_by_id=admin` y la ventana.
3. Re-grant con otra ventana → 200 y la misma fila actualizada (sin duplicados).
4. Permiso invalido 400; colaborador desconocido 404; programa archivado 409; sin token 401.
5. Head otorga `permission:grant` dentro de su envelope → 200 con `granted_by_id=seed_user_org-fisc`; sin ventana → 403; con `validUntil` fuera del envelope → 403; head sin grant en su programa default → 403.
6. Limpieza total y conteos restaurados.

- [x] **Step 4: Confirmar conteos restaurados**

Run: psql contra el contenedor para verificar `collaborations`/`collaboration_permissions` sin filas temporales.

---

### Task 6: Documentacion, plan maestro y gates

**Files:**

- Modify: `CONTEXT.md`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [x] **Step 1: `CONTEXT.md`**

Documentar el POST en la seccion `### Colaboradores Por Scope`.

- [x] **Step 2: `README.md`**

Documentar el endpoint con `200 + Collaborator`, subconjunto, atenuacion, upsert y 404/409.

- [x] **Step 3: Plan maestro**

Marcar 3.5 `[x]`, actualizar la tabla de estado y la lista de endpoints, y agregar `**Registro de ejecucion (2026-09-20 - 3.5):**` con el hallazgo `F3.5-A`.

- [x] **Step 4: Gates finales**

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm run build
pnpm run docs:generate && pnpm run docs:check
```

Expected: todo en verde y `openapi.json` sin drift. Si algunos archivos ajenos expiran por carga concurrente, repetir con `pnpm exec vitest run --testTimeout=20000`.

- [x] **Step 5: Cierre**

Sin commit salvo solicitud explicita.
