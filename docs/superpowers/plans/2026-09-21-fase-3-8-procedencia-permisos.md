# Fase 3.8 - Exponer procedencia de permisos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exponer la procedencia (`LOCAL`, `INHERITED`, `BOTH`) y la vigencia efectiva de los permisos en los listados de colaboradores (`GET /event-programs/:id/collaborators` y `GET /activities/:id/collaborators`) y en `GET /users/me/permissions`, sin devolver `grantedById` ni `grantedAt`.

**Architecture:** Se extiende `src/modules/authorization/`. Un unico resolutor (`resolvePermissionEntries`) fusiona los grants locales y heredados conservando la procedencia, filtra por ventana vigente y devuelve el envelope efectivo; lo consumen `listOwnPermissions` (procedencia del propio usuario) y `listCollaborators` (procedencia por colaborador, incluida la herencia del programa padre para las colaboraciones locales del scope de actividad). Las respuestas de mutacion (`POST`/`PATCH`) conservan el `Collaborator` actual con sus grants locales materializados, sin `origin`/`effective`.

**Tech Stack:** TypeScript 6, Express 5, Prisma 7 (SQL/Postgres), Zod 4, Vitest, Supertest, OpenAPI 3.1 (zod-openapi), Bruno.

**Hallazgos de partida (2026-09-21):**

- `getPermissionEnvelopes` (`authorization.service.ts:70`) ya fusiona actividad + programa y filtra por vigencia, pero pierde la procedencia.
- `getEffectivePermissions` (`authorization.service.ts:131`) queda intacto: es el consumidor de `requirePermission` y de los servicios.
- `listCollaborators` (`delegation.service.ts:173`) devuelve los grants locales sin filtrar, con `toCollaboratorDetail`; `collaboratorSelect` no expone `eventProgramId`/`activityId` de la colaboracion.
- `listOwnPermissions` (`authorization.service.ts:150`) devuelve la union efectiva sin procedencia; 3.7 difirio explicitamente la procedencia a 3.8.
- Seed demo para E2E: `seed_activity_fisc-charla-ia` pertenece al programa predeterminado de FISC (`seed_program_fisc_default`); `editor` es `EDITOR` en la actividad (11 defaults locales) y en el programa (11 defaults + `certificate:generate` `OVERRIDE` vigente). No hay usuario con `INHERITED` puro en la actividad: se crea uno temporal en la verificacion.
- Componentes OpenAPI: `Collaborator`/`CollaboratorPermission`/`CollaboratorList` solo se usan en respuestas de colaboradores; `OwnPermission`/`OwnPermissions` en permisos propios. Renombrar `CollaboratorPermission` es breaking y evitable: se crea `CollaboratorListPermission` y `Collaborator`/`CollaboratorPermission` quedan solo para mutaciones.

**Decisiones confirmadas con el usuario (2026-09-21):**

1. Alcance: los dos listados de colaboradores y `GET /users/me/permissions` (cierra el pendiente que 3.7 difirio a 3.8).
2. Forma del DTO del listado: `{ name, source, origin: LOCAL|INHERITED|BOTH, validFrom, validUntil, effective: true }`; solo grants vigentes (los vencidos/futuros se omiten de la respuesta y siguen en BD).
3. Respuestas de mutacion (`POST`/`PATCH` de colaboradores y permisos): sin cambios, mantienen los grants locales materializados.

**Semantica de `origin`:**

- Scope programa: todo `LOCAL` (los grants del programa no heredan de otro scope).
- Scope actividad: `LOCAL` = grant de la colaboracion local de la actividad; `INHERITED` = grant vigente del programa padre; `BOTH` = coexisten ambos (el envelope efectivo es la fusion).
- `GET /users/me/permissions`: `LOCAL` o `INHERITED` (un permiso de usuario no puede ser `BOTH` con el modelo aditivo actual); `ADMIN` recibe el catalogo completo como `LOCAL` (bypass sin colaboraciones).
- `effective` documenta que la respuesta solo contiene grants vigentes (`true` siempre); el campo deja lugar a futuras vistas historicas.

---

### Task 1: Tipos y resolutor de procedencia (TDD)

**Files:**

- Modify: `src/modules/authorization/authorization.types.ts`
- Modify: `src/modules/authorization/authorization.service.ts`
- Test: `src/modules/authorization/authorization.service.test.ts`

- [x] **Step 1: Agregar los tipos**

En `authorization.types.ts`:

```ts
export type PermissionOrigin = 'LOCAL' | 'INHERITED' | 'BOTH';

export interface PermissionProvenance {
  envelope: GrantEnvelope;
  origin: PermissionOrigin;
}

export interface CollaboratorListPermissionDetail {
  name: string;
  source: PermissionGrantSource;
  origin: PermissionOrigin;
  validFrom: string | null;
  validUntil: string | null;
  effective: boolean;
}

export interface CollaboratorListDetail {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: CollaborationRole;
  createdAt: string;
  permissions: CollaboratorListPermissionDetail[];
}

export interface CollaboratorList {
  items: CollaboratorListDetail[];
}
```

Y agregar `origin: PermissionOrigin;` a `OwnPermissionEnvelope`.

- [x] **Step 2: Escribir las pruebas que fallan**

En `authorization.service.test.ts`, agregar:

```ts
it('marks own permissions as local or inherited by their source scope', async () => {
  const prisma = createPrismaMock();
  prisma.activity.findUnique.mockResolvedValue({ eventProgramId: 'p1' });
  prisma.collaboration.findMany.mockResolvedValue([
    { eventProgramId: 'p1', activityId: null, permissions: [grant(PERMISSIONS.REPORT_VIEW)] },
    { eventProgramId: null, activityId: 'a1', permissions: [grant(PERMISSIONS.ACTIVITY_UPDATE)] },
  ]);
  const { listOwnPermissions } = await loadService(prisma);

  const result = await listOwnPermissions(buildUser(), { type: 'activity', id: 'a1' }, NOW);

  expect(result.permissions).toEqual([
    { name: PERMISSIONS.ACTIVITY_UPDATE, origin: 'LOCAL', validFrom: null, validUntil: null },
    { name: PERMISSIONS.REPORT_VIEW, origin: 'INHERITED', validFrom: null, validUntil: null },
  ]);
});

it('marks every own permission as local in a program scope', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1' });
  prisma.collaboration.findMany.mockResolvedValue([
    { eventProgramId: 'p1', activityId: null, permissions: [grant(PERMISSIONS.ACTIVITY_READ)] },
  ]);
  const { listOwnPermissions } = await loadService(prisma);

  const result = await listOwnPermissions(buildUser(), { type: 'program', id: 'p1' }, NOW);

  expect(result.permissions).toEqual([
    { name: PERMISSIONS.ACTIVITY_READ, origin: 'LOCAL', validFrom: null, validUntil: null },
  ]);
});
```

Y en la prueba de ADMIN existente, agregar la asercion de `origin: 'LOCAL'`.

- [x] **Step 3: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/authorization/authorization.service.test.ts`
Expected: FAIL porque `origin` no existe en el DTO.

- [x] **Step 4: Implementar el resolutor y el servicio**

En `authorization.service.ts`, agregar el helper y ajustar `listOwnPermissions`.

- [x] **Step 5: Verificar el verde**

Run: `pnpm exec vitest run src/modules/authorization/authorization.service.test.ts`
Expected: PASS.

---

### Task 2: Procedencia en el listado de colaboradores (TDD)

**Files:**

- Modify: `src/modules/authorization/delegation.service.ts`
- Test: `src/modules/authorization/delegation.service.test.ts`

- [x] **Step 1: Escribir las pruebas que fallan**

Nuevas pruebas de servicio: heredado puro en actividad, local+heredado `BOTH` con envelope fusionado, vencido local omitido y cubierto por herencia, programa todo `LOCAL`. Se actualizan las dos pruebas existentes que esperan todos los grants locales (se les agrega `eventProgramId`/`activityId` y `origin`/`effective`).

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/authorization/delegation.service.test.ts`
Expected: FAIL por `origin`/`effective` y por la forma nueva del listado.

- [x] **Step 3: Implementar**

`collaboratorSelect` gana `eventProgramId`/`activityId`; `listCollaborators` resuelve programa y actividad, carga las colaboraciones del scope mas las del programa (para actividad) y llama a `resolvePermissionEntries` por colaborador.

- [x] **Step 4: Verificar el verde**

Run: `pnpm exec vitest run src/modules/authorization/delegation.service.test.ts`
Expected: PASS.

---

### Task 3: Esquemas y DTO (TDD)

**Files:**

- Modify: `src/modules/authorization/authorization.schemas.ts`
- Test: `src/modules/authorization/authorization.schemas.test.ts`

- [x] **Step 1: Pruebas que fallan** para `collaboratorListSchema` con `origin`/`effective` y `ownPermissionsSchema` con `origin`.
- [x] **Step 2: Verificar el rojo** con `pnpm exec vitest run src/modules/authorization/authorization.schemas.test.ts`.
- [x] **Step 3: Implementar** `collaboratorListPermissionSchema` (componente `CollaboratorListPermission`), `collaboratorListDetailSchema` (componente `CollaboratorListDetail`) y `origin` en `ownPermissionSchema`.
- [x] **Step 4: Verificar el verde.**

---

### Task 4: OpenAPI (TDD)

**Files:**

- Modify: `src/modules/authorization/authorization.openapi.ts`
- Modify: `src/docs/openapi.test.ts`
- Generate: `openapi.json`

- [x] **Step 1: Prueba de contrato que falla**: `CollaboratorListPermission` existe con `origin`; `OwnPermission` tiene `origin`; descripciones actualizadas.
- [x] **Step 2: Verificar el rojo** con `pnpm exec vitest run src/docs/openapi.test.ts`.
- [x] **Step 3: Implementar** descripciones de listado y permisos propios.
- [x] **Step 4: Verde + `pnpm run docs:generate` + `pnpm run docs:check` sin drift.**

---

### Task 5: Bruno

**Files:**

- Modify: `bruno/Collaborators/List program collaborators.bru`
- Modify: `bruno/Collaborators/List activity collaborators.bru`
- Modify: `bruno/My_Permissions/Get my permissions in an activity.bru`
- Modify: `bruno/My_Permissions/Get my permissions in a program.bru`

- [x] **Step 1: Ampliar las assertions** (programa `origin: LOCAL`, actividad `origin` LOCAL/INHERITED, propios `origin`).
- [x] **Step 2: `pnpm exec bru run Collaborators --env local` y `pnpm exec bru run My_Permissions --env local` en verde.**

---

### Task 6: Verificacion E2E real (Docker + psql)

- [x] **Step 1: Baseline** de `collaborations` y `collaboration_permissions` con psql.
- [x] **Step 2: Usuario temporal** (`e2e-3-8@utp.ac.pa`, VIEWER) agregado a `seed_activity_fisc-charla-ia`; listado de la actividad muestra sus 5 defaults del programa como `INHERITED` con `effective: true`.
- [x] **Step 3: `OVERRIDE` local vencido** de `permission:grant` sobre el usuario temporal; el listado no lo muestra y psql confirma que la fila local vencida sigue en BD (anticipo de 3.9); si el programa aporta el permiso vigente, el resultado es `INHERITED`.
- [x] **Step 4: `/users/me/permissions`** de head (programa) y editor (actividad) con `origin` contrastado con psql.
- [x] **Step 5: Programa**: listado de `congreso-cit` con `origin: LOCAL` en todos y sin `grantedById`/`grantedAt`.
- [x] **Step 6: Limpieza total** y conteos baseline restaurados.

---

### Task 7: Documentacion, plan maestro y gates

**Files:**

- Modify: `CONTEXT.md`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [x] **Step 1-3: Bullets de procedencia** en `### Colaboradores Por Scope` de CONTEXT y README, y en el modelo de autorizacion de AGENTS.
- [x] **Step 4: Plan maestro**: marcar 3.8, actualizar tabla de estado y endpoints, y agregar registro de ejecucion.
- [x] **Step 5: Gates finales**: `pnpm test`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check`, `pnpm run build`, `pnpm run docs:generate && pnpm run docs:check`.
- [x] **Step 6: Cierre** sin commit salvo solicitud explicita.
