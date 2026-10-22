#!/usr/bin/env bash
# Instalador idempotente de la linea base de endurecimiento SIPEG UTP.
#
# Uso:
#   sudo deploy/host/install.sh <componente|all>
#   DRY_RUN=1 sudo deploy/host/install.sh all
#
# Componentes: ssh firewall patches kernel docker aide sudo audit metrics
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
  install_file "$HOST_DIR/apt/docker.sources" /etc/apt/sources.list.d/docker.sources 0644
  run apt-get update
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
  run install -d -m 0755 -o root -g root /usr/local/libexec/sipeg
  install_file "$HOST_DIR/docker/restart-docker-consumers.sh" \
    /usr/local/libexec/sipeg/restart-docker-consumers.sh 0755
  install_file "$HOST_DIR/docker/10-sipeg-consumers.conf" \
    /etc/systemd/system/docker.service.d/10-sipeg-consumers.conf 0644
  run systemctl daemon-reload
  run systemctl restart docker
  log 'docker reiniciado: live-restore conserva los contenedores; el drop-in reinicia proxy/Telegraf/Alloy'
}

component_aide() {
  run apt-get install -y aide aide-common
  install_file "$HOST_DIR/aide/00_aide_sipeg" /etc/aide/aide.conf.d/00_aide_sipeg 0644
  install_file "$HOST_DIR/aide/10-sipeg-resources.conf" \
    /etc/systemd/system/dailyaidecheck.service.d/10-sipeg-resources.conf 0644
  install_file "$HOST_DIR/aide/10-sipeg-timer.conf" \
    /etc/systemd/system/dailyaidecheck.timer.d/10-sipeg-timer.conf 0644
  run systemctl daemon-reload
  run systemd-analyze verify dailyaidecheck.service dailyaidecheck.timer
  run aide.wrapper --config-check
  run systemctl enable dailyaidecheck.timer
  run systemctl restart dailyaidecheck.timer
  log 'AIDE actualizado: exclusiones, prioridad baja y timer 04:00 Panama; ejecutar aideinit -y -f si cambio la configuracion'
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

component_metrics() {
  if ! getent group sipeg-metrics >/dev/null; then
    run groupadd --system sipeg-metrics
  fi
  if ! id -u sipeg-metrics >/dev/null 2>&1; then
    run useradd --system --gid sipeg-metrics --home-dir /nonexistent \
      --no-create-home --shell /usr/sbin/nologin sipeg-metrics
  fi
  run install -d -m 0755 -o root -g root /usr/local/libexec/sipeg
  run install -d -m 0755 -o root -g root /var/lib/sipeg-node-exporter
  # 0755: Node Exporter lee el bind mount como usuario sin privilegios.
  run install -d -m 0755 -o sipeg-metrics -g sipeg-metrics \
    /var/lib/sipeg-node-exporter/textfile
  install_file "$HOST_DIR/metrics/collect-network.sh" \
    /usr/local/libexec/sipeg/collect-network.sh 0755
  install_file "$HOST_DIR/metrics/sipeg-host-network-metrics.service" \
    /etc/systemd/system/sipeg-host-network-metrics.service 0644
  install_file "$HOST_DIR/metrics/sipeg-host-network-metrics.timer" \
    /etc/systemd/system/sipeg-host-network-metrics.timer 0644
  run systemctl daemon-reload
  run systemctl enable --now sipeg-host-network-metrics.timer
}

main() {
  require_root
  local component="${1:-all}"
  case "$component" in
    ssh|firewall|patches|kernel|docker|aide|sudo|audit|metrics) "component_$component" ;;
    all)
      for c in ssh firewall patches kernel docker aide sudo audit metrics; do
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
