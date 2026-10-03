# Fase 4.2 - Revisar creacion y actualizacion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar el checklist 4.2 del plan maestro: `isDefault` y `organizationalUnitId` inmutables en la API, `startDate <= endDate` validado, programa `ARCHIVED` no editable, y corregir los tres caminos que hoy terminan en `500` porque la API contradice constraints/triggers reales de PostgreSQL.

**Architecture:** Se mantiene el modulo autocontenido `src/modules/event-programs/`. Se agrega una migracion SQL que relaja `event_programs_metadata_check` (label y banner pasan a ser metadatos opcionales). El servicio `updateEventProgram` gana guardas de negocio (fechas en programas predeterminados, fechas que excluirian actividades, activacion DRAFT -> ACTIVE) y el esquema `status` acepta solo `ACTIVE`. Sin cambios de dependencias, variables de entorno ni permisos.

**Tech Stack:** TypeScript 6, Express 5, Prisma 7 (SQL/Postgres), Zod 4, Vitest, Supertest, OpenAPI 3.1 (zod-openapi), Bruno.

**Estado de partida (2026-09-20):**

- `POST /event-programs` crea programas adicionales `DRAFT` con `isDefault: false`, fechas obligatorias y `organizationalUnitId` obligatorio; `label`/`bannerUrl` opcionales (`nullish`).
- `PATCH /event-programs/:id` actualiza `name`, `description`, `label`, `bannerUrl`, `startDate`, `endDate`; body `.strict()`; `ARCHIVED` responde `409`; rango de fechas validado en esquema y contra valores almacenados.
- BD viva: `event_programs_metadata_check` exige `label` y `banner_url` NOT NULL en programas adicionales; el trigger `validate_event_program_transition` rechaza fechas que excluyan actividades y creaciones sin admin.
- El trigger `protect_event_program_identity` protege `is_default` siempre y `organizational_unit_id` solo en programas predeterminados.
- No existe transicion DRAFT -> ACTIVE; `createActivity` exige programa `ACTIVE`.
- Seed demo: `seed_program_fic_default` (`ACTIVE`, fechas nulas), `seed_program_congreso-cit` (`ACTIVE`, 2026-10-05 a 2026-10-09, actividades 10-05/10-07/10-09), `seed_program_foro-ipe` (`ARCHIVED`), `seed_program_jornada-bienestar` (`ACTIVE`), `seed_program_feria-tec` (`DRAFT`).

**Decisiones confirmadas con el usuario (2026-09-20):**

1. `label` y `bannerUrl` siguen siendo **opcionales**; se relaja la CHECK de BD (no se exigen en la API).
2. Fechas en programa predeterminado -> `400`; fechas que excluirian actividades existentes -> `409` con pre-chequeo en el servicio (espejo del trigger de BD).
3. `PATCH` acepta `status: 'ACTIVE'` **solo desde `DRAFT`**; cualquier otro estado actual -> `409`. Archivar (4.3) y reactivar (4.4) conservan sus endpoints futuros.
4. `isDefault` y `organizationalUnitId` no se agregan al body; el `.strict()` los rechaza con `400`. La inmutabilidad de la unidad en programas adicionales a nivel BD queda diferida como `F4.2-A`.

**Reglas de negocio:**

- Programa `ARCHIVED`: cualquier `PATCH` responde `409 Archived event programs cannot be modified.` (antes de cualquier otra guarda).
- Programa predeterminado (`isDefault: true`): no admite `startDate` ni `endDate` -> `400 Default event programs cannot have start or end dates.`
- Rango efectivo (body sobre valores almacenados) `end < start` -> `400 End date must be on or after start date.`
- Activar (`status: 'ACTIVE'`) exige estado actual `DRAFT` -> si no, `409 Only draft event programs can be activated.`
- Cambio de fechas en programa adicional: ninguna actividad puede quedar con `date < startDate` o `date > endDate` -> si hay alguna, `409 Event program dates cannot exclude existing activities.` (mismo criterio del trigger `validate_event_program_transition`).
- El conteo de actividades solo se ejecuta cuando el body trae fechas y el programa es adicional.

---

### Task 1: Migracion `relax_event_program_metadata_check`

**Files:**

- Create: `prisma/migrations/<timestamp>_relax_event_program_metadata_check/migration.sql`

- [x] **Step 1: Verificar el rojo en BD (transaccion revertida)**

Con la CHECK actual, un programa adicional sin label/banner debe fallar:

```bash
docker exec sipeg-utp-dev-db-1 psql -U sipeg -d sipeg_utp -c "
BEGIN;
INSERT INTO event_programs (id, name, is_default, status, start_date, end_date, organizational_unit_id, created_by_id, updated_at)
VALUES ('tmp-f42-red', 'TMP F4.2', false, 'DRAFT', DATE '2026-12-01', DATE '2026-12-05', 'seed_unit_fic', 'seed_user_admin', now());
ROLLBACK;"
```

Resultado esperado: `ERROR: new row for relation "event_programs" violates check constraint "event_programs_metadata_check"`. Sin filas persistidas por el `ROLLBACK`.

- [x] **Step 2: Crear la migracion**

Directorio con timestamp actual (`date +%Y%m%d%H%M%S`) y `migration.sql`:

```sql
-- Label and banner are optional metadata for additional event programs.
ALTER TABLE "event_programs" DROP CONSTRAINT "event_programs_metadata_check";

ALTER TABLE "event_programs" ADD CONSTRAINT "event_programs_metadata_check"
CHECK (
    ("is_default" AND "start_date" IS NULL AND "end_date" IS NULL)
    OR
    (
        NOT "is_default"
        AND "start_date" IS NOT NULL
        AND "end_date" IS NOT NULL
        AND "start_date" <= "end_date"
    )
);
```

- [x] **Step 3: Aplicar y validar**

```bash
pnpm exec prisma migrate dev
pnpm exec prisma migrate status
pnpm exec prisma validate
```

- [x] **Step 4: Verificar el verde en BD (transaccion revertida)**

Repetir el INSERT del Step 1; ahora debe ejecutarse sin error y el `ROLLBACK` deja la tabla intacta. Contrastar la definicion:

```bash
docker exec sipeg-utp-dev-db-1 psql -U sipeg -d sipeg_utp -c "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'event_programs_metadata_check';"
```

---

### Task 2: `status` en `PATCH` (TDD)

**Files:**

- Modify: `src/modules/event-programs/event-programs.schemas.ts`
- Modify: `src/modules/event-programs/event-programs.schemas.test.ts`
- Modify: `src/modules/event-programs/event-programs.routes.test.ts`

- [x] **Step 1: Escribir las pruebas que fallan (esquema)**

En `event-programs.schemas.test.ts`, reemplazar el test `rejects unknown fields such as status, isDefault and organizationalUnitId` por dos casos (solo `isDefault`/`organizationalUnitId` como desconocidos) y agregar:

```ts
it('accepts publishing a draft program with status ACTIVE', () => {
  const parsed = updateEventProgramSchema.parse({ params, body: { status: 'ACTIVE' } });

  expect(parsed.body).toEqual({ status: 'ACTIVE' });
});

it('rejects any status other than ACTIVE', () => {
  for (const status of ['DRAFT', 'ARCHIVED', 'COMPLETED', 'CANCELLED']) {
    expect(() => updateEventProgramSchema.parse({ params, body: { status } })).toThrow();
  }
});
```

- [x] **Step 2: Verificar rojo**

```bash
pnpm exec vitest run src/modules/event-programs/event-programs.schemas.test.ts
```

- [x] **Step 3: Implementar el esquema**

En `updateEventProgramSchema`, dentro del body:

```ts
      status: z
        .literal('ACTIVE', 'Only the ACTIVE status can be set through this endpoint.')
        .optional(),
```

- [x] **Step 4: Verificar verde del esquema**

```bash
pnpm exec vitest run src/modules/event-programs/event-programs.schemas.test.ts
```

- [x] **Step 5: Pruebas de ruta (TDD)**

En `event-programs.routes.test.ts`:

- Nuevo test: `PATCH` con `{ status: 'ACTIVE' }` responde `200` y el servicio recibe `{ status: 'ACTIVE' }`.
- Nuevo test: `{ status: 'ARCHIVED' }` responde `400` antes del servicio.
- Ajustar `rejects immutable fields before the service` para enviar solo `{ isDefault: true, organizationalUnitId: 'unit-002' }` (el `status` deja de ser inmutable).

- [x] **Step 6: Verificar rojo/verde de rutas**

Las pruebas usan el esquema real; sin el Step 3 fallan. Con el esquema implementado:

```bash
pnpm exec vitest run src/modules/event-programs
```

---

### Task 3: Guardas del servicio (TDD)

**Files:**

- Modify: `src/modules/event-programs/event-programs.service.ts`
- Modify: `src/modules/event-programs/event-programs.service.test.ts`

- [x] **Step 1: Adaptar el mock y el registro almacenado**

En el `PrismaMock` agregar `activity.count`; en `storedRecord` agregar `isDefault: false`. Actualizar todos los `findUnique.mockResolvedValue` para reflejar el `select` nuevo (`status`, `isDefault`, `startDate`, `endDate`).

- [x] **Step 2: Escribir las pruebas que fallan (servicio)**

```ts
it('rejects dates on a default event program', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue({
    id: 'program-default',
    status: 'ACTIVE',
    isDefault: true,
    startDate: null,
    endDate: null,
  });
  const { updateEventProgram } = await loadService(prisma);

  await expect(
    updateEventProgram('program-default', { endDate: '2026-11-05' }),
  ).rejects.toMatchObject({ statusCode: 400 });
  expect(prisma.eventProgram.update).not.toHaveBeenCalled();
  expect(prisma.activity.count).not.toHaveBeenCalled();
});

it('activates a draft event program', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue({ ...storedRecord, status: 'DRAFT' });
  prisma.eventProgram.update.mockResolvedValue({ ...updatedRecord, status: 'ACTIVE' });
  const { updateEventProgram } = await loadService(prisma);

  const result = await updateEventProgram('program-001', { status: 'ACTIVE' });

  expect(prisma.eventProgram.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: { status: 'ACTIVE' } }),
  );
  expect(result.status).toBe('ACTIVE');
});

it('rejects activation when the event program is not a draft', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue(storedRecord);
  const { updateEventProgram } = await loadService(prisma);

  await expect(updateEventProgram('program-001', { status: 'ACTIVE' })).rejects.toMatchObject({
    statusCode: 409,
  });
  expect(prisma.eventProgram.update).not.toHaveBeenCalled();
});

it('rejects dates that exclude existing activities', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue(storedRecord);
  prisma.activity.count.mockResolvedValue(2);
  const { updateEventProgram } = await loadService(prisma);

  await expect(updateEventProgram('program-001', { endDate: '2026-10-15' })).rejects.toMatchObject({
    statusCode: 409,
  });
  expect(prisma.activity.count).toHaveBeenCalledWith({
    where: {
      eventProgramId: 'program-001',
      OR: [
        { date: { lt: new Date('2026-10-12T00:00:00.000Z') } },
        { date: { gt: new Date('2026-10-15T00:00:00.000Z') } },
      ],
    },
  });
  expect(prisma.eventProgram.update).not.toHaveBeenCalled();
});

it('allows a date change that keeps every activity inside the range', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue(storedRecord);
  prisma.activity.count.mockResolvedValue(0);
  prisma.eventProgram.update.mockResolvedValue({
    ...updatedRecord,
    endDate: new Date('2026-10-31T00:00:00.000Z'),
  });
  const { updateEventProgram } = await loadService(prisma);

  const result = await updateEventProgram('program-001', { endDate: '2026-10-31' });

  expect(prisma.eventProgram.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: { endDate: new Date('2026-10-31T00:00:00.000Z') } }),
  );
  expect(result.endDate).toBe('2026-10-31');
});

it('does not query activities when only non-date fields change', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue(storedRecord);
  prisma.eventProgram.update.mockResolvedValue(updatedRecord);
  const { updateEventProgram } = await loadService(prisma);

  await updateEventProgram('program-001', { name: 'Congreso actualizado' });

  expect(prisma.activity.count).not.toHaveBeenCalled();
});
```

Eliminar el test obsoleto `allows setting dates on a default program without stored dates`.

- [x] **Step 3: Verificar rojo**

```bash
pnpm exec vitest run src/modules/event-programs/event-programs.service.test.ts
```

- [x] **Step 4: Implementar el servicio**

En `updateEventProgram`:

```ts
const program = await prisma.eventProgram.findUnique({
  where: { id },
  select: { id: true, status: true, isDefault: true, startDate: true, endDate: true },
});

if (!program) {
  throw new ApiError(404, 'Event program not found.');
}
if (program.status === 'ARCHIVED') {
  throw new ApiError(409, 'Archived event programs cannot be modified.');
}

const touchesDates = input.startDate !== undefined || input.endDate !== undefined;
if (program.isDefault && touchesDates) {
  throw new ApiError(400, 'Default event programs cannot have start or end dates.');
}

const startDate =
  input.startDate !== undefined ? new Date(`${input.startDate}T00:00:00.000Z`) : program.startDate;
const endDate =
  input.endDate !== undefined ? new Date(`${input.endDate}T00:00:00.000Z`) : program.endDate;

if (startDate && endDate && endDate < startDate) {
  throw new ApiError(400, 'End date must be on or after start date.');
}

if (input.status === 'ACTIVE' && program.status !== 'DRAFT') {
  throw new ApiError(409, 'Only draft event programs can be activated.');
}

if (!program.isDefault && touchesDates && startDate && endDate) {
  const excludedActivities = await prisma.activity.count({
    where: {
      eventProgramId: program.id,
      OR: [{ date: { lt: startDate } }, { date: { gt: endDate } }],
    },
  });

  if (excludedActivities > 0) {
    throw new ApiError(409, 'Event program dates cannot exclude existing activities.');
  }
}

const data = {
  ...(input.name !== undefined ? { name: input.name } : {}),
  ...(input.description !== undefined ? { description: input.description } : {}),
  ...(input.label !== undefined ? { label: input.label } : {}),
  ...(input.bannerUrl !== undefined ? { bannerUrl: input.bannerUrl } : {}),
  ...(input.startDate !== undefined ? { startDate } : {}),
  ...(input.endDate !== undefined ? { endDate } : {}),
  ...(input.status !== undefined ? { status: input.status } : {}),
};
```

- [x] **Step 5: Verificar verde**

```bash
pnpm exec vitest run src/modules/event-programs
```

---

### Task 4: OpenAPI y contrato

**Files:**

- Modify: `src/modules/event-programs/event-programs.openapi.ts`
- Modify: `src/docs/openapi.test.ts`
- Regenerate: `openapi.json`

- [x] **Step 1: Actualizar descripcion del PATCH**

Describir: actualiza `name`, `description`, `label`, `bannerUrl`, `startDate`, `endDate` y publica con `status: 'ACTIVE'` solo desde `DRAFT`; `ARCHIVED` 409, fechas en predeterminados 400 y fechas que excluirian actividades 409.

- [x] **Step 2: Prueba de contrato**

En el test `marks event program update with bearer security, a path param and a 200 response`, agregar:

```ts
const body = operation?.requestBody?.content?.['application/json']?.schema;
expect(body?.properties).toHaveProperty('status');
```

- [x] **Step 3: Verificar y regenerar**

```bash
pnpm run docs:generate
pnpm run docs:check
pnpm exec vitest run src/docs
```

---

### Task 5: Bruno

**Files:**

- Modify: `bruno/environments/local.bru`
- Create: `bruno/Event_Programs/Update a default event program with dates returns 400.bru`
- Create: `bruno/Event_Programs/Update an archived event program returns 409.bru`
- Create: `bruno/Event_Programs/Activate a non-draft event program returns 409.bru`
- Create: `bruno/Event_Programs/Update an event program with an invalid status returns 400.bru`
- Create: `bruno/Event_Programs/Update event program dates that exclude activities returns 409.bru`

- [x] **Step 1: Variables** `defaultProgramId: seed_program_fic_default` y `activeProgramId: seed_program_jornada-bienestar`.
- [x] **Step 2: Requests** PATCH con `auth: bearer {{token}}`, body y assertions de status/mensaje:

  - `{{defaultProgramId}}` + `{ "endDate": "2026-12-31" }` -> 400 `Default event programs cannot have start or end dates.`
  - `{{archivedProgramId}}` + `{ "name": "Foro actualizado" }` -> 409 `Archived event programs cannot be modified.`
  - `{{activeProgramId}}` + `{ "status": "ACTIVE" }` -> 409 `Only draft event programs can be activated.`
  - `{{eventProgramId}}` + `{ "status": "ARCHIVED" }` -> 400
  - `{{eventProgramId}}` + `{ "startDate": "2026-10-06" }` -> 409 `Event program dates cannot exclude existing activities.`

- [x] **Step 3: Correr la carpeta**

```bash
pnpm --dir bruno exec bru run Event_Programs --env local
```

---

### Task 6: Documentacion

**Files:**

- Modify: `README.md`
- Modify: `CONTEXT.md`
- Modify: `AGENTS.md`

- [x] **Step 1: README y CONTEXT** documentan `status: 'ACTIVE'` (solo DRAFT), 409 de archivado, 400 de fechas en predeterminados y 409 de fechas que excluyen actividades.
- [x] **Step 2: AGENTS** ajusta "additional programs include name, dates, custom label, and banner" a label/banner opcionales.

---

### Task 7: E2E real (Docker + psql)

- [x] **Step 1: Confirmar migracion aplicada** (`pg_get_constraintdef` sin `label IS NOT NULL`).
- [x] **Step 2: Login admin** y `POST /event-programs` temporal (`TMP-F4.2 ...`, `seed_unit_fic`, 2026-12-01/05) **sin label ni banner** -> `201` `DRAFT`; psql confirma `label`/`banner_url` nulos.
- [x] **Step 3:** `PATCH` nombre -> `200`; `PATCH { status: 'ACTIVE' }` -> `200` `ACTIVE`; repetir -> `409`; psql contrasta.
- [x] **Step 4:** `PATCH` fechas extendidas -> `200`; `PATCH { isDefault: true }`, `{ organizationalUnitId: ... }`, `{ status: 'ARCHIVED' }` -> `400`; sin token -> `401`; USER -> `403`.
- [x] **Step 5:** `PATCH seed_program_fic_default { endDate }` -> `400`; `PATCH seed_program_congreso-cit { startDate: '2026-10-06' }` -> `409` con fechas psql intactas; `PATCH seed_program_foro-ipe` -> `409`.
- [x] **Step 6: Limpieza** del programa temporal con `event_programs_prevent_delete` deshabilitado dentro de una transaccion; conteos restaurados.

---

### Task 8: Gates y registro

- [x] `pnpm exec vitest run src/modules/event-programs src/docs`
- [x] `pnpm test`
- [x] `pnpm run typecheck`
- [x] `pnpm run lint`
- [x] `pnpm run format:check`
- [x] `pnpm run build`
- [x] `pnpm run docs:check`
- [x] `pnpm exec prisma validate` y `pnpm exec prisma migrate status`
- [x] Registro de ejecucion en `docs/superpowers/plans/plan-maestro-sipeg-utp.md` y checklist 4.2 marcado.

## Hallazgos diferidos

- `F4.2-A`: el trigger `protect_event_program_identity` solo protege `organizational_unit_id` en programas predeterminados; en adicionales la inmutabilidad es solo de API. Requiere migracion aparte si se desea defensa en profundidad.
- `F4.2-B`: carrera entre el pre-chequeo de fechas y un alta concurrente de actividad; el trigger de BD queda como ultima linea (500 raro).
