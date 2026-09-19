# Authorization Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement a typed authorization layer with per-scope collaboration permissions, per-permission time windows, and an attenuated `permission:grant` delegation rule (only grant what you already hold, without widening scope or time).

**Architecture:** Prisma remains the source of truth. A permission catalog defines canonical `resource:action` keys and role defaults. A resolver computes effective permissions for a user in a program/activity scope by unioning activity-local and inherited program collaborations, ignoring grants outside their `validFrom`/`validUntil` window. A `permission:grant` permission gates every authorization write (add/remove collaborator, change role, grant/revoke permission) behind a symmetric subset invariant plus temporal attenuation. A `requirePermission` middleware enforces route access; `ADMIN` bypasses all checks.

**Tech Stack:** Node.js 24, TypeScript 6, Express 5, Prisma ORM 7.10 + `@prisma/adapter-pg`, PostgreSQL 18, Vitest, pnpm.

---

## File Structure

- Modify: `prisma/schema.prisma` — temporal/audit/grant-source fields on `CollaborationPermission`.
- Create: `src/modules/authorization/permissions.ts` — catalog, `PermissionName`, role defaults, descriptions.
- Create: `src/modules/authorization/permissions.test.ts`
- Create: `src/modules/authorization/authorization.types.ts` — `AuthorizationScope`, `GrantEnvelope`.
- Create: `src/modules/authorization/authorization.service.ts` — effective permissions + envelopes resolver.
- Create: `src/modules/authorization/authorization.service.test.ts`
- Create: `src/modules/authorization/delegation.service.ts` — `addCollaborator`, `updateCollaboratorRole`, `removeCollaborator`, `grantPermission`, `revokePermission`.
- Create: `src/modules/authorization/delegation.service.test.ts`
- Modify: `src/middlewares/authorize.middleware.ts` — add `requirePermission`.
- Modify: `src/middlewares/authorize.middleware.test.ts`
- Modify: `src/types/express.d.ts` — `req.authorization`.
- Create: `prisma/seed.ts` — idempotent permission catalog seed.
- Modify: `prisma.config.ts` — seed command.
- Modify: `package.json` — `prisma:seed` script.
- Create: `docs/adr/adr-0001-time-aware-collaboration-authorization.md`
- Modify: `AGENTS.md`, `CONTEXT.md`

## Design Notes Locked In

- No policy engine library. Typed layer over Prisma.
- `validFrom`/`validUntil` live on `CollaborationPermission` (per permission).
- Expired grants are ignored, never deleted (historical).
- `CollaborationRole` materializes `ROLE_DEFAULT` grant rows on creation; `grantPermission` writes `OVERRIDE` rows.
- Inheritance program → activity is an additive union. No local `DENY` (documented limitation).
- `permission:grant` is the single delegation permission. It gates add/remove collaborator, role changes, and granular grant/revoke. It is not part of any role default.
- Non-admin holders may delegate `permission:grant` to others, always under the subset + attenuation invariants.
- Symmetric subset invariant: grants, revokes, role assignment all require the acted permission set to be a subset of the actor's effective permissions in the target scope.
- Temporal attenuation: the granted window must be contained inside the actor's grant envelope for that permission (`null` = unbounded). A bounded envelope forbids unbounded grants.

### Task 1: Schema, migration, and generated client

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_collaboration_permission_temporal_fields/migration.sql`

- [x] **Step 1: Add grant source enum and temporal/audit fields**

In `prisma/schema.prisma`, add after `enum AlertType`:

```prisma
enum PermissionGrantSource {
  ROLE_DEFAULT
  OVERRIDE
}
```

Replace the `CollaborationPermission` model with:

```prisma
model CollaborationPermission {
  collaborationId String        @map("collaboration_id")
  collaboration   Collaboration @relation(fields: [collaborationId], references: [id], onDelete: Cascade)

  permissionId String     @map("permission_id")
  permission   Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)

  source      PermissionGrantSource @default(OVERRIDE)
  validFrom   DateTime?             @map("valid_from") @db.Timestamptz(3)
  validUntil  DateTime?             @map("valid_until") @db.Timestamptz(3)
  grantedById String?               @map("granted_by_id")
  grantedBy   User?                 @relation("GrantedCollaborationPermissions", fields: [grantedById], references: [id], onDelete: SetNull)
  grantedAt   DateTime              @default(now()) @map("granted_at") @db.Timestamptz(3)

  @@id([collaborationId, permissionId])
  @@index([permissionId])
  @@index([validUntil])
  @@index([grantedById])
  @@map("collaboration_permissions")
}
```

Add to the `User` model next to `collaborations`:

```prisma
  grantedPermissions   CollaborationPermission[] @relation("GrantedCollaborationPermissions")
```

- [x] **Step 2: Create the migration without applying**

Run: `pnpm prisma migrate dev --create-only --name add_collaboration_permission_temporal_fields`
Expected: migration folder created. If the CLI cannot diff, create the folder manually.

- [x] **Step 3: Add the temporal CHECK constraint**

Append to the generated `migration.sql`:

```sql
ALTER TABLE "collaboration_permissions"
  ADD CONSTRAINT "collaboration_permissions_valid_window_check"
  CHECK ("valid_from" IS NULL OR "valid_until" IS NULL OR "valid_until" > "valid_from");
```

- [x] **Step 4: Apply, format, validate, generate**

Run: `pnpm prisma migrate deploy && pnpm prisma validate && pnpm prisma format && pnpm prisma generate`
Expected: migration applied, client regenerated with `PermissionGrantSource` and the new fields.

### Task 2: Permission catalog and role defaults

**Files:**

- Create: `src/modules/authorization/permissions.ts`
- Test: `src/modules/authorization/permissions.test.ts`

- [x] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import {
  PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  PERMISSION_NAMES,
  ROLE_DEFAULTS,
} from './permissions.js';

describe('permission catalog', () => {
  it('exposes unique resource:action keys', () => {
    expect(new Set(PERMISSION_NAMES).size).toBe(PERMISSION_NAMES.length);
    for (const name of PERMISSION_NAMES) {
      expect(name).toMatch(/^[a-z]+:[a-z]+$/);
    }
  });

  it('documents every permission', () => {
    for (const name of PERMISSION_NAMES) {
      expect(PERMISSION_DESCRIPTIONS[name]).toBeTruthy();
    }
  });

  it('never grants permission:grant through role defaults', () => {
    for (const defaults of Object.values(ROLE_DEFAULTS)) {
      expect(defaults).not.toContain(PERMISSIONS.PERMISSION_GRANT);
    }
  });

  it('escalates role defaults monotonically', () => {
    const viewer = new Set(ROLE_DEFAULTS.VIEWER);
    const editor = new Set(ROLE_DEFAULTS.EDITOR);
    const organizer = new Set(ROLE_DEFAULTS.ORGANIZER);

    for (const permission of viewer) expect(editor.has(permission)).toBe(true);
    for (const permission of editor) expect(organizer.has(permission)).toBe(true);
  });

  it('only uses catalog names in role defaults', () => {
    const catalog = new Set<string>(PERMISSION_NAMES);
    for (const defaults of Object.values(ROLE_DEFAULTS)) {
      for (const permission of defaults) expect(catalog.has(permission)).toBe(true);
    }
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/modules/authorization/permissions.test.ts`
Expected: FAIL — cannot resolve `./permissions.js`.

- [x] **Step 3: Implement the catalog**

```ts
import type { CollaborationRole } from '../../generated/prisma/enums.js';

export const PERMISSIONS = {
  PROGRAM_READ: 'program:read',
  PROGRAM_UPDATE: 'program:update',
  PROGRAM_ARCHIVE: 'program:archive',
  ACTIVITY_READ: 'activity:read',
  ACTIVITY_CREATE: 'activity:create',
  ACTIVITY_UPDATE: 'activity:update',
  ACTIVITY_CANCEL: 'activity:cancel',
  ATTENDANCE_REGISTER: 'attendance:register',
  ATTENDANCE_CHECKIN: 'attendance:checkin',
  ATTENDANCE_MANAGE: 'attendance:manage',
  CERTIFICATE_READ: 'certificate:read',
  CERTIFICATE_GENERATE: 'certificate:generate',
  PROPOSAL_READ: 'proposal:read',
  PROPOSAL_REVIEW: 'proposal:review',
  PROPOSAL_FEEDBACK: 'proposal:feedback',
  REPORT_VIEW: 'report:view',
  REPORT_EXPORT: 'report:export',
  PERMISSION_GRANT: 'permission:grant',
} as const;

export type PermissionName = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_NAMES = Object.values(PERMISSIONS) as PermissionName[];

export const PERMISSION_DESCRIPTIONS: Record<PermissionName, string> = {
  [PERMISSIONS.PROGRAM_READ]: 'Ver programas de eventos.',
  [PERMISSIONS.PROGRAM_UPDATE]: 'Actualizar programas de eventos.',
  [PERMISSIONS.PROGRAM_ARCHIVE]: 'Archivar programas de eventos.',
  [PERMISSIONS.ACTIVITY_READ]: 'Ver actividades.',
  [PERMISSIONS.ACTIVITY_CREATE]: 'Crear actividades.',
  [PERMISSIONS.ACTIVITY_UPDATE]: 'Actualizar actividades.',
  [PERMISSIONS.ACTIVITY_CANCEL]: 'Cancelar actividades.',
  [PERMISSIONS.ATTENDANCE_REGISTER]: 'Inscribir asistentes en una actividad.',
  [PERMISSIONS.ATTENDANCE_CHECKIN]: 'Registrar check-in de asistentes.',
  [PERMISSIONS.ATTENDANCE_MANAGE]: 'Gestionar la lista de asistencia.',
  [PERMISSIONS.CERTIFICATE_READ]: 'Consultar certificados.',
  [PERMISSIONS.CERTIFICATE_GENERATE]: 'Generar certificados.',
  [PERMISSIONS.PROPOSAL_READ]: 'Ver propuestas de ponentes.',
  [PERMISSIONS.PROPOSAL_REVIEW]: 'Revisar y responder propuestas.',
  [PERMISSIONS.PROPOSAL_FEEDBACK]: 'Dar feedback a propuestas.',
  [PERMISSIONS.REPORT_VIEW]: 'Ver reportes y estadisticas.',
  [PERMISSIONS.REPORT_EXPORT]: 'Exportar reportes.',
  [PERMISSIONS.PERMISSION_GRANT]: 'Otorgar y revocar permisos y colaboradores.',
};

export const ROLE_DEFAULTS: Record<CollaborationRole, readonly PermissionName[]> = {
  VIEWER: [
    PERMISSIONS.PROGRAM_READ,
    PERMISSIONS.ACTIVITY_READ,
    PERMISSIONS.CERTIFICATE_READ,
    PERMISSIONS.PROPOSAL_READ,
    PERMISSIONS.REPORT_VIEW,
  ],
  EDITOR: [
    PERMISSIONS.PROGRAM_READ,
    PERMISSIONS.ACTIVITY_READ,
    PERMISSIONS.CERTIFICATE_READ,
    PERMISSIONS.PROPOSAL_READ,
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.ACTIVITY_CREATE,
    PERMISSIONS.ACTIVITY_UPDATE,
    PERMISSIONS.ATTENDANCE_REGISTER,
    PERMISSIONS.ATTENDANCE_CHECKIN,
    PERMISSIONS.ATTENDANCE_MANAGE,
    PERMISSIONS.PROPOSAL_FEEDBACK,
  ],
  ORGANIZER: [
    PERMISSIONS.PROGRAM_READ,
    PERMISSIONS.ACTIVITY_READ,
    PERMISSIONS.CERTIFICATE_READ,
    PERMISSIONS.PROPOSAL_READ,
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.ACTIVITY_CREATE,
    PERMISSIONS.ACTIVITY_UPDATE,
    PERMISSIONS.ATTENDANCE_REGISTER,
    PERMISSIONS.ATTENDANCE_CHECKIN,
    PERMISSIONS.ATTENDANCE_MANAGE,
    PERMISSIONS.PROPOSAL_FEEDBACK,
    PERMISSIONS.PROGRAM_UPDATE,
    PERMISSIONS.ACTIVITY_CANCEL,
    PERMISSIONS.CERTIFICATE_GENERATE,
    PERMISSIONS.PROPOSAL_REVIEW,
    PERMISSIONS.REPORT_EXPORT,
  ],
};
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/modules/authorization/permissions.test.ts`
Expected: PASS.

### Task 3: Effective permissions resolver

**Files:**

- Create: `src/modules/authorization/authorization.types.ts`
- Create: `src/modules/authorization/authorization.service.ts`
- Test: `src/modules/authorization/authorization.service.test.ts`

- [x] **Step 1: Write the failing test**

Mock Prisma exactly like `src/modules/users/users.service.test.ts`: `vi.resetModules()` + `vi.doMock('../../config/prisma.js', ...)` + dynamic `import()`. Cover:

```ts
it('unions activity-local and inherited program grants', ...);
it('ignores expired grants', ...);
it('ignores grants that start in the future', ...);
it('returns every permission for ADMIN', ...);
it('resolves the parent program when only an activityId is given', ...);
it('throws 404 when the activity does not exist', ...);
it('builds envelope bounded by the tightest grant window', ...);
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/modules/authorization/authorization.service.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement types and resolver**

`authorization.types.ts`:

```ts
export interface AuthorizationScope {
  eventProgramId?: string;
  activityId?: string;
}

export interface GrantEnvelope {
  validFrom: Date | null;
  validUntil: Date | null;
}

export interface ResolvedScope {
  eventProgramId: string;
  activityId?: string;
}
```

`authorization.service.ts`:

```ts
import { getPrismaClient } from '../../config/prisma.js';
import {
  PERMISSION_NAMES,
  type PermissionName,
} from './permissions.js';
import type {
  AuthorizationScope,
  GrantEnvelope,
  ResolvedScope,
} from './authorization.types.js';
import { ApiError } from '../../utils/ApiError.js';

const grantWindowWhere = (now: Date) => ({
  AND: [
    { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
    { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
  ],
});

export const resolveScope = async (scope: AuthorizationScope): Promise<ResolvedScope> => {
  if (scope.activityId) {
    const activity = await getPrismaClient().activity.findUnique({
      where: { id: scope.activityId },
      select: { eventProgramId: true },
    });
    if (!activity) {
      throw new ApiError(404, 'Activity not found.');
    }
    return { eventProgramId: activity.eventProgramId, activityId: scope.activityId };
  }
  if (scope.eventProgramId) {
    return { eventProgramId: scope.eventProgramId };
  }
  throw new ApiError(400, 'An activity or event program scope is required.');
};

export const getPermissionEnvelopes = async (
  user: Express.AuthenticatedUser,
  scope: AuthorizationScope,
  now: Date = new Date(),
): Promise<Map<PermissionName, GrantEnvelope>> => {
  const resolved = await resolveScope(scope);
  const envelopes = new Map<PermissionName, GrantEnvelope>();

  if (user.globalRole === 'ADMIN') {
    for (const name of PERMISSION_NAMES) {
      envelopes.set(name, { validFrom: null, validUntil: null });
    }
    return envelopes;
  }

  const collaborations = await getPrismaClient().collaboration.findMany({
    where: {
      userId: user.id,
      OR: [
        { eventProgramId: resolved.eventProgramId },
        ...(resolved.activityId ? [{ activityId: resolved.activityId }] : []),
      ],
    },
    select: {
      permissions: {
        where: grantWindowWhere(now),
        select: {
          validFrom: true,
          validUntil: true,
          permission: { select: { name: true } },
        },
      },
    },
  });

  for (const collaboration of collaborations) {
    for (const grant of collaboration.permissions) {
      const name = grant.permission.name as PermissionName;
      if (!PERMISSION_NAMES.includes(name)) continue;
      const current = envelopes.get(name);
      const earlier = current?.validFrom ?? grant.validFrom ?? null;
      const later = current?.validUntil ?? grant.validUntil ?? null;
      const validFrom =
        current?.validFrom === null || grant.validFrom === null
          ? null
          : earlier;
      const validUntil =
        current?.validUntil === null || grant.validUntil === null
          ? null
          : later;
      envelopes.set(name, { validFrom, validUntil });
    }
  }

  return envelopes;
};

export const getEffectivePermissions = async (
  user: Express.AuthenticatedUser,
  scope: AuthorizationScope,
  now: Date = new Date(),
): Promise<Set<PermissionName>> => {
  const envelopes = await getPermissionEnvelopes(user, scope, now);
  return new Set(envelopes.keys());
};

export const hasPermission = async (
  user: Express.AuthenticatedUser,
  permission: PermissionName,
  scope: AuthorizationScope,
  now: Date = new Date(),
): Promise<boolean> => {
  const permissions = await getEffectivePermissions(user, scope, now);
  return permissions.has(permission);
};
```

> Envelope rule: `null` means unbounded on that side. The envelope takes the earliest start and latest end; if any contributing grant is unbounded, that side stays unbounded. This is a conservative approximation that never under-reports the actor's reach, so attenuation can never admit a wider window than the actor holds.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/modules/authorization/authorization.service.test.ts`
Expected: PASS.

### Task 4: Attenuated delegation service

**Files:**

- Create: `src/modules/authorization/delegation.service.ts`
- Test: `src/modules/authorization/delegation.service.test.ts`

- [x] **Step 1: Write the failing test**

Cover, with mocked Prisma:

```ts
it('rejects delegation without permission:grant', ...);
it('rejects granting a permission the actor does not hold', ...);
it('rejects a grant window wider than the actor envelope', ...);
it('rejects assigning a role whose defaults exceed the actor permissions', ...);
it('creates the collaboration and materializes ROLE_DEFAULT rows', ...);
it('writes OVERRIDE rows with grantedById set', ...);
it('revokes only permissions the actor also holds', ...);
it('allows delegating permission:grant when the actor holds it', ...);
it('lets ADMIN grant anything with an unbounded window', ...);
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/modules/authorization/delegation.service.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement the delegation service**

```ts
import { getPrismaClient } from '../../config/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { getPermissionEnvelopes, resolveScope } from './authorization.service.js';
import type { AuthorizationScope, GrantEnvelope } from './authorization.types.js';
import { PERMISSIONS, ROLE_DEFAULTS, type PermissionName } from './permissions.js';
import type { CollaborationRole } from '../../generated/prisma/enums.js';

const isAdmin = (user: Express.AuthenticatedUser) => user.globalRole === 'ADMIN';

const assertActorCanDelegate = async (
  actor: Express.AuthenticatedUser,
  scope: AuthorizationScope,
  now: Date,
) => {
  const envelopes = await getPermissionEnvelopes(actor, scope, now);
  if (!envelopes.has(PERMISSIONS.PERMISSION_GRANT)) {
    throw new ApiError(403, 'Insufficient privileges to manage permissions.');
  }
  return envelopes;
};

const assertGrantWithinEnvelope = (
  envelope: GrantEnvelope | undefined,
  validFrom: Date | null,
  validUntil: Date | null,
) => {
  if (!envelope) throw new ApiError(403, 'Cannot grant permissions you do not hold.');
  if (envelope.validFrom && (!validFrom || validFrom < envelope.validFrom)) {
    throw new ApiError(403, 'Grant window starts before the delegator grant.');
  }
  if (envelope.validUntil && (!validUntil || validUntil > envelope.validUntil)) {
    throw new ApiError(403, 'Grant window exceeds the delegator grant.');
  }
};

const assertValidWindow = (validFrom: Date | null, validUntil: Date | null) => {
  if (validFrom && validUntil && validUntil <= validFrom) {
    throw new ApiError(400, 'validUntil must be greater than validFrom.');
  }
};
```

Then implement:

- `addCollaborator(actor, scope, targetUserId, role, now = new Date())`:
  - `envelopes = await assertActorCanDelegate(...)`
  - `for (const permission of ROLE_DEFAULTS[role]) if (!envelopes.has(permission)) throw 403`
  - resolve target user (`findUnique`, select `id, isActive`), 404 if missing, 400 if inactive
  - `resolved = await resolveScope(scope)`
  - transaction: reject if an existing collaboration for that user in the resolved scope exists (409), then `collaboration.create` with nested `permissions: { create: ROLE_DEFAULT rows }` (`source: 'ROLE_DEFAULT'`, `grantedById: actor.id`)
- `updateCollaboratorRole(actor, scope, targetUserId, role, now)`:
  - same permission:grant + role defaults subset checks
  - fetch collaboration including permissions; 404 if missing
  - transaction: delete `ROLE_DEFAULT` rows, update role, create new `ROLE_DEFAULT` rows; keep `OVERRIDE` rows untouched
- `removeCollaborator(actor, scope, targetUserId, now)`:
  - `assertActorCanDelegate`; fetch collaboration with permissions; 404 if missing
  - every local permission name must be in `envelopes` (403 otherwise)
  - delete collaboration (cascades permissions)
- `grantPermission(actor, scope, targetUserId, permission, window, now = new Date())`:
  - `assertActorCanDelegate`
  - `assertValidWindow`
  - `assertGrantWithinEnvelope(envelopes.get(permission), window.validFrom ?? null, window.validUntil ?? null)`
  - find collaboration; 404 if missing (collaborators must be added first)
  - upsert `CollaborationPermission` with `source: 'OVERRIDE'`, `grantedById: actor.id`, window values
- `revokePermission(actor, scope, targetUserId, permission, now)`:
  - `assertActorCanDelegate`; require `envelopes.has(permission)` (symmetric subset)
  - find collaboration + exact permission row; 404 if missing
  - delete row

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/modules/authorization/delegation.service.test.ts`
Expected: PASS.

### Task 5: `requirePermission` middleware

**Files:**

- Modify: `src/types/express.d.ts`
- Modify: `src/middlewares/authorize.middleware.ts`
- Modify: `src/middlewares/authorize.middleware.test.ts`

- [x] **Step 1: Write the failing tests**

Add to `authorize.middleware.test.ts`, mocking `authorization.service.js`:

```ts
it('denies when the user lacks the required permission', ...);   // 403
it('allows when the resolver finds the permission', ...);         // next()
it('bypasses resolution for ADMIN', ...);
it('stores effective permissions in req.authorization', ...);
it('requires an authenticated user', ...);                        // 401
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/middlewares/authorize.middleware.test.ts`
Expected: FAIL — `requirePermission` is not exported.

- [x] **Step 3: Implement**

`src/types/express.d.ts` add:

```ts
import type { PermissionName } from '../modules/authorization/permissions.js';

    interface RequestAuthorization {
      permissions: Set<PermissionName>;
    }

    interface Request {
      user?: AuthenticatedUser;
      authorization?: RequestAuthorization;
    }
```

`authorize.middleware.ts` add:

```ts
import type { RequestHandler } from 'express';

import { getEffectivePermissions } from '../modules/authorization/authorization.service.js';
import type { AuthorizationScope } from '../modules/authorization/authorization.types.js';
import type { PermissionName } from '../modules/authorization/permissions.js';
import { ApiError } from '../utils/ApiError.js';
import { requireAuthenticatedUser } from './authenticate.middleware.js';

export type ScopeResolver = (
  req: Express.Request,
) => Promise<AuthorizationScope | undefined> | AuthorizationScope | undefined;

export const requirePermission = (
  permission: PermissionName,
  resolveScope?: ScopeResolver,
): RequestHandler => {
  return async (req, _res, next) => {
    try {
      const user = requireAuthenticatedUser(req);
      if (user.globalRole === 'ADMIN') {
        next();
        return;
      }
      const scope = resolveScope ? await resolveScope(req) : undefined;
      if (!scope) {
        throw new ApiError(403, 'Insufficient privileges for this resource.');
      }
      const permissions = await getEffectivePermissions(user, scope);
      req.authorization = { permissions };
      if (!permissions.has(permission)) {
        throw new ApiError(403, 'Insufficient privileges for this resource.');
      }
      next();
    } catch (error) {
      next(error);
    }
  };
};
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/middlewares/authorize.middleware.test.ts`
Expected: PASS.

### Task 6: Permission catalog seed

**Files:**

- Create: `prisma/seed.ts`
- Modify: `prisma.config.ts`
- Modify: `package.json`

- [x] **Step 1: Implement the seed**

```ts
import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client.js';
import {
  PERMISSION_DESCRIPTIONS,
  PERMISSION_NAMES,
} from '../src/modules/authorization/permissions.js';

const connectionString = process.env.DATABASE_URL ?? '';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const main = async () => {
  for (const name of PERMISSION_NAMES) {
    const description = PERMISSION_DESCRIPTIONS[name];
    await prisma.permission.upsert({
      where: { name },
      update: { description },
      create: { name, description },
    });
  }
};

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
```

- [x] **Step 2: Wire the seed command**

`prisma.config.ts`:

```ts
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
```

`package.json` scripts add: `"prisma:seed": "prisma db seed"`.

- [x] **Step 3: Run the seed and verify idempotency**

Run: `pnpm prisma db seed && pnpm prisma db seed`
Expected: both runs succeed with no duplicates.

### Task 7: ADR and docs

**Files:**

- Create: `docs/adr/adr-0001-time-aware-collaboration-authorization.md`
- Modify: `AGENTS.md` — replace the "Authentication And Authorization Rules" authorization paragraphs.
- Modify: `CONTEXT.md` — update the authorization section.

- [x] **Step 1: Write the ADR** with Context / Decision / Consequences, documenting: typed layer over a policy engine, per-permission windows, additive inheritance, no local DENY, symmetric subset invariant, temporal attenuation, and the `permission:grant` write-gating rule.
- [x] **Step 2: Update `AGENTS.md` and `CONTEXT.md`** with the catalog, role defaults, scope inheritance, delegation rules, and the documented limitation.
- [x] **Step 3: Verify final state**

Run:

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run build
```

Expected: all pass.

---

## Verification Checklist

- [x] `pnpm test` green.
- [x] `pnpm run typecheck` clean.
- [x] `pnpm run lint` clean.
- [x] `pnpm run build` succeeds.
- [x] `pnpm prisma validate` clean.
- [x] Seed idempotent.
- [x] No secrets or generated files committed.
