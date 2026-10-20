# Diagrama de arquitectura de producción — Implementation Plan

> **For agentic workers:** Use `executing-plans` to implement this approved plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar un archivo draw.io editable con la arquitectura objetivo de producción de SIPEG UTP, incluyendo Cloudflare R2.

**Architecture:** Tres páginas de un único archivo XML nativo de draw.io separan la vista general, los contenedores y la observabilidad, y los flujos de archivos. La configuración Compose y la documentación del proyecto fundamentan los componentes existentes; R2 representa el diseño objetivo elegido expresamente por el usuario, no una integración ya desplegada.

**Tech Stack:** draw.io/mxGraph XML, Cloudflare Workers Static Assets, Cloudflare Tunnel, Cloudflare Access, Cloudflare R2, Docker Compose, Node.js/Express, Prisma/PostgreSQL, Grafana/Loki/Alloy/Prometheus y Brevo SMTP.

---

## Alcance y fuentes

- Crear: `docs/architecture/production-architecture.drawio`.
- Registrar y actualizar la ejecución en este documento.
- Usar como fuentes `compose.prod.yaml`, `compose.cloudflare.yaml`, `compose.observability.yaml`, `observability/prometheus/prometheus.yml`, `observability/alloy/config.alloy`, `observability/README.md`, `docs/despliegue.md`, ADR-0012, ADR-0014 y la Fase 6 de `docs/superpowers/plans/plan-maestro-sipeg-utp.md`.
- El frontend vive en otro repositorio; solo se representa su alojamiento y relación HTTP con la API.
- Etiquetas en español, contenedores anidados, formas editables, colores por zona, conexiones rotuladas y leyenda. No se necesitan imágenes externas ni dependencias nuevas.
- No se fija un dominio público de archivos todavía no elegido: usar «dominio personalizado».

### Task 1: Preparar el documento

- [x] Revisar el plan aprobado en la conversación, los cambios locales y las fuentes de despliegue.
- [x] Confirmar el formato: XML `.drawio` sin comprimir, con `mxfile`, tres elementos `diagram` y sus respectivos `mxGraphModel`.
- [x] Registrar el plan aprobado. Los cambios son exclusivamente documentales y no requieren TDD.

### Task 2: Vista general de producción

- [x] Dibujar navegador, administradores, Cloudflare y VPS OVH/Docker Compose como fronteras diferenciadas.
- [x] Representar Workers Static Assets en `sipeg-utp.com`; las solicitudes REST salen del navegador hacia `api.sipeg-utp.com`.
- [x] Representar `grafana.sipeg-utp.com` con Cloudflare Access y el login propio de Grafana.
- [x] Dibujar el túnel nombrado `sipeg-produccion` y el conector `cloudflared`: conexión saliente cifrada iniciada en el VPS y tráfico bidireccional.
- [x] Incluir API, PostgreSQL, observabilidad resumida, volúmenes, trabajos `migrate`/`seed` y Brevo SMTP para identidad y alertas.
- [x] Mostrar R2 externo al VPS, con conexión HTTPS independiente del túnel.

### Task 3: Contenedores y observabilidad

- [x] Mostrar los contenedores permanentes, los trabajos de despliegue y la persistencia local.
- [x] Representar el flujo lógico de logs Docker → proxy de socket de lectura → Alloy → Loki, con Grafana consultando Loki.
- [x] Dibujar las consultas de Prometheus a la API en `9464`, Node Exporter `9100`, PostgreSQL Exporter `9187`, Telegraf `9273` y Blackbox Exporter `9115`.
- [x] Mostrar el rol de PostgreSQL Exporter, las consultas Docker de Telegraf y los probes internos y públicos de Blackbox.
- [x] Documentar pertenencia a las redes `sipeg-utp-prod`, `observability`, `metrics`, `postgres-metrics` y `docker-api`, sin duplicar contenedores con varias redes.
- [x] Mostrar `postgres_data`, `loki_data`, `alloy_data`, `grafana_data`, `prometheus_data`, respaldos locales y puertos de diagnóstico loopback.

### Task 4: Archivos en Cloudflare R2

- [x] Dibujar la subida navegador → API → validación → R2 por HTTPS/S3 y la metadata en PostgreSQL.
- [x] Separar el bucket público de banners del bucket privado para CV, feedback y certificados.
- [x] Representar la entrega de banners por dominio personalizado y caché, y la descarga privada mediante URL GET firmada emitida después de autorización.
- [x] Identificar el endpoint S3 de R2 para las URLs firmadas, la expiración temporal y las credenciales solo en el backend.
- [x] Aclarar que R2 no requiere el túnel y que esta página describe la integración objetivo pendiente de implementación.

### Task 5: Verificar y entregar

- [x] Parsear con `xml.etree.ElementTree` de Python 3; comprobar tres páginas y raíces `0`/`1`.
- [x] Comprobar IDs únicos, existencia de padres y extremos de conexiones, geometría en nodos y conexiones y ausencia de comentarios XML.
- [x] Verificar contención de nodos, enlaces canónicos de las tres vistas y presencia de todos los servicios, redes y volúmenes acordados.
- [x] Ejecutar `git diff --check` sobre los dos archivos creados y revisar `git status --short` para confirmar el alcance.
- [x] Entregar la ruta del `.drawio` y explicar cómo abrir las tres páginas en diagrams.net.

## Verificación prevista

La validación documental empleará Python 3 y comprobaciones estructurales del XML, sin levantar contenedores ni consultar producción. Si el entorno dispone de draw.io Desktop, se puede abrir el archivo directamente; en este entorno no se encontró ese ejecutable ni un navegador gráfico. La entrega sigue siendo el archivo nativo editable, sin exigir una exportación a imagen.

## Resultado de la ejecución

- Archivo creado con tres páginas, 114 nodos editables y 56 conexiones.
- Python 3 validó XML, IDs únicos por página, extremos de conexiones, padres y ancestros comunes, geometrías, contención y ausencia de solapamientos entre nodos hermanos.
- Verificadas las relaciones principales de las tres vistas y la presencia de los 14 servicios Compose, las cinco redes y los cinco volúmenes persistentes.
- `git diff --check` pasó para los artefactos creados. También pasaron `git diff --no-index --check /dev/null docs/architecture/production-architecture.drawio` y `git diff --no-index --check /dev/null docs/superpowers/plans/2026-10-20-production-architecture-diagram.md`, que cubren archivos nuevos todavía no versionados.
- La verificación fue estructural; no se ejecutó una apertura gráfica en draw.io en este entorno.
