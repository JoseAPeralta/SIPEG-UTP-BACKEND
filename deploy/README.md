# Endurecimiento del VPS de produccion

Artefactos versionados para proteger el VPS OVH que aloja SIPEG UTP.
La topologia publica es Cloudflare Tunnel: no hay puertos entrantes de
aplicacion. Este directorio cubre el host, Docker, backups y alertas.

## Instalacion

```bash
# En el VPS, desde el repositorio desplegado:
sudo deploy/host/install.sh all
sudo deploy/backup/install.sh
sudo deploy/host/verify.sh
```

Componentes individuales de `deploy/host/install.sh`:

| Componente | Que aplica |
| --- | --- |
| `ssh` | Directivas SSH y jail de fail2ban |
| `firewall` | UFW (deny incoming, allow outgoing, SSH limitado) |
| `patches` | unattended-upgrades, needrestart y source de apt de Docker (`resolute`) |
| `kernel` | sysctl, limites de core y journald |
| `docker` | `daemon.json` y reinicio del daemon |
| `sudo` | Politica de sudo |
| `audit` | Reglas de auditd (incluye watch sobre `.env.prod`) |

`DRY_RUN=1` imprime las acciones sin aplicarlas. Cada archivo sobrescrito se
respalda en `/var/backups/sipeg-hardening/<timestamp>/`.

## Backups

1. Generar la clave de cifrado y guardarla fuera del VPS:

   ```bash
   sudo install -d -m 0700 /etc/sipeg
   openssl rand -hex 32 | sudo tee /etc/sipeg/backup.key >/dev/null
   sudo chmod 600 /etc/sipeg/backup.key
   ```

2. Completar `/etc/sipeg/backup.env` (copiado desde
   `deploy/backup/backup.env.example`) y definir `OFFSITE_CMD`.
3. Primer backup y prueba de restore:

   ```bash
   sudo systemctl start sipeg-pg-backup.service
   sudo /usr/local/sbin/sipeg-pg-restore-verify
   ```

## Restore manual en produccion

```bash
# 1. Detener la API para no escribir durante el restore.
docker compose -f compose.prod.yaml -f compose.observability.yaml \
  -f compose.cloudflare.yaml --env-file .env.prod stop api

# 2. Descifrar el backup elegido.
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -pass file:/etc/sipeg/backup.key \
  -in /var/backups/sipeg/sipeg_utp_<STAMP>.dump.enc \
  -out /tmp/restore.dump

# 3. Restaurar (drop y recreate de la base).
docker compose -f compose.prod.yaml -f compose.observability.yaml \
  -f compose.cloudflare.yaml --env-file .env.prod exec -T db \
  sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose -f compose.prod.yaml -f compose.observability.yaml \
  -f compose.cloudflare.yaml --env-file .env.prod exec -T db \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' < /tmp/restore.dump

# 4. Limpiar y levantar la API.
rm -f /tmp/restore.dump
docker compose -f compose.prod.yaml -f compose.observability.yaml \
  -f compose.cloudflare.yaml --env-file .env.prod up -d api
```

## Rotacion de secretos

| Secreto | Efecto de rotarlo | Procedimiento |
| --- | --- | --- |
| `AUTH_SECRET` | Invalida cookies del proveedor; cierra sesiones | Editar `.env.prod`, `up -d api` |
| `AUTH` (claves JWKS) | No se rota a mano: lo gestiona la app | Reiniciar `api` |
| `POSTGRES_PASSWORD` | Exige cambiarla tambien en PostgreSQL | `ALTER USER` + `.env.prod` + `up -d` |
| `LOG_PSEUDONYMIZATION_KEY` | Corta la correlacion de pseudonimos previos | Editar `.env.prod`, `up -d api` |
| `GRAFANA_SECRET_KEY` | Invalida sesiones y ajustes cifrados de Grafana | Editar `.env.prod`, recrear Grafana |
| `GRAFANA_ADMIN_PASSWORD` | Solo aplica con volumen vacio | Cambiar desde la UI |
| `CLOUDFLARE_TUNNEL_TOKEN` | Corta el tunel hasta reiniciar `cloudflared` | Rotar en Cloudflare, `.env.prod`, `up -d cloudflared` |
| `backup.key` | Los backups previos dejan de descifrarse | Regenerar y re-cifrar; conservar la anterior |

## Frontera Cloudflare

El VPS no recibe puertos de aplicacion: todo entra por Tunnel. Checklist de la
cuenta y la zona (manual, en el panel):

- MFA en la cuenta Cloudflare y en OVH; API tokens scoped por zona, nunca la
  Global API Key.
- Tunnel con solo dos rutas: `api.sipeg-utp.com` y `grafana.sipeg-utp.com`.
- Access con politica Allow por correo en Grafana; sin Access en la API (rompe
  al frontend). MFA en los correos administradores.
- WAF managed rules, Bot Fight Mode y reglas de rate limiting para
  `/api/v1/auth/*` y futuros formularios publicos; Turnstile en el registro de
  ponentes.
- Always Use HTTPS, TLS 1.2+ y cache bypass para ambos hostnames.
- Verificar la cadena `X-Forwarded-For` con clientes de dos redes distintas:
  los buckets de rate limiting no deben compartirse.
- Si el proveedor ofrece firewall de red (OVH), activar deny-all entrante
  salvo el 22 y comprobar con `nmap` desde fuera.

## Reversion

- Configuracion del host: restaurar desde
  `/var/backups/sipeg-hardening/<timestamp>/` y recargar el servicio.
- Compose: `git diff` + restaurar el bloque anterior; `IMAGE_TAG` permite
  volver a la imagen previa.
- Docker daemon: restaurar `/etc/docker/daemon.json` y
  `systemctl restart docker`.
