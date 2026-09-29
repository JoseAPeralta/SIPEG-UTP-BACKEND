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

- [ ] **T9.4. Configurar Grafana.**
  - `GF_AUTH_ANONYMOUS_ENABLED=false`.
  - Data source Loki provisionada por archivo.
  - Binding inicial a `127.0.0.1` (detrás de proxy TLS en producción).
  - Volumen propio para Grafana.
- [ ] **T9.5. Fijar imágenes por versión o digest.**
      Nada de `latest`. Documentar las versiones elegidas en el ADR-0007.
      Loki ya quedó en `grafana/loki:3.7.8` (T9.1); faltan Alloy, Grafana y
      `docker-socket-proxy`.
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

| Datos                                 | Retención | Configuración                                 |
| ------------------------------------- | --------: | --------------------------------------------- |
| Logs de desarrollo                    |    7 días | `observability/loki/config.dev.yaml` (168 h)  |
| Access/aplicación/infra de producción |   30 días | `loki/config.yaml` (`retention_period: 720h`) |
| Eventos de seguridad                  |   90 días | `retention_stream` `log_type=security`        |
| Auditoría PostgreSQL                  |  365 días | Política + procedimiento de purga controlada  |

- [ ] **T13.1. Ratificar los 365 días de auditoría.**
      No se encontró política de retención en el repositorio. Confirmar con política
      institucional/asesoría legal antes de automatizar la eliminación. Hasta
      entonces, no purgar automáticamente.
- [ ] **T13.2. Definir el procedimiento de purga.**
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
- **Deuda de las fases 1 y 4 (hallazgo de T9.1):** ADR-0007 afirma que los eventos
  `security` no se apagan con `LOG_LEVEL`, pero el logger no lo implementa: hoy un
  `LOG_LEVEL=error` silencia también esos eventos. No se tocó en T9.1 porque exige
  una decisión de diseño del logger (nivel efectivo por tipo de log) y tests propios.
