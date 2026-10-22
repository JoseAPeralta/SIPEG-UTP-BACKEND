# Dashboards de Grafana con Prometheus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disponer de una vista operativa de SIPEG que permita detectar problemas y relacionarlos con la API, Node.js, PostgreSQL, los contenedores y el VPS.

**Architecture:** Prometheus recolectará métricas de fuentes privadas. Grafana utilizará el datasource existente `prometheus` para los nuevos dashboards y mantendrá enlaces hacia los dashboards de logs de Loki.

**Tech Stack:** Prometheus, Grafana, Node Exporter, cliente oficial de Prometheus para Node.js, PostgreSQL Exporter, Telegraf y Blackbox Exporter.

---

**El plan cubre los siete dashboards propuestos**, desde la recolección de métricas hasta su despliegue, alertas y validación en producción.

Incorpora las siguientes decisiones:

- **Docker:** Telegraf mediante el proxy Docker de solo lectura.
- **Supervisión:** comprobaciones ejecutadas desde el stack del VPS.

---

## 1. Punto de partida confirmado

| Componente     | Estado actual                                                                     |
| -------------- | --------------------------------------------------------------------------------- |
| Prometheus     | Instalado; solo recolecta `node-exporter:9100` cada 60 segundos                   |
| Retención      | Configurada en 90 días y 2 GB; el límite de tamaño puede reducir el histórico     |
| Node Exporter  | Instalado con acceso al filesystem y PID del host                                 |
| Grafana        | Datasource `prometheus` provisionado                                              |
| Dashboards     | `API Overview`, `Errors` y `Security`, basados en Loki                            |
| Alertas        | Cinco de aplicación/seguridad y una de ocupación del disco                        |
| Notificaciones | Contacto de correo y política de notificación configurados                        |
| API            | Express 5 sobre Node.js 24, sin cliente de métricas instalado                     |
| Health         | Devuelve HTTP 200 aunque `authJwksReachable` sea `false`; no comprueba PostgreSQL |

Hay dos aspectos que condicionan la implementación:

1. **Node Exporter no comparte el namespace de red del host.** Las métricas de red deben verificarse antes de presentarlas como tráfico del VPS.
2. Los límites predeterminados de los servicios permanentes suman aproximadamente **3,75 GiB**. Es necesario medir consumo real y margen disponible antes de incorporar los nuevos recolectores.

---

## 2. Entregables

Se crearán estos dashboards:

| Dashboard                   | Archivo                                                     | UID estable                 |
| --------------------------- | ----------------------------------------------------------- | --------------------------- |
| **SIPEG · VPS Overview**    | `observability/grafana/dashboards/vps-overview.json`        | `sipeg-vps-overview`        |
| **SIPEG · API HTTP**        | `observability/grafana/dashboards/api-http.json`            | `sipeg-api-http`            |
| **SIPEG · Node.js Runtime** | `observability/grafana/dashboards/nodejs-runtime.json`      | `sipeg-nodejs-runtime`      |
| **SIPEG · PostgreSQL**      | `observability/grafana/dashboards/postgres-overview.json`   | `sipeg-postgres-overview`   |
| **SIPEG · Docker**          | `observability/grafana/dashboards/docker-overview.json`     | `sipeg-docker-overview`     |
| **SIPEG · Availability**    | `observability/grafana/dashboards/availability.json`        | `sipeg-availability`        |
| **SIPEG · Operations**      | `observability/grafana/dashboards/operations-overview.json` | `sipeg-operations-overview` |

También se entregarán:

- Instrumentación HTTP y Node.js.
- Configuración de recolección, redes y exportadores.
- Alertas provisionadas.
- Verificador automatizado de métricas y dashboards aplicados.
- Documentación de instalación, diagnóstico y reversión.

---

## 3. Diseño de la recolección

### Fuentes y frecuencia inicial

| Job                 | Fuente                                |    Puerto interno | Intervalo |
| ------------------- | ------------------------------------- | ----------------: | --------: |
| `node`              | Node Exporter                         |              9100 |      60 s |
| `sipeg-api`         | Listener privado del proceso Node.js  |              9464 |      30 s |
| `postgres`          | PostgreSQL Exporter                   |              9187 |      60 s |
| `docker`            | Telegraf                              |              9273 |      30 s |
| `blackbox`          | Métricas del propio Blackbox Exporter |              9115 |      60 s |
| `blackbox-internal` | Probes de servicios internos          | Mediante `/probe` |      30 s |
| `blackbox-public`   | Probes de la API mediante Cloudflare  | Mediante `/probe` |      30 s |
| `prometheus`        | Métricas del propio Prometheus        |              9090 |      60 s |

### Conectividad

La ampliación se concentrará en `compose.observability.yaml`:

- **`observability`:** comunicación de Grafana con Prometheus y Loki; salida de los probes públicos.
- **`metrics`:** red privada para Prometheus, API y recolectores.
- **`postgres-metrics`:** comunicación exclusiva entre PostgreSQL y su exporter.
- **`docker-api`:** comunicación del proxy Docker con Alloy y Telegraf.

El listener de métricas de la API escuchará en `9464` dentro del contenedor. Cloudflare Tunnel continuará alcanzando el listener HTTP de negocio en `3000`.

La verificación de Compose comprobará que las redes añadidas por el overlay conservan las conexiones necesarias para API, base de datos y túnel.

---

# 4. Fases de implementación

## Fase 0. Inventario y presupuesto de recursos

**Objetivo:** fijar una configuración viable para el VPS antes de ampliar la recolección.

**Archivos:**

- Crear: `docs/adr/adr-0014-prometheus-metrics-and-dashboards.md`.
- Crear: `observability/README.md`.
- Modificar: `.env.example`.
- Modificar: `.env.prod.example`.

### Pasos

- [ ] Registrar RAM, vCPU, almacenamiento, versión de Docker y versión de cgroups.
- [ ] Medir consumo por servicio y memoria disponible durante operación normal.
- [ ] Revisar el espacio ocupado por PostgreSQL, Loki, Prometheus y backups.
- [ ] Confirmar imágenes compatibles con `linux/amd64`.
- [ ] Obtener y fijar los digests de los nuevos contenedores.
- [ ] Documentar fuentes, redes, intervalos y presupuesto inicial.

Versiones base consultadas para la incorporación:

| Componente                              | Versión base |
| --------------------------------------- | ------------ |
| Cliente Node.js `@prometheus-io/client` | `0.16.1`     |
| PostgreSQL Exporter                     | `v0.20.1`    |
| Telegraf                                | `1.40.2`     |
| Blackbox Exporter                       | `v0.29.0`    |

Las imágenes deberán quedar fijadas como `repositorio:tag@sha256:digest`.

### Presupuesto inicial para validar

| Nuevo servicio      | Límite inicial de memoria |
| ------------------- | ------------------------: |
| PostgreSQL Exporter |                    64 MiB |
| Telegraf            |                   128 MiB |
| Blackbox Exporter   |                    64 MiB |

La instrumentación de Node.js utilizará el presupuesto del contenedor API.

**Criterio de salida:** registrar el margen real del host y aprobar límites que permitan ejecutar también despliegues y tareas operativas habituales.

---

## Fase 1. Preparar redes y configuración de Prometheus

**Objetivo:** disponer de conectividad privada y configuración validada para las nuevas fuentes.

**Archivos:**

- Modificar: `compose.observability.yaml`.
- Modificar: `observability/prometheus/prometheus.yml`.
- Modificar: `observability/grafana/provisioning/datasources/prometheus.yaml`.

### Pasos

- [ ] Añadir las redes de métricas, PostgreSQL y acceso al proxy Docker.
- [ ] Conectar Alloy y Telegraf al proxy por `docker-api`.
- [ ] Añadir el scrape de Prometheus a sí mismo.
- [ ] Incorporar progresivamente los jobs de cada fase.
- [ ] Montar `observability/prometheus/` como directorio de configuración de solo lectura.
- [ ] Definir timeouts inferiores a los intervalos de scrape.
- [ ] Añadir límites de muestras por scrape según el inventario medido.
- [ ] Configurar `jsonData.timeInterval: 60s` en el datasource de Grafana.

Para los paneles de jobs recolectados cada 30 segundos se configurará **Min step de 30 s**. Las tasas utilizarán `$__rate_interval`.

### Verificaciones

- Compose combinado válido en desarrollo y producción.
- `promtool check config` satisfactorio.
- Ningún exporter publica un puerto al host.
- Grafana puede consultar Prometheus.
- Los jobs incorporados aparecen con las etiquetas esperadas.

**Criterio de salida:** cada fuente habilitada es alcanzable únicamente por las conexiones previstas y sus scrapes terminan correctamente.

---

## Fase 2. Instrumentar HTTP y Node.js

**Objetivo:** medir tráfico, errores, latencia y recursos del proceso API.

### Archivos

**Crear:**

- `src/observability/metrics.ts`.
- `src/observability/metrics.test.ts`.
- `src/config/metrics.ts`.
- `src/config/metrics.test.ts`.
- `src/middlewares/httpMetrics.middleware.ts`.
- `src/middlewares/httpMetrics.middleware.test.ts`.
- `src/observability/metrics.server.ts`.
- `src/observability/metrics.server.test.ts`.

**Modificar:**

- `package.json`.
- `pnpm-lock.yaml`.
- `src/config/env.ts`.
- `src/config/env.test.ts`.
- `src/app.ts`.
- `src/app.test.ts`.
- `src/server.ts`.
- `src/server.test.ts`.
- `vitest.config.ts`.
- `compose.observability.yaml`.
- Las dos plantillas de entorno.

### 2.1. Contrato de métricas

| Métrica                               | Tipo      | Etiquetas variables                                         |
| ------------------------------------- | --------- | ----------------------------------------------------------- |
| `sipeg_http_requests_total`           | Counter   | `method`, `route`, `status_code`, `request_kind`, `outcome` |
| `sipeg_http_request_duration_seconds` | Histogram | `method`, `route`, `request_kind`, `outcome`                |
| `sipeg_http_requests_in_flight`       | Gauge     | Ninguna                                                     |

Buckets iniciales, en segundos:

```text
0.005, 0.01, 0.025, 0.05, 0.1, 0.25,
0.5, 1, 2.5, 5, 10
```

Reglas del contrato:

- Rutas agrupadas como `/api/v1/activities/:id`.
- Métodos limitados a un catálogo cerrado y `OTHER`.
- `request_kind`: `matched`, `preflight` o `unmatched`.
- `outcome`: `completed` o `aborted`.
- Aborto sin cabeceras enviadas: `status_code="none"`.
- Una sola observación terminal por solicitud.
- Duraciones medidas en segundos.
- Registry propio compartido por middleware y listener.

Se aprovechará `routeTemplate()` de:

`src/middlewares/requestLogger.middleware.ts`

El orden de montaje será:

```text
requestLogger → httpMetrics → Helmet → CORS → rutas → errores
```

### 2.2. Métricas del runtime

Activar una sola vez los colectores oficiales para:

- CPU del proceso.
- Memoria RSS.
- Heap usado y asignado.
- Memoria externa.
- Duración y frecuencia de GC.
- Retraso del event loop.
- Inicio del proceso y versión de Node.js.

### 2.3. Listener privado

Variables del backend:

| Variable          | Valor predeterminado fuera de Compose |
| ----------------- | ------------------------------------- |
| `METRICS_ENABLED` | `false`                               |
| `METRICS_HOST`    | `127.0.0.1`                           |
| `METRICS_PORT`    | `9464`                                |

El overlay habilitará el listener en `0.0.0.0:9464` dentro del contenedor.

Contrato:

| Solicitud                 | Resultado             |
| ------------------------- | --------------------- |
| `GET /metrics`            | Exposición Prometheus |
| `HEAD /metrics`           | Cabeceras sin cuerpo  |
| Otro método en `/metrics` | 405                   |
| Otra ruta                 | 404                   |
| Error de recolección      | 500 genérico          |

Las respuestas utilizarán el `Content-Type` del Registry y `Cache-Control: no-store`.

### 2.4. Ciclo de vida

- [ ] Coordinar el arranque de ambos listeners.
- [ ] Resolver la promesa de arranque cuando estén escuchando.
- [ ] Cerrar el listener iniciado si falla el segundo.
- [ ] Drenar ambos servidores en SIGINT/SIGTERM.
- [ ] Desconectar Prisma una sola vez.
- [ ] Mantener el deadline global de cierre de 10 segundos.
- [ ] Hacer el cierre idempotente ante señales repetidas.

### Verificación mediante TDD

Escribir y ejecutar primero las pruebas que demuestren:

- Dos IDs de una misma ruta generan una sola serie.
- `finish` y `close` no duplican el contador.
- El gauge vuelve a cero después de éxito, error y aborto.
- Se cuentan 401, 403, 404, 413, 429 y 500.
- Las solicitudes rechazadas antes del router se clasifican correctamente.
- Un scrape no incrementa el tráfico HTTP de negocio.
- El listener público no expone `/metrics`, `/api/metrics` ni `/api/v1/metrics`.
- El listener privado no sirve rutas de negocio.
- Los fallos de arranque y cierre se resuelven correctamente.

**Criterio de salida:** métricas HTTP y runtime presentes, sin IDs, query strings, tokens ni datos personales; target `sipeg-api` saludable.

---

## Fase 3. Validar y completar las métricas del VPS

**Objetivo:** que el dashboard represente el host real.

### Archivos

- Modificar: `compose.observability.yaml`.
- Modificar: `deploy/host/install.sh`.
- Modificar: `deploy/host/verify.sh`.
- Crear: `deploy/host/metrics/collect-network.sh`.
- Crear: `deploy/host/metrics/sipeg-host-network-metrics.service`.
- Crear: `deploy/host/metrics/sipeg-host-network-metrics.timer`.
- Crear: `src/observability/hostMetrics.test.ts`.

### Pasos

- [ ] Comparar CPU, memoria, swap, filesystem e I/O con observaciones del host.
- [ ] Confirmar que `mountpoint="/"` corresponde al disco del VPS.
- [ ] Identificar las interfaces físicas utilizadas.
- [ ] Recoger los contadores de red desde el host mediante un timer.
- [ ] Publicarlos mediante el textfile collector de Node Exporter.
- [ ] Utilizar escritura atómica del archivo `.prom`.
- [ ] Añadir timestamp del último éxito para detectar datos antiguos.
- [ ] Usar esos contadores para el panel de red del VPS.

Métricas propuestas:

```text
sipeg_host_network_receive_bytes_total{device="..."}
sipeg_host_network_transmit_bytes_total{device="..."}
sipeg_host_network_collection_timestamp_seconds
```

El servicio se ejecutará con un usuario dedicado, permisos de escritura únicamente sobre su directorio de salida y una periodicidad de 60 segundos.

### Verificaciones

- Parseo correcto de un fixture de `/proc/net/dev`.
- Exclusión de interfaces virtuales seleccionadas.
- Archivo anterior conservado si falla la lectura.
- Timestamp actualizado solo tras una recolección correcta.
- Archivo legible por Node Exporter.
- Detección de más de tres minutos sin actualización.

**Criterio de salida:** los paneles del VPS tienen una fuente contrastada y el tráfico de red corresponde al host.

---

## Fase 4. Incorporar PostgreSQL Exporter

**Objetivo:** observar el servidor PostgreSQL con una identidad de monitorización dedicada.

### Archivos

- Modificar: `compose.observability.yaml`.
- Modificar: `observability/prometheus/prometheus.yml`.
- Modificar: `.env.example`.
- Modificar: `.env.prod.example`.
- Crear: `deploy/observability/provision-postgres-monitor.sh`.

### Pasos

- [ ] Crear idempotentemente el rol `sipeg_monitor`.
- [ ] Conceder `CONNECT` y `pg_monitor`.
- [ ] Configurar límite de conexiones y timeout de consultas para el rol.
- [ ] Proporcionar la contraseña por archivo.
- [ ] Conectar exporter y DB mediante `postgres-metrics`.
- [ ] Activar los colectores necesarios para PostgreSQL 18.
- [ ] Establecer `PG_EXPORTER_COLLECTION_TIMEOUT=5s`.
- [ ] Configurar el job `postgres`.

Para la versión `v0.20.1` se utilizarán las opciones documentadas de esa versión, incluyendo `DATA_SOURCE_PASS_FILE`.

El aprovisionamiento deberá funcionar sobre el volumen existente; los scripts de `initdb.d` solo se ejecutan al inicializar una base nueva.

### Métricas requeridas

- `pg_up`.
- Conexiones y límite del servidor.
- Sesiones por estado.
- Transacciones confirmadas y revertidas.
- Bloqueos y deadlocks.
- Bytes temporales.
- Tamaño de la base.
- Estadísticas de caché disponibles.

### Verificaciones

En una base aislada:

- El rol puede leer las estadísticas necesarias.
- No puede modificar tablas de negocio.
- El exporter no produce errores de permisos.
- Al perder acceso a PostgreSQL, `pg_up` refleja el fallo.
- Se distingue `up` del exporter de `pg_up` de la base.

**Criterio de salida:** estadísticas reales de PostgreSQL disponibles y credencial de monitorización operativa.

---

## Fase 5. Incorporar Telegraf para Docker

**Objetivo:** recoger consumo y estado de los contenedores mediante el proxy existente.

### Archivos

- Crear: `observability/telegraf/telegraf.conf`.
- Crear: `observability/telegraf/docker.star`.
- Modificar: `compose.observability.yaml`.
- Modificar: `observability/prometheus/prometheus.yml`.
- Modificar: las plantillas de entorno para los límites del servicio.

### Configuración

- [ ] Entrada Docker apuntando a `tcp://docker-socket-proxy:2375`.
- [ ] Recolección cada 30 segundos.
- [ ] Salida Prometheus en `:9273`.
- [ ] Filtrado de contenedores por proyecto SIPEG.
- [ ] Allowlist de etiquetas Compose de proyecto y servicio.
- [ ] Exportación de strings como labels deshabilitada.
- [ ] Eliminación de campos como `container_id` y PID.
- [ ] Normalización de estados y health a valores numéricos.
- [ ] Caducidad de métricas en caché de 90 segundos.
- [ ] Configuración de tipos counter para contadores acumulados.
- [ ] Conservación del instante de recolección para comprobar frescura.

### Datos que se expondrán

- CPU total.
- Memoria utilizada y límite.
- Tráfico de red.
- Lectura y escritura de bloques.
- Estado del contenedor.
- Health, cuando exista `HEALTHCHECK`.
- `restart_count` del contenedor actual.
- OOM registrado.
- Instante de inicio y uptime.

La normalización producirá, entre otras:

```text
docker_container_status_state_code
docker_container_health_health_code
```

`restart_count` se presentará como **reinicios del contenedor actual**, porque vuelve a empezar al recrearlo.

### Verificaciones

- Telegraf negocia correctamente la API de Docker del VPS.
- Alloy continúa leyendo logs.
- El proxy conserva bloqueadas las operaciones de mutación.
- No aparecen variables de entorno como etiquetas.
- Un contenedor detenido cambia de estado.
- Un servicio eliminado se detecta como ausente.
- Una interrupción de la entrada Docker no deja datos antiguos presentados como actuales.
- `migrate` y `seed` con salida 0 se reconocen como trabajos completados.

**Criterio de salida:** consumo y estado contrastados con Docker, con series de baja cardinalidad y frescura verificable.

---

## Fase 6. Incorporar probes de disponibilidad

**Objetivo:** distinguir el estado del origen del acceso mediante Cloudflare.

### Archivos

- Crear: `observability/blackbox/blackbox.yml`.
- Modificar: `compose.observability.yaml`.
- Modificar: `observability/prometheus/prometheus.yml`.

### Probes previstos

| Comprobación                     | Target                                        |
| -------------------------------- | --------------------------------------------- |
| Health HTTP interno              | `http://api:3000/api/v1/health`               |
| Estado JWKS reportado por health | Mismo endpoint, validando `authJwksReachable` |
| JWKS interno                     | `http://api:3000/api/auth/jwks`               |
| Health público                   | `https://api.sipeg-utp.com/api/v1/health`     |
| JWKS público                     | `https://api.sipeg-utp.com/api/auth/jwks`     |
| Grafana interno                  | `http://grafana:3000/api/health`              |

### Pasos

- [ ] Validar códigos HTTP esperados.
- [ ] Validar contenido JSON y campos identificadores.
- [ ] Comprobar que JWKS contiene claves.
- [ ] Configurar timeout de cinco segundos.
- [ ] Mantener validación TLS.
- [ ] Deshabilitar seguimiento de redirects en las comprobaciones que deban responder directamente.
- [ ] Añadir etiquetas estables `check` y tipo de recorrido.
- [ ] Recoger duración, fases HTTP y vencimiento TLS.

### Verificaciones

- HTML con HTTP 200 no pasa como health válido.
- `authJwksReachable=false` hace fallar la comprobación funcional correspondiente.
- Fallo del origen y fallo del recorrido público se distinguen.
- Un redirect inesperado se detecta.

**Cobertura acordada:** estos probes se ejecutan desde el VPS. Una caída completa del host interrumpe también Prometheus, Grafana y sus notificaciones.

---

## Fase 7. Crear los siete dashboards

**Objetivo:** convertir las métricas verificadas en vistas operativas útiles.

### Convenciones comunes

- Carpeta existente: **SIPEG UTP**.
- Datasource explícito: UID `prometheus`.
- UIDs e IDs de panel estables.
- Títulos y descripciones en español.
- `America/Panama` (UTC-05:00, sin DST) en todos los dashboards (ADR-0002); las series se almacenan en UTC.
- Ventana inicial de seis horas.
- Refresco de 30 segundos; VPS puede usar 60 segundos.
- Unidades explícitas: segundos, bytes, bytes/s y porcentajes.
- Variables de instancia y filtros propios de cada fuente.
- Enlaces entre resumen, detalle y dashboards de Loki.
- Estados diferenciados: **saludable, fallo, sin tráfico y sin datos**.

### Contenido por dashboard

| Dashboard           | Paneles principales                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **VPS Overview**    | CPU, RAM, swap, disco, inodos, I/O, red del host, uptime, carga y estado de recolección                                        |
| **API HTTP**        | Solicitudes, RPS, 5xx, p50/p95/p99, estados, frecuencia por método/ruta, solicitudes en curso, abortos y tráfico técnico       |
| **Node.js Runtime** | CPU del proceso, RSS, heap, memoria externa, GC, event loop, inicio del proceso y estado del target                            |
| **PostgreSQL**      | Disponibilidad, conexiones/límite, sesiones por estado, transacciones, rollbacks, locks, deadlocks, temporales, tamaño y caché |
| **Docker**          | Estado por servicio, CPU, memoria/límite, red, I/O, reinicios del contenedor actual, OOM y health                              |
| **Availability**    | Origen y borde, JWKS, Grafana interno, duración de probes, códigos HTTP, TLS, disponibilidad observada y cobertura de muestras |
| **Operations**      | Estado conjunto, alertas, recursos críticos, tráfico, 5xx, p95, conexiones DB, servicios Docker y enlaces de diagnóstico       |

### Consultas de referencia

**CPU del VPS:**

```promql
100 * (
  1 - avg by (instance) (
    rate(node_cpu_seconds_total{
      job="node",
      mode="idle"
    }[$__rate_interval])
  )
)
```

**Memoria utilizada:**

```promql
100 * (
  1 -
  node_memory_MemAvailable_bytes{job="node"}
  /
  node_memory_MemTotal_bytes{job="node"}
)
```

**RPS de operaciones de negocio:**

```promql
sum by (method, route) (
  rate(sipeg_http_requests_total{
    job="sipeg-api",
    outcome="completed",
    request_kind="matched",
    route=~"/api/v1/.*",
    route!="/api/v1/health"
  }[$__rate_interval])
)
```

**p95 por operación:**

```promql
histogram_quantile(
  0.95,
  sum by (le, method, route) (
    rate(sipeg_http_request_duration_seconds_bucket{
      job="sipeg-api",
      outcome="completed",
      request_kind="matched",
      route=~"/api/v1/.*",
      route!="/api/v1/health"
    }[$__rate_interval])
  )
)
```

Los mismos filtros se aplicarán al numerador y denominador del porcentaje de 5xx.

### Reglas de interpretación

- Los percentiles se calcularán a partir de buckets agregados.
- La CPU de Node.js se distinguirá de la CPU del host.
- La memoria RSS se distinguirá de la memoria del contenedor.
- Los ceros no sustituirán indiscriminadamente a datos ausentes.
- El estado global comprobará todas las fuentes esperadas: `min(up)` por sí solo no detecta un job eliminado.
- La disponibilidad histórica mostrará cobertura de muestras junto al porcentaje observado.

**Criterio de salida:** los siete dashboards cargan y sus consultas se ejecutan contra datos reales, con unidades y estados correctos.

---

## Fase 8. Provisionar alertas

**Objetivo:** acompañar los dashboards con avisos accionables.

### Archivos

- Crear: `observability/grafana/provisioning/alerting/metrics.yaml`.
- Modificar: `observability/grafana/provisioning/alerting/rules.yaml`.
- Modificar: `observability/grafana/provisioning/alerting/notification-policies.yaml`.

### Umbrales iniciales

Son valores operativos de partida, sujetos a calibración con producción.

| Condición                       | Umbral inicial                         | Persistencia |
| ------------------------------- | -------------------------------------- | ------------ |
| Target esperado caído o ausente | Fallo de recolección                   | 2 min        |
| Red del host sin actualizar     | Más de 3 min                           | 2 min        |
| CPU del VPS                     | Más de 90 %                            | 15 min       |
| Memoria disponible              | Menos de 10 %                          | 10 min       |
| Disco, warning existente        | Más de 80 %                            | 15 min       |
| Disco crítico                   | Más de 90 %                            | 10 min       |
| Inodos disponibles              | Menos de 10 %                          | 15 min       |
| PostgreSQL                      | `pg_up=0` o ausente                    | 2 min        |
| Conexiones PostgreSQL           | Más de 85 % del límite                 | 5 min        |
| Servicio permanente Docker      | Ausente o estado no operativo          | 2 min        |
| Probe funcional                 | `probe_success=0` o ausente            | 2 min        |
| Certificado público             | Menos de 7 días                        | 1 h          |
| Latencia API                    | p95 superior a 1 s, con tráfico mínimo | 10 min       |
| Errores API                     | Más de 5 % de 5xx, con tráfico mínimo  | 5 min        |

Para las alertas HTTP se exigirá inicialmente un mínimo de **20 solicitudes completadas en cinco minutos**.

### Pasos

- [ ] Asignar UID, severidad, componente, dashboard y panel a cada regla.
- [ ] Diferenciar falta de tráfico de fallo de ingestión.
- [ ] Detectar tanto `up=0` como targets esperados ausentes.
- [ ] Agrupar notificaciones por componente y severidad.
- [ ] Añadir descripción y procedimiento breve de diagnóstico.
- [ ] Comprobar notificación y resolución por correo.
- [ ] Tras validar el porcentaje de errores, actualizar `sipeg-5xx` conservando su UID para utilizar la condición porcentual.

**Criterio de salida:** reglas evaluadas sin errores y prueba controlada de activación/resolución satisfactoria.

---

## Fase 9. Automatizar las verificaciones

**Objetivo:** comprobar exposición, ingestión y visualización.

### Archivos

- Crear: `src/observability/metrics.check.ts`.
- Crear: `src/observability/metrics.check.test.ts`.
- Crear: `observability/prometheus/tests/queries.test.yml`.
- Modificar: `src/observability/check.ts`.
- Modificar: `src/observability/check.test.ts`.
- Modificar: `src/observability/dashboard.test.ts`.
- Modificar: `tsconfig.build.json`.

### Verificador de observabilidad

Añadir el modo:

```bash
pnpm run observability:check --metrics --window 10
```

Deberá comprobar:

1. Datasource Prometheus saludable.
2. Jobs y targets esperados presentes.
3. Muestras recientes.
4. Métricas HTTP y runtime disponibles.
5. Métricas de PostgreSQL y Docker presentes.
6. Estado y frescura de probes.
7. Dashboards y datasource correctos.
8. Consultas ejecutables.
9. Alertas provisionadas y evaluándose.

El verificador existente deberá localizar grupos de alertas por identidad y admitir los nuevos grupos.

### Casos negativos

Las pruebas reproducirán:

- Target accesible con dependencia caída.
- Target eliminado de la configuración.
- Exporter activo con métricas antiguas.
- Datasource inaccesible.
- Consulta PromQL inválida.
- Métrica con nombre incorrecto.
- Ausencia de tráfico de negocio.
- Reinicio de contadores.
- Referencias de dashboard/panel incorrectas.

Las consultas con tasas, proporciones y ausencia de datos tendrán fixtures evaluados mediante `promtool test rules`.

### Comandos de verificación

Durante el ciclo TDD, ejecutar primero las pruebas focalizadas. Al cerrar los cambios:

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm run build
pnpm run docs:check
```

Para la configuración de Prometheus, desde un stack de pruebas:

```bash
docker compose -f compose.dev.yaml -f compose.observability.yaml \
  run --rm --no-deps --entrypoint /bin/promtool prometheus \
  check config /etc/prometheus/prometheus.yml
```

```bash
docker compose -f compose.dev.yaml -f compose.observability.yaml \
  run --rm --no-deps --entrypoint /bin/promtool prometheus \
  test rules /etc/prometheus/tests/queries.test.yml
```

**Criterio de salida:** verificaciones estáticas, pruebas de comportamiento y comprobaciones del stack satisfactorias.

---

## Fase 10. Despliegue, calibración y documentación

### Documentación

Actualizar:

- `observability/README.md`.
- `README.md`.
- `CONTEXT.md`.
- `AGENTS.md`.
- `deploy/README.md`.
- `docs/despliegue.md`.
- `docs/adr/adr-0007-structured-logging-and-observability.md`.
- `docs/adr/adr-0012-cloudflare-workers-tunnel-deployment.md`.
- `docs/adr/adr-0013-vps-hardening-baseline.md`.

La documentación incluirá el catálogo de métricas, puertos, redes, interpretación de paneles, alertas y procedimientos de diagnóstico.

### Orden de despliegue

- [ ] Validar el stack completo en un entorno aislado.
- [ ] Registrar la configuración e imagen anterior.
- [ ] Preparar el archivo de credenciales de monitorización PostgreSQL.
- [ ] Aprovisionar el rol de monitorización.
- [ ] Instalar y verificar el recolector de red del host.
- [ ] Aplicar las redes y recrear los servicios afectados.
- [ ] Desplegar la API con un `IMAGE_TAG` nuevo.
- [ ] Levantar los exportadores y actualizar Prometheus.
- [ ] Recrear Grafana para aplicar datasource y alertas.
- [ ] Ejecutar el verificador automatizado.
- [ ] Revisar visualmente los siete dashboards.
- [ ] Comprobar envío y resolución de una alerta controlada.

La primera activación deberá contemplar una ventana de mantenimiento: añadir una red a PostgreSQL puede requerir recrear su contenedor.

### Calibración

Durante las primeras **48–72 horas** observar:

- RAM y CPU de cada recolector.
- Duración y errores de scrape.
- Número de series activas.
- Crecimiento de almacenamiento de Prometheus.
- Latencia y errores de la API.
- Calidad de los umbrales y volumen de notificaciones.

Con esos datos se ajustarán límites, filtros y retención.

### Reversión

El procedimiento deberá:

1. Restaurar la imagen anterior de la API y la configuración anterior de Compose.
2. Retirar los nuevos recolectores del despliegue.
3. Restaurar los scrapes anteriores.
4. Retirar los JSON de dashboards añadidos mediante el provisioning.
5. Eliminar las nuevas reglas usando `deleteRules` de Grafana y restaurar la definición anterior de `sipeg-5xx`.
6. Desactivar el timer del recolector de red.
7. Conservar los volúmenes de PostgreSQL, Prometheus y Grafana.

---

## 5. Criterios de aceptación globales

La implementación estará terminada cuando:

- [ ] Los siete dashboards se provisionen automáticamente.
- [ ] Todas las fuentes esperadas estén presentes y tengan datos recientes.
- [ ] CPU, memoria, disco y red representen el host o proceso indicado.
- [ ] Las rutas HTTP estén normalizadas.
- [ ] No haya datos sensibles en métricas ni etiquetas.
- [ ] `/metrics` sea accesible mediante el listener privado.
- [ ] Los fallos de origen y del recorrido por Cloudflare se distingan.
- [ ] Las fuentes ausentes no aparezcan como saludables.
- [ ] Las alertas se activen y resuelvan correctamente.
- [ ] El consumo adicional sea sostenible para el VPS.
- [ ] Las pruebas, build y verificaciones operativas pasen.
- [ ] El despliegue y la reversión estén documentados.

## Orden recomendado de entrega

**1. Base privada y VPS → 2. API y Node.js → 3. PostgreSQL → 4. Docker → 5. Disponibilidad → 6. Resumen operativo y alertas → 7. Producción y calibración.**

Este orden permite obtener un dashboard útil desde la primera entrega y construir el resumen operativo cuando las fuentes individuales ya estén verificadas.

### Referencias técnicas consultadas

- [Cliente oficial de Prometheus para Node.js](https://github.com/prometheus/client_js/tree/v0.16.1).
- [Telegraf: entrada Docker](https://github.com/influxdata/telegraf/blob/v1.40.2/plugins/inputs/docker/README.md).
- [PostgreSQL Exporter](https://github.com/prometheus-community/postgres_exporter/tree/v0.20.1).
- [Blackbox Exporter](https://github.com/prometheus/blackbox_exporter/blob/v0.29.0/CONFIGURATION.md).
- [Grafana: intervalos y variables de Prometheus](https://grafana.com/docs/grafana/latest/datasources/prometheus/template-variables/).
