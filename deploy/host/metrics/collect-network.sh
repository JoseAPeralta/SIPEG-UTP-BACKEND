#!/usr/bin/env bash
# Recolecta los contadores de red del host desde /proc/net/dev y publica un
# archivo .prom para el textfile collector de Node Exporter. Node Exporter no
# comparte el namespace de red del host, asi que esta es la fuente fiable del
# trafico del VPS. Se ejecuta desde sipeg-host-network-metrics.timer.
set -euo pipefail
umask 022

PROC_NET_DEV="${PROC_NET_DEV:-/proc/net/dev}"
OUTPUT_FILE="${OUTPUT_FILE:-/var/lib/sipeg-node-exporter/textfile/sipeg-host-network.prom}"
OUTPUT_DIR="$(dirname -- "$OUTPUT_FILE")"
INTERFACE_RE='^[A-Za-z0-9_.-]{1,15}$'

tmp_file=''
cleanup() {
  if [[ -n "$tmp_file" && -e "$tmp_file" ]]; then
    rm -f -- "$tmp_file"
  fi
}
trap cleanup EXIT

is_virtual() {
  case "$1" in
    lo|docker*|veth*|br-*|virbr*|tun*|tap*|wg*) return 0 ;;
    *) return 1 ;;
  esac
}

tmp_file="$(mktemp "$OUTPUT_DIR/.sipeg-host-network.XXXXXX")"

names=()
rx_values=()
tx_values=()

while IFS= read -r line; do
  [[ "$line" == *:* ]] || continue
  name="${line%%:*}"
  name="${name//[[:space:]]/}"
  [[ -n "$name" ]] || continue
  if is_virtual "$name"; then
    continue
  fi
  if [[ ! "$name" =~ $INTERFACE_RE ]]; then
    printf 'interfaz no valida en /proc/net/dev\n' >&2
    exit 1
  fi

  read -r -a fields <<< "${line#*:}"
  if [[ "${#fields[@]}" -lt 9 ]]; then
    printf 'linea incompleta en /proc/net/dev\n' >&2
    exit 1
  fi

  rx="${fields[0]}"
  tx="${fields[8]}"
  if [[ ! "$rx" =~ ^[0-9]+$ || ! "$tx" =~ ^[0-9]+$ ]]; then
    printf 'contadores no enteros en /proc/net/dev\n' >&2
    exit 1
  fi

  names+=("$name")
  rx_values+=("$rx")
  tx_values+=("$tx")
done < "$PROC_NET_DEV"

if [[ "${#names[@]}" -eq 0 ]]; then
  printf 'no hay interfaces de red validas en %s\n' "$PROC_NET_DEV" >&2
  exit 1
fi

{
  printf '# HELP sipeg_host_network_receive_bytes_total Total bytes received on physical host network interfaces.\n'
  printf '# TYPE sipeg_host_network_receive_bytes_total counter\n'
  for i in "${!names[@]}"; do
    printf 'sipeg_host_network_receive_bytes_total{device="%s"} %s\n' "${names[$i]}" "${rx_values[$i]}"
  done

  printf '# HELP sipeg_host_network_transmit_bytes_total Total bytes transmitted on physical host network interfaces.\n'
  printf '# TYPE sipeg_host_network_transmit_bytes_total counter\n'
  for i in "${!names[@]}"; do
    printf 'sipeg_host_network_transmit_bytes_total{device="%s"} %s\n' "${names[$i]}" "${tx_values[$i]}"
  done

  printf '# HELP sipeg_host_network_collection_timestamp_seconds Unix timestamp of the last successful host network collection.\n'
  printf '# TYPE sipeg_host_network_collection_timestamp_seconds gauge\n'
  printf 'sipeg_host_network_collection_timestamp_seconds %s\n' "$(date +%s)"
} > "$tmp_file"

chmod 0644 "$tmp_file"
mv -f -- "$tmp_file" "$OUTPUT_FILE"
tmp_file=''
