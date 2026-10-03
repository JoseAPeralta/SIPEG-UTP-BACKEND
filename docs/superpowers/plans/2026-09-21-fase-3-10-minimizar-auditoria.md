# Fase 3.10 - Minimizar auditoria expuesta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Garantizar con pruebas que `grantedById`/`grantedAt` nunca se devuelven por HTTP (se conservan como auditoria interna en `collaboration_permissions`), documentarlo de forma uniforme en el contrato OpenAPI y verificarlo E2E contra PostgreSQL.

**Architecture:** Item de endurecimiento/verificacion. No hay cambios de DTOs, `select`, migraciones ni variables de entorno: `collaboratorSelect` (`delegation.service.ts:89`), `collaboratorListSelect` (`:179`) y los mappers `toCollaboratorDetail` (`:121`)/`toCollaboratorListDetail` (`:139`) ya excluyen la auditoria, al igual que `listOwnPermissions` (`authorization.service.ts:257`). Se agregan pruebas de caracterizacion que alimentan filas **con** auditoria y comprueban que el stripping ocurre en el mapper y que los `select` no la solicitan; una prueba de ruta con los servicios reales; notas en las descripciones OpenAPI; aserciones Bruno en `My_Permissions`; y una verificacion E2E Docker + psql.

**Tech Stack:** TypeScript 6, Express 5, Prisma 7 (SQL/Postgres), Zod 4, Vitest 4, Supertest, OpenAPI 3.1, Bruno.

**Hallazgos de partida (2026-09-21):**

- `collaboratorSelect` (`delegation.service.ts:89`), `collaboratorListSelect` (`:179`) y `getPermissionEnvelopes`/`getPermissionProvenance` (`authorization.service.ts:128`, `:189`) no seleccionan `grantedById`/`grantedAt`. Los mappers construyen DTOs campo a campo.
- `listOwnPermissions` (`authorization.service.ts:257`) mapea solo `name`/`origin`/`validFrom`/`validUntil`.
- La unica prueba de ausencia explicita esta en `delegation.service.test.ts:1482` (`listCollaborators`). Los tests de mutaciones usan igualdad estricta del DTO (implicita) y no hay ninguna prueba de ruta ni de `listOwnPermissions` que asevere la ausencia.
- Bruno ya verifica la ausencia en `List program collaborators`, `List activity collaborators`, `Add a collaborator`, `Update a collaborator role` y `Grant a permission`; falta en `My_Permissions`.
- OpenAPI documenta la minimizacion solo en `listDescription`; `addDescription`, `updateDescription`, `grantDescription` y `ownPermissionsDescription` no la mencionan.
- `authorization.schemas.test.ts:196,250` ya rechaza `grantedById` como entrada (body/query estrictos).
- ADR-0001: "Cada grant registra `granted_by_id` y `granted_at` para auditoria de la delegacion" (POS-003).
- Seed demo: `seed_user_editor` (`editor.eventos@utp.ac.pa`) y `seed_user_visor` (`visor.eventos@utp.ac.pa`), password demo `Sipeg2026*UTP`; programa `seed_program_congreso-cit`.

**Decisiones confirmadas con el usuario (2026-09-21):**

1. Nunca exponer `grantedById`/`grantedAt`, ni siquiera a `ADMIN` (consistente con 3.1/3.7/3.8).
2. Sin cambios de contrato de datos: solo descripciones OpenAPI (texto), pruebas, Bruno, docs y E2E.
3. Sin migraciones, dependencias, permisos ni variables de entorno nuevas.

**No-vacuidad:** como la implementacion ya cumple, cada bloque de pruebas se valida rompiendo temporalmente el mapper (`toCollaboratorDetail`/`toCollaboratorListDetail`/map de `listOwnPermissions`) con un campo `grantedById: 'leak'`, observando el rojo esperado y restaurando el codigo.

---

### Task 1: Caracterizacion de auditoria en el servicio de delegacion

**Files:**

- Modify: `src/modules/authorization/delegation.service.test.ts` (nuevo `describe` al final del archivo)

- [x] **Step 1: Escribir las pruebas que fallan**

Agregar al final de `src/modules/authorization/delegation.service.test.ts` (despues del describe `delegation service expiry with the system clock and default now`):

```ts
describe('delegation service audit minimization', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
  });

  it('strips audit fields from listed rows and never selects them', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findMany.mockResolvedValue([
      collaboratorRecord({
        grantedById: 'actor-001',
        grantedAt: new Date('2026-09-19T10:00:00.000Z'),
        permissions: [
          {
            source: 'ROLE_DEFAULT',
            validFrom: null,
            validUntil: null,
            grantedById: 'actor-001',
            grantedAt: new Date('2026-09-19T10:00:00.000Z'),
            permission: { name: PERMISSIONS.ACTIVITY_READ },
          },
        ],
      }),
    ]);
    const { listCollaborators } = await loadService(prisma);

    const result = await listCollaborators(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      NOW,
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.to.include('grantedBy');
    expect(serialized).not.to.include('grantedAt');
    for (const call of prisma.collaboration.findMany.mock.calls) {
      const args = call[0] as { select: unknown };
      expect(JSON.stringify(args.select)).not.to.include('grantedBy');
      expect(JSON.stringify(args.select)).not.to.include('grantedAt');
    }
  });

  it('strips audit fields from the created collaborator response', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-002', isActive: true });
    prisma.collaboration.findFirst.mockResolvedValue(null);
    prisma.permission.findMany.mockResolvedValue(permissionRecords(ROLE_DEFAULTS.VIEWER));
    prisma.collaboration.create.mockResolvedValue(
      collaboratorRecord({
        grantedById: 'actor-001',
        grantedAt: new Date('2026-09-19T12:00:00.000Z'),
        permissions: [
          {
            source: 'ROLE_DEFAULT',
            validFrom: null,
            validUntil: null,
            grantedById: 'actor-001',
            grantedAt: new Date('2026-09-19T12:00:00.000Z'),
            permission: { name: PERMISSIONS.ACTIVITY_READ },
          },
        ],
      }),
    );
    const { addCollaborator } = await loadService(prisma);

    const result = await addCollaborator(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
      'VIEWER',
      NOW,
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.to.include('grantedBy');
    expect(serialized).not.to.include('grantedAt');
    const createArgs = prisma.collaboration.create.mock.calls[0]?.[0] as {
      select: unknown;
      data: unknown;
    };
    expect(JSON.stringify(createArgs.select)).not.to.include('grantedBy');
    expect(JSON.stringify(createArgs.data)).to.include('grantedById');
  });

  it('strips audit fields from the role update response', async () => {
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
    prisma.collaboration.findUniqueOrThrow.mockResolvedValue(
      collaboratorRecord({
        role: 'EDITOR',
        grantedById: 'actor-001',
        grantedAt: new Date('2026-09-19T12:00:00.000Z'),
      }),
    );
    const { updateCollaboratorRole } = await loadService(prisma);

    const result = await updateCollaboratorRole(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
      'EDITOR',
      NOW,
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.to.include('grantedBy');
    expect(serialized).not.to.include('grantedAt');
    const readArgs = prisma.collaboration.findUniqueOrThrow.mock.calls[0]?.[0] as {
      select: unknown;
    };
    expect(JSON.stringify(readArgs.select)).not.to.include('grantedBy');
    const createManyArgs = prisma.collaborationPermission.createMany.mock.calls[0]?.[0] as {
      data: unknown;
    };
    expect(JSON.stringify(createManyArgs.data)).to.include('grantedById');
  });

  it('strips audit fields from the grant response while persisting them', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue({ id: 'collab-001' });
    prisma.permission.findUnique.mockResolvedValue({
      id: 'perm-grant',
      name: PERMISSIONS.PERMISSION_GRANT,
    });
    prisma.collaborationPermission.upsert.mockResolvedValue({});
    prisma.collaboration.findUniqueOrThrow.mockResolvedValue(
      collaboratorRecord({
        grantedById: 'actor-001',
        grantedAt: new Date('2026-09-19T12:00:00.000Z'),
      }),
    );
    const { grantPermission } = await loadService(prisma);

    const result = await grantPermission(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
      PERMISSIONS.PERMISSION_GRANT,
      {},
      NOW,
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.to.include('grantedBy');
    expect(serialized).not.to.include('grantedAt');
    expect(prisma.collaborationPermission.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ grantedById: 'actor-001', grantedAt: NOW }),
      }),
    );
    const readArgs = prisma.collaboration.findUniqueOrThrow.mock.calls[0]?.[0] as {
      select: unknown;
    };
    expect(JSON.stringify(readArgs.select)).not.to.include('grantedBy');
  });
});
```

- [x] **Step 2: Verificar el rojo por no-vacuidad**

Romper temporalmente `toCollaboratorDetail` (`delegation.service.ts:121`) y `toCollaboratorListDetail` (`:139`) agregando `grantedById: 'leak',` y `grantedAt: new Date(),` al objeto retornado (con `as CollaboratorDetail`/`as CollaboratorListDetail` si TypeScript se queja).

Run: `pnpm exec vitest run src/modules/authorization/delegation.service.test.ts`
Expected: FAIL en los 4 tests nuevos (el JSON incluye `grantedBy`/`grantedAt`). Restaurar el codigo.

- [x] **Step 3: Verificar el verde**

Run: `pnpm exec vitest run src/modules/authorization/delegation.service.test.ts`
Expected: PASS (63 pruebas previas + 4 = 67).

- [x] **Step 4: Formato del archivo**

Run: `pnpm exec prettier --write src/modules/authorization/delegation.service.test.ts`

---

### Task 2: Caracterizacion de auditoria en permisos propios (servicio)

**Files:**

- Modify: `src/modules/authorization/authorization.service.test.ts` (test dentro del `describe('authorization service')`, que cierra en la linea 479)

- [x] **Step 1: Escribir la prueba que falla**

Insertar despues del test `marks every own permission as local in a program scope` (linea ~455):

```ts
it('never exposes audit fields in the own permissions response', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1' });
  const auditedGrant = {
    ...grant(PERMISSIONS.ACTIVITY_READ),
    grantedById: 'actor-001',
    grantedAt: new Date('2026-09-19T10:00:00.000Z'),
  };
  prisma.collaboration.findMany.mockResolvedValue([collaboration(auditedGrant)]);
  const { listOwnPermissions } = await loadService(prisma);

  const result = await listOwnPermissions(buildUser(), { type: 'program', id: 'p1' }, NOW);

  const serialized = JSON.stringify(result);
  expect(serialized).not.to.include('grantedBy');
  expect(serialized).not.to.include('grantedAt');
  expect(serialized).not.to.include('source');
  const args = prisma.collaboration.findMany.mock.calls[0]?.[0] as { select: unknown };
  expect(JSON.stringify(args.select)).not.to.include('grantedBy');
  expect(JSON.stringify(args.select)).not.to.include('grantedAt');
});
```

- [x] **Step 2: Verificar el rojo por no-vacuidad**

Romper temporalmente el map de `listOwnPermissions` (`authorization.service.ts:284`) agregando `grantedById: 'leak',` al objeto.

Run: `pnpm exec vitest run src/modules/authorization/authorization.service.test.ts`
Expected: FAIL en el test nuevo. Restaurar el codigo.

- [x] **Step 3: Verificar el verde**

Run: `pnpm exec vitest run src/modules/authorization/authorization.service.test.ts`
Expected: PASS (24 pruebas previas + 1 = 25).

---

### Task 3: Pruebas de ruta HTTP sin auditoria

**Files:**

- Modify: `src/modules/authorization/authorization.routes.test.ts`

- [x] **Step 1: Extender el mock Prisma y agregar el loader de delegacion real**

Ampliar `PrismaMock`/`createPrismaMock` con `$transaction`, `permission.findMany`, `collaboration.findFirst/create/findUniqueOrThrow/update`, `collaborationPermission.upsert/createMany` y `activity.findUnique`; `$transaction` ejecuta el callback con el propio mock. Agregar un loader nuevo que **no** mockee `./delegation.service.js` ni `./authorization.service.js`:

```ts
const loadAppWithRealDelegation = async (prisma = createPrismaMock()) => {
  process.env['NODE_ENV'] = 'test';
  process.env['AUTH_SECRET'] = 'a'.repeat(32);
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
  process.env['AUTH_URL'] = 'http://localhost:3000';
  vi.resetModules();
  vi.doMock('../../config/prisma.js', () => ({ getPrismaClient: () => prisma }));
  vi.doMock('../../utils/jwt-verifier.js', () => ({
    getJwtVerifier: () => ({
      verify: async (token: string) => ({ sub: token }),
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

  const { app } = await import('../../app.js');
  return app;
};
```

Se necesita importar `ROLE_DEFAULTS` desde `./permissions.js`.

- [x] **Step 2: Escribir las pruebas que fallan**

Dos tests dentro de `describe('collaborator routes')`:

```ts
it('does not expose audit fields in the own permissions response', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(userRecord);
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'program-001' });
  prisma.collaboration.findMany.mockResolvedValue([
    {
      eventProgramId: 'program-001',
      activityId: null,
      permissions: [
        {
          validFrom: null,
          validUntil: null,
          grantedById: 'actor-001',
          grantedAt: new Date('2026-09-19T10:00:00.000Z'),
          permission: { name: 'activity:read' },
        },
      ],
    },
  ]);
  const app = await loadAppWithRealAuthorization(service, prisma);

  const response = await request(app)
    .get('/api/v1/users/me/permissions?scope=program&id=program-001')
    .set('Authorization', 'Bearer user-001')
    .expect(200);

  expect(response.body.data.permissions).toEqual([
    { name: 'activity:read', origin: 'LOCAL', validFrom: null, validUntil: null },
  ]);
  const serialized = JSON.stringify(response.body);
  expect(serialized).not.to.include('grantedBy');
  expect(serialized).not.to.include('grantedAt');
});

it('does not expose audit fields in the collaborator creation response', async () => {
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(userRecord);
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'program-001', status: 'ACTIVE' });
  prisma.collaboration.findFirst.mockResolvedValue(null);
  prisma.permission.findMany.mockResolvedValue(
    ROLE_DEFAULTS.VIEWER.map((name, index) => ({ id: `perm-${index}`, name })),
  );
  prisma.collaboration.create.mockResolvedValue({
    userId: 'user-002',
    role: 'VIEWER',
    createdAt: new Date('2026-09-19T12:00:00.000Z'),
    eventProgramId: 'program-001',
    activityId: null,
    grantedById: 'actor-001',
    grantedAt: new Date('2026-09-19T12:00:00.000Z'),
    user: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    permissions: [
      {
        source: 'ROLE_DEFAULT',
        validFrom: null,
        validUntil: null,
        grantedById: 'actor-001',
        grantedAt: new Date('2026-09-19T12:00:00.000Z'),
        permission: { name: 'activity:read' },
      },
    ],
  });
  const app = await loadAppWithRealDelegation(prisma);

  const response = await request(app)
    .post('/api/v1/event-programs/program-001/collaborators')
    .set('Authorization', 'Bearer user-001')
    .send({ userId: 'user-002', role: 'VIEWER' })
    .expect(201);

  expect(response.body.data).toEqual({
    userId: 'user-002',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    role: 'VIEWER',
    createdAt: '2026-09-19T12:00:00.000Z',
    permissions: [
      { name: 'activity:read', source: 'ROLE_DEFAULT', validFrom: null, validUntil: null },
    ],
  });
  const serialized = JSON.stringify(response.body);
  expect(serialized).not.to.include('grantedBy');
  expect(serialized).not.to.include('grantedAt');
});
```

- [x] **Step 3: Verificar el rojo por no-vacuidad**

Con el `grantedById: 'leak'` temporal de Task 1 en `toCollaboratorDetail`, el segundo test debe fallar. Restaurar.

- [x] **Step 4: Verificar el verde**

Run: `pnpm exec vitest run src/modules/authorization/authorization.routes.test.ts`
Expected: PASS (53 pruebas previas + 2 = 55).

---

### Task 4: Descripciones OpenAPI y regeneracion

**Files:**

- Modify: `src/modules/authorization/authorization.openapi.ts`
- Modify: `openapi.json` (regenerado)

- [x] **Step 1: Agregar la nota de auditoria**

Anexar `Audit fields (\`grantedById\`, \`grantedAt\`) are never returned.`a`addDescription`, `updateDescription`, `grantDescription`y`ownPermissionsDescription`(el`listDescription` ya la tiene).

- [x] **Step 2: Regenerar y verificar**

Run: `pnpm run docs:generate && pnpm run docs:check`
Expected: `openapi.json` cambia solo en las descripciones; `docs:check` en verde.

---

### Task 5: Assertions Bruno en My_Permissions

**Files:**

- Modify: `bruno/My_Permissions/Get my permissions in a program.bru`
- Modify: `bruno/My_Permissions/Get my permissions in an activity.bru`

- [x] **Step 1: Agregar el test de ausencia de auditoria**

En cada archivo, dentro de `tests { ... }`:

```js
test('the response does not expose delegation audit fields', function () {
  const serialized = JSON.stringify(res.getBody());
  expect(serialized).to.not.include('grantedById');
  expect(serialized).to.not.include('grantedAt');
});
```

- [x] **Step 2: Ejecutar la coleccion**

Run: `pnpm --dir bruno exec bru run My_Permissions --env local`
Expected: 6/6 requests y 9/9 tests.

Run: `pnpm --dir bruno exec bru run Collaborators --env local`
Expected: 60/60 requests y 63/63 tests.

---

### Task 6: Verificacion E2E real (Docker + psql)

- [x] **Step 1: Baseline**

```bash
docker compose -f compose.dev.yaml ps
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg_utp -c \
"SELECT (SELECT count(*) FROM collaborations) AS collaborations, (SELECT count(*) FROM collaboration_permissions) AS permissions;"
```

- [x] **Step 2: Elegir un objetivo semilla libre en `seed_program_congreso-cit`**

```bash
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg_utp -c \
"SELECT user_id FROM collaborations WHERE event_program_id = 'seed_program_congreso-cit';"
```

Usar `seed_user_editor` o `seed_user_visor` (el que no aparezca).

- [x] **Step 3: Ciclo E2E con un script temporal en `/tmp/opencode` (sin loguear tokens ni passwords)**

Login admin (`admin@utp.ac.pa` / `Sipeg2026*UTP`) y luego:

1. `POST /api/v1/event-programs/seed_program_congreso-cit/collaborators` `{ userId, role: 'VIEWER' }` -> 201; el JSON no incluye `grantedById`/`grantedAt`.
2. psql: las filas del colaborador tienen `granted_by_id` no nulo y `granted_at` no nulo.
3. `POST /api/v1/event-programs/seed_program_congreso-cit/permissions` `{ userId, permission: 'report:view' }` -> 200; JSON sin auditoria; psql con `granted_at` no nulo en la fila `OVERRIDE`.
4. `PATCH /api/v1/event-programs/seed_program_congreso-cit/collaborators/{userId}` `{ role: 'EDITOR' }` -> 200; JSON sin auditoria.
5. Login del objetivo; `GET /api/v1/users/me/permissions?scope=program&id=seed_program_congreso-cit` -> 200 y sin auditoria.
6. `DELETE /api/v1/event-programs/seed_program_congreso-cit/collaborators/{userId}` -> 204.

- [x] **Step 4: Limpieza y conteos**

psql: colaboraciones del objetivo en 0; `collaborations` y `collaboration_permissions` iguales al baseline. Eliminar el script temporal. Revisar `docker compose -f compose.dev.yaml logs api --since 10m` sin errores ni fugas de tokens.

---

### Task 7: Documentacion, plan maestro y gates

**Files:**

- Modify: `README.md`, `CONTEXT.md`, `AGENTS.md`
- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [x] **Step 1: Documentar la regla uniforme**

README (`### Colaboradores Por Scope`, bullet de respuesta): aclarar que ninguna respuesta del modulo (listados, mutaciones y permisos propios) expone `grantedById`/`grantedAt`; son columnas internas de auditoria. CONTEXT: anadir la misma nota general. AGENTS (seccion de autorizacion): cambiar "No exponer estos campos internos innecesariamente." por "Estos campos son auditoria interna y no se exponen en ninguna respuesta HTTP."

- [x] **Step 2: Marcar 3.10 y registrar la ejecucion**

Marcar `[x] **3.10 ...**`, actualizar la fila de estado de la tabla (quitar "falta 3.10") y agregar el registro con pruebas, E2E, contrato y gates.

- [x] **Step 3: Gates finales**

Run: `pnpm test`
Run: `pnpm run typecheck`
Run: `pnpm run lint`
Run: `pnpm run build`
Run: `pnpm run docs:generate && pnpm run docs:check`
Run: `pnpm run format:check` (documentar archivos ajenos si los hay)

- [x] **Step 4: Cierre** sin commit salvo solicitud explicita.
