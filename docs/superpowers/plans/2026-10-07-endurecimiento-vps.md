# Endurecimiento del VPS de produccion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` (or `subagent-driven-development`) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Todos los comandos marcados **[VPS]** se ejecutan en el servidor de produccion; los marcados **[repo]** se ejecutan en este repositorio.

**Goal:** Endurecer el VPS OVH (Ubuntu 24.04 LTS de referencia) que aloja la API, PostgreSQL y la observabilidad de SIPEG UTP, con artefactos versionados en `deploy/`, verificaciones repetibles y rollback seguro.

**Architecture:** La entrada publica es Cloudflare Tunnel (sin puertos entrantes de aplicacion). El endurecimiento cubre el host (SSH con claves + fail2ban, UFW, parches automaticos, sysctl, auditd, AIDE), Docker (daemon y limites por contenedor), secretos, backups cifrados de PostgreSQL con restore probado, y alertas de Grafana con contact point real. Cada control vive como archivo versionado en `deploy/` y se aplica con un instalador idempotente que respalda los originales y valida antes de recargar servicios.

**Tech Stack:** Ubuntu 24.04 LTS, OpenSSH, fail2ban, UFW, unattended-upgrades, auditd, AIDE, Docker Engine + Compose, PostgreSQL 18, Grafana/Loki/Alloy, systemd timers, openssl.

---

## Decisiones fijadas

- **SSH publico en el 22 con claves + fail2ban.** No se migra a Cloudflare Access SSH en esta fase. El puerto queda limitado por UFW (CIDR de administracion si se conoce; si no, `ufw limit`).
- **Artefactos versionados.** Scripts, units systemd y plantillas de configuracion viven en `deploy/` y se instalan con `deploy/host/install.sh` y `deploy/backup/install.sh`.
- **Commits gated.** Por `AGENTS.md`, no se commitea sin autorizacion explicita. Cada tarea termina con `git status --short` y `git diff --stat`; el commit queda a criterio del usuario.
- **Sin cambios de codigo TypeScript.** Este plan no altera `src/`; el contrato OpenAPI no cambia y `pnpm run docs:check` debe seguir verde.

## Fuera de alcance

- Cloudflare Access para SSH (evaluado como alternativa en el ADR-0013, no implementado).
- Cifrado de disco completo (no disponible en VPS estandar; los secretos y backups se protegen por permisos y cifrado de archivo).
- Rotacion automatica de secretos (procedimiento documentado, ejecucion manual).
- Endurecimiento de la cuenta Cloudflare y del frontend en Workers (se documenta el checklist, no se automatiza).
- MFA a nivel de host para `sudo` (se documenta como mejora futura).

## Mapa de archivos

| Archivo | Accion | Responsabilidad |
| --- | --- | --- |
| `deploy/README.md` | Crear | Runbook: instalar, verificar, revertir, rotar secretos y restaurar backups. |
| `deploy/host/install.sh` | Crear | Instalador idempotente por componente; respalda originales y valida. |
| `deploy/host/ssh/10-sipeg-hardening.conf` | Crear | Directivas SSH (claves, sin root, sin password). |
| `deploy/host/fail2ban/sshd.local` | Crear | Jail `sshd` con backend systemd. |
| `deploy/host/ufw/setup.sh` | Crear | Reglas UFW idempotentes (deny incoming, allow outgoing, SSH limitado). |
| `deploy/host/docker/daemon.json` | Crear | Daemon: no-new-privileges, live-restore, icc off, log driver local. |
| `deploy/host/sysctl/99-sipeg-hardening.conf` | Crear | Endurecimiento de kernel y red. |
| `deploy/host/limits/99-sipeg-limits.conf` | Crear | Core dumps deshabilitados. |
| `deploy/host/apt/20auto-upgrades` | Crear | Periodicidad de unattended-upgrades. |
| `deploy/host/apt/50unattended-upgrades` | Crear | Origenes (incluye Docker), reboot programado, limpieza. |
| `deploy/host/apt/99-sipeg-needrestart.conf` | Crear | Reinicio automatico de servicios que lo requieran. |
| `deploy/host/journald/limits.conf` | Crear | Tope de journald para no llenar disco. |
| `deploy/host/auditd/99-sipeg.rules` | Crear | Auditoria de archivos sensibles (SSH, sudo, Docker, `.env.prod`). |
| `deploy/host/sudoers/90-sipeg` | Crear | `sudo` con timeout, pty y sin `NOPASSWD`. |
| `deploy/host/verify.sh` | Crear | Verificador PASS/FAIL de todos los controles del host. |
| `deploy/backup/backup.env.example` | Crear | Plantilla de configuracion del backup. |
| `deploy/backup/pg-backup.sh` | Crear | `pg_dump -Fc` + cifrado AES-256 + retencion + hook offsite. |
| `deploy/backup/pg-restore-verify.sh` | Crear | Restore de prueba en contenedor efimero con validacion. |
| `deploy/backup/sipeg-pg-backup.service` | Crear | Unit oneshot del backup. |
| `deploy/backup/sipeg-pg-backup.timer` | Crear | Timer diario con `Persistent=true`. |
| `deploy/backup/install.sh` | Crear | Instala scripts, units y `/etc/sipeg/backup.env`. |
| `observability/grafana/provisioning/alerting/contact-points.yaml` | Crear | Contact point de correo `sipeg-email`. |
| `observability/grafana/provisioning/alerting/notification-policies.yaml` | Crear | Politica por defecto hacia `sipeg-email`. |
| `observability/grafana/provisioning/datasources/prometheus.yaml` | Crear (opcional) | Datasource Prometheus para metricas de host. |
| `observability/prometheus/prometheus.yml` | Crear (opcional) | Scrape de node-exporter. |
| `compose.prod.yaml` | Modificar | Limites, capabilities minimas en `db`, `read_only` en `api`. |
| `compose.observability.yaml` | Modificar | Limites por servicio, SMTP de Grafana, Prometheus/node-exporter (opcional). |
| `compose.cloudflare.yaml` | Modificar si existe | Limites de `cloudflared` (la creacion es de la tarea 5 del plan de despliegue). |
| `.env.prod.example` | Modificar | Variables de limites, alertas y SMTP de Grafana. |
| `.env.prod` (VPS, privado) | Modificar | Mismos valores reales; nunca en Git. |
| `.dockerignore` | Modificar | Excluir `deploy/` del contexto de build. |
| `README.md` | Modificar | Seccion "Endurecimiento Del VPS" con punteros al runbook. |
| `CONTEXT.md` | Modificar | Resumen de controles de host en "Seguridad". |
| `AGENTS.md` | Modificar | Regla de operacion: el endurecimiento vive en `deploy/`. |
| `docs/adr/adr-0013-vps-hardening-baseline.md` | Crear | ADR de la linea base de endurecimiento. |
| `docs/despliegue.md` | Modificar | Marcar la decision #10 (backup) como resuelta. |

## Convenciones de ejecucion

- Mantener **siempre una sesion SSH abierta** mientras se aplica la tarea 3. Probar una segunda sesion antes de cerrar la primera.
- `deploy/host/install.sh` acepta `DRY_RUN=1` para imprimir acciones sin aplicarlas.
- Los respaldos de archivos del host quedan en `/var/backups/sipeg-hardening/<timestamp>/`.
- Ninguna tarea imprime secretos: no ejecutar `cat .env.prod`, `env` ni `docker inspect` sobre contenedores con credenciales.
- `$REPO_DIR` en los ejemplos es `/opt/sipeg-utp-backend`; ajustar al path real del despliegue y mantenerlo consistente en `/etc/sipeg/backup.env`.

---

## Tarea 1: Inventario y linea base del VPS

**Files:** ninguno (solo diagnostico).

- [x] **Step 1: Registrar identidad y version del sistema [VPS]**

```bash
lsb_release -a
uname -r
timedatectl
```

Esperado: `Ubuntu 24.04.x LTS`, kernel 6.8+ y hora sincronizada. Anotar la version exacta.

- [x] **Step 2: Registrar cuentas y acceso [VPS]**

```bash
getent passwd | awk -F: '$3>=1000 {print $1, $3, $6}'
sudo -l -U "$USER"
sudo sshd -T | grep -E '^(passwordauthentication|permitrootlogin|pubkeyauthentication|maxauthtries) '
sudo getent group sudo docker
```

Esperado: al menos un usuario no-root con sudo. Anotar si existe `50-cloud-init.conf` con `PasswordAuthentication yes`:

```bash
ls -la /etc/ssh/sshd_config.d/
```

- [x] **Step 3: Registrar superficie de red y contenedores [VPS]**

```bash
ss -tulpn
sudo docker ps --format 'table {{.Names}}\t{{.Ports}}'
sudo docker compose ls
sudo ufw status verbose || echo 'ufw no instalado'
```

Esperado: `:22` publico, `127.0.0.1:3000` y `127.0.0.1:3001` de loopback, `db` sin puertos. Anotar cualquier puerto en `0.0.0.0` distinto de 22.

- [x] **Step 4: Registrar recursos y estado [VPS]**

```bash
df -h /
free -h
swapon --show || true
sudo systemctl --failed
apt list --upgradable 2>/dev/null | wc -l
```

Esperado: RAM disponible y swap (si no hay swap, la tarea 5 lo crea). Anotar fallos de systemd y paquetes pendientes.

- [x] **Step 5: Confirmar punto de rollback [VPS]** — sin stack (VPS nuevo, despliegue posterior) y sin snapshot (OVH lo cobra aparte); mitigacion: respaldos por timestamp del instalador + prueba de sesion previa al cierre

```bash
sudo docker compose \
  -f "$REPO_DIR/compose.prod.yaml" \
  -f "$REPO_DIR/compose.observability.yaml" \
  --env-file "$REPO_DIR/.env.prod" \
  ps -a
```

Esperado: stack en ejecucion. Si el proveedor ofrece snapshot del VPS, crear uno antes de la tarea 3 y anotar su identificador.

---

## Tarea 2: Esqueleto `deploy/` y instalador del host

**Files:**
- Create: `deploy/README.md`
- Create: `deploy/host/install.sh`
- Modify: `.dockerignore`

- [x] **Step 1: Crear directorios [repo]**

```bash
mkdir -p deploy/host/{ssh,fail2ban,ufw,docker,sysctl,limits,apt,journald,auditd,sudoers}
mkdir -p deploy/backup
mkdir -p observability/prometheus
```

- [x] **Step 2: Crear `deploy/host/install.sh` [repo]**

Contenido completo:

```bash
#!/usr/bin/env bash
# Instalador idempotente de la linea base de endurecimiento SIPEG UTP.
#
# Uso:
#   sudo deploy/host/install.sh <componente|all>
#   DRY_RUN=1 sudo deploy/host/install.sh all
#
# Componentes: ssh firewall patches kernel docker sudo audit
#
# Cada archivo instalado se respalda en /var/backups/sipeg-hardening/<UTC>/
# antes de sobrescribirse. Los servicios se validan (sshd -t, visudo -cf,
# systemd-analyze verify) antes de recargarse.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOST_DIR="$REPO_DIR/deploy/host"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="/var/backups/sipeg-hardening/$STAMP"
DRY_RUN="${DRY_RUN:-0}"

log() { printf '[install] %s\n' "$*"; }
run() { if [[ "$DRY_RUN" == "1" ]]; then printf '[dry-run] %s\n' "$*"; else "$@"; fi; }

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    echo 'Ejecutar con sudo.' >&2
    exit 1
  fi
}

backup_file() {
  local target="$1"
  [[ -e "$target" ]] || return 0
  run install -d -m 0700 "$BACKUP_DIR"
  run cp -a "$target" "$BACKUP_DIR/$(basename "$target")"
  log "respaldo: $target -> $BACKUP_DIR/$(basename "$target")"
}

install_file() {
  local src="$1" dst="$2" mode="$3"
  backup_file "$dst"
  run install -D -m "$mode" "$src" "$dst"
  log "instalado: $dst ($mode)"
}

component_ssh() {
  run apt-get install -y fail2ban
  install_file "$HOST_DIR/ssh/10-sipeg-hardening.conf" /etc/ssh/sshd_config.d/10-sipeg-hardening.conf 0644
  install_file "$HOST_DIR/fail2ban/sshd.local" /etc/fail2ban/jail.d/sshd.local 0644
  run sshd -t
  run systemctl reload ssh
  run systemctl enable --now fail2ban
  run systemctl restart fail2ban
  log "ssh efectivo: $(sshd -T | grep -E '^(passwordauthentication|permitrootlogin|maxauthtries|authenticationmethods) ' | tr '\n' ' ')"
}

component_firewall() {
  run apt-get install -y ufw
  run env ADMIN_SSH_CIDR="${ADMIN_SSH_CIDR:-}" "$HOST_DIR/ufw/setup.sh"
}

component_patches() {
  run apt-get install -y unattended-upgrades needrestart
  install_file "$HOST_DIR/apt/20auto-upgrades" /etc/apt/apt.conf.d/20auto-upgrades 0644
  install_file "$HOST_DIR/apt/50unattended-upgrades" /etc/apt/apt.conf.d/50unattended-upgrades 0644
  run install -d -m 0755 /etc/needrestart/conf.d
  install_file "$HOST_DIR/apt/99-sipeg-needrestart.conf" /etc/needrestart/conf.d/99-sipeg.conf 0644
  run systemctl enable --now unattended-upgrades
}

component_kernel() {
  install_file "$HOST_DIR/sysctl/99-sipeg-hardening.conf" /etc/sysctl.d/99-sipeg-hardening.conf 0644
  install_file "$HOST_DIR/limits/99-sipeg-limits.conf" /etc/security/limits.d/99-sipeg-limits.conf 0644
  install_file "$HOST_DIR/journald/limits.conf" /etc/systemd/journald.conf.d/limits.conf 0644
  run sysctl --system
  run systemctl restart systemd-journald
}

component_docker() {
  install_file "$HOST_DIR/docker/daemon.json" /etc/docker/daemon.json 0644
  run systemctl restart docker
  log 'docker reiniciado: los contenedores se detuvieron; levantar el stack con docker compose up -d'
}

component_sudo() {
  install_file "$HOST_DIR/sudoers/90-sipeg" /etc/sudoers.d/90-sipeg 0440
  run visudo -cf /etc/sudoers.d/90-sipeg
}

component_audit() {
  run apt-get install -y auditd
  local rules_src="$HOST_DIR/auditd/99-sipeg.rules"
  local env_prod="$REPO_DIR/.env.prod"
  local tmp
  tmp="$(mktemp)"
  if [[ -f "$env_prod" ]]; then
    sed "s|__DEPLOY_ENV_PROD__|$env_prod|g" "$rules_src" > "$tmp"
  else
    sed '/__DEPLOY_ENV_PROD__/d' "$rules_src" > "$tmp"
  fi
  backup_file /etc/audit/rules.d/99-sipeg.rules
  run install -D -m 0640 "$tmp" /etc/audit/rules.d/99-sipeg.rules
  rm -f "$tmp"
  run augenrules --load
  run systemctl enable --now auditd
}

main() {
  require_root
  local component="${1:-all}"
  case "$component" in
    ssh|firewall|patches|kernel|docker|sudo|audit) "component_$component" ;;
    all)
      for c in ssh firewall patches kernel docker sudo audit; do
        "component_$c"
      done
      ;;
    *)
      echo "Componente desconocido: $component" >&2
      exit 1
      ;;
  esac
  log "listo: $component"
}

main "$@"
```

- [x] **Step 3: Dar permisos de ejecucion [repo]**

```bash
chmod +x deploy/host/install.sh
```

- [x] **Step 4: Crear `deploy/README.md` [repo]**

Contenido completo:

````markdown
# Endurecimiento del VPS de produccion

Artefactos versionados para proteger el VPS OVH que aloja SIPEG UTP.
La topologia publica es Cloudflare Tunnel: no hay puertos entrantes de
aplicacion. Este directorio cubre el host, Docker, backups y alertas.

## Instalacion

```bash
# En el VPS, desde el repositorio desplegado:
sudo deploy/host/install.sh all
sudo deploy/backup/install.sh
sudo deploy/host/verify.sh
```

Componentes individuales de `deploy/host/install.sh`:

| Componente | Que aplica |
| --- | --- |
| `ssh` | Directivas SSH y jail de fail2ban |
| `firewall` | UFW (deny incoming, allow outgoing, SSH limitado) |
| `patches` | unattended-upgrades, needrestart y journald |
| `kernel` | sysctl, limites de core y journald |
| `docker` | `daemon.json` y reinicio del daemon |
| `sudo` | Politica de sudo |
| `audit` | Reglas de auditd (incluye watch sobre `.env.prod`) |

`DRY_RUN=1` imprime las acciones sin aplicarlas. Cada archivo sobrescrito se
respalda en `/var/backups/sipeg-hardening/<timestamp>/`.

## Backups

1. Generar la clave de cifrado y guardarla fuera del VPS:

   ```bash
   sudo install -d -m 0700 /etc/sipeg
   openssl rand -hex 32 | sudo tee /etc/sipeg/backup.key >/dev/null
   sudo chmod 600 /etc/sipeg/backup.key
   ```

2. Completar `/etc/sipeg/backup.env` (copiado desde
   `deploy/backup/backup.env.example`) y definir `OFFSITE_CMD`.
3. Primer backup y prueba de restore:

   ```bash
   sudo systemctl start sipeg-pg-backup.service
   sudo /usr/local/sbin/sipeg-pg-restore-verify
   ```

## Restore manual en produccion

```bash
# 1. Detener la API para no escribir durante el restore.
docker compose -f compose.prod.yaml -f compose.observability.yaml \
  -f compose.cloudflare.yaml --env-file .env.prod stop api

# 2. Descifrar el backup elegido.
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -pass file:/etc/sipeg/backup.key \
  -in /var/backups/sipeg/sipeg_utp_<STAMP>.dump.enc \
  -out /tmp/restore.dump

# 3. Restaurar (drop y recreate de la base).
docker compose -f compose.prod.yaml -f compose.observability.yaml \
  -f compose.cloudflare.yaml --env-file .env.prod exec -T db \
  sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose -f compose.prod.yaml -f compose.observability.yaml \
  -f compose.cloudflare.yaml --env-file .env.prod exec -T db \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' < /tmp/restore.dump

# 4. Limpiar y levantar la API.
rm -f /tmp/restore.dump
docker compose -f compose.prod.yaml -f compose.observability.yaml \
  -f compose.cloudflare.yaml --env-file .env.prod up -d api
```

## Rotacion de secretos

| Secreto | Efecto de rotarlo | Procedimiento |
| --- | --- | --- |
| `AUTH_SECRET` | Invalida cookies del proveedor; cierra sesiones | Editar `.env.prod`, `up -d api` |
| `AUTH` (claves JWKS) | No se rota a mano: lo gestiona la app | Reiniciar `api` |
| `POSTGRES_PASSWORD` | Exige cambiarla tambien en PostgreSQL | `ALTER USER` + `.env.prod` + `up -d` |
| `LOG_PSEUDONYMIZATION_KEY` | Corta la correlacion de pseudonimos previos | Editar `.env.prod`, `up -d api` |
| `GRAFANA_SECRET_KEY` | Invalida sesiones y ajustes cifrados de Grafana | Editar `.env.prod`, recrear Grafana |
| `GRAFANA_ADMIN_PASSWORD` | Solo aplica con volumen vacio | Cambiar desde la UI |
| `CLOUDFLARE_TUNNEL_TOKEN` | Corta el tunel hasta reiniciar `cloudflared` | Rotar en Cloudflare, `.env.prod`, `up -d cloudflared` |
| `backup.key` | Los backups previos dejan de descifrarse | Regenerar y re-cifrar; conservar la anterior |

## Frontera Cloudflare

El VPS no recibe puertos de aplicacion: todo entra por Tunnel. Checklist de la
cuenta y la zona (manual, en el panel):

- MFA en la cuenta Cloudflare y en OVH; API tokens scoped por zona, nunca la
  Global API Key.
- Tunnel con solo dos rutas: `api.sipeg-utp.com` y `grafana.sipeg-utp.com`.
- Access con politica Allow por correo en Grafana; sin Access en la API (rompe
  al frontend). MFA en los correos administradores.
- WAF managed rules, Bot Fight Mode y reglas de rate limiting para
  `/api/v1/auth/*` y futuros formularios publicos; Turnstile en el registro de
  ponentes.
- Always Use HTTPS, TLS 1.2+ y cache bypass para ambos hostnames.
- Verificar la cadena `X-Forwarded-For` con clientes de dos redes distintas:
  los buckets de rate limiting no deben compartirse.
- Si el proveedor ofrece firewall de red (OVH), activar deny-all entrante
  salvo el 22 y comprobar con `nmap` desde fuera.

## Reversion

- Configuracion del host: restaurar desde
  `/var/backups/sipeg-hardening/<timestamp>/` y recargar el servicio.
- Compose: `git diff` + restaurar el bloque anterior; `IMAGE_TAG` permite
  volver a la imagen previa.
- Docker daemon: restaurar `/etc/docker/daemon.json` y
  `systemctl restart docker`.
````

- [x] **Step 5: Excluir `deploy/` del contexto Docker [repo]**

En `.dockerignore`, agregar al final:

```text
deploy
```

- [x] **Step 6: Verificar [repo]**

```bash
bash -n deploy/host/install.sh
git check-ignore deploy/README.md || echo 'deploy/ no ignorado: correcto'
git status --short
```

Esperado: sintaxis valida; `deploy/` visible para Git (no ignorado).

---

## Tarea 3: SSH con claves y fail2ban

**Files:**
- Create: `deploy/host/ssh/10-sipeg-hardening.conf`
- Create: `deploy/host/fail2ban/sshd.local`

- [x] **Step 1: Verificar que existe un usuario administrador no-root [VPS]**

```bash
getent passwd | awk -F: '$3>=1000 {print $1}'
sudo getent group sudo
```

Si no existe, crearlo y copiar la clave publica actual:

```bash
sudo adduser --disabled-password --gecos "" sipeg-admin
sudo usermod -aG sudo sipeg-admin
sudo install -d -m 0700 -o sipeg-admin -g sipeg-admin /home/sipeg-admin/.ssh
sudo cp /root/.ssh/authorized_keys /home/sipeg-admin/.ssh/authorized_keys
sudo chown sipeg-admin:sipeg-admin /home/sipeg-admin/.ssh/authorized_keys
sudo chmod 600 /home/sipeg-admin/.ssh/authorized_keys
```

Probar en una terminal nueva: `ssh sipeg-admin@<VPS>` antes de continuar.

- [x] **Step 2: Crear `deploy/host/ssh/10-sipeg-hardening.conf` [repo]**

El prefijo `10-` es deliberado: `sshd` usa el primer valor que encuentra y
Ubuntu incluye `/etc/ssh/sshd_config.d/*.conf` en orden alfabetico, de modo que
este archivo debe ganarle a `50-cloud-init.conf`.

```text
# Endurecimiento SSH SIPEG UTP.
# Instalado como /etc/ssh/sshd_config.d/10-sipeg-hardening.conf
# Validar con `sshd -t` antes de recargar.

PermitRootLogin no
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no
AuthenticationMethods publickey
AllowGroups sudo
MaxAuthTries 3
MaxSessions 3
LoginGraceTime 30
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding no
PermitTunnel no
ClientAliveInterval 300
ClientAliveCountMax 2
```

- [x] **Step 3: Crear `deploy/host/fail2ban/sshd.local` [repo]**

```ini
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 4
backend = systemd
ignoreip = 127.0.0.1/8 ::1

[sshd]
enabled = true
port = ssh
```

- [x] **Step 4: Aplicar el componente [VPS]**

```bash
sudo deploy/host/install.sh ssh
```

Esperado: `sshd -t` sin errores; mensaje `ssh efectivo:` con
`passwordauthentication no`, `permitrootlogin no`, `maxauthtries 3` y
`authenticationmethods publickey`.

- [x] **Step 5: Probar una segunda sesion antes de cerrar la actual [VPS]** — probada con la clave real (alias `sipeg-vps`); el primer intento fallo solo porque ofrecio la clave default equivocada

En una terminal nueva (sin cerrar la sesion actual):

```bash
ssh -o PreferredAuthentications=publickey sipeg-admin@<VPS> 'echo acceso-ok'
```

Esperado: `acceso-ok`. Si falla, restaurar desde
`/var/backups/sipeg-hardening/<timestamp>/` y recargar `ssh`.

- [x] **Step 6: Verificar fail2ban [VPS]**

```bash
sudo fail2ban-client status sshd
sudo sshd -T | grep -E '^(passwordauthentication|permitrootlogin|maxauthtries|authenticationmethods) '
```

Esperado: jail activo con 0 banned al inicio y las cuatro directivas con los
valores esperados.

- [x] **Step 7: Registrar cambios [repo]**

```bash
git status --short
git diff --stat
```

---

## Tarea 4: Firewall UFW y auditoria de puertos

**Files:**
- Create: `deploy/host/ufw/setup.sh`

- [x] **Step 1: Crear `deploy/host/ufw/setup.sh` [repo]** — ampliado en aplicacion: limpieza de reglas genericas `OpenSSH` del 22 que sombreaban el LIMIT (primer match gana en UFW)

```bash
#!/usr/bin/env bash
# Reglas UFW de SIPEG UTP. Idempotente.
#
# ADMIN_SSH_CIDR: si se define (ej. 190.34.0.0/16), el 22 solo acepta ese
# rango. Si esta vacio, el 22 queda abierto con limite de tasa.
#
# ADVERTENCIA: Docker inserta sus propias reglas en iptables y los puertos
# publicados en 0.0.0.0 saltan UFW. En este despliegue todo se publica en
# 127.0.0.1, de modo que UFW sigue siendo la frontera del host.
set -euo pipefail

ADMIN_SSH_CIDR="${ADMIN_SSH_CIDR:-}"

ufw default deny incoming
ufw default allow outgoing

if [[ -n "$ADMIN_SSH_CIDR" ]]; then
  ufw allow from "$ADMIN_SSH_CIDR" to any port 22 proto tcp comment 'SSH admin'
else
  ufw limit 22/tcp comment 'SSH rate limited'
fi

ufw --force enable
ufw status verbose
```

- [x] **Step 2: Dar permisos y aplicar [repo + VPS]**

```bash
chmod +x deploy/host/ufw/setup.sh
```

```bash
sudo deploy/host/install.sh firewall
```

Esperado: `Status: active`, `Default: deny (incoming), allow (outgoing)` y la
regla de 22 (limitada o restringida al CIDR).

- [x] **Step 3: Verificar que el SSH actual sigue vivo [VPS]**

```bash
ss -tulpn | grep ':22'
```

Esperado: `sshd` escuchando. No cerrar la sesion.

- [x] **Step 4: Verificar superficie desde el equipo del operador [operador]** — solo `22/tcp` en IPv4; IPv6 sin puertos alcanzables

```bash
nmap -Pn -p- <IP_DEL_VPS>
```

Esperado: solo `22/tcp` abierto (o filtrado). Cualquier otro puerto abierto es
un fallo: revisar `docker ps` y `ss -tulpn` en el VPS.

- [x] **Step 5: Confirmar que Docker no publica nada fuera de loopback [VPS]**

```bash
sudo docker ps --format '{{.Names}}\t{{.Ports}}' | grep -v '127.0.0.1' || echo 'solo loopback'
ss -tulpnH | awk '$5 !~ /^(127\.0\.0\.1|\[::1\])/ && $5 !~ /:22$/'
```

Esperado: la segunda salida vacia.

---

## Tarea 5: Parches automaticos, journald, hora y swap

**Files:**
- Create: `deploy/host/apt/20auto-upgrades`
- Create: `deploy/host/apt/50unattended-upgrades`
- Create: `deploy/host/apt/99-sipeg-needrestart.conf`
- Create: `deploy/host/journald/limits.conf`

- [x] **Step 1: Crear `deploy/host/apt/20auto-upgrades` [repo]**

```text
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
```

- [x] **Step 2: Crear `deploy/host/apt/50unattended-upgrades` [repo]**

Reemplaza al archivo de fabrica (respaldado por el instalador). Incluye el
origen de Docker y reinicio programado a las 03:00 hora local.

```text
Unattended-Upgrade::Allowed-Origins {
        "${distro_id}:${distro_codename}";
        "${distro_id}:${distro_codename}-security";
        "${distro_id}ESMApps:${distro_codename}-apps-security";
        "${distro_id}ESM:${distro_codename}-infra-security";
        "Docker:${distro_codename}";
};

Unattended-Upgrade::Package-Blacklist {
};

Unattended-Upgrade::DevRelease "auto";
Unattended-Upgrade::AutoFixInterruptedDpkg "true";
Unattended-Upgrade::MinimalSteps "true";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-New-Unused-Dependencies "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-WithUsers "true";
Unattended-Upgrade::Automatic-Reboot-Time "03:00";
Unattended-Upgrade::SyslogEnable "true";
```

- [x] **Step 3: Crear `deploy/host/apt/99-sipeg-needrestart.conf` [repo]**

```text
$nrconf{restart} = 'a';
$nrconf{kernelhints} = 0;
```

- [x] **Step 4: Crear `deploy/host/journald/limits.conf` [repo]**

```ini
[Journal]
SystemMaxUse=500M
SystemKeepFree=1G
MaxRetentionSec=1month
```

- [x] **Step 5: Aplicar el componente [VPS]** — patches aplicado con respaldos; kernel diferido a Tarea 6: el componente `kernel` instala los artefactos sysctl/limits de la Tarea 6 (bug de orden del plan), por lo que su aplicacion ocurre alli en una sola pasada

```bash
sudo apt-get update
sudo deploy/host/install.sh patches
sudo deploy/host/install.sh kernel
```

- [x] **Step 6: Verificar origenes y reinicio programado [VPS]** — hallazgo: el repo de Docker servia suite `noble` sobre un sistema `resolute`, por lo que el origen `o=Docker,a=resolute` no casaba con los paquetes (`a=noble`). Fix versionado: `deploy/host/apt/docker.sources` con `Suites: resolute` (suite publicado, HTTP 200 verificado), instalado por el componente `patches`

```bash
sudo unattended-upgrade --dry-run --debug 2>&1 | grep -E 'Allowed origins|docker-ce|Packages that will be upgraded' | head -20
systemctl is-enabled unattended-upgrades
grep -E 'Automatic-Reboot' /etc/apt/apt.conf.d/50unattended-upgrades
```

Esperado: `docker-ce` aparece como candidato cuando hay actualizacion
disponible; `enabled`; reboot `true` a las `03:00`. Si `docker-ce` no aparece,
revisar el origen real con `apt-cache policy docker-ce` y ajustar la linea
`"Docker:${distro_codename}"` al `a=` que reporte apt.

- [x] **Step 7: Ajustar hora y NTP [VPS]**

```bash
sudo timedatectl set-timezone America/Panama
sudo timedatectl set-ntp true
timedatectl status
```

Esperado: `Time zone: America/Panama` y `System clock synchronized: yes`.

- [x] **Step 8: Crear swap si no existe [VPS]**

```bash
swapon --show
```

Si la salida esta vacia:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Esperado: `free -h` muestra 2.0Gi de swap y `swapon --show` lista `/swapfile`.

---

## Tarea 6: Endurecimiento de kernel y limites

**Files:**
- Create: `deploy/host/sysctl/99-sipeg-hardening.conf`
- Create: `deploy/host/limits/99-sipeg-limits.conf`

- [x] **Step 1: Crear `deploy/host/sysctl/99-sipeg-hardening.conf` [repo]**

```text
# Endurecimiento de kernel y red SIPEG UTP.
# NO tocar net.ipv4.ip_forward: Docker lo necesita para sus bridges.
# rp_filter en modo loose (2): Docker usa rutas asimetricas en sus redes.

kernel.dmesg_restrict = 1
kernel.kptr_restrict = 2
kernel.yama.ptrace_scope = 1
kernel.randomize_va_space = 2
fs.suid_dumpable = 0
fs.protected_hardlinks = 1
fs.protected_symlinks = 1

net.ipv4.tcp_syncookies = 1
net.ipv4.conf.all.rp_filter = 2
net.ipv4.conf.default.rp_filter = 2
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv4.conf.all.log_martians = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.icmp_ignore_bogus_error_responses = 1
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0

vm.swappiness = 10
```

- [x] **Step 2: Crear `deploy/host/limits/99-sipeg-limits.conf` [repo]**

```text
* hard core 0
* soft core 0
```

- [x] **Step 3: Aplicar [VPS]** — aplicado en una sola pasada de `install.sh kernel` (sysctl+limits+journald), tras resolver el bug de orden con la Tarea 5

```bash
sudo deploy/host/install.sh kernel
```

- [x] **Step 4: Verificar valores efectivos [VPS]** — 1, 2, 1, 10, 2; ulimit -c 0; docker operativo

```bash
sysctl kernel.dmesg_restrict kernel.kptr_restrict kernel.yama.ptrace_scope vm.swappiness net.ipv4.conf.all.rp_filter
ulimit -c
sudo docker info >/dev/null && echo 'docker sigue operativo'
```

Esperado: `1`, `2`, `1`, `10`, `2`, `0` y Docker operativo.

- [x] **Step 5: Verificar journald [VPS]** — 8M en uso vs tope 500M; directivas presentes

```bash
journalctl --disk-usage
grep -E 'SystemMaxUse|MaxRetentionSec' /etc/systemd/journald.conf.d/limits.conf
```

Esperado: uso por debajo de 500M y directivas presentes.

---

## Tarea 7: Docker daemon y grupo docker

**Files:**
- Create: `deploy/host/docker/daemon.json`

- [x] **Step 1: Crear `deploy/host/docker/daemon.json` [repo]**

```json
{
  "icc": false,
  "live-restore": true,
  "log-driver": "local",
  "log-opts": {
    "max-size": "20m",
    "max-file": "5"
  },
  "no-new-privileges": true
}
```

Notas:

- `icc: false` solo afecta a la red `bridge` por defecto; las redes
  user-defined de Compose (incluida `sipeg-utp-prod`) no se ven afectadas.
- `live-restore` mantiene los contenedores vivos en reinicios del daemon
  posteriores a este primero; no aplica a Swarm.
- `log-driver` global replica la politica `x-logging` que ya declaran los
  compose.

- [x] **Step 2: Aplicar y levantar el stack [VPS]** — `install.sh docker` aplicado; sin `up -d` porque el stack aun no esta desplegado

```bash
sudo deploy/host/install.sh docker
sudo docker compose \
  -f compose.prod.yaml \
  -f compose.observability.yaml \
  --env-file .env.prod \
  up -d
```

Si `compose.cloudflare.yaml` ya existe, agregarlo con `-f`. Esperado: el daemon
reinicia (los contenedores se detienen) y el stack vuelve a `running`.

- [x] **Step 3: Verificar defaults del daemon [VPS]** — `LiveRestoreEnabled true`, `LoggingDriver local`, `icc false`, `NoNewPrivs 1`

```bash
docker info -f '{{.LiveRestoreEnabled}}'
docker network inspect bridge -f '{{index .Options "com.docker.network.bridge.enable_icc"}}'
docker run --rm --entrypoint cat postgres:18.6-alpine@sha256:6c538e7206ea40ff740ef27883529390a690b6ead6ba96b44c67a9f7c638e8fd /proc/self/status | grep NoNewPrivs
```

Esperado: `true`, `false`, `NoNewPrivs: 1`.

- [x] **Step 4: Auditar el grupo docker y el socket [VPS]** — grupo `docker` sin miembros; socket `660 root docker`

```bash
getent group docker
stat -c '%a %U %G' /var/run/docker.sock
```

Esperado: solo el usuario administrador en el grupo (o ninguno si se usa
`sudo docker`); socket `660 root docker`. Retirar del grupo a cualquier cuenta
que no lo necesite: `sudo gpasswd -d <usuario> docker`.

- [ ] **Step 5: Confirmar que el stack quedo sano [VPS]** — pendiente del despliegue del stack

```bash
sudo docker compose \
  -f compose.prod.yaml \
  -f compose.observability.yaml \
  --env-file .env.prod \
  ps
curl -fsS http://127.0.0.1:3000/api/v1/health
```

Esperado: servicios arriba y health `200`.

---

## Tarea 8: Limites, capabilities y rootfs de solo lectura

**Files:**
- Modify: `compose.prod.yaml`
- Modify: `compose.cloudflare.yaml` (si existe)
- Modify: `.env.prod.example`

- [x] **Step 1: Probar las capabilities minimas de PostgreSQL [VPS]** — `accepting connections` con `cap_drop ADD` + 5 capabilities contra la imagen fijada

```bash
mkdir -p /tmp/pg-cap-test
docker run -d --name pg-cap-test \
  -e POSTGRES_PASSWORD=test-only \
  -e POSTGRES_DB=test \
  --cap-drop ALL \
  --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --cap-add SETGID --cap-add SETUID \
  --security-opt no-new-privileges:true \
  -v /tmp/pg-cap-test:/var/lib/postgresql \
  postgres:18.6-alpine@sha256:6c538e7206ea40ff740ef27883529390a690b6ead6ba96b44c67a9f7c638e8fd
sleep 8
docker exec pg-cap-test pg_isready -U postgres -d test
docker rm -f pg-cap-test
rm -rf /tmp/pg-cap-test
```

Esperado: `accepting connections`. Si falla, revisar
`docker logs pg-cap-test` antes de tocar el compose.

- [x] **Step 2: Modificar `compose.prod.yaml` [repo]**

En el servicio `api`, junto a `cap_drop`:

```yaml
    mem_limit: ${API_MEM_LIMIT:-768m}
    cpus: ${API_CPUS:-2.0}
    pids_limit: 256
    read_only: true
    tmpfs:
      - /tmp
```

En el servicio `db`, junto a `security_opt`:

```yaml
    mem_limit: ${DB_MEM_LIMIT:-1g}
    cpus: ${DB_CPUS:-2.0}
    pids_limit: 512
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - DAC_OVERRIDE
      - FOWNER
      - SETGID
      - SETUID
```

En `migrate` y en `seed`:

```yaml
    mem_limit: ${MIGRATE_MEM_LIMIT:-512m}
    pids_limit: 256
    cap_drop:
      - ALL
```

- [x] **Step 3: Modificar `compose.cloudflare.yaml` si existe [repo]**

En el servicio `cloudflared`:

```yaml
    mem_limit: ${CLOUDFLARED_MEM_LIMIT:-128m}
    cpus: ${CLOUDFLARED_CPUS:-0.5}
    pids_limit: 128
```

- [x] **Step 4: Documentar variables en `.env.prod.example` [repo]**

Agregar despues del bloque "Conexiones y ejecucion":

```env
# Limites de recursos por contenedor (ajustar a la RAM real del VPS; los
# defaults estan pensados para 4 GB). La suma de mem_limit no debe superar la
# RAM disponible menos 512 MB para el sistema.
API_MEM_LIMIT=768m
API_CPUS=2.0
DB_MEM_LIMIT=1g
DB_CPUS=2.0
MIGRATE_MEM_LIMIT=512m
CLOUDFLARED_MEM_LIMIT=128m
```

- [x] **Step 5: Validar la interpolacion [VPS]** — `exit=0` con `config --quiet`

```bash
POSTGRES_PASSWORD=validation-only \
AUTH_SECRET=validation-only-not-for-production \
LOG_PSEUDONYMIZATION_KEY=validation-only-not-for-production \
MAIL_HOST=smtp.example.invalid \
docker compose -f compose.prod.yaml --env-file .env.prod.example config --quiet
echo "exit=$?"
```

Esperado: `exit=0`. No imprimir la configuracion resuelta (contiene secretos
ficticios, pero el habito importa).

- [ ] **Step 6: Aplicar en produccion [VPS]** — pendiente del despliegue del stack (VPS nuevo); el `up -d` y el health se ejecutan entonces

```bash
sudo docker compose \
  -f compose.prod.yaml \
  -f compose.observability.yaml \
  --env-file .env.prod \
  up -d
curl -fsS http://127.0.0.1:3000/api/v1/health
```

Esperado: health `200` con `authJwksReachable: true`.

- [ ] **Step 7: Verificar limites y read-only efectivos [VPS]** — pendiente del despliegue; requiere contenedores en ejecucion

```bash
API_ID="$(docker ps -q --filter label=com.docker.compose.service=api)"
docker inspect -f 'readonly={{.HostConfig.ReadonlyRootfs}} mem={{.HostConfig.Memory}} pids={{.HostConfig.PidsLimit}}' "$API_ID"
DB_ID="$(docker ps -q --filter label=com.docker.compose.service=db)"
docker inspect -f 'mem={{.HostConfig.Memory}} caps={{json .HostConfig.CapDrop}}' "$DB_ID"
```

Esperado: `readonly=true`, memoria y pids con los valores definidos; `db` con
`["ALL"]` en `CapDrop`.

- [x] **Step 8: Registrar cambios [repo]**

```bash
git diff --stat
git status --short
```

---

## Tarea 9: Backups de PostgreSQL con restore verificado

**Files:**
- Create: `deploy/backup/backup.env.example`
- Create: `deploy/backup/pg-backup.sh`
- Create: `deploy/backup/pg-restore-verify.sh`
- Create: `deploy/backup/sipeg-pg-backup.service`
- Create: `deploy/backup/sipeg-pg-backup.timer`
- Create: `deploy/backup/install.sh`

- [x] **Step 1: Crear `deploy/backup/backup.env.example` [repo]**

```env
# Copiar a /etc/sipeg/backup.env (chmod 600) y completar.
# COMPOSE_DIR: ruta del repositorio desplegado en el VPS.
COMPOSE_DIR=/opt/sipeg-utp-backend
# COMPOSE_FILES: overlays activos del despliegue.
COMPOSE_FILES=-f compose.prod.yaml -f compose.observability.yaml -f compose.cloudflare.yaml
# BACKUP_DIR: destino local de los backups cifrados.
BACKUP_DIR=/var/backups/sipeg
# ENCRYPTION_KEY_FILE: clave de cifrado (openssl rand -hex 32). Copiar fuera
# del VPS: sin ella los backups no se pueden descifrar.
ENCRYPTION_KEY_FILE=/etc/sipeg/backup.key
# RETENTION_DAYS: dias de backups locales antes de borrarse.
RETENTION_DAYS=14
# OFFSITE_CMD: comando opcional que se ejecuta al final. Ejemplo con rclone:
# OFFSITE_CMD='rclone copy "$BACKUP_DIR" sipeg-backups:sipeg-utp/ --include "sipeg_utp_*.dump.enc"'
OFFSITE_CMD=
```

- [x] **Step 2: Crear `deploy/backup/pg-backup.sh` [repo]**

```bash
#!/usr/bin/env bash
# Backup cifrado de PostgreSQL SIPEG UTP.
#
# - pg_dump en formato custom dentro del contenedor `db`.
# - Cifrado AES-256-CBC con PBKDF2 y la clave de ENCRYPTION_KEY_FILE.
# - Retencion local por antiguedad y hook OFFSITE_CMD opcional.
set -euo pipefail

ENV_FILE="${BACKUP_ENV_FILE:-/etc/sipeg/backup.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Falta $ENV_FILE" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${COMPOSE_DIR:?COMPOSE_DIR requerido}"
: "${COMPOSE_FILES:?COMPOSE_FILES requerido}"
: "${BACKUP_DIR:?BACKUP_DIR requerido}"
: "${ENCRYPTION_KEY_FILE:?ENCRYPTION_KEY_FILE requerido}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RAW_FILE="$(mktemp)"
OUT_FILE="$BACKUP_DIR/sipeg_utp_${STAMP}.dump.enc"

cleanup() { rm -f "$RAW_FILE"; }
trap cleanup EXIT

install -d -m 0700 "$BACKUP_DIR"

cd "$COMPOSE_DIR"

# shellcheck disable=SC2086
docker compose $COMPOSE_FILES --env-file .env.prod \
  exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$RAW_FILE"

openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt \
  -pass "file:$ENCRYPTION_KEY_FILE" \
  -in "$RAW_FILE" -out "$OUT_FILE"

chmod 600 "$OUT_FILE"

find "$BACKUP_DIR" -name 'sipeg_utp_*.dump.enc' -type f -mtime +"$RETENTION_DAYS" -delete

if [[ -n "${OFFSITE_CMD:-}" ]]; then
  eval "$OFFSITE_CMD"
fi

echo "backup_ok file=$OUT_FILE size=$(stat -c%s "$OUT_FILE")"
```

- [x] **Step 3: Crear `deploy/backup/pg-restore-verify.sh` [repo]** — desviacion del plan: la verificacion consulta `"users"` (tabla real del schema, `@@map("users")`), no `"user"`

```bash
#!/usr/bin/env bash
# Restore de prueba del backup mas reciente en un contenedor efimero.
# No toca la base de produccion.
set -euo pipefail

ENV_FILE="${BACKUP_ENV_FILE:-/etc/sipeg/backup.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Falta $ENV_FILE" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${BACKUP_DIR:?BACKUP_DIR requerido}"
: "${ENCRYPTION_KEY_FILE:?ENCRYPTION_KEY_FILE requerido}"

LATEST="$(find "$BACKUP_DIR" -name 'sipeg_utp_*.dump.enc' -type f | sort | tail -n1)"
if [[ -z "$LATEST" ]]; then
  echo 'No hay backups para verificar.' >&2
  exit 1
fi

RAW_FILE="$(mktemp)"
cleanup() {
  rm -f "$RAW_FILE"
  docker rm -f sipeg-restore-verify >/dev/null 2>&1 || true
}
trap cleanup EXIT

openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -pass "file:$ENCRYPTION_KEY_FILE" \
  -in "$LATEST" -out "$RAW_FILE"

docker run -d --name sipeg-restore-verify \
  -e POSTGRES_PASSWORD=verify-only \
  -e POSTGRES_DB=sipeg_verify \
  postgres:18.6-alpine@sha256:6c538e7206ea40ff740ef27883529390a690b6ead6ba96b44c67a9f7c638e8fd \
  >/dev/null

for _ in $(seq 1 30); do
  if docker exec sipeg-restore-verify pg_isready -U postgres -d sipeg_verify >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker cp "$RAW_FILE" sipeg-restore-verify:/tmp/restore.dump
docker exec sipeg-restore-verify \
  pg_restore -U postgres -d sipeg_verify --no-owner /tmp/restore.dump

MIGRATIONS="$(docker exec sipeg-restore-verify \
  psql -U postgres -d sipeg_verify -tAc 'select count(*) from _prisma_migrations')"
USERS="$(docker exec sipeg-restore-verify \
  psql -U postgres -d sipeg_verify -tAc 'select count(*) from "user"')"

if [[ "$MIGRATIONS" -lt 1 ]]; then
  echo "Restore invalido: _prisma_migrations vacia" >&2
  exit 1
fi

echo "restore_verify_ok file=$LATEST migrations=$MIGRATIONS users=$USERS"
```

- [x] **Step 4: Crear `deploy/backup/sipeg-pg-backup.service` [repo]**

```ini
[Unit]
Description=Backup cifrado de PostgreSQL SIPEG UTP
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=root
EnvironmentFile=/etc/sipeg/backup.env
ExecStart=/usr/local/sbin/sipeg-pg-backup
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
```

- [x] **Step 5: Crear `deploy/backup/sipeg-pg-backup.timer` [repo]**

```ini
[Unit]
Description=Backup diario de PostgreSQL SIPEG UTP

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
```

- [x] **Step 6: Crear `deploy/backup/install.sh` [repo]**

```bash
#!/usr/bin/env bash
# Instala scripts y units de backup, y crea /etc/sipeg/backup.env si falta.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_DIR="$REPO_DIR/deploy/backup"

if [[ "$(id -u)" -ne 0 ]]; then
  echo 'Ejecutar con sudo.' >&2
  exit 1
fi

install -m 0755 "$BACKUP_DIR/pg-backup.sh" /usr/local/sbin/sipeg-pg-backup
install -m 0755 "$BACKUP_DIR/pg-restore-verify.sh" /usr/local/sbin/sipeg-pg-restore-verify
install -m 0644 "$BACKUP_DIR/sipeg-pg-backup.service" /etc/systemd/system/sipeg-pg-backup.service
install -m 0644 "$BACKUP_DIR/sipeg-pg-backup.timer" /etc/systemd/system/sipeg-pg-backup.timer

install -d -m 0700 /etc/sipeg
if [[ ! -f /etc/sipeg/backup.env ]]; then
  install -m 0600 "$BACKUP_DIR/backup.env.example" /etc/sipeg/backup.env
  echo 'EDITAR /etc/sipeg/backup.env (COMPOSE_DIR, COMPOSE_FILES, OFFSITE_CMD) antes de usar el timer.'
fi

systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/sipeg-pg-backup.service /etc/systemd/system/sipeg-pg-backup.timer
systemctl enable sipeg-pg-backup.timer
echo 'Backup instalado. Iniciar una vez a mano: systemctl start sipeg-pg-backup.service'
```

- [x] **Step 7: Dar permisos [repo]**

```bash
chmod +x deploy/backup/install.sh deploy/backup/pg-backup.sh deploy/backup/pg-restore-verify.sh
bash -n deploy/backup/install.sh
bash -n deploy/backup/pg-backup.sh
bash -n deploy/backup/pg-restore-verify.sh
```

- [x] **Step 8: Generar la clave de cifrado [VPS]** — clave generada, copiada al gestor de secretos fuera del VPS y temporales borrados en ambos lados; original intacto en `/etc/sipeg/backup.key` (600 root)

```bash
sudo install -d -m 0700 /etc/sipeg
openssl rand -hex 32 | sudo tee /etc/sipeg/backup.key >/dev/null
sudo chmod 600 /etc/sipeg/backup.key
```

Copiar `/etc/sipeg/backup.key` a un gestor de secretos **fuera del VPS**. Sin
esa copia, un fallo del VPS deja los backups irrecuperables.

- [ ] **Step 9: Instalar y configurar [VPS]** — diferido al dia del despliegue (el `install.sh` registra y habilita el timer con la config completa; con la demo pendiente el timer fallaria al no existir db)

```bash
sudo deploy/backup/install.sh
sudo nano /etc/sipeg/backup.env
```

Ajustar `COMPOSE_DIR`, `COMPOSE_FILES` (quitar `compose.cloudflare.yaml` si el
overlay aun no existe) y `OFFSITE_CMD`.

- [ ] **Step 10: Ejecutar el primer backup y verificar [VPS]** — diferido al despliegue (requiere contenedor db con pg_dump)

```bash
sudo systemctl start sipeg-pg-backup.service
sudo journalctl -u sipeg-pg-backup.service -n 20 --no-pager
sudo ls -la /var/backups/sipeg/
sudo /usr/local/sbin/sipeg-pg-restore-verify
```

Esperado: `backup_ok file=...`, un archivo `.dump.enc` de tamano no trivial y
`restore_verify_ok ... migrations=<n> users=<n>`.

- [ ] **Step 11: Verificar el timer y programar la prueba mensual [VPS]** — diferido al despliegue

```bash
systemctl list-timers sipeg-pg-backup.timer
systemctl is-enabled sipeg-pg-backup.timer
```

Esperado: proxima ejecucion a las 02:30. Agendar en el calendario del equipo
una prueba de restore trimestral con `sipeg-pg-restore-verify`.

---

## Tarea 10: Alertas de Grafana por correo

**Files:**
- Create: `observability/grafana/provisioning/alerting/contact-points.yaml`
- Create: `observability/grafana/provisioning/alerting/notification-policies.yaml`
- Modify: `compose.observability.yaml`
- Modify: `.env.prod.example`

- [ ] **Step 1: Crear `contact-points.yaml` [repo]**

El provisioning de alertas interpola variables de entorno con sintaxis
`$VARIABLE`.

```yaml
# Contact point de correo para las alertas de Grafana (SIPEG UTP).
# Provisionado por archivo; recrear Grafana para aplicarlo.
# `$ALERT_EMAIL_TO` se interpola desde el entorno del contenedor.

apiVersion: 1

contactPoints:
  - orgId: 1
    name: sipeg-email
    receivers:
      - uid: sipeg-email
        type: email
        settings:
          addresses: $ALERT_EMAIL_TO
          singleEmail: true
        disableResolveMessage: false
```

- [ ] **Step 2: Crear `notification-policies.yaml` [repo]**

```yaml
# Politica de notificacion por defecto: todo va al contact point sipeg-email.
# Provisionada por archivo; recrear Grafana para aplicarla.

apiVersion: 1

policies:
  - orgId: 1
    receiver: sipeg-email
    group_by:
      - grafana_folder
      - alertname
    group_wait: 30s
    group_interval: 5m
    repeat_interval: 4h
```

- [ ] **Step 3: Modificar `compose.observability.yaml` [repo]**

En el servicio `grafana`, dentro de `environment`, agregar:

```yaml
      # SMTP de alertas. En produccion .env.prod define GF_SMTP_ENABLED=true,
      # GF_SMTP_HOST y ALERT_EMAIL_TO. En desarrollo queda deshabilitado y el
      # contact point apunta a un correo ficticio.
      GF_SMTP_ENABLED: ${GF_SMTP_ENABLED:-false}
      GF_SMTP_HOST: ${GF_SMTP_HOST:-mailpit:1025}
      GF_SMTP_USER: ${MAIL_USER:-}
      GF_SMTP_PASSWORD: ${MAIL_PASSWORD:-}
      GF_SMTP_FROM_ADDRESS: ${ALERT_EMAIL_FROM:-no-reply@sipeg.local}
      GF_SMTP_FROM_NAME: ${ALERT_EMAIL_FROM_NAME:-SIPEG UTP Alertas}
      GF_SMTP_STARTTLS_POLICY: ${GF_SMTP_STARTTLS_POLICY:-MandatoryStartTLS}
      ALERT_EMAIL_TO: ${ALERT_EMAIL_TO:-alerts@sipeg.local}
```

En el mismo servicio, agregar los limites:

```yaml
    mem_limit: ${GRAFANA_MEM_LIMIT:-512m}
    cpus: ${GRAFANA_CPUS:-1.0}
    pids_limit: 512
```

En `loki`:

```yaml
    mem_limit: ${LOKI_MEM_LIMIT:-512m}
    cpus: ${LOKI_CPUS:-1.0}
    pids_limit: 512
```

En `alloy`:

```yaml
    mem_limit: ${ALLOY_MEM_LIMIT:-256m}
    cpus: ${ALLOY_CPUS:-0.5}
    pids_limit: 256
```

En `docker-socket-proxy`:

```yaml
    mem_limit: ${SOCKET_PROXY_MEM_LIMIT:-64m}
    pids_limit: 128
    read_only: true
    tmpfs:
      - /tmp
```

- [ ] **Step 4: Documentar en `.env.prod.example` [repo]**

Agregar una seccion antes del bloque de SMTP:

```env
# Alertas de Grafana. Reutiliza las credenciales MAIL_* de arriba; GF_SMTP_HOST
# debe incluir el puerto (587 para STARTTLS). Sin ALERT_EMAIL_TO las alertas no
# llegan a nadie.
GF_SMTP_ENABLED=true
GF_SMTP_HOST='smtp.proveedor.com:587'
ALERT_EMAIL_TO=''
ALERT_EMAIL_FROM='no-reply@sipeg-utp.com'
ALERT_EMAIL_FROM_NAME='SIPEG UTP Alertas'
```

Agregar tambien los limites de observabilidad:

```env
LOKI_MEM_LIMIT=512m
LOKI_CPUS=1.0
GRAFANA_MEM_LIMIT=512m
GRAFANA_CPUS=1.0
ALLOY_MEM_LIMIT=256m
ALLOY_CPUS=0.5
SOCKET_PROXY_MEM_LIMIT=64m
```

- [ ] **Step 5: Completar `.env.prod` en el VPS [VPS]**

```bash
sudo nano /opt/sipeg-utp-backend/.env.prod
```

Definir `GF_SMTP_ENABLED=true`, `GF_SMTP_HOST`, `ALERT_EMAIL_TO`,
`ALERT_EMAIL_FROM` y `ALERT_EMAIL_FROM_NAME`. No imprimir el archivo.

- [ ] **Step 6: Recrear Grafana y verificar el provisioning [VPS]**

```bash
sudo docker compose \
  -f compose.prod.yaml \
  -f compose.observability.yaml \
  --env-file .env.prod \
  up -d --force-recreate grafana
sudo docker compose \
  -f compose.prod.yaml \
  -f compose.observability.yaml \
  --env-file .env.prod \
  logs grafana --since 2m | grep -i 'provision'
```

Esperado: logs de provisioning sin errores.

- [ ] **Step 7: Verificar contact point y politica aplicados [VPS]**

```bash
sudo docker compose \
  -f compose.prod.yaml \
  -f compose.observability.yaml \
  --env-file .env.prod \
  exec -T grafana sh -c 'curl -sf -u "admin:$GF_SECURITY_ADMIN_PASSWORD" http://localhost:3000/api/v1/provisioning/contact-points' \
  | grep -o sipeg-email
sudo docker compose \
  -f compose.prod.yaml \
  -f compose.observability.yaml \
  --env-file .env.prod \
  exec -T grafana sh -c 'curl -sf -u "admin:$GF_SECURITY_ADMIN_PASSWORD" http://localhost:3000/api/v1/provisioning/policies' \
  | grep -o sipeg-email
```

Esperado: `sipeg-email` en ambas salidas.

- [ ] **Step 8: Enviar una notificacion de prueba [operador]**

En `http://127.0.0.1:3001` (o por el tunel con Access): **Alerting → Contact
points → sipeg-email → Test**. Esperado: correo recibido en `ALERT_EMAIL_TO`.

- [ ] **Step 9: Confirmar que el verificador de observabilidad sigue verde [repo]**

```bash
pnpm run observability:check
```

Esperado: sin fallos.

---

## Tarea 11 (opcional): Monitorizacion de host con Prometheus

Ejecutar solo si el VPS tiene al menos 1 GB de RAM libre tras el stack actual.
Si no, registrar la decision en el ADR y dejar la alerta de disco como
pendiente.

**Files:**
- Create: `observability/prometheus/prometheus.yml`
- Create: `observability/grafana/provisioning/datasources/prometheus.yaml`
- Modify: `compose.observability.yaml`
- Modify: `observability/grafana/provisioning/alerting/rules.yaml`
- Modify: `.env.prod.example`

- [ ] **Step 1: Obtener tag y digest vigentes [operador]**

```bash
docker buildx imagetools inspect prom/prometheus:latest
docker buildx imagetools inspect prom/node-exporter:latest
```

Elegir una version estable publicada (no `latest`) y anotar tag + digest. La
politica del ADR-0007 exige `repo:tag@sha256:...`.

- [ ] **Step 2: Crear `observability/prometheus/prometheus.yml` [repo]**

```yaml
global:
  scrape_interval: 60s

scrape_configs:
  - job_name: node
    static_configs:
      - targets: ['node-exporter:9100']
```

- [ ] **Step 3: Agregar servicios a `compose.observability.yaml` [repo]**

Reemplazar `<TAG_PROMETHEUS>` y `<TAG_NODE_EXPORTER>` por los valores del
Step 1:

```yaml
  prometheus:
    image: prom/prometheus:<TAG_PROMETHEUS>
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.retention.time=90d'
      - '--storage.tsdb.retention.size=2GB'
    volumes:
      - ./observability/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus_data:/prometheus
    expose:
      - '9090'
    restart: unless-stopped
    logging: *logging
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    mem_limit: ${PROMETHEUS_MEM_LIMIT:-512m}
    pids_limit: 512
    networks:
      - observability

  node-exporter:
    image: prom/node-exporter:<TAG_NODE_EXPORTER>
    command:
      - '--path.rootfs=/host'
    pid: host
    volumes:
      - '/:/host:ro,rslave'
    expose:
      - '9100'
    restart: unless-stopped
    logging: *logging
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    mem_limit: ${NODE_EXPORTER_MEM_LIMIT:-64m}
    pids_limit: 128
    networks:
      - observability
```

Agregar `prometheus_data:` al bloque `volumes:`.

- [ ] **Step 4: Crear el datasource `prometheus.yaml` [repo]**

```yaml
# Datasource Prometheus para metricas de host (SIPEG UTP).
apiVersion: 1
prune: true

datasources:
  - name: Prometheus
    uid: prometheus
    type: prometheus
    access: proxy
    orgId: 1
    url: http://prometheus:9090
    isDefault: false
    editable: false
    jsonData:
      manageAlerts: true
```

- [ ] **Step 5: Agregar la regla de disco a `rules.yaml` [repo]**

Agregar un segundo grupo al final de `groups:`:

```yaml
  - orgId: 1
    name: sipeg-host
    folder: 'SIPEG UTP'
    interval: 5m
    rules:
      - uid: sipeg-disk-full
        title: 'Host: disco por encima del 80%'
        condition: B
        for: 15m
        noDataState: OK
        execErrState: Alerting
        labels:
          severity: warning
        annotations:
          summary: 'El disco raiz del VPS supera el 80% de uso'
          description: >-
            node_filesystem_avail_bytes / node_filesystem_size_bytes por encima
            de 0.8 en el filesystem raiz durante 15 minutos. Revisar volumenes
            Docker, backups locales y retencion de Loki.
        data:
          - refId: A
            relativeTimeRange:
              from: 900
              to: 0
            datasourceUid: prometheus
            queryType: instant
            model:
              refId: A
              instant: true
              editorMode: code
              expr: >-
                100 * (1 - node_filesystem_avail_bytes{mountpoint="/",fstype!="tmpfs"}
                / node_filesystem_size_bytes{mountpoint="/",fstype!="tmpfs"})
              datasource:
                type: prometheus
                uid: prometheus
              intervalMs: 1000
              maxDataPoints: 43200
          - refId: B
            relativeTimeRange:
              from: 0
              to: 0
            datasourceUid: __expr__
            queryType: ''
            model:
              refId: B
              type: classic_conditions
              expression: A
              datasource:
                type: __expr__
                uid: __expr__
              conditions:
                - type: query
                  query:
                    params:
                      - A
                    reducer:
                      type: last
                      params: []
                    operator:
                      type: and
                    evaluator:
                      type: gt
                      params:
                        - 80
```

- [ ] **Step 6: Documentar variables [repo]**

En `.env.prod.example`:

```env
PROMETHEUS_MEM_LIMIT=512m
NODE_EXPORTER_MEM_LIMIT=64m
```

- [ ] **Step 7: Aplicar y verificar [VPS]**

```bash
sudo docker compose \
  -f compose.prod.yaml \
  -f compose.observability.yaml \
  --env-file .env.prod \
  up -d
sudo docker compose \
  -f compose.prod.yaml \
  -f compose.observability.yaml \
  --env-file .env.prod \
  up -d --force-recreate grafana
```

Verificar en Grafana: datasource `Prometheus` presente y regla
`sipeg-disk-full` en la carpeta `SIPEG UTP`. Comprobar que la consulta devuelve
un valor (`Explore` con el datasource Prometheus).

---

## Tarea 12: Auditd, AIDE y sudoers

**Files:**
- Create: `deploy/host/auditd/99-sipeg.rules`
- Create: `deploy/host/sudoers/90-sipeg`

- [x] **Step 1: Crear `deploy/host/auditd/99-sipeg.rules` [repo]** — revisado y aprobado; el watch de `/var/run/docker.sock` puede generar volumen alto cuando Alloy sondee el socket tras el despliegue (retirar solo esa regla si es excesivo)

`__DEPLOY_ENV_PROD__` lo sustituye el instalador por la ruta real de
`.env.prod`; si el archivo no existe, la linea se omite.

```text
# Auditoria de archivos sensibles SIPEG UTP. Cargar con augenrules --load.

-w /etc/ssh/sshd_config -p wa -k sipeg_ssh
-w /etc/ssh/sshd_config.d/ -p wa -k sipeg_ssh
-w /etc/sudoers -p wa -k sipeg_sudo
-w /etc/sudoers.d/ -p wa -k sipeg_sudo
-w /etc/docker/daemon.json -p wa -k sipeg_docker
-w /etc/ufw/ -p wa -k sipeg_firewall
-w /var/run/docker.sock -p rwa -k sipeg_docker_socket
-w /etc/systemd/system/sipeg-pg-backup.timer -p wa -k sipeg_backup
-w __DEPLOY_ENV_PROD__ -p rwa -k sipeg_secrets
```

- [x] **Step 2: Crear `deploy/host/sudoers/90-sipeg` [repo]** — revisado y aprobado

```text
Defaults timestamp_timeout=5
Defaults use_pty
Defaults passwd_tries=3
```

- [x] **Step 3: Aplicar [VPS]** — `install.sh audit` + `install.sh sudo` aplicados; la regla `sipeg_secrets` se omite hasta que exista `.env.prod` (re-ejecutar `install.sh audit` al desplegar); postfix quedo instalado inerte ("No configuration")

```bash
sudo apt-get install -y auditd aide aide-common
sudo deploy/host/install.sh audit
sudo deploy/host/install.sh sudo
```

- [x] **Step 4: Verificar auditd [VPS]** — 8 reglas `sipeg_*` cargadas y servicio `active`

```bash
sudo auditctl -l | grep sipeg_
sudo systemctl is-active auditd
```

Esperado: las reglas con clave `sipeg_*` cargadas y el servicio activo.

- [x] **Step 5: Inicializar AIDE y habilitar el chequeo diario [VPS]** — `aide.db` creado (37 MB) y `dailyaidecheck.timer` activo

```bash
sudo aideinit
sudo ls -la /var/lib/aide/
systemctl list-timers --all | grep -i aide || true
```

Si `aide.db` no existe y `aide.db.new` si:

```bash
sudo cp /var/lib/aide/aide.db.new /var/lib/aide/aide.db
```

Si no hay timer, habilitar el de la distribucion:

```bash
sudo systemctl enable --now dailyaidecheck.timer || true
systemctl list-timers --all | grep -i aide
```

Esperado: base AIDE creada y un timer diario listado. La primera
`sudo aide --check` puede tardar varios minutos.

- [x] **Step 6: Verificar sudoers [VPS]** — `visudo -c` parsed OK; `(ALL : ALL) ALL` sin `NOPASSWD` no intencionadas

```bash
sudo visudo -c
sudo -l -U "$USER" | head -20
```

Esperado: sintaxis correcta y permisos de sudo listados sin entradas
`NOPASSWD` no intencionadas.

---

## Tarea 13: Verificador, auditoria final y drill de reinicio

**Files:**
- Create: `deploy/host/verify.sh`

- [x] **Step 1: Crear `deploy/host/verify.sh` [repo]** — ajuste post-ejecucion: el check de puertos excluye todo el rango loopback `127\.` (no solo `127.0.0.1`) porque systemd-resolved escucha en `127.0.0.53/54:53`; sin el ajuste reportaba un FAIL falso

```bash
#!/usr/bin/env bash
# Verificador PASS/FAIL de la linea base de endurecimiento SIPEG UTP.
# Ejecutar con sudo (sshd -T y auditctl requieren root).
set -uo pipefail

PASS=0
FAIL=0

check() {
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    printf 'PASS  %s\n' "$desc"
    PASS=$((PASS + 1))
  else
    printf 'FAIL  %s\n' "$desc"
    FAIL=$((FAIL + 1))
  fi
}

check_value() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    printf 'PASS  %s (%s)\n' "$desc" "$actual"
    PASS=$((PASS + 1))
  else
    printf 'FAIL  %s (esperado %s, obtenido %s)\n' "$desc" "$expected" "$actual"
    FAIL=$((FAIL + 1))
  fi
}

check_value 'sshd PasswordAuthentication' no "$(sshd -T 2>/dev/null | awk '/^passwordauthentication /{print $2}')"
check_value 'sshd PermitRootLogin' no "$(sshd -T 2>/dev/null | awk '/^permitrootlogin /{print $2}')"
check_value 'sshd MaxAuthTries' 3 "$(sshd -T 2>/dev/null | awk '/^maxauthtries /{print $2}')"
check 'fail2ban sshd activo' fail2ban-client status sshd
check 'ufw activo' bash -c 'ufw status | grep -q "^Status: active"'
check_value 'sysctl kernel.dmesg_restrict' 1 "$(sysctl -n kernel.dmesg_restrict)"
check_value 'sysctl kernel.kptr_restrict' 2 "$(sysctl -n kernel.kptr_restrict)"
check_value 'sysctl kernel.yama.ptrace_scope' 1 "$(sysctl -n kernel.yama.ptrace_scope)"
check_value 'sysctl vm.swappiness' 10 "$(sysctl -n vm.swappiness)"
check 'unattended-upgrades activo' systemctl is-active --quiet unattended-upgrades
check 'auditd activo' systemctl is-active --quiet auditd
check 'reglas auditd cargadas' bash -c 'auditctl -l | grep -q sipeg_'
check 'AIDE instalado' command -v aide
check 'timer de backup habilitado' systemctl is-enabled --quiet sipeg-pg-backup.timer
check 'ultimo backup menor a 26h' bash -c 'find /var/backups/sipeg -name "sipeg_utp_*.dump.enc" -mmin -1560 | grep -q .'
check 'docker live-restore' bash -c 'test "$(docker info -f "{{.LiveRestoreEnabled}}")" = "true"'
check 'docker icc desactivado' bash -c 'test "$(docker network inspect bridge -f "{{index .Options \"com.docker.network.bridge.enable_icc\"}}")" = "false"'
check 'api rootfs read-only' bash -c 'test "$(docker inspect -f "{{.HostConfig.ReadonlyRootfs}}" $(docker ps -q --filter label=com.docker.compose.service=api))" = "true"'
check 'contact point sipeg-email aplicado' bash -c 'docker exec $(docker ps -q --filter label=com.docker.compose.service=grafana) sh -c "curl -sf -u \"admin:\$GF_SECURITY_ADMIN_PASSWORD\" http://localhost:3000/api/v1/provisioning/contact-points" | grep -q sipeg-email'
check 'sin puertos fuera de loopback (excepto 22)' bash -c 'test -z "$(ss -tulpnH | awk "\$5 !~ /^(127\.0\.0\.1|\[::1\])/ && \$5 !~ /:22$/")"'
check 'docker sin puertos publicos fuera de loopback' bash -c 'test -z "$(docker ps --format "{{.Ports}}" | grep -v "127.0.0.1" | grep -v "^$")"'

printf '\nResumen: %d PASS, %d FAIL\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
```

- [x] **Step 2: Dar permisos y ejecutar [repo + VPS]** — ejecutado con sudo: 17 PASS, 4 FAIL esperados (timer y ultimo backup, api read-only, contact point), todos ligados al despliegue

```bash
chmod +x deploy/host/verify.sh
```

```bash
sudo deploy/host/verify.sh
```

Esperado: `Resumen: 21 PASS, 0 FAIL`. Cada `FAIL` se corrige antes de
continuar.

- [x] **Step 3: Auditoria con Lynis [VPS]** — Hardening index 74, 267 tests. 32 sugerencias clasificadas: las que contradicen el plan se descartan con justificacion (puerto 22, sysctl, jail.d, particiones, USB) y el resto queda como backlog para el ADR; `lynis.timer` habilitado

```bash
sudo apt-get install -y lynis
sudo lynis audit system --quick --no-colors | tail -40
```

Revisar el `Hardening index` y las sugerencias. No aplicar sugerencias que
contradigan este plan (por ejemplo, deshabilitar Docker o cambiar la politica
de claves SSH); anotar el resto como mejoras futuras.

- [x] **Step 4: Auditoria de Docker Bench (una sola ejecucion) [VPS]** — 74 checks, 37 PASS. Requiere `-e DOCKER_API_VERSION=1.44` (la imagen trae CLI 18.06/API 1.38 y el daemon API 1.56 exige minimo 1.40) y montar `/usr/lib/systemd`. Ajustes derivados: watches `sipeg_docker` sobre `docker.service`, `docker.socket` y `/etc/default/docker`, y `"userland-proxy": false`; imagen `cloudflare/cloudflared:latest` eliminada. Riesgos aceptados para el ADR: particiones separadas, `/var/lib/docker`, userns-remap, plugin de autorizacion, healthchecks de imagenes oficiales. Aplicado en VPS: 11 reglas cargadas y `docker ok`; auditd 4.x advierte "Old style watch rules are slower" (sintaxis `-w` legacy, funcional; migrar a `-a always,exit -F path=` como mejora futura)

```bash
docker run --rm --net host --pid host --userns host --cap-add audit_control \
  -e DOCKER_CONTENT_TRUST=1 \
  -v /etc:/etc:ro -v /var/lib:/var/lib:ro -v /var/run/docker.sock:/var/run/docker.sock:ro \
  --label docker_bench_security \
  docker/docker-bench-security
```

Revisar WARN aplicables. La imagen es efimera de diagnostico: la politica de
digests aplica al stack, no a esta ejecucion puntual.

- [x] **Step 5: Regresion del repositorio [repo]** — `pnpm test` 1623 pasan (9 skip), `typecheck`, `lint` y `build` sin errores, `docs:check` sin drift

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run docs:check
```

Esperado: todo en verde. Este plan no cambia `src/`, asi que cualquier fallo
es preexistente o de entorno.

- [ ] **Step 6: Drill de reinicio [VPS]** — diferido al despliegue: el esperado incluye `db`/`api`/observabilidad arriba y health publico

```bash
sudo reboot
```

Esperar 2 minutos y reconectar:

```bash
sudo docker compose \
  -f compose.prod.yaml \
  -f compose.observability.yaml \
  --env-file .env.prod \
  ps -a
curl -fsS https://api.sipeg-utp.com/api/v1/health
sudo deploy/host/verify.sh
```

Esperado: `db` saludable, `api` y observabilidad arriba, tunel Healthy en
Cloudflare, health publico `200` con `authJwksReachable: true` y el verificador
sin fallos.

- [ ] **Step 7: Registrar resultados [repo]**

```bash
git status --short
git diff --stat
```

---

## Tarea 14: ADR-0013 y documentacion

**Files:**
- Create: `docs/adr/adr-0013-vps-hardening-baseline.md`
- Modify: `README.md`
- Modify: `CONTEXT.md`
- Modify: `AGENTS.md`
- Modify: `docs/despliegue.md`

- [ ] **Step 1: Crear el ADR [repo]**

```markdown
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

**Accepted**

## Context

El despliegue de SIPEG UTP vive en un VPS OVH (Ubuntu 24.04 LTS) con Docker
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
  21 comprobaciones PASS/FAIL.
- **IMP-003**: El prefijo `10-` del archivo SSH es funcional: gana a
  `50-cloud-init.conf` por orden alfabetico en `sshd_config.d`.
- **IMP-004**: Las variables de limites y alertas se documentan en
  `.env.prod.example`; los defaults del compose permiten arrancar sin
  definirlas, pero produccion debe fijarlas.
- **IMP-005**: El backup referencia la imagen de PostgreSQL fijada en el
  ADR-0007; actualizar tag y digest juntos.

## References

- **REF-001**: `deploy/README.md` (runbook operativo).
- **REF-002**: `docs/adr/adr-0007-structured-logging-and-observability.md`
  (puertos, spool, imagenes fijadas).
- **REF-003**: `docs/adr/adr-0009-refresh-token-cookie-httponly.md`
  (topologia y cookies).
- **REF-004**: CIS Ubuntu Linux 24.04 LTS Benchmark.
- **REF-005**: OWASP API Security Top 10 y OWASP Logging Cheat Sheet.
```

- [ ] **Step 2: Agregar la seccion al README [repo]**

Insertar antes de `## Scripts`:

````markdown
## Endurecimiento Del VPS

El host de produccion se configura desde `deploy/` con instaladores
idempotentes y un verificador PASS/FAIL:

```bash
sudo deploy/host/install.sh all
sudo deploy/backup/install.sh
sudo deploy/host/verify.sh
```

Cubre SSH con claves y fail2ban, UFW, parches automaticos, sysctl, auditd,
AIDE, limites por contenedor, backups cifrados con restore verificado y alertas
de Grafana por correo. El runbook completo (rotacion de secretos, restore
manual y reversion) esta en `deploy/README.md`. Ver
`docs/adr/adr-0013-vps-hardening-baseline.md`.
````

- [ ] **Step 3: Actualizar `CONTEXT.md` [repo]**

Agregar al final de la seccion `## Seguridad`:

```markdown
### Endurecimiento Del Host

El VPS de produccion se endurece con artefactos versionados en `deploy/`:
SSH solo con claves y fail2ban, UFW, unattended-upgrades, sysctl, auditd,
AIDE, Docker con `no-new-privileges`/limites/capabilities minimas, backups
cifrados de PostgreSQL con restore de prueba y alertas de Grafana con contact
point de correo. `deploy/host/verify.sh` comprueba el estado aplicado. Ver
`docs/adr/adr-0013-vps-hardening-baseline.md`.
```

- [ ] **Step 4: Actualizar `AGENTS.md` [repo]**

Agregar una viñeta a `## Docker Rules`:

```markdown
- El endurecimiento del host vive en `deploy/`: `deploy/host/install.sh` aplica
  la configuracion por componente (con respaldo y validacion) y
  `deploy/host/verify.sh` la comprueba. No editar archivos del host a mano sin
  reflejar el cambio en `deploy/`.
```

- [ ] **Step 5: Marcar la decision de backup en `docs/despliegue.md` [repo]**

En la tabla de "Decisiones derivadas", cambiar la fila #10 a:

```markdown
| 10 | Backup y restore de Postgres | Topologia | Resuelta: `deploy/backup/` con cifrado, retencion, hook offsite y restore de prueba (`deploy/README.md`) |
```

- [ ] **Step 6: Comprobar formato y estado [repo]**

```bash
pnpm exec prettier README.md CONTEXT.md AGENTS.md docs/adr/adr-0013-vps-hardening-baseline.md --check
git status --short
git diff --stat
```

Esperado: sin diferencias de formato (corregir con `--write` si aparecen).
`docs/despliegue.md` y los planes de `docs/superpowers/` ya tienen formato
previo distinto al de Prettier: no reformatearlos completos, solo la linea
editada. Revisar que `.env.prod` no aparezca en `git status`.

---

## Matriz de verificacion

| Control | Comando | Esperado |
| --- | --- | --- |
| SSH solo claves | `sudo sshd -T \| grep passwordauthentication` | `no` |
| fail2ban | `sudo fail2ban-client status sshd` | jail activo |
| Firewall | `sudo ufw status verbose` | deny incoming, 22 limitado |
| Puertos externos | `nmap -Pn -p- <IP>` | solo 22 |
| Parches | `sudo unattended-upgrade --dry-run` | sin errores, Docker incluido |
| Kernel | `sysctl kernel.kptr_restrict` | `2` |
| Docker defaults | `docker info -f '{{.LiveRestoreEnabled}}'` | `true` |
| Limites | `docker inspect -f '{{.HostConfig.Memory}}' <api>` | valor definido |
| Backups | `sudo systemctl start sipeg-pg-backup.service` | `backup_ok` |
| Restore | `sudo /usr/local/sbin/sipeg-pg-restore-verify` | `restore_verify_ok` |
| Alertas | Grafana → Contact points → Test | correo recibido |
| Auditoria | `sudo auditctl -l \| grep sipeg_` | reglas cargadas |
| Todo | `sudo deploy/host/verify.sh` | 21 PASS, 0 FAIL |

## Riesgos y rollback

| Riesgo | Mitigacion |
| --- | --- |
| Lockout SSH al aplicar la tarea 3 | `sshd -t` antes de recargar; segunda sesion de prueba; respaldo por timestamp |
| Corte al reiniciar Docker (tarea 7) | Ventana de mantenimiento; `up -d` inmediato; `live-restore` en reinicios posteriores |
| `db` no arranca con `cap_drop` (tarea 8) | Prueba previa en contenedor temporal; quitar `cap_drop`/`cap_add` y reaplicar |
| `read_only` rompe la API (tarea 8) | Quitar `read_only` y `tmpfs`, `up -d api`, revisar logs |
| Reboot automatico inesperado (tarea 5) | Ventana 03:00 America/Panama; drill de reinicio en tarea 13 |
| Backup ilegible por perder la clave | Copia de `/etc/sipeg/backup.key` en gestor de secretos externo |
| Provisioning de Grafana invalido (tarea 10) | Revisar `logs grafana`; restaurar los YAML previos y recrear |
