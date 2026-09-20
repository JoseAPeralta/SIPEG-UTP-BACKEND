# Plan: endpoint `PATCH /api/v1/event-programs/:id`

## Objetivo

Implementar `PATCH /api/v1/event-programs/:id` para modificar un programa de eventos
específico, documentado con OpenAPI 3.1 + Scalar, con autorización por colaboración
(`program:update`) y pruebas TDD.

## Decisiones

- Solo campos editables: `name`, `description`, `label`, `bannerUrl`, `startDate`, `endDate`.
- `status`, `isDefault` y `organizationalUnitId` no se editan aquí (body `.strict()`).
- Los programas `default` también pueden recibir fechas.
- Un programa en estado `ARCHIVED` responde `409` (reactivación será flujo aparte).
- `null` limpia `description`/`label`/`bannerUrl`; las fechas no aceptan `null`.
- El ownership (`organizationalUnit`) y `isDefault` son inmutables en este endpoint.
- No se agrega `updatedById` (no existe en el schema; no inventar auditoría).
- Orden de middlewares: `authenticate -> requirePermission -> validate -> controller`.
  Un no-admin sin colaboración recibe `403` antes de saber si el recurso existe.

## Archivos

- `src/modules/event-programs/event-programs.schemas.ts`
- `src/modules/event-programs/event-programs.service.ts`
- `src/controllers/event-programs.controller.ts`
- `src/routes/event-programs.routes.ts`
- `src/modules/event-programs/event-programs.openapi.ts`
- `src/modules/event-programs/event-programs.schemas.test.ts`
- `src/modules/event-programs/event-programs.service.test.ts`
- `src/routes/event-programs.routes.test.ts`
- `openapi.json` (generado)
- `bruno/Event_Programs/Update an event program.bru`

## Fase 1 - Schemas (test primero)

- `updateEventProgramSchema`: `params.id` (`min(1)`) + body parcial `.strict()`,
  refine de al menos un campo y `endDate >= startDate` cuando ambos vienen en el body.
- Exportar `UpdateEventProgramBody`.
- Tests: parcial válido + trim, body vacío, campos desconocidos, fecha inválida,
  rango invertido, `id` vacío.

## Fase 2 - Servicio (test primero)

- `updateEventProgram(id, input): Promise<EventProgramDetail>`.
- `findUnique` (`id`, `status`, `startDate`, `endDate`); `404` si no existe; `409` si `ARCHIVED`.
- Fechas efectivas = body ?? almacenadas; `400` si `end < start`.
- `data` con spreads condicionales (`exactOptionalPropertyTypes`); `null` limpia campos.
- `update` con `eventProgramDetailSelect`; retorno con `toEventProgramDetail`.
- Tests: 404, 409, 400 contra fechas almacenadas (solo `endDate`, solo `startDate`),
  éxito parcial (solo campos enviados), default con fechas.

## Fase 3 - Controller y ruta (test primero)

- Handler `updateEventProgram`: `200` + `successResponse('Event program updated successfully.', result)`.
- Ruta `PATCH /event-programs/:id` con scope `{ eventProgramId: params.id }`.
- Tests de ruta: 401, 403, 200 (service recibe `id` y body), 400 body vacío,
  propagación 404/409; `loadApp` acepta permisos mock configurables.

## Fase 4 - OpenAPI y docs

- Path `/api/v1/event-programs/{id}` con `patch`, `requestParams.path`, body y
  respuestas `200/400/401/403/404/409/500`; reutiliza `eventProgramDetailSchema`.
- `pnpm run docs:generate` y `pnpm run docs:check`.
- Agregar manualmente `bruno/Event_Programs/Update an event program.bru` (sin import destructivo).

## Verificación

```bash
pnpm exec vitest run src/modules/event-programs src/routes/event-programs.routes.test.ts
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run docs:generate && pnpm run docs:check
```

## Fuera de alcance

Transiciones de estado (activar/archivar), reactivación de unidades, `program:archive`
y notificaciones.
