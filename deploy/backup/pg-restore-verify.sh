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
  psql -U postgres -d sipeg_verify -tAc 'select count(*) from "users"')"

if [[ "$MIGRATIONS" -lt 1 ]]; then
  echo "Restore invalido: _prisma_migrations vacia" >&2
  exit 1
fi

echo "restore_verify_ok file=$LATEST migrations=$MIGRATIONS users=$USERS"
