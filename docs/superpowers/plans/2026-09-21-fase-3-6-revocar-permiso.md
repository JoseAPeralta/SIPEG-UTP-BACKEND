# Fase 3.6 - Revocar permiso Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exponer `DELETE /event-programs/:id/permissions/:permission?userId=` y `DELETE /activities/:id/permissions/:permission?userId=` que eliminan un grant local (`ROLE_DEFAULT` u `OVERRIDE`) de un colaborador del scope, sin tocar la herencia del programa y con `409` claro cuando la herencia hace imposible revocar.

**Architecture:** Se extiende `src/modules/authorization/` (servicio de delegacion y capa HTTP 3.1-3.5). Las rutas siguen `authenticate -> requirePermission(permission:grant, resolver) -> validate -> controlador -> servicio`; la respuesta es `204` sin cuerpo. Sin migraciones, variables de entorno ni permisos nuevos.

**Tech Stack:** TypeScript 6, Express 5, Prisma 7 (SQL/Postgres), Zod 4, Vitest, Supertest, OpenAPI 3.1 (zod-openapi), Bruno.

**Hallazgos de partida (2026-09-21):**

- `revokePermission` ya existe en `delegation.service.ts:493` con subconjunto simetrico (403 `Cannot revoke permissions you do not hold.`), `resolveScope` y `deleteMany` con 404 `Permission grant not found.`; **no** carga el programa (falta 404/409 de archivado) y **no** distingue herencia.
- `canDelegate` (`delegation.service.ts:336`) y `assertScopeKeepsDelegator` (`:343`) ya existen para 3.4; la segunda excluye por completo al usuario objetivo y consulta con `getPrismaClient()`.
- Precedentes: `DELETE /collaborators` responde `204`; `POST/PATCH .../permissions` responden `200` + `Collaborator`; `loadScopeProgram` responde `404 Event program not found.` / `409 Archived event programs cannot be modified.`.
- Seed demo: `seed_user_org-fisc` es ORGANIZER en `seed_program_fisc_default` (hereda `report:export` a `seed_activity_fisc-charla-ia`, sin colaboracion local en la actividad) y ORGANIZER en `seed_program_congreso-cit` con `OVERRIDE` `permission:grant` activo (unico delegador de ese programa). `seed_activity_fisc-charla-ia` pertenece al programa default de FISC.
- Bruno `Collaborators` termina en seq 45 con `token` admin vigente (login seq 44) y `collaboratorUserId` creado en seq 7 (el usuario sigue existiendo; seq 45 solo borra su colaboracion en `congreso-cit`).

**Decisiones confirmadas (2026-09-21):**

1. El DELETE borra **solo grants locales**. Si no hay fila local y el permiso esta heredado activo desde el programa (scope de actividad) -> `409 Cannot revoke a permission inherited from the event program.` Si hay fila local -> `204` aunque el permiso siga vigente por herencia (ADR-0001 NEG-001: no hay DENY; solo se omite el grant local).
2. Revocacion exitosa: `204` sin cuerpo.
3. Se aplica la invariante de ultimo delegador al revocar `permission:grant`: si el scope queda sin ningun colaborador activo capaz de delegar -> `409 Cannot revoke the last delegation permission in this scope.` El escaneo posterior incluye al objetivo si conserva `permission:grant` por herencia del programa.
4. Usuario objetivo por query `?userId=`; el body no se usa.

---

### Task 1: Servicio (TDD)

**Files:**

- Modify: `src/modules/authorization/delegation.service.ts:493-527`
- Test: `src/modules/authorization/delegation.service.test.ts`

- [x] **Step 1: Actualizar las 2 pruebas existentes de revocacion**

`revokes when the actor holds the permission` ahora debe mockear programa activo, permiso y la colaboracion local con su fila; `returns 404 when the revoked grant does not exist` debe mockear programa activo y colaboracion sin filas:

```ts
it('revokes when the actor holds the permission', async () => {
  const prisma = createPrismaMock();
  prisma.collaboration.findMany.mockResolvedValue([
    collaboration(grant(PERMISSIONS.PERMISSION_GRANT), grant(PERMISSIONS.ACTIVITY_UPDATE)),
  ]);
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
  prisma.permission.findUnique.mockResolvedValue({
    id: 'perm-update',
    name: PERMISSIONS.ACTIVITY_UPDATE,
  });
  prisma.collaboration.findFirst.mockResolvedValue({
    id: 'collab-001',
    user: { globalRole: 'USER', isActive: true },
    permissions: [
      { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.ACTIVITY_UPDATE } },
    ],
  });
  prisma.collaborationPermission.deleteMany.mockResolvedValue({ count: 1 });
  const { revokePermission } = await loadService(prisma);

  await revokePermission(
    buildUser(),
    { eventProgramId: 'p1' },
    'user-002',
    PERMISSIONS.ACTIVITY_UPDATE,
    NOW,
  );

  expect(prisma.collaborationPermission.deleteMany).toHaveBeenCalledWith({
    where: { collaborationId: 'collab-001', permissionId: 'perm-update' },
  });
});

it('returns 404 when the revoked grant does not exist', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
  prisma.permission.findUnique.mockResolvedValue({ id: 'perm-update' });
  prisma.collaboration.findFirst.mockResolvedValue({
    id: 'collab-001',
    user: { globalRole: 'USER', isActive: true },
    permissions: [],
  });
  const { revokePermission } = await loadService(prisma);

  await expect(
    revokePermission(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
      PERMISSIONS.ACTIVITY_UPDATE,
      NOW,
    ),
  ).rejects.toMatchObject({ statusCode: 404, message: 'Permission grant not found.' });
  expect(prisma.collaborationPermission.deleteMany).not.toHaveBeenCalled();
});
```

La prueba `revokes only permissions the actor also holds` (403 por envelope) no cambia.

- [x] **Step 2: Agregar las pruebas nuevas que fallan**

```ts
it('rejects revoking a permission on a missing event program', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue(null);
  const { revokePermission } = await loadService(prisma);

  await expect(
    revokePermission(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'missing' },
      'user-002',
      PERMISSIONS.ACTIVITY_UPDATE,
      NOW,
    ),
  ).rejects.toMatchObject({ statusCode: 404, message: 'Event program not found.' });
  expect(prisma.collaborationPermission.deleteMany).not.toHaveBeenCalled();
});

it('rejects revoking a permission on an archived event program', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ARCHIVED' });
  const { revokePermission } = await loadService(prisma);

  await expect(
    revokePermission(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
      PERMISSIONS.ACTIVITY_UPDATE,
      NOW,
    ),
  ).rejects.toMatchObject({
    statusCode: 409,
    message: 'Archived event programs cannot be modified.',
  });
  expect(prisma.collaborationPermission.deleteMany).not.toHaveBeenCalled();
});

it('returns 404 when revoking from a missing collaborator', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
  prisma.permission.findUnique.mockResolvedValue({ id: 'perm-update' });
  prisma.collaboration.findFirst.mockResolvedValue(null);
  const { revokePermission } = await loadService(prisma);

  await expect(
    revokePermission(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
      PERMISSIONS.ACTIVITY_UPDATE,
      NOW,
    ),
  ).rejects.toMatchObject({ statusCode: 404, message: 'Collaborator not found.' });
});

it('resolves the activity scope to its parent program before revoking', async () => {
  const prisma = createPrismaMock();
  prisma.activity.findUnique.mockResolvedValue({ eventProgramId: 'p1' });
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
  prisma.permission.findUnique.mockResolvedValue({ id: 'perm-update' });
  prisma.collaboration.findFirst.mockResolvedValue({
    id: 'collab-001',
    user: { globalRole: 'USER', isActive: true },
    permissions: [
      { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.ACTIVITY_UPDATE } },
    ],
  });
  prisma.collaborationPermission.deleteMany.mockResolvedValue({ count: 1 });
  const { revokePermission } = await loadService(prisma);

  await revokePermission(
    buildUser({ globalRole: 'ADMIN' }),
    { activityId: 'a1' },
    'user-002',
    PERMISSIONS.ACTIVITY_UPDATE,
    NOW,
  );

  expect(prisma.collaboration.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({ where: { userId: 'user-002', activityId: 'a1' } }),
  );
});

it('refuses to revoke a permission inherited from the event program', async () => {
  const prisma = createPrismaMock();
  prisma.activity.findUnique.mockResolvedValue({ eventProgramId: 'p1' });
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
  prisma.permission.findUnique.mockResolvedValue({ id: 'perm-export' });
  prisma.collaboration.findFirst
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ permissions: [{ validFrom: null, validUntil: null }] });
  const { revokePermission } = await loadService(prisma);

  await expect(
    revokePermission(
      buildUser({ globalRole: 'ADMIN' }),
      { activityId: 'a1' },
      'user-002',
      PERMISSIONS.REPORT_EXPORT,
      NOW,
    ),
  ).rejects.toMatchObject({
    statusCode: 409,
    message: 'Cannot revoke a permission inherited from the event program.',
  });
  expect(prisma.collaborationPermission.deleteMany).not.toHaveBeenCalled();
});

it('ignores expired program grants when checking inheritance', async () => {
  const prisma = createPrismaMock();
  prisma.activity.findUnique.mockResolvedValue({ eventProgramId: 'p1' });
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
  prisma.permission.findUnique.mockResolvedValue({ id: 'perm-export' });
  prisma.collaboration.findFirst
    .mockResolvedValueOnce({
      id: 'collab-001',
      user: { globalRole: 'USER', isActive: true },
      permissions: [],
    })
    .mockResolvedValueOnce({
      permissions: [{ validFrom: null, validUntil: new Date('2026-09-18T12:00:00.000Z') }],
    });
  const { revokePermission } = await loadService(prisma);

  await expect(
    revokePermission(
      buildUser({ globalRole: 'ADMIN' }),
      { activityId: 'a1' },
      'user-002',
      PERMISSIONS.REPORT_EXPORT,
      NOW,
    ),
  ).rejects.toMatchObject({ statusCode: 404, message: 'Permission grant not found.' });
  expect(prisma.collaborationPermission.deleteMany).not.toHaveBeenCalled();
});

it('revokes a local activity grant even when the program also grants the permission', async () => {
  const prisma = createPrismaMock();
  prisma.activity.findUnique.mockResolvedValue({ eventProgramId: 'p1' });
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
  prisma.permission.findUnique.mockResolvedValue({ id: 'perm-export' });
  prisma.collaboration.findFirst.mockResolvedValue({
    id: 'collab-001',
    user: { globalRole: 'USER', isActive: true },
    permissions: [
      { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.REPORT_EXPORT } },
    ],
  });
  prisma.collaborationPermission.deleteMany.mockResolvedValue({ count: 1 });
  const { revokePermission } = await loadService(prisma);

  await revokePermission(
    buildUser({ globalRole: 'ADMIN' }),
    { activityId: 'a1' },
    'user-002',
    PERMISSIONS.REPORT_EXPORT,
    NOW,
  );

  expect(prisma.collaboration.findFirst).toHaveBeenCalledTimes(1);
  expect(prisma.collaborationPermission.deleteMany).toHaveBeenCalledWith({
    where: { collaborationId: 'collab-001', permissionId: 'perm-export' },
  });
});

it('blocks revoking the last active delegation permission', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
  prisma.permission.findUnique.mockResolvedValue({
    id: 'perm-grant',
    name: PERMISSIONS.PERMISSION_GRANT,
  });
  prisma.collaboration.findFirst.mockResolvedValue({
    id: 'collab-001',
    user: { globalRole: 'USER', isActive: true },
    permissions: [
      { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.PERMISSION_GRANT } },
    ],
  });
  prisma.collaboration.findMany.mockResolvedValue([
    {
      userId: 'user-002',
      eventProgramId: 'p1',
      activityId: null,
      user: { globalRole: 'USER', isActive: true },
      permissions: [
        { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.PERMISSION_GRANT } },
      ],
    },
  ]);
  const { revokePermission } = await loadService(prisma);

  await expect(
    revokePermission(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
      PERMISSIONS.PERMISSION_GRANT,
      NOW,
    ),
  ).rejects.toMatchObject({
    statusCode: 409,
    message: 'Cannot revoke the last delegation permission in this scope.',
  });
  expect(prisma.collaborationPermission.deleteMany).not.toHaveBeenCalled();
});

it('allows revoking permission:grant when another delegator remains', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
  prisma.permission.findUnique.mockResolvedValue({ id: 'perm-grant' });
  prisma.collaboration.findFirst.mockResolvedValue({
    id: 'collab-001',
    user: { globalRole: 'USER', isActive: true },
    permissions: [
      { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.PERMISSION_GRANT } },
    ],
  });
  prisma.collaboration.findMany.mockResolvedValue([
    {
      userId: 'user-002',
      eventProgramId: 'p1',
      activityId: null,
      user: { globalRole: 'USER', isActive: true },
      permissions: [
        { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.PERMISSION_GRANT } },
      ],
    },
    {
      userId: 'actor-001',
      eventProgramId: 'p1',
      activityId: null,
      user: { globalRole: 'USER', isActive: true },
      permissions: [
        { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.PERMISSION_GRANT } },
      ],
    },
  ]);
  prisma.collaborationPermission.deleteMany.mockResolvedValue({ count: 1 });
  const { revokePermission } = await loadService(prisma);

  await revokePermission(
    buildUser({ globalRole: 'ADMIN' }),
    { eventProgramId: 'p1' },
    'user-002',
    PERMISSIONS.PERMISSION_GRANT,
    NOW,
  );

  expect(prisma.collaborationPermission.deleteMany).toHaveBeenCalledTimes(1);
});

it('counts inherited program delegators when revoking an activity grant', async () => {
  const prisma = createPrismaMock();
  prisma.activity.findUnique.mockResolvedValue({ eventProgramId: 'p1' });
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
  prisma.permission.findUnique.mockResolvedValue({ id: 'perm-grant' });
  prisma.collaboration.findFirst.mockResolvedValue({
    id: 'collab-activity',
    user: { globalRole: 'USER', isActive: true },
    permissions: [
      { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.PERMISSION_GRANT } },
    ],
  });
  prisma.collaboration.findMany.mockResolvedValue([
    {
      userId: 'user-002',
      eventProgramId: null,
      activityId: 'a1',
      user: { globalRole: 'USER', isActive: true },
      permissions: [
        { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.PERMISSION_GRANT } },
      ],
    },
    {
      userId: 'user-002',
      eventProgramId: 'p1',
      activityId: null,
      user: { globalRole: 'USER', isActive: true },
      permissions: [
        { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.PERMISSION_GRANT } },
      ],
    },
  ]);
  prisma.collaborationPermission.deleteMany.mockResolvedValue({ count: 1 });
  const { revokePermission } = await loadService(prisma);

  await revokePermission(
    buildUser({ globalRole: 'ADMIN' }),
    { activityId: 'a1' },
    'user-002',
    PERMISSIONS.PERMISSION_GRANT,
    NOW,
  );

  expect(prisma.collaborationPermission.deleteMany).toHaveBeenCalledTimes(1);
});

it('skips the delegator guard when revoking an inactive delegation grant', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
  prisma.permission.findUnique.mockResolvedValue({ id: 'perm-grant' });
  prisma.collaboration.findFirst.mockResolvedValue({
    id: 'collab-001',
    user: { globalRole: 'USER', isActive: true },
    permissions: [
      {
        validFrom: null,
        validUntil: new Date('2026-09-18T12:00:00.000Z'),
        permission: { name: PERMISSIONS.PERMISSION_GRANT },
      },
    ],
  });
  prisma.collaborationPermission.deleteMany.mockResolvedValue({ count: 1 });
  const { revokePermission } = await loadService(prisma);

  await revokePermission(
    buildUser({ globalRole: 'ADMIN' }),
    { eventProgramId: 'p1' },
    'user-002',
    PERMISSIONS.PERMISSION_GRANT,
    NOW,
  );

  expect(prisma.collaboration.findMany).not.toHaveBeenCalled();
  expect(prisma.collaborationPermission.deleteMany).toHaveBeenCalledTimes(1);
});

it('does not scan delegators when revoking another permission', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
  prisma.permission.findUnique.mockResolvedValue({ id: 'perm-update' });
  prisma.collaboration.findFirst.mockResolvedValue({
    id: 'collab-001',
    user: { globalRole: 'USER', isActive: true },
    permissions: [
      { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.ACTIVITY_UPDATE } },
    ],
  });
  prisma.collaborationPermission.deleteMany.mockResolvedValue({ count: 1 });
  const { revokePermission } = await loadService(prisma);

  await revokePermission(
    buildUser({ globalRole: 'ADMIN' }),
    { eventProgramId: 'p1' },
    'user-002',
    PERMISSIONS.ACTIVITY_UPDATE,
    NOW,
  );

  expect(prisma.collaboration.findMany).not.toHaveBeenCalled();
  expect(prisma.collaborationPermission.deleteMany).toHaveBeenCalledTimes(1);
});
```

- [x] **Step 3: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/authorization/delegation.service.test.ts`
Expected: FAIL por las guardas nuevas (404/409 de programa, herencia y ultimo delegador) y por los mocks desactualizados.

- [x] **Step 4: Implementar el helper y reescribir `revokePermission`**

Reemplazar la funcion `revokePermission` (lineas 493-527) y agregar `assertRevokeKeepsDelegator` justo despues de `assertScopeKeepsDelegator`:

```ts
const assertRevokeKeepsDelegator = async (
  resolved: ResolvedScope,
  targetUserId: string,
  now: Date,
): Promise<void> => {
  const scopeFilter = resolved.activityId
    ? { OR: [{ activityId: resolved.activityId }, { eventProgramId: resolved.eventProgramId }] }
    : { eventProgramId: resolved.eventProgramId };

  const collaborations = await getPrismaClient().collaboration.findMany({
    where: scopeFilter,
    select: {
      userId: true,
      eventProgramId: true,
      activityId: true,
      user: { select: { globalRole: true, isActive: true } },
      permissions: {
        where: { permission: { name: PERMISSIONS.PERMISSION_GRANT } },
        select: {
          validFrom: true,
          validUntil: true,
          permission: { select: { name: true } },
        },
      },
    },
  });

  const isRevokedCollaboration = (record: {
    userId: string;
    eventProgramId: string | null;
    activityId: string | null;
  }): boolean =>
    record.userId === targetUserId &&
    (resolved.activityId
      ? record.activityId === resolved.activityId
      : record.eventProgramId === resolved.eventProgramId);

  const hasDelegator = collaborations.some(
    (record) => !isRevokedCollaboration(record) && canDelegate(record, now),
  );

  if (!hasDelegator) {
    throw new ApiError(409, 'Cannot revoke the last delegation permission in this scope.');
  }
};

export const revokePermission = async (
  actor: Express.AuthenticatedUser,
  scope: AuthorizationScope,
  targetUserId: string,
  permission: PermissionName,
  now: Date = new Date(),
): Promise<void> => {
  const envelopes = await assertActorCanDelegate(actor, scope, now);

  if (!envelopes.has(permission)) {
    throw new ApiError(403, 'Cannot revoke permissions you do not hold.');
  }

  const resolved = await resolveScope(scope);
  const program = await loadScopeProgram(resolved);

  if (program.status === 'ARCHIVED') {
    throw new ApiError(409, 'Archived event programs cannot be modified.');
  }

  const prisma = getPrismaClient();
  const permissionId = await loadPermissionId(permission);

  const collaboration = await prisma.collaboration.findFirst({
    where: { userId: targetUserId, ...scopeWhere(resolved) },
    select: {
      id: true,
      user: { select: { globalRole: true, isActive: true } },
      permissions: {
        where: { permissionId },
        select: {
          validFrom: true,
          validUntil: true,
          permission: { select: { name: true } },
        },
      },
    },
  });

  if (!collaboration || collaboration.permissions.length === 0) {
    if (resolved.activityId) {
      const inherited = await prisma.collaboration.findFirst({
        where: { userId: targetUserId, eventProgramId: resolved.eventProgramId },
        select: {
          permissions: {
            where: { permissionId },
            select: { validFrom: true, validUntil: true },
          },
        },
      });

      if (inherited?.permissions.some((row) => isGrantActive(row, now))) {
        throw new ApiError(409, 'Cannot revoke a permission inherited from the event program.');
      }
    }

    if (!collaboration) {
      throw new ApiError(404, 'Collaborator not found.');
    }

    throw new ApiError(404, 'Permission grant not found.');
  }

  if (permission === PERMISSIONS.PERMISSION_GRANT && canDelegate(collaboration, now)) {
    await assertRevokeKeepsDelegator(resolved, targetUserId, now);
  }

  const result = await prisma.collaborationPermission.deleteMany({
    where: { collaborationId: collaboration.id, permissionId },
  });

  if (result.count === 0) {
    throw new ApiError(404, 'Permission grant not found.');
  }
};
```

- [x] **Step 5: Verificar el verde**

Run: `pnpm exec vitest run src/modules/authorization/delegation.service.test.ts`
Expected: PASS.

---

### Task 2: Esquemas (TDD)

**Files:**

- Modify: `src/modules/authorization/authorization.schemas.ts`
- Test: `src/modules/authorization/authorization.schemas.test.ts`

- [x] **Step 1: Pruebas que fallan**

```ts
describe('revoke permission schema', () => {
  it('parses the scope, the permission and the user query', () => {
    const parsed = revokePermissionSchema.parse({
      params: { id: '  program-001  ', permission: 'report:export' },
      query: { userId: ' user-002 ' },
    });

    expect(parsed.params).toEqual({ id: 'program-001', permission: 'report:export' });
    expect(parsed.query).toEqual({ userId: 'user-002' });
  });

  it('rejects an unknown permission', () => {
    expect(() =>
      revokePermissionSchema.parse({
        params: { id: 'p1', permission: 'nope:nope' },
        query: { userId: 'user-002' },
      }),
    ).toThrow();
  });

  it('rejects a blank user query', () => {
    expect(() =>
      revokePermissionSchema.parse({
        params: { id: 'p1', permission: 'report:export' },
        query: { userId: '   ' },
      }),
    ).toThrow();
  });

  it('rejects a missing user query', () => {
    expect(() =>
      revokePermissionSchema.parse({
        params: { id: 'p1', permission: 'report:export' },
        query: {},
      }),
    ).toThrow();
  });

  it('rejects unknown query keys', () => {
    expect(() =>
      revokePermissionSchema.parse({
        params: { id: 'p1', permission: 'report:export' },
        query: { userId: 'user-002', grantedById: 'admin-001' },
      }),
    ).toThrow();
  });
});
```

Agregar `revokePermissionSchema` al import del archivo.

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/authorization/authorization.schemas.test.ts`
Expected: FAIL porque `revokePermissionSchema` no existe.

- [x] **Step 3: Implementar**

Agregar despues de `grantPermissionSchema`:

```ts
export const revokePermissionSchema = z.object({
  params: z.object({
    id: scopeIdSchema,
    permission: z.enum(PERMISSION_NAMES, 'Permission is invalid.'),
  }),
  query: z.object({ userId: userIdSchema }).strict(),
});
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

Agregar `revokePermission: vi.fn()` a `DelegationServiceMock` y a `buildServiceMock`. Agregar las pruebas:

```ts
const revokeUrl = '/api/v1/event-programs/program-001/permissions/report:export?userId=user-002';

it('rejects revoking a permission without a token', async () => {
  const service = buildServiceMock();
  const app = await loadApp(service);

  await request(app).delete(revokeUrl).expect(401);
  expect(service.revokePermission).not.toHaveBeenCalled();
});

it('rejects revoking a permission without permission:grant in the scope', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(userRecord);
  const app = await loadApp(service, prisma, ['activity:read']);

  await request(app).delete(revokeUrl).set('Authorization', 'Bearer user-001').expect(403);
  expect(service.revokePermission).not.toHaveBeenCalled();
});

it('revokes a permission in an event program for a permission:grant holder', async () => {
  const service = buildServiceMock();
  service.revokePermission.mockResolvedValue(undefined);
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(userRecord);
  const getEffectivePermissions = vi.fn();
  const app = await loadApp(service, prisma, ['permission:grant'], getEffectivePermissions);

  const response = await request(app)
    .delete(revokeUrl)
    .set('Authorization', 'Bearer user-001')
    .expect(204);

  expect(getEffectivePermissions).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'user-001' }),
    { eventProgramId: 'program-001' },
  );
  expect(service.revokePermission).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'user-001' }),
    { eventProgramId: 'program-001' },
    'user-002',
    'report:export',
  );
  expect(response.text).toBe('');
});

it('resolves the activity scope when revoking an activity permission', async () => {
  const service = buildServiceMock();
  service.revokePermission.mockResolvedValue(undefined);
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminRecord);
  const app = await loadApp(service, prisma);

  await request(app)
    .delete('/api/v1/activities/activity-001/permissions/activity:read?userId=user-002')
    .set('Authorization', 'Bearer admin-001')
    .expect(204);

  expect(service.revokePermission).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'admin-001' }),
    { activityId: 'activity-001' },
    'user-002',
    'activity:read',
  );
});

it('rejects an unknown permission before the service', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminRecord);
  const app = await loadApp(service, prisma);

  await request(app)
    .delete('/api/v1/event-programs/program-001/permissions/nope:nope?userId=user-002')
    .set('Authorization', 'Bearer admin-001')
    .expect(400);
  expect(service.revokePermission).not.toHaveBeenCalled();
});

it('rejects a missing user query parameter before the service', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminRecord);
  const app = await loadApp(service, prisma);

  await request(app)
    .delete('/api/v1/event-programs/program-001/permissions/report:export')
    .set('Authorization', 'Bearer admin-001')
    .expect(400);
  expect(service.revokePermission).not.toHaveBeenCalled();
});

it('propagates an inherited permission conflict as 409', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminRecord);
  const app = await loadApp(service, prisma);
  const { ApiError } = await import('../../utils/ApiError.js');
  service.revokePermission.mockRejectedValue(
    new ApiError(409, 'Cannot revoke a permission inherited from the event program.'),
  );

  await request(app)
    .delete('/api/v1/activities/activity-001/permissions/report:export?userId=user-002')
    .set('Authorization', 'Bearer admin-001')
    .expect(409);
});

it('propagates a missing collaborator as 404', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminRecord);
  const app = await loadApp(service, prisma);
  const { ApiError } = await import('../../utils/ApiError.js');
  service.revokePermission.mockRejectedValue(new ApiError(404, 'Collaborator not found.'));

  await request(app).delete(revokeUrl).set('Authorization', 'Bearer admin-001').expect(404);
});
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/authorization/authorization.routes.test.ts`
Expected: FAIL con 404 en las rutas nuevas.

- [x] **Step 3: Implementar controlador y rutas**

Controlador (agregar al final; importar `type PermissionName` desde `./permissions.js` y `revokePermission as revokePermissionService` desde `./delegation.service.js`):

```ts
export const revokeEventProgramPermission: RequestHandler = asyncHandler(async (req, res) => {
  const { id, permission } = req.params as { id: string; permission: PermissionName };
  const { userId } = req.query as { userId: string };
  const user = requireAuthenticatedUser(req);
  await revokePermissionService(user, { eventProgramId: id }, userId, permission);

  res.status(204).send();
});

export const revokeActivityPermission: RequestHandler = asyncHandler(async (req, res) => {
  const { id, permission } = req.params as { id: string; permission: PermissionName };
  const { userId } = req.query as { userId: string };
  const user = requireAuthenticatedUser(req);
  await revokePermissionService(user, { activityId: id }, userId, permission);

  res.status(204).send();
});
```

Rutas (agregar despues del `POST /activities/:id/permissions`; importar `revokePermissionSchema` y los dos controladores):

```ts
authorizationRoutes.delete(
  '/event-programs/:id/permissions/:permission',
  authenticate,
  requirePermission(PERMISSIONS.PERMISSION_GRANT, eventProgramScope),
  validate(revokePermissionSchema),
  revokeEventProgramPermission,
);

authorizationRoutes.delete(
  '/activities/:id/permissions/:permission',
  authenticate,
  requirePermission(PERMISSIONS.PERMISSION_GRANT, activityScope),
  validate(revokePermissionSchema),
  revokeActivityPermission,
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
'DELETE /api/v1/activities/{id}/permissions/{permission}',
'DELETE /api/v1/event-programs/{id}/permissions/{permission}',
```

Y la prueba:

```ts
it('documents permission revocation with bearer security and its conflicts', () => {
  const programDelete =
    openApiDocument.paths?.['/api/v1/event-programs/{id}/permissions/{permission}']?.delete;
  const activityDelete =
    openApiDocument.paths?.['/api/v1/activities/{id}/permissions/{permission}']?.delete;
  const parameters = programDelete?.parameters ?? [];
  const names = parameters.map((parameter) => ('name' in parameter ? parameter.name : undefined));

  expect(programDelete?.security).toEqual([{ bearerAuth: [] }]);
  expect(programDelete?.responses?.['204']).toBeDefined();
  expect(programDelete?.responses?.['403']).toBeDefined();
  expect(programDelete?.responses?.['404']).toBeDefined();
  expect(programDelete?.responses?.['409']).toBeDefined();
  expect(names).toContain('id');
  expect(names).toContain('permission');
  expect(names).toContain('userId');
  expect(activityDelete?.security).toEqual([{ bearerAuth: [] }]);
  expect(activityDelete?.responses?.['204']).toBeDefined();
});
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/docs/openapi.test.ts`
Expected: FAIL: operaciones DELETE no documentadas.

- [x] **Step 3: Implementar las rutas OpenAPI**

Agregar `revokeResponses`, `revokeDescription` y los dos paths `delete` (tag `Collaborators`), reutilizando `revokePermissionSchema.shape.params` y `.shape.query`:

```ts
const revokeResponses = {
  204: { description: 'Local permission grant removed from the scope.' },
  400: errorResponse,
  401: errorResponse,
  403: errorResponse,
  404: errorResponse,
  409: errorResponse,
} as const;

const revokeDescription =
  'Removes a local permission grant (ROLE_DEFAULT or OVERRIDE) from an existing collaborator of the scope. Requires `permission:grant` in the scope or the ADMIN role; the actor can only revoke permissions it holds. In an activity scope the endpoint never touches the program grants: when the permission has no local grant but is actively inherited from the event program it responds 409 `Cannot revoke a permission inherited from the event program.` (revoke it at the program scope instead); when a local grant exists it is removed even if the permission stays effective through inheritance. Revoking `permission:grant` from the last active collaborator able to delegate in the scope responds 409. Archived event programs cannot be modified.';
```

```ts
'/api/v1/event-programs/{id}/permissions/{permission}': {
  delete: {
    tags: ['Collaborators'],
    summary: 'Revoke a permission in an event program',
    description: revokeDescription,
    security: [{ bearerAuth: [] }],
    requestParams: {
      path: revokePermissionSchema.shape.params,
      query: revokePermissionSchema.shape.query,
    },
    responses: revokeResponses,
  },
},
'/api/v1/activities/{id}/permissions/{permission}': {
  delete: {
    tags: ['Collaborators'],
    summary: 'Revoke a permission in an activity',
    description: revokeDescription,
    security: [{ bearerAuth: [] }],
    requestParams: {
      path: revokePermissionSchema.shape.params,
      query: revokePermissionSchema.shape.query,
    },
    responses: revokeResponses,
  },
},
```

- [x] **Step 4: Verificar el verde y regenerar el contrato**

Run: `pnpm exec vitest run src/docs/openapi.test.ts && pnpm run docs:generate && pnpm run docs:check`
Expected: PASS y `openapi.json` sin drift.

---

### Task 5: Bruno y verificacion E2E

**Files:**

- Create: `bruno/Collaborators/Add a collaborator for revocation.bru` (seq 46)
- Create: `bruno/Collaborators/Revoke a permission.bru` (seq 47)
- Create: `bruno/Collaborators/List collaborators after revocation.bru` (seq 48)
- Create: `bruno/Collaborators/Grant a permission for revocation.bru` (seq 49)
- Create: `bruno/Collaborators/Revoke an override permission.bru` (seq 50)
- Create: `bruno/Collaborators/Revoke the same permission returns 404.bru` (seq 51)
- Create: `bruno/Collaborators/Revoke an unknown permission returns 400.bru` (seq 52)
- Create: `bruno/Collaborators/Revoke a permission from an unknown collaborator returns 404.bru` (seq 53)
- Create: `bruno/Collaborators/Revoke a permission without a token returns 401.bru` (seq 54)
- Create: `bruno/Collaborators/Revoke a permission on an archived program returns 409.bru` (seq 55)
- Create: `bruno/Collaborators/Revoke an inherited permission returns 409.bru` (seq 56)
- Create: `bruno/Collaborators/Revoke the last delegation permission returns 409.bru` (seq 57)
- Create: `bruno/Collaborators/Add a collaborator to the activity for revocation.bru` (seq 58)
- Create: `bruno/Collaborators/Revoke an activity permission.bru` (seq 59)
- Create: `bruno/Collaborators/Delete the activity collaborator after revocation.bru` (seq 60)
- Create: `bruno/Collaborators/Delete the collaborator after revocation.bru` (seq 61)

- [x] **Step 1: Crear los requests**

Patron de los existentes (bearer `{{token}}`, carpeta `Collaborators`). Contenido clave:

- seq 46 `POST {{baseUrl}}/api/v1/event-programs/{{collaboratorsProgramId}}/collaborators` body `{ "userId": "{{collaboratorUserId}}", "role": "VIEWER" }` -> 201.
- seq 47 `DELETE {{baseUrl}}/api/v1/event-programs/{{collaboratorsProgramId}}/permissions/report:view?userId={{collaboratorUserId}}` -> 204, body vacio.
- seq 48 `GET .../collaborators` -> 200; localizar por `userId` y comprobar que `permissions` no contiene `report:view`.
- seq 49 `POST .../permissions` body `{ "userId": "{{collaboratorUserId}}", "permission": "report:export" }` -> 200 (setup del OVERRIDE).
- seq 50 `DELETE .../permissions/report:export?userId={{collaboratorUserId}}` -> 204.
- seq 51 mismo DELETE -> 404 `Permission grant not found.`.
- seq 52 `DELETE .../permissions/nope:nope?userId={{collaboratorUserId}}` -> 400.
- seq 53 `DELETE .../permissions/report:view?userId={{unknownUserId}}` -> 404 `Collaborator not found.`.
- seq 54 mismo DELETE de seq 47 con `auth: none` -> 401.
- seq 55 `DELETE {{baseUrl}}/api/v1/event-programs/{{archivedProgramId}}/permissions/report:view?userId={{collaboratorUserId}}` -> 409 `Archived event programs cannot be modified.`.
- seq 56 `DELETE {{baseUrl}}/api/v1/activities/{{collaboratorsActivityId}}/permissions/report:export?userId=seed_user_org-fisc` -> 409 `Cannot revoke a permission inherited from the event program.` (hereda ORGANIZER de FISC default sin colaboracion local en la actividad).
- seq 57 `DELETE {{baseUrl}}/api/v1/event-programs/{{collaboratorsProgramId}}/permissions/permission:grant?userId=seed_user_org-fisc` -> 409 `Cannot revoke the last delegation permission in this scope.`.
- seq 58 `POST {{baseUrl}}/api/v1/activities/{{collaboratorsActivityId}}/collaborators` body `{ "userId": "{{collaboratorUserId}}", "role": "VIEWER" }` -> 201.
- seq 59 `DELETE {{baseUrl}}/api/v1/activities/{{collaboratorsActivityId}}/permissions/activity:read?userId={{collaboratorUserId}}` -> 204.
- seq 60 `DELETE {{baseUrl}}/api/v1/activities/{{collaboratorsActivityId}}/collaborators/{{collaboratorUserId}}` -> 204.
- seq 61 `DELETE {{baseUrl}}/api/v1/event-programs/{{collaboratorsProgramId}}/collaborators/{{collaboratorUserId}}` -> 204.

- [x] **Step 2: Correr Bruno**

Run: `pnpm exec bru run Collaborators --env local`
Expected: 60 requests y 61 tests en verde (verificado). Si se agota el rate limit de login, esperar 60 s. Si la API reinicia por `tsx watch` durante la corrida, repetirla.

- [x] **Step 3: Verificacion real E2E (Docker + psql)**

Stack: `docker compose -f compose.dev.yaml` (api, db y mailpit arriba). Usar `docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg_utp -c "..."` para contraste. Pasos:

1. Registrar conteos base: `collaborations`, `collaboration_permissions`, `users`.
2. Login admin; crear usuario temporal T via `POST /admin/users`; agregarlo como VIEWER a `seed_program_congreso-cit`.
3. `DELETE /event-programs/seed_program_congreso-cit/permissions/report:view?userId=T` -> 204; psql confirma la fila eliminada y el resto intacto.
4. `POST .../permissions` `report:export` para T -> 200; `DELETE .../permissions/report:export?userId=T` -> 204; psql confirma 0 filas del permiso.
5. Repetir el DELETE -> 404; permiso desconocido -> 400; userId en blanco y ausente -> 400; colaborador desconocido -> 404; programa archivado -> 409; sin token -> 401; head (`seed_user_org-fisc`) sin `permission:grant` en su programa default FISC -> 403.
6. Herencia: `DELETE /activities/seed_activity_fisc-charla-ia/permissions/report:export?userId=seed_user_org-fisc` -> 409; psql confirma que no se borro la fila del programa.
7. Local + herencia: `DELETE /activities/seed_activity_fisc-charla-ia/permissions/activity:read?userId=seed_user_editor` -> 204; psql confirma que solo desaparecio la fila local de la actividad y la del programa default FISC sigue.
8. Ultimo delegador: `DELETE /event-programs/seed_program_congreso-cit/permissions/permission:grant?userId=seed_user_org-fisc` con admin -> 409; psql confirma la fila intacta.
9. Actividad: agregar T a `seed_activity_fisc-charla-ia` como VIEWER; `DELETE /activities/seed_activity_fisc-charla-ia/permissions/activity:read?userId=T` -> 204; psql confirma cascada local; borrar la colaboracion de T (204).
10. Limpieza total: eliminar colaboraciones de T y el usuario T; restaurar la fila `activity:read` local de `seed_user_editor` en la actividad (via `POST .../permissions` con admin o psql) si se desea dejar el seed intacto; confirmar conteos base.

- [x] **Step 4: Confirmar conteos restaurados**

Run: psql contra el contenedor para verificar `collaborations`/`collaboration_permissions`/`users` con los valores base.

---

### Task 6: Documentacion, plan maestro y gates

**Files:**

- Modify: `CONTEXT.md`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [x] **Step 1: `CONTEXT.md`**

Agregar un bullet en `### Colaboradores Por Scope` (despues del bullet del POST) con el DELETE, la herencia y el ultimo delegador.

- [x] **Step 2: `README.md`**

Agregar el endpoint en `### Colaboradores Por Scope` con `204`, subconjunto, herencia 409 y ultimo delegador 409.

- [x] **Step 3: Plan maestro**

Marcar 3.6 `[x]`, actualizar la tabla de estado y la lista de endpoints, y agregar `**Registro de ejecucion (2026-09-21 - 3.6):**` con decisiones, pruebas, verificacion y hallazgos.

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
