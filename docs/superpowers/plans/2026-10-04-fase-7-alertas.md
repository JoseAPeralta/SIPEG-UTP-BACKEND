# Fase 7 - Alertas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exponer la bandeja in-app de alertas propias (listado, detalle, marcar una y marcar todas) y un helper `createAlert` reutilizable dentro de transacciones, con aislamiento estricto por destinatario.

**Architecture:** Modulo autocontenido `src/modules/alerts/` con tipos, esquemas Zod, servicio, controlador, rutas y OpenAPI. El modelo `Alert`, sus indices y el CHECK `alerts_target_check` ya existen en el esquema y las migraciones: no hay migracion, dependencia, permiso ni variable de entorno nueva. Lecturas y mutaciones siempre incluyen `recipientId` en el `where`; alerta ajena e inexistente comparten el mismo `404 Alert not found.` (incluso ADMIN). El destino se expone como union discriminada `{ kind, id }` sin revelar los cuatro FK anulables ni `recipientId`. `createAlert(tx, input)` exige un `Prisma.TransactionClient` y propaga errores para que la accion de dominio y la alerta se confirmen o reviertan juntas.

**Tech Stack:** TypeScript, Express 5, Prisma 7 (PostgreSQL), Zod 4, Vitest, Supertest, Bruno, Docker Compose.

**Decisiones confirmadas (2026-10-04):**

1. Se agrega `GET /api/v1/alerts/:id` para que "consultar" una alerta ajena produzca el mismo `404` que una inexistente (cumplimiento literal de 7.4).
2. Paginacion offset (`page` default 1, `limit` default 20, maximo 50), siguiendo el precedente de certificados.
3. Filtros `isRead` (literal `true`/`false`) y `type` (los ocho valores del enum), query `.strict()`.
4. Orden determinista `createdAt desc, id asc`.
5. `ADMIN` no recibe visibilidad global de alertas: solo las propias. "Solo propias" es literal.
6. `PATCH /alerts/:id/read` es idempotente y devuelve la alerta resultante; `POST /alerts/read-all` devuelve `{ updatedCount }`.
7. En Fase 7 no se conecta `createAlert` a acciones de dominio reales (programas, actividades, propuestas, certificados): eso pertenece a fases posteriores (8.8, 10.6, 12.1). Solo se construye y prueba la infraestructura.

**Reglas que no cambian:**

- `createAlert` no abre transacciones ni usa el cliente global: recibe `tx`.
- `createAlert` no deduplica alertas: no existe clave de evento de dominio; la idempotencia del dominio es trabajo futuro.
- La BD sigue siendo la ultima capa de cumplimiento del CHECK de destino; el tipo discriminado lo refleja en compilacion.
- Respuestas sin `recipientId`, sin FK internos y sin datos de otras tablas.
- Logs sin tokens, correos ni datos internos (no se agrega logging especifico).

**File structure:**

- Create: `src/modules/alerts/alerts.types.ts`
- Create: `src/modules/alerts/alerts.schemas.ts`
- Create: `src/modules/alerts/alerts.schemas.test.ts`
- Create: `src/modules/alerts/alerts.service.ts`
- Create: `src/modules/alerts/alerts.service.test.ts`
- Create: `src/modules/alerts/alerts.integration.test.ts`
- Create: `src/modules/alerts/alerts.controller.ts`
- Create: `src/modules/alerts/alerts.routes.ts`
- Create: `src/modules/alerts/alerts.routes.test.ts`
- Create: `src/modules/alerts/alerts.openapi.ts`
- Modify: `src/routes.ts`
- Modify: `src/docs/openapi.ts`
- Modify: `src/docs/openapi.test.ts`
- Modify: `openapi.json` (generado)
- Create: `bruno/Alerts/folder.bru` y requests
- Modify: `README.md`, `CONTEXT.md`
- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

---

### Task 1: Tipos y esquemas de alertas (TDD)

**Files:**

- Create: `src/modules/alerts/alerts.types.ts`
- Create: `src/modules/alerts/alerts.schemas.ts`
- Create: `src/modules/alerts/alerts.schemas.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

`alerts.schemas.test.ts`: prueba defaults y limites de paginacion, conversion de `isRead`, los ocho tipos, rechazo de query desconocida (`userId`, `recipientId`), params y body vacio estricto, serializacion de la respuesta y ausencia de campos internos.

- [ ] **Step 2: Verificar que falla**

Run: `pnpm exec vitest run src/modules/alerts/alerts.schemas.test.ts`
Expected: FAIL — el modulo `./alerts.schemas.js` no existe.

- [ ] **Step 3: Implementacion minima**

Tipos en `alerts.types.ts` y esquemas en `alerts.schemas.ts` segun el diseno (union discriminada de destino, DTO publico, paginado, resultado bulk, query estricta, params, body vacio estricto).

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm exec vitest run src/modules/alerts/alerts.schemas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (solo si el usuario lo pide)**

---

### Task 2: Servicio de lectura y marcado (TDD)

**Files:**

- Create: `src/modules/alerts/alerts.service.ts`
- Create: `src/modules/alerts/alerts.service.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

Pruebas de `listAlerts` (aislamiento, filtros, orden, paginacion, pagina vacia), `getAlertById` (propia, ajena e inexistente con el mismo error), `markAlertRead` (idempotente, ajena sin revelar existencia) y `markAllAlertsRead` (solo propias, `updatedCount`).

- [ ] **Step 2: Verificar que falla**

Run: `pnpm exec vitest run src/modules/alerts/alerts.service.test.ts`
Expected: FAIL — el modulo `./alerts.service.js` no existe.

- [ ] **Step 3: Implementacion minima**

`listAlerts`, `getAlertById`, `markAlertRead` (traduce `P2025` con duck-typing como el resto del repo) y `markAllAlertsRead` con `select` explicito.

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm exec vitest run src/modules/alerts/alerts.service.test.ts`
Expected: PASS.

---

### Task 3: Helper `createAlert` transaccional (TDD)

**Files:**

- Modify: `src/modules/alerts/alerts.service.ts`
- Modify: `src/modules/alerts/alerts.service.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

Pruebas de mapeo de cada familia a exactamente una FK, uso del `tx` recibido, defaults no forzados y propagacion de errores. Incluir pruebas `@ts-expect-error` para combinaciones tipo/destino invalidas (validadas por `pnpm run typecheck`).

- [ ] **Step 2: Verificar que falla**

Run: `pnpm exec vitest run src/modules/alerts/alerts.service.test.ts`
Expected: FAIL — `createAlert` no existe.

- [ ] **Step 3: Implementacion minima**

`export type AlertTransactionClient = Prisma.TransactionClient;` y `createAlert(tx, input)` que traduce el destino a una sola columna y llama `tx.alert.create`.

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm exec vitest run src/modules/alerts/alerts.service.test.ts`
Expected: PASS.

---

### Task 4: Integracion de rollback con BD aislada

**Files:**

- Create: `src/modules/alerts/alerts.integration.test.ts`

- [ ] **Step 1: Escribir la prueba**

Reutilizar `resolveAuditTestDatabaseUrl()` (`src/modules/audit/audit.test-support.js`). Suite `describe.skip` sin URL. Pruebas: (a) rollback conjunto cuando el insert de la alerta viola FK; (b) commit conjunto con destino real y limpieza segura de triggers.

- [ ] **Step 2: Verificar que pasa/omite**

Run: `pnpm exec vitest run src/modules/alerts/alerts.integration.test.ts`
Expected: PASS (skip sin `AUDIT_TEST_DATABASE_URL`).

---

### Task 5: Rutas, controlador y montaje (TDD)

**Files:**

- Create: `src/modules/alerts/alerts.controller.ts`
- Create: `src/modules/alerts/alerts.routes.ts`
- Create: `src/modules/alerts/alerts.routes.test.ts`
- Modify: `src/routes.ts`

- [ ] **Step 1: Escribir la prueba que falla**

Con dos JWT (dos usuarios) y mock Prisma: listado propio, filtros, detalle propio, detalle ajeno `404` identico a inexistente, marcar propia idempotente, marcar ajena `404`, `read-all` con conteo, body inesperado `400`, sin token `401`, query `userId` `400`.

- [ ] **Step 2: Verificar que falla**

Run: `pnpm exec vitest run src/modules/alerts/alerts.routes.test.ts`
Expected: FAIL — rutas no montadas (404).

- [ ] **Step 3: Implementacion minima**

Controlador, rutas `authenticate -> validate -> controlador` y montaje en `src/routes.ts`.

- [ ] **Step 4: Verificar que pasa**

Run: `pnpm exec vitest run src/modules/alerts/alerts.routes.test.ts`
Expected: PASS.

---

### Task 6: OpenAPI y contrato

**Files:**

- Create: `src/modules/alerts/alerts.openapi.ts`
- Modify: `src/docs/openapi.ts`
- Modify: `src/docs/openapi.test.ts`
- Modify: `openapi.json` (generado)

- [ ] **Step 1: Prueba de contrato que falla**

Agregar las cuatro operaciones a `expectedOperations` y aserciones de tag, bearer, parametros, respuestas y componentes; ademas que `Alert` no exponga `recipientId` ni los cuatro FK.

- [ ] **Step 2: Verificar que falla**

Run: `pnpm exec vitest run src/docs/openapi.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar paths y regenerar**

Run: `pnpm run docs:generate && pnpm run docs:check`
Expected: generado sin drift.

---

### Task 7: Coleccion Bruno `Alerts`

**Files:**

- Create: `bruno/Alerts/*.bru`

- [ ] **Step 1: Crear requests autocontenidos**

Login del destinatario, listado, unread, por tipo, filtro invalido 400, sin token 401, detalle propio, detalle ajeno 404, marcar propia, marcar ajena 404, marcar todas con `updatedCount`. Documentar en `folder.bru` que `read-all` muta el seed.

- [ ] **Step 2: Verificar**

Run: `pnpm --dir bruno exec bru run Alerts --env local`
Expected: todos en verde.

---

### Task 8: Documentacion

**Files:**

- Modify: `README.md`
- Modify: `CONTEXT.md`
- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [ ] Registrar 7.1-7.4 como completados con evidencia de cierre.

---

### Task 9: Verificacion final

- [ ] `pnpm test`
- [ ] `pnpm run typecheck`
- [ ] `pnpm run lint`
- [ ] `pnpm run build`
- [ ] `pnpm run format:check` (archivos tocados)
- [ ] `pnpm run docs:generate && pnpm run docs:check`
- [ ] `pnpm run prisma:validate`
- [ ] `pnpm run prisma:migrate:status`
- [ ] Verificacion real contra PostgreSQL: conteos, filtros, 404 ajeno, `read-all` sin tocar otro destinatario, rollback conjunto, logs limpios.
- [ ] Registrar hallazgos y evidencia en el plan maestro.
