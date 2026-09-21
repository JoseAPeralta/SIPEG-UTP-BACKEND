# Fase 3.7 - Consultar permisos propios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Exponer `GET /api/v1/users/me/permissions?scope=program|activity&id=` que devuelve los permisos efectivos del usuario autenticado en el scope pedido, cada uno con su envelope temporal (`validFrom`/`validUntil`), uniendo la herencia del programa padre con los grants locales de la actividad.

**Architecture:** Se extiende `src/modules/authorization/`. La ruta vive en `authorization.routes.ts` (tag OpenAPI `Collaborators`) y usa `authenticate -> validate(query) -> controlador -> servicio`. El servicio reutiliza `resolveScope` y `getPermissionEnvelopes` de `authorization.service.ts`, agrega la guarda de programa inexistente (`resolveScope` solo valida actividades) y mapea el `Map` a un DTO ordenado. Sin migraciones, variables de entorno ni permisos nuevos.

**Tech Stack:** TypeScript 6, Express 5, Prisma 7 (SQL/Postgres), Zod 4, Vitest, Supertest, OpenAPI 3.1 (zod-openapi), Bruno.

**Hallazgos de partida (2026-09-21):**

- `getPermissionEnvelopes` (`authorization.service.ts:64`) ya calcula el envelope por permiso: union aditiva de colaboraciones de la actividad y del programa padre, ignora grants vencidos/futuros y `ADMIN` recibe el catalogo completo sin tocar BD.
- `resolveScope` (`authorization.service.ts:43`) valida actividad inexistente con `404 Activity not found.` pero para un programa solo devuelve `{ eventProgramId }` sin consultar BD.
- `requirePermission` no se usa en 3.7: cualquier usuario autenticado puede leer sus propios permisos; la autorizacion es sobre el dato propio, no sobre el scope.
- Seed demo: `org-fisc` tiene un `OVERRIDE` de `permission:grant` en `congreso-cit` con ventana `[now, now+60d]`; `editor` tiene `certificate:generate` en `fisc` con `[-1d,+30d]`; `visor` tiene `report:export` en `fct` con `[-30d,-1d]` (vencido, se ignora sin borrarse). `seed_activity_fisc-charla-ia` pertenece al programa predeterminado de FISC, donde `org-fisc` es `ORGANIZER`.
- **Concurrencia:** las sesiones de 3.6 (revocar permiso) y 4.3 (archivar programa) editan en paralelo `authorization.schemas.ts`, `authorization.controller.ts`, `authorization.routes.ts`, `authorization.openapi.ts` y `src/docs/openapi.test.ts`. Este plan usa edits puntuales con anclas unicas, una carpeta Bruno propia (`My_Permissions`) y re-lectura antes de cada edicion.

**Decisiones confirmadas con el usuario (2026-09-21):**

1. Respuesta: lista plana `{ scope: { type, id }, permissions: [{ name, validFrom, validUntil }] }` con permisos efectivos ya unidos. La procedencia `inherited`/`local`/`effective` queda para 3.8.
2. Scope inexistente: `404` (programa o actividad); si el recurso existe, `200` con lista (posiblemente vacia) aunque el programa este `DRAFT` o `ARCHIVED`.
3. Ubicacion: modulo `authorization` y tag OpenAPI `Collaborators`.

---

### Task 1: Tipos y servicio (TDD)

**Files:**

- Modify: `src/modules/authorization/authorization.types.ts`
- Modify: `src/modules/authorization/authorization.service.ts`
- Test: `src/modules/authorization/authorization.service.test.ts`

- [x] **Step 1: Agregar los tipos**

Al final de `authorization.types.ts`:

```ts
export interface OwnPermissionsScope {
  type: 'program' | 'activity';
  id: string;
}

export interface OwnPermissionEnvelope {
  name: string;
  validFrom: string | null;
  validUntil: string | null;
}

export interface OwnPermissions {
  scope: OwnPermissionsScope;
  permissions: OwnPermissionEnvelope[];
}
```

- [x] **Step 2: Escribir las pruebas que fallan**

En `authorization.service.test.ts`, agregar `eventProgram` al mock:

```ts
interface PrismaMock {
  collaboration: { findMany: ReturnType<typeof vi.fn> };
  activity: { findUnique: ReturnType<typeof vi.fn> };
  eventProgram: { findUnique: ReturnType<typeof vi.fn> };
}

const createPrismaMock = (): PrismaMock => ({
  collaboration: { findMany: vi.fn() },
  activity: { findUnique: vi.fn() },
  eventProgram: { findUnique: vi.fn() },
});
```

Y agregar al `describe('authorization service', ...)`:

```ts
it('lists own permissions for a program scope with merged envelopes sorted by name', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1' });
  prisma.collaboration.findMany.mockResolvedValue([
    collaboration(
      grant(PERMISSIONS.REPORT_VIEW),
      grant(
        PERMISSIONS.ACTIVITY_UPDATE,
        new Date('2026-09-19T10:00:00.000Z'),
        new Date('2026-09-19T15:00:00.000Z'),
      ),
      grant(
        PERMISSIONS.ACTIVITY_UPDATE,
        new Date('2026-09-19T11:00:00.000Z'),
        new Date('2026-09-19T18:00:00.000Z'),
      ),
    ),
  ]);
  const { listOwnPermissions } = await loadService(prisma);

  const result = await listOwnPermissions(buildUser(), { type: 'program', id: 'p1' }, NOW);

  expect(prisma.eventProgram.findUnique).toHaveBeenCalledWith({
    where: { id: 'p1' },
    select: { id: true },
  });
  expect(result).toEqual({
    scope: { type: 'program', id: 'p1' },
    permissions: [
      {
        name: PERMISSIONS.ACTIVITY_UPDATE,
        validFrom: '2026-09-19T10:00:00.000Z',
        validUntil: '2026-09-19T18:00:00.000Z',
      },
      { name: PERMISSIONS.REPORT_VIEW, validFrom: null, validUntil: null },
    ],
  });
});

it('resolves the activity scope and unions inherited program grants', async () => {
  const prisma = createPrismaMock();
  prisma.activity.findUnique.mockResolvedValue({ eventProgramId: 'program-001' });
  prisma.collaboration.findMany.mockResolvedValue([
    collaboration(grant(PERMISSIONS.PROGRAM_READ)),
    collaboration(grant(PERMISSIONS.ATTENDANCE_CHECKIN)),
  ]);
  const { listOwnPermissions } = await loadService(prisma);

  const result = await listOwnPermissions(
    buildUser(),
    { type: 'activity', id: 'activity-001' },
    NOW,
  );

  expect(prisma.collaboration.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        userId: 'user-001',
        OR: [{ eventProgramId: 'program-001' }, { activityId: 'activity-001' }],
      },
    }),
  );
  expect(result.scope).toEqual({ type: 'activity', id: 'activity-001' });
  expect(result.permissions.map((entry) => entry.name)).toEqual([
    PERMISSIONS.ATTENDANCE_CHECKIN,
    PERMISSIONS.PROGRAM_READ,
  ]);
});

it('returns every permission with unbounded envelopes for ADMIN', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1' });
  const { listOwnPermissions } = await loadService(prisma);

  const result = await listOwnPermissions(
    buildUser({ globalRole: 'ADMIN' }),
    { type: 'program', id: 'p1' },
    NOW,
  );

  expect(result.permissions).toHaveLength(PERMISSION_NAMES.length);
  expect(
    result.permissions.every((entry) => entry.validFrom === null && entry.validUntil === null),
  ).toBe(true);
  expect(prisma.collaboration.findMany).not.toHaveBeenCalled();
});

it('ignores expired and future grants without exposing them', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1' });
  prisma.collaboration.findMany.mockResolvedValue([
    collaboration(
      grant(PERMISSIONS.REPORT_EXPORT, null, new Date('2026-09-19T11:59:59.000Z')),
      grant(PERMISSIONS.ACTIVITY_CANCEL, new Date('2026-09-19T12:00:01.000Z')),
      grant(PERMISSIONS.ACTIVITY_READ),
    ),
  ]);
  const { listOwnPermissions } = await loadService(prisma);

  const result = await listOwnPermissions(buildUser(), { type: 'program', id: 'p1' }, NOW);

  expect(result.permissions).toEqual([
    { name: PERMISSIONS.ACTIVITY_READ, validFrom: null, validUntil: null },
  ]);
});

it('throws 404 when the event program does not exist', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue(null);
  const { listOwnPermissions } = await loadService(prisma);

  await expect(
    listOwnPermissions(buildUser(), { type: 'program', id: 'missing' }, NOW),
  ).rejects.toMatchObject({ statusCode: 404, message: 'Event program not found.' });
  expect(prisma.collaboration.findMany).not.toHaveBeenCalled();
});

it('throws 404 when the activity does not exist', async () => {
  const prisma = createPrismaMock();
  prisma.activity.findUnique.mockResolvedValue(null);
  const { listOwnPermissions } = await loadService(prisma);

  await expect(
    listOwnPermissions(buildUser(), { type: 'activity', id: 'missing' }, NOW),
  ).rejects.toMatchObject({ statusCode: 404, message: 'Activity not found.' });
});
```

- [x] **Step 3: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/authorization/authorization.service.test.ts`
Expected: FAIL porque `listOwnPermissions` no existe.

- [x] **Step 4: Implementar el servicio**

En `authorization.service.ts`, extender el import de tipos y agregar la funcion al final:

```ts
import type {
  AuthorizationScope,
  GrantEnvelope,
  OwnPermissions,
  OwnPermissionsScope,
  ResolvedScope,
} from './authorization.types.js';

export const listOwnPermissions = async (
  user: Express.AuthenticatedUser,
  scope: OwnPermissionsScope,
  now: Date = new Date(),
): Promise<OwnPermissions> => {
  const authorizationScope: AuthorizationScope =
    scope.type === 'activity' ? { activityId: scope.id } : { eventProgramId: scope.id };

  const resolved = await resolveScope(authorizationScope);

  if (!resolved.activityId) {
    const program = await getPrismaClient().eventProgram.findUnique({
      where: { id: resolved.eventProgramId },
      select: { id: true },
    });

    if (!program) {
      throw new ApiError(404, 'Event program not found.');
    }
  }

  const envelopes = await getPermissionEnvelopes(user, authorizationScope, now);

  return {
    scope: { type: scope.type, id: scope.id },
    permissions: [...envelopes.entries()]
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([name, envelope]) => ({
        name,
        validFrom: envelope.validFrom ? envelope.validFrom.toISOString() : null,
        validUntil: envelope.validUntil ? envelope.validUntil.toISOString() : null,
      })),
  };
};
```

- [x] **Step 5: Verificar el verde**

Run: `pnpm exec vitest run src/modules/authorization/authorization.service.test.ts`
Expected: PASS.

---

### Task 2: Esquemas (TDD)

**Files:**

- Modify: `src/modules/authorization/authorization.schemas.ts`
- Test: `src/modules/authorization/authorization.schemas.test.ts`

- [x] **Step 1: Escribir las pruebas que fallan**

Agregar `ownPermissionsQuerySchema` al import existente y el nuevo `describe` al final del archivo:

```ts
import {
  addCollaboratorSchema,
  collaboratorParamsSchema,
  collaboratorUserParamsSchema,
  grantPermissionSchema,
  ownPermissionsQuerySchema,
  revokePermissionSchema,
  updateCollaboratorRoleSchema,
} from './authorization.schemas.js';

describe('own permissions query schema', () => {
  it('trims the scope identifier', () => {
    const parsed = ownPermissionsQuerySchema.parse({
      query: { scope: 'program', id: '  program-001  ' },
    });

    expect(parsed.query).toEqual({ scope: 'program', id: 'program-001' });
  });

  it('accepts the activity scope', () => {
    const parsed = ownPermissionsQuerySchema.parse({
      query: { scope: 'activity', id: 'activity-001' },
    });

    expect(parsed.query.scope).toBe('activity');
  });

  it('rejects an unknown scope', () => {
    expect(() => ownPermissionsQuerySchema.parse({ query: { scope: 'team', id: 'p1' } })).toThrow();
  });

  it('rejects a missing identifier', () => {
    expect(() => ownPermissionsQuerySchema.parse({ query: { scope: 'program' } })).toThrow();
  });

  it('rejects a blank identifier', () => {
    expect(() =>
      ownPermissionsQuerySchema.parse({ query: { scope: 'program', id: '   ' } }),
    ).toThrow();
  });

  it('rejects unknown query keys', () => {
    expect(() =>
      ownPermissionsQuerySchema.parse({
        query: { scope: 'program', id: 'p1', userId: 'user-002' },
      }),
    ).toThrow();
  });
});
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/authorization/authorization.schemas.test.ts`
Expected: FAIL porque `ownPermissionsQuerySchema` no existe.

- [x] **Step 3: Implementar los esquemas**

En `authorization.schemas.ts`, extender el import de tipos con `OwnPermissions` y agregar al final:

```ts
import type {
  CollaboratorDetail,
  CollaboratorList,
  OwnPermissions,
} from './authorization.types.js';

export const ownPermissionsQuerySchema = z.object({
  query: z
    .object({
      scope: z.enum(['program', 'activity'], 'Scope is invalid.'),
      id: scopeIdSchema,
    })
    .strict(),
});

export type OwnPermissionsQuery = z.infer<typeof ownPermissionsQuerySchema>['query'];

const ownPermissionSchema = z
  .object({
    name: z.string(),
    validFrom: z.string().nullable().meta({
      description: 'ISO 8601 instant when the permission starts, or null when unbounded.',
    }),
    validUntil: z
      .string()
      .nullable()
      .meta({ description: 'ISO 8601 instant when the permission ends, or null when unbounded.' }),
  })
  .meta({
    id: 'OwnPermission',
    description: 'Effective permission of the authenticated user with its temporal envelope.',
  });

export const ownPermissionsSchema = z
  .object({
    scope: z.object({
      type: z.enum(['program', 'activity']),
      id: z.string(),
    }),
    permissions: z.array(ownPermissionSchema),
  })
  .meta({
    id: 'OwnPermissions',
    description:
      'Effective permissions of the authenticated user in an event program or activity scope.',
  }) satisfies z.ZodType<OwnPermissions>;
```

- [x] **Step 4: Verificar el verde**

Run: `pnpm exec vitest run src/modules/authorization/authorization.schemas.test.ts`
Expected: PASS.

---

### Task 3: Controlador, rutas y pruebas de ruta (TDD)

**Files:**

- Modify: `src/modules/authorization/authorization.controller.ts`
- Modify: `src/modules/authorization/authorization.routes.ts`
- Test: `src/modules/authorization/authorization.routes.test.ts`

- [x] **Step 1: Escribir las pruebas que fallan**

En `authorization.routes.test.ts`, extender `loadApp` con el mock de `listOwnPermissions`:

```ts
const loadApp = async (
  service: DelegationServiceMock,
  prisma = createPrismaMock(),
  permissions: string[] = [],
  getEffectivePermissions = vi.fn(),
  listOwnPermissions = vi.fn(),
) => {
  getEffectivePermissions.mockResolvedValue(new Set(permissions));
  // ... setup existente sin cambios ...
  vi.doMock('./authorization.service.js', () => ({ getEffectivePermissions, listOwnPermissions }));

  const { app } = await import('../../app.js');
  return app;
};
```

Agregar las pruebas (dentro del `describe` existente):

```ts
const ownPermissionsResult = {
  scope: { type: 'program', id: 'program-001' },
  permissions: [
    { name: 'activity:read', validFrom: null, validUntil: null },
    {
      name: 'report:export',
      validFrom: '2026-09-01T00:00:00.000Z',
      validUntil: '2026-10-01T00:00:00.000Z',
    },
  ],
};

it('rejects reading own permissions without a token', async () => {
  const service = buildServiceMock();
  const listOwnPermissions = vi.fn();
  const app = await loadApp(service, createPrismaMock(), [], vi.fn(), listOwnPermissions);

  await request(app).get('/api/v1/users/me/permissions?scope=program&id=program-001').expect(401);
  expect(listOwnPermissions).not.toHaveBeenCalled();
});

it('rejects an invalid scope before the service', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(userRecord);
  const listOwnPermissions = vi.fn();
  const app = await loadApp(service, prisma, [], vi.fn(), listOwnPermissions);

  await request(app)
    .get('/api/v1/users/me/permissions?scope=team&id=program-001')
    .set('Authorization', 'Bearer user-001')
    .expect(400);
  expect(listOwnPermissions).not.toHaveBeenCalled();
});

it('returns the own permissions of the authenticated user in a program scope', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(userRecord);
  const listOwnPermissions = vi.fn().mockResolvedValue(ownPermissionsResult);
  const app = await loadApp(service, prisma, [], vi.fn(), listOwnPermissions);

  const response = await request(app)
    .get('/api/v1/users/me/permissions?scope=program&id=program-001')
    .set('Authorization', 'Bearer user-001')
    .expect(200);

  expect(listOwnPermissions).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-001' }), {
    type: 'program',
    id: 'program-001',
  });
  expect(response.body).toEqual({
    success: true,
    message: 'Permissions retrieved successfully.',
    data: ownPermissionsResult,
  });
});

it('passes the activity scope to the service', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(userRecord);
  const listOwnPermissions = vi.fn().mockResolvedValue({
    scope: { type: 'activity', id: 'activity-001' },
    permissions: [],
  });
  const app = await loadApp(service, prisma, [], vi.fn(), listOwnPermissions);

  await request(app)
    .get('/api/v1/users/me/permissions?scope=activity&id=activity-001')
    .set('Authorization', 'Bearer user-001')
    .expect(200);

  expect(listOwnPermissions).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-001' }), {
    type: 'activity',
    id: 'activity-001',
  });
});

it('rejects a missing scope identifier before the service', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(userRecord);
  const listOwnPermissions = vi.fn();
  const app = await loadApp(service, prisma, [], vi.fn(), listOwnPermissions);

  await request(app)
    .get('/api/v1/users/me/permissions?scope=program')
    .set('Authorization', 'Bearer user-001')
    .expect(400);
  expect(listOwnPermissions).not.toHaveBeenCalled();
});

it('propagates a missing scope as 404', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(userRecord);
  const listOwnPermissions = vi.fn();
  const app = await loadApp(service, prisma, [], vi.fn(), listOwnPermissions);
  const { ApiError } = await import('../../utils/ApiError.js');
  listOwnPermissions.mockRejectedValue(new ApiError(404, 'Event program not found.'));

  await request(app)
    .get('/api/v1/users/me/permissions?scope=program&id=missing')
    .set('Authorization', 'Bearer user-001')
    .expect(404);
});
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/authorization/authorization.routes.test.ts`
Expected: FAIL con 404 en las rutas nuevas (y el mock sin `listOwnPermissions`).

- [x] **Step 3: Implementar controlador y ruta**

Controlador (extender imports y agregar al final):

```ts
import type {
  AddCollaboratorBody,
  GrantPermissionBody,
  OwnPermissionsQuery,
  UpdateCollaboratorRoleBody,
} from './authorization.schemas.js';
import {
  addCollaborator as addCollaboratorService,
  grantPermission as grantPermissionService,
  listCollaborators as listCollaboratorsService,
  listOwnPermissions as listOwnPermissionsService,
  removeCollaborator as removeCollaboratorService,
  updateCollaboratorRole as updateCollaboratorRoleService,
} from './delegation.service.js';
import { listOwnPermissions as listOwnPermissionsService } from './authorization.service.js';

export const getOwnPermissions: RequestHandler = asyncHandler(async (req, res) => {
  const query = req.query as unknown as OwnPermissionsQuery;
  const user = requireAuthenticatedUser(req);
  const result = await listOwnPermissionsService(user, { type: query.scope, id: query.id });

  res.status(200).json(successResponse('Permissions retrieved successfully.', result));
});
```

> Nota de implementacion: `listOwnPermissions` vive en `authorization.service.ts`, no en `delegation.service.ts`; importar desde el archivo correcto y no duplicar el nombre.

Ruta (extender imports y agregar al final):

```ts
import { getOwnPermissions } from './authorization.controller.js';
import {
  addCollaboratorSchema,
  collaboratorParamsSchema,
  collaboratorUserParamsSchema,
  grantPermissionSchema,
  ownPermissionsQuerySchema,
  updateCollaboratorRoleSchema,
} from './authorization.schemas.js';

authorizationRoutes.get(
  '/users/me/permissions',
  authenticate,
  validate(ownPermissionsQuerySchema),
  getOwnPermissions,
);
```

- [x] **Step 4: Verificar el verde**

Run: `pnpm exec vitest run src/modules/authorization/authorization.routes.test.ts`
Expected: PASS.

- [x] **Step 5: Suite dirigida**

Run: `pnpm exec vitest run src/modules/authorization src/modules/users src/docs`
Expected: PASS sin regresiones (si la sesion concurrente de 3.6 esta a mitad de edicion, repetir al cerrar).

---

### Task 4: OpenAPI (TDD)

**Files:**

- Modify: `src/modules/authorization/authorization.openapi.ts`
- Modify: `src/docs/openapi.test.ts`
- Generate: `openapi.json`

- [x] **Step 1: Prueba de contrato que falla**

En `expectedOperations`, agregar:

```ts
'GET /api/v1/users/me/permissions',
```

Y la prueba:

```ts
it('documents own permissions with bearer security, query params and envelopes', () => {
  const operation = openApiDocument.paths?.['/api/v1/users/me/permissions']?.get;
  const parameters = operation?.parameters ?? [];
  const names = parameters.map((parameter) => ('name' in parameter ? parameter.name : undefined));
  const schema = openApiDocument.components?.schemas?.['OwnPermissions'] as
    { properties?: Record<string, unknown> } | undefined;

  expect(operation?.security).toEqual([{ bearerAuth: [] }]);
  expect(names).toEqual(expect.arrayContaining(['scope', 'id']));
  expect(operation?.responses?.['200']).toBeDefined();
  expect(operation?.responses?.['400']).toBeDefined();
  expect(operation?.responses?.['401']).toBeDefined();
  expect(operation?.responses?.['404']).toBeDefined();
  expect(schema?.properties).toHaveProperty('permissions');
  expect(openApiDocument.components?.schemas).toHaveProperty('OwnPermission');
});
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/docs/openapi.test.ts`
Expected: FAIL: operacion `GET /api/v1/users/me/permissions` no documentada.

- [x] **Step 3: Implementar las rutas OpenAPI**

En `authorization.openapi.ts`, importar `ownPermissionsQuerySchema` y `ownPermissionsSchema`, agregar las respuestas y el path:

```ts
const ownPermissionsResponses = {
  200: {
    description: 'Effective permissions of the authenticated user in the requested scope.',
    content: { 'application/json': { schema: apiSuccessResponse(ownPermissionsSchema) } },
  },
  400: errorResponse,
  401: errorResponse,
  404: errorResponse,
} as const;

const ownPermissionsDescription =
  'Returns the effective permissions of the authenticated user in the requested program or activity scope with their temporal envelopes. Activity scopes union the activity-local grants with the ones inherited from the parent program; expired or future grants are ignored and never returned. ADMIN receives the whole catalog with unbounded envelopes. A null window means unbounded. Missing scopes respond 404.';

// dentro de authorizationPaths, al final:
  '/api/v1/users/me/permissions': {
    get: {
      tags: ['Collaborators'],
      summary: 'Get the authenticated user permissions in a scope',
      description: ownPermissionsDescription,
      security: [{ bearerAuth: [] }],
      requestParams: { query: ownPermissionsQuerySchema.shape.query },
      responses: ownPermissionsResponses,
    },
  },
```

- [x] **Step 4: Verificar el verde y regenerar el contrato**

Run: `pnpm exec vitest run src/docs/openapi.test.ts && pnpm run docs:generate && pnpm run docs:check`
Expected: PASS y `openapi.json` sin drift.

---

### Task 5: Bruno (carpeta propia `My_Permissions`)

**Files:**

- Create: `bruno/My_Permissions/Log in as FISC head.bru` (seq 1)
- Create: `bruno/My_Permissions/Get my permissions in a program.bru` (seq 2)
- Create: `bruno/My_Permissions/Get my permissions in an activity.bru` (seq 3)
- Create: `bruno/My_Permissions/Get my permissions with an invalid scope returns 400.bru` (seq 4)
- Create: `bruno/My_Permissions/Get my permissions for an unknown program returns 404.bru` (seq 5)
- Create: `bruno/My_Permissions/Get my permissions without a token returns 401.bru` (seq 6)

> Carpeta separada para no colisionar con los seq 46-61 que la sesion concurrente de 3.6 agrega a `Collaborators`. Usa las variables existentes `headEmail`, `headPassword`, `collaboratorsProgramId`, `collaboratorsActivityId` y `unknownProgramId` de `bruno/environments/local.bru`; no requiere variables nuevas.

- [x] **Step 1: Crear los requests**

`Log in as FISC head.bru` (patron de `Collaborators/Log in as admin to clean up grants.bru`, con IP propia para el rate limit):

```bru
meta {
  name: Log in as FISC head
  type: http
  seq: 1
  tags: [
    My_Permissions
  ]
}

post {
  url: {{baseUrl}}/api/v1/auth/login
  body: json
  auth: none
}

headers {
  X-Forwarded-For: 203.0.113.221
}

body:json {
  {
    "email": "{{headEmail}}",
    "password": "{{headPassword}}"
  }
}

script:post-response {
  const body = res.getBody();

  if (body?.success && body.data?.accessToken) {
    bru.setVar("token", body.data.accessToken);
    bru.setVar("refreshToken", body.data.refreshToken);
  }
}

tests {
  test("the FISC head logs in to read its permissions", function () {
    expect(res.getStatus()).to.equal(200);
    expect(res.getBody().data.accessToken).to.be.a("string");
  });
}
```

`Get my permissions in a program.bru`:

```bru
meta {
  name: Get my permissions in a program
  type: http
  seq: 2
  tags: [
    My_Permissions
  ]
}

get {
  url: {{baseUrl}}/api/v1/users/me/permissions?scope=program&id={{collaboratorsProgramId}}
  body: none
  auth: bearer
}

auth:bearer {
  token: {{token}}
}

tests {
  test("the head reads its bounded permission:grant envelope", function () {
    expect(res.getStatus()).to.equal(200);
    const body = res.getBody();
    expect(body.success).to.equal(true);
    expect(body.data.scope).to.eql({ type: "program", id: "seed_program_congreso-cit" });
    const grant = body.data.permissions.find((entry) => entry.name === "permission:grant");
    expect(grant).to.be.an("object");
    expect(grant.validFrom).to.be.a("string");
    expect(grant.validUntil).to.be.a("string");
  });
}
```

`Get my permissions in an activity.bru`:

```bru
meta {
  name: Get my permissions in an activity
  type: http
  seq: 3
  tags: [
    My_Permissions
  ]
}

get {
  url: {{baseUrl}}/api/v1/users/me/permissions?scope=activity&id={{collaboratorsActivityId}}
  body: none
  auth: bearer
}

auth:bearer {
  token: {{token}}
}

tests {
  test("the head inherits unbounded ORGANIZER defaults in the activity scope", function () {
    expect(res.getStatus()).to.equal(200);
    const body = res.getBody();
    expect(body.data.scope).to.eql({ type: "activity", id: "seed_activity_fisc-charla-ia" });
    const checkin = body.data.permissions.find((entry) => entry.name === "attendance:checkin");
    expect(checkin).to.be.an("object");
    expect(checkin.validFrom).to.equal(null);
    expect(checkin.validUntil).to.equal(null);
  });
}
```

`Get my permissions with an invalid scope returns 400.bru` (seq 4), `Get my permissions for an unknown program returns 404.bru` (seq 5) y `Get my permissions without a token returns 401.bru` (seq 6) siguen el patron de los requests de error existentes: bearer `{{token}}` (o `auth: none` en el 401) y tests con `expect(res.getStatus()).to.equal(400|404|401)` y `expect(res.getBody().success).to.equal(false)`. El 404 usa `id={{unknownProgramId}}`; el 400 usa `scope=team`.

- [x] **Step 2: Correr Bruno**

Run: `pnpm exec bru run My_Permissions --env local`
Expected: 6 requests y 6 tests en verde. Si el seed tiene mas de 60 dias, ejecutar antes `pnpm prisma:seed` (modo `sync`, idempotente) para refrescar la ventana del `OVERRIDE` de `permission:grant`.

---

### Task 6: Verificacion E2E real (Docker + psql)

**Files:** ninguno (verificacion manual con curl/psql).

- [x] **Step 1: Confirmar el stack y el baseline**

```bash
docker ps --format '{{.Names}}\t{{.Status}}'
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg -c "SELECT count(*) FROM collaborations; SELECT count(*) FROM collaboration_permissions;"
```

Expected: api/db arriba y conteos baseline (16 colaboraciones, 238 permisos tras el seed).

- [x] **Step 2: Logins con IP aislada**

```bash
for pair in "admin@utp.ac.pa:203.0.113.231" "organizador.fisc@utp.ac.pa:203.0.113.232" "editor.fisc@utp.ac.pa:203.0.113.233" "visor.eventos@utp.ac.pa:203.0.113.234" "estudiante01@utp.ac.pa:203.0.113.235"; do
  email="${pair%%:*}"; ip="${pair##*:}"
  curl -s -X POST http://localhost:3000/api/v1/auth/login -H 'Content-Type: application/json' -H "X-Forwarded-For: $ip" -d "{\"email\":\"$email\",\"password\":\"Sipeg2026*UTP\"}"
done
```

> Ajustar los correos a los del seed (`prisma/seed/users.seed.ts`) y guardar cada `accessToken` en variables de shell. Evitar mas de 5 logins por IP.

- [x] **Step 3: Contraste de permisos y envelopes**

1. Admin `?scope=program&id=seed_program_congreso-cit`: 200, 19 permisos, todos `validFrom`/`validUntil` null.
2. Head `?scope=program&id=seed_program_congreso-cit`: 200; `permission:grant` con `validFrom`/`validUntil` string; contrastar con
   `SELECT cp.valid_from, cp.valid_until FROM collaboration_permissions cp JOIN permissions p ON p.id = cp.permission_id JOIN collaborations c ON c.id = cp.collaboration_id JOIN users u ON u.id = c.user_id WHERE u.email='organizador.fisc@utp.ac.pa' AND p.name='permission:grant';`
3. Head `?scope=program&id=seed_program_fisc_default`: 200 con los 16 defaults de `ORGANIZER` sin `permission:grant`.
4. Editor `?scope=activity&id=seed_activity_fisc-charla-ia`: 200; union de defaults `EDITOR` (11) mas `certificate:generate` con la ventana `[-1d,+30d]` del `OVERRIDE` del programa.
5. Visor `?scope=program&id=seed_program_fct_default`: 200 sin `report:export` (grant vencido ignorado) y `SELECT count(*)` confirma que la fila sigue en `collaboration_permissions`.
6. Estudiante `?scope=program&id=seed_program_fic_default`: 200 con `permissions: []`.

- [x] **Step 4: Errores y minimizacion**

1. `scope=team` -> 400; `scope=program` sin `id` -> 400; `id` de solo espacios -> 400.
2. Programa inexistente -> 404 `Event program not found.`; actividad inexistente -> 404 `Activity not found.`
3. Sin token -> 401; token invalido -> 401; cuenta inactiva -> 403.
4. Confirmar que la respuesta no incluye `grantedById`, `grantedAt`, `source` ni datos de otros usuarios.

- [x] **Step 5: Confirmar cero escrituras**

```bash
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg -c "SELECT count(*) FROM collaborations; SELECT count(*) FROM collaboration_permissions;"
```

Expected: mismos conteos del baseline.

---

### Task 7: Documentacion, plan maestro y gates

**Files:**

- Modify: `CONTEXT.md`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [x] **Step 1: `CONTEXT.md`**

Agregar un bullet en `### Colaboradores Por Scope`:

```md
- `GET /api/v1/users/me/permissions?scope=program|activity&id=` (privado) devuelve los permisos efectivos del usuario autenticado en el scope con su envelope temporal (`name`, `validFrom`, `validUntil`; `null` = sin limite). En actividades une los grants locales con los heredados del programa padre; los grants vencidos o futuros se ignoran y no se devuelven. `ADMIN` recibe el catalogo completo con envelopes ilimitados. `scope` invalido o `id` ausente `400`; programa o actividad inexistente `404`.
```

- [x] **Step 2: `README.md`**

Agregar un bullet equivalente en `### Colaboradores Por Scope`, despues del POST de permisos.

- [x] **Step 3: `AGENTS.md`**

Agregar en el modelo de autorizacion por colaboracion:

```md
- `GET /api/v1/users/me/permissions?scope=program|activity&id=` expone los permisos efectivos propios con su envelope temporal; la procedencia (`inherited`/`local`) llega en 3.8.
```

- [x] **Step 4: Plan maestro**

Marcar 3.7 `[x]`, actualizar la fila de autorizacion en la tabla de estado y la lista de endpoints, y agregar `**Registro de ejecucion (2026-09-21 - 3.7):**` con hallazgos (`F3.7-A`: la guarda de programa inexistente vive en `listOwnPermissions` porque `resolveScope` solo valida actividades; `requirePermission` conserva su semantica de 403 para programas inexistentes. `F3.7-B`: `getPermissionEnvelopes` re-resuelve el scope de actividad para no-admin, consistente con `delegation.service`).

- [x] **Step 5: Gates finales**

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm run build
pnpm run docs:generate && pnpm run docs:check
```

Expected: todo en verde y `openapi.json` sin drift. Si archivos ajenos de las sesiones concurrentes fallan o expiran, repetir con `pnpm exec vitest run --testTimeout=20000` y reportar solo los archivos de 3.7.

- [x] **Step 6: Cierre**

Sin commit salvo solicitud explicita.
