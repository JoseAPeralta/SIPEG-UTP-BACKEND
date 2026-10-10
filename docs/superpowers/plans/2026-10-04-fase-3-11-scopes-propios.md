# Fase 3.11 - Descubrimiento de scopes propios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exponer `GET /api/v1/users/me/scopes` que devuelve, paginado y en orden determinista, cada scope (programa o actividad) donde el usuario autenticado tiene al menos un permiso efectivo vigente, incluidos estados no públicos, sin exponer auditoría.

**Architecture:** Se extiende `src/modules/authorization/`. Ruta en `authorization.routes.ts` (tag OpenAPI `Collaborators`) con `authenticate -> validate(query) -> controlador -> servicio`, sin `requirePermission` (cada quien lee sus propios scopes, igual que `/users/me/permissions`). El servicio reutiliza `resolvePermissionEntries`/`isGrantActive` y agrega dos caminos: USER (una consulta de colaboraciones del usuario) y ADMIN (descubrimiento ligero `id+name` + hidratación de la página). Sin migraciones, variables de entorno ni permisos nuevos.

**Tech Stack:** TypeScript 6, Express 5, Prisma 7 (SQL/Postgres), Zod 4, Vitest, Supertest, OpenAPI 3.1 (zod-openapi), Bruno.

**Contrato acordado con el usuario (2026-10-04):**

1. Solo colaboraciones directas: una actividad aparece solo si tiene colaboración local; la herencia del programa se usa para resolver `permissions` (origin `INHERITED`/`BOTH`), no para enumerar actividades.
2. ADMIN ve todo el catálogo (todos los programas y actividades, cualquier estado) con el catálogo completo de permisos como `LOCAL` e ilimitado, paginado.
3. `status` de actividad = estado efectivo (`resolveActivityStatus`); de programa = almacenado.
4. Orden determinista `name ASC, id ASC` con comparación binaria en código.
5. Riesgo mitigado (alternativa A): el camino ADMIN hace bulk `select { id, name }`, merge/slice en memoria e hidrata solo los ids de la página; si el catálogo crece a decenas de miles, el follow-up es `UNION ALL` con `$queryRaw` (opción B).

**Semántica del ítem:**

- Aparece solo si al menos un permiso efectivo está vigente en el momento de la petición; grants vencidos o futuros se ignoran (consistente con `/users/me/permissions`).
- Sin scopes: página vacía, nunca `404`.
- Privacidad: sin `grantedById`, `grantedAt`, emails ni campos de auditoría.
- Errores: `400` query inválida, `401` token ausente/inválido, `403` cuenta inactiva.

**Componentes OpenAPI nuevos (nombres fijos, breaking si se renombran):** `UserScope`, `UserScopeEventProgram`, `UserScopeOrganizationalUnit`, `PaginatedUserScopes`; reutiliza `OwnPermission`.

---

### Task 1: Tipos y servicio (TDD)

**Files:**

- Modify: `src/modules/authorization/authorization.types.ts`
- Modify: `src/modules/authorization/authorization.service.ts`
- Test: `src/modules/authorization/authorization.service.test.ts`

- [ ] **Step 1: Tipos**

Al final de `authorization.types.ts` (importar `ActivityStatus`, `ProgramStatus`, `UnitType`):

```ts
export interface ListUserScopesQuery {
  type?: 'program' | 'activity';
  page: number;
  limit: number;
}

export interface UserScopeEventProgram {
  id: string;
  name: string;
  label: string | null;
  status: ProgramStatus;
}

export interface UserScopeOrganizationalUnit {
  id: string;
  name: string;
  type: UnitType;
}

export interface UserScopeItem {
  type: 'program' | 'activity';
  id: string;
  name: string;
  status: ProgramStatus | ActivityStatus;
  eventProgram: UserScopeEventProgram | null;
  organizationalUnit: UserScopeOrganizationalUnit;
  permissions: OwnPermissionEnvelope[];
}

export interface PaginatedUserScopes {
  items: UserScopeItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
```

- [ ] **Step 2: Pruebas que fallan**

Ampliar el `PrismaMock` de `authorization.service.test.ts` con `eventProgram.findMany` y `activity.findMany`. Casos:

1. USER lista scope de programa y de actividad con permisos ordenados y orden global `name,id`.
2. Actividad une grants locales con los heredados del programa (`origin` `LOCAL`/`INHERITED`/`BOTH`).
3. Scope con solo grants vencidos/futuros se omite (paginación vacía).
4. Filtro `type` y paginación (`page 2`, `limit`).
5. ADMIN devuelve todo el catálogo `LOCAL` ilimitado; bulk con `select { id, name }`, hidratación solo con ids de la página, sin `collaboration.findMany`.
6. Usuario sin colaboraciones → `{ items: [], page: 1, limit: 20, total: 0, totalPages: 0 }`.
7. Estado efectivo de actividad con `now` fijo.
8. Filas con `grantedById`/`grantedAt` no se filtran al DTO.
9. Desempate por `id` con nombres iguales.

- [ ] **Step 3: Verificar rojo**

Run: `pnpm exec vitest run src/modules/authorization/authorization.service.test.ts`
Expected: FAIL porque `listUserScopes` no existe.

- [ ] **Step 4: Implementar el servicio**

En `authorization.service.ts` agregar:

```ts
const compareByNameThenId = (
  first: { name: string; id: string },
  second: { name: string; id: string },
): number => {
  if (first.name !== second.name) {
    return first.name < second.name ? -1 : 1;
  }
  if (first.id !== second.id) {
    return first.id < second.id ? -1 : 1;
  }
  return 0;
};

const toOwnPermissions = (
  entries: Map<PermissionName, PermissionProvenanceEntry>,
): OwnPermissionEnvelope[] =>
  [...entries.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([name, entry]) => ({
      name,
      origin: entry.origin,
      validFrom: entry.envelope.validFrom ? entry.envelope.validFrom.toISOString() : null,
      validUntil: entry.envelope.validUntil ? entry.envelope.validUntil.toISOString() : null,
    }));

interface ScopeCandidate {
  type: 'program' | 'activity';
  id: string;
  name: string;
}

const paginateScopeItems = <T extends ScopeCandidate>(
  candidates: T[],
  page: number,
  limit: number,
): { items: T[]; total: number; totalPages: number } => {
  const sorted = [...candidates].sort(compareByNameThenId);
  const skip = (page - 1) * limit;
  const total = sorted.length;

  return {
    items: sorted.slice(skip, skip + limit),
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
};

const listCollaborationScopes = async (
  user: Express.AuthenticatedUser,
  now: Date,
): Promise<UserScopeItem[]> => {
  const prisma = getPrismaClient();
  const collaborations = await prisma.collaboration.findMany({
    where: { userId: user.id },
    select: {
      eventProgramId: true,
      activityId: true,
      eventProgram: {
        select: {
          id: true,
          name: true,
          label: true,
          status: true,
          organizationalUnit: { select: { id: true, name: true, type: true } },
        },
      },
      activity: {
        select: {
          id: true,
          name: true,
          status: true,
          date: true,
          startTime: true,
          endTime: true,
          eventProgram: {
            select: {
              id: true,
              name: true,
              label: true,
              status: true,
              organizationalUnit: { select: { id: true, name: true, type: true } },
            },
          },
        },
      },
      permissions: {
        select: {
          validFrom: true,
          validUntil: true,
          permission: { select: { name: true } },
        },
      },
    },
  });

  const programGrants = new Map<string, ScopedGrantRecord[]>();
  const activityGrants = new Map<string, ScopedGrantRecord[]>();

  for (const collaboration of collaborations) {
    const grants = collaboration.permissions.map((row) => ({
      validFrom: row.validFrom,
      validUntil: row.validUntil,
      permission: row.permission,
      eventProgramId: collaboration.eventProgramId,
      activityId: collaboration.activityId,
    }));

    if (collaboration.eventProgramId) {
      programGrants.set(collaboration.eventProgramId, [
        ...(programGrants.get(collaboration.eventProgramId) ?? []),
        ...grants,
      ]);
    }
    if (collaboration.activityId) {
      activityGrants.set(collaboration.activityId, [
        ...(activityGrants.get(collaboration.activityId) ?? []),
        ...grants,
      ]);
    }
  }

  const items: UserScopeItem[] = [];

  for (const [programId, grants] of programGrants) {
    const program = collaborations.find(
      (collaboration) => collaboration.eventProgramId === programId,
    )?.eventProgram;

    if (!program) {
      continue;
    }

    const entries = resolvePermissionEntries({ eventProgramId: programId }, grants, now);
    if (entries.size === 0) {
      continue;
    }

    items.push({
      type: 'program',
      id: program.id,
      name: program.name,
      status: program.status,
      eventProgram: null,
      organizationalUnit: program.organizationalUnit,
      permissions: toOwnPermissions(entries),
    });
  }

  for (const [activityId, grants] of activityGrants) {
    const activity = collaborations.find(
      (collaboration) => collaboration.activityId === activityId,
    )?.activity;

    if (!activity) {
      continue;
    }

    const parentGrants = programGrants.get(activity.eventProgram.id) ?? [];
    const entries = resolvePermissionEntries(
      { eventProgramId: activity.eventProgram.id, activityId },
      [...grants, ...parentGrants],
      now,
    );

    if (entries.size === 0) {
      continue;
    }

    items.push({
      type: 'activity',
      id: activity.id,
      name: activity.name,
      status: resolveActivityStatus(activity, now),
      eventProgram: {
        id: activity.eventProgram.id,
        name: activity.eventProgram.name,
        label: activity.eventProgram.label,
        status: activity.eventProgram.status,
      },
      organizationalUnit: activity.eventProgram.organizationalUnit,
      permissions: toOwnPermissions(entries),
    });
  }

  return items;
};
```

El camino ADMIN (bulk `id+name` + hidratación de página):

```ts
const listAdminScopeItems = async (
  query: ListUserScopesQuery,
  now: Date,
): Promise<PaginatedUserScopes> => {
  const prisma = getPrismaClient();
  const [programs, activities] = await Promise.all([
    query.type === 'activity'
      ? Promise.resolve([])
      : prisma.eventProgram.findMany({ select: { id: true, name: true } }),
    query.type === 'program'
      ? Promise.resolve([])
      : prisma.activity.findMany({ select: { id: true, name: true } }),
  ]);

  const candidates: ScopeCandidate[] = [
    ...programs.map((program) => ({
      type: 'program' as const,
      id: program.id,
      name: program.name,
    })),
    ...activities.map((activity) => ({
      type: 'activity' as const,
      id: activity.id,
      name: activity.name,
    })),
  ];
  const page = paginateScopeItems(candidates, query.page, query.limit);
  const programIds = page.items.filter((item) => item.type === 'program').map((item) => item.id);
  const activityIds = page.items.filter((item) => item.type === 'activity').map((item) => item.id);

  const [programRecords, activityRecords] = await Promise.all([
    programIds.length === 0
      ? Promise.resolve([])
      : prisma.eventProgram.findMany({
          where: { id: { in: programIds } },
          select: {
            id: true,
            name: true,
            status: true,
            organizationalUnit: { select: { id: true, name: true, type: true } },
          },
        }),
    activityIds.length === 0
      ? Promise.resolve([])
      : prisma.activity.findMany({
          where: { id: { in: activityIds } },
          select: {
            id: true,
            name: true,
            status: true,
            date: true,
            startTime: true,
            endTime: true,
            eventProgram: {
              select: {
                id: true,
                name: true,
                label: true,
                status: true,
                organizationalUnit: { select: { id: true, name: true, type: true } },
              },
            },
          },
        }),
  ]);

  const programById = new Map(programRecords.map((record) => [record.id, record]));
  const activityById = new Map(activityRecords.map((record) => [record.id, record]));
  const adminPermissions: OwnPermissionEnvelope[] = [...PERMISSION_NAMES]
    .sort((first, second) => first.localeCompare(second))
    .map((name) => ({ name, origin: 'LOCAL' as const, validFrom: null, validUntil: null }));

  const items = page.items.flatMap((candidate): UserScopeItem[] => {
    if (candidate.type === 'program') {
      const record = programById.get(candidate.id);
      if (!record) {
        return [];
      }

      return [
        {
          type: 'program',
          id: record.id,
          name: record.name,
          status: record.status,
          eventProgram: null,
          organizationalUnit: record.organizationalUnit,
          permissions: adminPermissions,
        },
      ];
    }

    const record = activityById.get(candidate.id);
    if (!record) {
      return [];
    }

    return [
      {
        type: 'activity',
        id: record.id,
        name: record.name,
        status: resolveActivityStatus(record, now),
        eventProgram: {
          id: record.eventProgram.id,
          name: record.eventProgram.name,
          label: record.eventProgram.label,
          status: record.eventProgram.status,
        },
        organizationalUnit: record.eventProgram.organizationalUnit,
        permissions: adminPermissions,
      },
    ];
  });

  return {
    items,
    page: query.page,
    limit: query.limit,
    total: page.total,
    totalPages: page.totalPages,
  };
};

export const listUserScopes = async (
  user: Express.AuthenticatedUser,
  query: ListUserScopesQuery,
  now: Date = new Date(),
): Promise<PaginatedUserScopes> => {
  if (user.globalRole === 'ADMIN') {
    return listAdminScopeItems(query, now);
  }

  const items = await listCollaborationScopes(user, now);
  const filtered = query.type ? items.filter((item) => item.type === query.type) : items;
  const page = paginateScopeItems(filtered, query.page, query.limit);

  return {
    items: page.items,
    page: query.page,
    limit: query.limit,
    total: page.total,
    totalPages: page.totalPages,
  };
};
```

- [ ] **Step 5: Verificar verde**

Run: `pnpm exec vitest run src/modules/authorization/authorization.service.test.ts`
Expected: PASS.

---

### Task 2: Esquemas (TDD)

**Files:**

- Modify: `src/modules/authorization/authorization.schemas.ts`
- Test: `src/modules/authorization/authorization.schemas.test.ts`

- [ ] **Step 1: Pruebas que fallan**

Casos: defaults `page 1`/`limit 20` sin `type`; coerción de strings; `type` válido; `type` inválido/page 0/limit 51/claves desconocidas → error; parseo de ítem programa (`eventProgram: null`) y de actividad; respuesta paginada feliz y rechazo de campos faltantes.

- [ ] **Step 2: Implementar esquemas**

```ts
const userScopeTypes = ['program', 'activity'] as const;

export const listUserScopesQuerySchema = z.object({
  query: z
    .object({
      type: z.enum(userScopeTypes, 'Scope type is invalid.').optional(),
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
    })
    .strict(),
});

export type ListUserScopesQueryInput = z.infer<typeof listUserScopesQuerySchema>['query'];

const userScopeEventProgramSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    label: z.string().nullable(),
    status: z.enum(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED']),
  })
  .meta({ id: 'UserScopeEventProgram', description: 'Parent event program of an activity scope.' });

const userScopeOrganizationalUnitSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.enum(['FACULTY', 'SUBDIRECTORATE']),
  })
  .meta({
    id: 'UserScopeOrganizationalUnit',
    description: 'Owning organizational unit of a scope.',
  });

export const userScopeSchema = z
  .object({
    type: z.enum(userScopeTypes),
    id: z.string(),
    name: z.string(),
    status: z.enum([
      'DRAFT',
      'ACTIVE',
      'COMPLETED',
      'CANCELLED',
      'ARCHIVED',
      'SCHEDULED',
      'ONGOING',
    ]),
    eventProgram: userScopeEventProgramSchema.nullable(),
    organizationalUnit: userScopeOrganizationalUnitSchema,
    permissions: z.array(ownPermissionSchema),
  })
  .meta({
    id: 'UserScope',
    description:
      'Program or activity scope where the authenticated user holds at least one effective permission.',
  }) satisfies z.ZodType<UserScopeItem>;

export const paginatedUserScopesSchema = z
  .object({
    items: z.array(userScopeSchema),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .meta({
    id: 'PaginatedUserScopes',
    description: 'Paginated scopes of the authenticated user.',
  }) satisfies z.ZodType<PaginatedUserScopes>;
```

- [ ] **Step 3: Verificar rojo y verde**

Run: `pnpm exec vitest run src/modules/authorization/authorization.schemas.test.ts`.

---

### Task 3: Controlador, ruta y pruebas de ruta (TDD)

**Files:**

- Modify: `src/modules/authorization/authorization.controller.ts`
- Modify: `src/modules/authorization/authorization.routes.ts`
- Test: `src/modules/authorization/authorization.routes.test.ts`

- [ ] **Step 1: Pruebas que fallan**

Extender `loadApp` con un 6.º parámetro `listUserScopes = vi.fn()` e incluirlo en el mock del módulo. Casos: 401 sin token (servicio no llamado); 400 `type` inválido/page 0/limit 51; 200 con `success: true`, mensaje `Scopes retrieved successfully.` y paso de `user.id` + query; 403 cuenta inactiva; filtro `type` reenviado.

- [ ] **Step 2: Implementar controlador y ruta**

```ts
export const getUserScopes: RequestHandler = asyncHandler(async (req, res) => {
  const query = req.query as unknown as ListUserScopesQuery;
  const user = requireAuthenticatedUser(req);
  const result = await listUserScopesService(user, query);

  res.status(200).json(successResponse('Scopes retrieved successfully.', result));
});

authorizationRoutes.get(
  '/users/me/scopes',
  authenticate,
  validate(listUserScopesQuerySchema),
  getUserScopes,
);
```

- [ ] **Step 3: Verificar verde**

Run: `pnpm exec vitest run src/modules/authorization/authorization.routes.test.ts`.

---

### Task 4: OpenAPI (TDD)

**Files:**

- Modify: `src/modules/authorization/authorization.openapi.ts`
- Modify: `src/docs/openapi.test.ts`
- Generate: `openapi.json`

- [ ] **Step 1: Prueba de contrato que falla**

Agregar `'GET /api/v1/users/me/scopes'` a `expectedOperations` y una prueba: bearer, params `type/page/limit`, respuestas 200/400/401/403, componentes `UserScope`/`PaginatedUserScopes`, `OwnPermission` reutilizado.

- [ ] **Step 2: Implementar path y descripción**

Descripción: solo colaboraciones directas para USER; herencia del programa resuelta en `permissions` de actividades (`INHERITED`/`BOTH`); vigencia al momento de la petición; estados no públicos incluidos; ADMIN catálogo completo `LOCAL` ilimitado; orden `name, id` binario; página vacía (nunca 404); sin `grantedById`/`grantedAt`.

- [ ] **Step 3: Regenerar y verificar**

Run: `pnpm exec vitest run src/docs && pnpm run docs:generate && pnpm run docs:check`.

---

### Task 5: Bruno `My_Scopes`

**Files:**

- Create: `bruno/My_Scopes/Log in as FISC head.bru` (seq 1, IP propia `203.0.113.240`)
- Create: `bruno/My_Scopes/Get my scopes.bru` (seq 2)
- Create: `bruno/My_Scopes/Get my program scopes.bru` (seq 3)
- Create: `bruno/My_Scopes/Get my activity scopes.bru` (seq 4)
- Create: `bruno/My_Scopes/Get my scopes with an invalid type returns 400.bru` (seq 5)
- Create: `bruno/My_Scopes/Get my scopes without a token returns 401.bru` (seq 6)

Run: `pnpm --dir bruno exec bru run My_Scopes --env local`.

---

### Task 6: Verificacion E2E real

Stack Docker dev + seed demo: login aislado por IP de admin/head/editor/estudiante; contraste con psql; `type`/paginación/400/401/403; estado efectivo; ausencia de auditoría; conteos baseline intactos (cero escrituras).

---

### Task 7: Documentacion y gates

- `CONTEXT.md`, `README.md`: bullet en «Colaboradores Por Scope».
- `AGENTS.md`: línea en el modelo de autorización.
- Plan maestro: `3.11 Descubrir scopes propios`, endpoints y registro de ejecución.
- `docs/adr/adr-0011-user-scope-discovery.md`: contrato y decisiones confirmadas.
- Gates: `pnpm test`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, `pnpm run build`, `pnpm run docs:generate && pnpm run docs:check`.
