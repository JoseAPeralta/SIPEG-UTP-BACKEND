---
title: 'ADR-0013: Linea base de endurecimiento del VPS de produccion'
status: 'Accepted'
date: '2026-10-07'
authors: 'Equipo backend SIPEG UTP'
tags: ['architecture', 'security', 'operations']
supersedes: ''
superseded_by: ''
---

# ADR-0013: Linea base de endurecimiento del VPS de produccion

## Status

**Accepted** — implementada y verificada en produccion el 2026-10-20.

## Context

El despliegue de SIPEG UTP vive en un VPS OVH (Ubuntu 26.04 LTS) con Docker
Compose, PostgreSQL 18 y un stack de observabilidad autogestionado. La entrada
publica es Cloudflare Tunnel: no hay puertos entrantes de aplicacion. Hasta
ahora el repositorio no versionaba ninguna configuracion del host: SSH, firewall,
parches, auditoria, limites de contenedores y backups quedaban al criterio de
quien administraba la maquina, sin verificacion repetible ni rollback.

El sistema trata datos personales (identidades, asistencia, CV de ponentes), por
lo que la perdida de datos o el acceso no autorizado al host tienen impacto
directo. Las decisiones pendientes del documento de despliegue (#10 backup,
acceso a Grafana) seguian abiertas.

## Decision

Versionar en `deploy/` una linea base de endurecimiento aplicable con un
instalador idempotente y verificable:

- **SSH**: solo claves (`AuthenticationMethods publickey`), sin root, sin
  password, `AllowGroups sudo`, limite de intentos; fail2ban con backend
  systemd. El 22 queda publico y limitado por UFW.
- **Firewall**: UFW con `deny incoming` y `allow outgoing`; 22 restringido por
  CIDR si existe o con limite de tasa. Docker no publica nada en `0.0.0.0`.
- **Parches**: unattended-upgrades con el origen de Docker y reboot programado
  a las 03:00 America/Panama; needrestart automatico; journald acotado.
- **Kernel**: sysctl de hardening, core dumps deshabilitados, `rp_filter` loose
  por Docker, sin tocar `ip_forward`.
- **Docker**: `no-new-privileges` global, `live-restore`, `icc: false`, log
  driver `local`; limites de memoria/CPU/pids por servicio; `cap_drop: ALL` con
  capabilities minimas en PostgreSQL; `read_only` en la API y el proxy del
  socket.
- **Backups**: `pg_dump -Fc` diario, cifrado AES-256 con clave fuera del VPS,
  retencion local, hook offsite y restore de prueba automatizado en contenedor
  efimero.
- **Auditoria**: auditd sobre SSH, sudoers, Docker, UFW y `.env.prod`; AIDE
  diario; sudo con timeout y pty.
- **Deteccion**: contact point de correo en Grafana con politica por defecto;
  monitorizacion de host con Prometheus + node-exporter cuando la RAM lo
  permite.
- **Verificacion**: `deploy/host/verify.sh` comprueba el estado aplicado;
  Lynis y Docker Bench se ejecutan como auditoria periodica.

## Consequences

### Positive

- **POS-001**: La configuracion del host es reproducible y auditable: un
  cambio de SSH, firewall o Docker queda en Git con su justificacion.
- **POS-002**: El restore deja de ser una promesa: hay un comando que prueba el
  backup mas reciente sin tocar produccion.
- **POS-003**: Los limites por contenedor acotan el impacto de una fuga de
  memoria o un fork bomb en un VPS unico.
- **POS-004**: Las alertas notifican por correo, no solo se pintan en la UI.
- **POS-005**: El rollback es explicito: respaldos por timestamp y `IMAGE_TAG`.

### Negative

- **NEG-001**: El reboot automatico de unattended-upgrades puede reiniciar el
  host de madrugada; es intencional, pero exige que el arranque este probado.
- **NEG-002**: `live-restore` y los limites de recursos agregan variables a
  diagnosticar cuando un contenedor no arranca.
- **NEG-003**: auditd con watch sobre `.env.prod` genera eventos en cada
  lectura del archivo; hay que revisar el ruido antes de ampliar reglas.
- **NEG-004**: AIDE consume CPU y disco en cada chequeo; en VPS pequenos puede
  solaparse con el backup.
- **NEG-005**: La clave de backup fuera del VPS es un punto unico de fallo
  operativo: sin ella los backups no se descifran.

## Alternatives Considered

### SSH por Cloudflare Access (cerrar el 22)

- **ALT-001**: **Description**: Publicar SSH via Tunnel + Access con
  certificados de corta vida.
- **ALT-002**: **Rejection Reason**: Elimina el puerto publico, pero agrega
  dependencia de Cloudflare y de `cloudflared` en cada equipo administrador.
  Se pospone; el 22 con claves y fail2ban es un riesgo acotado y verificable.

### Endurecimiento manual no versionado

- **ALT-003**: **Description**: Documentar pasos y aplicarlos a mano.
- **ALT-004**: **Rejection Reason**: No hay verificacion repetible, ni
  rollback, ni evidencia de que la configuracion sigue aplicada tras un
  reinicio o una intervencion manual.

### Agentes de observabilidad gestionados

- **ALT-005**: **Description**: Grafana Cloud u otro SaaS para metricas y
  alertas de host.
- **ALT-006**: **Rejection Reason**: Salida de datos institucionales y costo;
  el stack autogestionado ya cubre logs y puede cubrir metricas.

## Implementation Notes

- **IMP-001**: Artefactos en `deploy/host/` y `deploy/backup/`; instaladores
  `install.sh` idempotentes con respaldo en
  `/var/backups/sipeg-hardening/<timestamp>/`.
- **IMP-002**: `deploy/host/verify.sh` es el criterio de exito objetivo:
  21 comprobaciones PASS/FAIL. Resultado final en produccion: 21 PASS, 0 FAIL.
- **IMP-003**: El prefijo `10-` del archivo SSH es funcional: gana a
  `50-cloud-init.conf` por orden alfabetico en `sshd_config.d`.
- **IMP-004**: Las variables de limites y alertas se documentan en
  `.env.prod.example`; los defaults del compose permiten arrancar sin
  definirlas, pero produccion debe fijarlas.
- **IMP-005**: El backup referencia la imagen de PostgreSQL fijada en el
  ADR-0007; actualizar tag y digest juntos.
- **IMP-006**: El host corre Ubuntu 26.04 LTS (`resolute`) en lugar de 24.04;
  todos los controles aplican igual. El repositorio de Docker servia el suite
  `noble` sobre un sistema `resolute`, asi que el origen
  `o=Docker,a=resolute` no casaba con los paquetes y Docker no se habria
  auto-actualizado. Se versiono `deploy/host/apt/docker.sources` con
  `Suites: resolute` y el componente `patches` lo instala.
- **IMP-007**: El script de restore de prueba consulta la tabla real `users`
  (`@@map("users")`), no `"user"`. Ademas se corrigio una carrera: el
  entrypoint de PostgreSQL arranca un servidor temporal para initdb y lo apaga
  antes del definitivo, por lo que la espera exige dos `pg_isready`
  consecutivos y vuelca las logs del contenedor si no hay readiness.
- **IMP-008**: `COMPOSE_FILES` en `backup.env` debe ir entre comillas simples:
  el script hace `source` del archivo y sin comillas bash ejecuta
  `compose.prod.yaml` como comando.
- **IMP-009**: El timer de backup se habilita con `systemctl enable --now`;
  `enable` solo crea el symlink y el timer queda inactivo hasta el proximo
  reinicio.
- **IMP-010**: El verificador excluye todo el rango loopback `127\.` (no solo
  `127.0.0.1`, por systemd-resolved), el puerto DHCP `68` y evalua solo
  bindings publicados de Docker (no `expose`). Sin esos ajustes reportaba
  FAIL falsos con el stack desplegado.
- **IMP-011**: `GF_SMTP_HOST` debe incluir el puerto (`host:587`); Grafana no
  tiene una variable `GF_SMTP_PORT` separada. Contact point y politica se
  provisionan por archivo y el correo de prueba se recibio correctamente.
- **IMP-012**: Prometheus + node-exporter se incluyeron: el gate de RAM se
  cumplio con el stack arriba (2.6 Gi disponibles). El label real del
  filesystem es `mountpoint="/"`, asi que la regla `sipeg-disk-full` consulta
  datos validos.
- **IMP-013**: El backup es **solo local** por decision operativa
  (`OFFSITE_CMD` vacio). Un fallo del VPS pierde datos y backups juntos; el
  destino externo previsto es Cloudflare R2 (fase 6). La clave de cifrado se
  conserva fuera del VPS en un gestor de secretos.
- **IMP-014**: La regla de auditd sigue la sintaxis legacy `-w`; auditd 4.x
  advierte "Old style watch rules are slower". Migrar a
  `-a always,exit -F path=` queda como mejora futura.

## Backlog De Mejoras Futuras

Sugerencias de Lynis y Docker Bench revisadas y no aplicadas en esta fase:

- SSH fino: `LogLevel VERBOSE`, `MaxSessions 2`, `TCPKeepAlive no`.
- Contrasena en GRUB (requiere probar la consola OVH antes).
- PAM/login.defs: `umask 027`, rondas de hashing, politica de expiracion.
- Bloquear protocolos de kernel no usados: `dccp`, `sctp`, `rds`, `tipc`.
- `debsums` y `apt-show-versions`; revisar checksums SHA-256/512 de AIDE.
- Scanner de malware (`rkhunter`, OSSEC o Wazuh).
- Banners legales en `/etc/issue*`, process accounting y archivo externo de
  logs.
- `userns-remap` (requiere migrar propietarios de volumenes), plugin de
  autorizacion del daemon y particiones separadas para `/var`.
- Watch de auditd sobre `/var/lib/docker` (ruido aceptado por ahora).
- Docker Bench solo es ejecutable con `DOCKER_API_VERSION=1.44` por la imagen
  abandonada; los checks del daemon ya estan cubiertos por `verify.sh`.

## References

- **REF-001**: `deploy/README.md` (runbook operativo).
- **REF-002**: `docs/adr/adr-0007-structured-logging-and-observability.md`
  (puertos, spool, imagenes fijadas).
- **REF-003**: `docs/adr/adr-0009-refresh-token-cookie-httponly.md`
  (topologia y cookies).
- **REF-004**: `docs/adr/adr-0012-cloudflare-workers-tunnel-deployment.md`
  (frontera publica y Tunnel).
- **REF-005**: CIS Ubuntu Linux 24.04 LTS Benchmark.
- **REF-006**: OWASP API Security Top 10 y OWASP Logging Cheat Sheet.
- **REF-007**: `docs/superpowers/plans/2026-10-07-endurecimiento-vps.md`
  (plan de ejecucion y registro de verificaciones).
