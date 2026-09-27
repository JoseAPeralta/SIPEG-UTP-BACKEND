# Plan: logging estructurado, observabilidad y auditoría durable

> **Para agentes:** Plan ejecutable paso a paso. Cada tarea incluye rutas exactas,
> comandos y el resultado esperado. Marca `[x]` solo cuando la verificación
> indicada se cumpla. No marques una tarea por intención: hazlo tras correr la
> verificación.

**Objetivo:** Centralizar logs estructurados correlacionables en Loki/Grafana y
registrar de forma durable y atómica las mutaciones sensibles en una bitácora
PostgreSQL append-only.

**Arquitectura:** Dos canales separados.

```text
Express
  -> Pino + pino-http (JSON en stdout/stderr)
  -> rotación local de Docker (spool)
  -> Grafana Alloy
  -> Loki
  -> Grafana (búsqueda, paneles y alertas)

Mutaciones sensibles
  -> misma transacción Prisma
  -> tabla audit_events append-only en PostgreSQL
  -> API administrativa de solo lectura
```

**Stack:** Node.js 24, Express 5, TypeScript estricto (NodeNext/ESM), Prisma 7 +
`@prisma/adapter-pg`, PostgreSQL 18, Zod 4, pino, pino-http, Docker Compose,
Grafana Alloy, Loki, Grafana.

**Referencias de diseño:** ver `## Fuentes` al final y los ADR que este plan crea.

---

## Decisiones Tomadas

- [x] **D1. Logger recomendado: Pino + pino-http.**
      Pino emite una línea JSON por evento, tiene bajo overhead, child loggers,
      serialización de errores y redacción nativa. Se descartan Winston (más pesado,
      sin ventaja concreta) y Morgan (solo access logs en texto).
- [x] **D2. Visualización: Loki autogestionado + Alloy + Grafana.**
      Ajuste natural al despliegue Docker Compose de un solo host y costo nulo de
      servicio externo. Se descartan inicialmente Elastic/OpenSearch (más memoria y
      operación), Grafana Cloud/Datadog (costo y salida de datos) y solo-stdout sin
      centralizar.
- [x] **D3. Auditoría durable separada de los logs.**
      Los logs de Loki son diagnóstico operativo, no evidencia durable. Los cambios
      sensibles se persisten en PostgreSQL, en la misma transacción que la mutación.
- [x] **D4. Alloy, no Promtail.**
      Grafana recomienda Alloy como colector principal para Loki; no iniciar
      integraciones nuevas con Promtail.
- [x] **D5. Sin etiquetas de alta cardinalidad en Loki.**
      `requestId`, `actorId`, IDs de recurso, IPs y trace IDs viven en el JSON, nunca
      como labels de Loki.
- [x] **D6. La ruta `/api/auth/*` es una frontera especial.**
      Better Auth puede mutar usuarios/sesiones sin pasar por los servicios propios.
      La instrumentación HTTP la cubre; la auditoría semántica atómica requiere
      hooks del proveedor (fase 12).

---

## Fase 0 - Decisiones De Arquitectura (ADR)

- [x] **T0.1. Crear `docs/adr/adr-0007-structured-logging-and-observability.md`.**
      Documenta: tipos de log, campos comunes, niveles, redacción, etiquetas Loki,
      retención, acceso, uso del Docker socket proxy y separación logs/auditoría.
      Usa la plantilla del skill `create-architectural-decision-record`.
- [x] **T0.2. Crear `docs/adr/adr-0008-durable-audit-events.md`.**
      Documenta: modelo `AuditEvent`, trigger append-only, atomicidad con
      transacciones Prisma, payload permitido/prohibido, retención y acceso, y la
      limitación de atomicidad con Better Auth.
- [x] **T0.3. Actualizar `CONTEXT.md` y `README.md`.**
      Añade una sección operativa con la topología de observabilidad, variables de
      entorno nuevas, cómo ver logs en Grafana y cómo consultar auditoría.

---

## Fase 1 - Logger Base

**Archivos a crear:**

- `src/config/logger.ts`
- `src/config/logger.test.ts`
- `src/lib/log-context.ts`
- `src/lib/log-context.test.ts`

**Archivos a modificar:**

- `package.json` (dependencias `pino`, `pino-http`)
- `pnpm-lock.yaml`
- `src/config/env.ts`
- `.env.example`
- `compose.dev.yaml`
- `compose.prod.yaml`

- [x] **T1.1. Instalar dependencias.** (commit `293da18`)
      `pnpm add pino pino-http`
      Ejecutar y confirmar que `pnpm-lock.yaml` cambia. No agregar transports de
      archivos: en contenedores la salida es stdout/stderr.
- [x] **T1.2. Extender `src/config/env.ts` con la nueva configuración.** (commit `bee22b5`)
      Añadir al `envSchema`:
  - `LOG_PRETTY` (enum `true|false`, opcional; solo afecta desarrollo).
  - `LOG_PSEUDONYMIZATION_KEY` (string mínimo 32; **requerido en producción** vía
    `superRefine`).
  - `LOG_SERVICE_NAME` (default `sipeg-utp-backend`).
  - `APP_VERSION` (default `1.0.0` o leer de package.json).
    Mantener `LOG_LEVEL` existente en `src/config/env.ts:42`.
- [x] **T1.3. Escribir tests primero en `src/config/logger.test.ts` (TDD).** (commit `86db919`)
      Casos mínimos:
  - Respeta `LOG_LEVEL` (con `error`, `logger.info` no emite).
  - El serializador de errores no incluye `message` ni `stack` crudos en
    `production`, pero sí los incluye en `development`.
  - `redact` reemplaza `authorization`, `cookie`, `password`, `token`,
    `refreshToken`, `accessToken` por `[Redacted]`.
  - Un valor con `\n` o `\r` sigue produciendo una sola línea JSON válida.
    Verificar que los tests fallan antes de implementar.
- [x] **T1.4. Implementar `src/config/logger.ts`.** (commits `08dc014`, `e24ed71`)
      Requisitos:
  - Salida JSON de una línea; timestamp UTC ISO (`pino.stdTimeFunctions.isoTime`).
  - `base`: `{ service, version, environment }`.
  - `level`: `env.LOG_LEVEL`.
  - `redact`: rutas `req.headers.authorization`, `req.headers.cookie`,
    `*.password`, `*.token`, `*.accessToken`, `*.refreshToken`.
  - `serializers.err` seguro según `NODE_ENV` (D5 de la fase).
  - En desarrollo y `LOG_PRETTY=true`, usar transporte `pino-pretty` (dev
    dependency opcional) o formato legible sin afectar producción.
  - Exportar `logger` y `createChildLogger(bindings)`.
  - No abrir archivos ni procesos extra: solo stdout/stderr.
- [x] **T1.5. Implementar `src/lib/log-context.ts` con `AsyncLocalStorage`.** (commit `f2985e5`)
      Provee `runWithLogContext(context, fn)` y `getLogContext()`. El contexto
      asocia `requestId`, y opcionalmente `actorId`, a los logs emitidos desde
      servicios sin pasar un logger por parámetro. Escribe tests de concurrencia:
      dos contextos simultáneos no intercambian `requestId`.
- [x] **T1.6. Documentar las variables en `.env.example`.** (commit `67cac39`)
      Agregar `LOG_PRETTY`, `LOG_PSEUDONYMIZATION_KEY`, `LOG_SERVICE_NAME`,
      `APP_VERSION` con comentarios y sin valores reales.
- [x] **T1.7. Propagar variables en Compose.** (commit `202df98`)
      Añadir `LOG_LEVEL`, `LOG_PRETTY`, `LOG_SERVICE_NAME`, `APP_VERSION` y
      `LOG_PSEUDONYMIZATION_KEY` al bloque `environment:` de `api` en
      `compose.dev.yaml` y `compose.prod.yaml`. Docker Compose solo inyecta variables
      referenciadas explícitamente.
- [x] **T1.8. Verificar.**
      `pnpm test src/config/logger.test.ts src/lib/log-context.test.ts`
      `pnpm run typecheck`
      `pnpm run lint` / `pnpm run build` (T1.8 ampliado en ejecución)
      Resultado esperado: tests en verde y sin errores de tipos.
      Verificado 2026-09-26: 14/14 tests, typecheck/lint/build en verde,
      smoke test del logger en runtime con redacción e ISO timestamp.

---

## Fase 2 - Correlación HTTP

**Archivos a crear:**

- `src/middlewares/requestLogger.middleware.ts`
- `src/middlewares/requestLogger.middleware.test.ts`

**Archivos a modificar:**

- `src/app.ts`
- `src/types/express.d.ts`

- [x] **T2.1. Escribir tests primero (TDD).** (commit `64db03d`)
      Casos:
  - Sin header genera un UUID y responde `X-Request-ID`.
  - Con header UUID válido lo reutiliza.
  - Con header inválido (texto arbitrario, CRLF) genera uno nuevo.
  - Registra método, plantilla de ruta, estado y duración en un solo evento.
  - No registra query string.
  - Marca rutas no reconocidas como `unmatched`.
  - Excluye health checks exitosos.
  - Registra requests abortados.
- [x] **T2.2. Implementar `requestLogger` antes de Helmet y CORS en `src/app.ts`.** (commit `47e6f86`)
      Insertar como primera middleware después de `app.set('trust proxy', 1)` y antes
      de `app.use(helmet(...))` para cubrir también `/api/auth/*`. Debe:
  - Generar/reutilizar `requestId` con validación UUID.
  - Ejecutar el resto del request dentro de `runWithLogContext`.
  - Responder `X-Request-ID` siempre.
  - Al finalizar, emitir `logType: 'access'` con `event: 'http.request.completed'`.
  - Nivel: 2xx/3xx/4xx esperado `info`, 429 `warn`, 5xx `error`.
- [x] **T2.3. Exponer `X-Request-ID` en CORS si el frontend lo necesita.** (commit `8a3ffb5`)
      Añadir `exposedHeaders: ['X-Request-ID']` a la configuración de `cors` en
      `src/app.ts`. Si el contrato OpenAPI/bruno lo requiere, documentarlo.
- [x] **T2.4. Tipar `req.id` en `src/types/express.d.ts`.** (commit `8a3ffb5`)
      Agregar `id?: string` a `Express.Request`. No duplicar el `requestId` global.
- [x] **T2.5. Verificar.**
      `pnpm test src/middlewares/requestLogger.middleware.test.ts`
      `pnpm run typecheck`
      Verificado 2026-09-26: 17/17 tests del middleware, suite completa
      1052/1052, typecheck/lint/build en verde.

---

## Fase 3 - Errores Y Ciclo De Vida

**Archivos a modificar:**

- `src/middlewares/error.middleware.ts`
- `src/server.ts`
- `src/config/prisma.ts`
- `src/lib/auth.ts`
- `src/modules/users/users.service.ts`

**Archivos a crear:**

- `src/middlewares/error.middleware.test.ts`
- `src/server.test.ts` (o dividir el bootstrap de `server.ts` en funciones
  testeables si es necesario)

- [x] **T3.1. Escribir tests primero para `errorHandler`.** (commit `409d173`)
      Casos:
  - `ApiError` operativo responde su `statusCode` y **no** emite log `error`.
  - Error inesperado responde 500 genérico y emite **un solo** log `error`.
  - El log incluye `requestId` pero no `stack` en producción.
  - El body de la respuesta no filtra detalles internos.
- [x] **T3.2. Instrumentar `error.middleware.ts`.** (commit `f805905`)
  - Importar `logger` y `getLogContext`.
  - Registrar errores no operativos con `event: 'http.error.unexpected'`.
  - Serializar el error de forma segura; no duplicar logs que ya emite un
    servicio que lo relanza.
- [x] **T3.3. Reemplazar `console.*` en `src/server.ts`.** (commit `7aea154`)
      Eventos: `app.starting`, `app.listening`, `app.jwks.ready`,
      `app.jwks.failed`, `app.shutdown.signal`, `app.shutdown.forced`,
      `app.shutdown.completed`, `app.fatal`. Mantén el timeout interno de 10 s y
      añade flush acotado del logger antes de `process.exit`.
- [x] **T3.4. Manejar `uncaughtException` y `unhandledRejection`.** (commit `7aea154`)
      En `src/server.ts`, registrar `app.fatal` y cerrar de forma ordenada sin
      dejar el proceso colgado.
- [x] **T3.5. Adaptar logs de Prisma en `src/config/prisma.ts`.** (commit `21e14bc`)
      Mantener solo `warn`/`error` (nunca `query`), enviándolos al logger común en
      lugar de la salida directa de Prisma. No registrar parámetros de queries.
- [x] **T3.6. Reemplazar `console.error` en `src/lib/auth.ts` y `src/modules/users/users.service.ts`.** (commit `a36dbc8`)
      Convertir en `event: 'mail.delivery.failed'` sin destinatario, enlace ni token.
- [x] **T3.7. Verificar.**
      `pnpm test src/middlewares/error.middleware.test.ts src/server.test.ts`
      `pnpm run typecheck`
      Verificado 2026-09-26: 14/14 tests nuevos, suite completa 1066/1066,
      typecheck/lint en verde, cero `console.*` en los archivos de la fase
      y smoke test del ciclo de vida completo (starting → listening →
      jwks.ready → shutdown.signal → shutdown.completed).

---

## Fase 4 - Eventos De Seguridad

**Archivos a modificar:**

- `src/middlewares/authenticate.middleware.ts`
- `src/middlewares/authorize.middleware.ts`
- `src/middlewares/rateLimit.middleware.ts`
- `src/modules/auth/auth.service.ts`
- `src/lib/auth.ts`
- `src/app.ts` (denegación CORS)

**Catálogo de eventos:**

| Evento                  | Dónde                          | Nivel |
| ----------------------- | ------------------------------ | ----- |
| `auth.login.succeeded`  | `auth.service.ts`              | info  |
| `auth.login.failed`     | `auth.service.ts`              | warn  |
| `auth.token.invalid`    | `authenticate.middleware.ts`   | warn  |
| `auth.account.disabled` | `authenticate.middleware.ts`   | warn  |
| `auth.password.changed` | `auth.service.ts`              | info  |
| `auth.session.revoked`  | `auth.service.ts`              | info  |
| `authorization.denied`  | `authorize.middleware.ts`      | warn  |
| `rate_limit.exceeded`   | `rateLimit.middleware.ts`      | warn  |
| `security.cors.denied`  | `app.ts`                       | warn  |
| `mail.delivery.failed`  | `auth.ts` / `users.service.ts` | error |

- [x] **T4.1. Implementar utilidad HMAC de pseudonimización.** (commit `f13bcec`)
      Crear función `pseudonymize(value)` usando `LOG_PSEUDONYMIZATION_KEY`. Se usa
      para email (`actorPseudonym`) e IP. No registrar email ni IP en claro en
      eventos de seguridad. Añadir tests.
- [x] **T4.2. Escribir tests primero de cada evento.** (commit `eb3d18b`)
      Casos críticos:
  - JWT rechazado no aparece en el log.
  - Login fallido no revela existencia del usuario.
  - Email/IP se pseudonimizan.
  - 403 registra permiso requerido, scope validado y actor, no el payload.
  - 429 registra el nombre del limiter, no su clave interna.
- [x] **T4.3. Instrumentar autenticación y autorización.** (commit `bfa0471`)
      `authenticate` y `authorize` emiten sus eventos sin incluir cabeceras. En
      `requirePermission`/`requireRole`/`requireOwnership` registra el motivo de la
      denegación.
- [x] **T4.4. Instrumentar rate limiting.** (commit `8d2fcd7`)
      El `handler` de `authRateLimit` registra `rate_limit.exceeded` con el nombre
      del limiter. No registrar la clave (que puede contener email/IP).
- [x] **T4.5. Instrumentar flujos de auth en `auth.service.ts`.** (commit `916925c`)
      Login, refresh, logout, cambio de contraseña, verificación y reset. Nunca
      registrar tokens ni passwords.
- [x] **T4.6. Instrumentar denegación CORS en `app.ts`.** (commit `566d3f1`)
      En el callback `origin` de `cors`, emitir `security.cors.denied` con el origen
      rechazado (es un dato de configuración, no PII).
- [x] **T4.7. Verificar.**
      `pnpm test` (foco en middleware y auth) y `pnpm run typecheck`.
      Verificado 2026-09-26: 1077/1077 tests, typecheck/lint en verde.
      Los 11 eventos de seguridad están instrumentados y cubren: token
      inválido, cuenta desautorizada, login exitoso/fallado, cambio de
      password, revocación de sesión, autorización denegada (rol,
      permiso, ownership), rate limit, CORS y mail.delivery.failed.

---

## Fase 5 - Infraestructura De Auditoría

**Archivos a crear:**

- `src/modules/audit/audit.types.ts`
- `src/modules/audit/audit.service.ts`
- `src/modules/audit/audit.service.test.ts`
- `prisma/migrations/<timestamp>_add_durable_audit_events/migration.sql`

**Archivos a modificar:**

- `prisma/schema.prisma`

- [ ] **T5.1. Modelar `AuditEvent` en `prisma/schema.prisma`.**
      Campos: `id` (cuid), `action`, `occurredAt` (`Timestamptz(3)` UTC),
      `actorType` (enum `USER|ANONYMOUS|SYSTEM`), `actorId`, `resourceType`,
      `resourceId`, `scopeType`, `scopeId`, `targetUserId`, `requestId`,
      `changes Json?`, `metadata Json?`.
      Índices: `(resourceType, resourceId, occurredAt)`, `(actorId, occurredAt)`,
      `(action, occurredAt)`, `(scopeType, scopeId, occurredAt)`, `(occurredAt)`.
      Preferir `action String` + unión de literales en TypeScript en lugar de enum
      PostgreSQL (el catálogo evoluciona).
- [ ] **T5.2. Definir el catálogo y tipos en `audit.types.ts`.**
      Unión literal de acciones, tipo `AuditContext`, allowlist de claves válidas en
      `changes` y `metadata`, y el enum `actorType`.
- [ ] **T5.3. Escribir tests primero de `audit.service.ts` (TDD).**
      Casos:
  - Inserta el evento esperado con actor, recurso y cambios.
  - Rechaza claves no permitidas en `changes`/`metadata`.
  - Rechaza valores que parezcan secretos (password, token, hash).
  - El writer exige un `Prisma.TransactionClient` (no usa el cliente global).
- [ ] **T5.4. Implementar `writeAuditEvent(tx, input)`.**
      Firma que recibe el `tx` de la transacción para impedir usos no atómicos.
      Exportar helpers `toAuditContext(req)` en un util separado
      (`src/utils/audit-context.ts`) para no acoplar servicios a Express.
- [ ] **T5.5. Crear la migración.**
      Generar con `pnpm prisma migrate dev --name add_durable_audit_events` y luego
      añadir SQL de trigger `BEFORE UPDATE OR DELETE OR TRUNCATE` que lance excepción
      (patrón de inmutabilidad ya usado en `prisma/migrations/20260919053739_*`).
- [ ] **T5.6. Valida y regenera.**
      `pnpm prisma validate && pnpm prisma format && pnpm prisma generate`.
- [ ] **T5.7. Prueba de integración de rollback y append-only.**
      Con base aislada: forzar fallo del insert de auditoría y comprobar que la
      mutación principal se revierte; confirmar que `UPDATE`/`DELETE`/`TRUNCATE`
      sobre `audit_events` fallan.
- [ ] **T5.8. Verificar.**
      `pnpm test src/modules/audit` y `pnpm run typecheck`.

---

## Fase 6 - Auditar Acciones Críticas

**Archivos a modificar:**

- `src/modules/authorization/delegation.service.ts`
- `src/modules/users/users.controller.ts`
- `src/modules/users/users.service.ts`
- `src/modules/auth/auth.service.ts`
- Tests de cada módulo

Acciones de primera prioridad (privilegios y cuentas):

- [ ] **T6.1. Colaboradores:** `authorization.collaborator_added`,
      `authorization.collaborator_role_changed`,
      `authorization.collaborator_removed`.
      Insertar el evento dentro de la transacción existente
      (`delegation.service.ts:334-351`, `:398-421`, y tabla `removeCollaborator`).
      Para el cambio de rol, leer el rol anterior y guardar old→new.
- [ ] **T6.2. Permisos:** `authorization.permission_granted`,
      `authorization.permission_replaced`, `authorization.permission_revoked`.
      Guardar permiso, scope y ventana `validFrom`/`validUntil` old→new. Nunca
      guardar nombres, emails ni datos personales.
- [ ] **T6.3. Usuarios admin:** `user.admin_created`, `user.role_changed`,
      `user.activated`, `user.deactivated`.
      Pasar un `AuditContext` desde `users.controller.ts` al servicio y usar la
      transacción existente (`users.service.ts:230-258`, `:396-408`).
- [ ] **T6.4. Credenciales:** `auth.password_changed` y
      `auth.other_sessions_revoked`.
      Usar la transacción existente en `auth.service.ts:301-309`. Registrar solo el
      conteo de sesiones revocadas, no sus tokens.
- [ ] **T6.5. Actualizar mocks y tests.**
      Añadir `auditEvent.create` a los mocks Prisma y `$transaction` donde falte
      (users, auth, delegation). Afirmar exactamente un evento por transición y
      ninguno en fallos de validación/autorización.
- [ ] **T6.6. Verificar.**
      `pnpm test src/modules/authorization src/modules/users src/modules/auth`
      `pnpm run typecheck`

---

## Fase 7 - Auditar Ciclos De Vida

**Archivos a modificar:**

- `src/modules/organizational-units/*`
- `src/modules/event-programs/*`
- `src/modules/activities/*`
- `src/modules/careers/*`
- `src/modules/classrooms/*`
- Sus controllers para propagar `AuditContext`
- Tests de cada módulo

Segunda prioridad (alto riesgo / destructivo):

- [ ] **T7.1. Unidades:** `organizational_unit.deactivated`,
      `organizational_unit.reactivated` (transacciones en
      `organizational-units.service.ts:264-287`, `:313-330`).
- [ ] **T7.2. Programas:** `event_program.published`, `event_program.archived`,
      `event_program.reactivated` (`event-programs.service.ts:206-350`).
- [ ] **T7.3. Actividades:** `activity.scheduled`, `activity.unpublished`,
      `activity.schedule_changed`, `activity.cancelled`
      (`activities.service.ts:514-708`).
- [ ] **T7.4. Aulas y carreras:** `classroom.activated`, `classroom.deactivated`,
      `career.deleted` (`classrooms.service.ts:165-201`, `careers.service.ts:176-199`).

Tercera prioridad (completitud administrativa):

- [ ] **T7.5. Catálogos:** `organizational_unit.created/updated`,
      `career.created/updated`, `classroom.created/updated`,
      `event_program.created/updated`, `activity.created/updated`,
      `user.profile_updated`, `user.organization_assignment_changed`.
- [ ] **T7.6. Amenities y disponibilidad de aulas.**
- [ ] **T7.7. Respetar idempotencia.**
      No emitir evento cuando la operación no cambia estado (archivar un programa ya
      archivado, cancelar una actividad ya cancelada).
- [ ] **T7.8. Verificar.**
      `pnpm test` y `pnpm run typecheck`.

---

## Fase 8 - API De Consulta De Auditoría

**Archivos a crear:**

- `src/modules/audit/audit.schemas.ts`
- `src/modules/audit/audit.controller.ts`
- `src/modules/audit/audit.routes.ts`
- `src/modules/audit/audit.openapi.ts`
- Tests de schema, servicio y rutas

**Archivos a modificar:**

- `src/routes.ts`
- `src/docs/openapi.ts`
- `openapi.json`

- [ ] **T8.1. Definir esquemas Zod.**
      Filtros: `action`, `actorId`, `resourceType`, `resourceId`, `scopeType`,
      `scopeId`, `from`, `to`, cursor y límite máximo 100.
- [ ] **T8.2. Implementar el endpoint de solo lectura `GET /api/v1/audit-events`.**
      Orden middleware: `authenticate -> requireAdmin -> validate -> controller`.
      Solo lectura: **no** crear endpoints de update/delete.
- [ ] **T8.3. Documentar en OpenAPI y regenerar.**
      `pnpm run docs:generate && pnpm run docs:check`.
- [ ] **T8.4. Tests de rutas.**
      Verificar 401 sin token, 403 para usuario no admin, 200 para admin, validación
      de filtros y de límite.
- [ ] **T8.5. Bruno (solo si se agrega el endpoint).**
      Si se corre `pnpm run api:collection:import`, restaurar después el script de
      captura de tokens (`data.accessToken`/`data.refreshToken`). No commitear
      tokens reales.
- [ ] **T8.6. Verificar.**
      `pnpm test src/modules/audit` y `pnpm run docs:check`.

---

## Fase 9 - Desplegar Loki, Alloy Y Grafana

**Archivos a crear:**

- `compose.observability.yaml`
- `observability/loki/config.yaml`
- `observability/alloy/config.alloy`
- `observability/grafana/provisioning/datasources/loki.yaml`
- `observability/grafana/provisioning/dashboards/dashboards.yaml`
- `observability/grafana/provisioning/alerting/rules.yaml`
- `observability/grafana/dashboards/api-overview.json`
- `observability/grafana/dashboards/errors.json`
- `observability/grafana/dashboards/security.json`

**Archivos a modificar:**

- `compose.dev.yaml`, `compose.prod.yaml` (driver de logging `local`)
- `.dockerignore` (excluir `observability/**` de imágenes de la API si no aplica)

- [ ] **T9.1. Configurar Loki monolítico (`observability/loki/config.yaml`).**
  - Almacenamiento local con volumen persistente.
  - `compactor.retention_enabled: true`, `working_directory`, `delete_request_store`.
  - `limits_config.retention_period: 720h` (30 días) global.
  - `retention_stream` con selector `{log_type="security"}` y `period: 2160h`
    (90 días), prioridad mayor.
  - `schema_config` con index period `24h` (requisito de retención).
- [ ] **T9.2. Configurar Alloy (`observability/alloy/config.alloy`).**
      Usar `discovery.docker` + `loki.source.docker` + `loki.write`. Añadir labels
      estáticos de baja cardinalidad (`service`, `environment`). No etiquetar por
      `requestId`, `actorId` ni IDs de recurso.
- [ ] **T9.3. Acceder al Docker socket con seguridad.**
      Ejecutar un `docker-socket-proxy` de solo lectura y apuntar Alloy a él; no
      montar `/var/run/docker.sock` directamente en Alloy. Solo habilitar los
      endpoints de lectura necesarios.
- [ ] **T9.4. Configurar Grafana.**
  - `GF_AUTH_ANONYMOUS_ENABLED=false`.
  - Data source Loki provisionada por archivo.
  - Binding inicial a `127.0.0.1` (detrás de proxy TLS en producción).
  - Volumen propio para Grafana.
- [ ] **T9.5. Fijar imágenes por versión o digest.**
      Nada de `latest`. Documentar las versiones elegidas en el ADR-0007.
- [ ] **T9.6. Añadir driver de logging `local` en los servicios Docker.**
      `logging: { driver: local, options: { max-size: '20m', max-file: '5' } }`
      como spool que evita agotar disco si Loki está caído.
- [ ] **T9.7. Puertos restringidos.**
      Loki y Alloy sin puertos públicos. Grafana en `127.0.0.1`. Actualizar
      `.env.example` si se añaden variables (`GRAFANA_ADMIN_PASSWORD`, etc.).
- [ ] **T9.8. Validar la composición.**
      `docker compose -f compose.prod.yaml -f compose.observability.yaml config`
      Resultado esperado: sin errores de sintaxis.

---

## Fase 10 - Paneles Y Alertas

- [ ] **T10.1. Panel `API Overview` (`api-overview.json`).**
      Requests por minuto, distribución 2xx/4xx/5xx, latencia p50/p95 aproximada,
      rutas más usadas, requests abortados.
- [ ] **T10.2. Panel `Errors` (`errors.json`).**
      Errores inesperados por evento, 5xx por ruta, dependencias fallidas,
      reinicios/fallos fatales, búsqueda por `requestId`.
- [ ] **T10.3. Panel `Security` (`security.json`).**
      Fallos de login, JWT inválidos, denegaciones 403, rate limits, cuentas
      desactivadas, cambios de contraseña y sesiones revocadas.
- [ ] **T10.4. Alertas iniciales (`rules.yaml`).**
  - Cualquier evento `fatal`.
  - > 5 errores inesperados en 5 min.
  - > 10 respuestas 5xx en 5 min.
  - > 20 fallos de autenticación en 5 min.
  - > 10 rate limits en 5 min.
    > Nota: calibrar umbrales con una línea base real para evitar fatiga de alertas.
- [ ] **T10.5. Verificar en Grafana.**
      Consultar por un `X-Request-ID` conocido y ver la línea de acceso; confirmar
      que los paneles cargan y que una alerta de prueba se dispara.

---

## Fase 11 - Frontera Better Auth

- [ ] **T11.1. Inventariar endpoints directos `/api/auth/*` realmente usados.**
      `src/app.ts:53` monta el handler completo de Better Auth. Identificar cuáles
      son necesarios para el frontend y cuáles duplican los endpoints propios.
- [ ] **T11.2. Restringir superficies no usadas.**
      Deshabilitar o bloquear endpoints del proveedor que no se requieran.
- [ ] **T11.3. Verificar hooks de la versión instalada (1.7.5).**
      Para signup, verificación de email y reset de contraseña, comprobar si existe
      un hook post-éxito utilizable para auditar el sujeto.
- [ ] **T11.4. Instrumentar auditoría post-éxito donde sea seguro.**
      Solo cuando el sujeto se identifique con certeza. Documentar que una operación
      provider-owned **no** es atómica con el insert de auditoría si Better Auth no
      comparte la transacción.
- [ ] **T11.5. Confirmar la separación.**
      Fallos de login y reset van a Loki (seguridad), no a `audit_events`.

---

## Fase 12 - Verificación Final

- [ ] **T12.1. Suite completa.**
  ```bash
  pnpm test
  pnpm run test:coverage
  pnpm run typecheck
  pnpm run lint
  pnpm run format:check
  pnpm run build
  ```
- [ ] **T12.2. Prisma y documentación.**
  ```bash
  pnpm prisma validate
  pnpm prisma format
  pnpm prisma generate
  pnpm run docs:generate
  pnpm run docs:check
  ```
- [ ] **T12.3. Composición Docker.**
  ```bash
  docker compose -f compose.prod.yaml -f compose.observability.yaml config
  ```
- [ ] **T12.4. Pruebas de integración manuales.**
  - Requests simultáneos no cruzan `requestId`.
  - Forzar 400, 401, 403, 404, 429 y 500 y verificar el evento correcto.
  - Buscar un request en Grafana por su `X-Request-ID`.
  - Detener Loki y comprobar que la API sigue respondiendo.
  - Reiniciar Loki/Alloy y comprobar recuperación.
  - Inyectar secretos sintéticos y confirmar que no aparecen ni en Docker ni en
    Loki.
  - Confirmar retención con datos de prueba antiguos.
  - Confirmar rollback cuando falle el audit insert.
  - Confirmar que una revocación conserva historial tras eliminar el grant
    mutable.
  - Ejecutar `pnpm run api:run:smoke`.

---

## Duración Y Retención Propuesta

| Datos                                 | Retención | Configuración                                |
| ------------------------------------- | --------: | -------------------------------------------- |
| Logs de desarrollo                    |    7 días | `compose.observability.yaml` (dev)           |
| Access/aplicación/infra de producción |   30 días | `loki/config.yaml`                           |
| Eventos de seguridad                  |   90 días | `retention_stream` `log_type=security`       |
| Auditoría PostgreSQL                  |  365 días | Política + procedimiento de purga controlada |

- [ ] **T13.1. Ratificar los 365 días de auditoría.**
      No se encontró política de retención en el repositorio. Confirmar con política
      institucional/asesoría legal antes de automatizar la eliminación. Hasta
      entonces, no purgar automáticamente.
- [ ] **T13.2. Definir el procedimiento de purga.**
      La aplicación no debe poder borrar auditoría (trigger append-only). La purga
      por retención será un procedimiento administrativo privilegiado y auditado.

---

## Criterios De Finalización

- [ ] Producción no contiene `console.*` en el runtime.
- [ ] Todas las respuestas incluyen `X-Request-ID`.
- [ ] Los 5xx son correlacionables sin filtrar detalles al cliente.
- [ ] La app funciona con Loki caído (logs a stdout + rotación local).
- [ ] No se registran cuerpos, credenciales, tokens ni datos personales directos.
- [ ] Los eventos críticos de autorización y administración son atómicamente
      auditables.
- [ ] `audit_events` es append-only a nivel de base de datos.
- [ ] Loki tiene retención activa, almacenamiento persistente y acceso no público.
- [ ] Grafana tiene paneles provisionados y alertas básicas.
- [ ] La política de retención y acceso está documentada en ADR.

---

## Fuentes

- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [Pino v10 API](https://github.com/pinojs/pino/blob/v10.1.0/docs/api.md)
- [pino-http](https://github.com/pinojs/pino-http)
- [Grafana Alloy para Loki](https://grafana.com/docs/loki/latest/send-data/alloy/)
- [Loki y cardinalidad](https://grafana.com/docs/loki/latest/get-started/labels/cardinality/)
- [Retención de Loki](https://grafana.com/docs/loki/latest/operations/storage/retention/)
- [Autenticación de Loki](https://grafana.com/docs/loki/latest/operations/authentication/)
- [Grafana Alerting](https://grafana.com/docs/grafana/latest/alerting/)
- [Docker local logging driver](https://docs.docker.com/engine/logging/drivers/local/)

---

## Riesgos Y Notas

- **Docker socket:** montar el socket directamente otorga control efectivo del
  host. Usar socket proxy de solo lectura.
- **Atomicidad con Better Auth:** no se puede garantizar sin hooks/transacción
  compartida; documentarlo y no prometer cobertura completa.
- **Cardinalidad de Loki:** cada label nuevo multiplica streams. Mantener solo
  labels de baja cardinalidad y usar structured metadata para el resto.
- **Retención no retroactiva:** cambios de retención solo aplican a datos nuevos.
- **Ruido de health checks:** excluirlos del access log para no inflar volumen.
- **Alertas sin línea base:** empezar permisivo y calibrar.
- **No commitear secretos:** `LOG_PSEUDONYMIZATION_KEY`, tokens de Bruno y
  credenciales de Grafana no van al repositorio.
