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
