# Fase 3.4 - Eliminar colaborador Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Exponer `DELETE /event-programs/:id/collaborators/:userId` y `DELETE /activities/:id/collaborators/:userId` que elimina una colaboracion local respetando el subconjunto simetrico y la invariante de que el scope conserve al menos un colaborador capaz de delegar.

**Architecture:** Se extiende `src/modules/authorization/` (servicio y capa HTTP 3.1-3.3). Las rutas siguen `authenticate -> requirePermission(permission:grant, resolver) -> validate -> controlador -> servicio`; la respuesta es `204` sin cuerpo. Sin migraciones, variables de entorno ni permisos nuevos.

**Tech Stack:** TypeScript 6, Express 5, Prisma 7 (SQL/Postgres), Zod 4, Vitest, Supertest, OpenAPI 3.1 (zod-openapi), Bruno.

**Hallazgos de partida (2026-09-20):**

- `removeCollaborator` ya aplica subconjunto simetrico, pero no valida programa inexistente/archivado ni protege al ultimo delegador.
- `isGrantActive` en `authorization.service.ts` es privado; la guarda nueva necesita la misma semantica de ventanas.
- Precedentes: `DELETE /careers/:id` responde `204`; la guarda del ultimo admin (1.11) es una invariante de datos que aplica tambien al actor ADMIN.
- Bruno `Collaborators` queda en seq 23 y desde seq 22 el token compartido es del head; los DELETE admin requieren un re-login.

**Decisiones confirmadas (2026-09-20):**

1. `DELETE` responde `204` sin cuerpo.
2. Programa `ARCHIVED` responde `409 Archived event programs cannot be modified.`
3. La guarda de ultimo delegador es invariante para todos (incluido ADMIN), como la del ultimo admin en 1.11.
4. "Capaz de delegar" = colaborador activo del scope con `permission:grant` vigente en `now`, o colaborador con `globalRole=ADMIN` (bypass). En actividades cuentan las colaboraciones heredadas del programa. Un ADMIN global que no colabora no cuenta.
5. La guarda solo se evalua si el objetivo es capaz de delegar (remover a un VIEWER/EDITOR no puede reducir el conteo).
6. `F3.4-A` diferido: dos DELETE concurrentes de delegadores distintos pueden pasar ambos la guarda (misma familia que `F3.2-A`); requeriria aislamiento serializable.

---

### Task 1: Servicio (TDD)

**Files:**

- Modify: `src/modules/authorization/authorization.service.ts`
- Modify: `src/modules/authorization/delegation.service.ts`
- Test: `src/modules/authorization/delegation.service.test.ts`

- [x] **Step 1: Pruebas que fallan**

Actualizar los 3 tests existentes de `removeCollaborator` agregando `prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });` y agregar las pruebas del plan (404 programa inexistente, 409 archivado, 409 ultimo delegador, permite si queda otro activo, ignora grants vencidos, cuenta ADMIN e ignora inactivos, herencia en actividad con `OR`, omite guarda si el objetivo no puede delegar, bloquea autoremocion no-admin como ultimo delegador).

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/authorization/delegation.service.test.ts`
Expected: FAIL por guardas nuevas y mocks faltantes.

- [x] **Step 3: Implementar**

En `authorization.service.ts`, exportar `isGrantActive` con parametro estructural `{ validFrom: Date | null; validUntil: Date | null }`.

En `delegation.service.ts`, agregar `canDelegate` y `assertScopeKeepsDelegator`, y reescribir `removeCollaborator` con `loadScopeProgram` (404/409), select del objetivo con `user.globalRole`/`user.isActive` y ventanas, guarda simetrica existente, guarda del ultimo delegador condicionada a `canDelegate(collaboration, now)` y `delete`.

- [x] **Step 4: Verificar el verde**

Run: `pnpm exec vitest run src/modules/authorization/delegation.service.test.ts`
Expected: PASS.

---

### Task 2: Esquemas (TDD)

**Files:**

- Modify: `src/modules/authorization/authorization.schemas.ts`
- Test: `src/modules/authorization/authorization.schemas.test.ts`

- [x] **Step 1: Pruebas que fallan**

```ts
it('trims the scope and user identifiers on the shared params schema', () => {
  const parsed = collaboratorUserParamsSchema.parse({
    params: { id: '  program-001  ', userId: '  user-002  ' },
  });

  expect(parsed.params).toEqual({ id: 'program-001', userId: 'user-002' });
});

it('rejects a blank user identifier on the shared params schema', () => {
  expect(() =>
    collaboratorUserParamsSchema.parse({ params: { id: 'p1', userId: '   ' } }),
  ).toThrow();
});

it('rejects a user identifier longer than 100 characters on the shared params schema', () => {
  expect(() =>
    collaboratorUserParamsSchema.parse({ params: { id: 'p1', userId: 'a'.repeat(101) } }),
  ).toThrow();
});
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/authorization/authorization.schemas.test.ts`
Expected: FAIL porque `collaboratorUserParamsSchema` no existe.

- [x] **Step 3: Implementar**

Extraer `collaboratorUserParamsSchema` y reutilizarlo en `updateCollaboratorRoleSchema`:

```ts
export const collaboratorUserParamsSchema = z.object({
  params: z.object({ id: scopeIdSchema, userId: userIdSchema }),
});

export const updateCollaboratorRoleSchema = z.object({
  params: collaboratorUserParamsSchema.shape.params,
  body: z
    .object({
      role: z.enum(['VIEWER', 'EDITOR', 'ORGANIZER'], 'Role is invalid.'),
    })
    .strict(),
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

Agregar `removeCollaborator: vi.fn()` al mock de servicio y 7 pruebas: 401 sin token, 403 sin `permission:grant`, 204 con scope de programa (assert args), 204 con scope de actividad, 400 `userId` en blanco, 404 propagado y 409 ultimo delegador propagado.

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/authorization/authorization.routes.test.ts`
Expected: FAIL con 404 en las rutas nuevas.

- [x] **Step 3: Implementar controlador y rutas**

```ts
export const removeEventProgramCollaborator: RequestHandler = asyncHandler(async (req, res) => {
  const { id, userId } = req.params as { id: string; userId: string };
  const user = requireAuthenticatedUser(req);
  await removeCollaboratorService(user, { eventProgramId: id }, userId);

  res.status(204).send();
});
```

Rutas DELETE en ambos scopes con `validate(collaboratorUserParamsSchema)`.

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
'DELETE /api/v1/activities/{id}/collaborators/{userId}',
'DELETE /api/v1/event-programs/{id}/collaborators/{userId}',
```

Y extender el test de colaboradores con `security`, `204`, `409` y params `id`/`userId` para el DELETE de programa.

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/docs/openapi.test.ts`
Expected: FAIL: operaciones DELETE no documentadas.

- [x] **Step 3: Implementar las rutas OpenAPI**

Agregar `delete` a ambos paths `{userId}` con `deleteResponses` (`204`/`400`/`401`/`403`/`404`/`409`) y `deleteDescription` documentando la invariante del ultimo delegador y el 409 de archivado.

- [x] **Step 4: Verificar el verde y regenerar el contrato**

Run: `pnpm exec vitest run src/docs/openapi.test.ts && pnpm run docs:generate && pnpm run docs:check`
Expected: PASS y `openapi.json` sin drift.

---

### Task 5: Bruno y verificacion E2E

**Files:**

- Create: `bruno/Collaborators/Delete a collaborator as an organizer without grant returns 403.bru` (seq 24)
- Create: `bruno/Collaborators/Log in as admin to delete.bru` (seq 25)
- Create: `bruno/Collaborators/Delete a collaborator.bru` (seq 26)
- Create: `bruno/Collaborators/Delete the same collaborator returns 404.bru` (seq 27)
- Create: `bruno/Collaborators/Delete a collaborator without a token returns 401.bru` (seq 28)
- Create: `bruno/Collaborators/Delete a collaborator on an archived program returns 409.bru` (seq 29)
- Create: `bruno/Collaborators/Delete the last delegator returns 409.bru` (seq 30)
- Create: `bruno/Collaborators/Add a collaborator to an activity.bru` (seq 31)
- Create: `bruno/Collaborators/Delete an activity collaborator.bru` (seq 32)

- [x] **Step 1: Crear los requests**

Copiar el patron de los existentes (bearer `{{token}}`, carpeta `Collaborators`). El re-login admin (seq 25) recupera el token tras el head login de seq 22.

- [x] **Step 2: Correr Bruno**

Run: `pnpm exec bru run Collaborators --env local`
Expected: 31 requests y 32 tests en verde. Si se agota el rate limit de login, esperar 60 s.

- [x] **Step 3: Verificacion real E2E (Docker + psql)**

1. Login admin; crear usuario temporal A; agregarlo como VIEWER a `seed_program_congreso-cit`.
2. `DELETE` A → 204; psql confirma la cascada en `collaboration_permissions`; segundo `DELETE` 404; sin token 401; head sin grant en `seed_program_fisc_default` 403; archivado 409.
3. `DELETE` de `seed_user_org-fisc` en `congreso-cit` con admin y con head → 409 ultimo delegador y fila intacta.
4. `OVERRIDE` manual de `permission:grant` para A via psql; head borra A → 204 (head sigue como delegador).
5. Alta y baja de A en la actividad → 204.
6. Limpieza total y conteos restaurados.

- [x] **Step 4: Confirmar conteos restaurados**

Run: psql contra el contenedor para verificar `collaborations`/`collaboration_permissions` sin filas temporales.

---

### Task 6: Documentacion, plan maestro y gates

**Files:**

- Modify: `CONTEXT.md`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [x] **Step 1: `CONTEXT.md`**

Documentar el DELETE en la seccion `### Colaboradores Por Scope`.

- [x] **Step 2: `README.md`**

Documentar el endpoint con `204`, cascada, guarda del ultimo delegador y archivado `409`.

- [x] **Step 3: Plan maestro**

Marcar 3.4 `[x]`, actualizar la tabla de estado y la lista de endpoints, y agregar `**Registro de ejecucion (2026-09-20 - 3.4):**` con el hallazgo `F3.4-A`.

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
