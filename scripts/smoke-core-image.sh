#!/usr/bin/env bash
# Starts a built core image the way production does (ADR 0081) and checks its health:
#   1. PostgreSQL 17, the line Supabase gives new projects.
#   2. Flyway from its own image, as the deploy workflow runs it, with the role that owns the tables.
#   3. The password of pos_app set with ALTER ROLE, as the runbook does once.
#   4. The core with the prod profile, connected as pos_app, until readiness, liveness and health are UP.
# Usage: scripts/smoke-core-image.sh <image>. Every container and the network are removed on exit.

set -euo pipefail

readonly IMAGE="${1:?Usage: $0 <core image>}"
readonly POSTGRES_IMAGE="postgres:17.12@sha256:87c8b42f423b45d5247e6aa8fdb2e7762fec164c68a50fe3eb07e7bfcaf4dbcf"
readonly FLYWAY_IMAGE="flyway/flyway:12.11.0@sha256:455c23d438811c27415f2c28052d0cc4494665a313b6faa41a7ece5242c24f10"
readonly NETWORK="pos-smoke-$$"
readonly DB="pos-smoke-db-$$"
readonly CORE="pos-smoke-core-$$"
readonly PORT="${SMOKE_PORT:-18080}"
# Throwaway passwords of a database that lives for a few seconds and is reachable only from this network.
readonly ADMIN_PASSWORD="smoke-admin-$$"
readonly APP_PASSWORD="smoke-app-$$"

MIGRATIONS_DIR="$(cd "$(dirname "$0")/../services/core/src/main/resources/db/migration" && pwd)"
readonly MIGRATIONS_DIR

cleanup() {
  docker rm --force "$CORE" "$DB" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Prints the last lines of the core log, so a failed start explains itself in CI.
show_core_log() {
  echo "--- last lines of the core log ---" >&2
  docker logs "$CORE" 2>&1 | grep -v '^\s*at ' | tail -40 >&2 || true
}

wait_for_database() {
  for _ in $(seq 1 60); do
    if docker exec "$DB" pg_isready --host=127.0.0.1 --username=postgres >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "PostgreSQL did not become ready." >&2
  return 1
}

wait_for_core() {
  for _ in $(seq 1 90); do
    if curl --silent --fail "http://127.0.0.1:${PORT}/actuator/health/readiness" >/dev/null; then
      return 0
    fi
    if [ "$(docker inspect --format '{{.State.Running}}' "$CORE")" != "true" ]; then
      echo "The core stopped before it was ready." >&2
      show_core_log
      return 1
    fi
    sleep 2
  done
  echo "The core was not ready after three minutes." >&2
  show_core_log
  return 1
}

expect_up() {
  local path="$1" body
  body="$(curl --silent --fail "http://127.0.0.1:${PORT}${path}")"
  if [[ "$body" != *'"status":"UP"'* ]]; then
    echo "${path} answered ${body}" >&2
    show_core_log
    return 1
  fi
  echo "${path}: UP"
}

docker network create "$NETWORK" >/dev/null
docker run --detach --name "$DB" --network "$NETWORK" \
  --env POSTGRES_PASSWORD="$ADMIN_PASSWORD" "$POSTGRES_IMAGE" >/dev/null
wait_for_database

docker run --rm --network "$NETWORK" --volume "${MIGRATIONS_DIR}:/flyway/sql:ro" "$FLYWAY_IMAGE" \
  -url="jdbc:postgresql://${DB}:5432/postgres" -user=postgres -password="$ADMIN_PASSWORD" \
  -outputType=json migrate >/dev/null
docker exec "$DB" psql --username=postgres --set=ON_ERROR_STOP=1 --quiet \
  --command="ALTER ROLE pos_app PASSWORD '${APP_PASSWORD}'"

docker run --detach --name "$CORE" --network "$NETWORK" --publish "127.0.0.1:${PORT}:8080" \
  --env CORE_DB_URL="jdbc:postgresql://${DB}:5432/postgres" \
  --env CORE_DB_USER=pos_app \
  --env CORE_DB_PASSWORD="$APP_PASSWORD" \
  "$IMAGE" >/dev/null
wait_for_core

expect_up /actuator/health/readiness
expect_up /actuator/health/liveness
expect_up /actuator/health
echo "The core image starts with the prod profile against a migrated database."
