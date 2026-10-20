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
systemctl enable --now sipeg-pg-backup.timer
echo 'Backup instalado. Iniciar una vez a mano: systemctl start sipeg-pg-backup.service'
