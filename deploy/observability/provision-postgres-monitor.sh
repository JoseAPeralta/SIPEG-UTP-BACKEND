#!/usr/bin/env bash
# Aprovisiona el rol de solo lectura que usa PostgreSQL Exporter.
#
# Es idempotente sobre una base existente: crea el rol si falta, actualiza sus
# atributos en cada ejecucion y reutiliza el secreto ya creado. No usa initdb.d,
# que solo se ejecuta al inicializar un volumen nuevo.
#
# Uso:
#   sudo deploy/observability/provision-postgres-monitor.sh
#   ENV_FILE=.env.prod sudo -E deploy/observability/provision-postgres-monitor.sh
#
# Variables:
#   ENV_FILE                        Archivo de entorno de Compose (default: .env.prod).
#   POSTGRES_MONITOR_PASSWORD_FILE  Ruta del HOST al secreto. Si no esta en el
#                                   entorno se lee de ENV_FILE; default:
#                                   /etc/sipeg/secrets/postgres-monitor-password.
#   POSTGRES_MONITOR_USER           Rol a aprovisionar (default: sipeg_monitor).
#   COMPOSE_BIN                     Comando Compose (default: "docker compose").
#
# La contrasena nunca se pasa por argv ni se imprime. El aprovisionamiento la
# envia por stdin dentro del SQL y la verificacion la entrega como variable de
# entorno del exec.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-.env.prod}"

cd "$REPO_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: no existe ENV_FILE=$ENV_FILE. Copiar .env.prod.example y completarlo." >&2
  exit 1
fi

read_env_value() {
  local key="$1" file="$2" line value
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$file" | tail -n 1 || true)"
  [[ -n "$line" ]] || return 1
  value="${line#*=}"
  value="${value%$'\r'}"
  if [[ ${#value} -ge 2 ]]; then
    case "$value" in
      \'*\') value="${value:1:${#value}-2}" ;;
      \"*\") value="${value:1:${#value}-2}" ;;
    esac
  fi
  printf '%s\n' "$value"
}

MONITOR_USER="${POSTGRES_MONITOR_USER:-}"
if [[ -z "$MONITOR_USER" ]]; then
  MONITOR_USER="$(read_env_value POSTGRES_MONITOR_USER "$ENV_FILE" || true)"
fi
MONITOR_USER="${MONITOR_USER:-sipeg_monitor}"

if [[ ! "$MONITOR_USER" =~ ^[a-z_][a-z0-9_]*$ ]]; then
  echo "ERROR: POSTGRES_MONITOR_USER no es un identificador valido: $MONITOR_USER" >&2
  exit 1
fi

SECRET_FILE="${POSTGRES_MONITOR_PASSWORD_FILE:-}"
if [[ -z "$SECRET_FILE" ]]; then
  SECRET_FILE="$(read_env_value POSTGRES_MONITOR_PASSWORD_FILE "$ENV_FILE" || true)"
fi
SECRET_FILE="${SECRET_FILE:-/etc/sipeg/secrets/postgres-monitor-password}"

if ! command -v openssl >/dev/null 2>&1; then
  echo 'ERROR: falta openssl para generar la contrasena.' >&2
  exit 1
fi

read -r -a COMPOSE_CMD <<< "${COMPOSE_BIN:-docker compose}"
COMPOSE_ARGS=(
  -f compose.prod.yaml
  -f compose.observability.yaml
  -f compose.cloudflare.yaml
  --env-file "$ENV_FILE"
)

if ! "${COMPOSE_CMD[@]}" version >/dev/null 2>&1; then
  echo 'ERROR: Docker Compose no esta disponible con COMPOSE_BIN actual.' >&2
  exit 1
fi

compose() {
  "${COMPOSE_CMD[@]}" "${COMPOSE_ARGS[@]}" "$@"
}

umask 077
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sipeg-postgres-monitor.XXXXXX")"
cleanup() {
  rm -rf -- "$TMP_DIR"
}
trap cleanup EXIT HUP INT TERM

if [[ -e "$SECRET_FILE" ]]; then
  secret_content="$(cat -- "$SECRET_FILE"; printf x)"
  secret_content="${secret_content%x}"
  if [[ -z "$secret_content" ]]; then
    echo "ERROR: el secreto $SECRET_FILE esta vacio." >&2
    exit 1
  fi
  if [[ "$secret_content" == *$'\n'* || "$secret_content" == *$'\r'* ]]; then
    echo "ERROR: el secreto $SECRET_FILE contiene saltos de linea; debe ser una sola linea." >&2
    exit 1
  fi
  if [[ "$secret_content" == *"'"* ]]; then
    echo "ERROR: el secreto $SECRET_FILE contiene comillas simples; usar hexadecimal." >&2
    exit 1
  fi
  password="$secret_content"
  secret_mode="$(stat -c '%a' -- "$SECRET_FILE")"
  if [[ "$secret_mode" != '600' && "$secret_mode" != '400' ]]; then
    echo "Ajustando permisos del secreto existente a 600." >&2
    chmod 0600 -- "$SECRET_FILE"
  fi
else
  secret_dir="$(dirname -- "$SECRET_FILE")"
  if [[ "$secret_dir" != '.' && ! -d "$secret_dir" ]]; then
    install -d -m 0700 -- "$secret_dir"
    chmod 0700 -- "$secret_dir"
  elif [[ "$secret_dir" != '.' ]]; then
    secret_dir_mode="$(stat -c '%a' -- "$secret_dir")"
    if [[ "$secret_dir_mode" != '700' ]]; then
      echo "ADVERTENCIA: $secret_dir no tiene permisos 700; el archivo se creara con 600." >&2
    fi
  fi
  password="$(openssl rand -hex 24)"
  ( set -o noclobber; printf '%s' "$password" > "$SECRET_FILE" )
  chmod 0600 -- "$SECRET_FILE"
  echo "Secreto creado en $SECRET_FILE (0600)." >&2
fi

# El SQL viaja por stdin. La contrasena se declara como variable de psql y se
# usa con :'monitor_password', que la cita como literal. Los backslashes se
# duplican para que psql los trate de forma literal.
escaped_password="${password//\\/\\\\}"
SQL_FILE="$TMP_DIR/provision.sql"

{
  cat <<'SQL'
\set ON_ERROR_STOP on
\set VERBOSITY terse
\getenv dbname POSTGRES_DB
\if :{?dbname}
\else
  \warn 'POSTGRES_DB no esta definido en el contenedor db'
  \quit 1
\endif
SQL

  printf "\\set monitor_user '%s'\n" "$MONITOR_USER"
  printf "\\set monitor_password '%s'\n" "$escaped_password"

  cat <<'SQL'

SELECT format('CREATE ROLE %I LOGIN', :'monitor_user')
WHERE NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = :'monitor_user'
)
\gexec

ALTER ROLE :"monitor_user"
  WITH LOGIN
       PASSWORD :'monitor_password'
       CONNECTION LIMIT 2
       VALID UNTIL 'infinity'
       NOSUPERUSER
       NOCREATEDB
       NOCREATEROLE
       NOREPLICATION
       NOBYPASSRLS;

ALTER ROLE :"monitor_user" SET statement_timeout = '5s';
ALTER ROLE :"monitor_user" SET default_transaction_read_only = on;

GRANT pg_monitor TO :"monitor_user";
REVOKE ALL ON DATABASE :"dbname" FROM :"monitor_user";
GRANT CONNECT ON DATABASE :"dbname" TO :"monitor_user";
SQL
} > "$SQL_FILE"

echo "Aprovisionando el rol ${MONITOR_USER} en la base de datos..." >&2
PSQL_LOG="$TMP_DIR/provision.log"
if ! compose exec -T db sh -c \
  'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f -' \
  < "$SQL_FILE" > "$PSQL_LOG" 2>&1; then
  # Mostrar solo la linea del error, no el contexto SQL: el contexto puede
  # incluir la sentencia ALTER ROLE con la contrasena.
  error_line="$(grep -m 1 -E '(ERROR|FATAL):' "$PSQL_LOG" || true)"
  echo "ERROR: fallo el aprovisionamiento de ${MONITOR_USER}. Revisar que el servicio db este sano." >&2
  if [[ -n "$error_line" ]]; then
    echo "PostgreSQL: $error_line" >&2
  fi
  exit 1
fi

echo "Verificando la conexion TCP y los atributos de ${MONITOR_USER}..." >&2
verification="$(
  PGPASSWORD="$password" MONITOR_USER="$MONITOR_USER" \
    "${COMPOSE_CMD[@]}" "${COMPOSE_ARGS[@]}" exec -T \
    -e PGPASSWORD -e MONITOR_USER db sh -c \
    'exec psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U "$MONITOR_USER" -d "$POSTGRES_DB" -At -f -' <<'SQL'
SELECT concat_ws(
         ':',
         current_user,
         CASE WHEN NOT rolsuper THEN 'true' ELSE 'false' END,
         CASE WHEN rolcanlogin THEN 'true' ELSE 'false' END,
         rolconnlimit,
         CASE WHEN pg_has_role(current_user, 'pg_monitor', 'MEMBER')
              THEN 'true' ELSE 'false' END
       )
FROM pg_catalog.pg_roles
WHERE rolname = current_user;
SQL
)" || {
  echo "ERROR: ${MONITOR_USER} no pudo conectar por TCP. Revisar pg_hba.conf y el secreto." >&2
  exit 1
}

expected="${MONITOR_USER}:true:true:2:true"
if [[ "$verification" != "$expected" ]]; then
  echo "ERROR: atributos inesperados para ${MONITOR_USER}: $verification" >&2
  echo "Se esperaba: $expected" >&2
  exit 1
fi

echo "OK: ${MONITOR_USER} existe, conecta por TCP y tiene CONNECT/pg_monitor sin superusuario." >&2
