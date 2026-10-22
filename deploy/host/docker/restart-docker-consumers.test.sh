#!/usr/bin/env bash
# Pruebas del reinicio de consumidores del socket con un Docker falso.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER="$SCRIPT_DIR/restart-docker-consumers.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

PASS=0
FAIL=0

pass() { printf 'PASS  %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf 'FAIL  %s\n' "$1"; FAIL=$((FAIL + 1)); }

CALLS="$TMP_DIR/calls"
MISSING="$TMP_DIR/missing"
: > "$CALLS"
: > "$MISSING"

cat > "$TMP_DIR/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$CALLS_FILE"

case "$1" in
  info)
    exit 0
    ;;
  ps)
    service=''
    for arg in "$@"; do
      case "$arg" in
        label=com.docker.compose.service=*) service="${arg#label=com.docker.compose.service=}" ;;
      esac
    done
    if grep -Fqx -- "$service" "$MISSING_FILE" 2>/dev/null; then
      exit 0
    fi
    case "$service" in
      docker-socket-proxy) printf 'proxy-id\n' ;;
      telegraf) printf 'telegraf-id\n' ;;
      alloy) printf 'alloy-id\n' ;;
    esac
    ;;
  restart)
    shift
    for id in "$@"; do printf 'restart %s\n' "$id"; done
    ;;
  *)
    exit 1
    ;;
esac
EOF
chmod +x "$TMP_DIR/docker"

run_helper() {
  : > "$CALLS"
  CALLS_FILE="$CALLS" MISSING_FILE="$MISSING" \
    DOCKER_BIN="$TMP_DIR/docker" SIPEG_COMPOSE_PROJECT=sipeg-utp-prod \
    "$HELPER" >/dev/null
}

run_helper

if grep -Fqx -- 'restart proxy-id' "$CALLS"; then
  pass 'reinicia el proxy'
else
  fail 'reinicia el proxy'
fi
if grep -Fqx -- 'restart telegraf-id' "$CALLS"; then
  pass 'reinicia Telegraf'
else
  fail 'reinicia Telegraf'
fi
if grep -Fqx -- 'restart alloy-id' "$CALLS"; then
  pass 'reinicia Alloy'
else
  fail 'reinicia Alloy'
fi
if grep -Fq -- '--filter label=com.docker.compose.project=sipeg-utp-prod' "$CALLS"; then
  pass 'filtra por proyecto Compose'
else
  fail 'filtra por proyecto Compose'
fi

order="$(grep -E '^restart (proxy|telegraf|alloy)-id$' "$CALLS" | tr '\n' ' ' || true)"
if [[ "$order" == 'restart proxy-id restart telegraf-id restart alloy-id ' ]]; then
  pass 'orden proxy -> Telegraf -> Alloy'
else
  fail 'orden proxy -> Telegraf -> Alloy'
fi

printf 'alloy\n' > "$MISSING"
run_helper
if grep -Fqx -- 'restart alloy-id' "$CALLS"; then
  fail 'omite un servicio ausente'
else
  pass 'omite un servicio ausente'
fi
if grep -Fqx -- 'restart proxy-id' "$CALLS"; then
  pass 'sigue reiniciando los servicios presentes'
else
  fail 'sigue reiniciando los servicios presentes'
fi

printf '\nResumen: %d PASS, %d FAIL\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
