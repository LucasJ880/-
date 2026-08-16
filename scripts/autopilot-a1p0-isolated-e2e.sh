#!/usr/bin/env bash
# Isolated local Postgres E2E for Autopilot A1-P0.
# Does NOT read production DATABASE_URL from .env (explicit override).
# Does NOT start brew services / default clusters. Does NOT touch Production.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NAME="qingyan-a1p0-pg"
PORT="55432"
USER="qingyan"
PASS="a1p0test"
DB="qingyan_a1p0"
URL="postgresql://${USER}:${PASS}@127.0.0.1:${PORT}/${DB}"
PG17_BIN="/usr/local/opt/postgresql@17/bin"
PGDATA="${TMPDIR:-/tmp}/qingyan-a1p0-pgdata"
PGLOG="${TMPDIR:-/tmp}/qingyan-a1p0-pg.log"
MODE=""

assert_localhost_url() {
  python3 - <<'PY'
import os, sys
from urllib.parse import urlparse
raw = os.environ.get("DATABASE_URL", "")
u = urlparse(raw)
host = (u.hostname or "").lower()
if host not in ("127.0.0.1", "localhost", "::1"):
    print("REFUSING: isolated E2E DATABASE_URL is not localhost", file=sys.stderr)
    sys.exit(1)
if "antfibsl" in host or "neon.tech" in host:
    print("REFUSING: remote/production host is not allowed", file=sys.stderr)
    sys.exit(1)
print(f"isolated target host={host} db={(u.path or '/').lstrip('/')}")
PY
}

cleanup() {
  if [[ "$MODE" == "docker" ]]; then
    docker rm -f "$NAME" >/dev/null 2>&1 || true
  elif [[ "$MODE" == "local" ]]; then
    if [[ -x "$PG17_BIN/pg_ctl" && -d "$PGDATA" ]]; then
      "$PG17_BIN/pg_ctl" -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true
    fi
    rm -rf "$PGDATA"
  fi
}
trap cleanup EXIT

start_docker() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" \
    -e POSTGRES_USER="$USER" \
    -e POSTGRES_PASSWORD="$PASS" \
    -e POSTGRES_DB="$DB" \
    -p "${PORT}:5432" \
    pgvector/pgvector:pg16 >/dev/null
  echo "waiting for isolated docker postgres..."
  for _ in $(seq 1 40); do
    if docker exec "$NAME" pg_isready -U "$USER" -d "$DB" >/dev/null 2>&1; then
      MODE="docker"
      return 0
    fi
    sleep 1
  done
  echo "docker postgres failed to become ready" >&2
  return 1
}

start_local_pg17() {
  if [[ ! -x "$PG17_BIN/postgres" ]]; then
    echo "neither docker nor postgresql@17 is available for isolated A1-P0 E2E" >&2
    exit 1
  fi
  if [[ ! -f /usr/local/share/postgresql@17/extension/vector.control ]]; then
    echo "pgvector is not installed for postgresql@17" >&2
    exit 1
  fi
  rm -rf "$PGDATA"
  mkdir -p "$PGDATA"
  echo "initializing isolated local postgres 17 on 127.0.0.1:${PORT}..."
  "$PG17_BIN/initdb" -D "$PGDATA" --locale=en_US.UTF-8 -E UTF-8 \
    --auth-local=trust --auth-host=trust >/dev/null
  {
    echo "listen_addresses = '127.0.0.1'"
    echo "port = ${PORT}"
    echo "unix_socket_directories = '${TMPDIR:-/tmp}'"
    echo "max_connections = 50"
  } >> "$PGDATA/postgresql.conf"
  : > "$PGLOG"
  "$PG17_BIN/pg_ctl" -D "$PGDATA" -l "$PGLOG" start >/dev/null
  echo "waiting for isolated local postgres..."
  for _ in $(seq 1 40); do
    if "$PG17_BIN/pg_isready" -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  "$PG17_BIN/pg_isready" -h 127.0.0.1 -p "$PORT" >/dev/null
  "$PG17_BIN/psql" -h 127.0.0.1 -p "$PORT" -d postgres -v ON_ERROR_STOP=1 <<SQL
CREATE ROLE ${USER} LOGIN SUPERUSER PASSWORD '${PASS}';
CREATE DATABASE ${DB} OWNER ${USER};
SQL
  MODE="local"
}

if command -v docker >/dev/null 2>&1; then
  start_docker
else
  start_local_pg17
fi

# Explicit override so Prisma dotenv cannot use production .env
export DATABASE_URL="$URL"
export DIRECT_URL="$URL"
export NODE_ENV=test
export AUTOPILOT_A1P0_E2E=1
export DATABASE_ENVIRONMENT=isolated
export AUTOPILOT_TELEMETRY_CAPTURE_ENABLED=1
export AUTOPILOT_PROCESSOR_ENABLED=1
unset VERCEL_ENV QINGYAN_RUNTIME_ENV QINGYAN_EXPECTED_DB_PLANE ALLOW_DATABASE_MIGRATION

assert_localhost_url

echo "applying isolated migrations (not production) mode=${MODE}..."
npx prisma migrate deploy

echo "running A1-P0 isolated E2E..."
npx tsx src/lib/autopilot/__tests__/durability-e2e.isolated.test.ts
