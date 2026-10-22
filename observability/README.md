# Observabilidad SIPEG UTP

Catálogo operativo del stack de observabilidad del backend. Las fases 0–9 del
plan `docs/superpowers/plans/2026-10-20-grafana-prometheus-dashboards.md` están
implementadas y la Fase 10 completó esta documentación el **2026-10-20**; este
documento describe el estado desplegado, las verificaciones y la calibración
pendiente. La Fase 0 fija el inventario, el presupuesto y las variables de
entorno; la Fase 1 define las redes privadas y el self-scrape de Prometheus; la
Fase 2 instrumenta HTTP y Node.js en la API y activa su listener privado de
métricas; la Fase 3 publica los contadores de red reales del VPS mediante un
timer del host y el textfile collector de Node Exporter; la Fase 4 incorpora
PostgreSQL Exporter con el rol dedicado `sipeg_monitor`; la Fase 5 incorpora
Telegraf para las métricas de Docker a través del proxy de solo lectura; la Fase
6 incorpora Blackbox Exporter con probes internos y públicos. La Fase 7
incorpora los siete dashboards de Prometheus, la Fase 8 provisiona las alertas
de métricas y la Fase 9 implementa la comprobación automática
`observability:check --metrics` y los fixtures de PromQL validados con
`promtool test rules`.

## Propósito

- Explicar qué fuentes de observabilidad existen y cómo se verifican.
- Servir de referencia para redes, puertos internos, intervalos y dashboards.
- Evitar que una fuente ausente o con datos antiguos se interprete como
  saludable.
- Reunir los comandos de verificación, las reglas de seguridad y el diagnóstico
  básico.

## Estado actual

### Implementado (2026-10-20)

| Componente                 | Estado                                                                                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Prometheus                 | Implementado en `compose.observability.yaml`; recolecta los 8 jobs mediante `node-exporter:9100`, `api:9464`, `postgres-exporter:9187`, `telegraf:9273`, `blackbox-exporter:9115` (incluye `/probe` interno y público) y a sí mismo. |
| Retención de Prometheus    | 90 días y 2 GB; el límite de tamaño puede acortar el histórico.                                                                                                                                                                      |
| Node Exporter              | Implementado con filesystem y PID del host, y textfile collector; no comparte el namespace de red.                                                                                                                                   |
| Grafana                    | Implementado, con datasources `loki` y `prometheus` provisionados por archivo.                                                                                                                                                       |
| Dashboards                 | Implementados: tres dashboards de Loki y siete de Prometheus en la carpeta `SIPEG UTP`.                                                                                                                                              |
| Alertas de métricas        | Implementadas: 15 reglas en `observability/grafana/provisioning/alerting/metrics.yaml`; los umbrales se calibran con producción.                                                                                                     |
| Logs                       | Alloy lee los logs de los contenedores por `docker-socket-proxy` y los envía a Loki.                                                                                                                                                 |
| `observability:check`      | Implementado; verifica el estado aplicado de Loki, Grafana y, con `--metrics`, Prometheus, dashboards y alertas; no modifica nada.                                                                                                   |
| Listener privado de la API | Implementado en `9464` sobre la red `metrics`, con `GET`/`HEAD /metrics`; no se publica.                                                                                                                                             |
| Job `sipeg-api`            | Implementado en Prometheus cada 30 s contra `api:9464`.                                                                                                                                                                              |
| Red del host               | Implementada con `sipeg-host-network-metrics.timer` y el textfile collector de Node Exporter.                                                                                                                                        |
| PostgreSQL Exporter        | Implementado en `postgres-exporter:9187`; job `postgres` cada 60 s y rol `sipeg_monitor` de solo lectura.                                                                                                                            |
| Telegraf                   | Implementado en `telegraf:9273`; métricas de Docker vía `docker-socket-proxy`, job `docker` cada 30 s y series con caducidad de 90 s.                                                                                                |
| Blackbox Exporter          | Implementado en `blackbox-exporter:9115`; jobs `blackbox`, `blackbox-internal` y `blackbox-public`; módulos HTTP internos y HTTPS públicos.                                                                                          |

### Calibración y cobertura pendientes

| Componente          | Estado                                                                    |
| ------------------- | ------------------------------------------------------------------------- |
| Umbrales de alertas | Valores iniciales pendientes de 48–72 horas de observación en producción. |
| Monitor externo     | Pendiente de decisión; los probes se ejecutan desde el propio VPS.        |

Las fases 0–9 del plan están implementadas y la Fase 10 cerró la documentación.
No se debe asumir que una fuente está sana solo porque el panel exista: si una
consulta no devuelve series, comprobar primero si el job fue incorporado, si el
target está `up` y si las series son frescas.

### Estado final

| Elemento            | Estado                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Jobs                | **8**: `node`, `sipeg-api`, `postgres`, `docker`, `blackbox`, `blackbox-internal`, `blackbox-public` y `prometheus`.              |
| Dashboards          | **7** de Prometheus, además de los 3 de Loki, en la carpeta `SIPEG UTP`.                                                          |
| Alertas de métricas | **15** reglas provisionadas desde `metrics.yaml`; no sustituyen las reglas de Loki de `rules.yaml`.                               |
| Verificador         | `pnpm run observability:check -- --metrics` comprueba datasource, jobs, métricas, dashboards y alertas contra el estado aplicado. |

Comandos de referencia:

```bash
pnpm run observability:check -- --metrics --window 10
docker compose -f compose.dev.yaml -f compose.observability.yaml \
  run --rm --no-deps --entrypoint /bin/promtool prometheus \
  check config /etc/prometheus/prometheus.yml
docker run --rm \
  -v "$PWD/observability/prometheus:/etc/prometheus:ro" \
  --entrypoint /bin/promtool prom/prometheus:v3.15.0 \
  test rules /etc/prometheus/tests/queries.test.yml
```

## Topología

```text
Navegador
  -> Cloudflare (TLS; Access solo para Grafana)
  -> Cloudflare Tunnel (cloudflared)
  -> api:3000       (API de negocio, nunca /metrics)
  -> grafana:3000

Prometheus
  -> node-exporter:9100
  -> api:9464                  (listener privado)
  -> postgres-exporter:9187    (red metrics)
  -> telegraf:9273
  -> blackbox-exporter:9115    (métricas propias y /probe)
  -> prometheus:9090           (self-scrape)

Blackbox Exporter
  -> api:3000/api/v1/health        (interno, HTTP)
  -> api:3000/api/auth/jwks        (interno, HTTP)
  -> grafana:3000/api/health       (interno, HTTP)
  -> https://api.sipeg-utp.com/... (público, HTTPS vía Cloudflare)

PostgreSQL Exporter                 (red postgres-metrics)
  -> db:5432                        (rol sipeg_monitor, solo lectura)

Host (sipeg-host-network-metrics.timer, cada 60 s)
  -> /var/lib/sipeg-node-exporter/textfile/sipeg-host-network.prom
  -> node-exporter:9100        (textfile collector, solo lectura)

Grafana
  -> Loki        (logs)
  -> Prometheus  (métricas)

Alloy -> Loki                        (envío de logs)
Alloy -> docker-socket-proxy:2375    (solo lectura)
Telegraf -> docker-socket-proxy:2375 (solo lectura)
```

La API y PostgreSQL mantienen sus redes de aplicación. El overlay solo agrega
las redes secundarias necesarias para la recolección.

## Redes

| Red                | Estado    | Servicios previstos                                                                                   | Propósito                                                                 |
| ------------------ | --------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `sipeg-utp-prod`   | Existente | `api`, `db`, `cloudflared`                                                                            | Red de la aplicación y salida por el túnel.                               |
| `observability`    | Existente | `grafana`, `loki`, `alloy`, `docker-socket-proxy`, `prometheus`, `node-exporter`, `blackbox-exporter` | Consulta de Grafana, recolección de logs y salida de los probes públicos. |
| `metrics`          | Existente | `prometheus`, `api`, `postgres-exporter`, `telegraf`, `blackbox-exporter`                             | Scrapes privados de Prometheus.                                           |
| `postgres-metrics` | Existente | `db`, `postgres-exporter`                                                                             | Comunicación exclusiva entre PostgreSQL y su exporter.                    |
| `docker-api`       | Existente | `docker-socket-proxy`, `alloy`, `telegraf`                                                            | Acceso de solo lectura al socket de Docker.                               |

`metrics`, `postgres-metrics` y `docker-api` son redes `bridge` con `internal:
true`: no tienen gateway ni salida externa. La API y PostgreSQL conservan su red
de aplicación y solo se agregan a la red secundaria correspondiente. PostgreSQL
Exporter solo está en `metrics` y `postgres-metrics`: Prometheus lo alcanza por
la primera y él alcanza `db` por la segunda. Telegraf está en `metrics` para que
Prometheus lo scrapee y en `docker-api` para llegar al proxy; no monta el socket
ni publica puertos. Blackbox Exporter está en `metrics` para que Prometheus lo
scrapee y lo resuelva, y en `observability` para resolver `grafana` y salir a
Internet en los probes públicos.

## Jobs de recolección

| Job                 | Fuente                                |    Puerto interno | Intervalo | Estado       |
| ------------------- | ------------------------------------- | ----------------: | --------: | ------------ |
| `node`              | Node Exporter                         |            `9100` |      60 s | Implementado |
| `sipeg-api`         | Listener privado de la API            |            `9464` |      30 s | Implementado |
| `postgres`          | PostgreSQL Exporter                   |            `9187` |      60 s | Implementado |
| `docker`            | Telegraf                              |            `9273` |      30 s | Implementado |
| `blackbox`          | Métricas propias de Blackbox Exporter |            `9115` |      60 s | Implementado |
| `blackbox-internal` | Probes internos mediante `/probe`     | `9115` (`/probe`) |      30 s | Implementado |
| `blackbox-public`   | Probes públicos mediante Cloudflare   | `9115` (`/probe`) |      30 s | Implementado |
| `prometheus`        | Métricas propias de Prometheus        |            `9090` |      60 s | Implementado |

Todos los puertos son internos: se declaran con `expose` y no se publican en el
host. El único puerto publicado del stack de observabilidad es el de Grafana en
`127.0.0.1:3001` para diagnóstico desde el VPS.

## Métricas de red del host

Node Exporter no comparte el namespace de red del VPS, así que sus propios
contadores de red no representan el tráfico del host. El timer
`sipeg-host-network-metrics.timer` ejecuta
`/usr/local/libexec/sipeg/collect-network.sh` cada 60 segundos como el usuario
sin privilegios `sipeg-metrics`. El script lee `/proc/net/dev`, excluye `lo` y
las interfaces virtuales (`docker*`, `veth*`, `br-*`, `virbr*`, `tun*`, `tap*`,
`wg*`) y escribe el archivo de forma atómica. Si la lectura o la validación de
los contadores falla, termina con error y conserva el archivo anterior.

Archivo publicado:

```text
/var/lib/sipeg-node-exporter/textfile/sipeg-host-network.prom
```

`HOST_METRICS_DIR` selecciona el directorio del host que Compose monta de solo
lectura en Node Exporter. En producción vale
`/var/lib/sipeg-node-exporter/textfile`; en desarrollo apunta a una ruta local
como `./.local/host-metrics`. Node Exporter conserva `pid: host`, el montaje
`/:/host:ro,rslave`, `--path.rootfs=/host` y `cap_drop: ALL`; no tiene host
networking, capabilities adicionales ni publica puertos.

| Métrica                                           | Tipo    | Significado                                      |
| ------------------------------------------------- | ------- | ------------------------------------------------ |
| `sipeg_host_network_receive_bytes_total`          | counter | Bytes recibidos por interfaz física del host.    |
| `sipeg_host_network_transmit_bytes_total`         | counter | Bytes transmitidos por interfaz física del host. |
| `sipeg_host_network_collection_timestamp_seconds` | gauge   | Instante UTC de la última recolección correcta.  |

El timestamp solo avanza tras una recolección correcta: es la señal para
detectar datos antiguos. Un archivo sin actualizar durante más de tres minutos
debe tratarse como recolección fallida, aunque el target `node` siga `up`.

En el VPS, el instalador debe ejecutarse antes de recrear Node Exporter para que
existan el usuario, el directorio y el `.prom`:

```bash
sudo deploy/host/install.sh metrics
docker compose -f compose.prod.yaml -f compose.observability.yaml \
  -f compose.cloudflare.yaml --env-file .env.prod \
  up -d --force-recreate node-exporter
```

Verificación local del script y del timer:

```bash
bash deploy/host/metrics/collect-network.test.sh
systemctl status sipeg-host-network-metrics.timer
systemctl start sipeg-host-network-metrics.service
cat /var/lib/sipeg-node-exporter/textfile/sipeg-host-network.prom
```

## PostgreSQL Exporter

El servicio `postgres-exporter` de `compose.observability.yaml` usa la imagen
fijada `quay.io/prometheuscommunity/postgres-exporter:v0.20.1@sha256:ac5ec343104fae0e2d84a27bb8d69b38430a11910c5382cad85d478d2bab713e`
y escucha en `9187` solo dentro de las redes `metrics` y `postgres-metrics`. No
publica puertos, corre con `read_only: true`, `cap_drop: ALL`,
`no-new-privileges` y 64 MiB por defecto. Se conecta a `db:5432` con
`sslmode=disable` (red interna) y `PG_EXPORTER_COLLECTION_TIMEOUT=5s`.
Prometheus lo recolecta con el job `postgres` cada 60 s.

### Secreto y rol

La contraseña vive en un archivo del HOST, nunca en `.env.prod` ni en el
repositorio:

- Desarrollo: `./.local/secrets/postgres-monitor-password` (`.local/` está en
  `.gitignore`).
- Producción: `/etc/sipeg/secrets/postgres-monitor-password`, con directorio
  `0700` y archivo `0600`.

`POSTGRES_MONITOR_PASSWORD_FILE` en `.env.prod` apunta a esa ruta del HOST.
Compose la monta como secreto en `/run/secrets/postgres_monitor_password`; el
exporter la lee con `DATA_SOURCE_PASS_FILE`. No es una ruta de contenedor.

El script idempotente crea el archivo si falta, reutiliza el existente (sin
saltos de línea ni comillas simples), aprovisiona el rol `sipeg_monitor` y
verifica la conexión TCP. Para rotar la contraseña, reemplazar el archivo y
volver a ejecutar el script; después recrear `postgres-exporter` para que relea
el secreto:

```bash
sudo deploy/observability/provision-postgres-monitor.sh
# Opcional: ENV_FILE=/ruta/.env.prod sudo -E deploy/observability/provision-postgres-monitor.sh
```

El rol tiene `LOGIN`, `CONNECT` sobre la base actual, `pg_monitor`,
`CONNECTION LIMIT 2`, `statement_timeout=5s` y
`default_transaction_read_only=on`; no es superusuario y no recibe privilegios
de escritura ni acceso a tablas de negocio. El script envía la contraseña por
stdin, no por argv, y nunca la imprime.

### Despliegue y verificación

La primera aplicación del overlay puede recrear `db` para conectarlo a
`postgres-metrics`; prever una ventana de mantenimiento breve. Después:

```bash
sudo deploy/observability/provision-postgres-monitor.sh
docker compose -f compose.prod.yaml -f compose.observability.yaml \
  -f compose.cloudflare.yaml --env-file .env.prod up -d postgres-exporter
docker compose -f compose.prod.yaml -f compose.observability.yaml \
  -f compose.cloudflare.yaml --env-file .env.prod up -d --force-recreate prometheus
```

Prometheus solo lee su configuración al arrancar; por eso el job `postgres` no
aparece hasta recrear el contenedor. Para comprobar el rol sin imprimir la
contraseña:

```bash
docker compose -f compose.prod.yaml -f compose.observability.yaml \
  -f compose.cloudflare.yaml --env-file .env.prod exec -T db sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\du sipeg_monitor"'
```

En Grafana o en la API de Prometheus:

```promql
up{job="postgres"}
pg_up
```

`up{job="postgres"}` indica si Prometheus puede scrapear el exporter. `pg_up`
indica si el exporter puede consultar PostgreSQL. Un `up=1` con `pg_up=0` es un
fallo de conexión o de credenciales del exporter, no un fallo del scrape; si el
exporter cae, `pg_up` puede desaparecer y `up` pasa a `0`.

## Telegraf (métricas de Docker)

El servicio `telegraf` de `compose.observability.yaml` usa la imagen fijada
`telegraf:1.40.2@sha256:aedc74ac64c623b6e6760545a8ff56a63b99a798bba3d361279a2887642798cf`
y escucha en `9273` solo dentro de las redes `metrics` y `docker-api`. Habla con
`docker-socket-proxy:2375`, no monta `/var/run/docker.sock` y no publica puertos.
Corre con `read_only: true`, `cap_drop: ALL`, `no-new-privileges`, `/tmp` como
`tmpfs` y 128 MiB por defecto. Prometheus lo recolecta con el job `docker` cada
30 s.

### Filtros de recolección

- Solo contenedores cuyo nombre empieza por `sipeg-utp-prod-` o
  `sipeg-utp-dev-`. Las etiquetas Compose de proyecto y servicio permiten
  separarlos en los paneles.
- `migrate` y `seed` se excluyen explícitamente (`*migrate*`, `*seed*`). Son
  trabajos one-shot que terminan con exit 0 y no deben figurar como servicios
  caídos.
- Estados incluidos: `running`, `restarting`, `exited`, `created`, `paused` y
  `dead`. Un contenedor detenido conserva su última serie y cambia de estado; no
  desaparece en el mismo scrape.
- `total_include = ["cpu", "blkio", "network"]` y
  `perdevice_include = []`: solo hay acumulados por contenedor, sin series por
  CPU, dispositivo o interfaz.
- `storage_objects = []`: no se consulta el uso de disco de imágenes, volúmenes
  ni contenedores.
- De las etiquetas Docker solo se incluyen `com.docker.compose.project` y
  `com.docker.compose.service`, renombradas a `project` y `service`. No se
  publican variables de entorno como etiquetas.

### Etiquetas y estados

Cada serie de contenedor conserva `project`, `service`, `container_name`,
`container_image`, `container_version` y `container_status`, además de
`engine_host` y `server_version`. Según la familia aparecen `cpu="cpu-total"`,
`network="total"` o `device="total"`. No se exponen `container_id`, `pid`,
`started_at` ni `finished_at`.

`state_code` se calcula en el bloque Starlark porque `processors.enum` de
Telegraf 1.40.2 escribe un tag cuando la entrada es un tag, y aquí se necesita un
field numérico. Ese mismo bloque reemplaza al procesador `fielddrop`, eliminado
en esa versión, y convierte `oomkilled` a `0`/`1`.

| `container_status` | `state_code` |
| ------------------ | -----------: |
| `created`          |            0 |
| `running`          |            1 |
| `paused`           |            2 |
| `restarting`       |            3 |
| `removing`         |            4 |
| `exited`           |            5 |
| `dead`             |            6 |
| otro               |            7 |

| `health_status` | `health_code` |
| --------------- | ------------: |
| `starting`      |             0 |
| `healthy`       |             1 |
| `unhealthy`     |             2 |
| `none`          |             3 |
| otro            |             4 |

`state_code` y `health_code` son campos numéricos. `container_status` permanece
como etiqueta de texto. `oomkilled` se normaliza a `0`/`1` porque la salida
`prometheus_client` descarta los campos booleanos. `health_status` no se publica
como etiqueta porque `string_as_label = false`.

### Métricas expuestas

La salida `prometheus_client` nombra cada serie `<measurement>_<field>`. Las
familias principales son:

| Grupo   | Métricas                                                                                                                                                                                                                                                                                                                                              |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Motor   | `docker_n_containers`, `docker_n_containers_running`, `docker_n_containers_stopped`, `docker_n_containers_paused`, `docker_n_cpus`, `docker_n_images`, `docker_n_goroutines`, `docker_n_used_file_descriptors`, `docker_n_listener_events`, `docker_memory_total`                                                                                     |
| Estado  | `docker_container_status_state_code`, `docker_container_status_restart_count`, `docker_container_status_oomkilled`, `docker_container_status_exitcode`, `docker_container_status_uptime_ns`                                                                                                                                                           |
| Health  | `docker_container_health_health_code`, `docker_container_health_failing_streak` (solo con `HEALTHCHECK`)                                                                                                                                                                                                                                              |
| CPU     | `docker_container_cpu_usage_percent`, `docker_container_cpu_usage_total`, `docker_container_cpu_usage_in_usermode`, `docker_container_cpu_usage_in_kernelmode`, `docker_container_cpu_usage_system`, `docker_container_cpu_throttling_periods`, `docker_container_cpu_throttling_throttled_periods`, `docker_container_cpu_throttling_throttled_time` |
| Memoria | `docker_container_mem_usage`, `docker_container_mem_usage_percent`, `docker_container_mem_limit`, `docker_container_mem_max_usage`, `docker_container_mem_rss`, `docker_container_mem_cache` y los campos `active_*`, `inactive_*`, `total_*`, `pg*`, `unevictable`, `writeback` que exponga el cgroup                                                |
| Red     | `docker_container_net_rx_bytes`, `docker_container_net_tx_bytes`, `docker_container_net_rx_packets`, `docker_container_net_tx_packets`, `docker_container_net_rx_errors`, `docker_container_net_tx_errors`, `docker_container_net_rx_dropped`, `docker_container_net_tx_dropped`                                                                      |
| Blkio   | `docker_container_blkio_io_service_bytes_recursive_*`, `io_serviced_recursive_*`, `io_queue_recursive_*`, `io_service_time_recursive_*`, `io_wait_time_*`, `io_merged_recursive_*`, `io_time_recursive` y `sectors_recursive`, según el cgroup                                                                                                        |

`restart_count` es del contenedor actual: vuelve a cero al recrearlo. Los
campos de memoria y blkio dependen de lo que publique el cgroup del host; en
cgroup v2 parte de las series de blkio puede no existir.

### Frescura

Prometheus scrapea cada 30 s. La salida de Telegraf caduca las series que no se
refrescan en 90 s (`expiration_interval = "90s"`), así que una caída de la
entrada Docker deja de publicar datos en lugar de servir valores antiguos. Si
Telegraf sigue vivo, `up{job="docker"}` puede continuar en `1` aunque las series
de contenedores desaparezcan: la frescura se comprueba por la presencia y el
valor de esas series, no solo por `up`. Tras arrancar, la primera recolección
puede tardar hasta un intervalo (30 s).

### Despliegue y verificación

```bash
docker compose -f compose.dev.yaml -f compose.observability.yaml \
  up -d docker-socket-proxy telegraf prometheus
docker compose -f compose.dev.yaml -f compose.observability.yaml \
  exec -T telegraf wget -qO- http://127.0.0.1:9273/metrics | grep '^docker_'
```

En producción se usan los tres archivos Compose y `.env.prod`. Para validar la
configuración sin levantar el stack:

```bash
docker run --rm \
  -v "$PWD/observability/telegraf/telegraf.conf:/etc/telegraf/telegraf.conf:ro" \
  --entrypoint telegraf telegraf:1.40.2 \
  --config /etc/telegraf/telegraf.conf --test --once
```

Fuera de Compose el comando termina con un error de resolución de
`docker-socket-proxy`; eso es un fallo de conexión, no de sintaxis. La
configuración carga los plugins antes de intentar conectar.

En Prometheus:

```promql
up{job="docker"}
docker_container_status_state_code
docker_container_health_health_code
```

## Blackbox Exporter (disponibilidad)

El servicio `blackbox-exporter` usa la imagen fijada
`prom/blackbox-exporter:v0.29.0@sha256:9613f2884689b6fad9f1939f6a3b0388c93a022cfaededb19545b329b5c83dea`
y escucha en `9115` solo dentro de las redes `metrics` y `observability`. No
publica puertos: `/probe` no es alcanzable desde el host ni a través del túnel.
Prometheus es su único cliente, por `metrics`. Corre con `read_only: true`,
`cap_drop: ALL`, `no-new-privileges`, `/tmp` como `tmpfs` y 64 MiB por defecto.
La configuración versionada en `observability/blackbox/blackbox.yml` se monta de
solo lectura en `/etc/blackbox_exporter/config.yml`.

### Módulos

| Módulo                      | Esquema | Validación                                                                                    |
| --------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| `http_health_internal`      | HTTP    | 200, sin redirects, `fail_if_ssl`, cuerpo con `"success": true` y `"status": "ok"`.           |
| `http_health_internal_jwks` | HTTP    | Igual que el anterior, más `"authJwksReachable": true`.                                       |
| `http_jwks_internal`        | HTTP    | 200, sin redirects, `fail_if_ssl`, cuerpo con `"keys": [{`.                                   |
| `http_grafana`              | HTTP    | 200, sin redirects, `fail_if_ssl`, cuerpo con `"database": "ok"`.                             |
| `https_health_public`       | HTTPS   | 200, sin redirects, `fail_if_not_ssl`, TLS mínimo 1.2, cuerpo de health y sin `<html`.        |
| `https_health_public_jwks`  | HTTPS   | Igual que el anterior, más `"authJwksReachable": true`.                                       |
| `https_jwks_public`         | HTTPS   | 200, sin redirects, `fail_if_not_ssl`, TLS mínimo 1.2, cuerpo con `"keys": [{` y sin `<html`. |

Todos los módulos usan timeout de 5 s, `preferred_ip_protocol: ip4` y regex que
admiten espacios del JSON. La verificación TLS de los módulos públicos no se
desactiva. `fail_if_ssl` en los internos confirma que el origen responde HTTP
plano dentro de la red Docker; `fail_if_not_ssl` en los públicos exige HTTPS en
el borde.

### Targets

| Job                 | `check`      | Target                                    | Módulo                      | `route`    |
| ------------------- | ------------ | ----------------------------------------- | --------------------------- | ---------- |
| `blackbox-internal` | `api-health` | `http://api:3000/api/v1/health`           | `http_health_internal`      | `internal` |
| `blackbox-internal` | `api-jwks`   | `http://api:3000/api/v1/health`           | `http_health_internal_jwks` | `internal` |
| `blackbox-internal` | `jwks`       | `http://api:3000/api/auth/jwks`           | `http_jwks_internal`        | `internal` |
| `blackbox-internal` | `grafana`    | `http://grafana:3000/api/health`          | `http_grafana`              | `internal` |
| `blackbox-public`   | `api-health` | `https://api.sipeg-utp.com/api/v1/health` | `https_health_public`       | `public`   |
| `blackbox-public`   | `api-jwks`   | `https://api.sipeg-utp.com/api/v1/health` | `https_health_public_jwks`  | `public`   |
| `blackbox-public`   | `jwks`       | `https://api.sipeg-utp.com/api/auth/jwks` | `https_jwks_public`         | `public`   |

Prometheus reescribe `__param_module` y `__param_target` desde las etiquetas del
target, conserva la URL original en `instance` y envía la petición a
`blackbox-exporter:9115`. Los jobs internos y públicos se scrapean cada 30 s; el
job `blackbox` recoge las métricas propias del exporter cada 60 s.

Los probes internos miden el origen: API y Grafana directamente por sus redes
Docker. Los públicos recorren Cloudflare y el túnel, terminan TLS en el borde y
detectan si el hostname público no llega al origen. Por eso una caída del túnel
o del edge puede dejar `blackbox-internal` en `1` y `blackbox-public` en `0`.

Todos los probes se ejecutan desde el propio VPS. No hay un monitor externo: una
caída total del host, de Docker o del stack de observabilidad detiene también
Prometheus, Grafana y las notificaciones. Los probes públicos solo distinguen el
origen del recorrido por Cloudflare mientras el VPS y Prometheus sigan operativos.

### Validación de contenido

Un HTTP 200 aislado no demuestra salud. El health de la API responde 200 incluso
con `authJwksReachable: false`, así que el check `api-jwks` exige además ese campo
en `true`. El check `jwks` exige un arreglo `keys` no vacío. El check de Grafana
exige `"database": "ok"`. Los módulos públicos fallan si el cuerpo contiene
`<html`, lo que cubre páginas de error, challenges de Cloudflare o respuestas
intersticiales servidas con estado 200.

Métricas útiles en Prometheus:

```promql
up{job=~"blackbox(-internal|-public)?"}
probe_success{job=~"blackbox-internal|blackbox-public"}
probe_http_status_code{job=~"blackbox-internal|blackbox-public"}
probe_duration_seconds{job=~"blackbox-internal|blackbox-public"}
probe_ssl_earliest_cert_expiry{job="blackbox-public"} - time()
```

`probe_success=1` es la señal de disponibilidad funcional; `up` solo indica que
Prometheus pudo hablar con Blackbox Exporter. Un `up=1` con `probe_success=0` es
un probe fallido, no un fallo del scrape.

### Despliegue y verificación

```bash
docker compose -f compose.dev.yaml -f compose.observability.yaml \
  up -d blackbox-exporter prometheus
docker run --rm \
  -v "$PWD/observability/blackbox/blackbox.yml:/etc/blackbox_exporter/config.yml:ro" \
  --entrypoint /bin/blackbox_exporter prom/blackbox-exporter:v0.29.0 \
  --config.check --config.file=/etc/blackbox_exporter/config.yml
```

En producción se usan los tres archivos Compose y `.env.prod`. Prometheus solo
lee su configuración al arrancar: recrear `prometheus` es necesario para que
aparezcan los tres jobs nuevos. Después, en la API de Prometheus o en Grafana:

```promql
up{job="blackbox"}
up{job="blackbox-internal"}
up{job="blackbox-public"}
```

## Dashboards

Carpeta de Grafana: **SIPEG UTP**. Los dashboards de Loki usan el datasource
`loki`; los de Prometheus usan el datasource `prometheus`.

### Loki

| Dashboard    | UID                  | Paneles | Estado    |
| ------------ | -------------------- | ------: | --------- |
| API Overview | `sipeg-api-overview` |      11 | Existente |
| Errors       | `sipeg-errors`       |      12 | Existente |
| Security     | `sipeg-security`     |      13 | Existente |

### Prometheus

| Dashboard               | UID                         | Paneles | Estado       |
| ----------------------- | --------------------------- | ------: | ------------ |
| SIPEG · VPS Overview    | `sipeg-vps-overview`        |      16 | Implementado |
| SIPEG · API HTTP        | `sipeg-api-http`            |      13 | Implementado |
| SIPEG · Node.js Runtime | `sipeg-nodejs-runtime`      |      11 | Implementado |
| SIPEG · PostgreSQL      | `sipeg-postgres-overview`   |      16 | Implementado |
| SIPEG · Docker          | `sipeg-docker-overview`     |      11 | Implementado |
| SIPEG · Availability    | `sipeg-availability`        |      10 | Implementado |
| SIPEG · Operations      | `sipeg-operations-overview` |      22 | Implementado |

Los siete dashboards usan el datasource `prometheus`, ventana inicial de seis
horas y refresco de 30 s. Los UIDs son estables: cambiarlos rompe enlaces y
alertas. Los dashboards se provisionan por archivo; la versión que corre es la
del repositorio.

## Alertas de métricas

Las reglas de Prometheus viven en
`observability/grafana/provisioning/alerting/metrics.yaml` y se provisionan en
la carpeta **SIPEG UTP** al arrancar Grafana. Son **15 reglas** agrupadas en
`sipeg-metrics-collectors`, `sipeg-metrics-host`, `sipeg-metrics-dependencies` y
`sipeg-metrics-availability`. No sustituyen ni modifican las reglas de Loki de
`rules.yaml`; `sipeg-disk-full` y `sipeg-5xx` conservan su UID y no deben
redefinirse sin mantenerlo.
El contacto `sipeg-email` y la política de notificación se reutilizan sin
cambios en la ruta de correo. Las reglas añaden los labels `severity` y
`component` para filtrar y agrupar; la política actual sigue agrupando por
`grafana_folder` y `alertname`.

| Grupo                        | Regla                                   | Condición inicial                            | Severidad | `for` | Panel                                  |
| ---------------------------- | --------------------------------------- | -------------------------------------------- | --------- | ----- | -------------------------------------- |
| `sipeg-metrics-collectors`   | `sipeg-target-down`                     | `up=0` o job esperado ausente (`> 0`)        | critical  | 2m    | Operations > Estado de jobs esperados  |
| `sipeg-metrics-collectors`   | `sipeg-host-network-stale`              | antigüedad del recolector `> 180 s`          | warning   | 2m    | VPS > Antigüedad del recolector de red |
| `sipeg-metrics-collectors`   | `sipeg-postgres-exporter-errors`        | error de scrape `> 0` o colector fallido     | warning   | 5m    | PostgreSQL > Colectores con error      |
| `sipeg-metrics-host`         | `sipeg-host-cpu-high`                   | CPU `> 90 %`                                 | warning   | 15m   | VPS > CPU actual                       |
| `sipeg-metrics-host`         | `sipeg-host-memory-low`                 | memoria disponible `< 10 %`                  | warning   | 10m   | VPS > Memoria total, disponible y swap |
| `sipeg-metrics-host`         | `sipeg-host-inodes-low`                 | inodos libres `< 10 %`                       | warning   | 15m   | VPS > Inodos del disco raíz            |
| `sipeg-metrics-host`         | `sipeg-disk-critical`                   | disco raíz `> 90 %`                          | critical  | 10m   | VPS > Disco raíz utilizado             |
| `sipeg-metrics-dependencies` | `sipeg-postgres-down`                   | `1 - pg_up > 0` o sin datos                  | critical  | 2m    | PostgreSQL > Disponibilidad            |
| `sipeg-metrics-dependencies` | `sipeg-postgres-connections-high`       | conexiones `> 85 %` del límite               | warning   | 5m    | PostgreSQL > Uso de conexiones         |
| `sipeg-metrics-dependencies` | `sipeg-docker-service-not-running`      | contenedor con estado distinto de `running`  | warning   | 2m    | Docker > Estado por servicio           |
| `sipeg-metrics-dependencies` | `sipeg-docker-critical-service-missing` | faltan series de `api`, `db` o `cloudflared` | critical  | 2m    | Docker > Estado por servicio           |
| `sipeg-metrics-availability` | `sipeg-probe-failing`                   | `probe_success=0` o sin probes               | warning   | 2m    | Availability > Estado actual por probe |
| `sipeg-metrics-availability` | `sipeg-tls-expiring`                    | certificado público `< 7 días`               | warning   | 1h    | Availability > Certificado TLS público |
| `sipeg-metrics-availability` | `sipeg-api-latency-high`                | p95 `> 1 s` con más de 20 solicitudes/5m     | warning   | 10m   | API HTTP > Latencia p50, p95 y p99     |
| `sipeg-metrics-availability` | `sipeg-http-5xx-ratio`                  | 5xx `> 5 %` con más de 20 solicitudes/5m     | critical  | 5m    | API HTTP > Ratio 5xx                   |

Las reglas de latencia y 5xx exigen un mínimo de **20 solicitudes completadas en
cinco minutos** dentro de la misma consulta (`and on()` con
`sum(increase(...[5m])) > 20`), de modo que la falta de tráfico no se interprete
como un fallo. Las comparaciones de igualdad con cero usan `== bool 0` para que
un valor caído produzca `1` y la condición clásica `> 0` pueda dispararse. Las
reglas que detectan ausencia combinan `absent` con `vector(0)` donde hace falta
para que `noDataState: Alerting` no dispare con el sistema sano.

Los umbrales son valores operativos iniciales. Durante las primeras **48–72
horas** hay que observar el volumen de notificaciones, los falsos positivos, la
calidad de los datos y el coste de evaluación, y ajustar los umbrales y las
ventanas con evidencia de producción.

## Verificación

### Estado aplicado en Grafana

```bash
pnpm run observability:check
pnpm run observability:check -- --window 5
pnpm run observability:check -- --metrics --window 10
pnpm run observability:check -- --url http://127.0.0.1:3001
```

Requiere `GRAFANA_ADMIN_PASSWORD`. Habla con la UI de Grafana, no con Loki ni con
Prometheus directamente, y no modifica el stack.

Sin `--metrics` verifica el datasource Loki, las reglas de Loki, la ingesta JSON
y el contrato aplicado de `API Overview`.

Con `--metrics` añade:

- Datasource `prometheus` saludable.
- Jobs `node`, `sipeg-api`, `postgres`, `docker`, `blackbox`,
  `blackbox-internal`, `blackbox-public` y `prometheus` presentes y con `health`
  `up`; un target caído muestra su `lastError`.
- Métricas HTTP, de runtime, del host, PostgreSQL, Docker y probes esperadas.
- Los siete dashboards de Prometheus con UID y título correctos, datasource
  `prometheus` en todos los paneles, al menos una expresión por panel de datos y
  los fragmentos PromQL clave.
- Las 15 alertas de métricas por UID, con `condition` y una consulta contra
  `prometheus`, sin UIDs duplicados.

La ausencia de datos se reporta como fallo, nunca como cero. Si falla la
recolección de métricas, el comando imprime el error con la URL y el status (sin
el header `Authorization`) y termina con código 1.

### Lectura de las señales

| Señal                     | Qué mide                                                            | Qué no mide                                                                   |
| ------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `up{job="..."}`           | Que Prometheus pudo completar el scrape del target.                 | Que el servicio de negocio o su dependencia estén sanos.                      |
| `pg_up`                   | Que PostgreSQL Exporter pudo consultar PostgreSQL.                  | Que el scrape de Prometheus haya funcionado; si el exporter cae, desaparece.  |
| `probe_success`           | Que el probe funcional de Blackbox cumplió estado, contenido y TLS. | Que Prometheus haya alcanzado Blackbox; eso lo mide `up` del job `blackbox*`. |
| Serie ausente / sin datos | Que no hay una muestra en la ventana consultada.                    | Que el valor sea `0` o que el sistema esté sano.                              |

Un `up=1` con `pg_up=0` indica que Prometheus alcanza el exporter pero este no
conecta con PostgreSQL (credenciales, red o base caída). Un `up=1` con
`probe_success=0` indica que Blackbox respondió pero el probe falló. Si falta la
serie, revisar primero si el job existe, si el target está `up`, si el scrape
tiene `lastError` y si la muestra es fresca; no sustituir la ausencia por cero.

### Configuración de Prometheus

Con el stack de desarrollo:

```bash
docker compose -f compose.dev.yaml -f compose.observability.yaml \
  run --rm --no-deps --entrypoint /bin/promtool prometheus \
  check config /etc/prometheus/prometheus.yml
```

En producción, con los tres archivos Compose y `.env.prod`:

```bash
docker compose \
  -f compose.prod.yaml \
  -f compose.observability.yaml \
  -f compose.cloudflare.yaml \
  --env-file .env.prod \
  run --rm --no-deps --entrypoint /bin/promtool prometheus \
  check config /etc/prometheus/prometheus.yml
```

Los fixtures de `observability/prometheus/tests/queries.test.yml` cubren el ratio
5xx con y sin tráfico, el p95 del histograma, targets caídos y ausentes, la
antigüedad del timestamp de red, las conexiones de PostgreSQL, el estado de
Docker y `probe_success`. Las reglas de prueba usan el prefijo `test_` y viven en
`observability/prometheus/tests/queries.rules.yml`:

```bash
docker run --rm \
  -v "$PWD/observability/prometheus:/etc/prometheus:ro" \
  --entrypoint /bin/promtool prom/prometheus:v3.15.0 \
  test rules /etc/prometheus/tests/queries.test.yml
```

Con la misma imagen se valida la configuración de Prometheus:

```bash
docker run --rm \
  -v "$PWD/observability/prometheus:/etc/prometheus:ro" \
  --entrypoint /bin/promtool prom/prometheus:v3.15.0 \
  check config /etc/prometheus/prometheus.yml
```

### Recolector de red del host

```bash
bash deploy/host/metrics/collect-network.test.sh
sudo deploy/host/verify.sh
```

`verify.sh` comprueba el usuario y grupo `sipeg-metrics`, el script instalado,
los permisos del directorio y del `.prom`, el timer habilitado y activo, y que
el archivo tenga menos de tres minutos de antigüedad. Para inspeccionar el
último fallo sin imprimir secretos:

```bash
systemctl status sipeg-host-network-metrics.service
journalctl -u sipeg-host-network-metrics.service --since=-10min
```

### Configuración combinada de Compose

```bash
docker compose -f compose.dev.yaml -f compose.observability.yaml config --quiet
```

En producción se usa el mismo comando con los tres archivos y `--env-file
.env.prod`. No imprimir el contenido de `.env.prod`.

## Seguridad

- Ningún exporter publica puertos. Se usa `expose`, que es una declaración
  interna de la red de Compose.
- El listener de métricas de la API no se sirve por `3000` ni por Cloudflare
  Tunnel. `/metrics`, `/api/metrics` y `/api/v1/metrics` no deben existir en el
  listener de negocio.
- Las etiquetas se limitan a un catálogo cerrado. No se usan IDs de usuario o
  recurso, emails, IPs, tokens, query strings, cuerpos de solicitud ni datos
  personales.
- Las rutas HTTP se agrupan por plantilla (`/api/v1/activities/:id`), no por URL
  concreta.
- Telegraf no monta el socket de Docker, corre con `read_only: true`,
  `cap_drop: ALL`, `no-new-privileges` y `/tmp` como `tmpfs`. No exporta
  variables de entorno como etiquetas y elimina campos de alta cardinalidad como
  `container_id`, PID y timestamps de inicio/fin.
- El `docker-socket-proxy` conserva `POST=0` y solo habilita las operaciones de
  lectura necesarias. No se monta el socket de Docker directamente en Telegraf.
- No se usa cAdvisor ni host networking para los nuevos recolectores. El
  recolector de red corre como `sipeg-metrics`, con `ProtectSystem=strict`,
  `CapabilityBoundingSet=` vacío y escritura limitada al directorio del
  textfile; Node Exporter solo lo monta de solo lectura.
- El rol `sipeg_monitor` tiene `CONNECT` y `pg_monitor`, no es superusuario, no
  recibe privilegios de escritura y no puede modificar tablas de negocio. La
  contraseña se guarda en el HOST (`/etc/sipeg/secrets/postgres-monitor-password`,
  archivo `600` y directorio `0700`) y Compose la monta como secreto en
  `/run/secrets/postgres_monitor_password`; nunca está en texto claro en
  `.env.prod` ni en el repositorio.
- Blackbox Exporter no publica `/probe`: solo está en las redes internas
  `metrics` y `observability`, corre con `read_only: true`, `cap_drop: ALL`,
  `no-new-privileges` y `/tmp` como `tmpfs`, y monta su configuración de solo
  lectura. Prometheus es el único cliente de `/probe`.
- Los probes públicos mantienen la validación TLS (mínimo 1.2) y no siguen
  redirects inesperados. Los internos exigen HTTP plano dentro de la red Docker.
- No se registran ni se devuelven secretos, tokens, contraseñas, hashes ni
  cadenas de conexión.

## Limitaciones

- **Sin monitor externo.** Los probes se ejecutan desde el VPS. Una caída total
  del host, de Docker o del stack de observabilidad detiene Prometheus, Grafana y
  las notificaciones: no se genera ningún aviso. Un monitor externo queda como
  decisión posterior. Los probes públicos tampoco demuestran que Cloudflare esté
  sano desde otras ubicaciones: solo observan el recorrido desde este VPS.
- **Retención condicionada por tamaño.** Prometheus retiene 90 días o 2 GB, lo
  que ocurra primero. El límite de 2 GB puede reducir el histórico. Revisar el
  crecimiento de series y disco durante las primeras 48-72 horas.
- **Frescura de la red del host.** El recolector escribe cada 60 segundos. Si
  falla, conserva el último `.prom` y deja de avanzar
  `sipeg_host_network_collection_timestamp_seconds`. Los paneles y alertas deben
  comprobar ese timestamp, no solo `up{job="node"}`, para no presentar tráfico
  antiguo como actual.
- **Frescura de Docker.** Telegraf caduca las series a los 90 s. Si la entrada
  Docker falla pero Telegraf sigue vivo, `up{job="docker"}` puede continuar en
  `1` mientras las series de contenedores desaparecen. Los paneles deben
  comprobar la presencia y el valor de las series, no solo `up`.
- **Socket de Docker y `live-restore`.** Un reinicio del daemon conserva los
  contenedores, pero el bind mount de `/var/run/docker.sock` en
  `docker-socket-proxy` queda apuntando al inode anterior y el proxy responde 503. El drop-in de systemd reinicia proxy, Telegraf y Alloy despues de cada
  arranque de Docker; si se retira, hay que hacerlo a mano y verificar el health
  del proxy.
- **Cobertura de Docker según el cgroup.** La lista exacta de campos de memoria y
  blkio depende de lo que publique el cgroup del host. En cgroup v2 parte de las
  series de blkio puede faltar; `health_code` solo existe si el contenedor
  define `HEALTHCHECK`.
- **Health de la API.** Devuelve HTTP 200 aunque `authJwksReachable` sea `false`
  y no comprueba PostgreSQL. Los probes deben validar el contenido y `pg_up`
  cubre la base; un 200 aislado no demuestra salud funcional.
- **Presupuesto de memoria.** Los límites son techos, no reservas. La suma de
  límites ronda 4,7 GiB sobre una RAM física de 3,7 GiB. En la calibración del
  2026-10-20 el consumo observado de contenedores era ~1,2 GiB y el host tenía
  ~2,4 GiB disponibles; Telegraf alcanzó el 95% de su techo anterior y Grafana el
  99,97%, con eventos `memory.events:max` y memoria en swap. Los techos actuales
  son 256 MiB para Telegraf y 1 GiB para Grafana; validar los picos y que el host
  no entre en swap antes de considerarlos definitivos.
- **Probes desde un solo punto.** Los probes públicos distinguen el origen de
  Cloudflare mientras el VPS esté operativo, pero no sustituyen una observación
  externa independiente.
- **Cloudflare y Bot Fight Mode.** Los probes públicos salen desde la IP del VPS.
  Bot Fight Mode, el WAF o un rate limit del edge pueden responder con un
  challenge o una página HTML; los módulos `https_*` lo detectan como fallo por
  el estado, la regex de contenido o `<html`. Un `blackbox-public` en `0` con
  `blackbox-internal` en `1` apunta al recorrido público o al edge, no
  necesariamente al origen. Confirmar en Cloudflare antes de tratarlo como caída
  de la API. No se añade una regla que exima al probe de las protecciones del
  edge sin revisar el riesgo.
- **Fuentes y vistas incorporadas.** Las fases 2, 3, 4, 5 y 6 incorporaron la
  instrumentación HTTP y de runtime, el recolector de red del host, el exportador
  de PostgreSQL, las métricas de Docker y los probes de disponibilidad. La Fase 7
  añadió los siete dashboards, la Fase 8 las alertas de métricas y la Fase 9 el
  verificador `--metrics` con fixtures de PromQL. Que Prometheus alcance un
  target no significa que Grafana ya muestre sus datos.
- **Calibración pendiente de las alertas.** Los umbrales de métricas son
  iniciales y no se han validado con una línea base de producción de 48–72 horas.
  Hasta completar esa ventana, revisar el volumen de notificaciones y los falsos
  positivos antes de considerar los valores definitivos.

## Diagnóstico básico

1. Confirmar que los servicios están arriba:

   ```bash
   docker compose -f compose.dev.yaml -f compose.observability.yaml ps
   ```

2. Revisar los targets y el estado de los scrapes a través del proxy del
   datasource de Grafana:

   ```bash
   curl -sS -u "$GRAFANA_ADMIN_USER:$GRAFANA_ADMIN_PASSWORD" \
     "http://127.0.0.1:${GRAFANA_PORT:-3001}/api/datasources/proxy/uid/prometheus/api/v1/targets"
   ```

   Comprobar `up`, `scrapeUrl`, `lastError` y `lastScrape`. Un target accesible
   con una dependencia caída no es lo mismo que un target ausente.

3. Verificar la base y la disponibilidad cuando las fuentes estén incorporadas:

   ```promql
   up{job=~"node|sipeg-api|postgres|docker|blackbox|blackbox-internal|blackbox-public|prometheus"}
   pg_up
   probe_success
   sipeg_http_requests_total
   time() - sipeg_host_network_collection_timestamp_seconds
   ```

   Para PostgreSQL, `up{job="postgres"}` mide el scrape del exporter y `pg_up`
   su conexión con la base. Si una serie no existe, revisar primero si el job
   fue habilitado; no asumir `0` como ausencia de problemas.

4. Revisar logs de los recolectores sin imprimir secretos:

   ```bash
   docker compose -f compose.dev.yaml -f compose.observability.yaml \
     logs --tail=100 prometheus postgres-exporter telegraf blackbox-exporter
   ```

   Si `up{job="docker"}` es `1` pero no existen series `docker_*`, y
   `docker-socket-proxy` esta `unhealthy` con HAProxy devolviendo `503` y `SC--`
   incluso a `/_ping`, el bind mount quedo apuntando al socket anterior. Ocurre
   tras un reinicio del daemon de Docker con `live-restore: true`: los
   contenedores siguen vivos, pero el inode de `/var/run/docker.sock` cambio.
   Recrear el proxy y reiniciar Telegraf/Alloy:

   ```bash
   docker compose -f compose.prod.yaml -f compose.observability.yaml \
     -f compose.cloudflare.yaml --env-file .env.prod \
     up -d --force-recreate docker-socket-proxy
   docker compose -f compose.prod.yaml -f compose.observability.yaml \
     -f compose.cloudflare.yaml --env-file .env.prod \
     restart telegraf alloy
   ```

   El drop-in `/etc/systemd/system/docker.service.d/10-sipeg-consumers.conf`
   automatiza este reinicio despues de cada arranque de Docker.

5. Si la red del host no avanza, revisar el timer y el archivo sin crearlo a
   mano:

   ```bash
   sudo deploy/host/verify.sh
   systemctl status sipeg-host-network-metrics.timer
   journalctl -u sipeg-host-network-metrics.service --since=-10min
   ```

   Un `.prom` con más de tres minutos de antigüedad indica que la última
   recolección falló y que Node Exporter sigue publicando el último valor
   válido.

6. Si Grafana no muestra las fuentes nuevas, comprobar el datasource
   `prometheus`, la URL interna `http://prometheus:9090` y que el volumen
   `prometheus_data` esté montado.

7. Para un panel sin datos, distinguir: fuente no desplegada, target caído,
   scrape con error, retención insuficiente o consulta con etiquetas
   incorrectas. No sustituir datos ausentes por ceros de forma indiscriminada.

## Referencias

- `docs/adr/adr-0014-prometheus-metrics-and-dashboards.md`.
- `docs/adr/adr-0007-structured-logging-and-observability.md`.
- `docs/adr/adr-0012-cloudflare-workers-tunnel-deployment.md`.
- `docs/adr/adr-0013-vps-hardening-baseline.md`.
- `docs/superpowers/plans/2026-10-20-grafana-prometheus-dashboards.md`.
