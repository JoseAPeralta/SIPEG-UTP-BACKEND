---
title: 'ADR-0014: Metricas Prometheus y dashboards operativos de SIPEG'
status: 'Accepted'
date: '2026-10-20'
authors: 'Equipo backend SIPEG UTP'
tags: ['architecture', 'observability', 'metrics', 'operations']
supersedes: ''
superseded_by: ''
---

# ADR-0014: Metricas Prometheus y dashboards operativos de SIPEG

## Status

**Accepted** — inventario y presupuesto aprobados el 2026-10-20. La recoleccion,
los exportadores, los dashboards y las alertas se implementaron en las fases
posteriores del plan; este ADR fija el diseno, los limites y las decisiones
operativas.

Complementa ADR-0007 (logs con Loki y Grafana) y ADR-0013 (endurecimiento y
limites del VPS). No reemplaza ninguno de los dos.

## Context

El stack actual de observabilidad es suficiente para diagnosticar logs, pero no
para medir el comportamiento del sistema en el tiempo:

- Prometheus esta desplegado y solo recolecta `node-exporter:9100` cada 60
  segundos.
- La API Express 5 sobre Node.js 24 no tiene cliente de metricas ni listener de
  exposicion.
- No hay metricas de PostgreSQL, de los contenedores Docker ni de disponibilidad
  interna o publica.
- Grafana tiene tres dashboards basados en Loki (`API Overview`, `Errors` y
  `Security`) y un datasource `prometheus` ya provisionado.
- El health de la API devuelve HTTP 200 aunque `authJwksReachable` sea `false` y
  no comprueba PostgreSQL.
- Node Exporter tiene acceso al filesystem y al PID del host, pero no comparte su
  namespace de red. Sus contadores de red no representan el trafico del VPS.

El 2026-10-20 se confirmo el siguiente inventario del VPS de produccion:

| Recurso                           | Valor              |
| --------------------------------- | ------------------ |
| vCPU                              | 2                  |
| RAM total                         | 3,7 GiB            |
| RAM disponible                    | 2,5 GiB            |
| Almacenamiento libre en `/`       | 22 GB (45 % usado) |
| Sistema operativo                 | Ubuntu 26.04       |
| Docker                            | cgroups v2         |
| Consumo observado de contenedores | ~733 MiB           |

Los limites de memoria de los servicios permanentes ya suman aproximadamente
**3,75 GiB**. Los nuevos recolectores aprobados agregan **256 MiB** de techos, de
modo que la suma de limites ronda **4,0 GiB**, por encima de la RAM fisica. Un
limite es una cota, no una reserva: la aprobacion se apoya en el consumo real
observado y en que quedan 2,5 GiB disponibles, pero la calibracion posterior debe
confirmar que los picos simultaneos no degradan el host.

## Decision

Adoptar Prometheus como fuente de series temporales numericas y mantener Loki
como fuente de logs de diagnostico. Grafana consulta ambos datasources.

### Recoleccion privada

Prometheus y todos los exportadores se comunican por redes internas de Compose.
Ningun exporter publica un puerto al host ni al exterior: se declaran con
`expose` y Prometheus los alcanza por nombre de servicio. La ampliacion se
concentra en `compose.observability.yaml` y usa estas redes:

- **`metrics`**: Prometheus, listener privado de la API, PostgreSQL Exporter,
  Telegraf y Blackbox Exporter.
- **`postgres-metrics`**: comunicacion exclusiva entre PostgreSQL y su exporter.
- **`docker-api`**: `docker-socket-proxy` y sus consumidores de solo lectura,
  Alloy y Telegraf.
- **`observability`**: Grafana, Loki, Prometheus y la salida de los probes
  publicos.

La API y PostgreSQL conservan sus redes de aplicacion; el overlay solo agrega las
redes secundarias necesarias para la recoleccion.

### Listener privado de la API

La API expone metricas en un listener HTTP separado del listener de negocio:

- Puerto `9464` dentro del contenedor, con `GET /metrics` y `HEAD /metrics`.
  Otro metodo responde 405 y cualquier otra ruta responde 404.
- Fuera de Compose, `METRICS_ENABLED=false`, `METRICS_HOST=127.0.0.1` y
  `METRICS_PORT=9464`. El overlay habilita el listener en `0.0.0.0:9464` dentro
  del contenedor y solo lo declara en la red `metrics`.
- El listener de negocio en `3000` sigue siendo el unico alcanzado por
  Cloudflare Tunnel. `/metrics`, `/api/metrics` y `/api/v1/metrics` no se sirven
  por ese puerto.
- El registro es propio y compartido por el middleware HTTP y el listener.
  Incluye `sipeg_http_requests_total`, `sipeg_http_request_duration_seconds` y
  `sipeg_http_requests_in_flight`, ademas de los colectores oficiales de CPU,
  memoria, heap, GC, event loop y version del runtime.
- Las etiquetas HTTP se limitan a metodo, plantilla de ruta, codigo de estado,
  tipo de solicitud y resultado. No se usan IDs de recurso, query strings,
  tokens, emails, IPs ni cuerpos de solicitud.

### Node Exporter para el host

Node Exporter sigue siendo el recolector del host, con acceso de solo lectura al
filesystem y al PID namespace. No se le concede el namespace de red del host y
sus contadores de red no se presentan como trafico del VPS. La Fase 3 agrega un
recolector de red en el host que publica contadores mediante el textfile
collector de Node Exporter.

### PostgreSQL Exporter

Se incorpora PostgreSQL Exporter con una identidad dedicada y de solo lectura:

- Rol `sipeg_monitor` con `CONNECT` y `pg_monitor`, limite de conexiones y
  timeout de consultas. No es superusuario y no puede modificar tablas de
  negocio.
- La contrasena se entrega por archivo, nunca en `.env.prod` ni en el
  repositorio. En produccion se usan `POSTGRES_MONITOR_USER` y
  `POSTGRES_MONITOR_PASSWORD_FILE`.
- El exporter se conecta a PostgreSQL por `postgres-metrics` y Prometheus lo
  recolecta por `metrics`.
- Las metricas requeridas incluyen `pg_up`, conexiones y limite, sesiones por
  estado, transacciones confirmadas y revertidas, bloqueos, deadlocks, bytes
  temporales, tamano de la base y estadisticas de cache disponibles.

### Telegraf para Docker

La recoleccion de contenedores usa Telegraf contra el `docker-socket-proxy`
existente, limitado a lectura. No se usa cAdvisor y no se monta
`/var/run/docker.sock` directamente en Telegraf.

- Entrada Docker en `tcp://docker-socket-proxy:2375`, cada 30 segundos.
- Filtrado por proyecto SIPEG y allowlist de etiquetas Compose de proyecto y
  servicio. Las variables de entorno no se exportan como etiquetas.
- Se eliminan campos de alta cardinalidad como `container_id` y PID.
- Los estados y el health se normalizan a valores numericos.
- `restart_count` se interpreta como reinicios del contenedor actual, porque
  vuelve a empezar cuando el contenedor se recrea.
- La salida Prometheus escucha en `9273` y conserva el instante de recoleccion
  para detectar datos antiguos.

### Disponibilidad con Blackbox Exporter

Blackbox Exporter ejecuta probes desde el VPS y separa dos recorridos:

- **Interno**: health de la API en `http://api:3000/api/v1/health`, JWKS interno
  y health de Grafana.
- **Publico**: health y JWKS de `https://api.sipeg-utp.com`, a traves de
  Cloudflare.

Cada probe valida codigo HTTP, contenido y campos identificadores; no basta con
un 200. Esto es necesario porque el health actual responde 200 aunque
`authJwksReachable` sea `false`. Se usa timeout de cinco segundos, validacion TLS,
sin seguimiento de redirects y etiquetas estables `check` y tipo de recorrido.
Asi se distingue un fallo del origen de un fallo del recorrido publico.

### Retencion

Prometheus mantiene la configuracion actual: **90 dias** y **2 GB**. El limite de
tamano es el limite efectivo y puede acortar el historico mucho antes de los 90
dias. No se cambia en esta fase; se revisa con el crecimiento de series y disco
observado durante las primeras 48-72 horas.

### Presupuesto de memoria

Los limites aprobados para los nuevos servicios son:

| Servicio            |  Limite |
| ------------------- | ------: |
| PostgreSQL Exporter |  64 MiB |
| Telegraf            | 128 MiB |
| Blackbox Exporter   |  64 MiB |

La instrumentacion de Node.js usa el presupuesto del contenedor de la API; no
agrega un servicio ni un limite nuevo. Los servicios existentes conservan sus
limites actuales.

### Limite de cobertura

La supervision se ejecuta desde el propio VPS. No hay un monitor externo: una
caida total del host, de Docker o del stack de observabilidad detiene Prometheus,
Grafana y las notificaciones. En ese escenario no se genera ningun aviso. Los
probes publicos solo distinguen origen y borde mientras el VPS y Prometheus sigan
operativos. Un monitor externo queda como decision posterior y no forma parte de
esta fase.

## Consequences

### Positive

- **POS-001**: La API, Node.js, PostgreSQL, Docker y el host pasan de una
  observabilidad basada solo en logs a series temporales consultables.
- **POS-002**: Un fallo del origen se distingue de un fallo del recorrido por
  Cloudflare sin depender del JWKS publico.
- **POS-003**: Prometheus y los exportadores quedan en redes privadas; no se
  agrega superficie publica ni se expone `/metrics` por el listener de negocio.
- **POS-004**: Telegraf reutiliza el proxy Docker de solo lectura, sin cAdvisor,
  sin privilegios adicionales y sin montar el socket directamente.
- **POS-005**: Los nuevos techos de memoria son pequenos y acotados (256 MiB en
  total), y la instrumentacion de Node.js no crea otro contenedor.
- **POS-006**: Los siete dashboards planificados tienen UIDs estables y se
  provisionan por archivo en la carpeta existente `SIPEG UTP`, con el datasource
  `prometheus`.
- **POS-007**: Loki conserva su papel para diagnostico detallado; las metricas no
  duplican logs ni datos personales.

### Negative

- **NEG-001**: Se agregan tres servicios y sus archivos de configuracion, con
  mantenimiento, actualizaciones y diagnostico propios.
- **NEG-002**: La suma de techos de memoria supera la RAM fisica del VPS. Es
  admisible porque no son reservas, pero exige medir consumo real y ajustar
  limites; un pico simultaneo puede provocar presion de memoria.
- **NEG-003**: Sin monitor externo, una caida total del VPS no genera
  notificacion. La disponibilidad publica solo se mide desde el propio origen.
- **NEG-004**: Node Exporter no comparte el namespace de red del host. Hasta la
  Fase 3, las metricas de red del VPS no son fiables para paneles de trafico.
- **NEG-005**: La retencion de 2 GB puede truncar el historico antes de los 90
  dias, sobre todo al sumar series de API, PostgreSQL y Docker.
- **NEG-006**: Una instrumentacion con etiquetas de alta cardinalidad puede
  aumentar la memoria y el disco de Prometheus; el contrato de etiquetas debe
  respetarse.
- **NEG-007**: El health de la API no refleja por si solo el estado de PostgreSQL
  ni del JWKS. La cobertura depende de probes con validacion de contenido y de
  `pg_up`.
- **NEG-008**: Los probes publicos dependen de Cloudflare y del tunel; una caida
  del borde se ve como fallo de disponibilidad aunque el origen siga sano.

### Neutral

- Loki y Prometheus miden cosas distintas: logs para diagnostico, metricas para
  tendencia, saturacion y disponibilidad. No se reemplaza uno con otro.
- Los umbrales de alerta son valores iniciales y se calibran con produccion.
- Las imagenes nuevas seguiran la politica de ADR-0007: `repo:tag@sha256:digest`,
  compatibles con `linux/amd64` y sin `latest`.

## Alternatives Considered

### cAdvisor

- **ALT-001**: **Description**: Recolectar metricas de contenedores con cAdvisor.
- **ALT-002**: **Rejection Reason**: Requiere un contenedor adicional con montajes
  del host y acceso a cgroups, agrega consumo y superficie, y duplica parte de lo
  que ya puede obtener Telegraf por el proxy de solo lectura existente.

### Exporter integrado en Alloy

- **ALT-003**: **Description**: Usar Alloy para exponer o recolectar metricas,
  ademas de logs.
- **ALT-004**: **Rejection Reason**: Mezcla dos pipelines con ciclos de vida y
  permisos distintos, amplia la configuracion de Alloy y lo acopla a Prometheus.
  Los exportadores especializados y Prometheus ya cubren la necesidad con menos
  acoplamiento.

### Node Exporter con host networking

- **ALT-005**: **Description**: Dar a Node Exporter el namespace de red del host
  para leer sus interfaces directamente.
- **ALT-006**: **Rejection Reason**: Concede al contenedor el namespace de red del
  host y obliga a proteger un puerto adicional. La Fase 3 resuelve la red con un
  recolector en el host y el textfile collector, con usuario dedicado y escritura
  atomica, sin ampliar el privilegio del contenedor.

### Dashboards solo con Loki

- **ALT-007**: **Description**: Construir los dashboards nuevos consultando solo
  logs en Loki.
- **ALT-008**: **Rejection Reason**: Los logs no son series numericas: no
  permiten calcular tasas, percentiles, saturacion, capacidad ni disponibilidad
  con la fiabilidad de Prometheus. Loki sigue siendo la fuente para diagnostico,
  no para metrica operativa.

## Implementation Notes

- **IMP-001**: Plan de ejecucion:
  `docs/superpowers/plans/2026-10-20-grafana-prometheus-dashboards.md`. La Fase 0
  solo crea este ADR, el catalogo `observability/README.md` y las variables de las
  plantillas de entorno; no modifica codigo, Compose, dashboards ni alertas.
- **IMP-002**: Variables nuevas en `.env.example` y `.env.prod.example`:
  `POSTGRES_EXPORTER_MEM_LIMIT=64m`, `TELEGRAF_MEM_LIMIT=128m`,
  `BLACKBOX_EXPORTER_MEM_LIMIT=64m`, `METRICS_ENABLED=false`,
  `METRICS_HOST=127.0.0.1` y `METRICS_PORT=9464`. Produccion agrega
  `POSTGRES_MONITOR_USER=sipeg_monitor` y
  `POSTGRES_MONITOR_PASSWORD_FILE=/etc/sipeg/secrets/postgres-monitor-password`.
- **IMP-003**: El archivo de contrasena del monitor se crea en el VPS fuera de
  Git, con permisos `600`, y Compose lo monta como secreto en
  `/run/secrets/postgres_monitor_password`. La contrasena nunca se escribe en
  `.env.prod` ni se registra.
- **IMP-004**: Los dashboards se provisionan por archivo en `SIPEG UTP`, con
  datasource explicito `prometheus`, UIDs estables y ventana inicial de seis
  horas. El catalogo y los UIDs estan en `observability/README.md`.
- **IMP-005**: La verificacion usa `pnpm run observability:check` para el estado
  aplicado en Grafana y `promtool check config` para la configuracion de
  Prometheus. La comprobacion de metricas y los fixtures de PromQL se agregan en
  la Fase 9.
- **IMP-006**: No se publican puertos de metricas. El proxy Docker conserva
  `POST=0` y solo las operaciones de lectura necesarias. El rol
  `sipeg_monitor` no recibe permisos de escritura.
- **IMP-007**: La retencion se revisa tras medir series activas, crecimiento de
  disco y duracion de scrape. Ajustarla exige actualizar el compose y este ADR.
- **IMP-008**: Si en el futuro se agrega un monitor externo, debe ser una
  decision separada con su propio alcance, credenciales y ruta de notificacion;
  no se simula con los probes actuales.

## References

- **REF-001**: `docs/superpowers/plans/2026-10-20-grafana-prometheus-dashboards.md`.
- **REF-002**: `docs/adr/adr-0007-structured-logging-and-observability.md`.
- **REF-003**: `docs/adr/adr-0012-cloudflare-workers-tunnel-deployment.md`.
- **REF-004**: `docs/adr/adr-0013-vps-hardening-baseline.md`.
- **REF-005**: Prometheus: configuracion, retencion y exposicion.
- **REF-006**: PostgreSQL Exporter v0.20.1.
- **REF-007**: Telegraf 1.40.2, entrada Docker.
- **REF-008**: Blackbox Exporter v0.29.0.
- **REF-009**: Node Exporter, textfile collector.
