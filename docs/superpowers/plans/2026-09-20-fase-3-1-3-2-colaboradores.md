# Fase 3.1 y 3.2 - API de colaboradores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Exponer `GET` y `POST` de colaboradores por scope (`/event-programs/:id/collaborators` y `/activities/:id/collaborators`) sobre los servicios de delegación existentes, con `permission:grant`, materialización de `ROLE_DEFAULT`, subconjunto simétrico y rechazo de programas archivados.

**Architecture:** Se extiende `src/modules/authorization/` con la superficie HTTP (`authorization.routes.ts`, `authorization.controller.ts`, `authorization.schemas.ts`, `authorization.openapi.ts`) y con `listCollaborators` en `delegation.service.ts`. Las rutas siguen `authenticate -> requirePermission(PERMISSION_GRANT, resolver) -> validate -> controlador -> servicio`; los controladores no tocan Prisma. El DTO expone identidad, rol y permisos locales; no expone `grantedById`/`grantedAt` (diferido a 3.10). Sin migraciones, variables de entorno ni cambios de catálogo.

**Tech Stack:** TypeScript 6, Express 5, Prisma 7 (SQL/Postgres), Zod 4, Vitest, Supertest, OpenAPI 3.1 (zod-openapi), Bruno.

**Hallazgos de partida (2026-09-20):**

- `delegation.service.ts` ya implementa `addCollaborator`, `updateCollaboratorRole`, `removeCollaborator`, `grantPermission` y `revokePermission` con los invariantes de subconjunto y atenuación; no tiene lectura.
- `resolveScope` valida la existencia de la actividad, pero no la del programa; `addCollaborator` a un programa inexistente produce un error de FK (500) en vez de 404.
- El seed demo tiene el escenario ideal para E2E: `seed_user_org-fisc` es `ORGANIZER` en `seed_program_congreso-cit` con un `OVERRIDE` vigente de `permission:grant` (ventana 0..+60 días), y `seed_user_editor` colabora en `seed_activity_fisc-charla-ia` y en `seed_program_fisc_default`.
- Baseline: `pnpm test` 628 pruebas en 41 archivos en verde (rama `dev`).

**Decisiones confirmadas (2026-09-20):**

1. Se extiende `src/modules/authorization/` (sin módulo nuevo).
2. `GET` devuelve `userId`, `firstName`, `lastName`, `email`, `role`, `createdAt` y `permissions` locales (`name`, `source`, `validFrom`, `validUntil`).
3. El listado de una actividad devuelve solo colaboraciones locales del scope; la procedencia `inherited`/`local`/`effective` llega en 3.8.
4. `POST` a un scope cuyo programa está `ARCHIVED` responde `409 Archived event programs cannot be modified.`; `GET` sigue permitido.

**Reglas de negocio:**

- `permission:grant` en el scope es obligatorio para listar y agregar; `ADMIN` hace bypass total.
- El actor no puede asignar un rol cuyos defaults no posea (`403 Cannot assign a role that exceeds your own permissions.`).
- `addCollaborator` materializa `ROLE_DEFAULT` con `grantedById = actor.id`; duplicado en el scope `409`; usuario inexistente `404`; usuario inactivo `400`.
- Los permisos de rol fuera del catálogo se descartan del DTO (mismo criterio que el resolutor).
- La fecha del DTO es ISO 8601 completa (`toISOString()`), no recortada a `YYYY-MM-DD`.

---

### Task 1: Servicio de dominio - DTO, listado y guarda de archivado (TDD)

**Files:**

- Modify: `src/modules/authorization/authorization.types.ts`
- Modify: `src/modules/authorization/delegation.service.ts`
- Test: `src/modules/authorization/delegation.service.test.ts`

- [x] **Step 1: Agregar los DTOs**

En `src/modules/authorization/authorization.types.ts`, reemplazar el contenido por:

```ts
import type { CollaborationRole, PermissionGrantSource } from '../../generated/prisma/enums.js';
import type { PermissionName } from './permissions.js';

export interface AuthorizationScope {
  eventProgramId?: string;
  activityId?: string;
}

export interface ResolvedScope {
  eventProgramId: string;
  activityId?: string;
}

export interface GrantEnvelope {
  validFrom: Date | null;
  validUntil: Date | null;
}

export interface CollaboratorPermissionDetail {
  name: PermissionName;
  source: PermissionGrantSource;
  validFrom: string | null;
  validUntil: string | null;
}

export interface CollaboratorDetail {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: CollaborationRole;
  createdAt: string;
  permissions: CollaboratorPermissionDetail[];
}

export interface CollaboratorList {
  items: CollaboratorDetail[];
}
```

- [x] **Step 2: Escribir las pruebas que fallan**

En `src/modules/authorization/delegation.service.test.ts`:

a) Agregar `eventProgram` al mock de Prisma:

```ts
interface PrismaMock {
  collaboration: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  collaborationPermission: {
    upsert: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
  };
  activity: { findUnique: ReturnType<typeof vi.fn> };
  eventProgram: { findUnique: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
  permission: { findMany: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
}
```

Dentro de `createPrismaMock()` agregar `eventProgram: { findUnique: vi.fn() },`.

b) Agregar el helper después de `collaboration()`:

```ts
const collaboratorRecord = (overrides: Record<string, unknown> = {}) => ({
  userId: 'user-002',
  role: 'VIEWER',
  createdAt: new Date('2026-09-19T12:00:00.000Z'),
  user: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
  permissions: [
    {
      source: 'ROLE_DEFAULT',
      validFrom: null,
      validUntil: null,
      permission: { name: PERMISSIONS.ACTIVITY_READ },
    },
  ],
  ...overrides,
});
```

c) Agregar las pruebas nuevas al final del `describe('delegation service')`:

```ts
it('rejects listing collaborators without permission:grant', async () => {
  const prisma = createPrismaMock();
  prisma.collaboration.findMany.mockResolvedValue([collaboration(grant(PERMISSIONS.PROGRAM_READ))]);
  const { listCollaborators } = await loadService(prisma);

  await expect(listCollaborators(buildUser(), { eventProgramId: 'p1' }, NOW)).rejects.toMatchObject(
    { statusCode: 403 },
  );
  expect(prisma.collaboration.findMany).toHaveBeenCalledTimes(1);
});

it('returns 404 when listing a missing event program', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue(null);
  const { listCollaborators } = await loadService(prisma);

  await expect(
    listCollaborators(buildUser({ globalRole: 'ADMIN' }), { eventProgramId: 'missing' }, NOW),
  ).rejects.toMatchObject({ statusCode: 404 });
  expect(prisma.collaboration.findMany).not.toHaveBeenCalled();
});

it('lists the local collaborators of a program with their grants sorted by name', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
  prisma.collaboration.findMany.mockResolvedValue([
    collaboratorRecord({
      permissions: [
        {
          source: 'OVERRIDE',
          validFrom: new Date('2026-09-19T10:00:00.000Z'),
          validUntil: new Date('2026-09-30T10:00:00.000Z'),
          permission: { name: PERMISSIONS.REPORT_EXPORT },
        },
        {
          source: 'ROLE_DEFAULT',
          validFrom: null,
          validUntil: null,
          permission: { name: PERMISSIONS.ACTIVITY_READ },
        },
        {
          source: 'ROLE_DEFAULT',
          validFrom: null,
          validUntil: null,
          permission: { name: 'legacy:unknown' },
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

  expect(prisma.collaboration.findMany).toHaveBeenCalledWith({
    where: { eventProgramId: 'p1' },
    orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
    select: expect.any(Object),
  });
  expect(result).toEqual({
    items: [
      {
        userId: 'user-002',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        role: 'VIEWER',
        createdAt: '2026-09-19T12:00:00.000Z',
        permissions: [
          {
            name: PERMISSIONS.ACTIVITY_READ,
            source: 'ROLE_DEFAULT',
            validFrom: null,
            validUntil: null,
          },
          {
            name: PERMISSIONS.REPORT_EXPORT,
            source: 'OVERRIDE',
            validFrom: '2026-09-19T10:00:00.000Z',
            validUntil: '2026-09-30T10:00:00.000Z',
          },
        ],
      },
    ],
  });
  expect(JSON.stringify(result)).not.toInclude('grantedById');
  expect(JSON.stringify(result)).not.toInclude('grantedAt');
});

it('lists activity-local collaborators using the activity scope', async () => {
  const prisma = createPrismaMock();
  prisma.activity.findUnique.mockResolvedValue({ eventProgramId: 'p1' });
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
  prisma.collaboration.findMany.mockResolvedValue([]);
  const { listCollaborators } = await loadService(prisma);

  const result = await listCollaborators(
    buildUser({ globalRole: 'ADMIN' }),
    { activityId: 'a1' },
    NOW,
  );

  expect(result).toEqual({ items: [] });
  expect(prisma.collaboration.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { activityId: 'a1' } }),
  );
});

it('returns 404 when adding a collaborator to a missing event program', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue(null);
  const { addCollaborator } = await loadService(prisma);

  await expect(
    addCollaborator(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'missing' },
      'user-002',
      'VIEWER',
      NOW,
    ),
  ).rejects.toMatchObject({ statusCode: 404 });
  expect(prisma.collaboration.create).not.toHaveBeenCalled();
});

it('rejects adding collaborators to an archived event program', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ARCHIVED' });
  const { addCollaborator } = await loadService(prisma);

  await expect(
    addCollaborator(
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
  expect(prisma.collaboration.create).not.toHaveBeenCalled();
});

it('returns the created collaborator as a DTO', async () => {
  const prisma = createPrismaMock();
  prisma.permission.findMany.mockResolvedValue(permissionRecords(ROLE_DEFAULTS.VIEWER));
  prisma.user.findUnique.mockResolvedValue({ id: 'user-002', isActive: true });
  prisma.collaboration.findFirst.mockResolvedValue(null);
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
  prisma.collaboration.create.mockResolvedValue(collaboratorRecord());
  const { addCollaborator } = await loadService(prisma);

  const result = await addCollaborator(
    buildUser({ globalRole: 'ADMIN' }),
    { eventProgramId: 'p1' },
    'user-002',
    'VIEWER',
    NOW,
  );

  expect(result).toEqual({
    userId: 'user-002',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    role: 'VIEWER',
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

- [x] **Step 3: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/authorization/delegation.service.test.ts`
Expected: FAIL porque `listCollaborators` no existe y los tests de `addCollaborator` siguen con la implementación anterior.

- [x] **Step 4: Implementar el DTO y la lectura**

En `src/modules/authorization/delegation.service.ts`:

a) Reemplazar el bloque de imports por:

```ts
import { getPrismaClient } from '../../config/prisma.js';
import type {
  CollaborationRole,
  PermissionGrantSource,
  ProgramStatus,
} from '../../generated/prisma/enums.js';
import { ApiError } from '../../utils/ApiError.js';
import { getPermissionEnvelopes, resolveScope } from './authorization.service.js';
import type {
  AuthorizationScope,
  CollaboratorDetail,
  CollaboratorList,
  GrantEnvelope,
  ResolvedScope,
} from './authorization.types.js';
import {
  PERMISSIONS,
  PERMISSION_NAMES,
  ROLE_DEFAULTS,
  type PermissionName,
} from './permissions.js';
```

b) Después de `scopeWhere`, agregar:

```ts
const collaboratorSelect = {
  userId: true,
  role: true,
  createdAt: true,
  user: { select: { firstName: true, lastName: true, email: true } },
  permissions: {
    select: {
      source: true,
      validFrom: true,
      validUntil: true,
      permission: { select: { name: true } },
    },
  },
} as const;

interface CollaboratorRecord {
  userId: string;
  role: CollaborationRole;
  createdAt: Date;
  user: { firstName: string; lastName: string; email: string };
  permissions: {
    source: PermissionGrantSource;
    validFrom: Date | null;
    validUntil: Date | null;
    permission: { name: string };
  }[];
}

const toCollaboratorDetail = (record: CollaboratorRecord): CollaboratorDetail => ({
  userId: record.userId,
  firstName: record.user.firstName,
  lastName: record.user.lastName,
  email: record.user.email,
  role: record.role,
  createdAt: record.createdAt.toISOString(),
  permissions: [...record.permissions]
    .filter((row) => PERMISSION_NAMES.includes(row.permission.name as PermissionName))
    .sort((first, second) => first.permission.name.localeCompare(second.permission.name))
    .map((row) => ({
      name: row.permission.name as PermissionName,
      source: row.source,
      validFrom: row.validFrom ? row.validFrom.toISOString() : null,
      validUntil: row.validUntil ? row.validUntil.toISOString() : null,
    })),
});

const loadScopeProgram = async (
  resolved: ResolvedScope,
): Promise<{ id: string; status: ProgramStatus }> => {
  const program = await getPrismaClient().eventProgram.findUnique({
    where: { id: resolved.eventProgramId },
    select: { id: true, status: true },
  });

  if (!program) {
    throw new ApiError(404, 'Event program not found.');
  }

  return program;
};
```

c) Agregar `listCollaborators` antes de `addCollaborator`:

```ts
export const listCollaborators = async (
  actor: Express.AuthenticatedUser,
  scope: AuthorizationScope,
  now: Date = new Date(),
): Promise<CollaboratorList> => {
  await assertActorCanDelegate(actor, scope, now);

  const resolved = await resolveScope(scope);
  await loadScopeProgram(resolved);

  const records = await getPrismaClient().collaboration.findMany({
    where: scopeWhere(resolved),
    orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
    select: collaboratorSelect,
  });

  return { items: records.map(toCollaboratorDetail) };
};
```

d) En `addCollaborator`, cambiar la firma a `Promise<CollaboratorDetail>`, agregar la guarda de archivado y retornar el DTO:

```ts
export const addCollaborator = async (
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

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, isActive: true },
  });

  if (!target) {
    throw new ApiError(404, 'User not found.');
  }

  if (!target.isActive) {
    throw new ApiError(400, 'User is not active.');
  }

  const existing = await prisma.collaboration.findFirst({
    where: { userId: targetUserId, ...scopeWhere(resolved) },
    select: { id: true },
  });

  if (existing) {
    throw new ApiError(409, 'User already collaborates in this scope.');
  }

  const permissionIds = await loadPermissionIds(ROLE_DEFAULTS[role]);

  const created = await prisma.$transaction((tx) =>
    tx.collaboration.create({
      data: {
        role,
        eventProgramId: resolved.activityId ? null : resolved.eventProgramId,
        activityId: resolved.activityId ?? null,
        userId: targetUserId,
        permissions: {
          create: ROLE_DEFAULTS[role].map((name) => ({
            permissionId: permissionIds.get(name) as string,
            source: 'ROLE_DEFAULT',
            grantedById: actor.id,
          })),
        },
      },
      select: collaboratorSelect,
    }),
  );

  return toCollaboratorDetail(created);
};
```

- [x] **Step 5: Actualizar los mocks existentes de `addCollaborator`**

En `src/modules/authorization/delegation.service.test.ts`:

- En `creates the collaboration and materializes ROLE_DEFAULT rows`, agregar `prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });` y reemplazar `prisma.collaboration.create.mockResolvedValue({ id: 'collab-001' });` por `prisma.collaboration.create.mockResolvedValue(collaboratorRecord());`.
- En `rejects adding a collaborator that already exists in the scope`, agregar `prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });`.
- En `rejects adding an inactive user`, agregar `prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });`.

- [x] **Step 6: Verificar el verde**

Run: `pnpm exec vitest run src/modules/authorization/delegation.service.test.ts`
Expected: PASS (todas las pruebas del archivo).

---

### Task 2: Esquemas Zod (TDD)

**Files:**

- Create: `src/modules/authorization/authorization.schemas.ts`
- Test: `src/modules/authorization/authorization.schemas.test.ts`

- [x] **Step 1: Escribir la prueba que falla**

Crear `src/modules/authorization/authorization.schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { addCollaboratorSchema, collaboratorParamsSchema } from './authorization.schemas.js';

describe('collaborator request schemas', () => {
  it('trims the scope identifier', () => {
    const parsed = collaboratorParamsSchema.parse({ params: { id: '  program-001  ' } });

    expect(parsed.params.id).toBe('program-001');
  });

  it('rejects a blank scope identifier', () => {
    expect(() => collaboratorParamsSchema.parse({ params: { id: '   ' } })).toThrow();
  });

  it('rejects a scope identifier longer than 100 characters', () => {
    expect(() => collaboratorParamsSchema.parse({ params: { id: 'a'.repeat(101) } })).toThrow();
  });

  it('parses a collaborator payload with a known role', () => {
    const parsed = addCollaboratorSchema.parse({
      params: { id: 'program-001' },
      body: { userId: ' user-002 ', role: 'EDITOR' },
    });

    expect(parsed.body).toEqual({ userId: 'user-002', role: 'EDITOR' });
  });

  it('rejects an unknown role', () => {
    expect(() =>
      addCollaboratorSchema.parse({
        params: { id: 'p1' },
        body: { userId: 'user-002', role: 'OWNER' },
      }),
    ).toThrow();
  });

  it('rejects a missing user', () => {
    expect(() =>
      addCollaboratorSchema.parse({ params: { id: 'p1' }, body: { role: 'VIEWER' } }),
    ).toThrow();
  });

  it('rejects unknown body keys', () => {
    expect(() =>
      addCollaboratorSchema.parse({
        params: { id: 'p1' },
        body: { userId: 'user-002', role: 'VIEWER', permissions: ['activity:read'] },
      }),
    ).toThrow();
  });
});
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/authorization/authorization.schemas.test.ts`
Expected: FAIL — no existe `./authorization.schemas.js`.

- [x] **Step 3: Implementar los esquemas**

Crear `src/modules/authorization/authorization.schemas.ts`:

```ts
import { z } from 'zod';

import type { CollaboratorDetail, CollaboratorList } from './authorization.types.js';

const scopeIdSchema = z
  .string()
  .trim()
  .min(1, 'Event program or activity id is required.')
  .max(100, 'Identifier cannot exceed 100 characters.');

export const collaboratorParamsSchema = z.object({
  params: z.object({ id: scopeIdSchema }),
});

export const addCollaboratorSchema = z.object({
  params: z.object({ id: scopeIdSchema }),
  body: z
    .object({
      userId: z
        .string()
        .trim()
        .min(1, 'User is required.')
        .max(100, 'User identifier cannot exceed 100 characters.'),
      role: z.enum(['VIEWER', 'EDITOR', 'ORGANIZER'], 'Role is invalid.'),
    })
    .strict(),
});

export type AddCollaboratorBody = z.infer<typeof addCollaboratorSchema>['body'];

const collaboratorPermissionSchema = z
  .object({
    name: z.string(),
    source: z.enum(['ROLE_DEFAULT', 'OVERRIDE']),
    validFrom: z
      .string()
      .nullable()
      .meta({ description: 'ISO 8601 instant when the grant starts, or null when unbounded.' }),
    validUntil: z
      .string()
      .nullable()
      .meta({ description: 'ISO 8601 instant when the grant ends, or null when unbounded.' }),
  })
  .meta({
    id: 'CollaboratorPermission',
    description: 'Local permission grant materialized on a collaborator.',
  });

export const collaboratorSchema = z
  .object({
    userId: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    role: z.enum(['VIEWER', 'EDITOR', 'ORGANIZER']),
    createdAt: z.string().meta({ description: 'ISO 8601 instant when the collaboration started.' }),
    permissions: z.array(collaboratorPermissionSchema),
  })
  .meta({
    id: 'Collaborator',
    description: 'Local collaborator of an event program or activity with its permission grants.',
  }) satisfies z.ZodType<CollaboratorDetail>;

export const collaboratorListSchema = z.object({ items: z.array(collaboratorSchema) }).meta({
  id: 'CollaboratorList',
  description: 'Local collaborators of an event program or activity scope.',
}) satisfies z.ZodType<CollaboratorList>;
```

- [x] **Step 4: Verificar el verde**

Run: `pnpm exec vitest run src/modules/authorization/authorization.schemas.test.ts`
Expected: PASS.

---

### Task 3: Controlador, rutas y montaje (TDD)

**Files:**

- Create: `src/modules/authorization/authorization.controller.ts`
- Create: `src/modules/authorization/authorization.routes.ts`
- Test: `src/modules/authorization/authorization.routes.test.ts`
- Modify: `src/routes.ts`

- [x] **Step 1: Escribir la prueba que falla**

Crear `src/modules/authorization/authorization.routes.test.ts`:

```ts
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface DelegationServiceMock {
  addCollaborator: ReturnType<typeof vi.fn>;
  listCollaborators: ReturnType<typeof vi.fn>;
}

const buildServiceMock = (): DelegationServiceMock => ({
  addCollaborator: vi.fn(),
  listCollaborators: vi.fn(),
});

interface PrismaMock {
  user: { findUnique: ReturnType<typeof vi.fn> };
}

const createPrismaMock = (): PrismaMock => ({ user: { findUnique: vi.fn() } });

const adminRecord = {
  id: 'admin-001',
  email: 'admin@example.com',
  globalRole: 'ADMIN',
  unitId: null,
  careerId: null,
  isActive: true,
};

const userRecord = { ...adminRecord, id: 'user-001', globalRole: 'USER' };

const collaboratorDetail = {
  userId: 'user-002',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  role: 'VIEWER',
  createdAt: '2026-09-19T12:00:00.000Z',
  permissions: [
    {
      name: 'activity:read',
      source: 'ROLE_DEFAULT',
      validFrom: null,
      validUntil: null,
    },
  ],
};

const addBody = { userId: 'user-002', role: 'VIEWER' };

const loadApp = async (
  service: DelegationServiceMock,
  prisma = createPrismaMock(),
  permissions: string[] = [],
  getEffectivePermissions = vi.fn(),
) => {
  getEffectivePermissions.mockResolvedValue(new Set(permissions));
  process.env['NODE_ENV'] = 'test';
  process.env['AUTH_SECRET'] = 'a'.repeat(32);
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
  process.env['AUTH_URL'] = 'http://localhost:3000';
  vi.resetModules();
  vi.doMock('./delegation.service.js', () => service);
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
  vi.doMock('./authorization.service.js', () => ({ getEffectivePermissions }));

  const { app } = await import('../../app.js');
  return app;
};

describe('collaborator routes', () => {
  afterEach(() => {
    vi.doUnmock('./delegation.service.js');
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../../utils/jwt-verifier.js');
    vi.doUnmock('../../lib/auth.js');
    vi.doUnmock('./authorization.service.js');
  });

  it('rejects listing collaborators without a token', async () => {
    const service = buildServiceMock();
    const app = await loadApp(service);

    await request(app).get('/api/v1/event-programs/program-001/collaborators').expect(401);
    expect(service.listCollaborators).not.toHaveBeenCalled();
  });

  it('rejects listing collaborators without permission:grant in the scope', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const app = await loadApp(service, prisma, ['activity:read']);

    await request(app)
      .get('/api/v1/event-programs/program-001/collaborators')
      .set('Authorization', 'Bearer user-001')
      .expect(403);
    expect(service.listCollaborators).not.toHaveBeenCalled();
  });

  it('lists event program collaborators for a permission:grant holder', async () => {
    const service = buildServiceMock();
    service.listCollaborators.mockResolvedValue({ items: [collaboratorDetail] });
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const getEffectivePermissions = vi.fn();
    const app = await loadApp(service, prisma, ['permission:grant'], getEffectivePermissions);

    const response = await request(app)
      .get('/api/v1/event-programs/program-001/collaborators')
      .set('Authorization', 'Bearer user-001')
      .expect(200);

    expect(getEffectivePermissions).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-001' }),
      { eventProgramId: 'program-001' },
    );
    expect(service.listCollaborators).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-001' }),
      { eventProgramId: 'program-001' },
    );
    expect(response.body).toEqual({
      success: true,
      message: 'Collaborators retrieved successfully.',
      data: { items: [collaboratorDetail] },
    });
  });

  it('resolves the activity scope when listing activity collaborators', async () => {
    const service = buildServiceMock();
    service.listCollaborators.mockResolvedValue({ items: [] });
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const getEffectivePermissions = vi.fn();
    const app = await loadApp(service, prisma, ['permission:grant'], getEffectivePermissions);

    await request(app)
      .get('/api/v1/activities/activity-001/collaborators')
      .set('Authorization', 'Bearer user-001')
      .expect(200);

    expect(getEffectivePermissions).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-001' }),
      {
        activityId: 'activity-001',
      },
    );
  });

  it('propagates a missing scope as 404', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);
    const { ApiError } = await import('../../utils/ApiError.js');
    service.listCollaborators.mockRejectedValue(new ApiError(404, 'Event program not found.'));

    await request(app)
      .get('/api/v1/event-programs/missing/collaborators')
      .set('Authorization', 'Bearer admin-001')
      .expect(404);
  });

  it('adds a collaborator as ADMIN', async () => {
    const service = buildServiceMock();
    service.addCollaborator.mockResolvedValue(collaboratorDetail);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    const response = await request(app)
      .post('/api/v1/event-programs/program-001/collaborators')
      .set('Authorization', 'Bearer admin-001')
      .send(addBody)
      .expect(201);

    expect(service.addCollaborator).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin-001' }),
      { eventProgramId: 'program-001' },
      'user-002',
      'VIEWER',
    );
    expect(response.body).toEqual({
      success: true,
      message: 'Collaborator added successfully.',
      data: collaboratorDetail,
    });
  });

  it('adds an activity collaborator with the activity scope', async () => {
    const service = buildServiceMock();
    service.addCollaborator.mockResolvedValue(collaboratorDetail);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .post('/api/v1/activities/activity-001/collaborators')
      .set('Authorization', 'Bearer admin-001')
      .send(addBody)
      .expect(201);

    expect(service.addCollaborator).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin-001' }),
      { activityId: 'activity-001' },
      'user-002',
      'VIEWER',
    );
  });

  it('rejects adding a collaborator without a token', async () => {
    const service = buildServiceMock();
    const app = await loadApp(service);

    await request(app)
      .post('/api/v1/event-programs/program-001/collaborators')
      .send(addBody)
      .expect(401);
    expect(service.addCollaborator).not.toHaveBeenCalled();
  });

  it('rejects a non-admin without permission:grant', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const app = await loadApp(service, prisma, ['activity:read']);

    await request(app)
      .post('/api/v1/event-programs/program-001/collaborators')
      .set('Authorization', 'Bearer user-001')
      .send(addBody)
      .expect(403);
    expect(service.addCollaborator).not.toHaveBeenCalled();
  });

  it('rejects an invalid role before the service', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .post('/api/v1/event-programs/program-001/collaborators')
      .set('Authorization', 'Bearer admin-001')
      .send({ userId: 'user-002', role: 'OWNER' })
      .expect(400);
    expect(service.addCollaborator).not.toHaveBeenCalled();
  });

  it('rejects unknown body keys before the service', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);

    await request(app)
      .post('/api/v1/event-programs/program-001/collaborators')
      .set('Authorization', 'Bearer admin-001')
      .send({ ...addBody, validUntil: '2026-12-31T00:00:00.000Z' })
      .expect(400);
    expect(service.addCollaborator).not.toHaveBeenCalled();
  });

  it('propagates a conflicting collaborator as 409', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);
    const { ApiError } = await import('../../utils/ApiError.js');
    service.addCollaborator.mockRejectedValue(
      new ApiError(409, 'User already collaborates in this scope.'),
    );

    await request(app)
      .post('/api/v1/event-programs/program-001/collaborators')
      .set('Authorization', 'Bearer admin-001')
      .send(addBody)
      .expect(409);
  });

  it('propagates the role subset rejection as 403', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp(service, prisma);
    const { ApiError } = await import('../../utils/ApiError.js');
    service.addCollaborator.mockRejectedValue(
      new ApiError(403, 'Cannot assign a role that exceeds your own permissions.'),
    );

    await request(app)
      .post('/api/v1/activities/activity-001/collaborators')
      .set('Authorization', 'Bearer admin-001')
      .send({ userId: 'user-002', role: 'ORGANIZER' })
      .expect(403);
  });
});
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/authorization/authorization.routes.test.ts`
Expected: FAIL con 404 en las rutas porque no existen (el resto de aserciones no llegan a ejecutarse).

- [x] **Step 3: Implementar el controlador**

Crear `src/modules/authorization/authorization.controller.ts`:

```ts
import type { RequestHandler } from 'express';

import { requireAuthenticatedUser } from '../../middlewares/authenticate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { successResponse } from '../../utils/response.js';
import type { AddCollaboratorBody } from './authorization.schemas.js';
import {
  addCollaborator as addCollaboratorService,
  listCollaborators as listCollaboratorsService,
} from './delegation.service.js';

export const getEventProgramCollaborators: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const user = requireAuthenticatedUser(req);
  const result = await listCollaboratorsService(user, { eventProgramId: id });

  res.status(200).json(successResponse('Collaborators retrieved successfully.', result));
});

export const getActivityCollaborators: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const user = requireAuthenticatedUser(req);
  const result = await listCollaboratorsService(user, { activityId: id });

  res.status(200).json(successResponse('Collaborators retrieved successfully.', result));
});

export const addEventProgramCollaborator: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const body = req.body as AddCollaboratorBody;
  const user = requireAuthenticatedUser(req);
  const result = await addCollaboratorService(user, { eventProgramId: id }, body.userId, body.role);

  res.status(201).json(successResponse('Collaborator added successfully.', result));
});

export const addActivityCollaborator: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const body = req.body as AddCollaboratorBody;
  const user = requireAuthenticatedUser(req);
  const result = await addCollaboratorService(user, { activityId: id }, body.userId, body.role);

  res.status(201).json(successResponse('Collaborator added successfully.', result));
});
```

- [x] **Step 4: Implementar las rutas y montarlas**

Crear `src/modules/authorization/authorization.routes.ts`:

```ts
import { Router } from 'express';

import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { requirePermission, type ScopeResolver } from '../../middlewares/authorize.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import {
  addActivityCollaborator,
  addEventProgramCollaborator,
  getActivityCollaborators,
  getEventProgramCollaborators,
} from './authorization.controller.js';
import { addCollaboratorSchema, collaboratorParamsSchema } from './authorization.schemas.js';
import { PERMISSIONS } from './permissions.js';

const eventProgramScope: ScopeResolver = (req) => {
  const id = (req.params as { id?: string }).id;

  return typeof id === 'string' && id.length > 0 ? { eventProgramId: id } : undefined;
};

const activityScope: ScopeResolver = (req) => {
  const id = (req.params as { id?: string }).id;

  return typeof id === 'string' && id.length > 0 ? { activityId: id } : undefined;
};

export const authorizationRoutes = Router();

authorizationRoutes.get(
  '/event-programs/:id/collaborators',
  authenticate,
  requirePermission(PERMISSIONS.PERMISSION_GRANT, eventProgramScope),
  validate(collaboratorParamsSchema),
  getEventProgramCollaborators,
);

authorizationRoutes.post(
  '/event-programs/:id/collaborators',
  authenticate,
  requirePermission(PERMISSIONS.PERMISSION_GRANT, eventProgramScope),
  validate(addCollaboratorSchema),
  addEventProgramCollaborator,
);

authorizationRoutes.get(
  '/activities/:id/collaborators',
  authenticate,
  requirePermission(PERMISSIONS.PERMISSION_GRANT, activityScope),
  validate(collaboratorParamsSchema),
  getActivityCollaborators,
);

authorizationRoutes.post(
  '/activities/:id/collaborators',
  authenticate,
  requirePermission(PERMISSIONS.PERMISSION_GRANT, activityScope),
  validate(addCollaboratorSchema),
  addActivityCollaborator,
);
```

En `src/routes.ts`:

a) Agregar el import:

```ts
import { authorizationRoutes } from './modules/authorization/authorization.routes.js';
```

b) Montar el router antes de `activitiesRoutes`:

```ts
apiRoutes.use(authorizationRoutes);
```

- [x] **Step 5: Verificar el verde**

Run: `pnpm exec vitest run src/modules/authorization/authorization.routes.test.ts`
Expected: PASS.

- [x] **Step 6: Suite dirigida**

Run: `pnpm exec vitest run src/modules/authorization src/modules/event-programs src/modules/activities`
Expected: PASS sin regresiones.

---

### Task 4: OpenAPI (TDD)

**Files:**

- Create: `src/modules/authorization/authorization.openapi.ts`
- Modify: `src/docs/openapi.ts`
- Test: `src/docs/openapi.test.ts`
- Generate: `openapi.json`

- [x] **Step 1: Escribir la prueba de contrato que falla**

En `src/docs/openapi.test.ts`, agregar a `expectedOperations` (el arreglo se ordena solo):

```ts
  'GET /api/v1/activities/{id}/collaborators',
  'POST /api/v1/activities/{id}/collaborators',
  'GET /api/v1/event-programs/{id}/collaborators',
  'POST /api/v1/event-programs/{id}/collaborators',
```

Y agregar este test al `describe('openApiDocument')`:

```ts
it('documents collaborator delegation with bearer security and conflict responses', () => {
  const programPost = openApiDocument.paths?.['/api/v1/event-programs/{id}/collaborators']?.post;
  const programGet = openApiDocument.paths?.['/api/v1/event-programs/{id}/collaborators']?.get;
  const activityGet = openApiDocument.paths?.['/api/v1/activities/{id}/collaborators']?.get;

  expect(programPost?.security).toEqual([{ bearerAuth: [] }]);
  expect(programPost?.responses?.['201']).toBeDefined();
  expect(programPost?.responses?.['409']).toBeDefined();
  expect(programGet?.security).toEqual([{ bearerAuth: [] }]);
  expect(activityGet?.security).toEqual([{ bearerAuth: [] }]);
  expect(openApiDocument.components?.schemas).toHaveProperty('Collaborator');
  expect(openApiDocument.components?.schemas).toHaveProperty('CollaboratorPermission');
  expect(openApiDocument.components?.schemas).toHaveProperty('CollaboratorList');
});
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/docs/openapi.test.ts`
Expected: FAIL — las operaciones y componentes no están documentados.

- [x] **Step 3: Implementar las rutas OpenAPI**

Crear `src/modules/authorization/authorization.openapi.ts`:

```ts
import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { apiErrorResponseSchema, apiSuccessResponse } from '../../docs/schemas.js';
import {
  addCollaboratorSchema,
  collaboratorListSchema,
  collaboratorParamsSchema,
  collaboratorSchema,
} from './authorization.schemas.js';

const errorResponse = {
  description: 'Error response.',
  content: { 'application/json': { schema: apiErrorResponseSchema } },
} as const;

const listResponses = {
  200: {
    description: 'Local collaborators of the scope.',
    content: { 'application/json': { schema: apiSuccessResponse(collaboratorListSchema) } },
  },
  400: errorResponse,
  401: errorResponse,
  403: errorResponse,
  404: errorResponse,
} as const;

const addResponses = {
  201: {
    description: 'Collaborator added to the scope with its role defaults materialized.',
    content: { 'application/json': { schema: apiSuccessResponse(collaboratorSchema) } },
  },
  400: errorResponse,
  401: errorResponse,
  403: errorResponse,
  404: errorResponse,
  409: errorResponse,
} as const;

const listDescription =
  'Lists the collaborators that live directly on the scope. Requires `permission:grant` in the scope or the ADMIN role. Inherited program collaborations are not expanded here; only local grants are returned.';

const addDescription =
  'Adds a collaborator to the scope and materializes the ROLE_DEFAULT grants of the assigned role. Requires `permission:grant` in the scope or the ADMIN role; the actor cannot assign a role whose defaults exceed its own permissions. Archived event programs cannot be modified.';

export const authorizationPaths: ZodOpenApiPathsObject = {
  '/api/v1/event-programs/{id}/collaborators': {
    get: {
      tags: ['Collaborators'],
      summary: 'List event program collaborators',
      description: listDescription,
      security: [{ bearerAuth: [] }],
      requestParams: { path: collaboratorParamsSchema.shape.params },
      responses: listResponses,
    },
    post: {
      tags: ['Collaborators'],
      summary: 'Add an event program collaborator',
      description: addDescription,
      security: [{ bearerAuth: [] }],
      requestParams: { path: collaboratorParamsSchema.shape.params },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: addCollaboratorSchema.shape.body } },
      },
      responses: addResponses,
    },
  },
  '/api/v1/activities/{id}/collaborators': {
    get: {
      tags: ['Collaborators'],
      summary: 'List activity collaborators',
      description: listDescription,
      security: [{ bearerAuth: [] }],
      requestParams: { path: collaboratorParamsSchema.shape.params },
      responses: listResponses,
    },
    post: {
      tags: ['Collaborators'],
      summary: 'Add an activity collaborator',
      description: addDescription,
      security: [{ bearerAuth: [] }],
      requestParams: { path: collaboratorParamsSchema.shape.params },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: addCollaboratorSchema.shape.body } },
      },
      responses: addResponses,
    },
  },
};
```

- [x] **Step 4: Registrar el documento**

En `src/docs/openapi.ts`:

a) Agregar el import:

```ts
import { authorizationPaths } from '../modules/authorization/authorization.openapi.js';
```

b) Agregar el tag:

```ts
    { name: 'Collaborators', description: 'Collaborator delegation for event programs and activities.' },
```

c) Agregar `...authorizationPaths,` al objeto `paths`.

- [x] **Step 5: Verificar el verde y regenerar el contrato**

Run: `pnpm exec vitest run src/docs/openapi.test.ts && pnpm run docs:generate && pnpm run docs:check`
Expected: tests PASS, `openapi.json` regenerado sin drift.

---

### Task 5: Bruno y verificacion E2E

**Files:**

- Modify: `bruno/environments/local.bru`
- Create: `bruno/Collaborators/*.bru`

- [x] **Step 1: Agregar variables de entorno**

En `bruno/environments/local.bru`, dentro de `vars`:

```bru
  collaboratorsProgramId: seed_program_congreso-cit
  collaboratorsActivityId: seed_activity_fisc-charla-ia
  archivedProgramId: seed_program_foro-ipe
  unknownProgramId: program-does-not-exist
```

- [x] **Step 2: Crear la carpeta y los requests**

Crear `bruno/Collaborators/folder.bru`:

```bru
meta {
  name: Collaborators
}

auth {
  mode: inherit
}

docs {
  Collaborator delegation for event programs and activities.
}
```

Crear los requests con `seq` en este orden:

1. `Log in as admin.bru` — POST `/api/v1/auth/login` con `{{adminEmail}}`/`{{adminPassword}}`; post-response captura `token`/`refreshToken` (copiar el patrón de `bruno/Careers/Log in as admin.bru`).
2. `Log in as FISC head.bru` (seq 12) — igual, con `{{headEmail}}`/`{{headPassword}}`.
3. `List program collaborators.bru` (seq 3) — GET `{{baseUrl}}/api/v1/event-programs/{{collaboratorsProgramId}}/collaborators`; assert 200, `data.items` array, algún item con `userId === "seed_user_org-fisc"`, `role === "ORGANIZER"`, `JSON.stringify(body)` sin `grantedById` ni `grantedAt`.
4. `List activity collaborators.bru` (seq 4) — GET `/activities/{{collaboratorsActivityId}}/collaborators`; assert 200 y que `seed_user_editor` aparece con rol `EDITOR`.
5. `List unknown program collaborators returns 404.bru` (seq 5) — GET `/event-programs/{{unknownProgramId}}/collaborators`; assert 404 y `message === "Event program not found."`.
6. `List collaborators without a token returns 401.bru` (seq 6) — auth none; assert 401.
7. `Create a collaborator user.bru` (seq 7) — POST `/api/v1/admin/users` con email dinámico `creado.colab.${suffix}.${Date.now()}@utp.ac.pa` e identificación dinámica; assert 201 y guardar `collaboratorUserId`.
8. `Add a collaborator.bru` (seq 8) — POST `/event-programs/{{collaboratorsProgramId}}/collaborators` body `{ "userId": "{{collaboratorUserId}}", "role": "VIEWER" }`; assert 201, `data.userId === bru.getVar("collaboratorUserId")`, `data.role === "VIEWER"`, `data.permissions` no vacío y todos `source === "ROLE_DEFAULT"`.
9. `Add the same collaborator returns 409.bru` (seq 9) — repetir el POST; assert 409 y `message === "User already collaborates in this scope."`.
10. `Add a collaborator with an invalid role returns 400.bru` (seq 10) — body con `role: "OWNER"`; assert 400.
11. `Add a collaborator to an archived program returns 409.bru` (seq 11) — POST `/event-programs/{{archivedProgramId}}/collaborators`; assert 409 y `message === "Archived event programs cannot be modified."`.
12. `Add a collaborator without a token returns 401.bru` (seq 13) — auth none; assert 401.
13. `List collaborators as an organizer without grant returns 403.bru` (seq 14) — con el token del FISC head: GET `/event-programs/seed_program_fisc_default/collaborators`; assert 403 (el head tiene ORGANIZER ahí pero no `permission:grant`).
14. `Add a collaborator as an organizer without grant returns 403.bru` (seq 15) — con el token del FISC head: POST `/event-programs/seed_program_fisc_default/collaborators`; assert 403.

- [x] **Step 3: Correr Bruno**

Run: `pnpm run api:collection:import` NO (destructivo). Ejecutar directamente:

```bash
pnpm exec bru run Collaborators --env local
```

Expected: todas las requests y tests en verde. Si el rate limit de login por IP se agota, esperar 60 s y reintentar.

- [x] **Step 4: Verificacion real E2E (Docker + psql)**

Con el stack dev arriba (`docker compose -f compose.dev.yaml ps`):

1. Login admin → token. `GET /api/v1/event-programs/seed_program_congreso-cit/collaborators` → 200 con `seed_user_org-fisc` (`ORGANIZER`, incluye `permission:grant` `OVERRIDE` con ventana).
2. `GET /api/v1/activities/seed_activity_fisc-charla-ia/collaborators` → 200 con `seed_user_editor`.
3. Login `organizador.fisc@utp.ac.pa` → token head.
4. Head `GET /event-programs/seed_program_fisc_default/collaborators` → 403.
5. Head `POST /event-programs/seed_program_congreso-cit/collaborators` con `{ userId: "seed_user_visor", role: "VIEWER" }` → 201; psql confirma 1 fila en `collaborations` y 5 en `collaboration_permissions` con `source='ROLE_DEFAULT'` y `granted_by_id = seed_user_org-fisc`.
6. Repetir → 409.
7. `POST` con rol `OWNER` → 400.
8. Admin `POST /event-programs/seed_program_foro-ipe/collaborators` → 409 archivado.
9. `GET /event-programs/program-does-not-exist/collaborators` → 404.
10. Limpieza psql:

```sql
DELETE FROM collaborations
WHERE user_id = 'seed_user_visor' AND event_program_id = 'seed_program_congreso-cit';
```

y los usuarios `creado.colab.%@utp.ac.pa` creados por Bruno (borrar primero `sessions`, `accounts`, `collaborations` y luego `users`).

- [x] **Step 5: Confirmar conteos restaurados**

Run: `pnpm exec prisma db execute --stdin` o psql directo para verificar que `collaborations` volvió al conteo del seed. Expected: sin filas temporales.

---

### Task 6: Documentacion, plan maestro y gates

**Files:**

- Modify: `CONTEXT.md`
- Modify: `README.md`
- Modify: `AGENTS.md` (estado actual, si aplica)
- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [x] **Step 1: Documentar en `CONTEXT.md`**

Agregar después de la sección `### Autorizacion Por Colaboracion`:

```md
### Colaboradores Por Scope

- `GET /api/v1/event-programs/{id}/collaborators` y `GET /api/v1/activities/{id}/collaborators` listan las colaboraciones locales del scope con `userId`, identidad, `role`, `createdAt` y permisos locales (`name`, `source`, `validFrom`, `validUntil`). Requieren `permission:grant` en el scope o rol `ADMIN`; no expanden herencia del programa (procedencia en fase 3.8).
- `POST` de los mismos paths agrega un colaborador (`{ userId, role }`) materializando los `ROLE_DEFAULT` del rol. Un actor no-admin no puede asignar un rol cuyos defaults no posea; usuario inexistente `404`, inactivo `400`, duplicado `409` y programa `ARCHIVED` `409`.
- `ADMIN` hace bypass total. Sin cambios de esquema, migraciones, variables de entorno ni catalogo de permisos.
```

- [x] **Step 2: Documentar en `README.md`**

Agregar los endpoints al listado de la seccion de autorizacion/endpoints (cerca de la linea 330) y una nota breve de `permission:grant` y `409` de programa archivado.

- [x] **Step 3: Actualizar el plan maestro**

En `docs/superpowers/plans/plan-maestro-sipeg-utp.md`: marcar `3.1` y `3.2` como `[x]` y agregar un `**Registro de ejecucion (2026-09-20 - 3.1/3.2):**` con plan detallado, decisiones, pruebas, verificacion real, Bruno y gates.

- [x] **Step 4: Gates finales**

Run, en este orden:

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm run build
pnpm run docs:generate && pnpm run docs:check
```

Expected: todo en verde. `openapi.json` sin drift.

- [x] **Step 5: Cierre**

Reportar archivos, conteos de pruebas, resultados de Bruno/E2E y hallazgos. Sin commit (el usuario no lo solicito).

---

## Self-Review

- **Cobertura 3.1:** `GET` en ambos scopes protegido por `permission:grant` -> Task 3/4 y Bruno/E2E.
- **Cobertura 3.2:** `POST` en ambos scopes, materializacion `ROLE_DEFAULT` y subconjunto -> Task 1 (servicio), Task 3 (rutas) y E2E.
- **Decisiones:** DTO con permisos locales (Task 1), solo locales (Task 1/3), archivado 409 (Task 1), sin schema/env/permisos nuevos.
- **Riesgo conocido (no se toca):** la carrera `findFirst` + `create` puede producir `P2002` (500) si dos peticiones simultaneas agregan al mismo usuario.
