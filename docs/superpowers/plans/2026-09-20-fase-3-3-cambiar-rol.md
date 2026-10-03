# Fase 3.3 - Cambiar rol de colaborador Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Exponer `PATCH /event-programs/:id/collaborators/:userId` y `PATCH /activities/:id/collaborators/:userId` que cambia el rol de una colaboracion local, reemplaza los `ROLE_DEFAULT` y preserva los `OVERRIDE`, con subconjunto simetrico bidireccional y rechazo de programas archivados.

**Architecture:** Se extiende `src/modules/authorization/` sobre los servicios de delegacion existentes (fase 3.1/3.2). Las rutas siguen `authenticate -> requirePermission(permission:grant, resolver) -> validate -> controlador -> servicio`; el servicio devuelve `CollaboratorDetail` y relee el colaborador dentro de la transaccion. Sin migraciones, variables de entorno ni permisos nuevos.

**Tech Stack:** TypeScript 6, Express 5, Prisma 7 (SQL/Postgres), Zod 4, Vitest, Supertest, OpenAPI 3.1 (zod-openapi), Bruno.

**Hallazgos de partida (2026-09-20):**

- `delegation.service.ts` implementa `updateCollaboratorRole` desde antes de 3.1, pero devuelve `void`, no valida programa inexistente/archivado y no revisa los `ROLE_DEFAULT` que elimina; un actor con `permission:grant` podia degradar a un `ORGANIZER` y borrar defaults que no poseia (bypass del invariante de ADR-0001).
- `delegation.service.test.ts` ya prueba el reemplazo/preservacion con un mock sin nombres de permiso; el mock debe crecer con `eventProgram.findUnique`, `collaboration.findUniqueOrThrow` y permisos con `permission.name`.
- Bruno `Collaborators` tiene seq 1-15 y desde seq 12 el token compartido es del head; los requests nuevos re-loguean admin antes de continuar.

**Decisiones confirmadas (2026-09-20):**

1. `PATCH` responde `200` con `CollaboratorDetail` (consistente con `POST` de 3.2) y mensaje `Collaborator role updated successfully.`
2. Guarda simetrica: si algun `ROLE_DEFAULT` actual del objetivo queda fuera de los envelopes del actor, `403 Cannot remove a collaborator with permissions you do not hold.` (alineado con `removeCollaborator` y ADR-0001).
3. `PATCH` a programa `ARCHIVED` responde `409 Archived event programs cannot be modified.`; programa inexistente `404 Event program not found.`; colaborador inexistente `404 Collaborator not found.`
4. Cambiar al mismo rol es un no-op valido: refresca la materializacion `ROLE_DEFAULT`.
5. La atenuacion temporal de los `ROLE_DEFAULT` no se aborda en esta fase (`F3.3-A` diferido; los grants explicitos con ventana llegan en 3.5).

**Reglas de negocio:**

- `permission:grant` en el scope o rol `ADMIN` (bypass total) son obligatorios.
- El actor no puede asignar un rol cuyos defaults no posea ni eliminar `ROLE_DEFAULT` que no posea.
- Los `OVERRIDE` quedan intactos, incluida su ventana; no se exponen `grantedById`/`grantedAt` en el DTO.
- El catalogo de permisos fuera de `PERMISSION_NAMES` se descarta del DTO (mismo criterio que el resolutor).

---

### Task 1: Servicio `updateCollaboratorRole` (TDD)

**Files:**

- Modify: `src/modules/authorization/delegation.service.ts`
- Test: `src/modules/authorization/delegation.service.test.ts`

- [x] **Step 1: Actualizar el mock y escribir las pruebas que fallan**

En `PrismaMock`, agregar `findUniqueOrThrow: ReturnType<typeof vi.fn>;` dentro de `collaboration` y `findUniqueOrThrow: vi.fn(),` en `createPrismaMock()`.

Reemplazar la prueba `replaces ROLE_DEFAULT rows and preserves OVERRIDE rows on role change` por la version con guardas y DTO:

```ts
it('replaces ROLE_DEFAULT rows and preserves OVERRIDE rows on role change', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
  prisma.collaboration.findFirst.mockResolvedValue({
    id: 'collab-001',
    permissions: [{ permission: { name: PERMISSIONS.ACTIVITY_READ } }],
  });
  prisma.permission.findMany.mockResolvedValue(permissionRecords(ROLE_DEFAULTS.EDITOR));
  prisma.collaboration.update.mockResolvedValue({});
  prisma.collaborationPermission.deleteMany.mockResolvedValue({ count: 1 });
  prisma.collaborationPermission.createMany.mockResolvedValue({ count: 11 });
  prisma.collaboration.findUniqueOrThrow.mockResolvedValue(collaboratorRecord({ role: 'EDITOR' }));
  const { updateCollaboratorRole } = await loadService(prisma);

  const result = await updateCollaboratorRole(
    buildUser({ globalRole: 'ADMIN' }),
    { eventProgramId: 'p1' },
    'user-002',
    'EDITOR',
    NOW,
  );

  expect(prisma.collaborationPermission.deleteMany).toHaveBeenCalledWith({
    where: { collaborationId: 'collab-001', source: 'ROLE_DEFAULT' },
  });
  const createArgs = prisma.collaborationPermission.createMany.mock.calls[0]?.[0] as {
    data: { source: string; grantedById: string; collaborationId: string }[];
  };
  expect(createArgs.data).toHaveLength(ROLE_DEFAULTS.EDITOR.length);
  for (const row of createArgs.data) {
    expect(row).toMatchObject({
      source: 'ROLE_DEFAULT',
      grantedById: 'actor-001',
      collaborationId: 'collab-001',
    });
  }
  expect(prisma.collaboration.update).toHaveBeenCalledWith({
    where: { id: 'collab-001' },
    data: { role: 'EDITOR' },
  });
  expect(prisma.collaboration.delete).not.toHaveBeenCalled();
  expect(result).toEqual({
    userId: 'user-002',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    role: 'EDITOR',
    createdAt: '2026-09-19T12:00:00.000Z',
    permissions: [
      {
        name: PERMISSIONS.ACTIVITY_READ,
        source: 'ROLE_DEFAULT',
        validFrom: null,
        validUntil: null,
      },
    ],
  });
});
```

Agregar al final del `describe`:

```ts
it('returns 404 when updating the role in a missing event program', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue(null);
  const { updateCollaboratorRole } = await loadService(prisma);

  await expect(
    updateCollaboratorRole(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'missing' },
      'user-002',
      'VIEWER',
      NOW,
    ),
  ).rejects.toMatchObject({ statusCode: 404 });
  expect(prisma.collaboration.update).not.toHaveBeenCalled();
});

it('rejects role changes on archived event programs', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ARCHIVED' });
  const { updateCollaboratorRole } = await loadService(prisma);

  await expect(
    updateCollaboratorRole(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
      'VIEWER',
      NOW,
    ),
  ).rejects.toMatchObject({
    statusCode: 409,
    message: 'Archived event programs cannot be modified.',
  });
  expect(prisma.collaboration.update).not.toHaveBeenCalled();
});

it('returns 404 when the role change targets a missing collaborator', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
  prisma.collaboration.findFirst.mockResolvedValue(null);
  const { updateCollaboratorRole } = await loadService(prisma);

  await expect(
    updateCollaboratorRole(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
      'VIEWER',
      NOW,
    ),
  ).rejects.toMatchObject({ statusCode: 404, message: 'Collaborator not found.' });
});

it('rejects a role change that strips ROLE_DEFAULT grants the actor does not hold', async () => {
  const prisma = createPrismaMock();
  prisma.collaboration.findMany.mockResolvedValue([
    collaboration(
      grant(PERMISSIONS.PERMISSION_GRANT),
      ...ROLE_DEFAULTS.VIEWER.map((name) => grant(name)),
    ),
  ]);
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
  prisma.collaboration.findFirst.mockResolvedValue({
    id: 'collab-001',
    permissions: [{ permission: { name: PERMISSIONS.ACTIVITY_UPDATE } }],
  });
  const { updateCollaboratorRole } = await loadService(prisma);

  await expect(
    updateCollaboratorRole(buildUser(), { eventProgramId: 'p1' }, 'user-002', 'VIEWER', NOW),
  ).rejects.toMatchObject({
    statusCode: 403,
    message: 'Cannot remove a collaborator with permissions you do not hold.',
  });
  expect(prisma.collaboration.update).not.toHaveBeenCalled();
});

it('rejects assigning a role that exceeds the actor permissions on role change', async () => {
  const prisma = createPrismaMock();
  prisma.collaboration.findMany.mockResolvedValue([
    collaboration(grant(PERMISSIONS.PERMISSION_GRANT)),
  ]);
  const { updateCollaboratorRole } = await loadService(prisma);

  await expect(
    updateCollaboratorRole(buildUser(), { eventProgramId: 'p1' }, 'user-002', 'EDITOR', NOW),
  ).rejects.toMatchObject({
    statusCode: 403,
    message: 'Cannot assign a role that exceeds your own permissions.',
  });
  expect(prisma.eventProgram.findUnique).not.toHaveBeenCalled();
});
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/authorization/delegation.service.test.ts`
Expected: FAIL por firma, guardas y DTO ausentes.

- [x] **Step 3: Implementar**

Reemplazar `updateCollaboratorRole` por:

```ts
export const updateCollaboratorRole = async (
  actor: Express.AuthenticatedUser,
  scope: AuthorizationScope,
  targetUserId: string,
  role: CollaborationRole,
  now: Date = new Date(),
): Promise<CollaboratorDetail> => {
  const envelopes = await assertActorCanDelegate(actor, scope, now);
  assertRoleWithinEnvelopes(role, envelopes);

  const resolved = await resolveScope(scope);
  const program = await loadScopeProgram(resolved);

  if (program.status === 'ARCHIVED') {
    throw new ApiError(409, 'Archived event programs cannot be modified.');
  }

  const prisma = getPrismaClient();

  const collaboration = await prisma.collaboration.findFirst({
    where: { userId: targetUserId, ...scopeWhere(resolved) },
    select: {
      id: true,
      permissions: {
        where: { source: 'ROLE_DEFAULT' },
        select: { permission: { select: { name: true } } },
      },
    },
  });

  if (!collaboration) {
    throw new ApiError(404, 'Collaborator not found.');
  }

  for (const row of collaboration.permissions) {
    if (!envelopes.has(row.permission.name as PermissionName)) {
      throw new ApiError(403, 'Cannot remove a collaborator with permissions you do not hold.');
    }
  }

  const permissionIds = await loadPermissionIds(ROLE_DEFAULTS[role]);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.collaboration.update({
      where: { id: collaboration.id },
      data: { role },
    });

    await tx.collaborationPermission.deleteMany({
      where: { collaborationId: collaboration.id, source: 'ROLE_DEFAULT' },
    });

    await tx.collaborationPermission.createMany({
      data: ROLE_DEFAULTS[role].map((name) => ({
        collaborationId: collaboration.id,
        permissionId: permissionIds.get(name) as string,
        source: 'ROLE_DEFAULT',
        grantedById: actor.id,
      })),
    });

    return tx.collaboration.findUniqueOrThrow({
      where: { id: collaboration.id },
      select: collaboratorSelect,
    });
  });

  return toCollaboratorDetail(updated);
};
```

- [x] **Step 4: Verificar el verde**

Run: `pnpm exec vitest run src/modules/authorization/delegation.service.test.ts`
Expected: PASS.

---

### Task 2: Esquemas Zod (TDD)

**Files:**

- Modify: `src/modules/authorization/authorization.schemas.ts`
- Test: `src/modules/authorization/authorization.schemas.test.ts`

- [x] **Step 1: Pruebas que fallan**

```ts
it('trims the scope and user identifiers on role update', () => {
  const parsed = updateCollaboratorRoleSchema.parse({
    params: { id: '  program-001  ', userId: '  user-002  ' },
    body: { role: 'EDITOR' },
  });

  expect(parsed.params).toEqual({ id: 'program-001', userId: 'user-002' });
  expect(parsed.body).toEqual({ role: 'EDITOR' });
});

it('rejects a blank user identifier on role update', () => {
  expect(() =>
    updateCollaboratorRoleSchema.parse({
      params: { id: 'p1', userId: '   ' },
      body: { role: 'EDITOR' },
    }),
  ).toThrow();
});

it('rejects a user identifier longer than 100 characters on role update', () => {
  expect(() =>
    updateCollaboratorRoleSchema.parse({
      params: { id: 'p1', userId: 'a'.repeat(101) },
      body: { role: 'EDITOR' },
    }),
  ).toThrow();
});

it('rejects an unknown role on role update', () => {
  expect(() =>
    updateCollaboratorRoleSchema.parse({
      params: { id: 'p1', userId: 'user-002' },
      body: { role: 'OWNER' },
    }),
  ).toThrow();
});

it('rejects unknown body keys on role update', () => {
  expect(() =>
    updateCollaboratorRoleSchema.parse({
      params: { id: 'p1', userId: 'user-002' },
      body: { role: 'EDITOR', validUntil: '2026-12-31T00:00:00.000Z' },
    }),
  ).toThrow();
});
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/authorization/authorization.schemas.test.ts`
Expected: FAIL porque `updateCollaboratorRoleSchema` no existe.

- [x] **Step 3: Implementar**

Extraer `userIdSchema` y reutilizarlo en `addCollaboratorSchema`; agregar:

```ts
export const updateCollaboratorRoleSchema = z.object({
  params: z.object({ id: scopeIdSchema, userId: userIdSchema }),
  body: z
    .object({
      role: z.enum(['VIEWER', 'EDITOR', 'ORGANIZER'], 'Role is invalid.'),
    })
    .strict(),
});

export type UpdateCollaboratorRoleBody = z.infer<typeof updateCollaboratorRoleSchema>['body'];
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

Agregar `updateCollaboratorRole: vi.fn()` a `buildServiceMock()` y estas pruebas:

```ts
const updateBody = { role: 'EDITOR' };
const updatedCollaborator = { ...collaboratorDetail, role: 'EDITOR' };

it('updates a program collaborator role for a permission:grant holder', async () => {
  const service = buildServiceMock();
  service.updateCollaboratorRole.mockResolvedValue(updatedCollaborator);
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(userRecord);
  const getEffectivePermissions = vi.fn();
  const app = await loadApp(service, prisma, ['permission:grant'], getEffectivePermissions);

  const response = await request(app)
    .patch('/api/v1/event-programs/program-001/collaborators/user-002')
    .set('Authorization', 'Bearer user-001')
    .send(updateBody)
    .expect(200);

  expect(getEffectivePermissions).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'user-001' }),
    {
      eventProgramId: 'program-001',
    },
  );
  expect(service.updateCollaboratorRole).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'user-001' }),
    { eventProgramId: 'program-001' },
    'user-002',
    'EDITOR',
  );
  expect(response.body).toEqual({
    success: true,
    message: 'Collaborator role updated successfully.',
    data: updatedCollaborator,
  });
});

it('resolves the activity scope when updating an activity collaborator role', async () => {
  const service = buildServiceMock();
  service.updateCollaboratorRole.mockResolvedValue(updatedCollaborator);
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminRecord);
  const app = await loadApp(service, prisma);

  await request(app)
    .patch('/api/v1/activities/activity-001/collaborators/user-002')
    .set('Authorization', 'Bearer admin-001')
    .send(updateBody)
    .expect(200);

  expect(service.updateCollaboratorRole).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'admin-001' }),
    { activityId: 'activity-001' },
    'user-002',
    'EDITOR',
  );
});

it('rejects updating a role without a token', async () => {
  const service = buildServiceMock();
  const app = await loadApp(service);

  await request(app)
    .patch('/api/v1/event-programs/program-001/collaborators/user-002')
    .send(updateBody)
    .expect(401);
  expect(service.updateCollaboratorRole).not.toHaveBeenCalled();
});

it('rejects updating a role without permission:grant', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(userRecord);
  const app = await loadApp(service, prisma, ['activity:read']);

  await request(app)
    .patch('/api/v1/event-programs/program-001/collaborators/user-002')
    .set('Authorization', 'Bearer user-001')
    .send(updateBody)
    .expect(403);
  expect(service.updateCollaboratorRole).not.toHaveBeenCalled();
});

it('rejects an invalid role before the service on update', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminRecord);
  const app = await loadApp(service, prisma);

  await request(app)
    .patch('/api/v1/event-programs/program-001/collaborators/user-002')
    .set('Authorization', 'Bearer admin-001')
    .send({ role: 'OWNER' })
    .expect(400);
  expect(service.updateCollaboratorRole).not.toHaveBeenCalled();
});

it('rejects unknown body keys before the service on update', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminRecord);
  const app = await loadApp(service, prisma);

  await request(app)
    .patch('/api/v1/event-programs/program-001/collaborators/user-002')
    .set('Authorization', 'Bearer admin-001')
    .send({ ...updateBody, source: 'OVERRIDE' })
    .expect(400);
  expect(service.updateCollaboratorRole).not.toHaveBeenCalled();
});

it('propagates a missing collaborator as 404 on update', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminRecord);
  const app = await loadApp(service, prisma);
  const { ApiError } = await import('../../utils/ApiError.js');
  service.updateCollaboratorRole.mockRejectedValue(new ApiError(404, 'Collaborator not found.'));

  await request(app)
    .patch('/api/v1/event-programs/program-001/collaborators/user-002')
    .set('Authorization', 'Bearer admin-001')
    .send(updateBody)
    .expect(404);
});

it('propagates an archived program as 409 on update', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminRecord);
  const app = await loadApp(service, prisma);
  const { ApiError } = await import('../../utils/ApiError.js');
  service.updateCollaboratorRole.mockRejectedValue(
    new ApiError(409, 'Archived event programs cannot be modified.'),
  );

  await request(app)
    .patch('/api/v1/event-programs/program-001/collaborators/user-002')
    .set('Authorization', 'Bearer admin-001')
    .send(updateBody)
    .expect(409);
});

it('propagates the role subset rejection as 403 on update', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(userRecord);
  const app = await loadApp(service, prisma, ['permission:grant']);
  const { ApiError } = await import('../../utils/ApiError.js');
  service.updateCollaboratorRole.mockRejectedValue(
    new ApiError(403, 'Cannot remove a collaborator with permissions you do not hold.'),
  );

  await request(app)
    .patch('/api/v1/activities/activity-001/collaborators/user-002')
    .set('Authorization', 'Bearer user-001')
    .send({ role: 'VIEWER' })
    .expect(403);
});
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/authorization/authorization.routes.test.ts`
Expected: FAIL con 404 en las rutas nuevas.

- [x] **Step 3: Implementar controlador y rutas**

Controlador (análogo para actividad):

```ts
export const updateEventProgramCollaboratorRole: RequestHandler = asyncHandler(async (req, res) => {
  const { id, userId } = req.params as { id: string; userId: string };
  const body = req.body as UpdateCollaboratorRoleBody;
  const user = requireAuthenticatedUser(req);
  const result = await updateCollaboratorRoleService(
    user,
    { eventProgramId: id },
    userId,
    body.role,
  );

  res.status(200).json(successResponse('Collaborator role updated successfully.', result));
});
```

Rutas (análogo para actividades):

```ts
authorizationRoutes.patch(
  '/event-programs/:id/collaborators/:userId',
  authenticate,
  requirePermission(PERMISSIONS.PERMISSION_GRANT, eventProgramScope),
  validate(updateCollaboratorRoleSchema),
  updateEventProgramCollaboratorRole,
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

Agregar a `expectedOperations`:

```ts
'PATCH /api/v1/activities/{id}/collaborators/{userId}',
'PATCH /api/v1/event-programs/{id}/collaborators/{userId}',
```

Y extender el test de colaboradores:

```ts
const programPatch =
  openApiDocument.paths?.['/api/v1/event-programs/{id}/collaborators/{userId}']?.patch;
const patchParameters = programPatch?.parameters ?? [];
const patchNames = patchParameters.map((parameter) =>
  'name' in parameter ? parameter.name : undefined,
);

expect(programPatch?.security).toEqual([{ bearerAuth: [] }]);
expect(programPatch?.responses?.['200']).toBeDefined();
expect(programPatch?.responses?.['409']).toBeDefined();
expect(patchNames).toContain('id');
expect(patchNames).toContain('userId');
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/docs/openapi.test.ts`
Expected: FAIL: operaciones PATCH no documentadas.

- [x] **Step 3: Implementar las rutas OpenAPI**

En `authorization.openapi.ts`, agregar `patch` a ambos paths con:

```ts
const updateDescription =
  'Changes the role of a local collaborator. Replaces its ROLE_DEFAULT grants with the defaults of the new role and preserves OVERRIDE grants. Requires `permission:grant` in the scope or the ADMIN role; the actor cannot assign a role whose defaults exceed its own permissions nor strip ROLE_DEFAULT grants it does not hold. Archived event programs cannot be modified.';

const updateResponses = {
  200: {
    description: 'Collaborator role replaced with its ROLE_DEFAULT grants regenerated.',
    content: { 'application/json': { schema: apiSuccessResponse(collaboratorSchema) } },
  },
  400: errorResponse,
  401: errorResponse,
  403: errorResponse,
  404: errorResponse,
  409: errorResponse,
} as const;
```

`requestParams: { path: updateCollaboratorRoleSchema.shape.params }`, `requestBody` con `updateCollaboratorRoleSchema.shape.body`.

- [x] **Step 4: Verificar el verde y regenerar el contrato**

Run: `pnpm exec vitest run src/docs/openapi.test.ts && pnpm run docs:generate && pnpm run docs:check`
Expected: PASS y `openapi.json` sin drift.

---

### Task 5: Bruno y verificacion E2E

**Files:**

- Create: `bruno/Collaborators/Log in as admin again.bru` (seq 16)
- Create: `bruno/Collaborators/Update a collaborator role.bru` (seq 17)
- Create: `bruno/Collaborators/Update an unknown collaborator returns 404.bru` (seq 18)
- Create: `bruno/Collaborators/Update a collaborator with an invalid role returns 400.bru` (seq 19)
- Create: `bruno/Collaborators/Update a collaborator without a token returns 401.bru` (seq 20)
- Create: `bruno/Collaborators/Update a collaborator on an archived program returns 409.bru` (seq 21)
- Create: `bruno/Collaborators/Update a collaborator as an organizer without grant returns 403.bru` (seq 22)

- [x] **Step 1: Crear los requests**

Copiar el patron de los requests existentes (bearer `{{token}}`, carpeta `Collaborators`). El re-login admin copia `Log in as admin.bru` con seq 16 para recuperar el token tras el head login de seq 12.

- [x] **Step 2: Correr Bruno**

Run: `pnpm exec bru run Collaborators --env local`
Expected: todas las requests y tests en verde. Si se agota el rate limit de login, esperar 60 s.

- [x] **Step 3: Verificacion real E2E (Docker + psql)**

1. Login admin; crear usuario temporal via `POST /api/v1/admin/users`; `POST` colaborador VIEWER en `seed_program_congreso-cit`.
2. psql: insertar `OVERRIDE` manual (`report:export`, `valid_until = now() + 30 days`, `granted_by_id = seed_user_org-fisc`) en `collaboration_permissions` para esa colaboracion.
3. `PATCH` rol a EDITOR → 200; el DTO incluye el `OVERRIDE` con ventana y los `ROLE_DEFAULT` de EDITOR; psql confirma 11 `ROLE_DEFAULT`, 0 defaults de VIEWER y el `OVERRIDE` intacto.
4. Probar 404 (usuario desconocido), 400 (rol invalido), 401 (sin token), 409 (programa archivado) y 403 (head en `seed_program_fisc_default` sin grant).
5. Limpieza: `OVERRIDE`, colaboracion, `sessions`, `accounts` y usuario temporal; conteos restaurados.

- [x] **Step 4: Confirmar conteos restaurados**

Run: psql contra el contenedor para verificar `collaborations`/`collaboration_permissions` sin filas temporales.

---

### Task 6: Documentacion, plan maestro y gates

**Files:**

- Modify: `CONTEXT.md`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [x] **Step 1: `CONTEXT.md`**

Agregar a la seccion `### Colaboradores Por Scope`:

```md
- `PATCH /api/v1/event-programs/{id}/collaborators/{userId}` y `PATCH /api/v1/activities/{id}/collaborators/{userId}` cambian el rol (`{ role }`) de una colaboracion local: reemplazan los `ROLE_DEFAULT` por los del rol nuevo y preservan los `OVERRIDE`. Mismas guardas que `POST` mas subconjunto simetrico sobre los defaults que se eliminan; colaborador inexistente `404`, programa `ARCHIVED` `409`.
```

- [x] **Step 2: `README.md`**

Documentar el endpoint junto a los de 3.1/3.2 con codigos y mensajes.

- [x] **Step 3: Plan maestro**

Marcar 3.3 `[x]`, actualizar la tabla de estado y la lista de endpoints, y agregar `**Registro de ejecucion (2026-09-20 - 3.3):**`.

- [x] **Step 4: Gates finales**

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm run build
pnpm run docs:generate && pnpm run docs:check
```

Expected: todo en verde y `openapi.json` sin drift.

- [x] **Step 5: Cierre**

Sin commit salvo solicitud explicita.
