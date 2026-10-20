#!/usr/bin/env bash
# Pruebas del recolector de red del host con fixtures temporales.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COLLECTOR="$SCRIPT_DIR/collect-network.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

PASS=0
FAIL=0

pass() { printf 'PASS  %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf 'FAIL  %s\n' "$1"; FAIL=$((FAIL + 1)); }

assert_line() {
  local file="$1" expected="$2" desc="$3"
  if grep -Fqx -- "$expected" "$file"; then
    pass "$desc"
  else
    fail "$desc"
  fi
}

assert_absent() {
  local file="$1" pattern="$2" desc="$3"
  if grep -Fq -- "$pattern" "$file"; then
    fail "$desc"
  else
    pass "$desc"
  fi
}

FIXTURE="$TMP_DIR/net_dev"
OUT_DIR="$TMP_DIR/out"
OUT_FILE="$OUT_DIR/sipeg-host-network.prom"
mkdir -p "$OUT_DIR"

cat > "$FIXTURE" <<'EOF'
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 1111 10 0 0 0 0 0 0 2222 10 0 0 0 0 0 0
  eth0: 123456789 100 0 0 0 0 0 0 987654321 200 0 0 0 0 0 0
docker0: 3333 1 0 0 0 0 0 0 4444 1 0 0 0 0 0 0
veth1234: 5555 1 0 0 0 0 0 0 6666 1 0 0 0 0 0 0
EOF

if PROC_NET_DEV="$FIXTURE" OUTPUT_FILE="$OUT_FILE" "$COLLECTOR"; then
  pass 'el recolector termina correctamente con un fixture valido'
else
  fail 'el recolector termina correctamente con un fixture valido'
fi

assert_line "$OUT_FILE" 'sipeg_host_network_receive_bytes_total{device="eth0"} 123456789' 'rx de eth0'
assert_line "$OUT_FILE" 'sipeg_host_network_transmit_bytes_total{device="eth0"} 987654321' 'tx de eth0'
assert_line "$OUT_FILE" '# TYPE sipeg_host_network_receive_bytes_total counter' 'tipo counter de rx'
assert_line "$OUT_FILE" '# TYPE sipeg_host_network_transmit_bytes_total counter' 'tipo counter de tx'
assert_line "$OUT_FILE" '# TYPE sipeg_host_network_collection_timestamp_seconds gauge' 'tipo gauge del timestamp'
assert_absent "$OUT_FILE" 'device="lo"' 'excluye lo'
assert_absent "$OUT_FILE" 'device="docker0"' 'excluye docker0'
assert_absent "$OUT_FILE" 'device="veth1234"' 'excluye veth'

timestamp="$(awk '$1 == "sipeg_host_network_collection_timestamp_seconds" { print $2 }' "$OUT_FILE")"
now="$(date +%s)"
if [[ "$timestamp" =~ ^[0-9]+$ ]] && (( timestamp >= now - 120 && timestamp <= now + 5 )); then
  pass 'timestamp de recoleccion actual'
else
  fail 'timestamp de recoleccion actual'
fi

PRESERVED="$TMP_DIR/preserved.prom"
printf 'contenido anterior\n' > "$PRESERVED"
if PROC_NET_DEV="$TMP_DIR/no-existe" OUTPUT_FILE="$PRESERVED" "$COLLECTOR" >/dev/null 2>&1; then
  fail 'falla cuando no puede leer /proc/net/dev'
else
  pass 'falla cuando no puede leer /proc/net/dev'
fi
if [[ "$(cat "$PRESERVED")" == 'contenido anterior' ]]; then
  pass 'conserva el archivo anterior si falla la lectura'
else
  fail 'conserva el archivo anterior si falla la lectura'
fi

cat > "$FIXTURE" <<'EOF'
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
  eth0: no-es-entero 1 0 0 0 0 0 0 100 1 0 0 0 0 0 0
EOF

printf 'contenido anterior\n' > "$PRESERVED"
if PROC_NET_DEV="$FIXTURE" OUTPUT_FILE="$PRESERVED" "$COLLECTOR" >/dev/null 2>&1; then
  fail 'rechaza contadores no enteros'
else
  pass 'rechaza contadores no enteros'
fi
if [[ "$(cat "$PRESERVED")" == 'contenido anterior' ]]; then
  pass 'conserva el archivo anterior si los contadores no son enteros'
else
  fail 'conserva el archivo anterior si los contadores no son enteros'
fi

printf '\nResumen: %d PASS, %d FAIL\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
