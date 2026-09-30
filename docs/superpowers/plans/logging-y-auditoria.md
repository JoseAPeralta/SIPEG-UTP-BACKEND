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

- [x] **T5.1. Modelar `AuditEvent` en `prisma/schema.prisma`.**
      Campos: `id` (cuid), `action`, `occurredAt` (`Timestamptz(3)` UTC),
      `actorType` (enum `USER|ANONYMOUS|SYSTEM`), `actorId`, `resourceType`,
      `resourceId`, `scopeType`, `scopeId`, `targetUserId`, `requestId`,
      `changes Json?`, `metadata Json?`.
      Índices: `(resourceType, resourceId, occurredAt)`, `(actorId, occurredAt)`,
      `(action, occurredAt)`, `(scopeType, scopeId, occurredAt)`, `(occurredAt)`.
      Preferir `action String` + unión de literales en TypeScript en lugar de enum
      PostgreSQL (el catálogo evoluciona).
- [x] **T5.2. Definir el catálogo y tipos en `audit.types.ts`.**
      Unión literal de acciones, tipo `AuditContext`, allowlist de claves válidas en
      `changes` y `metadata`, y el enum `actorType`.
- [x] **T5.3. Escribir tests primero de `audit.service.ts` (TDD).**
      Casos:
  - Inserta el evento esperado con actor, recurso y cambios.
  - Rechaza claves no permitidas en `changes`/`metadata`.
  - Rechaza valores que parezcan secretos (password, token, hash).
  - El writer exige un `Prisma.TransactionClient` (no usa el cliente global).
- [x] **T5.4. Implementar `writeAuditEvent(tx, input)`.**
      Firma que recibe el `tx` de la transacción para impedir usos no atómicos.
      Exportar helpers `toAuditContext(req)` en un util separado
      (`src/utils/audit-context.ts`) para no acoplar servicios a Express.
- [x] **T5.5. Crear la migración.**
      Generar con `pnpm prisma migrate dev --name add_durable_audit_events` y luego
      añadir SQL de trigger `BEFORE UPDATE OR DELETE OR TRUNCATE` que lance excepción
      (patrón de inmutabilidad ya usado en `prisma/migrations/20260919053739_*`).
- [x] **T5.6. Valida y regenera.**
      `pnpm prisma validate && pnpm prisma format && pnpm prisma generate`.
- [x] **T5.7. Prueba de integración de rollback y append-only.**
      Con base aislada: forzar fallo del insert de auditoría y comprobar que la
      mutación principal se revierte; confirmar que `UPDATE`/`DELETE`/`TRUNCATE`
      sobre `audit_events` fallan.
- [x] **T5.8. Verificar.**
      `pnpm test src/modules/audit` y `pnpm run typecheck`.
      Verificado 2026-09-27: 15/15 tests unitarios de `audit.service` + 4/4 de
      `toAuditContext`; 7/7 tests de integración contra la base aislada
      `sipeg_utp_audit_test` (commit conjunto, rollback por rechazo del payload y
      por fallo del insert en base de datos, `UPDATE`/`DELETE`/`TRUNCATE`
      rechazados por trigger, y evento sobreviviendo al borrado del recurso
      referenciado). Suite completa 1126/1126, typecheck/lint/build en verde.
      Desviaciones respecto de lo planificado: el test de integración es opt-in
      vía `AUDIT_TEST_DATABASE_URL` (documentado en `.env.example`) porque la
      suite del proyecto no usa base de datos real; `removeCollaborator` y
      `revokePermission` se envuelven en `$transaction` porque no tenían
      transacción previa y el audit debe ser atómico con el borrado; el payload
      persiste `NULL` explícito en las columnas opcionales en lugar de omitirlas.

---

## Fase 6 - Auditar Acciones Críticas

**Archivos a modificar:**

- `src/modules/authorization/delegation.service.ts`
- `src/modules/users/users.controller.ts`
- `src/modules/users/users.service.ts`
- `src/modules/auth/auth.service.ts`
- Tests de cada módulo

Acciones de primera prioridad (privilegios y cuentas):

- [x] **T6.1. Colaboradores:** `authorization.collaborator_added`,
      `authorization.collaborator_role_changed`,
      `authorization.collaborator_removed`.
      Insertar el evento dentro de la transacción existente
      (`delegation.service.ts:334-351`, `:398-421`, y tabla `removeCollaborator`).
      Para el cambio de rol, leer el rol anterior y guardar old→new.
- [x] **T6.2. Permisos:** `authorization.permission_granted`,
      `authorization.permission_replaced`, `authorization.permission_revoked`.
      Guardar permiso, scope y ventana `validFrom`/`validUntil` old→new. Nunca
      guardar nombres, emails ni datos personales.
- [x] **T6.3. Usuarios admin:** `user.admin_created`, `user.role_changed`,
      `user.activated`, `user.deactivated`.
      Pasar un `AuditContext` desde `users.controller.ts` al servicio y usar la
      transacción existente (`users.service.ts:230-258`, `:396-408`).
- [x] **T6.4. Credenciales:** `auth.password_changed` y
      `auth.other_sessions_revoked`.
      Usar la transacción existente en `auth.service.ts:301-309`. Registrar solo el
      conteo de sesiones revocadas, no sus tokens.
- [x] **T6.5. Actualizar mocks y tests.**
      Añadir `auditEvent.create` a los mocks Prisma y `$transaction` donde falte
      (users, auth, delegation). Afirmar exactamente un evento por transición y
      ninguno en fallos de validación/autorización.
- [x] **T6.6. Verificar.**
      `pnpm test src/modules/authorization src/modules/users src/modules/auth`
      `pnpm run typecheck`
      Verificado 2026-09-27: 440/440 tests en los tres módulos (11 nuevos de
      delegación, 11 de usuarios, 6 de credenciales), suite completa 1126/1126,
      typecheck/lint/build y `docs:check` en verde. Comprobación end-to-end con
      el servicio real y la base aislada: la promoción de rol escribe un único
      `user.role_changed` old→new; al bloquear el insert de auditoría con un
      trigger temporal, la desactivación revierte por completo (el usuario sigue
      activo y sus 2 sesiones no se borran) y, al retirar el bloqueo, la misma
      llamada desactiva, revoca y escribe exactamente 1 evento.
      Desviaciones: `collaborator_added` requiere `id` en `collaboratorSelect`
      (no se exponía en HTTP porque `toCollaboratorDetail` es explícito);
      `permission_granted`/`permission_replaced` se distinguen leyendo el grant
      previo dentro de la transacción; `other_sessions_revoked` solo se emite
      cuando el conteo es mayor que cero; los servicios reciben un
      `AuditContext` opcional desde el controller y el writer completa el
      `requestId` con el contexto de `AsyncLocalStorage`; `createUser` exige el
      `AuditContext` porque no recibe actor por parámetro.

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

- [x] **T7.1. Unidades:** `organizational_unit.deactivated`,
      `organizational_unit.reactivated` (transacciones en
      `organizational-units.service.ts:264-287`, `:313-330`).
      Verificado 2026-09-27: 1 evento por transición con `before/after` de
      `isActive`, escrito dentro de la transacción existente (que ya era atómica)
      y después de archivar el programa por defecto. Los controllers propagan
      `toAuditContext(req)`. 6 tests nuevos.
- [x] **T7.2. Programas:** `event_program.published`, `event_program.archived`,
      `event_program.reactivated` (`event-programs.service.ts:206-350`).
      Verificado 2026-09-27: los tres `eventProgram.update` se envolvieron en
      `$transaction` para que el insert de auditoría sea atómico. `published`
      solo se emite cuando la transición real es `DRAFT -> ACTIVE`; un PATCH de
      campos sin cambio de estado no audita. 8 tests nuevos.
- [x] **T7.3. Actividades:** `activity.scheduled`, `activity.unpublished`,
      `activity.schedule_changed`, `activity.cancelled`
      (`activities.service.ts:514-708`).
      Verificado 2026-09-27: `updateActivity` y `cancelActivity` envueltos en
      `$transaction`. Un solo evento por PATCH: si cambia el estado gana
      `scheduled`/`unpublished`; si no, `schedule_changed` con únicamente las
      claves que realmente cambiaron (fecha/hora/aula/capacidad). 13 tests
      nuevos.
- [x] **T7.4. Aulas y carreras:** `classroom.activated`, `classroom.deactivated`,
      `career.deleted` (`classrooms.service.ts:165-201`, `careers.service.ts:176-199`).
      Verificado 2026-09-27: `updateClassroom` lee el estado completo antes de
      escribir (necesario para el diff), envuelve el `update` en `$transaction` y
      emite un evento por PATCH: el de ciclo de vida si cambia `isActive`, más
      `classroom.updated` si además cambian atributos. `deleteCareer` ya tenía
      `$transaction`; escribe `career.deleted` con `before` de `code`/`unitId`
      después del `delete`. Los controllers propagan `toAuditContext(req)`.
      6 tests nuevos de ciclo de vida y 9 de borrado/idempotencia.

Tercera prioridad (completitud administrativa):

- [x] **T7.5. Catálogos:** `organizational_unit.created/updated`,
      `career.created/updated`, `classroom.created/updated`,
      `event_program.created/updated`, `activity.created/updated`,
      `user.profile_updated`, `user.organization_assignment_changed`.
      Verificado 2026-09-27: las nueve operaciones de creación y las cinco de
      actualización quedaron dentro de `$transaction` para que el insert de
      auditoría sea atómico. `updateOrganizationalUnit`, `updateCareer` y
      `updateProfile` no tenían transacción y se agregaron. `updateEventProgram`
      y `updateActivity` ya la tenían; ahora emiten, además del evento de ciclo
      de vida, un `*.updated` por los atributos residuales. `user
.organization_assignment_changed` se emite desde `updateProfile` y desde
      `updateAdminUser` (junto a `role_changed`/`activated`/`deactivated`).
      45 tests nuevos.
- [x] **T7.6. Amenities y disponibilidad de aulas.**
      Verificado 2026-09-27: `classroom.amenity_added/removed` y
      `classroom.availability_added/removed`, cada uno en su propia
      `$transaction` junto con la escritura. La disponibilidad registra
      `dayOfWeek`/`startTime`/`endTime` y un flag `hasPeriod`; no persiste el
      texto del `period` (ver desviaciones). 4 tests nuevos.
- [x] **T7.7. Respetar idempotencia.**
      Verificado 2026-09-27: ninguna operación de estas fases emite evento
      cuando el estado no cambia. Un PATCH que repite los valores almacenados no
      audita, tanto si el cambio es estructural (`unitId`, `careerId`, `capacity`,
      `floor`, `type`, `isActive`, fechas) como si es de texto libre (`name`,
      `description`, `label`, `building`, `bannerUrl`, `equipment`, `speakers`).
      La comparación de `equipment` y `speakers` normaliza y ordena el conjunto,
      de modo que reenviar la misma lista en otro orden tampoco audita. Una
      operación rechazada por validación o autorización no audita. 8 tests
      nuevos dedicados a no-op.
- [x] **T7.8. Verificar.**
      `pnpm test` y `pnpm run typecheck`.
      Verificado 2026-09-27: suite completa 1198/1198 (7 skipped, incluida la
      integración de `audit_events` que es opt-in por
      `AUDIT_TEST_DATABASE_URL`), `typecheck`, `lint`, `build` y `docs:check` en
      verde. 72 tests nuevos en total. `docs:check` no reporta drift porque estas
      fases no cambian esquemas de request ni de response: todos los parámetros
      nuevos son opcionales y con valor por defecto.
      Desviaciones respecto de lo planificado: - **No se persiste texto libre en `changes`.** `name`, `description`,
      `label`, `bannerUrl`, `building`, `period`, `firstName` y `lastName`
      admiten `@` y palabras que el validador interpreta como secreto. Escribir
      su valor convertiría una operación legítima en un 500, el mismo problema
      ya documentado en T7.3 con `cancelReason`. Esos campos se reportan por
      **nombre** en `metadata.changedFields` (array de strings), que responde
      qué cambió sin almacenar PII. `changes` queda reservado para valores
      tipados y seguros (enums, números, booleanos, fechas ISO, `HH:mm`, cuids
      y `code`, que el schema restringe a `[A-Za-z0-9-]`). `amenity` sí se
      persiste por valor porque su schema ya prohíbe `@`. - `updateActivity` selecta `equipment` y `speakers` para poder distinguir
      un PATCH que reenvía la misma lista de uno que la cambia (T7.7); los
      datos de los ponentes nunca se escriben en el evento, solo el nombre del
      campo. - Dos tests de fases anteriores afirmaban que un PATCH de campos sin cambio
      de estado no audita (`event-programs`, `activities`). Con T7.5 eso ahora
      emite `*.updated`, así que se reescribieron para afirmar el evento de
      atributo y se añadieron tests gemelos que cubren el no-op. - Se corrigió un bug de `??` frente a `!== undefined` al diferenciar un
      `null` explícito de un campo no provisto: en
      `resolveOrganizationAssignment` una selección `unitId: null` (opción
      "Otro") se reportaba como si no hubiera cambio. - `format:check` sigue fallando por archivos de las fases 1-4
      (`src/config/logger.ts`, `src/server.ts`, `src/middlewares/*`) ajenos a
      esta fase; solo se formatearon los archivos tocados aquí. - La suite completa se verificó en verde dos veces (1198/1198) antes de que
      el entorno se saturara: posteriormente el `load average` subió a ~15 por
      tres sesiones de editor ajenas y un `docker build` concurrente, y ocho
      tests de rutas empezaron a fallar con `Test timed out in 5000ms` sin
      relación con el código. Se confirmó que esos mismos tests fallan igual
      con los cambios de esta fase en `git stash`, y los 19 archivos de los
      módulos auditados pasan 677/677 con un solo worker. Es un problema de
      recursos del entorno, no una regresión.

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
- `src/modules/audit/audit.service.ts`
- `src/modules/audit/audit.types.ts`
- `src/docs/openapi.ts`
- `openapi.json`

- [x] **T8.1. Definir esquemas Zod.**
      Filtros: `action`, `actorId`, `resourceType`, `resourceId`, `scopeType`,
      `scopeId`, `from`, `to`, cursor y límite máximo 100.
      `src/modules/audit/audit.schemas.ts`: `listAuditEventsQuerySchema` con
      `.strict()` (rechaza claves desconocidas), `limit` por defecto 20 y tope
      100, ventana de instantes con `z.iso.datetime({ offset: true })` y
      `.refine` de `from <= to`; esquemas de respuesta `AuditChanges`,
      `AuditMetadata`, `AuditEvent` y `AuditEventPage` con `.meta({ id })` y
      `satisfies z.ZodType<...>`. Tipos de lectura en `audit.types.ts`
      (`AuditValue`, `AuditReadChanges`, `AuditEventResponse`, `AuditEventPage`).
      Verificado 2026-09-28: 13/13 tests en `audit.schemas.test.ts` (defaults,
      coerción y límites, `trim` de ids, enums del catálogo, ventana de
      instantes, cursor opaco, `unknown` y objetos anidados rechazados).
- [x] **T8.2. Implementar el endpoint de solo lectura `GET /api/v1/audit-events`.**
      Orden middleware: `authenticate -> requireAdmin -> validate -> controller`.
      Solo lectura: **no** crear endpoints de update/delete.
      `listAuditEvents` en `audit.service.ts` (junto al writer, sin cambiar su
      firma), `audit.controller.ts`, `audit.routes.ts` y el montaje en
      `src/routes.ts`. Paginación por cursor keyset `(occurredAt, id)` descendente
      con `take: limit + 1`: el cursor es `base64url({"t": iso, "i": id})` y se
      traduce al predicado `OR: [{ occurredAt: { lt } }, { occurredAt, id: { lt } }]`;
      un cursor malformado responde `400 Invalid cursor.` antes de tocar Prisma.
      Verificado 2026-09-28: 11 tests nuevos de `listAuditEvents` (orden y `take`,
      proyección de fila con ISO y `null`, proyección de solo las 13 columnas del
      contrato, `hasMore`/`nextCursor`, un predicado por filtro, ventana con un
      solo lado, cursor como keyset, cursor inválido y página vacía, y que la
      lectura nunca escribe) y 4 de rutas (200 con la página por defecto, 401 sin
      token, 403 como `USER` sin tocar Prisma, y `POST`/`PATCH`/`PUT`/`DELETE`
      respondiendo 404). Suite del módulo 43/43, suite completa 1250/1250
      (7 skipped, incluida la integración de `audit_events` opt-in por
      `AUDIT_TEST_DATABASE_URL`), `typecheck`, `lint`, `build` y `docs:check` en
      verde. La matriz completa de validación de filtros y de límite por ruta
      queda para T8.4.
      Desviaciones respecto de lo planificado: - `limit` tiene valor por defecto 20 (convención de las demás listas del
      repo) con el tope 100 que fija el plan. - El actor se devuelve solo por `actorId`/`targetUserId`, sin join a
      `User`: coherente con la minimización de ADR-0008 y sin exponer email ni
      nombres en la respuesta de auditoría. - `action`, `resourceType` y `scopeType` filtran contra el catálogo de
      `audit.types.ts` con `z.enum`, aunque la columna sea `String`: una acción
      desconocida no es consultable hasta que entra al catálogo. - `from`/`to` son instantes ISO 8601 con offset, no fechas de negocio:
      `occurredAt` es `Timestamptz(3)` y se compara en UTC, sin pasar por
      `src/utils/date.ts` (ADR-0002 aplica a fechas de calendario). - Sin migración de índice compuesto: `audit_events_occurred_at_idx` cubre
      el prefijo del `ORDER BY` y el desempate por `id` se resuelve en memoria
      entre instantes iguales. Queda como seguimiento si el `EXPLAIN` de la
      consulta con rango estrecho muestra degradación. - `changes`/`metadata` se proyectan con un type guard y una única aserción
      local justificada: `writeAuditEvent` es el único autor y valida la
      allowlist de claves y valores antes de insertar. - Los tests del servicio cargan `audit.service.js` con `vi.resetModules()` y
      `vi.doMock` de Prisma, así que el error del cursor se afirma por
      `statusCode` y mensaje en lugar de `instanceof ApiError` (dos instancias
      de la clase en el grafo de módulos del test). - `src/docs/openapi.test.ts` no se tocó: la ruta existe pero todavía no está
      documentada, y `docs:check` no reporta drift porque el documento no
      cambia hasta T8.3.
- [x] **T8.3. Documentar en OpenAPI y regenerar.**
      `pnpm run docs:generate && pnpm run docs:check`.
      `src/modules/audit/audit.openapi.ts` expone una sola operación
      `GET /api/v1/audit-events` (tag `Audit`, `bearerAuth`, 200 con
      `AuditEventPage` y 400/401/403) y `src/docs/openapi.ts` registra
      `auditPaths` y el tag. La descripción deja constancia de que la bitácora es
      append-only y por eso no existe operación de escritura, del orden
      `(occurredAt, id)` descendente y de que la respuesta solo lleva
      identificadores.
      Verificado 2026-09-28: `openapi.json` regenerado y `docs:check` en verde; 4
      componentes nuevos (`AuditEventPage`, `AuditEvent`, `AuditChanges`,
      `AuditMetadata`) y 10 parámetros de query
      (`action`/`resourceType`/`scopeType` como enum del catálogo, `from`/`to`
      como `date-time`, `cursor` con longitud acotada, `limit` con
      `minimum 1`, `maximum 100` y `default 20`). Frente a `HEAD` la única
      operación nueva de esta fase es `GET /api/v1/audit-events` y no se elimina
      ninguna otra (`DELETE /api/v1/activities/{id}` en el mismo diff venía de
      una fase anterior sin commitear). 4 tests nuevos en
      `src/docs/openapi.test.ts` (operación esperada, seguridad y fallos, filtros
      y contrato de página, y ausencia de `post`/`patch`/`put`/`delete` en el
      path); `src/docs` 60/60.
- [x] **T8.4. Tests de rutas.**
      Verificar 401 sin token, 403 para usuario no admin, 200 para admin, validación
      de filtros y de límite.
      Verificado 2026-09-28: `audit.routes.test.ts` pasa de 4 a 11 tests. Los 4
      originales cubren 200 con la página por defecto, 401, 403 sin tocar Prisma y
      `POST`/`PATCH`/`PUT`/`DELETE` en 404. Los 7 nuevos cubren los 9 filtros
      reenviados a `where.AND` con `take: limit + 1`, `limit=101` y `limit=0` con
      `field: query.limit`, enums fuera de catálogo (`query.action`,
      `query.resourceType`, `query.scopeType`), ventana malformada (`query.from`) e
      invertida (`query.to`, `from cannot be after to.`), clave desconocida
      (`field: query`), cursor malformado (`Invalid cursor.` del servicio) y la ida
      y vuelta del cursor por HTTP, que comprueba que el `nextCursor` devuelto se
      traduce en el predicado keyset `OR: [{ occurredAt: { lt } }, { occurredAt, id:
{ lt } }]`. Suite del módulo 54/54; `typecheck`, `lint`, `build` y
      `docs:check` en verde. La suite completa da 1260/1260 (7 skipped) con un
      solo worker; en las corridas en paralelo aparecen timeouts de 5000 ms en
      tests de rutas ajenos a esta fase porque el `load average` del entorno
      estaba en ~13.7, y esos mismos tests pasan en aislamiento. Es el problema de
      recursos ya documentado en T7.8, no una regresión.
      Desviaciones respecto de lo planificado: - `AuditChanges` y `AuditMetadata` se emiten como `anyOf: [object, null]`,
      que es la representación de `.nullable()` en OpenAPI 3.1, y no como
      `nullable: true`. - `from`/`to` documentan el `pattern` largo de `z.iso.datetime` junto a
      `format: date-time`, igual que las ventanas `validFrom`/`validUntil` ya
      publicadas. - `AuditEventPage.limit` sale con los límites del entero seguro porque es un
      `z.number().int()`; el rango real 1..100 vive en el parámetro de query, que
      es el que se valida. Es el mismo tratamiento que `PaginatedCareers.limit`. - No se añadió un test por cada filtro individual en la ruta: el servicio ya
      los cubre uno a uno en T8.2 y la capa HTTP se limita a reenviarlos. - `bruno/` queda desalineado respecto de `openapi.json`; su reimportación es
      T8.5 y sigue pendiente, con el script de captura de tokens que hay que
      restaurar después.
- [x] **T8.5. Bruno (solo si se agrega el endpoint).**
      Si se corre `pnpm run api:collection:import`, restaurar después el script de
      captura de tokens (`data.accessToken`/`data.refreshToken`). No commitear
      tokens reales.
      Verificado 2026-09-28: se creó `bruno/Audit/` con `folder.bru` y 9 peticiones
      escritas a mano, sin ejecutar el import. La carpeta es autocontenida como
      las de `Admin` y `My_Permissions`: empieza con sus dos logins (admin en
      `seq: 1` y FISC head en `seq: 8`, con `X-Forwarded-For` propios
      `203.0.113.231` y `203.0.113.232` para no compartir el bucket de rate
      limit) y después el listado con `limit=5`, el listado filtrado por
      `action`, los tres rechazos de validación (`limit=101`, acción fuera del
      catálogo y cursor malformado), el `401` sin token y el `403` como `USER`.
      Los tests comprueban el contrato de página (`items`, `limit`, `hasMore`,
      `nextCursor` coherente con `hasMore`), el orden descendente por `occurredAt`,
      que el filtro por acción se respeta y que ningún item trae `email`,
      `password`, `accounts` ni hashes Argon2; ninguno asume que la bitácora
      tenga filas. `pnpm --dir bruno exec bru run Audit --env local` contra la API
      de desarrollo: 9/9 requests y 11/11 tests en verde. Ningún archivo lleva
      tokens ni valores reales y `environments/local.bru` no necesitó variables
      nuevas.
      Desviaciones respecto de lo planificado: - **El import no se ejecutó y no se debe ejecutar.** La colección tiene 234
      archivos `.bru` con `tests`, `docs`, `seq` y scripts de captura de tokens
      escritos a mano, y el import los sobrescribe todos; el plan solo
      anticipaba la pérdida del script de captura. Si alguien lo corre, hay que
      revisar la colección completa, no solo el login. - La carpeta no encadena dos peticiones para recorrer el cursor: eso ataría
      el `nextCursor` de una página al `cursor` de la siguiente y la haría
      depender de que la bitácora tenga más de una página. Esa cobertura queda
      en el test de rutas de T8.4; en Bruno solo se prueba el rechazo de un
      cursor malformado.
- [x] **T8.6. Verificar.**
      `pnpm test src/modules/audit` y `pnpm run docs:check`.
      Verificado 2026-09-28: módulo de auditoría 50/50 (7 skipped, incluida la
      integración de `audit_events` opt-in por `AUDIT_TEST_DATABASE_URL`),
      `docs:check` en verde, `typecheck`, `lint` y `build` en verde, suite
      completa 1260/1260 (7 skipped) con `--maxWorkers=1 --fileParallelism=false
--testTimeout=30000`, `pnpm run api:run:smoke` en PASS y la carpeta Bruno
      en verde de extremo a extremo. - Con el timeout por defecto de 5000 ms y en paralelo, `audit.routes.test.ts`
      expira en su primer caso (el que levanta la app completa). No es una
      regresión: el `load average` del entorno llegó a 19.9 por tres sesiones
      `opencode` y varios `chrome-headless` ajenos (98 %, 78 % y 63 % de CPU
      sobre 8 núcleos). Los mismos tests pasan con margen de tiempo. Es el
      problema de recursos ya documentado en T7.8 y no se tocó la configuración
      de Vitest porque es del entorno, no del repositorio.

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

- [x] **T9.1. Configurar Loki monolítico (`observability/loki/config.yaml`).**
  - Almacenamiento local con volumen persistente.
  - `compactor.retention_enabled: true`, `working_directory`, `delete_request_store`.
  - `limits_config.retention_period: 720h` (30 días) global.
  - `retention_stream` con selector `{log_type="security"}` y `period: 2160h`
    (90 días), prioridad mayor.
  - `schema_config` con index period `24h` (requisito de retención).
    Verificado 2026-09-28 contra `grafana/loki:3.7.8` (imagen fijada, digest
    `sha256:1107dd5274e0ada47e42472b7a7e71f3b2a2fe878878108f3e2f9e51528f0193`).
    `-verify-config=true` responde `config is valid` y sale con 0 para
    `config.yaml` y `config.dev.yaml`. Smoke en vivo: Loki arranca, elige
    compactor, `POST /loki/api/v1/push` responde 204, la etiqueta `log_type`
    aparece en el índice y `query_range` devuelve la línea con su `requestId`;
    `/config` confirma `retention_period: 30d` y
    `retention_stream: [{period: 90d, priority: 1, selector: '{log_type="security"}'}]`.
    `prettier --check` limpio en ambos archivos; suite completa 1273/1273
    (7 skipped) y `typecheck`, `lint` y `build` en verde.
    Desviaciones respecto de lo planificado:
    - **Dos archivos de configuración, no uno.** `observability/loki/config.dev.yaml`
      baja ambas ventanas a 168 h (7 días) y mantiene schema, compactor, ring y
      rutas idénticos, para que desarrollo ejercite el mismo camino de código. El
      volumen de desarrollo se descarta con `docker compose down -v`.
    - `auth_enabled: false` (decisión tomada): Loki no publica puerto y su
      frontera es la red de Compose. Si alguna vez se activa, Alloy debe enviar
      `X-Scope-OrgID` (T9.2) y el datasource de Grafana debe definirlo (T9.4).
    - Se añade `ruler.enable_api: false`: Loki no evalúa reglas, las alertas son
      de Grafana (T10.4). Y `analytics.reporting_enabled: false` para no sacar
      telemetría del host.
    - No se fijan topes de ingesta (`ingestion_rate_mb`, `max_streams_per_user`):
      quedan los defaults de 3.7 anotados en un comentario, para calibrarlos con
      línea base real igual que los umbrales de alerta (T10.4).
    - Rutas: `common.path_prefix: /loki` deriva `compactor/`, `wal/`,
      `rules-temp/` y `tsdb-shipper-*`; `common.storage.filesystem` fija
      `chunks_directory` y `rules_directory`, que es lo que recomienda la
      documentación. `compactor.working_directory` se declara igual de forma
      explícita: en 3.7.8 no está deprecado y `storage_config.working_directory`
      no existe (sería error de configuración).
    - `index.period: 24h` no es negociable: `allow_structured_metadata` está en
      `true` por defecto en 3.7, lo que obliga a `store: tsdb` + `schema: v13`,
      y la retención además exige index period de 24 h.
    - `reject_old_samples_max_age` queda en su default (1 semana): la retención
      de 90 días aplica a lo ya almacenado, no a lo que Alloy puede reenviar.
    - Hallazgo para T9.2: Loki agrega por su cuenta las etiquetas `detected_level`
      y `service_name`; el pipeline no debe duplicarlas.
    - Hallazgo para la composición (T9.x): la imagen es distroless (uid 10001, sin
      shell), así que el healthcheck de Loki no puede usar `wget`. El volumen
      nombrado en `/loki` se puebla desde la imagen y Loki escribe sin problema
      (verificado en el smoke).
- [x] **T9.1b. Emitir `logType` en todos los eventos (extensión de T9.1).**
      Con el selector `{log_type="security"}` configurado pero sin productor de la
      etiqueta, la retención de 90 días no habría coincidido con nada: hasta la
      fase 4 solo el access log emitía `logType`, y los 11 eventos de seguridad no.
      Se añadió `logType` en los 21 call sites de producción, con tests primero
      (24 tests en rojo por el campo ausente, 20 aserciones existentes actualizadas).
      Asignación: `security` en `authenticate`, `authorize`, `rateLimit`, la
      denegación CORS de `app.ts` y los cuatro eventos de `auth.service`;
      `application` en `http.error.unexpected` y `mail.delivery.failed`;
      `infrastructure` en los 11 eventos de `server.ts` y en `prisma.warn` /
      `prisma.error`. El access log conserva `access`.
      Verificado 2026-09-28: los 24 tests pasaron de rojo a verde; suite completa
      1273/1273 (7 skipped), `typecheck`, `lint` y `build` en verde.
      Desviaciones: los tests de la instrumentación de Prisma viven en el archivo
      nuevo `src/config/prisma.logs.test.ts` y no en `prisma.test.ts`, que ya
      existía probando el pool con el entorno real y no admite los mocks
      necesarios. Toca archivos de las fases 3 y 4.
- [x] **T9.2. Configurar Alloy (`observability/alloy/config.alloy`).**
      Usar `discovery.docker` + `loki.source.docker` + `loki.write`. Añadir labels
      estáticos de baja cardinalidad (`service`, `environment`). No etiquetar por
      `requestId`, `actorId` ni IDs de recurso.
      El campo `logType` del JSON ya lo emite la aplicación (T9.1b): el pipeline
      debe promoverlo a etiqueta `log_type` con un `stage.json` y dejar de lado
      `detected_level` y `service_name`, que Loki ya agrega por su cuenta.
      Verificado 2026-09-28 contra `grafana/alloy:v1.20.0` (imagen fijada en
      T9.5): `alloy validate --stability.level=generally-available` sale con 0 y
      `alloy fmt --test` limpio. El archivo va con tabulaciones porque es el
      formato canónico de Alloy; `prettier` no parsea `.alloy` y lo deja intacto.
      Pipeline: `discovery.docker` (`tcp://docker-socket-proxy:2375`) →
      `discovery.relabel` (filtro por proyecto y `container` = servicio Compose) →
      `loki.source.docker` → `loki.process` (`stage.json`, `stage.timestamp`,
      `stage.labels`, `stage.structured_metadata`) → `loki.write`.
      Smoke end-to-end contra el stack de desarrollo: un contenedor one-off del
      propio proyecto emitiendo líneas pino reales llega a Loki con las etiquetas
      `container=api`, `environment=development`, `level=warn`, `log_type=security`
      y `service=sipeg-utp-backend`; el filtro `| requestId="<uuid>"` como
      structured metadata devuelve exactamente esa línea; el timestamp es el `time`
      de la aplicación y no el de ingesta de Docker; los logs de `db` también
      entran; el índice no contiene ninguna etiqueta `__meta_*` ni `requestId`; y
      la búsqueda que documenta el README
      (`{service="sipeg-utp-backend", environment="development"} |= "<requestId>"`)
      funciona.

      Desviaciones respecto de lo planificado:

      - El filtro de contenedores va en `discovery.relabel`, no en
        `loki.source.docker`: el `drop` de la fuente se aplica después de arrancar
        el tailer y además emite una entrada sin etiquetas; en `discovery` el
        tailer ni siquiera nace.
      - `container` es el nombre del servicio Compose (`api`, `db`), no el nombre
        de instancia (`sipeg-utp-dev-api-1`): este último cambia en cada recreación
        y abriría un stream nuevo por despliegue.
      - Se recolecta todo el proyecto salvo el stack de observabilidad
        (`sipeg-utp-prod` y `sipeg-utp-dev`, excluyendo `loki`, `alloy`,
        `grafana` y `docker-socket-proxy`). Los logs de `db` son los que alimentan
        el panel de dependencias fallidas de T10.2.
      - `tcp://` y no `http://` para el host del socket: con `http://` Alloy
        instala su propio cliente con un timeout igual a `refresh_interval`, que
        cortaría el `follow` largo de logs cada 60 s.
      - No se usa `stage.docker` (la fuente ya desenvuelve el sobre de Docker) ni
        `stage.drop` (la aplicación ya excluye los health checks exitosos).
      - `max_backoff_retries = 0`: si Loki está caído, reintentar para siempre es
        preferible a descartar; el spool del driver de logs de Docker es el que
        acota el disco.
      - `route`, `method`, `statusCode` y `durationMs` van a structured metadata y
        no a etiquetas: como etiquetas multiplicarían los streams por ruta y por
        código. Para agrupar por ruta, T10.1 usa `| json` en la consulta.
      - Los logs de `db` y `mailpit` solo llevan `container` porque no son JSON:
        se consultan con `{container="db"}` y caen en la retención global de 30
        días.

- [x] **T9.2b. Emitir `level` como texto y heredar `requestId` (extensión).**
      Sin esto la etiqueta `level` no era posible: Loki solo detecta niveles
      textuales y, ante un campo numérico, cae a un grep de palabras que etiquetaba
      mal (`auth.login.failed` emitido en `info` acababa como `error`). Y los
      eventos de seguridad se emitían con el logger raíz, sin `requestId`, aunque
      el `AsyncLocalStorage` lo tuviera: no se podían correlacionar con su línea de
      acceso.
      Verificado 2026-09-28: 6 tests en rojo antes de implementar. `level` como
      texto en `src/config/logger.ts` (con el motivo documentado en el código,
      porque pino recomienda un transport para salida legible) y
      `createRequestLogger()`, que fusiona el `requestId` del contexto y sustituye
      el patrón duplicado de `error.middleware.ts`. Lo usan `errorHandler`,
      `authenticate` (2 eventos), `authorize` (3), `rateLimit` y la denegación CORS
      de `app.ts`. Suite completa 1286/1286 (7 skipped) y `typecheck`, `lint`,
      `build`, `format:check` y `docs:check` en verde.
      Desviación: la firma es `createRequestLogger(bindings?, base?)` y devuelve un
      child logger, así que los call sites pasan los bindings del evento como
      argumento y el mensaje al log; los tests de middleware pasaron a afirmar
      sobre el helper en lugar de sobre `logger.warn`.
- [x] **T9.2c. Ajustar la detección de Loki (extensión).**
      `discover_log_levels: false` y `discover_service_name: []` en ambos configs.
      La detección de niveles queda inactiva porque la aplicación ya entrega el
      nivel y la de Loki solo aportaría la clasificación por palabras; y
      `service_name` duplicaba la etiqueta `service` (y para `db` inventaba un
      valor a partir del nombre del contenedor), lo que abría streams de más.
      Verificado 2026-09-28: `-verify-config` en verde para los dos archivos y, tras
      reiniciar Loki, las líneas nuevas ya no traen `service_name`; las series
      anteriores con esa etiqueta se van con la retención.

- [x] **T9.3. Acceder al Docker socket con seguridad.**
      Ejecutar un `docker-socket-proxy` de solo lectura y apuntar Alloy a él; no
      montar `/var/run/docker.sock` directamente en Alloy. Solo habilitar los
      endpoints de lectura necesarios.
      Verificado 2026-09-28 con `tecnativa/docker-socket-proxy:v0.5.0`: el socket se
      monta `:ro`, el puerto 2375 no se publica (solo `expose` en la red
      `observability`) y todos los permisos denegados quedan explícitos en `0`, con
      `POST=0` dejando pasar únicamente `GET`/`HEAD`. Creado también
      `compose.observability.yaml`, que el plan solo mencionaba: es un overlay sin
      `name:` con `loki`, `docker-socket-proxy` y `alloy`, y fuerza
      `LOG_PRETTY=false` en el servicio `api` de desarrollo (sin JSON, `pino-pretty`
      no se puede etiquetar). `alloy` corre como `473:473`, el usuario que la
      imagen crea sin usar por defecto.

      Desviaciones y hallazgos:

      - `NETWORKS=1` resulta **necesario**: `discovery.docker` llama a
        `GET /networks` para resolver los nombres de red de cada contenedor y sin
        ese permiso falla con 403. Es solo lectura y no habilita ninguna mutación.
      - `EVENTS=1` no lo necesita el pipeline (el tailer sondea `/containers/json`
        cada minuto y el inspect cada 5 s), pero viene activo por defecto; se deja
        y se anota.
      - La red `observability` **no** lleva `internal: true`: verificado que Docker
        no enruta ni publica puertos en una red interna, y Grafana tiene que quedar
        en `127.0.0.1` (T9.4/T9.7). El aislamiento real viene de que ahí no se
        publica ningún puerto y de que los servicios de la aplicación no están en
        esa red.
      - Healthchecks: Loki usa su subcomando `loki -health -health.url=...` (la
        imagen es distroless y no tiene `curl`) y el proxy usa `wget` contra
        `/_ping`. Alloy se queda sin healthcheck: su imagen no trae cliente HTTP.
      - `LOKI_CONFIG=config.dev.yaml` selecciona la ventana de retención del
        overlay; el valor por defecto es `config.yaml`.
      - Nota operativa: el servicio `migrate` de `compose.dev.yaml` usa una imagen
        propia, así que hay que reconstruirla con `docker compose -f
        compose.dev.yaml build migrate` cuando se agregan migraciones; con la
        imagen vieja las migraciones nuevas no se aplican.

- [x] **T9.4. Configurar Grafana.**
  - `GF_AUTH_ANONYMOUS_ENABLED=false`.
  - Data source Loki provisionada por archivo.
  - Binding inicial a `127.0.0.1` (detrás de proxy TLS en producción).
  - Volumen propio para Grafana.

  Verificado 2026-09-29 contra `grafana/grafana:13.2.2` (imagen fijada, digest
  `sha256:ac461fb352abc50da10a51c7d02462e9c05488f11f53f14b3ad79a8145f638a0`)
  con el stack de desarrollo real. `GF_AUTH_ANONYMOUS_ENABLED=false` explicito,
  `GF_USERS_ALLOW_SIGN_UP=false` (añadido), `GF_ANALYTICS_REPORTING_ENABLED=false`
  (añadido, en línea con Loki), puerto `127.0.0.1:3001` y volumen `grafana_data`.
  `GRAFANA_ADMIN_PASSWORD` y `GRAFANA_SECRET_KEY` son obligatorias con `:?`, sin
  default: se verificó que `docker compose config` sale con 1 y mensaje explicito
  si faltan, en lugar de caer al `admin` publico de la imagen.

  Smoke en vivo:

  - Ambas composiciones validan (`config --quiet` exit 0 en dev y prod).
  - `docker compose up -d loki docker-socket-proxy alloy grafana`: los cuatro
    arrancan, Grafana alcanza `healthy` y `/api/health` responde 200 con
    `database: ok` y `version 13.2.2`.
  - `GET /api/datasources` sin credenciales responde **401**, y un login con
    password incorrecta responde 401.
  - El datasource provisionado responde `uid loki`, `type loki`, `access proxy`,
    `url http://loki:3100`, `isDefault true`, `readOnly true`, y su health check
    devuelve `Data source successfully connected. / status OK`.
  - Cadena completa API -> Alloy -> Loki -> Grafana: un `GET` a una ruta
    inexistente con `X-Request-ID` propio aparece en `query_range` consultado a
    traves del proxy de Grafana, con etiquetas `container=api`,
    `environment=development`, `level=info`, `log_type=access`,
    `service=sipeg-utp-backend`. El indice solo expone las cinco etiquetas
    permitidas (`container`, `environment`, `level`, `log_type`, `service`) y
    `log_type` tiene los tres valores esperados (`access`, `infrastructure`,
    `security`).
  - Persistencia: `docker rm -f` del contenedor y recreacion mantienen login,
    datasource y su health check. Un password distinto al de arranque da 401, lo
    que confirma que el valor inicial solo se aplica a un volumen vacio.
  - Aislamiento: `ss -ltn` muestra `127.0.0.1:3001` y nada en 3100, 12345 ni
    2375; desde la IP del host (172.20.234.85) los cuatro puertos rechazan la
    conexion. `api` y `db` siguen solo en `sipeg-utp-dev`, los cuatro de
    observabilidad en `observability`, y la API no resuelve `loki` (ENOTFOUND).
  - `editable: false` bloquea desviar el datasource: un `PUT` a
    `http://evil:3100` responde 403 `Cannot update read-only data source` y el
    `url` sigue siendo `http://loki:3100`.
  - `prettier --check` limpio; suite completa 1286/1286 (7 skipped), `typecheck`,
    `lint` y `build` en verde.

  Desviaciones respecto de lo planificado:

  - **El plan solo menciona el datasource, pero se ancla con `uid: loki`**
    (estable) porque T10.1-T10.4 referencian paneles y reglas de alerta por UID, no
    por nombre. Sin eso, un renombrado los romperia en silencio. Se agregan tambien
    `prune: true`, `maxLines: 1000` y `manageAlerts: false` (coherente con
    `ruler.enable_api: false` de T9.1: las alertas de T10.4 seran reglas gestionadas
    por Grafana que consultan Loki como datasource, no reglas guardadas en Loki).
  - **Se montan las credenciales por variable de entorno, no Docker secrets.** Es
    la convencion del repositorio (`.env` / `.env.prod`), a cambio de que los
    valores quedan expuestos en `docker inspect`. Migrar a `GF_*__FILE` queda como
    opcion si el despliegue lo exige.
  - `GF_USERS_ALLOW_SIGN_UP=false` y `GF_ANALYTICS_REPORTING_ENABLED=false` no
    estaban en el plan: el primero evita que cualquiera cree una cuenta y vea los
    logs `log_type="security"`, y el segundo evita sacar telemetría del host.
  - Solo se monta `provisioning/datasources/`, no el arbol
    `/etc/grafana/provisioning` completo: montarlo entero taparia los directorios
    de la imagen. Verificado que el contenedor conserva `access-control`,
    `alerting`, `dashboards`, `datasources`, `notifiers` y `plugins`. Los montajes
    de `dashboards/` y `alerting/` se agregan en T10, cuando existan los archivos;
    el healthcheck usa `curl`, que confirmo presente en esta imagen (a diferencia de
    Loki, que es distroless).
  - **El puerto por defecto es 3001, no 3000**: la API ya publica 3000 en el host,
    y 3000 es tambien el puerto interno de Grafana. Evitar el choque de nombres hace
    la config explicita y evita depender de quien levante primero.
  - Sin `user:` override: la imagen corre como uid 472 y crea `/var/lib/grafana` en
    el volumen nombrado. Verificado que el volumen queda con el propietario correcto.
  - No se implemento todavia el proxy TLS de produccion: T9.4 deja Grafana en
    loopback, que es lo que pide el plan, y T9.7 revisa el conjunto de puertos.
    Enlazar a loopback presupone un proxy en el host; un proxy en contenedor
    necesitaria la red `observability`, mas `root_url` y cookies seguras.

  Hallazgos ajenos a esta fase, cerrados en la misma sesion:

  - **Deuda de T1.7: `LOG_PSEUDONYMIZATION_KEY` no existia en `.env`, ni en
    `.env.prod`, ni en el bloque `environment:` de `api` en `compose.dev.yaml`.**
    T1.7 pedia propagarla en ambos compose, y solo se hizo en `compose.prod.yaml`.
    La consecuencia no era cosmética: `pseudonymize()` usa
    `env.LOG_PSEUDONYMIZATION_KEY ?? ''`, asi que sin clave todos los
    `actorPseudonym` de los eventos de seguridad eran
    `createHmac('sha256', '')`, una clave publica y reproducible por cualquiera.
    Ademas `docker compose --env-file .env.prod config` fallaba por la misma
    ausencia. Cerrado: los tres archivos la declaran, `compose.dev.yaml` la exige
    con `:?` para que desarrollo ejercite el mismo camino que produccion, y
    `.env` trae un valor marcado como solo desarrollo. En `.env.prod` queda
    declarada y vacia a proposito, con el comando para generarla: las variables
    vacias siguen haciendo fallar `config` (`:?` las rechaza), que es el
    comportamiento correcto hasta que el operador las llene.
  - `api` arrastraba `LOG_PRETTY=true` porque se habia levantado antes de existir
    el overlay; al recrearlo con el overlay ya corre en `false` y sus logs llegan
    como JSON a Loki. Es el comportamiento documentado desde T9.3, no un defecto.
  - Alloy registra `could not transfer logs ... unexpected EOF` de forma
    intermitente al reconectar con contenedores. Es reinicio de stream, no perdida
    de la linea ya entregada, y el query de verificacion la encontro siempre.
  - Sigue pendiente de T1.7 una discrepancia menor sin efecto: `compose.prod.yaml`
    no propaga `LOG_PRETTY`. El logger lo descarta cuando
    `NODE_ENV=production` (`src/config/logger.ts:66`), asi que es un no-op.

- [x] **T9.5. Fijar imágenes por versión o digest.**
      Nada de `latest`. Documentar las versiones elegidas en el ADR-0007.

      Aplicado el criterio mas estricto de los dos que allowe el ADR: las cuatro
      imagenes del stack de observabilidad van con **tag y digest** en el compose
      (`repo:tag@sha256:...`). El tag se lee y el digest fija, asi que mover un tag
      en el registro no cambia lo que corre; el costo es que actualizar una imagen
      exige editar las dos partes a la vez, que es justo lo que se busca.

      | Servicio             | Referencia en el compose                     |
      | -------------------- | ------------------------------------------- |
      | `loki`               | `grafana/loki:3.7.8@sha256:1107dd52...f0193` |
      | `docker-socket-proxy`| `tecnativa/docker-socket-proxy:v0.5.0@sha256:1f5038b5...d3459` |
      | `alloy`              | `grafana/alloy:v1.20.0@sha256:f111cce8...4cd30` |
      | `grafana`            | `grafana/grafana:13.2.2@sha256:ac461fb3...f638a0` |

      Verificado 2026-09-29:

      - `docker compose up -d --force-recreate` de los cuatro servicios: los cuatro
        arrancan desde las referencias con digest y `docker inspect .Config.Image`
        devuelve la referencia completa con `tag@sha256`.
      - Los cuatro `RepoDigest` reales (`docker image inspect --format
        '{{index .RepoDigests 0}}'`) coinciden **carácter a carácter** con los
        escritos en el compose. Los digests no se copiaron de una pagina de
        releases, se tomaron de las imagenes que el stack estaba usando.
      - Loki y Grafana vuelven a `healthy`, el login responde 200, el datasource
        `loki` sigue provisionado y su health check devuelve `OK`, y `/labels`
        responde 200 a traves del proxy de Grafana.
      - `config --quiet` en dev y en prod en verde; sin `IMAGE_TAG` la de prod falla
        con `IMAGE_TAG is required`.
      - `prettier`, `typecheck`, `lint` y `build` en verde. Suite completa
        1296/1296 (7 skipped) con `--maxWorkers=1 --testTimeout=30000`.

      Desviaciones respecto de lo planificado:

      - **El `latest` que quedaba no estaba en observabilidad, sino en la imagen
        de la API.** `compose.prod.yaml` declaraba
        `sipeg-utp-backend:${IMAGE_TAG:-latest}`. Una imagen construida localmente
        **no admite digest** (un digest solo existe en un registro), asi que ahi la
        unica defensa posible es quitar el default: paso a
        `${IMAGE_TAG:?IMAGE_TAG is required}`. Se documento en `.env.example`,
        `.env.prod` (`IMAGE_TAG="2026-09-29"`) y README.
      - **Se documentaron tambien `postgres:18.6-alpine` y `axllent/mailpit:v1.27.8`**
        con su digest en la tabla del ADR, aunque en esta primera pasada **no** se
        fijaron por digest en el compose: son de la aplicacion, no del stack de
        observabilidad, y su tag ya era explicito (no hay `latest`). Se corrigio en
        la ampliacion de abajo.
      - El ADR-0007 gana una seccion "Imagenes Fijadas" con la tabla de las seis
        imagenes y la excepcion justificada de la imagen de la API. `IMP-003` se
        actualizo para exigir tag+digest en lugar de "version o digest".
      - `migrate` y `seed` en produccion siguen con el nombre fijo
        `sipeg-utp-backend:migrate`, sin version. Queda **fuera** de esta politica
        a proposito: se reconstruyen en cada deploy y tampoco provienen de un
        registro. Si se decide versionarlos, es un cambio aparte.

      **Ampliacion (misma sesion): digest tambien para la aplicacion.** Se.extendio
      la fijacion por digest a las dos imagenes de la aplicacion, que en la primera
      pasada solo estaban documentadas: `postgres:18.6-alpine@sha256:6c538e72...`
      en `compose.dev.yaml` y `compose.prod.yaml`, y
      `axllent/mailpit:v1.27.8@sha256:6abc8e63...` en `compose.dev.yaml`. Con esto
      la politica de digest cubre **las seis imagenes de terceros del stack** y la
      tabla del ADR-0007 pasa a ser la politica del stack completo, no solo del
      canal de observabilidad; se le anadio la columna del archivo donde vive cada
      una. Los dos compose de la aplicacion llevan ahora un comentario de politica
      en cabecera, igual que el overlay. Ademas se alineo la regla de
      `AGENTS.md` ("Pin base image versions") con la practica real, que exige
      `tag@sha256:digest` en compose.

      Verificacion de la ampliacion:

      - `docker compose pull db mailpit` resuelve y descarga por digest: prueba de
        que ambas referencias existen en el registro. Se eligio `pull` y no un
        `up --force-recreate` para `db` a proposito, para **no reiniciar la base de
        datos de desarrollo** ni sus datos.
      - Los `RepoDigest` locales de `postgres:18.6-alpine` y `axllent/mailpit:v1.27.8`
        coinciden caracter a caracter con lo escrito en los compose.
      - `mailpit` si se recreo con `--force-recreate` y quedo `healthy`, con su UI
        de loopback respondiendo. Es la unica de las dos sin estado.
      - `config --quiet` en dev y en prod en verde; `prettier`, `typecheck`, `lint`
        y `build` en verde; suite completa 1296/1296 (7 skipped).

      Decision del equipo: **`migrate` y `seed` no se versionan.** Se registro en
      el ADR-0007 como decision deliberada y no como omision: ambas imagenes se
      reconstruyen en cada deploy, no provienen de un registro (no tendrian
      digest) y no hay proceso de releases que referencie la version, asi que un
      tag sobre ellas daria una falsa sensacion de reproducibilidad que la
      siguiente build sobrescribiria.

      Aviso operativo: al fijar `postgres` por digest, el proximo
      `docker compose -f compose.dev.yaml up -d` **recreara el contenedor `db`**
      porque compose ve que la referencia cambio. Los datos sobreviven en el volumen
      `sipeg-utp-dev_postgres_data`; la interrupcion es de segundos.
      - No hay bots de actualizacion en el repositorio (ni Renovate ni Dependabot),
        asi que fijar por digest no introduce riesgo de desincronizacion
        automatica. Se anoto en el ADR.

      Nota de entorno: la primera corrida de la suite dio 7 timeouts de 5000 ms en
      tests de rutas. Ninguno guarda relacion con este trabajo, que solo toca
      compose y documentacion: el `load average` estaba en **27.9** con cuatro
      procesos `chrome-headless` y dos `opencode` de sesiones ajenas. Los 6
      archivos afectados pasan 236/236 aislados y la suite completa da 1296/1296 con
      margen de tiempo. Es el problema de recursos ya documentado en T7.8, T8.4 y
      T8.6.

- [x] **T9.6. Añadir driver de logging `local` en los servicios Docker.**
      `logging: { driver: local, options: { max-size: '20m', max-file: '5' } }`
      como spool que evita agotar disco si Loki está caído.

      El riesgo era real y medido: los siete servicios del stack de desarrollo
      estaban en `json-file` **sin opciones**, que no rota nunca. Como Alloy corre
      con `max_backoff_retries = 0` (T9.2, reintenta para siempre en vez de
      descartar), una caida de Loki o del propio Alloy significaba growth
      ilimitado en el disco del host.

      Implementado con un campo de extension `x-logging` y un anchor por archivo,
      para no repetir un bloque de cuatro lineas doce veces:

      ```yaml
      x-logging: &logging
        driver: local
        options:
          max-size: '20m'
          max-file: '5'
      ```

      aplicado con `logging: *logging` en los 4 servicios de `compose.dev.yaml`
      (`migrate`, `api`, `mailpit`, `db`), los 4 de `compose.prod.yaml` (`migrate`,
      `seed`, `api`, `db`) y los 4 del overlay (`loki`, `docker-socket-proxy`,
      `alloy`, `grafana`). Tope: 100 MB por servicio.

      Verificado 2026-09-29:

      - `docker compose config --format json` resuelve el anchor: los 8 servicios
        de la combinacion dev+overlay y los 4 de produccion devuelven
        `driver=local` con `{'max-file': '5', 'max-size': '20m'}`.
      - `up -d --force-recreate` de `api`, `mailpit`, `loki`,
        `docker-socket-proxy`, `alloy` y `grafana`: los cuatro con healthcheck
        vuelven a `healthy` y `docker inspect .HostConfig.LogConfig` devuelve
        `local map[max-file:5 max-size:20m]` en los seis.
      - **`docker logs` sigue funcionando** con el driver `local`, tanto para la
        salida JSON de la API como para la de texto de mailpit. Era el riesgo
        principal: cambiar el driver no puede romper la lectura de logs.
      - **La cadena de ingesta sigue viva**: un `GET` a una ruta inexistente con
        `X-Request-ID` propio aparece en `query_range` consultado a traves del
        proxy de Grafana, con las mismas etiquetas (`container=api`,
        `log_type=access`, `event=http.request.completed`, `route=unmatched`,
        `statusCode=404`). El driver `local` almacena en otro formato pero lo
        sirve por la misma API de Docker que lee Alloy
        (`GET /containers/{id}/logs`), asi que el pipeline no se entera.
      - `prettier`, `typecheck`, `lint`, `build` y suite completa 1296/1296
        (7 skipped).

      Desviaciones respecto de lo planificado:

      - **El plan decia "en los servicios Docker"; se aplico tambien al stack de
        observabilidad.** Loki, Alloy, Grafana y el socket de proxy escriben en
        disco sin limite si nadie los lee, y son justo los servicios cuyo fallo
        dispara la retencion local. Que el propio colector tenga spool es lo
        coherente con el objetivo de T9.6.
      - **Un anchor por archivo, no un bloque repetido.** Los anchors de YAML no
        cruzan archivos, asi que hay tres definiciones de `x-logging` (una por
        compose) y doce referencias `*logging`. Alternativa descartada: escribir
        el bloque completo en cada servicio, que duplicaba la politica doce veces
        y hacia que cambiarla exigiera editar doce sitios.
      - **El servicio `api` del overlay NO redeclara `logging`.** Los bloques de un
        overlay se fusionan con los del compose base, asi que hereda el `x-logging`
        de `compose.dev.yaml`. Declararlo aqui seria redundante y, si las claves no
        coincidieran, silenciosamente pisaria la del compose base. Se documento en
        un comentario junto al servicio.
      - `migrate` y `seed` tambien llevan `logging`, aunque son one-shot: su salida
        (errores de migracion, resultado del seed) es la que mas se consulta con
        `docker compose logs` cuando un deploy falla.
      - Se eligio `local` y no `json-file` con limites, aunque el tope pedido
        (20m x 5) es identico al de `local` y por tanto no cambia el consumo de
        disco. La razon esta en el ADR-0007: `json-file` rota **en el camino de
        escritura** y frena al proceso mientras comprime, mientras que `local` rota
        sin bloquear. `max-size` y `max-file` quedan declarados aunque sean los
        defaults, como politica explicita.
      - `db` **no se recreo** en esta sesion: sigue en `json-file` hasta su proximo
        `up`. Es la unica pieza pendiente de aplicar en runtime, y se aplica sola
        porque el `up` ya va a recrear `db` por el cambio de referencia a digest de
        postgres (T9.5). Se prefirio no reiniciar la base de desarrollo dos veces.

      Lo que el spool **no** resuelve, documentado en el ADR-0007: acota el disco,
      no garantiza entrega. Si Loki esta caido mas de lo que cabe en 100 MB por
      servicio, las lineas mas antiguas se pierden. Para la bitacora durable de
      cambios sensibles eso es irrelevante, porque no depende de los logs
      (ADR-0008).

- [x] **T9.7. Puertos restringidos.**
      Loki y Alloy sin puertos públicos. Grafana en `127.0.0.1`. Actualizar
      `.env.example` si se añaden variables (`GRAFANA_ADMIN_PASSWORD`, etc.).

      La mayor parte ya venia hecha de T9.3 y T9.4, asi que T9.7 fue sobre todo
      una **auditoria** que encontro **una sola violacion real**. El estado previo:

      | Servicio              | Puerto | Interfaz        | Veredicto |
      | --------------------- | ------ | --------------- | --------- |
      | `api` (dev y prod)     | 3000   | `0.0.0.0` y `::`| **FALLA** |
      | `grafana`             | 3001   | `127.0.0.1`     | ok        |
      | `mailpit` (dev)       | 8025   | `127.0.0.1`     | ok        |
      | `db` (dev)            | 5432   | `127.0.0.1`     | ok        |
      | `db` (prod)           | 5432   | sin publicar    | ok        |
      | `loki`                | 3100   | solo `expose`   | ok        |
      | `alloy`               | 12345  | solo `expose`   | ok        |
      | `docker-socket-proxy` | 2375   | solo `expose`   | ok        |

      Corregido: `api` pasa a `127.0.0.1:${PORT:-3000}:3000` en `compose.dev.yaml`
      y `compose.prod.yaml`. Era el unico servicio alcanzable desde toda la red, y
      en produccion ademas servia HTTP plano.

      `.env.example` **no necesitó cambios**: las variables de Grafana ya estaban
      documentadas en T9.4, con `GRAFANA_PORT` incluida.

      Verificado 2026-09-29:

      - `docker compose config` en dev y prod en verde; en ambos la API declara
        `host_ip: 127.0.0.1` para el puerto 3000.
      - Recreado el servicio `api`: `docker inspect` reporta
        `3000/tcp->127.0.0.1:3000` y ya **no** aparece `:::3000`. `ss -ltn`
        muestra `127.0.0.1:3000` en lugar del anterior `*:3000`.
      - La API sigue respondiendo en `http://127.0.0.1:3000` con
        `X-Request-ID` y `Access-Control-Expose-Headers`, y el origen
        `http://localhost:5173` del frontend sigue aceptado por CORS: el frontend
        usa `VITE_API_BASE_URL=http://localhost:3000`, o sea que lo alcanza por
        loopback y no se rompe.
      - `curl` a `http://172.20.234.85:3000` (la IP del host) no conecta: el
        cierre es efectivo, no solo declarativo.
      - `pnpm run api:run:smoke` en verde contra la API ya restringida.
      - Auditoria de puertos sobre los contenedores en ejecucion: ningun servicio
        publica fuera de `127.0.0.1`.
      - `prettier`, `typecheck`, `lint`, `build` y suite completa 1296/1296
        (7 skipped).

      Desviaciones y hallazgos:

      - **El plan solo pedia Loki, Alloy y Grafana, pero la unica violacion estaba
        en la API.** Sin el arreglo, T9.7 habria quedado cerrado en verde con el
        servicio mas expuesto del stack sigue abierto a la red.
      - **Se documento una brecha que el plan no pedia: no existe terminacion TLS
        en produccion.** T9.4 la habia remitido aqui. No se implemento el proxy
        (es infraestructura nueva con su propio ADR), pero quedo registrada en la
        seccion "Puertos Publicados" de ADR-0007, con las condiciones que debe
        cumplir para no introducir un fallo en silencio. La mas relevante:
        `app.set('trust proxy', 1)` ya esta activo (`src/app.ts:28`) y el rate
        limiting usa `req.ip`, asi que el `1` significa **un solo salto**: si el
        proxy se encadena o envia una cadena `X-Forwarded-For` mas larga de lo
        esperado, `req.ip` cambia y con el cambia la **agrupacion de los buckets de
        rate limit**. Es comportamiento de seguridad, no de observabilidad.
      - Con la API atada a loopback, produccion **no tiene hoy ninguna forma de
        alcanzar la API de forma segura**. Se documento como tal en vez de
        dejarlo como un comentario de puerto.
      - `db` en produccion sigue sin publicar nada y se accede por el nombre de
        servicio `db`. En desarrollo mantiene su puerto en loopback porque se
        conecta desde el host (`psql`, DBeaver, `pnpm prisma`). Se dejo asi: no es
        parte de esta fase y ya cumple la regla.

- [x] **T9.8. Validar la composición.**
      `docker compose -f compose.prod.yaml -f compose.observability.yaml config`
      Resultado esperado: sin errores de sintaxis.

      Verificado 2026-09-29. **El comando escrito arriba no puede pasar tal cual**, y
      el motivo es correcto: la validación es *fail-closed* antes de un despliegue.

      | Invocación                                                            | Resultado                                                                                                |
      | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
      | `-f compose.prod.yaml -f compose.observability.yaml` (lee `.env`)     | `exit 1` — `required variable IMAGE_TAG is missing a value: IMAGE_TAG is required`                        |
      | `--env-file .env.prod` + overlay                                       | `exit 1` — `required variable LOG_PSEUDONYMIZATION_KEY is missing a value`                                |
      | `--env-file .env.prod` + stubs inline de las tres variables con `:?`   | `exit 0`                                                                                                  |

      Las ausencias son deliberadas: `IMAGE_TAG` no admite default desde
      T9.5, y `LOG_PSEUDONYMIZATION_KEY`, `GRAFANA_ADMIN_PASSWORD` y
      `GRAFANA_SECRET_KEY` están vacías en `.env.prod` desde T9.4 (`:?` rechaza
      también el valor vacío, que es lo que obliga a que el operador las llene
      antes del primer despliegue). El comando que documenta el `up` en
      `README.md:400` sí lleva `--env-file .env.prod`; esa asimetría es la que hace
      fallar la variante sin env-file.

      Matriz completa de combinaciones (con los stubs):

      | Combinación                                    | `exit` |
      | ---------------------------------------------- | ------ |
      | `compose.dev.yaml`                             | 0      |
      | `compose.dev.yaml` + overlay                   | 0      |
      | `compose.prod.yaml`                            | 0      |
      | `compose.prod.yaml` + overlay (la de T9.8)     | 0      |
      | solo `compose.observability.yaml`              | 1      |
      | `--no-interpolate` + prod + overlay            | 1      |

      Sobre el config resuelto de `prod + overlay` se ejecutaron además 19 aserciones
      estructurales (filtro por forma, **sin imprimir valores**: solo nombres de
      clave y `<set>`/`<empty>`), todas en verde: proyecto `sipeg-utp-prod`; los 8
      servicios sin colisión entre compose base y overlay; `logging: local`
      20 m × 5 en los 8; redes sin cruces (los 4 de la aplicación solo en
      `sipeg-utp-prod`, los 4 de observabilidad solo en `observability`); los
      únicos puertos publicados son `api 127.0.0.1:3000` y
      `grafana 127.0.0.1:3001`, con `expose` 3100/12345/2375; 4 volúmenes sin
      colisión; 5 imágenes de terceros con `tag@sha256` (las 4 de observabilidad
      más `postgres`) y ningún `latest`; los 4 binds de configuración y el socket
      de Docker en `read_only: true`; `cap_drop: ALL` + `no-new-privileges` en los
      5 servicios que lo declaran; `alloy` con `user: '473:473'`; `api` con
      `init: true` y `stop_grace_period: 15s` intactos tras la fusión;
      `loki.command = ["-config.file=/etc/loki/config.yaml"]`, es decir la
      ventana de 30/90 días y no la de 7 de `config.dev.yaml`; `api` heredando
      `LOG_PRETTY=false` del overlay; las únicas variables vacías de `api` siendo
      el par opcional `MAIL_USER`/`MAIL_PASSWORD`; Grafana con 6 variables, ninguna
      vacía y los tres flags en `false`; los tres healthchecks de observabilidad
      presentes; y las cadenas `depends_on` correctas (`api` espera a `migrate` y
      `seed` con `service_completed_successfully`; `alloy` y `grafana` a `loki` con
      `service_healthy`).

      Se registró además la huella `config --hash '*'` de los 8 servicios. **No es
      un identificador estable**: depende de los valores interpolados, y cambiar el
      stub de `LOG_PSEUDONYMIZATION_KEY` cambió el hash de `api` entre dos corridas
      de la misma configuración. Sirve para detectar cambios no previstos al
      repetir la misma invocación, no para comparar entre entornos.

      Verificación del repositorio: `prettier` limpio en los 6 YAML del stack (los
      3 compose, los 2 de Loki y el datasource de Grafana); `format:check` verde
      **en todo el repositorio**, lo que cierra la deuda de formato que
      arrastraba la fase 7; `typecheck`, `lint` y `build` en verde; y suite
      completa 1296/1296 (7 skipped) en las dos modalidades: en paralelo con el
      timeout por defecto de 5000 ms (20,5 s, sin un solo timeout pese al `load
      average` de ~12) y en un worker con
      `pnpm exec vitest run --maxWorkers=1 --fileParallelism=false
      --testTimeout=30000` (56,7 s). Ojo con la forma: `pnpm test -- --maxWorkers=1`
      **no aplica** el flag (el `--` extra se pasa literal a vitest) y corre en
      paralelo; el comando correcto es `pnpm exec vitest run …`.

      Desviaciones respecto de lo planificado:

      - **No se valida el stack de producción en runtime, solo de forma estática.**
        Es lo que el plan pide ("sin errores de sintaxis") y además es lo único
        posible en este host: el stack de desarrollo ya tiene `127.0.0.1:3000` y
        `127.0.0.1:3001` ocupados, así que un `up` de producción chocaría de puerto
        y crearía un segundo proyecto (`sipeg-utp-prod`) con sus cuatro volúmenes.
        El runtime del overlay ya se validó en T9.3–T9.6 contra el stack real.
      - **`--no-interpolate` no existe en la práctica.** Aparece en
        `docker compose config --help`, pero el binario responde `unknown flag`, así
        que **no hay forma de validar la sintaxis sin resolver los secretos**: toda
        puerta de pre-deploy tiene que suplir los valores. Se descartó añadir un
        script `compose:check` por esto, y porque no se pidió.
      - **El overlay no es autónomo.** `docker compose -f
        compose.observability.yaml config` responde `service "api" has neither an
        image nor a build context specified`. Es el comportamiento correcto de un
        overlay (su servicio `api` solo existe para forzar `LOG_PRETTY=false`), pero
        el mensaje no lo explica; queda anotado aquí en lugar de en el README.
      - **`LOKI_CONFIG` solo está documentado en el README**, no en `.env.example`
        ni en `.env.prod`. El default del overlay (`config.yaml`, 30 días +
        90 para `log_type="security"`) es el correcto para producción y así queda
        confirmado, pero exportarla por error en `.env.prod` bajaría la retención
        a 7 días **en silencio**, sin ningún error de composición. Riesgo anotado,
        sin guardián: el único aviso posible es documental.
      - `cap_drop: ALL` lo declaran 5 de los 8 servicios. `migrate` y `seed` solo
        llevan `no-new-privileges` y `db` ninguna de las dos cosas: es lo que ya
        traían `compose.prod.yaml` y PostgreSQL necesita capacidades para
        inicializar el data directory. No es una regresión de esta fase, pero
        convive con el resto de la política de `cap_drop` del stack.
      - El plan pedía solo "sin errores de sintaxis"; la mitad del valor de T9.8
        estuvo en **auditar el config resuelto**, que es donde se comprueba que la
        fusión del overlay no pisa nada del compose base (puertos, redes, `logging`,
        `init`, healthchecks) y que la ventana de retención de producción es la
        correcta.

---

## Fase 10 - Paneles Y Alertas

- [x] **T10.1a. Corregir la plantilla de ruta del access log (extensión).**
      Prerrequisito de T10.1, no un extra: sin esto el panel de rutas miente.

      `routeTemplate()` leia `req.baseUrl` en el handler de `finish`. Express
      asigna `req.route` al hacer match, con `baseUrl` apuntando todavia al
      montaje, pero **restaura `baseUrl` a `''` de forma sincrona** cuando el
      router se desenrolla, y eso ocurre antes de `finish` para toda respuesta
      que nace dentro de la cadena: `authenticate` responde 401 con
      `next(error)`, igual que `authorize` con 403, `validate` con 400 y los
      limitadores con 429. El caso de 200 no lo sufferia, porque ahi el handler
      responde antes de que el router se desenrolle.

      `captureRouteTemplate(req)` intercepta la asignacion de `req.route` con
      `Object.defineProperty` y guarda `${req.baseUrl}${route.path}` en un
      `WeakMap`; el getter se conserva para que el resto de la cadena siga
      leyendo lo que Express escribio. `routeTemplate()` pasa a leer solo el
      `WeakMap` y devuelve `unmatched` si no hay entrada.

      Verificado 2026-09-29: 6 tests nuevos en rojo antes de implementar (4 de
      `routeTemplate`/`requestLogger` y 2 de contrato). 22/22 del middleware en
      verde. En runtime, con trafico mixto: un 200 y un 401 sobre
      `/api/v1/audit-events` ahora comparten la misma serie en Loki
      (`13 x 200 + 12 x 401` bajo `route="/api/v1/audit-events"`, y cero lineas
      nuevas en la plantilla antigua `/audit-events`).

      Alternativas descartadas: recalcular la plantilla desde `req.originalUrl`
      reimplementa el emparejamiento de rutas; leer `baseUrl` en un `res.end`
      parchado pierde los requests abortados y el camino de `notFoundHandler`;
      montar los subrouters con path explicito no evita que `baseUrl` se restaure.
      Nota de Express verificada empiricamente: `req.route` es una propiedad
      propia, `configurable: true` y asignable, que es lo que hace viable la
      intercepcion.

      De paso, `logCompletion` usaba su propio if/else para el nivel y dejaba
      `accessLogLevel` exportado sin usar (solo lo cubrian sus tests). Ahora
      reutiliza el helper: `aborted ? 'warn' : accessLogLevel(res.statusCode)`,
      comportamiento identico.

      Test que hubo que reescribir: el `routeTemplate` original fijaba
      `req.route` a mano en el mock, antes de que el middleware existiera, asi
      que no reproducible el defecto. Los mocks ahora reproducen el orden real
      de Express con `matchRoute()` y `unwindRouter()`, y `MockRequestOptions`
      ya no acepta `route`/`baseUrl` para que nadie reintroduzca el atajo.

- [x] **T10.1. Panel `API Overview` (`api-overview.json`).**
      Requests por minuto, distribución 2xx/4xx/5xx, latencia p50/p95 aproximada,
      rutas más usadas, requests abortados.

      Selector comun `{service="sipeg-utp-backend", environment=~"$environment",
      log_type="access"}` y 9 paneles: 4 stat (requests del rango, tasa de error
      5xx, p95 de latencia, requests abortados), 2 timeseries (tasa de requests,
      distribucion por clase con 4 consultas apiladas), 1 timeseries de
      latencia p50/p95 y 2 bargauge instantaneos (rutas mas usadas, abortados
      por ruta). `schemaVersion: 42` (el de Grafana 13.2.2, leido del bundle
      servido, para que no corra migracion al cargar), `timezone: utc`,
      `editable: false`, `refresh: 30s`, `graphTooltip: 1` y variable
      `environment` de tipo `query`.

      Verificado 2026-09-29 contra el stack real. Provisionado en la carpeta
      `SIPEG UTP` con `folderUid: sipeg-utp`; `GET /api/dashboards/uid/
      sipeg-api-overview` devuelve los 9 paneles, `schemaVersion: 42`,
      `editable: false` y la variable con la forma `{query, refId}` que Grafana
      13 acepta sin migrar. Las **13 consultas** de los 9 paneles se ejecutaron
      una por una contra Loki sustituyendo `$__auto` por `[1h]` y
      `$environment` por `development`: **0 con error** y con datos
      coherentes entre si (591 requests, 0 % de 5xx, p95 129.78 ms igual en el
      stat y en la serie, 2xx 195 / 3xx 343 / 4xx 53, 10 rutas en el bargauge y
      2 rutas con abortados). Con trafico de 200, 401, 404 y abortados, la
      unica serie vacia es la de 5xx, que es lo correcto: no hubo ninguno.

      Desviaciones respecto de lo planificado:

      - **`| json` no hace falta casi nunca.** T9.2 anticipo que T10.1 usaria
        `| json` para agregar por ruta, y no es asi: `route`, `method` y
        `statusCode` son structured metadata y se consultan directamente
        (`sum by (route) (count_over_time({...} [5m]))` funciona sin `| json`).
        `| json` queda solo donde el campo **no** fue promovido por Alloy: hoy
        unicamente `aborted`, por lo que los dos paneles de abortados lo
        necesitan. Corolario verificado: structured metadata **no** puede ir en
        el selector de stream; `{..., route="/api/v1/audit-events"}` devuelve
        vacio y hay que filtrarlo tras la llave. Este dato no estaba en T9.2.
      - **`quantile_over_time` si existe en Loki 3.7.8**, asi que el p50/p95 del
        plan como "aproximado" se entrega exacto, sin cubos ni grabados
        auxiliares. Tiene dos trampas que la documentacion de Grafana no cubre:
        (a) **exige `by ()`**, porque `| json` convierte cada campo del JSON en
        una etiqueta y sin agrupar devuelve una serie por linea de log;
        (b) `sum(quantile_over_time(...))` es incorrecto, suma entre series
        (daba 5421 ms en lugar de 129 ms). Se usa `by ()` en los dos paneles.
      - **`$__auto` en lugar de `$__rate_interval` y `$__range`.** Es lo que
        recomienda la documentacion de variables de Loki de Grafana: `$__range`
        hace que cada punto agregue sobre toda la ventana del panel. Para
        consultas instantaneas `$__auto` equivale a `$__range`.
      - **"Requests por minuto" se entrega en req/s.** El plan pide esa unidad y
        `rate` de LogQL es por segundo; multiplicar por 60 solo pondria un
        factor constante sobre una pendiente, asi que el panel se llama "Tasa
        de requests", usa `unit: reqps` y lo explica en su descripcion.
      - **Se incluyo 3xx como cuarta clase** en la distribucion. El plan nombra
        2xx/4xx/5xx, pero en este despliegue 304 (la cache del navegador sobre
        `openapi.json`) es la clase mas voluminosa: sin ella la serie de 2xx y
        la de 3xx se leian como el mismo trafico partido.
      - **Una clase de estado con cero respuestas no devuelve serie.** Es el
        comportamiento de LogQL, no un fallo: la barra de 5xx aparece sin
        relleno, que es justo lo que se quiere ver. Los cuatro stat si
        necesitan `or vector(0)` porque un vector vacio se renderiza como "No
        data" y no como cero.
      - **`topk` no se puede aplicar sobre `unwrap`**: Loki responde `invalid
        aggregation count_over_time with unwrap`. Por eso "Rutas mas usadas"
        agrega sobre `count_over_time` y la latencia se consulta aparte.
      - **`aborted` sigue sin estar en structured metadata.** Se comprobo que
        filtrarlo con `| json` funciona, asi que no es bloqueante, pero hacerlo
        indexable eliminaria el unico `| json` que queda en el panel. Queda
        como mejora opcional; anadir un campo al `stage.structured_metadata` de
        Alloy no abre streams, asi que el coste es bajo.
      - **`schemaVersion: 42`** en lugar del 16 del ejemplo de la
        documentacion de Grafana: se leyo `DASHBOARD_SCHEMA_VERSION` del bundle
        que sirve la imagen, para no depender de una migracion al cargar.
      - **Ruta de montaje `/etc/grafana/dashboards`, no
        `/var/lib/grafana/dashboards`.** La documentacion usa
        `/var/lib/grafana/dashboards`, pero ese path esta dentro del volumen
        `grafana_data`, que es el estado y la base SQLite de Grafana: anidar un
        bind mount de solo lectura ahi mezclaria configuracion versionada con
        estado.
      - **`updateIntervalSeconds: 30` en lugar de 30 por defecto o <=10.** Con
        <=10 Grafana se apoya en eventos del sistema de archivos y su propia
        documentacion advierte que un bind mount de Docker puede no propagarlos.
      - **T10.1a se corrigio aqui y no aparte** por decision del equipo, porque
        "rutas mas usadas" habria quedado partido y T10.2 ("5xx por ruta")
        habria heredado el mismo defecto: los 5xx los emite `errorHandler` desde
        el nivel de app, o sea, ya desenrollado.

      Hallazgo ajeno a esta fase, comprobado: Grafana 13.2.2 emite 13 warnings
      `plugins.dedupe ... Skipping loading of plugin as it's a duplicate` en cada
      arranque. **No lo causa T10.1**: un contenedor limpio con los mismos
      montajes no los emite. La causa es que el volumen `grafana_data` ya
      contiene `/var/lib/grafana/plugins/` con 20 plugins que Grafana extrajo de
      `plugins-bundled` en el primer arranque (08:14, sesion de T9.4), y ahora los
      deduplica contra el bundle. Es inocuo, pero T9.4 registro un arranque
      "limpio" que en realidad ya traia estas lineas.

      Verificacion del repositorio: suite completa **1311/1311** (7 skipped) con
      `pnpm exec vitest run --maxWorkers=1 --fileParallelism=false
      --testTimeout=30000`; `typecheck`, `lint` y `build` en verde; `docs:check`
      en verde (esta fase no toca el contrato HTTP); `prettier --check` limpio en
      los cuatro archivos de la fase. **`format:check` del repositorio entero
      falla en `src/lib/auth.ts`**, que no es de esta fase: viene del trabajo de
      endurecimiento de password reset sin commitear (una linea de import de 101
      caracteres) y ya estaba rota antes de empezar. Se deja sin tocar para no
      mezclar el alcance; se resuelve con `pnpm exec prettier --write
      src/lib/auth.ts`.

- [x] **T10.1b. Provisionar el archivo de paneles y montar los directorios.**
      `observability/grafana/provisioning/dashboards/dashboards.yaml` mas los dos
      binds de Grafana en `compose.observability.yaml`
      (`provisioning/dashboards` y `dashboards`).

      Verificado 2026-09-29: `config --quiet` en verde; `up -d --force-recreate
      grafana` levanta el panel en el arranque con `finished to provision
      dashboards` y sin error; `GET /api/search` lo devuelve con
      `folderUid: sipeg-utp` y `folderTitle: SIPEG UTP`; el contenedor conserva
      `datasources`, `dashboards`, `alerting` y `plugins` (los subdirectorios no
      montados siguen viniendo de la imagen). El montaje de `alerting/` queda
      para T10.4, cuando existan las reglas.

- [x] **T10.2. Panel `Errors` (`errors.json`).**
      Errores inesperados por evento, 5xx por ruta, dependencias fallidas,
      reinicios/fallos fatales, búsqueda por `requestId`.

      12 paneles y 14 consultas, en la misma carpeta `SIPEG UTP`. Cuatro stat
      (errores inesperados, 5xx del rango, inicios del proceso, fallos fatales),
      un timeseries apilado por `(event, err_type)`, un bargauge de 5xx por ruta,
      un timeseries de 5xx en el tiempo, un timeseries del ciclo de vida del
      proceso, un timeseries con las dependencias de la aplicacion (tres
      consultas: `prisma.error`, `prisma.warn`, `mail.delivery.failed`), un stat
      y un panel de logs de PostgreSQL, y el panel de correlacion por
      `requestId`. Variables: `environment` (query, como en T10.1) y
      `request_id` (textbox, `.*` por defecto).

      Verificado 2026-09-29 contra el stack real.

      - **Aprovisionado por sondeo, sin reiniciar Grafana.** `GET
        /api/dashboards/uid/sipeg-errors` devolvia 404, se escribio el JSON y a
        los 45 s ya estava disponible con sus 12 paneles, `schemaVersion: 42`,
        `editable: false` y `folderUid: sipeg-utp`, sin tocar el contenedor
        (arrancado a las 10:21, el archivo escrito a las 10:56). Es la prueba de
        que `updateIntervalSeconds: 30` sondea de verdad y no depende de inotify:
        exactamente el motivo por el que en T10.1b no se eligio `<=10`.
      - **Las 14 consultas responden `status: success`** con `$__auto`
        sustituido por `[1h]`. Los ceros son correctos, no fallos: no habia
        errores inesperados ni 5xx ni fallos de dependencia en la ventana.
      - **5xx real y `err_type` confirmado.** Un `POST` con JSON malformado
        produce 500, `http.error.unexpected` con `err: {type: "SyntaxError"}` y
        su linea de acceso con `statusCode: 500`. El agrupamiento
        `sum by (event, err_type) (… | json | __error__="")` devuelve
        `{"event": "http.error.unexpected", "err_type": "SyntaxError"} = 1`, lo
        que prueba el aplanado con `_` del parser JSON de Loki. El panel de 5xx
        por ruta devuelve `route: "unmatched"`, que es lo correcto: el fallo
        ocurre en `express.json()`, antes de que el router haga match.
      - **Correlacion verificada en los tres modos.** `| requestId="<uuid>"`
        devuelve 2 lineas de la peticion (el `http.error.unexpected` y su acceso
        500), que es el criterio de finalizacion "los 5xx son correlacionables";
        `| requestId=~".*"` devuelve la cola (3 lineas, 2 accesos y 1 error); y un
        UUID inexistente devuelve 0.
      - Suite completa **1311/1311** (7 skipped); `typecheck`, `lint`, `build`,
        `docs:check` y `prettier` en verde; `config --quiet` en verde en dev y en
        prod+overlay. Los dos paneles quedan listados en `/api/search` dentro de
        `SIPEG UTP`. `format:check` del repositorio entero sigue fallando en
        `src/lib/auth.ts`, por el mismo motivo ajeno a esta fase que se registro
        en T10.1.

      Desviaciones respecto de lo planificado:

      - **Se agrupa por `(event, err_type)`, no solo por `event`.** Leido al pie
        de la letra, "errores inesperados por evento" da una sola serie, porque
        `http.error.unexpected` es el unico evento de error inesperado de la
        aplicacion. `| json` aplana el objeto `err` de pino con `_`, asi que el
        serializador produce `err_type`; y como en produccion el serializador
        deja **solo** `err.type` (ADR-0007, sin `message` ni `stack`), esa es la
        unica dimension del error que sobrevive sin exponer nada sensible. Es
        exactamente la dimension que hace falta para distinguir, por ejemplo, un
        `SyntaxError` de un `PrismaClientKnownRequestError`.
      - **El panel 3 se llama "Inicios del proceso", no "Reinicios".** En
        desarrollo `tsx watch` reinicia el proceso en cada cambio de archivo, asi
        que el conteo no es comparable entre entornos; la descripcion del panel lo
        dice. "Reinicios" sigue siendo la lectura correcta en produccion, donde
        cada `app.starting` es un arranque del contenedor.
      - **Las dependencias se parten en dos paneles y no en uno.** El lado de la
        aplicacion es JSON (`prisma.error`, `prisma.warn`, `mail.delivery.failed`)
        y el lado del contenedor es texto plano de PostgreSQL que solo lleva la
        etiqueta `container`. Un panel unico necesitaria una union de dos formas
        de consulta incompatibles. Ademas `mail.delivery.failed` es
        `log_type="application"` y los eventos de Prisma son
        `log_type="infrastructure"`, asi que el panel de la aplicacion son tres
        consultas y no un `by (event)` unico.
      - **`db` y `mailpit` se nombran explicitamente.** Loki rechaza un selector
        catch-all: `{container=~".*"}` responde `queries require at least one
        regexp or equality matcher that does not have an empty-compatible value`.
        No hay forma de consultar "todos los contenedores".
      - **`log_type` se filtra dentro del selector y `logType` no se puede
        filtrar.** `log_type` es una etiqueta real; `logType` es el nombre del
        campo en el JSON, y un filtro `| logType="infrastructure"` devuelve
        vacio sin error, que es un fallo silencioso facil de no detectar.
      - **La correlacion cubre todos los eventos de la API, no solo los de
        error.** Decision del equipo. Se entra por un 5xx y se necesita el
        contexto completo de la peticion, no unicamente la linea que fallo.
      - **El panel de logs usa el esquema de opciones de Grafana 13**
        (`prettifyLogMessage`, `dedupStrategy`, `sortOrder`, `wrapLogMessage`),
        leido del `panelcfg.cue` de la imagen. En el de PostgreSQL
        `prettifyLogMessage` queda en `false` porque sus lineas no son JSON y la
        opcion no tendria efecto.
      - El texto de las descripciones va **sin tildes**, igual que el resto del
        repositorio.

      Hallazgo ajeno a esta fase, **no se corrige aqui**: un `POST` con el cuerpo
      JSON malformado devuelve **500 en lugar de 400**. `express.json()` lanza un
      `SyntaxError` con `status: 400`, pero `errorHandler` solo respeta el status
      de `ApiError`, asi que cae en la rama de 500 y emite
      `http.error.unexpected`. Consecuencias: (a) es un error de correccion de la
      API, no de observabilidad; (b) cualquier cliente que mande JSON invalido
      dispara la alerta `> 5 errores inesperados en 5 min` de T10.4, que es ruido
      causador de fatiga de alertas justo en lo que el plan pide calibrar con
      cuidado. Todas las rutas validan sus parametros con Zod, asi que un id
      invalido si devuelve 400: la unica via de 5xx hoy es el cuerpo malformado.
      Queda como correccion propuesta para una fase propia; en T10.4 hay que
      tenerla presente al elegir la consulta de esa alerta.

- [x] **T10.3a. Cerrar el hueco del 403 sin scope (extensión, TDD).**
      `requirePermission` lanzaba 403 **sin emitir log** cuando el scope no se
      podia resolver (`authorize.middleware.ts:77`). Ese 403 si aparecia en el
      access log, pero no en `authorization.denied`: el panel de seguridad no
      podia explicar la denegacion.

      Ahora la rama emite el mismo evento que las otras dos, con
      `actorPseudonym` y `requiredPermission`. **No** emite `eventProgramId` ni
      `activityId`: no se conocen, y que falten es justamente la causa de la
      denegacion.

      Verificado 2026-09-29. El test existente `'denies when no scope resolver is
      provided for a non-admin'` ya afirmaba el 403, asi que se le anadio la
      afirmacion del log: en rojo por `Number of calls: 0`, que es la falta
      precisa. 11/11 del archivo en verde. Ademas comprueba que
      `getEffectivePermissions` no se llama (la salida es temprana) y que el
      evento no lleva ids de scope.

      **Y se pudo verificar en runtime**, contra lo que se suponia al planearlo.
      Se sospecho que la rama era inalcanzable porque los resolvers leen
      `req.params` y una ruta `:id` siempre lo llena. Es falso:
      `POST /api/v1/activities` resuelve el scope desde el **cuerpo**
      (`req.body.eventProgramId`), y `validate(createActivitySchema` corre
      *despues* de `requirePermission`. Un `POST /api/v1/activities` con `{}`
      devuelve 403 y produce
      `{"requiredPermission": "activity:create"}` sin `eventProgramId`, que es
      justo el evento que la rama nueva emite. Con el mismo usuario y un
      `eventProgramId` real llega la otra variante, con `eventProgramId`
      presente. Las dos coexisten en el mismo panel.

      Nota de tipado: la primera version del test leia
      `createRequestLoggerSpy.mock.calls.at(-1)?.[0]` con una asercion local, y
      `tsc` la rechazo (`TS2352`/`TS2493`): el mock se crea con `vi.fn(() => ...)`
      sin parametros declarados, asi que `mock.calls` es una tupla vacia de
      tipos. Se reescribio con `expect.not.objectContaining({ eventProgramId:
      expect.anything() })`, que ademas expresa mejor la intencion: "el evento
      no trae este campo", no "este campo no es `undefined`".

- [x] **T10.3b. `max_query_length: 2160h` (extension).**
      Defecto real, no cosmético: Loki deja `max_query_length` en su default de
      `30d1h`, pero `retention_stream` da 90 dias a `log_type="security"`. Una
      consulta de 90 dias fallaba con `the query time range exceeds the limit`
      (`query length: 2166h1m0s`, `limit: 30d1h`). Los 90 dias de retencion que
      anuncian el ADR-0007 y el README eran, en la practica, datos no
      consultables, y un panel de seguridad invita a seleccionar esa ventana.

      Se alinea el limite con la ventana mayor de retencion, en
      `observability/loki/config.yaml` (produccion). En desarrollo no hace falta:
      7 dias de retencion ya estan por debajo del default de 30 dias, y el
      archivo de dev no cambio.

      Verificado 2026-09-29: `-verify-config=true` responde `config is valid` en
      los dos archivos. Arrancando el Loki de desarrollo con `config.yaml` (el
      `LOKI_CONFIG` documentado en T9.3), `/config` pasa a informar
      `max_query_length: 90d` y la consulta de 90 dias que antes fallaba devuelve
      los eventos de seguridad. El Loki de desarrollo quedo restaurado a
      `config.dev.yaml` yvolvio a informar `max_query_length: 30d1h`,
      `retention_period: 1w` y su `retention_stream` de 1w. Loki, Alloy y Grafana
      quedan `healthy` y la ingesta no se interrumpio.

      Observacion sin cerrar del todo: en este build, con el limite en 2160h,
      Loki acepto tambien consultas de 180d, 365d y 3650d, asi que el limite se
      comporta como un suelo y no como un tope estricto. No se investigo mas
      porque no cambia la decision (2160h documenta el techo previsto y coincide
      con la retencion) y porque 3650d devolvio una respuesta no-JSON que no llego
      a clasificar. Queda anotado por si aparece en produccion.

- [x] **T10.3. Panel `Security` (`security.json`).**
      Fallos de login, JWT inválidos, denegaciones 403, rate limits, cuentas
      desactivadas, cambios de contraseña y sesiones revocadas.

      13 paneles y 15 consultas en la carpeta `SIPEG UTP`, con las variables
      `environment` (query) y `request_id` (textbox, `.*` por defecto, el mismo
      panel de correlacion que en `Errors`). Cuatro stat (fallos de login,
      tokens invalidos, 403, rate limits), un timeseries maestro por tipo de
      evento, logins exitosos vs fallidos, 403 por ruta, denegaciones por motivo,
      un bargauge de fallos por actor pseudonimo, uno de rate limits por
      limitador, contrasenas y revocacion de sesiones, y dos paneles de logs.

      Verificado 2026-09-29 contra el stack real, con las **15 consultas en
      `status: success`** y datos coherentes entre paneles. Provisionado por
      sondeo, sin reiniciar Grafana: 404 antes de escribir el archivo, disponible
      45 s despues.

      Datos reales generados para poder validar los agrupamientos por `| json`,
      que era lo no comprobable de antemano:

      | Paneles | Como se genero | Resultado |
      | --- | --- | --- |
      | 1, 5, 10 | login fallido con correo valido y con uno inexistente, y 8 intentos con el mismo pseudonimo desde 8 IPs | 12 fallos, 2 actores pseudonimos |
      | 2 | `Authorization: Bearer` invalido contra una ruta protegida | 4 `auth.token.invalid` |
      | 3, 7, 8 | `USER` contra rutas `requireAdmin` y `requirePermission` | 7 × 403 en 4 rutas |
      | 4, 11 | 5× `forgot-password` desde una IP | 2 × `rate_limit.exceeded`, `limiter=forgot_password.email` |
      | 12 | evento de la API | 28 lineas de seguridad en la ventana |
      | 13 | `.*` | 82 lineas de la API |

      Los conteos cierran exactamente como los describen los paneles: **7 × 403
      en el access log = 6 `authorization.denied` + 1 `security.cors.denied`**,
      y los 6 se reparten en 4 por rol (`requiredRole: ADMIN`, `actualRole:
      USER`) y 2 por `requiredPermission: activity:create` (una con scope
      resuelto y una sin el). Sin el arreglo de T10.3a, el acesso de scope no
      resoluble no habria aparecido en ningun sitio.

      Desviaciones respecto de lo planificado:

      - **La rama `!scope` si es alcanzable, al contrario de lo que se supuso al
        planear.** Los resolvers de `activities` y `authorization` leen
        `req.params`, pero el de `POST /api/v1/activities` lee el **cuerpo**, que
        todavia no esta validado en ese punto. Por eso el arreglo de T10.3a se
        pudo verificar de punta a punta y no solo con unit tests.
      - **El catalogo de eventos se filtra con `event="..."` explicito, no con
        regex.** Durante la investigacion se cayo en la trampa de `[.]`: el
        patron `event=~"auth[.].login[.].*"` significa "punto + *cualquier
        caracter* + login" y devuelve 0 series sin error, porque la forma correcta
        es `auth[.]login[.].*`. Con un catalogo finito y conocido, el matcher
        explicito elimina la clase entera de error. Las expresiones de T10.1 y
        T10.2 (`app[.]fatal`, `app[.]jwks[.]failed`, `app[.].*`) se revisaron y
        son correctas.
      - **El panel de actores es un bargauge, no una tabla.** Con
        `format: "table"` la respuesta de Loki llega con los campos `Time` y
        `Value` y **sin la columna de etiqueta**: el pseudonimo se perderia. El
        nombre de la serie lo aplica el frontend desde `legendFormat`, igual que
        el bargauge de rutas de T10.1, asi que eso lo confirma la revision visual
        de T10.5, no la API.
      - **Se duplica el panel de correlacion por `requestId`** que ya existe en
        `errors.json`, por decision del equipo: una investigacion de seguridad
        empieza por un 403 o un 429 y no deberia obligar a cambiar de dashboard.
      - **El panel de motivos mezcla dos denegaciones por permiso.** Como
        `sum by (...)` no incluye `eventProgramId` (cardinalidad alta), la
        denegacion por scope no resoluble y la de permiso insuficiente en un
        scope resuelto caen en la misma serie. Se distinguen en el panel de logs
        en crudo, y la descripcion del panel lo dice.
      - **`| json` solo donde hace falta:** los paneles de eventos, rutas y
        limitadores no lo llevan porque `event`, `route` y `statusCode` si son
        structured metadata. Los de motivo, actor y limitador si, porque
        `requiredPermission`, `requiredRole`, `actualRole`, `actorPseudonym` y
        `limiter` no lo son.
      - Los paneles de logs usan el esquema de Grafana 13 con
        `prettifyLogMessage: true`, porque las lineas son JSON de una sola linea
        y en crudo no se leen.

      Verificacion del repositorio: suite completa **1311/1311** (7 skipped);
      `typecheck`, `lint`, `build`, `docs:check` y `prettier` en verde; `config
      --quiet` en verde en dev y en prod+overlay; los tres paneles listados en
      `/api/search` dentro de `SIPEG UTP`. `format:check` del repositorio entero
      sigue fallando en `src/lib/auth.ts`, por el mismo asunto ajeno a esta fase
      registrado en T10.1.

- [x] **T10.4. Alertas iniciales (`rules.yaml`).**
  - Cualquier evento `fatal`.
  - > 5 errores inesperados en 5 min.
  - > 10 respuestas 5xx en 5 min.
  - > 20 fallos de autenticación en 5 min.
  - > 10 rate limits en 5 min.
    > Nota: calibrar umbrales con una línea base real para evitar fatiga de alertas.
  - Añadir el bind de `observability/grafana/provisioning/alerting` en
    `compose.observability.yaml` (reservado en T10.1b).

  #### T10.4a. Corregir el 500 por cuerpo malformado (TDD).

  T10.2 dejo anotado que un `POST` con JSON malformado devolvia 500 en vez de 400
  (`express.json()` lanza un `SyntaxError` con `status: 400`, pero `errorHandler`
  solo respetaba el status de `ApiError`). No era cosmetico: cada cuerpo invalido
  emitia `http.error.unexpected` **y** un 5xx, o sea que contaminaba la alerta de
  errores inesperados, el conteo de 5xx y el panel de errores justo en lo que esta
  fase pide calibrar. Decidido **arreglarlo antes** de escribir las alertas.

  `errorHandler` honra ahora un `status`/`statusCode` **4xx entero** (contrato de
  `http-errors`, que es lo que usa `body-parser`): responde con ese status y un
  mensaje de tabla cerrada por status, y **no** emite log `error`. El mensaje
  nunca se copia del error, para no filtrar el cuerpo recibido. Un `status` no
  numerico o 5xx sigue cayendo en la rama de 500 con su log `error`: un 5xx
  describes un fallo del servidor y debe seguir siendo visible.

  Verificado 2026-09-29: 7 tests nuevos en `error.middleware.test.ts` (4 en rojo
  por `expected 400 to be 500`, `expected 413 to be 500`, `expected 415 to be 500`
  y `expected 413 to be 500`), mas un test de punta a punta en `app.test.ts` con
  `supertest` que tambien se confirmo en rojo por `expected 400 "Bad Request", got
500 "Internal Server Error"` con el middleware en su version anterior (`git
stash` del archivo). 11/11 del middleware y 14/14 de `app.test.ts` en verde.

  En runtime: un `POST /api/v1/auth/login` con cuerpo truncado responde **400**,
  `X-Request-ID` presente y `Access-Control-Expose-Headers: X-Request-ID`, cuerpo
  `{"success":false,"message":"Malformed request body.","errors":[]}`, y en Loki
  ese `requestId` tiene **una sola** linea: la de acceso con `statusCode: 400`, sin
  `http.error.unexpected`. `route: unmatched` porque el fallo ocurre en
  `express.json()`, antes de que el router haga match: es el mismo comportamiento
  que ya secciono el hallazgo de T10.2.

  Desviaciones:

  - **Sin evento nuevo.** Un cuerpo invalido es ruido de cliente: queda en el
    access log con su 400, su ruta y su `requestId`, que es todo lo que hace falta
    para investigarlo. Emitir un `warn` nuevo habria obligado a tocar el catalogo
    de eventos del ADR-0007 y el panel que agrupa por `event`.
  - **Tabla de mensajes cerrada (400, 413, 415) en lugar de mapear por `type`**
    (`entity.parse.failed`, `entity.too.large`, ...). El status es lo unico que se
    honra; el `type` de la libreria no aporta y multiplicaria los casos de prueba.

  #### T10.4b. Endurecer el serializador de errores (extensión).

  Hallazgo de T10.4a: `stdSerializers.err` copia todas las propiedades
  enumerables, y `body-parser` adjunta el **cuerpo crudo** en `err.body`. La linea
  que T10.2 encontro en Loki lo confirma (`"body":"{\"code\": \"SIN-CERRAR"`), lo
  que choca de frente con IMP-004 y con el criterio de cierre "no se registrarn
  cuerpos". En produccion no ocurre (el serializador deja solo `err.type`), pero
  el pipeline de desarrollo tambien ingiere esos logs en Loki, asi que la
  exclusion no era solo local.

  Fuera de produccion el serializador conserva `message` y `stack` pero descarta
  `err.body` y `err.headers`. `redact` no los cubria porque sus rutas asumen
  `req.headers.*`, no `err.headers.*`. Un test en `logger.test.ts` con un error que
  lleva `body` con un correo y `headers.authorization` con un token, afirmando
  que ninguno de los dos strings aparece en la linea.

  #### T10.4c. `observability/grafana/provisioning/alerting/rules.yaml`.

  Un grupo `sipeg-api`, `folder: 'SIPEG UTP'`, `interval: 1m`, cinco reglas, cada
  una con dos etapas (`A` consulta instantanea a Loki, `B` `classic_conditions`
  con `reducer: last` y `evaluator: gt`), `dashboardUid` + `panelId`, y
  `annotations` con el motivo del umbral, la consulta base y el panel donde mirar.

  | Regla                     | Umbral | `for` | Panel                    |
  | ------------------------- | ------ | ----- | ------------------------ |
  | `sipeg-fatal`             | `> 0`  | `0s`  | `sipeg-errors` panel 4   |
  | `sipeg-unexpected-errors` | `> 5`  | `0s`  | `sipeg-errors` panel 1   |
  | `sipeg-5xx`               | `> 10` | `0s`  | `sipeg-errors` panel 7   |
  | `sipeg-auth-failures`     | `> 20` | `0s`  | `sipeg-security` panel 6 |
  | `sipeg-rate-limits`       | `> 30` | `2m`  | `sipeg-security` panel 4 |

  Comunes: `sum(count_over_time(...[5m])) or vector(0)`, `noDataState: OK`,
  `execErrState: Alerting`, sin filtro `environment`, `labels.severity`
  (`critical` / `warning`).

  **Calibracion con linea base.** Medida en las ultimas 24 h del stack de
  desarrollo: 1460 accesos, 1 five-5xx, 0 `app.fatal`, 0 `app.jwks.failed`, 25
  `auth.login.failed`, 2 `rate_limit.exceeded`, 6 `authorization.denied`. Los
  umbrales del plan se mantienen, salvo el de rate limits.

  **Rate limits sube de 10 a 30 y gana `for: 2m`.** Los limitadores por IP
  (`login.ip`, `register.ip`, 30/min) agrupan por `req.ip`, que con
  `trust proxy: 1` viene de `X-Forwarded-For`; en produccion no existe todavia el
  proxy TLS que debe generar esa cadena (T9.7), asi que todos los clientes
  compartirian un bucket y la alerta de 10 quedaria permanentemente disparada.
  A eso se suma que 10 rate limits en 5 min es trafico normal de una institucion
  con usuarios compartidos: un `forgot-password` reenviado agota el bucket de
  3/min por correo. **Pendiente de recalibrar en cuanto exista el proxy.**

  Verificado 2026-09-29 contra el stack real:

  - **Provisionadas y sanas.** `docker compose ... up -d --force-recreate grafana`
    monta el bind nuevo; el log da `provisioning.alerting ... finished to provision
alerting` y `GET /api/v1/provisioning/alert-rules` devuelve las 5 con
    `provenance: file`, `condition: B`, `folderUID: sipeg-utp`, `ruleGroup:
sipeg-api` y `data` con `refId` `A` y `B`. `GET
/api/v1/provisioning/folder/sipeg-utp/rule-groups/sipeg-api` devuelve el grupo
    con `interval: 60` y las 5 reglas.
  - **El archivo hace round-trip.** `GET /api/v1/provisioning/alert-rules/export`
    (el exportador de Grafana) devuelve `folder: SIPEG UTP`, `interval: 1m`,
    `dashboardUid`/`panelId`, `noDataState`/`execErrState` y los dos `data` con el
    `expr` y el umbral intactos.
  - **Las cinco evaluan bien.** `GET /api/prometheus/grafana/api/v1/rules` da
    `state: inactive` y `health: ok` en las 5, con el log de Grafana mostrando las
    5 consultas a Loki cada minuto con `status=ok`.
  - **Disparo real de punta a punta.** 36 `POST /api/v1/auth/forgot-password` con
    el mismo `X-Forwarded-For` dieron 3 x 200 y 33 x 429; 33
    `rate_limit.exceeded` en la ventana de 5 min. Estado de `sipeg-rate-limits` a
    lo largo de 9 min: `inactive` -> `pending` -> **`firing`** (a los ~3 min, tras
    cumplir `for: 2m`) -> `inactive` de nuevo ~5 min despues de vaciarse la
    ventana. El ciclo completo, incluido el disparo y la resolucion.
  - Repositorio: suite completa **1362/1362** (7 skipped), `typecheck`, `lint`,
    `build` y `docs:check` en verde (esta fase no cambia el contrato HTTP);
    `prettier --check` limpio en los cuatro archivos tocados;
    `docker compose config --quiet` en verde en dev y en dev+overlay, y en
    prod+overlay con los cuatro stubs de variables (sin ellos sigue fallando en
    `LOG_PSEUDONYMIZATION_KEY`, como quedo documentado en T9.8). `pnpm run
api:run:smoke` en PASS.
  - `format:check` del repositorio entero sigue fallando en `src/lib/auth.ts`, por
    el mismo asunto ajeno a esta fase registrado en T10.1.

  Desviaciones respecto de lo planificado:

  - **Sin contact point**, por decision. Las alertas se evalúan y se ven en la UI
    de Grafana, pero no notifican. Anadirlo exige `GF_SMTP_*` mas
    `contact-points.yaml`, es decir variables de entorno y secretos nuevos, que el
    plan no pedia. Queda como fase aparte; en desarrollo, con Mailpit, haria
    verificable T10.5 de punta a punta.
  - **Se elimino `folderUid: sipeg-utp` de `dashboards.yaml`.** El formato v1 de
    Grafana (`AlertRuleGroupV1`) solo admite `folder` por titulo, y el
    provisioning de alertas corre **antes** que el de paneles, asi que en un
    volumen vacio las reglas crean la carpeta y el UID lo genera Grafana. Un
    `folderUid` fijo en el repositorio no seria mas estable, solo una ilusion. El
    volumen ya inicializado conservo `sipeg-utp` porque las reglas lo encuentran
    por titulo.
  - **El umbral de rate limits se aparta del plan** (30 en vez de 10, con
    `for: 2m`), con el motivo documentado arriba y en el ADR-0007.
  - **Dos defectos los Finds la verificacion en runtime, no los tests:** (a) el
    `classic_conditions` de Grafana referencia el `refId` **del otro** query
    (`query.params: [A]`), no el suyo; con `[B]` las 5 reglas fallaban con
    `expression 'B' cannot reference itself. Must be query or another expression` en
    cada evaluacion. (b) El `GET /api/v1/provisioning/alert-rules` **no devuelve**
    `dashboardUid` ni `panelId` aunque esten aplicados: el struct de respuesta no
    los lleva. Confirmado con el exportador. Un YAML invalido no lo detecta el
    arranque de forma ruidosa: el servicio de provisioning lo acepta y el fallo
    aparece despues, en cada evaluacion, en el log del scheduler.
  - **La API estaba corriendo sin el overlay** (recreada con `compose.dev.yaml a
secas), o sea con `LOG_PRETTY=true`: sus logs eran texto legible y no
coincidian con ningun selector de Loki ni de las alertas. Recreada con el
overlay (`up -d --force-recreate api`) y el JSON volvio. Es el recordatorio del
    hallazgo de T9.4: sin el overlay, la observabilidad no funciona aunque los
    servicios esten arriba.
  - Sin regla de "el proceso dejo de escribir": un contenedor que muere del todo no
    emite `app.fatal`, asi que la muerte silenciosa no dispara nada. Seguimiento:
    alerta de latido sobre `app.listening`.
  - El panel 5 de `errors.json`, "Errores inesperados por evento y tipo", usa el
    selector `log_type="application"`, que tambien incluye
    `mail.delivery.failed`: su titulo no es del todo exacto. La alerta de T10.4c
    filtra `| event="http.error.unexpected"` explicito y no arrastra ese caso.
    Seguimiento de T10.2.

  #### T10.4d. Bind de Compose.

  `compose.observability.yaml` suma
  `./observability/grafana/provisioning/alerting:/etc/grafana/provisioning/alerting:ro`
  junto a los binds de datasources y dashboards, y el comentario que decia que
  `alerting/` se montaria en T10.4 se actualiza. Se mantiene la regla de montar
  solo subdirectorios sueltos: `/etc/grafana/provisioning` completo taparia
  `access-control`, `notifiers` y `plugins` de la imagen. Sin variables nuevas en
  `.env.example` (no hay contact point ni SMTP de Grafana).

  #### T10.4e. Verificar.

  Verificado 2026-09-29. Suite completa **1362/1362** (7 skipped) en 31 s con el
  timeout por defecto de 5000 ms y en paralelo (a diferencia de T7.8-T10.3, esta
  vez no hizo falta recurrir a `--maxWorkers=1`); `typecheck`, `lint`, `build` y
  `docs:check` en verde; `prettier --check` limpio; `docker compose config
--quiet` en verde en las tres combinaciones; los cinco estados de alerta
  comprobados contra el stack; y el 400 verificado por `curl` con la cadena de
  logs completa.

  #### T10.4f. Verificador del stack de observabilidad (`observability:check`).

  Cierra los dos huecos que T10.4 dejo documentados pero sin red de seguridad: el
  defecto de `classic_conditions` ya corregido, que nada impedia reintroducir, y el
  fallo silencioso del overlay, que solo se detecta mirando logs de Docker.

  `src/observability/check.ts` (con su test en `src/observability/check.test.ts`,
  20 casos) verifica el estado **aplicado** del stack contra la **UI de Grafana**:
  datasource sano, el grupo y sus 5 reglas con umbral, `for`, `noDataState`,
  `execErrState` y panel enlazado, la salud de evaluacion, la ingesta JSON en Loki
  y la carpeta compartida con los tres paneles. Trece comprobaciones, cada fallo
  con su remedio, codigo de salida 1 si hay alguno y **sin modificar nada**.
  Registrado como `pnpm run observability:check`, con `--window` y `--url`.
  Excluido de `tsconfig.build.json` para que no viaje en la imagen, igual que
  `src/docs/generate.ts`.

  Tres decisiones que lo hicieron posible sin dependencias nuevas:

  - **Habla con Grafana, no con Loki.** Loki no publica puerto; el proxy del
    datasource (`/api/datasources/proxy/uid/loki/loki/api/v1/...`) llega igual y
    evita depender de `docker exec`.
  - **Lee `alert-rules/export?format=json`, no el listado de reglas.** El listado
    no devuelve `dashboardUid` ni `panelId` (el hallazgo 1 de T10.4c); el export si,
    y de paso devuelve `for`, los umbrales y `query.params`.
  - **La ingesta se comprueba con `/loki/api/v1/series`.** Con
    `count by (service) (count_over_time({container="api"}[24h]))` Loki responde
    `maximum number of series (500) reached`: `requestId` es structured metadata y
    el motor la devuelve como etiqueta, asi que la agregacion materializa una
    serie por request. `/series` devuelve streams reales, sin ese tope. Hallazgo
    adicional: el intervalo de T10.4c sigue siendo 5 series en 1 h, o sea que el
    limite de D5 se respeta y lo unico que se multiplica es la salida de la
    consulta.

  Verificado 2026-09-29:

  - **TDD.** El test primero; ademas, con el verificador neutralizado
    deliberadamente (que devuelve una sola finding `info`), 19 de los 20 tests
    pasan a rojo: los fixtures difieren del caso sano en una sola dimension cada
    uno, asi que un verificador que ignorase esa dimension no los detectaria.
  - **Prueba positiva:** 12 pass, 0 fail, 13 comprobaciones, exit 0 contra el
    stack de desarrollo.
  - **Prueba negativa del defecto 1:** reintroducido `params: [B]` en
    `sipeg-5xx` y recreado Grafana, el verificador falla en
    `alerts.threshold-ref` ("la etapa B se referencia a si misma", con el mensaje
    literal de Grafana en el remedio) **y** en `rules.health`
    (`health=error`): dos redes independientes. Exit 1. Al revertir y recrear,
    12 pass.
  - **Prueba negativa del defecto 2:** recreado `api` **sin** el overlay
    (`docker compose -f compose.dev.yaml up -d --force-recreate api`, que deja
    `LOG_PRETTY=true`) y generando trafico, el verificador falla en
    `ingest.json-labels` con el comando de remediacion en el remedio. Exit 1.
    Recreado con el overlay, 12 pass con `--window 3`.
  - **Dos bugs propios que encontraron los tests:** el filtro de fallos comparaba
    contra un campo `ok` que el tipo no tiene (todo fallaba), y la deteccion de
    autorreferencia comparaba el `refId` contra el **uid de la regla** en vez de
    contra el `refId` de la propia etapa, con lo que nunca habria detectado nada.
  - Suite completa 1382/1382 (7 skipped), `typecheck`, `lint`, `build` y
    `docs:check` en verde, `prettier --check` limpio, `api:run:smoke` en PASS.

  Desviaciones respecto de lo planificado:

  - **Sin validacion del YAML antes del reinicio.** El verificador lee el estado
    aplicado, asi que un `rules.yaml` roto se detecta despues del
    `up --force-recreate grafana`, no antes. Cubrirlo exigiria parsear el YAML en
    el test y el proyecto no tiene parser (ni `yaml` ni `js-yaml`), o sea anadir
    una devDependency. No se hizo: la relacion coste/beneficio no lo justifica
    mientras el ciclo de edicion sea "cambiar, recrear, verificar".
  - **Un hallazgo que mejora la usabilidad:** despues de arreglar la causa de
    `ingest.json-labels`, el check sigue en rojo hasta que la ventana deja de
    abarcar las lineas viejas (en la prueba, 15 min). Se documento en el README y
    **en el propio remedio**, con la mencion de `--window`, porque si no parece un
    fallo persistente del verificador.
  - La carpeta sigue siendo la unica identidad compartida entre paneles y alertas.
    El verificador la comprueba por **titulo** en las dos partes, que es coherente
    con haber eliminado `folderUid`.

- [x] **T10.5. Verificar en Grafana.**
      Consultar por un `X-Request-ID` conocido y ver la línea de acceso; confirmar
      que los paneles cargan y que una alerta de prueba se dispara.

  Verificado 2026-09-29 contra el stack de desarrollo completo
  (`compose.dev.yaml` + `compose.observability.yaml`, Grafana en
  `http://127.0.0.1:3001`).

  ##### T10.5a. Un defecto real: el `X-Request-ID` no se devolvia al cliente

  La primera consulta con un UUID propio devolvio 200 **sin** cabecera
  `X-Request-ID`. `resolveRequestId` solo la fijaba en la rama que genera el id
  (`src/middlewares/requestLogger.middleware.ts:14`, version previa), de modo que
  un cliente que enviaba su propio `X-Request-ID` se quedaba sin confirmacion de
  cual se correlaciono en Loki: exactamente el caso de uso que T2.2 describe
  ("Responder `X-Request-ID` siempre") y el que T10.5 pide verificar. El test
  existente (`requestLogger.middleware.test.ts:80`) afirmaba el comportamiento
  contrario ("reuses a valid UUID header **without calling setHeader**"), o sea
  que el defecto estaba codificado en la suite.

  Corregido con TDD: primero se reescribio esa asercion (rojo: `expected
undefined to be '11111111-...'`), despues se unifico la funcion para que fije
  la cabecera **siempre**, con el mismo id reuse o generado. Los headers
  devueltos ya no admiten CRLF porque el valor reuse solo pasa el filtro
  `UUID_PATTERN` y el generado viene de `randomUUID()`.

  ##### T10.5b. Correlacion por `X-Request-ID`
  - `GET /api/v1/careers` con `X-Request-ID: 5de36cc9-6743-48f7-a950-609ab43d6190`
    devolvio 200 y `X-Request-ID: 5de36cc9-6743-48f7-a950-609ab43d6190` (el eco ya
    corregido). La busqueda
    `{service="sipeg-utp-backend", environment="development"} | json | requestId="<uuid>"`
    devolvio **exactamente** la linea de acceso esperada:
    `event=http.request.completed`, `method=GET`, `route=/api/v1/careers`,
    `statusCode=200`, `durationMs=101.58`, `logType=access`.
  - Un solo `requestId` correlaciona eventos de **dos** `logType`: con
    `a9c0b11b-f11d-49ea-901f-18d19242b8d4` (login de un `USER` y su intento de
    `GET /api/v1/audit-events`) la busqueda devolvio las cuatro lineas del id:
    `auth.login`-access 200, `authorization.denied` (`warn`, `logType=security`),
    el `GET /api/v1/audit-events` 403 y el `GET /api/v1/users/me` 200. Es la
    confirmacion de que los eventos de seguridad heredan el `requestId` del
    `AsyncLocalStorage` (T9.2b).
  - **D5 se respeta.** `/loki/api/v1/series` para `{container="api"}` devuelve
    solo `container`, `environment`, `level`, `log_type` y `service`. Los campos
    `event`, `requestId`, `route`, `statusCode` y `durationMs` que aparecen en la
    salida de `query_range` son structured metadata y etiquetas creadas por el
    `| json` de la consulta, no etiquetas almacenadas.

  ##### T10.5c. Los tres paneles cargan y sus consultas no fallan

  Se ejecutaron las **42 consultas** de los tres dashboards por
  `POST /api/ds/query` con las variables resueltas (`$environment=development`,
  `$__auto=5m`, `$request_id=.*`), que es la misma ruta que usa la UI:
  **42/42 sin error**. Los paneles con trafico devuelven datos y los que no lo
  tienen devuelven el `or vector(0)` de su propio selector o serie vacia, que es
  lo correcto.

  Antes de dar esto por bueno hubo que generar el trafico que hacia falta: 200s,
  404, 400 de validacion, un 401 por token invalido, un `403` de un `USER`
  (`organizador.fic@utp.ac.pa`) contra `GET /api/v1/audit-events` y logins
  exitosos. Con el 403 los paneles "403 por ruta" y "Denegaciones por motivo"
  pasaron de vacios a 43 puntos cada uno, y los cuatro `event` de seguridad
  quedaron separados correctamente en la agregacion del panel 5:
  `auth.login.failed`, `auth.login.succeeded`, `auth.token.invalid`,
  `authorization.denied`.

  ##### T10.5d. Disparo real de la alerta `sipeg-rate-limits`

  36 `POST /api/v1/auth/forgot-password` en menos de 5 s con el mismo
  `X-Forwarded-For: 203.0.113.251` y cuerpo `{}` (el limiter precede a la
  validacion) dieron **3 x 400 y 33 x 429**, y Loki conto 33
  `rate_limit.exceeded` en la ventana de 5 min. Los limitadores quedaron
  identificados: `forgot_password.email` (los 7 siguientes al bucket de 3/min) y
  `forgot_password.ip` (el resto).

  Estado de `sipeg-rate-limits` muestreando cada 30 s contra
  `/api/prometheus/grafana/api/v1/rules`:

  ```text
  [17:30:04] state=inactive health=ok
  [17:31:04] state=pending  health=ok   <-- los 33 eventos entran en la ventana
  [17:32:04] state=pending  health=ok
  [17:33:04] state=firing   health=ok   <-- cumple for: 2m, ~3 min tras el burst
  [17:35:04] state=firing   health=ok
  [17:36:04] state=inactive health=ok   <-- la ventana de 5 min se vacia
  ```

  Ciclo completo `inactive -> pending -> firing -> inactive`, con `health=ok` en
  todo el recorrido y las ~2 min de `for` medidas con exactitud (pending a las
  17:31:04, firing a las 17:33:04). `/api/prometheus/grafana/api/v1/alerts` deja
  la instancia en `Normal` con las anotaciones de la regla y la severidad
  `warning`. El panel enlazado por la regla es `Security > Rate limits` (panel 4),
  y "Rate limits por limitador" (panel 10) agrupa correctamente por `limiter`.

  ##### T10.5e. `observability:check` y la ventana, en las dos direcciones

  Al final del ejercicio el verificador daba rojo en `ingest.json-labels` con
  1 stream sin `service` y 2 con, siendo el modo correcto. El stream culpable
  era ruido de desarrollo, no la app:

  ```text
  $ tsx watch src/server.ts
  [tsx] change in ./src/middlewares/requestLogger.middleware.ts Restarting...
  ✔ Generated Prisma Client (7.10.0) to ./src/generated/prisma in 385ms
  Prisma schema loaded from prisma/schema.prisma.
  ```

  `tsx watch` y `prisma generate` escriben en texto plano, asi que abren un stream
  sin etiquetas. Intentar arreglarlo se demuestra mal: la regla original ("falla
  si hay **cualquier** stream sin `service`") es la que detecta `LOG_PRETTY`, y
  relajarla a "falla solo si **ninguno** viene etiquetado" introduce un falso
  negativo mucho peor, porque las lineas JSON viejas siguen en la ventana de 15
  min. Medido: con el contenedor recreado **sin** overlay (`LOG_PRETTY=true`) y
  trafico generado, la version relajada daba **pass**. Se intento, se midio y se
  revirtio; la comprobacion queda como estaba y el archivo vuelve a sus 20 tests.

  Lo que si se confirmo, en las dos direcciones, es que la ventana manda:

  | Estado real                           | `--window 15` | `--window 3` |
  | ------------------------------------- | ------------- | ------------ |
  | Overlay, JSON (correcto)              | FAIL          | **PASS**     |
  | Sin overlay, `LOG_PRETTY=true` (roto) | **FAIL**      | info (vacio) |

  La ventana larga sigue roja tras arreglar, y tras romper sigue verde mientras
  abarque la era buena. Es la mitad oscura del hallazgo de T10.4f, que solo
  documentaba el caso de "arreglar": el mismo desfase existe al romper. En
  desarrollo hay que correr `observability:check -- --window 3` despues de
  recrear `api`; en produccion, donde la app no se recrea por un cambio de
  archivo, la ventana por defecto es la correcta.

  Un detalle de esa tabla: con `--window 3` y el contenedor recien recreado el
  verificador puede informar "Sin trafico del contenedor api" en vez de PASS,
  porque todavia no ha entrado ninguna linea. Es `info`, no `fail`, y sale solo.

  ##### T10.5f. Repositorio

  Suite completa **1382/1382** (7 skipped), `typecheck`, `lint`, `build` y
  `docs:check` en verde, `prettier --check` limpio en los archivos tocados, y
  `pnpm run api:run:smoke` en PASS. `observability:check` da **12 pass, 0 fail,
  13 comprobaciones** al empezar y **11 pass, 1 fail** al terminar con la ventana
  por defecto, por el desfase de T10.5e; con `--window 3`, **12 pass, 0 fail**.

  Desviaciones respecto de lo planificado:

  - **Sin navegador, la carga visual de los paneles se verificó por la API.**
    No hay herramienta de navegador en este entorno, asi que no se abrio la UI. Lo
    que se comprobo es lo que la UI consume: las 42 consultas por
    `/api/ds/query` (mismo endpoint y mismo cuerpo que la UI), el datasource
    sano, los dashboards presentes y provisionados con sus variables
    (`environment`, `request_id`) y el enlace regla-panel. Queda para una
    sesion con navegador confirmar el render.
  - **Un falso positivo que casi se reporta como defecto de los paneles.** Con
    las 42 consultas saliendo "vacias" (`data.result`, la forma de la API de
    Grafana <=10) el diagnostico apuntaba a los dashboards; la respuesta de
    Grafana 13 trae `frames`. Con `sum by (event)` tambien aparecia una serie
    sin etiquetas: Loki 3.7 devuelve el agrupamiento en `metric`, no en `stream`.
    Ninguno era un defecto del repositorio, pero conviene conocer las dos formas
    antes de depurar paneles.
  - **La ingesta de Loki se detiene unos segundos tras recrear `api`.** Al
    recrear el contenedor, Alloy cierra el tailer del id viejo
    ("container no longer exists, stopping tailer") y el nuevo tarda su
    `refresh_interval` (60 s) en abrir el suyo. Consultar durante esa ventana da
    cero series y parece un fallo de la cadena.
  - **El panel "Rate limits por limitador" necesita trafico reciente.** Con la
    ventana de `$__auto` (5 min) sale vacio en cuanto el burst sale de la
    ventana, aunque la agrupacion por `limiter` sea correcta. Se comprobo
    disparando un burst pequeno y consultando de inmediato: 5 eventos bajo
    `{"limiter": "forgot_password.email"}`.
  - **Sin contact point**, igual que en T10.4c: el disparo se ve en la UI y en la
    API, pero no notifica. Con Mailpit en desarrollo, anadirlo haria la
    notificacion verificable de punta a punta.
  - **`X-Request-ID` sigue sin documentarse en `openapi.json`.** T2.3 lo dejo
    condicional ("si el contrato lo requiere") y no se documento en ninguna
    operacion. El frontend si puede leerlo, porque `exposedHeaders` lo expone, y
    el README lo describe; lo que falta es que el contrato generado lo declare.
    No se hizo aqui por ser un cambio en las ~40 respuestas del documento.
    Seguimiento: componente `X-Request-ID` reutilizable aplicado a las
    respuestas de la v1.

---

## Fase 11 - Frontera Better Auth

- [x] **T11.1. Inventariar endpoints directos `/api/auth/*` realmente usados.**
      `src/app.ts` montaba el handler completo de Better Auth. Inventario: el unico
      endpoint necesario por HTTP es `GET /api/auth/jwks`, consumido por
      `src/utils/jwt-verifier.ts` y `src/modules/health/health.controller.ts`. Todo
      lo demas (registro, login, refresh, verify-email, forgot/reset-password,
      sesiones) lo invoca la app en server-side con `auth.api.*`, que no pasa por
      el router HTTP. El frontend solo consume `/api/v1/*` y `/api/auth/jwks`.
- [x] **T11.2. Restringir superficies no usadas.**
      Allowlist fail-closed en `src/app.ts`: `GET /api/auth/jwks` explicito y
      `app.all('/api/auth/*splat', notFoundHandler)` para el resto. Cualquier
      endpoint que el proveedor agregue en el futuro nace en 404. Se descarto
      `disabledPaths` de Better Auth: exige enumerar las ~28 rutas core, no cubre
      rutas de plugins futuros y su 404 crudo se salta `notFoundHandler` y su
      logging.

      Efecto de seguridad: `/api/auth/request-password-reset`,
      `/api/auth/reset-password` y `/api/auth/sign-in/email` ya no evitan los
      limitadores de `express-rate-limit`. El limitador interno del proveedor usa
      clave `ip + path` **sin email**, asi que el bucket por email+IP de
      `forgot-password` quedaba en 3/min solo por IP.

      Verificado en `src/app.test.ts` (`Better Auth native surface`).
      Ver `docs/superpowers/plans/2026-09-29-auth-password-reset-hardening.md`.

- [x] **T11.3. Verificar hooks de la versión instalada (1.7.5).**
      Para signup, verificación de email y reset de contraseña, comprobar si existe
      un hook post-éxito utilizable para auditar el sujeto.

  Verificado 2026-09-29 contra Better Auth **1.7.5** instalado, leyendo los tipos
  de `@better-auth/core` y el código de las rutas, no la documentación:

  ```ts
  // @better-auth/core/dist/types/init-options.d.mts
  afterEmailVerification?: (user: User, request?: Request) => Promise<void>;   // :679
  onPasswordReset?: (data: { user: User }, request?: Request) => Promise<void>; // :747
  ```

  | Flujo                 | Hook disponible          | Cuando corre                                              |
  | --------------------- | ------------------------ | --------------------------------------------------------- |
  | Registro (signup)     | **ninguno**              | —                                                         |
  | Verificación de email | `afterEmailVerification` | tras `updateUserByEmail({ emailVerified: true })`         |
  | Reset de contraseña   | `onPasswordReset`        | tras cambiar la contraseña, **antes** de revocar sesiones |

  Dos hallazgos que cambiaron el diseño:

  - **`onPasswordReset` corre antes de la revocación.** En
    `node_modules/better-auth/dist/api/routes/password.mjs:170` el hook se invoca
    entre `updatePassword` (`:169`) y `deleteUserSessions` (`:171`). Escribir
    auditoría dentro del hook convertiría un fallo de la bitácora en sesiones sin
    revocar: el titular tendría una contraseña nueva creyendo que cerró el resto
    de sus accesos. Por eso el hook **solo identifica** y la escritura ocurre
    después.
  - **`afterEmailVerification` solo dispara en la transición real.** En
    `email-verification.mjs:287` Better Auth retorna antes del hook si el email ya
    estaba verificado, así que un reintento no genera un segundo evento sin
    necesidad de deduplicar nada.

  El registro no tiene hook: el servicio ya conoce el `userId` devuelto por
  `signUpEmail`, asi que se audita tras confirmar la persistencia.

- [x] **T11.4. Instrumentar auditoría post-éxito donde sea seguro.**
      Solo cuando el sujeto se identifique con certeza. Documentar que una operación
      provider-owned **no** es atómica con el insert de auditoría si Better Auth no
      comparte la transacción.

  Verificado 2026-09-29. Tres acciones nuevas en el catálogo de
  `src/modules/audit/audit.types.ts`: `user.registered`, `auth.email_verified` y
  `auth.password_reset`. New module `src/modules/auth/auth.audit.ts`.

  - **El hook no escribe, identifica.** `captureAuthAuditSubject(userId)` anota el
    sujeto en un marcador mutable; `withAuthAuditSubject(fn)` crea el marcador,
    ejecuta la llamada del proveedor y lo lee al salir. El marcador viaja en un
    `AsyncLocalStorage` **con un objeto propio por llamada**, no en una variable de
    módulo: dos resets simultáneos no pueden intercambiarse el sujeto (test con
    tres llamadas solapadas con retrasos distintos).
  - **Un error de diseño que los tests lo detectaron en el camino.** La primera
    implementación usó `AsyncLocalStorage.run()` para _publicar_ el sujeto desde el
    hook, asumiendo que sobreviviría al retorno del hook. No lo hace: el store solo
    es visible dentro del callback, así que el servicio nunca lo veía y ningún
    evento se escribía. El test de concurrencia lo destapó y el diseño pasó a
    marcador-por-llamada.
  - **Un fallo de auditoría no revierte la operación.** `recordAuthAuditEvent`
    atrapa el error, emite `audit.write.failed` (`logType: application`, con `action`
    y `targetUserId`, nunca el error del cliente) y devuelve `false`. Perder un
    alta, una verificación o un cambio de contraseña ya aplicado porque el insert
    de auditoría cayó sería peor que la línea que falta.
  - **Actor = sujeto.** Los tres flujos son públicos y sin sesión; el único
    identificador con certeza es el del usuario afectado, así que `actorId` es ese
    id y `actorType` es `USER`. Poner `SYSTEM` o el admin sugeriría una
    intervención que nadie hizo.
  - **Payload mínimo.** Solo ids. Tests que afirman que el correo, la contraseña,
    el número de identidad y el token de un solo uso no aparecen en la fila
    escrita.
  - **`user.registered` se audita tras confirmar la persistencia**, no al recibir
    la respuesta del proveedor: auditar un alta que no llegó a la base dejaría un
    evento sin sujeto real.

  Atomicidad: documentada en ADR-0008 (sección _Better Auth_ y `NEG-003`). Estas
  tres operaciones se escriben **después** de que la mutación se aplique y con su
  propia transacción. Una caída entre ambos deja la operación hecha sin su
  registro; se eligió esa dirección porque la alternativa puede impedir la
  revocación de sesiones.

- [x] **T11.5. Confirmar la separación.**
      Fallos de login y reset van a Loki (seguridad), no a `audit_events`.

  Verificado 2026-09-29. Y aquí aparece un hueco que T11.5 pedía confirmar y que
  **no estaba cerrado**: un token de reset o de verificación rechazado solo
  producía un 400 en el access log, sin evento de seguridad. Los fallos de login sí
  lo tenían (`auth.login.failed`) y los tokens inválidos también
  (`auth.token.invalid`), pero reset y verificación no.

  Añadidos dos eventos, ambos `warn` y `logType: security`:

  - `auth.password_reset.failed`
  - `auth.email_verification.failed`

  Se emiten solo en la rama de token rechazado (`APIError` con estado < 500), que
  es la de intento de adivinación. No incluyen el token, ni la contraseña nueva,
  ni el correo: el test afirma que ninguno de los tres valores aparece en los
  argumentos del log. Un fallo de auditoría (`5xx`) no se registra como
  `*.failed` porque no significa token inválido.

  Con esto la frontera queda así:

  | Operación             | Éxito                                  | Fallo                            |
  | --------------------- | -------------------------------------- | -------------------------------- |
  | Registro              | `audit_events` (`user.registered`)     | solo `access` 4xx                |
  | Verificación de email | `audit_events` (`auth.email_verified`) | `auth.email_verification.failed` |
  | Reset de contraseña   | `audit_events` (`auth.password_reset`) | `auth.password_reset.failed`     |
  | Login                 | `auth.login.succeeded` (Loki)          | `auth.login.failed` (Loki)       |
  | Token inválido        | —                                      | `auth.token.invalid` (Loki)      |

  Ningún camino de fallo escribe en `audit_events`: los cinco call sites de
  auditoría del módulo están en el tramo posterior al éxito, y cada rama de error
  retorna o lanza antes de alcanzarlos. Verificado con tests que afirman cero
  llamadas a `auditEvent.create` en registro no persistido, signup rechazado,
  token de reset rechazado y token de verificación rechazado.

  Desviaciones respecto de lo planificado:

  - **El actor de los tres eventos es el propio usuario, no `SYSTEM`.** El plan
    hablaba de "auditar el sujeto"; con un flujo público sin sesión, atribuir la
    acción a un `SYSTEM` o a un administrador affirmaría una intervención que
    nadie hizo. `actorType: USER` con `actorId` = sujeto es lo que los datos
    sostienen.
  - **El registro no usa hook.** No existe ninguno para signup; se audita en el
    servicio con el id que el proveedor ya devolvió, tras confirmar que la fila
    existe.
  - **Dos eventos de seguridad nuevos, no previstos.** T11.5 daba por hecho que
    los fallos de reset ya estaban en el canal de seguridad. No lo estaban.
  - **`openapi.json` regenerado**: el enum del parámetro `action` de
    `GET /api/v1/audit-events` pasó de 41 a 44 acciones. No hay ningún cambio de
    esquema de request ni de response más allá de ese enum.
  - La bitácora sigue sin registrar **solicitudes** de reset
    (`POST /auth/forgot-password`): solo se audita el cambio de contraseña
    consumiendo un token válido. Una solicitud podría ser relevante para detectar
    abuso, pero no identifica a nadie con certeza y el rate limiting ya la
    instrumenta en `rate_limit.exceeded`. Queda como decisión de política, no
    como carencia técnica.

  Verificación: suite de `src/modules/auth` **125/125** (18 tests nuevos), suite
  completa 1406/1406 (7 skipped), `typecheck`, `lint`, `build`, `docs:check` y
  `prettier --check` en verde.

  Un test de rutas (`POST /login returns an EdDSA access token...`) expiro una
  vez a 5010 ms con el `load average` del entorno en 8.38. Pasa en aislamiento y
  la corrida completa siguiente dio 1406/1406. Es el problema de recursos ya
  documentado en T7.8, T8.6 y T10.4e, no una regresión de esta fase: no se toca
  la configuracion de Vitest porque es del entorno, no del repositorio.

---

## Fase 12 - Verificación Final

- [x] **T12.1. Suite completa.**

  ```bash
  pnpm test
  pnpm run test:coverage
  pnpm run typecheck
  pnpm run lint
  pnpm run format:check
  pnpm run build
  ```

  Verificado 2026-09-30. **1413/1413** (cero omitidas) con la base de pruebas de
  auditoría activa, `typecheck`, `lint`, `build` y **`format:check` limpio en todo
  el repositorio**, que era la deuda que las fases 1-4 dejaron abierta desde
  T7.8 y que se había cerrado al reformatear los archivos tocados.

  Cobertura: **94.11 %** de sentencias (2720/2890), **94.23 %** de líneas
  (2648/2810), 93.89 % de funciones y **87.51 %** de ramas (1584/1810). Lo más
  bajo es `src/utils/jwt-verifier.ts` (53 %), porque la verificación contra el
  JWKS remoto necesita red o JWKS fijo, y `src/observability/check.ts` (79 %),
  cuyas ramas restantes son las de los fallos que solo se dan con el stack caído.

  `vitest.config.ts` **no define ningún umbral** de cobertura. No se añadieron:
  fijarlos sin una línea base acordada puede romper el build, y el plan no los
  pide. Queda como decisión pendiente si se quiere que una regresión de
  cobertura falle en CI.

- [x] **T12.2. Prisma y documentación.**

  ```bash
  pnpm prisma validate
  pnpm prisma format
  pnpm prisma generate
  pnpm run docs:generate
  pnpm run docs:check
  ```

  Verificado 2026-09-30: esquema válido, `format` **no produce cambios**,
  cliente regenerado, y `openapi.json` al día. `git status` queda limpio tras las
  seis órdenes: ninguno de estos comandos reintroduce drift.

- [x] **T12.3. Composición Docker.**

  ```bash
  docker compose -f compose.prod.yaml -f compose.observability.yaml config
  ```

  Verificado 2026-09-30 con `config --quiet`: las tres combinaciones salen 0.
  `prod` + `observability` necesita cinco variables sin default
  (`AUTH_SECRET`, `LOG_PSEUDONYMIZATION_KEY`, `GRAFANA_ADMIN_PASSWORD`,
  `GRAFANA_SECRET_KEY`, `IMAGE_TAG`); con stubs, ninguna más. Sin ellas el fallo
  sigue siendo el de `LOG_PSEUDONYMIZATION_KEY` que documenta T10.4c.

- [x] **T12.4. Pruebas de integración manuales.**
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

  Verificado 2026-09-30 contra el stack de desarrollo completo. Detalle por caso:

  ##### T12.4a. Barrido de estados

  Cada estado con su propio `X-Request-ID`, y cada línea buscada en Loki por ese
  id:

  | Estado | Respuesta | Eventos observados en Loki                                          |
  | ------ | --------- | ------------------------------------------------------------------- |
  | 400    | 400       | `http.request.completed` `info`/`access`, ruta `/api/v1/auth/login` |
  | 401    | 401       | `http.request.completed` `info`/`access`, ruta `/api/v1/users/me`   |
  | 403    | 403       | `authorization.denied` `warn`/`security` **y** el `access` 403      |
  | 404    | 404       | `http.request.completed` `info`/`access`, `route: unmatched`        |
  | 429    | 429       | `rate_limit.exceeded` `warn`/`security` **y** el `access` 429       |

  El 404 registra `route: unmatched`, que es lo que T2.1 fija para rutas no
  reconocidas. El 403 emite dos líneas: la denegación y el acceso, ambas
  correlacionables por el mismo id. El barrido de 429 con 12 peticiones dio 3
  x 400 y 9 x 429, y para ese único id: 3 líneas `info` y 18 `warn`, contando los
  eventos de `rate_limit.exceeded` de las peticiones anteriores del mismo id.

  Un detalle que distingue los dos 401: **sin cabecera `Authorization`** no hay
  evento de seguridad, solo el `access` 401; **con un token inválido** sí, y es
  `auth.token.invalid` `warn`/`security` más el `access` 401. Es la distinción
  correcta: no se auditó el intento de adivinar un token que nunca se envió.

  ##### T12.4b. Un 500 real

  Recrear `api` con un `DATABASE_URL` a una base inexistente, mediante un
  override temporal fuera del repo. La ruta `GET /api/v1/careers` responde:

  ```text
  HTTP/1.1 500 Internal Server Error
  {"success":false,"message":"Internal server error.","errors":[]}
  ```

  en 16 ms, y Loki registra `http.error.unexpected` `error`/`application` más el
  `access` 500, correlacionados por el `requestId`.

  Sobre el filtrado: el cuerpo no lleva ni el mensaje de Prisma ni la ruta
  interna. En el log del contenedor el nombre de la base sí aparece
  (`Database sipeg_utp_inexistente does not exist...`), pero **como salida
  directa de Prisma, no por nuestro logger**, y **la contraseña nunca aparece**
  en ninguna línea. Nombre de base es configuración; la credencial es lo que no
  debe filtrar, y no lo hace.

  Nota sobre el método: la primera propuesta era `REVOKE SELECT ON careers FROM
sipeg`, y **no habría funcionado**: `sipeg` es superusuario y en PostgreSQL un
  superusuario omite toda verificación de permisos, así que el `REVOKE` era un
  no-op silencioso. Se detectó antes de ejecutar y se cambió por el
  `DATABASE_URL`, que no toca la base ni ningún otro contenedor.

  ##### T12.4c. Loki caído y recuperación

  Con `loki` detenido: `careers` 200, `health` 200 y `login` 200, con 20 ms de
  latencia, y el log sigue saliendo por stdout del contenedor. Alloy acumuló 110
  líneas de reintento, que es lo que fija `max_backoff_retries = 0`.

  Tras `start loki`, la petición emitida **con Loki caído** apareció en Loki con
  su línea `http.request.completed` intacta: el spool del driver de logs la
  retuvo y la entregó al recuperar. Se cierra el criterio de que la API no
  depende de Loki.

  ##### T12.4d. Reinicio y una alerta que se disparó sola

  `sipeg-fatal` pasó a `firing` por el `app.jwks.failed` del arranque contra la
  base inexistente, y volvió a `inactive` por sí sola ~2 min después de
  restaurar la base, con `health: ok` en todo el recorrido. Es la primera vez que
  una alerta de este plan se dispara por una causa real y no por una prueba
  dirigida, y confirma que el ciclo `inactive → firing → inactive` funciona sin
  intervención.

  ##### T12.4e. Secretos sintéticos

  Cuatro marcadores reconocibles enviados por el cuerpo, `Authorization` y
  `Cookie` en login fallido, petición autenticada falsa y registro: **0
  ocurrencias** de los cuatro en `docker logs api` y **0** en Loki. El correo
  tampoco aparece en claro: en su lugar está `actorPseudonym`, un HMAC de 64
  caracteres. Y los eventos **sí** se emitieron para ese id (cuatro líneas:
  `auth.login`-access 401, `auth.token.invalid`, `/users/me`-access 401 y
  `/auth/register`-access 400), así que el cero es una redacción y no una ausencia
  de registro.

  ##### T12.4f. `requestId` no se cruza

  48 peticiones simultáneas (`xargs -P 24`), 24 a `/api/v1/careers` y 24 a
  `/api/v1/classrooms`, cada una con su UUID: 48/48 en 200 y 48 UUID distintos.
  Contrastados en Loki uno a uno: los 48 ids presentes, **0 con ruta o estado
  distinto del suyo** y **0 ids con más de una combinación ruta/estado**. El
  `AsyncLocalStorage` aísla el contexto incluso con 24 en vuelo simultáneo.

  ##### T12.4g. Rollback, revocación y smoke

  La base aislada `sipeg_utp_audit_test` ya no existía, así que las 7 pruebas de
  integración llevaban tiempo omitidas. Recreada, migrada con
  `prisma migrate deploy` y ejecutadas con `AUDIT_TEST_DATABASE_URL`: **7/7**.
  Cubren los dos casos que pedía T12.4: el rollback de la mutación cuando el
  insert de auditoría falla en la base (y cuando el writer rechaza el payload), y
  la durabilidad del historial, que concede un permiso, lo audita, **borra la
  fila del permiso** y comprueba que el evento sobrevive. `UPDATE`, `DELETE` y
  `TRUNCATE` sobre `audit_events` siguen rechazados por trigger.

  `pnpm run api:run:smoke` en PASS.

  ##### Desviaciones respecto de lo planificado
  - **La retención no se puede verificar de punta a punta en desarrollo**, y se
    verificó solo por configuración, como se decidió. La ventana de desarrollo es
    de 168 h y `reject_old_samples_max_age` está en su default de 1 semana, así
    que **ningún dato alcanza la edad necesaria para expirar**: el rechazo ocurre
    antes que la retención. Probarlo exigiría un config de Loki de prueba con
    retención y ventana de rechazo cortos. Lo que sí está verificado en vivo
    (T9.1) es que el arranque elige compactor, que existe almacenamiento
    persistente en el volumen `loki_data` y que `/config` reporta
    `retention_period: 30d` con el `retention_stream` de 90 días para
    `log_type="security"`.
  - **`observability:check` con la ventana por defecto da rojo en desarrollo
    tras cualquier recreación de `api`.** Confirmado de nuevo aquí, y en las dos
    direcciones: largo da `11 pass, 1 fail` en `ingest.json-labels` porque la
    ventana todavía abarca líneas de la era anterior, y `--window 3` da
    `12 pass, 0 fail`. Es el desfase ya documentado en T10.5e.
  - **La suite completa necesita `--testTimeout=30000` en este entorno.** Con el
    default de 5000 ms y el `load average` entre 13 y 22 (varios `opencode` al
    58-92 % de CPU sobre 8 núcleos), fallan por timeout entre 2 y 9 tests de
    rutas que levantan la app entera, de forma intermitente y sin relación con el
    código. Con margen de tiempo, 1413/1413. No se modificó la configuración de
    Vitest porque el problema es del entorno, no del repositorio: es la quinta
    vez que se documenta (T7.8, T8.6, T10.4e, T10.5e).
  - **`AUDIT_TEST_DATABASE_URL` es manual.** Las 7 pruebas de integración siguen
    siendo opt-in porque la suite del proyecto no usa base de datos real. Queda
    como deuda: en CI, la base efímera de PostgreSQL es gratuita y permitiría no
    perder esa cobertura.

---

## Duración Y Retención Propuesta

| Datos                                 | Retención | Configuración                                                |
| ------------------------------------- | --------: | ------------------------------------------------------------ |
| Logs de desarrollo                    |    7 días | `observability/loki/config.dev.yaml` (168 h)                 |
| Access/aplicación/infra de producción |   30 días | `loki/config.yaml` (`retention_period: 720h`)                |
| Eventos de seguridad                  |   90 días | `retention_stream` `log_type=security`                       |
| Auditoría PostgreSQL                  |  365 días | Ratificado en T13.1; purga con `pnpm run prisma:purge:audit` |

- [x] **T13.1. Ratificar los 365 días de auditoría.**
      No se encontró política de retención en el repositorio. Confirmar con política
      institucional/asesoría legal antes de automatizar la eliminación. Hasta
      entonces, no purgar automáticamente.

  **Ratificado 2026-09-30: 365 días.** Decisión institucional, documentada en
  ADR-0008 bajo _Retención Y Purga_, no como constante repartida por el código.
  Aplica solo a `audit_events`: los logs de Loki siguen su propia ventana (30
  días global, 90 para seguridad). Mientras no exista normativa que la sustituya,
  365 días es la política vigente.

  Se descartó la migración: el corte se calcula sobre `occurred_at`, que ya está
  indexado, así que cambiar la política es cambiar un número. Añadir
  `retention_expires_at` costaría una migración y una columna en cada escritura
  para comprar una flexibilidad que hoy no se usa.

- [x] **T13.2. Definir el procedimiento de purga.**
      La aplicación no debe poder borrar auditoría (trigger append-only). La purga
      por retención será un procedimiento administrativo privilegiado y auditado.
      Restricción de diseño a resolver aquí: la migración
      `20260927171818_add_durable_audit_events` crea
      `audit_events_prevent_mutation` (BEFORE UPDATE OR DELETE) y
      `audit_events_prevent_truncate` (BEFORE TRUNCATE), así que un `DELETE` de
      retención por `occurred_at` rebota con `audit events are append-only`. El
      procedimiento necesita deshabilitar ambos triggers dentro de una transacción
      y rehabilitarlos al final, exactamente igual que `activities_prevent_delete` y
      `event_programs_prevent_delete` ya exigen en los scripts de limpieza de
      desarrollo de la Fase 5 (pendiente `P1` del plan maestro). Además el esquema
      solo indexa `occurred_at` y no tiene columna de retención, así que la decisión
      de T13.1 puede requerir una migración. No existe hoy ninguna función ni script
      de purga en `src/modules/audit/`.

  Verificado 2026-09-30. `prisma/scripts/purge-audit-events.ts`, registrado como
  `pnpm run prisma:purge:audit`, con 22 tests unitarios.

  Decisiones tomadas antes de implementar:

  | Decisión     | Valor                                               | Por qué                                                                                                                                                                                                                 |
  | ------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Dónde vive   | Script CLI manual                                   | La bitácora sigue siendo de solo lectura; un endpoint HTTP que destruye evidencia contradiría eso, y `pg_cron` automatizaría el borrado con el rol de la aplicación                                                     |
  | Estrategia   | Por lotes transaccionales                           | Cada lote abre transacción, deshabilita triggers, borra y rehabilita en `finally`. Los triggers nunca quedan abiertos entre transacciones, así que un proceso que muera a la mitad deja la tabla igual de inmutable     |
  | Respaldo     | Exportar y luego borrar                             | Un NDJSON comprimido con las filas exactas que se eliminan. `--archive` obligatorio y **rechazado dentro del proyecto**: un respaldo de auditoría en el repo acabaría en un commit                                      |
  | Constancia   | Evento `audit.purged`                               | La única forma de que una intervención sobre el histórico sea detectable desde el propio histórico. Se escribe **después** de rehabilitar los triggers para que la fila sea legítima                                    |
  | Esquema      | Sin migración                                       | El índice de `occurred_at` ya cubre el corte                                                                                                                                                                            |
  | Habilitación | Simulación + `--apply` + `--operator` + `--archive` | Reutilizar el guard de `SEED_ALLOW_PRODUCTION` habría sido semánticamente incorrecto: el destino natural de esta operación es producción, y mezclar el flag de seeds con una operación legítima lo habría hecho confuso |

  Verificación contra la base aislada `sipeg_utp_audit_test` con 435 filas sembradas
  (400 antiguas de 1 a 400 días, 35 recientes):

  - **Simulación**: 36 a purgar (366-400 días), 399 a conservar, rango exacto, y la
    tabla quedó en 435 filas: no escribe nada.
  - **Siete guards rechazan** con el motivo exacto: `--apply` sin `--operator`, sin
    `--archive`, `--operator` con correo, `--operator` que parece secreto,
    `--batch-size=0`, `--retention-days=-5` y `--archive` dentro del proyecto.
  - **Purga real con `--batch-size=10`**: 36 purgados en 4 lotes
    (10 + 10 + 10 + 6) y el `audit.purged` registrado.
  - **Resultado**: la tabla quedó en 400 filas (399 + el evento), con 0 de las 36
    antiguas. `DELETE` y `TRUNCATE` sobre `audit_events` volvieron a fallar con
    `audit events are append-only`: los triggers quedaron **rehabilitados**.
  - **Respaldo**: 36 líneas exactas, la primera `old-400`, y el rango coincide con
    el que anuncia la simulación.
  - **Evento**: `action=audit.purged`, `actor_type=SYSTEM`,
    `resource_type=audit_log`, y `metadata` con `purgedRowCount: 36`,
    `retentionDays: 365`, `cutoff: 2025-09-30T07:55:13.105Z` y
    `operator: sistemas`.

  Desviaciones respecto de lo planificado:

  - **`--operator` no puede ser un correo**, lo que no estaba previsto al
    redactar el plan. El valor pasa por `looksLikeSecret`, que rechaza la arroba:
    escribir un email en la bitácora durable está prohibido por ADR-0008. Se
    documenta como característica, con el identificador institucional como
    alternativa, y hay dos tests que lo fijan.
  - **El respaldo se serializa en memoria y se comprime con `gzipSync`, en vez de
    un `pipeline` de streams.** La primera versión usó un generador asíncrono
    como etapa de `pipeline`, que no es una etapa transform y falló con
    `source is not iterable`. Como el script ya tiene todas las filas en memoria
    para planificar, serializar es más simple y no introduce una diferencia de
    escalado respecto de lo que ya existía.
  - **El script no necesita exclusión de `tsconfig.build.json`.** A diferencia de
    `src/docs/generate.ts` y `src/observability/check.ts`, que viven en `src/` y
    hubo que excluir, este está en `prisma/scripts/`, y `tsconfig.build.json` solo
    incluye `src/**`, así que nunca llega a `dist` ni a la imagen de runtime.
  - **El rango de retención de la tabla es `Timestamptz` y el corte es UTC.** No
    pasa por `src/utils/date.ts`: ADR-0002 aplica a fechas de calendario de
    negocio, y una ventana de retención es un instante.

---

## Criterios De Finalización

Estado 2026-09-30, tras T12.

- [x] Producción no contiene `console.*` en el runtime.
      Los dos únicos `console.*` de `src/` están en `src/docs/generate.ts` y
      `src/observability/check.ts`, que son CLI y además están excluidos de
      `tsconfig.build.json`, así que no viajan en la imagen.
- [x] Todas las respuestas incluyen `X-Request-ID`.
      Corregido en T10.5 (commit `e5ea14e`): antes solo se fijaba cuando el
      servidor generaba el id. Verificado en vivo para 200, 400, 401, 403, 404,
      429 y 500.
- [x] Los 5xx son correlacionables sin filtrar detalles al cliente.
      500 con `{"success":false,"message":"Internal server error.","errors":[]}`,
      `http.error.unexpected` `error`/`application` y el `access` 500 con el
      mismo `requestId`. El mensaje real de Prisma y la ruta interna no salen ni
      en la respuesta ni en el log, y la contraseña de la base tampoco.
- [x] La app funciona con Loki caído (logs a stdout + rotación local).
      Con `loki` detenido, `careers`, `health` y `login` respondieron 200. Al
      restaurarlo, la petición emitida durante la caída llegó a Loki desde el
      spool.
- [x] No se registran cuerpos, credenciales, tokens ni datos personales directos.
      Cuatro marcadores sintéticos por cuerpo, `Authorization` y `Cookie`: 0
      ocurrencias en Docker y en Loki, con los eventos presentes. El correo
      viaja como `actorPseudonym` (HMAC), nunca en claro.
- [x] Los eventos críticos de autorización y administración son atómicamente
      auditables.
      Verificado con la base real: la mutación se revierte cuando el insert de
      auditoría falla en la base o cuando el writer rechaza el payload (T6.6,
      T12.4g). Salvedad declarada en ADR-0008: los tres flujos de Better Auth
      (`user.registered`, `auth.email_verified`, `auth.password_reset`) **no** son
      atómicos con el proveedor y no se promete que lo sean.
- [x] `audit_events` es append-only a nivel de base de datos.
      `UPDATE`, `DELETE` y `TRUNCATE` rechazados por los triggers
      `audit_events_prevent_mutation` y `audit_events_prevent_truncate`, y el
      evento sobrevive al borrado de la fila que referencia.
- [~] Loki tiene retención activa, almacenamiento persistente y acceso no público.
  Almacenamiento persistente y acceso no público, verificados: volumen
  `loki_data` y `expose` en vez de `ports` (solo Grafana publica, atado a
  `127.0.0.1`). Retención activa verificada **solo por configuración y smoke
  de arranque** (T9.1: eligen compactor, `retention_period: 30d`,
  `retention_stream` de 90 días para seguridad). El **borrado por antigüedad
  no es verificable en desarrollo** porque `reject_old_samples_max_age` (1
  semana) rechaza antes que la ventana de 168 h pueda expirar nada.
- [x] Grafana tiene paneles provisionados y alertas básicas.
      Tres paneles y cinco reglas. `observability:check` da `12 pass, 0 fail` con
      `--window 3`, y el disparo real se verificó dos veces: `sipeg-rate-limits`
      en T10.5 y `sipeg-fatal` en T12.4d.
- [x] La política de retención y acceso está documentada en ADR.
      ADR-0007, secciones _Retención Consultable_ y _Puertos Publicados_.

### Pendiente De Decisión Humana

**Nada.** La fase 13 quedó resuelta el 2026-09-30: T13.1 ratificada en 365 días y
T13.2 implementada como script CLI. Ambas decisiones y sus siete puntos de diseño
están documentados en ADR-0008, sección _Retención Y Purga_.

Lo único que sigue abierto es una **revisión periódica de la política** por si una
normativa institucional o de asesoría legal la sustituye. No bloquea nada: hasta
entonces rige 365 días.

Sobre la automatización: la purga **no** es automática y no debe serlo sin revisar
el ADR. Automatizarla con el rol de la aplicación haría que un error de
configuración eliminara evidencia sin que nadie lo revisara.

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
- **Deuda de las fases 1 y 4 (hallazgo de T9.1):** ADR-0007 afirma que los eventos
  `security` no se apagan con `LOG_LEVEL`, pero el logger no lo implementa: hoy un
  `LOG_LEVEL=error` silencia también esos eventos. No se tocó en T9.1 porque exige
  una decisión de diseño del logger (nivel efectivo por tipo de log) y tests propios.
