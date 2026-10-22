#!/usr/bin/env bash
# Reinicia los consumidores del socket de Docker despues de un arranque del
# daemon. Con live-restore, los contenedores siguen corriendo, pero el bind
# mount de /var/run/docker.sock conserva el inode anterior. El proxy devuelve
# 503 hasta que se reinicia.
set -euo pipefail

DOCKER_BIN="${DOCKER_BIN:-/usr/bin/docker}"
PROJECT="${SIPEG_COMPOSE_PROJECT:-sipeg-utp-prod}"
SERVICES=(docker-socket-proxy telegraf alloy)

for _ in $(seq 1 30); do
  if "$DOCKER_BIN" info >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

for service in "${SERVICES[@]}"; do
  ids="$("$DOCKER_BIN" ps -q \
    --filter "label=com.docker.compose.project=${PROJECT}" \
    --filter "label=com.docker.compose.service=${service}")"
  if [[ -n "$ids" ]]; then
    # shellcheck disable=SC2086
    "$DOCKER_BIN" restart $ids >/dev/null
    printf 'reiniciado %s: %s\n' "$service" "$ids"
  fi
done
