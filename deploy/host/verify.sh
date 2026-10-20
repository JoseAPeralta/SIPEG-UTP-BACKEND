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
check 'sin puertos fuera de loopback (excepto 22 y DHCP 68)' bash -c 'test -z "$(ss -tulpnH | awk "\$5 !~ /^(127\.|\[::1\])/ && \$5 !~ /:22$/ && \$5 !~ /:68$/")"'
check 'docker sin puertos publicos fuera de loopback' bash -c 'test -z "$(docker ps --format "{{.Ports}}" | tr "," "\n" | sed "s/^ *//" | grep -E "^([0-9.]+|\[[0-9a-f:]+\]):" | grep -Ev "^(127\.|\[::1\])")"'

printf '\nResumen: %d PASS, %d FAIL\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
