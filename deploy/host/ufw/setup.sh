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
