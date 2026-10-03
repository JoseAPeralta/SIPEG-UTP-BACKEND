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

- **Logger:** `pino` + middleware HTTP propio. Una linea JSON por evento a
  `stdout`/`stderr`. `LOG_LEVEL` controla aplicacion e infraestructura; `access`
  y `security` conservan nivel minimo `info` para no perder metricas ni evidencia;
  timestamp UTC ISO; campos base `service`,
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
  solo `GET /api/v1/health` exitoso se excluye; los eventos `access` y `security`
  no se apagan con `LOG_LEVEL`. Abortos sin cabeceras no inventan un status 200.
- **Recoleccion:** `Grafana Alloy` descubre contenedores por Docker y envia a
  `Loki`. No se usa Promtail.
- **Visualizacion:** `Grafana` con data source Loki provisionada por archivo,
  paneles `API Overview`, `Errors` y `Security` provisionados por archivo en la
  carpeta fija `SIPEG UTP` identificada por titulo, y alertas basicas. El
  datasource y los paneles son declarativos y no editables desde la UI: la
  version que corre es la del repositorio.
- **Cardinalidad:** etiquetas Loki permitidas solo `service`, `environment`,
  `log_type`, `level` y `container`. `requestId`, `actorId`, IDs de recurso, IPs
  y trace IDs viven en el JSON, nunca como labels.
- **Acceso al Docker socket:** Alloy se conecta a un `docker-socket-proxy` de
  solo lectura; no se monta `/var/run/docker.sock` directamente.
- **Retencion:** 30 dias para access/aplicacion/infraestructura y 90 dias para
  `log_type="security"` en produccion; 7 dias en desarrollo. Loki no borra por
  defecto, por lo que el Compactor con `retention_enabled: true` es obligatorio.
  `max_query_length` se alinea con la ventana mayor de retencion para que lo
  retenido sea consultable; ver la seccion "Retencion Consultable".
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
- **POS-006**: `LOG_LEVEL`, hoy inerte, pasa a tener efecto operativo real sin
  degradar conteos de trafico ni eventos de seguridad.

### Negative

- **NEG-001**: Se agrega `pino` y servicios de
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
- **NEG-006**: El canal de observabilidad depende de que Docker entregue los
  bind mounts del repositorio a los contenedores. En Docker Desktop sobre WSL2 ese
  reparto puede romperse en silencio (ver "Brecha: Bind Mounts De Grafana En
  WSL2"), y solo se recupera recreando el contenedor.

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
  `observability/` (Loki, Alloy, Grafana, paneles y reglas). Imagenes de terceros
  fijadas por `tag@sha256:digest` en el compose, nunca `latest`. Ver la tabla de
  imagenes abajo.
- **IMP-004**: No registrar cuerpos, cabeceras de autenticacion, cookies, tokens,
  contrasenas, hashes, queries Prisma ni parametros de queries.
- **IMP-005**: Criterio de exito: tests de logger, contexto y redaccion en verde;
  `X-Request-ID` en todas las respuestas; app operativa con Loki detenido;
  `pnpm run typecheck`, `pnpm run lint` y `pnpm run build` limpios.
- **IMP-006**: La plantilla de ruta del access log se captura al asignarse
  `req.route`, no al terminar la respuesta. Express asigna `req.route` cuando la
  ruta hace match, con `req.baseUrl` todavia apuntando al montaje; para toda
  respuesta que nace dentro de la cadena (401, 403, 429, error de validacion) el
  router se desenrolla de forma sincrona y restaura `req.baseUrl` a `''` antes
  de que `res` emita `finish`. Leerlo ahi producia `/careers` donde correspondia
  `/api/v1/careers`, partiendo el trafico de un mismo endpoint en dos series al
  agregar por ruta en Grafana. `captureRouteTemplate()` intercepta la asignacion
  (`req.route` es una propiedad propia y `configurable` en Express 5) y guarda la
  plantilla completa; el getter se conserva para el resto de la cadena. Es el
  unico momento en que el valor es correcto, y afecta por igual a los 5xx que
  emite `errorHandler`, que es el caso que mas importa medir.
- **IMP-007**: Los paneles se montan en `/etc/grafana/dashboards`, fuera de
  `/var/lib/grafana`, que es el home del volumen `grafana_data` y por tanto el
  estado de Grafana. `updateIntervalSeconds: 30` en vez de <=10: por debajo de
  ese valor Grafana se apoya en eventos del sistema de archivos y su
  documentacion advierte que un bind mount de Docker puede no propagarlos, lo
  que haria que un panel guardado en el repositorio no llegara a la UI.
- **IMP-008**: Las reglas de alerta se montan en
  `/etc/grafana/provisioning/alerting`. A diferencia de los paneles, **no** se
  releen por sondeo: Grafana las provisiona una vez al arrancar, asi que editar
  el archivo exige recrear el contenedor. Un archivo invalido hace fallar el
  servicio de provisioning completo, no solo las alertas.
- **IMP-009**: Un error con `status` 4xx entero se responde con ese status y un
  mensaje de tabla cerrada, sin log `error`. Es el contrato de `http-errors` que
  usa `body-parser`: un cuerpo JSON malformado o demasiado grande es entrada
  invalida del cliente, no un fallo de la aplicacion, y tratarlo como 500
  contaminaba el panel de errores, la alerta de errores inesperados y el conteo de
  5xx. El mensaje nunca se copia del error, para no filtrar el cuerpo recibido.
- **IMP-010**: Fuera de produccion el serializador de errores conserva `message`
  y `stack`, pero descarta `err.body` y `err.headers`. `redact` no los cubre
  porque sus rutas asumen `req.headers.*`, y el pipeline de desarrollo tambien
  ingiere esos logs en Loki, asi que la exclusion no es solo local.
- **IMP-011**: `pnpm run observability:check` verifica el estado **aplicado** del
  stack contra la UI de Grafana, sin dependencias nuevas y sin modificar nada.
  Tres decisiones que lo hacen posible:
  - Habla con Grafana y no con Loki: Loki no publica puerto y el proxy del
    datasource (`/api/datasources/proxy/uid/loki/...`) da el mismo resultado.
  - Lee `alert-rules/export?format=json` y **no** el listado de reglas, porque el
    listado no devuelve `dashboardUid` ni `panelId` aunque esten aplicados.
  - La ingesta se comprueba con `/loki/api/v1/series`, que devuelve streams
    reales, y no con una agregacion `count by (...)`: `requestId` es structured
    metadata y el motor la devuelve como etiqueta, asi que una agregacion sobre
    24 h produce una serie por request y Loki rechaza la consulta con
    `maximum number of series (500) reached`. Por eso la comprobacion mira una
    **ventana** y distingue "sin trafico" (informativo) de "trafico que llega sin
    etiquetar" (fallo).
- **IMP-012**: El logger interno del proveedor de autenticacion esta
  **silenciado** (`logger: { disabled: true }` en `src/lib/auth.ts`). Escribe
  texto plano por stdout, fuera de pino, asi que sus lineas no son JSON y Alloy
  no les asigna `service` ni `log_type`: caen en un stream aparte del contenedor
  `api` que no se puede filtrar en Grafana y hace fallar `ingest.json-labels`. Se
  acepta la perdida de detalle porque la aplicacion ya emite el evento con mas
  contexto y con el sujeto pseudonimo (`auth.login.failed`, `logType` `security`),
  mientras que el "User not found" del proveedor repetia en claro un dato que el
  modelo de seguridad evita exponer. El error real de autenticacion lo sigue
  registrando `errorHandler` como `http.error.unexpected`. El unico texto plano
  que queda es el banner de `tsx watch` en desarrollo, que no es de la aplicacion.
- **IMP-013**: Cada access log declara `requestKind`
  (`matched`/`preflight`/`unmatched`) y `outcome` (`completed`/`aborted`). Alloy
  los promueve, junto a metodo, ruta, status y duracion, a structured metadata.
  Grafana excluye abortos de status y percentiles, separa preflight/no enrutadas,
  agrega frecuencia por `(method, route)` y muestra una cola descendente de
  solicitudes. El verificador consulta las lineas del stream sin `service` para
  tolerar unicamente el banner exacto de `tsx watch`, y valida el dashboard
  aplicado via `/api/dashboards/uid/sipeg-api-overview`.

## Brecha: Bind Mounts De Grafana En WSL2

Docker Desktop expone los bind mounts que viven en una distro de WSL2 a la VM
mediante un shim en
`/run/desktop/mnt/host/wsl/docker-desktop-bind-mounts/<distro>/<hash>`. Ese shim
puede dejar de resolver contra la distro despues de un reinicio de WSL o del
propio Docker Desktop, y el contenedor ve un **directorio vacio** en lugar de los
archivos: no hay error de arranque, no hay entrada de log y el healthcheck pasa.

El fallo es silencioso por construccion del pipeline: Grafana provisiona
datasources, paneles y alertas leyendo directorios, asi que un directorio vacio se
confunde con "nada que provisionar". El resultado es que Loki y Alloy funcionan
mientras Grafana queda sin datasource (las 5 alertas fallan con
`failed to build query 'A': data source not found`) y sin paneles. Los montajes de
`loki`, `alloy` y `api` pueden no estar afectados, de modo que el stack se ve sano
a medias y el fallo se diagnostica tarde.

Se documenta como brecha y no como decision porque el remedio no es del
repositorio: recrear el contenedor de Grafana con
`up -d --force-recreate grafana`. Un `restart` **no** sirve, porque reestablece el
mismo shim roto. El sintoma, el diagnostico (`docker inspect` buscando un
`Source` bajo `/run/desktop/mnt/host/`) y el remedio estan en el README, junto a
`pnpm run observability:check`, que es quien detecta el efecto final.

## Imagenes Fijadas

Politica del **stack completo**, no solo del canal de observabilidad: ninguna
imagen de terceros usa `latest`, y todas llevan **tag y digest** en el compose
(`repo:tag@sha256:...`). El tag se lee y el digest fija, de modo que mover un tag
en el registro no cambia lo que corre. El costo es que actualizar una imagen
exige editar las dos partes a la vez, lo cual es intencional. Sin bots de
actualizacion (no hay Renovate ni Dependabot), no hay riesgo de desincronizacion
automatica.

| Componente           | Tag           | Archivo                                 | Digest                                                                    |
| -------------------- | ------------- | --------------------------------------- | ------------------------------------------------------------------------- |
| Loki                 | `3.7.8`       | `compose.observability.yaml`            | `sha256:1107dd5274e0ada47e42472b7a7e71f3b2a2fe878878108f3e2f9e51528f0193` |
| Grafana Alloy        | `v1.20.0`     | `compose.observability.yaml`            | `sha256:f111cce835516c5f99166342be7038496b52ced16667be5a11e19258a3e4cd30` |
| Grafana              | `13.2.2`      | `compose.observability.yaml`            | `sha256:ac461fb352abc50da10a51c7d02462e9c05488f11f53f14b3ad79a8145f638a0` |
| docker-socket-proxy  | `v0.5.0`      | `compose.observability.yaml`            | `sha256:1f5038b54f06c3e18422902cf00ba21803d1c97805aae032e5e6673d532d3459` |
| PostgreSQL           | `18.6-alpine` | `compose.dev.yaml`, `compose.prod.yaml` | `sha256:6c538e7206ea40ff740ef27883529390a690b6ead6ba96b44c67a9f7c638e8fd` |
| Mailpit (desarrollo) | `v1.27.8`     | `compose.dev.yaml`                      | `sha256:6abc8e633df15eaf785cfcf38bae48e66f64beecdc03121e249d0f9ec15f0707` |

Los digests se tomaron de `docker image inspect --format '{{index .RepoDigests 0}}'`
sobre las imagenes efectivamente usadas por el stack, no de una pagina de
releases, y se comprobaron con `docker compose pull` contra el registro.

**Unica excepcion: la imagen de la API.** `compose.prod.yaml` construye
`sipeg-utp-backend:${IMAGE_TAG:?...}` localmente. Un digest solo existe cuando la
imagen vive en un registro, asi que aqui no hay digest posible y el control de
reproducibilidad es el tag. Por eso `IMAGE_TAG` es **obligatoria y sin default**:
antes caia en `latest`, con lo que un despliegue posterior sobrescribia en
silencio la imagen verificada.

**`migrate` y `seed` quedan deliberadamente sin versionar.** Usan el nombre fijo
`sipeg-utp-backend:migrate` en produccion. Es una decision, no una omision: ambas
imagenes se reconstruyen en cada deploy, no provienen de un registro (asi que no
tendrian digest) y no hay un proceso de releases que referencie la version. Fijar
un tag sobre ellas daria una falsa sensacion de reproducibilidad, porque la
etiqueta la sobreescribiria la siguiente build.

## Retencion Consultable

Retener no es lo mismo que poder consultar. Loki separa los dos conceptos:
`retention_period` y `retention_stream` deciden cuanto se guarda, y
`max_query_length` decide cuanto se puede **preguntar** en una sola consulta.

Con el default de Loki (`30d1h`), la retencion de 90 dias de
`log_type="security"` era dato almacenado pero no consultable: una consulta de
90 dias fallaba con `the query time range exceeds the limit (query length:
2166h1m0s, limit: 30d1h)`. Es decir, la politica de retencion announced en este
ADR no se podia aprovechar, y un panel de seguridad invita precisamente a
seleccionar la ventana completa.

Por eso `observability/loki/config.yaml` fija `max_query_length: 2160h`, el
mismo valor que el `retention_stream` de seguridad. En desarrollo no hace
falta: la retencion es de 7 dias, muy por debajo del default de 30 dias.

El costo es explicito: una consulta de 90 dias escanea 90 dias de logs. Por eso
acotar el rango en el selector de tiempo sigue siendo lo correcto para
investigar, y el limite queda como red de seguridad contra consultas
accidentales y carisimas, no como invitacion a barrer 90 dias.

Un limite secundario que no afecta a este diseno: `max_query_series` (500) se
aplica a consultas de metrica **sin agregar**. Los logs se devuelven como una
linea por stream, no una serie por linea, asi que los paneles de logs no lo
alcanzan.

## Spool Local

Ningun servicio del stack se queda con el driver por defecto. Sin configuracion,
Docker usa `json-file` **sin opciones**, que no rota nunca: cada linea de cada
request queda en disco para siempre. Como Alloy esta configurado con
`max_backoff_retries = 0` (reintenta para siempre en lugar de descartar), una
caida de Loki o del propio Alloy convierte al spool en un growth ilimitado hasta
llenar el disco del host.

Los tres compose declaran un campo de extension `x-logging` con el mismo bloque y
lo referencian con `logging: *logging` en cada servicio:

```yaml
x-logging: &logging
  driver: local
  options:
    max-size: '20m'
    max-file: '5'
```

`local` es preferible a `json-file` con limites por dos motivos: rota **sin
bloquear** el contenedor (la rotacion de `json-file` ocurre en el camino de
escritura y frena al proceso mientras comprime), y es el driver pensado para
contenedores. Tope por servicio: 100 MB. `max-size` y `max-file` son ademas los
defaults de `local`; se declaran como politica explicita.

Compatible con el resto del diseno: `docker compose logs` y `docker logs` siguen
leyendo igual, y la API de Docker que consume Alloy
(`GET /containers/{id}/logs`, servida por `docker-socket-proxy`) tambien, porque
el driver `local` sirve sus archivos por esa misma API. Verificado: la cadena
API -> Alloy -> Loki -> Grafana sigue funcionando con el driver cambiado.

El servicio `api` del overlay **no** redeclara `logging`: los bloques de un
overlay se fusionan con los del compose base, asi que hereda el `x-logging` de
`compose.dev.yaml` o `compose.prod.yaml`.

**Lo que el spool no resuelve:** acota el disco, no garantiza entrega. Si Loki
esta caido mas de lo que cabe en 100 MB por servicio, las lineas mas antiguas se
pierden. Es el comportamiento deseable en un diagnostico operativo; la bitacora
durable de cambios sensibles no depende de esto (ver
`docs/adr/adr-0008-durable-audit-events.md`).

## Alertas

Cinco reglas provisionadas por archivo en
`observability/grafana/provisioning/alerting/rules.yaml`, un grupo `sipeg-api`
evaluado cada minuto contra el datasource `loki`. Cada regla enlaza al panel que
la explica (`dashboardUid` + `panelId`), de modo que desde la alerta se llega al
contexto sin cambiar de dashboard.

| Regla                     | Condicion                           | `for` | Lectura                                       |
| ------------------------- | ----------------------------------- | ----- | --------------------------------------------- |
| `sipeg-fatal`             | `app.fatal` o `app.jwks.failed` > 0 | `0s`  | el proceso muere, o no puede firmar tokens    |
| `sipeg-unexpected-errors` | `http.error.unexpected` > 5         | `0s`  | fallo que la aplicacion no previo             |
| `sipeg-5xx`               | 5xx > 10                            | `0s`  | salud del servicio, contadas en el access log |
| `sipeg-auth-failures`     | `auth.login.failed` > 20            | `0s`  | intentos de login fallidos                    |
| `sipeg-rate-limits`       | `rate_limit.exceeded` > 30          | `2m`  | trafico que agota los limitadores             |

Todas con ventana de 5 minutos, `sum(count_over_time(...))` y
`or vector(0)`.

**Umbrales calibrados, no copiados.** La linea base medida de 24 h en el stack de
desarrollo fue de 1460 accesos, 1 five-5xx y 0 fatales, con el trafico de login
fallido y rate limits mayoritariamente sintetico (lo generaron las fases T10.2 y
T10.3). Los umbrales del plan original se mantienen salvo el de rate limits, que
se sube de 10 a 30 y anade `for: 2m`.

**Por que rate limits sube a 30.** Los limitadores por IP (`login.ip`,
`register.ip`, ambos 30/min) agrupan por `req.ip`, y con `trust proxy: 1` ese
valor viene de `X-Forwarded-For`. En produccion **no existe todavia** el proxy TLS
que debe generar esa cadena (ver "Puertos Publicados"), asi que todos los clientes
compartirian un unico bucket y la alerta de 10 quedaria permanentemente
disparada. El umbral se recalibra en cuanto exista ese proxy y se pueda confirmar
la cadena de reenvio. Es la unica regla con `for`, y precisamente por esa
dependencia pendiente.

**`noDataState: OK` con `execErrState: Alerting`.** El `or vector(0)` convierte
"no hay eventos" en un `0` explicito, que es la lectura correcta; asi que
`NoData` solo puede aparecer por una consulta fallida, y en ese caso la alerta
tiene que verse. Con Loki caido las cinco pasan a `Alerting`, que es el fallo
ruidoso buscado. El silencio por datasource caido seria el peor resultado posible
para un canal de diagnostico.

**Sin filtro de `environment`.** El formato v1 de provisioning de alertas no
admite variables de panel, asi que no hay forma de escribir el `environment=~"$environment"`
que usan los paneles. Se omite el filtro: hay un Loki por despliegue y su
volumen esta separado, de modo que el dato no aporta y su ausencia no mezcla
entornos.

**Carpeta por titulo.** El formato v1 solo admite `folder` por titulo, no
`folderUID`, y el provisioning de alertas corre **antes** que el de paneles
(datasources -> plugins -> alerting -> paneles). En un volumen vacio las reglas
crean la carpeta y el UID lo genera Grafana; un `folderUid` fijo declarado en
`dashboards.yaml` no seria mas estable, solo una ilusion. Por eso se elimino. En
un volumen ya inicializado por los paneles, las reglas reutilizan el UID existente
porque la buscan por titulo.

**Sin contact point.** Las alertas se evalúan y se ven en la UI, pero **no
notifican a nadie**. Es una decision de alcance, no una limitacion recordada: la
entrega exige configurar SMTP en Grafana (`GF_SMTP_*`), que es infraestructura
nueva con su propio manejo de secretos, y ninguna variable de ese tipo existe en
el despliegue. Anadirla es una fase aparte; hasta entonces, la lectura de una
alerta es manual.

**Recarga solo por reinicio.** A diferencia de los paneles, no hay sondeo del
directorio. Editar `rules.yaml` exige recrear el contenedor de Grafana y revisar
`docker compose logs grafana` en busca de `finished to provision alerting`. Con
`provenance: file` las reglas tampoco se editan desde la UI: el repositorio manda.

## Puertos Publicados

Regla: **nada se publica en `0.0.0.0`.** Todo puerto que un servicio necesita
exponer a sus pares usa `expose`, que es solo una declaracion interna de la red de
Compose y no abre nada en el host. Todo lo que de verdad necesita llegar al host
se ata a `127.0.0.1`.

| Servicio              | Puerto | Interfaz     | Modo     | Quien lo consume                            |
| --------------------- | ------ | ------------ | -------- | ------------------------------------------- |
| `api` (dev y prod)    | 3000   | `127.0.0.1`  | `ports`  | proxy TLS del host, o el navegador en dev   |
| `grafana`             | 3001   | `127.0.0.1`  | `ports`  | operador, via proxy TLS en produccion       |
| `mailpit` (dev)       | 8025   | `127.0.0.1`  | `ports`  | operador en desarrollo                      |
| `db` (dev)            | 5432   | `127.0.0.1`  | `ports`  | herramientas locales; en prod no se publica |
| `db` (prod)           | 5432   | sin publicar | —        | solo la red de Compose                      |
| `loki`                | 3100   | sin publicar | `expose` | `grafana`, por la red `observability`       |
| `alloy`               | 12345  | sin publicar | `expose` | su propia UI de diagnostico, por la red     |
| `docker-socket-proxy` | 2375   | sin publicar | `expose` | `alloy`, por la red `observability`         |

`db` en produccion no publica nada: se accede a el por el nombre de servicio
`db` desde la misma red de Compose. Publicarlo en desarrollo responde a que se
conecta desde el host (`psql`, DBeaver, `pnpm prisma` contra el puerto del host)
y por eso tambien va atado a loopback.

### Brecha: no hay terminacion TLS

El despliegue de produccion **sirve hoy la API en HTTP plano**, porque el proxy
que deberia terminar HTTPS no existe en el repositorio. Con `api` atada a
loopback, el unico cliente posible es ese proxy, asi que la brecha no es solo
"falta cifrado": ademas deja la API sin forma de ser alcanzada de forma
segura. Es infraestructura nueva (un servicio con certificados y su propio ADR),
no algo que deba aparecer de salto en este repositorio, asi que queda como tarea
posterior. Lo que este ADR fija son las **condiciones** que ese proxy debera
cumplir, para que no se introduzca en silencio un fallo de seguridad:

- **`app.set('trust proxy', 1)`** ya esta activo (`src/app.ts:28`) y el rate
  limiting construye su llave con `req.ip`. El valor `1` significa
  **exactamente un salto**: el proxy debe ser uno solo, no encadenarse con otro,
  y enviar la cadena `X-Forwarded-For` correctamente. Si se encadena o envia una
  cadena con mas entradas de las esperadas, `req.ip` cambia en silencio y con el
  **cambia la agrupacion de los buckets de rate limit**, que es comportamiento de
  seguridad, no solo de observabilidad.
- El proxy debe fijar `X-Forwarded-Proto` para que las URLs generadas y las
  cookies de sesion salgan con el esquema correcto.
- **Grafana** necesitara ademas `root_url` (y `serve_from_sub_path` si se monta
  bajo una ruta) y cookies seguras, porque hoy esta pensada para servirse solo por
  loopback sin TLS.

## References

- **REF-001**: `docs/superpowers/plans/logging-y-auditoria.md` (plan de ejecucion).
- **REF-002**: `docs/adr/adr-0008-durable-audit-events.md` (bitacora durable).
- **REF-003**: OWASP Logging Cheat Sheet.
- **REF-004**: Pino v10, Grafana Alloy, Loki (retencion, cardinalidad,
  autenticacion) y Grafana Alerting.
- **REF-005**: Docker `local` logging driver.
