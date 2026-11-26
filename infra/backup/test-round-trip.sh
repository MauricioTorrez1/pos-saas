#!/usr/bin/env bash
# Proves that a backup can be restored (ADR 0082), with the same tools image the daily backup uses:
#   1. A source PostgreSQL 17 migrated by Flyway and seeded with a business, a branch and a register.
#   2. create-backup.sh with a throwaway age key.
#   3. restore-backup.sh into a second, empty PostgreSQL 17.
#   4. The same row count in every table, the same RLS policies, the same Flyway history, and the
#      application role still unable to read a business without setting it (RLS survived the restore).
# Usage: infra/backup/test-round-trip.sh. Needs only Docker. Everything is removed on exit.

set -euo pipefail

readonly POSTGRES_IMAGE="postgres:17.12@sha256:87c8b42f423b45d5247e6aa8fdb2e7762fec164c68a50fe3eb07e7bfcaf4dbcf"
readonly FLYWAY_IMAGE="flyway/flyway:12.11.0@sha256:455c23d438811c27415f2c28052d0cc4494665a313b6faa41a7ece5242c24f10"
readonly TOOLS_IMAGE="pos-backup-tools:test"
readonly NETWORK="pos-backup-test-$$"
readonly SOURCE="pos-backup-source-$$"
readonly TARGET="pos-backup-target-$$"
# Throwaway password of two databases that live for a minute and are reachable only from this network.
readonly PASSWORD="round-trip-$$"

# Docker on Windows (Git Bash) needs C:/... paths; on Linux pwd -W does not exist and pwd is used.
native_path() {
  (cd "$1" && { pwd -W 2>/dev/null || pwd; })
}

SCRIPT_DIR="$(native_path "$(dirname "$0")")"
readonly SCRIPT_DIR
readonly MIGRATIONS_DIR="$SCRIPT_DIR/../../services/core/src/main/resources/db/migration"
WORK_DIR="$(native_path "$(mktemp -d)")"
readonly WORK_DIR
chmod 777 "$WORK_DIR"

cleanup() {
  docker rm --force "$SOURCE" "$TARGET" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

start_database() {
  local name="$1"
  docker run --detach --name "$name" --network "$NETWORK" --env POSTGRES_PASSWORD="$PASSWORD" \
    "$POSTGRES_IMAGE" >/dev/null
  for _ in $(seq 1 60); do
    docker exec "$name" pg_isready --host=127.0.0.1 --username=postgres >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "PostgreSQL ${name} did not become ready." >&2
  return 1
}

# Runs a command of the tools image connected to one of the databases, with the work folder at /work.
tools() {
  local host="$1"
  shift
  docker run --rm --network "$NETWORK" --volume "$WORK_DIR:/work" \
    --env PGHOST="$host" --env PGUSER=postgres --env PGPASSWORD="$PASSWORD" --env PGDATABASE=postgres \
    --env AGE_RECIPIENTS_FILE=/work/recipients.txt --env AGE_IDENTITY_FILE=/work/identity.key \
    "$TOOLS_IMAGE" "$@"
}

sql() {
  local name="$1" query="$2"
  docker exec "$name" psql --username=postgres --no-psqlrc --tuples-only --no-align --set=ON_ERROR_STOP=1 \
    --command="$query"
}

# One line per table of public with its exact row count, plus the policies and the migrations.
fingerprint() {
  local name="$1" table
  for table in $(sql "$name" "select tablename from pg_tables where schemaname = 'public' order by 1"); do
    echo "${table}=$(sql "$name" "select count(*) from public.\"${table}\"")"
  done
  sql "$name" "select tablename || ':' || policyname from pg_policies where schemaname = 'public' order by 1"
  sql "$name" "select version || ':' || checksum from flyway_schema_history order by installed_rank"
  sql "$name" "select relname || ':' || relforcerowsecurity from pg_class c join pg_namespace n
               on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1"
}

docker build --quiet --tag "$TOOLS_IMAGE" "$SCRIPT_DIR" >/dev/null
docker network create "$NETWORK" >/dev/null
start_database "$SOURCE"
start_database "$TARGET"

docker run --rm --network "$NETWORK" --volume "$(native_path "$MIGRATIONS_DIR"):/flyway/sql:ro" "$FLYWAY_IMAGE" \
  -url="jdbc:postgresql://${SOURCE}:5432/postgres" -user=postgres -password="$PASSWORD" \
  -outputType=json migrate >/dev/null

# The container superuser passes RLS, like the seed of the Java tests.
sql "$SOURCE" "
  insert into tenant (id, name) values ('019a0000-0000-7000-8000-000000000001', 'Tlapalería de prueba');
  insert into branch (tenant_id, code, name) values ('019a0000-0000-7000-8000-000000000001', 'MATRIZ', 'Matriz');" \
  >/dev/null

tools "$SOURCE" age-keygen --output=/work/identity.key 2>/dev/null
tools "$SOURCE" sh -c 'age-keygen -y /work/identity.key > /work/recipients.txt'
tools "$SOURCE" create-backup.sh /work/backup.dump.age
tools "$TARGET" restore-backup.sh /work/backup.dump.age

fingerprint "$SOURCE" >"$WORK_DIR/source.txt"
fingerprint "$TARGET" >"$WORK_DIR/target.txt"
if ! diff "$WORK_DIR/source.txt" "$WORK_DIR/target.txt"; then
  echo "The restored database differs from the source." >&2
  exit 1
fi
if ! grep -q '^tenant=1$' "$WORK_DIR/target.txt" || ! grep -q '^branch=1$' "$WORK_DIR/target.txt"; then
  echo "The seeded rows did not come back." >&2
  exit 1
fi

# RLS must still hold after the restore: pos_app sees no business until the transaction names one.
sql "$TARGET" "alter role pos_app password '${PASSWORD}'" >/dev/null
visible="$(docker exec --env PGPASSWORD="$PASSWORD" "$TARGET" psql --host=127.0.0.1 --username=pos_app \
  --dbname=postgres --no-psqlrc --tuples-only --no-align --command="select count(*) from tenant")"
if [ "$visible" != "0" ]; then
  echo "pos_app read ${visible} businesses without naming one: RLS did not survive the restore." >&2
  exit 1
fi

echo "Round trip passed: $(grep -c '=' "$WORK_DIR/target.txt") tables with the same rows, policies, migrations and RLS."
