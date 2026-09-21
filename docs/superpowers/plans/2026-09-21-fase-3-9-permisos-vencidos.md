# Fase 3.9 - Ignorar permisos vencidos sin borrarlos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Demostrar con reloj controlado (fake timers) y verificacion real que los grants vencidos o futuros se ignoran al resolver permisos y que las filas permanecen en `collaboration_permissions` (historico), sin cambios de contrato.

**Architecture:** Item de verificacion. No hubo cambios de produccion: `isGrantActive` (`authorization.service.ts:27`) define la semantica (validFrom inclusivo, validUntil exclusivo) y todos los caminos de decision filtran por vigencia. Se agregaron pruebas de caracterizacion con `vi.useFakeTimers({ toFake: ['Date'] })` en el servicio de autorizacion, el servicio de delegacion y las rutas (con el resolutor real, antes mockeado), y una verificacion E2E con PostgreSQL.

**Tech Stack:** TypeScript 6, Express 5, Prisma 7 (SQL/Postgres), Zod 4, Vitest 4, Supertest, OpenAPI 3.1, Bruno.

**Hallazgos de partida (2026-09-21):**

- `isGrantActive` (`authorization.service.ts:27`) no tenia pruebas directas de frontera: `validUntil === now` debe ser inactivo y `validFrom === now` activo.
- Los caminos que filtran por vigencia: `getPermissionEnvelopes` (`authorization.service.ts:128`), `resolvePermissionEntries` (`:65`), `canDelegate` (`delegation.service.ts:435`), `assertScopeKeepsDelegator` (`:442`), `assertRevokeKeepsDelegator` (`:592`) y la comprobacion de herencia de `revokePermission` (`:689`). `requirePermission` consume `getEffectivePermissions`.
- No existe borrado automatico de grants vencidos: solo `updateCollaboratorRole` (reemplazo de `ROLE_DEFAULT` por cambio de rol), `removeCollaborator` (cascada) y `revokePermission` (accion explicita). No hay triggers de prune en las migraciones.
- No habia ningun `vi.useFakeTimers` en el repo; las pruebas existentes pasan `now` explicito. Los tests de rutas mockean `./authorization.service.js`, por lo que el filtro real por reloj no se ejercia por HTTP.
- Seed demo: `visor` (`visor.eventos@utp.ac.pa`) tiene un `OVERRIDE` vencido de `report:export` en `seed_program_fct_default` (offsets -30/-1 dias). Password demo `Sipeg2026*UTP`. Caso historico ideal para E2E.
- Respuestas de mutacion conservan los grants locales materializados (decision 3.8 #3): no se filtran por vigencia.

**Decisiones confirmadas con el usuario (2026-09-21):**

1. Alcance solo pruebas + E2E + registro; sin cambios de contrato. Las respuestas de mutacion siguen como decidio 3.8.
2. Reloj controlado en servicio y en ruta con el resolutor real (`toFake: ['Date']`), mas E2E con filas reales vencidas/futuras.
3. Sin cambios de OpenAPI ni Bruno; `docs:check` confirma ausencia de drift.

**No-vacuidad:** como la implementacion ya cumple, se verifico que las pruebas nuevas no son vacuas rompiendo temporalmente `isGrantActive` (retorno `true`), observando el rojo esperado y restaurando el codigo (7 fallos en autorizacion, 7 en delegacion y 2 en rutas).

---

### Task 1: Fronteras de `isGrantActive` con reloj controlado

**Files:**

- Modify: `src/modules/authorization/authorization.service.test.ts`

- [x] **Step 1: Escribir las pruebas que fallan**

Nuevo describe `isGrantActive with a controlled clock` con `vi.useFakeTimers({ toFake: ['Date'] })` y `vi.setSystemTime(NOW)`: `validUntil === now` inactivo (exclusivo), `now + 1ms` activo, `validFrom === now` activo (inclusivo), `now + 1ms` inactivo y ambos `null` activo.

- [x] **Step 2: Verificar el rojo por no-vacuidad**

Con `isGrantActive` forzado a `true` fallaron 7 pruebas del archivo (fronteras + vencidos preexistentes); restaurado.

- [x] **Step 3: Verificar el verde**

Run: `pnpm exec vitest run src/modules/authorization/authorization.service.test.ts`
Expected: PASS (24 pruebas).

---

### Task 2: Resolutor con reloj del sistema y `now` por defecto

**Files:**

- Modify: `src/modules/authorization/authorization.service.test.ts`

- [x] **Step 1: Extender el mock Prisma**

`collaborationPermission: { create, update, deleteMany }` agregado a `createPrismaMock` para aseverar que las lecturas no escriben.

- [x] **Step 2: Escribir las pruebas que fallan**

Nuevo describe `expiry with the system clock and default now`: `getEffectivePermissions` y `listOwnPermissions` sin argumento `now`; grant con `validUntil = T0 + 1h` presente en `T0`, ausente en `T0 + 1h` y en `T0 + 2h`; `create/update/deleteMany` nunca llamados.

- [x] **Step 3: Verificar el rojo por no-vacuidad**

Con `isGrantActive` roto fallaron las pruebas de reloj; restaurado.

- [x] **Step 4: Verificar el verde**

Run: `pnpm exec vitest run src/modules/authorization/authorization.service.test.ts`
Expected: PASS.

---

### Task 3: Delegacion con reloj del sistema

**Files:**

- Modify: `src/modules/authorization/delegation.service.test.ts`

- [x] **Step 1: Escribir las pruebas que fallan**

Nuevo describe `delegation service expiry with the system clock and default now`:

- `listCollaborators` (programa) sin `now`: grant que vence en `T0`; presente en `T0`, ausente en `T0` (frontera), sin `upsert/createMany/deleteMany`.
- `removeCollaborator` sin `now`: el unico delegador restante tiene `permission:grant` que vence en `T0`; en `T0 - 1ms` borra, en `T0` responde `409` y no borra.

- [x] **Step 2: Verificar el rojo por no-vacuidad**

Con `isGrantActive` roto fallaron 7 pruebas del archivo; restaurado.

- [x] **Step 3: Verificar el verde**

Run: `pnpm exec vitest run src/modules/authorization/delegation.service.test.ts`
Expected: PASS (63 pruebas).

---

### Task 4: Ruta con resolutor real y reloj controlado

**Files:**

- Modify: `src/modules/authorization/authorization.routes.test.ts`

- [x] **Step 1: Extender el mock Prisma y agregar el loader real**

`PrismaMock` gano `collaboration.findMany`, `collaborationPermission.{create,update,deleteMany}` y `eventProgram.findUnique`; helper `loadAppWithRealAuthorization` identico a `loadApp` pero sin mockear `./authorization.service.js`.

- [x] **Step 2: Escribir las pruebas que fallan**

Nuevo describe `authorization routes expiry with the real resolver and a controlled clock`:

- `GET /event-programs/:id/collaborators` con `permission:grant` que vence en `CLOCK`: 200 en `CLOCK - 1ms`, 403 en `CLOCK`; sin escrituras.
- `GET /users/me/permissions?scope=program&id=` con grants activo/vencido/futuro: en `CLOCK` solo el activo; en `CLOCK + 1h` se suma el futuro; sin escrituras.

- [x] **Step 3: Verificar el rojo por no-vacuidad**

Con `isGrantActive` roto fallaron exactamente las 2 pruebas nuevas; restaurado.

- [x] **Step 4: Verificar el verde**

Run: `pnpm exec vitest run src/modules/authorization/authorization.routes.test.ts`
Expected: PASS (53 pruebas).

---

### Task 5: Verificacion E2E real (Docker + psql)

- [x] **Step 1: Baseline**: `collaboration_permissions = 238`; fila `OVERRIDE` de `visor` (`report:export`, `valid_until 2026-09-19 01:42 UTC`) confirmada.
- [x] **Step 2: Login admin/visor**; `/users/me/permissions` de `visor` en `seed_program_fct_default` devuelve 5 permisos y omite `report:export`; la fila sigue en BD.
- [x] **Step 3: Listado de colaboradores** de `seed_program_fct_default` como admin: la entrada de `visor` no incluye `report:export`, todos `effective: true`, sin `grantedById`/`grantedAt`.
- [x] **Step 4: Ciclo futuro por API**: `editor` agregado como VIEWER en `seed_program_congreso-cit` (201) y `POST .../permissions` con `validFrom` manana (200); `/users/me/permissions` de `editor` omite `report:export` mientras psql confirma la fila (conteo 244); `DELETE .../collaborators/seed_user_editor` 204 revierte el conteo a 238.
- [x] **Step 5: Middleware con grant vencido**: `permission:grant` vencido insertado por SQL para `visor` en fct; `GET .../collaborators` como visor responde 403 y la fila permanece; DELETE SQL posterior.
- [x] **Step 6: Limpieza total**: 238 filas, colaboracion de `editor` en `congreso-cit` en 0, fila vencida de `visor` intacta; logs de API sin errores.

---

### Task 6: Documentacion y gates

**Files:**

- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [x] **Step 1: Marcar 3.9**, actualizar la tabla de estado (“falta 3.10”) y agregar el registro de ejecucion 2026-09-21.
- [x] **Step 2: Gates finales**: `pnpm test` 925 en 45 archivos, `pnpm run typecheck`, `pnpm run lint`, `pnpm run build` y `pnpm run docs:generate && pnpm run docs:check` en verde; `pnpm run format:check` solo reporta el plan concurrente de 4.3 (`2026-09-21-fase-4-3-archivar-programa.md`).
- [x] **Step 3: Cierre** sin commit salvo solicitud explicita.
