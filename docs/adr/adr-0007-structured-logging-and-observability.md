---
title: 'ADR-0007: Logging estructurado y observabilidad con Pino, Loki y Grafana'
status: 'Accepted'
date: '2026-09-26'
authors: 'Equipo backend SIPEG UTP'
tags: ['architecture', 'observability', 'logging', 'security']
supersedes: ''
superseded_by: ''
---

# ADR-0007: Logging estructurado y observabilidad con Pino, Loki y Grafana

## Status

**Accepted**

## Context

SIPEG UTP emite actualmente solo mensajes `console.log`/`console.error`
(arranque y apagado en `src/server.ts`, fallo de entrega de correo en
`src/lib/auth.ts` y `src/modules/users/users.service.ts`) y Prisma escribe sus
propios `warn`/`error` fuera de cualquier formato comun. Consecuencias actuales:

- `LOG_LEVEL` esta validado en `src/config/env.ts` pero no se consume.
- No hay identificador de peticion, medicion de latencia ni correlacion entre
  un acceso HTTP y el error que lo causo.
- Los errores inesperados se ocultan al cliente (`src/middlewares/error.middleware.ts`)
  pero no se registran para operadores, por lo que un 5xx es invisible.
- No se registran fallos de autenticacion, denegaciones de autorizacion,
  activaciones de rate limit ni denegaciones CORS.
- Docker no define rotacion de logs y no existe colector, almacenamiento central
  ni tablero de consulta.
- La politica de trabajo prohibe registrar contrasenas, tokens, headers
  `Authorization`, URLs de base de datos, contenido de CV y variables privadas.

El despliegue objetivo es Docker Compose en un solo host, con PostgreSQL 18 como
unica persistencia. Se necesita diagnostico operativo correlacionable sin
introducir un servicio gestionado externo en esta etapa.

## Decision

Adoptar un canal de logs operativos estructurados y una topologia de observabilidad
autogestionada:

- **Logger:** `pino` + `pino-http`. Una linea JSON por evento a `stdout`/`stderr`.
  `LOG_LEVEL` controla el nivel; timestamp UTC ISO; campos base `service`,
  `version` y `environment`; serializador de errores que no expone `message` ni
  `stack` en produccion; redaccion de `authorization`, `cookie`, `password`,
  `token`, `refreshToken` y `accessToken`.
- **Correlacion:** middleware propio `requestLogger` instalado antes de Helmet,
  CORS y `/api/auth/*`. Acepta `X-Request-ID` solo si es un UUID valido, o genera
  `crypto.randomUUID()`, y lo devuelve siempre en la respuesta. El request corre
  dentro de un `AsyncLocalStorage` (`src/lib/log-context.ts`) para que los
  servicios emitan con el mismo `requestId`.
- **Tipos de log:** `access`, `application`, `security`, `infrastructure`. Los
  eventos de negocio no se infieren de logs.
- **Niveles y HTTP:** 2xx/3xx/4xx esperado = `info`; 429 = `warn`; 5xx = `error`;
  health checks exitosos excluidos; los eventos `security` no se apagan con
  `LOG_LEVEL`.
- **Recoleccion:** `Grafana Alloy` descubre contenedores por Docker y envia a
  `Loki`. No se usa Promtail.
- **Visualizacion:** `Grafana` con data source Loki provisionada por archivo,
  paneles `API Overview`, `Errors` y `Security`, y alertas basicas.
- **Cardinalidad:** etiquetas Loki permitidas solo `service`, `environment`,
  `log_type`, `level` y `container`. `requestId`, `actorId`, IDs de recurso, IPs
  y trace IDs viven en el JSON, nunca como labels.
- **Acceso al Docker socket:** Alloy se conecta a un `docker-socket-proxy` de
  solo lectura; no se monta `/var/run/docker.sock` directamente.
- **Retencion:** 30 dias para access/aplicacion/infraestructura y 90 dias para
  `log_type="security"` en produccion; 7 dias en desarrollo. Loki no borra por
  defecto, por lo que el Compactor con `retention_enabled: true` es obligatorio.
- **Spool:** cada servicio Docker usa el driver `local` con `max-size`/`max-file`
  para no agotar disco si Loki esta caido. La API siempre escribe a stdout.
- **Pseudonimizacion:** para correlacionar intentos anonimos se usa HMAC-SHA256
  con `LOG_PSEUDONYMIZATION_KEY`; nunca se registra email ni IP en claro en
  eventos de seguridad.
- **Separacion:** la bitacora durable de cambios sensibles vive en PostgreSQL y
  se define en `docs/adr/adr-0008-durable-audit-events.md`; Loki es diagnostico,
  no fuente de verdad.

## Consequences

### Positive

- **POS-001**: Un 5xx deja de ser invisible: queda un evento `error` con
  `requestId` correlacionable con el access log, sin filtrar detalles al cliente.
- **POS-002**: Los eventos de seguridad (login fallido, JWT invalido, 403, 429,
  CORS) quedan observables para deteccion e investigacion.
- **POS-003**: La API no depende de Loki para funcionar: escribe a stdout y el
  driver `local` actua como buffer; una caida del colector no derriba el servicio.
- **POS-004**: Costo nulo de servicio externo y buen ajuste al Docker Compose de
  un solo host.
- **POS-005**: La redaccion y la ausencia de cuerpos/cabeceras reducen el riesgo
  de filtracion de credenciales y datos personales en logs.
- **POS-006**: `LOG_LEVEL`, hoy inerte, pasa a tener efecto operativo real.

### Negative

- **NEG-001**: Se agregan dependencias (`pino`, `pino-http`) y servicios de
  infraestructura (Alloy, Loki, Grafana) con sus propios volumenes, variables y
  mantenimiento.
- **NEG-002**: El `docker-socket-proxy` es un componente adicional que debe
  configurarse solo con permisos de lectura; un error de configuracion puede
  exponer el socket.
- **NEG-003**: Loki indexa labels, no texto completo; las busquedas full-text
  amplias son menos eficientes que en Elastic/OpenSearch.
- **NEG-004**: La retencion no es retroactiva: cambiar un periodo solo aplica a
  datos nuevos.
- **NEG-005**: Instrumentar `/api/auth/*` cubre la solicitud HTTP, pero no
  garantiza semantica de negocio del proveedor; esa frontera se documenta aparte.

## Alternatives Considered

### Winston

- **ALT-001**: **Description**: Logger clasico con transports, formatos y niveles.
- **ALT-002**: **Rejection Reason**: Mas pesado y sin ventaja concreta sobre Pino
  para JSON en stdout; Pino ya ofrece redaccion, child loggers y serializadores.

### Morgan

- **ALT-003**: **Description**: Middleware de access logs en formato texto.
- **ALT-004**: **Rejection Reason**: Solo cubre access logs, no correlacion,
  eventos de seguridad ni logs de aplicacion; obliga a agregar otro logger.

### Elastic/OpenSearch + Kibana

- **ALT-005**: **Description**: Indexacion full-text con busqueda potente.
- **ALT-006**: **Rejection Reason**: Mayor consumo de memoria, almacenamiento y
  operacion para el volumen actual; se puede migrar despues si la necesidad de
  busqueda lo justifica.

### Grafana Cloud / Datadog

- **ALT-007**: **Description**: Observabilidad gestionada sin operar el stack.
- **ALT-008**: **Rejection Reason**: Costo, dependencia de un tercero y salida de
  datos institucionales; no es necesario en esta etapa.

### Promtail

- **ALT-009**: **Description**: Colector tradicional de Grafana para Loki.
- **ALT-010**: **Rejection Reason**: Grafana recomienda Alloy como colector
  principal; no iniciar integraciones nuevas con Promtail.

### Solo stdout sin centralizar

- **ALT-011**: **Description**: Mantener JSON en stdout y consultar con
  `docker logs`.
- **ALT-012**: **Rejection Reason**: No permite correlacionar entre servicios,
  conservar seguridad 90 dias ni alertar; no cumple el objetivo de observabilidad.

## Implementation Notes

- **IMP-001**: Archivos clave a crear: `src/config/logger.ts`,
  `src/lib/log-context.ts`, `src/middlewares/requestLogger.middleware.ts`.
- **IMP-002**: Variables nuevas: `LOG_PRETTY`, `LOG_PSEUDONYMIZATION_KEY`
  (requerida en produccion, minimo 32 caracteres), `LOG_SERVICE_NAME` y
  `APP_VERSION`. Deben propagarse explicitamente en los bloques `environment:`
  de `compose.dev.yaml` y `compose.prod.yaml`.
- **IMP-003**: Infraestructura en `compose.observability.yaml` y
  `observability/` (Loki, Alloy, Grafana, paneles y reglas). Imagenes fijadas por
  version o digest, nunca `latest`.
- **IMP-004**: No registrar cuerpos, cabeceras de autenticacion, cookies, tokens,
  contrasenas, hashes, queries Prisma ni parametros de queries.
- **IMP-005**: Criterio de exito: tests de logger, contexto y redaccion en verde;
  `X-Request-ID` en todas las respuestas; app operativa con Loki detenido;
  `pnpm run typecheck`, `pnpm run lint` y `pnpm run build` limpios.

## References

- **REF-001**: `docs/superpowers/plans/logging-y-auditoria.md` (plan de ejecucion).
- **REF-002**: `docs/adr/adr-0008-durable-audit-events.md` (bitacora durable).
- **REF-003**: OWASP Logging Cheat Sheet.
- **REF-004**: Pino v10, pino-http, Grafana Alloy, Loki (retencion, cardinalidad,
  autenticacion) y Grafana Alerting.
- **REF-005**: Docker `local` logging driver.
