#!/usr/bin/env bash
# Decrypts a backup made by create-backup.sh and restores it into an EMPTY database (ADR 0083).
# Usage: restore-backup.sh <encrypted file>
# Target: the standard libpq variables (PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD, PGSSLMODE).
# Variables: AGE_IDENTITY_FILE, the private key of age (never committed; the owner keeps it offline).
# Needs pg_restore and psql 17 or newer and age on PATH.
#
# Restore drill (docs/despliegue-en-la-nube.md): run it against a throwaway local PostgreSQL 17, never
# against production. Flyway's history comes back with the data, so later migrations continue from it.

set -euo pipefail

readonly ENCRYPTED="${1:?Usage: $0 <encrypted file>}"
readonly IDENTITY="${AGE_IDENTITY_FILE:?Set AGE_IDENTITY_FILE to the private key of the backups}"

existing_tables="$(psql --no-psqlrc --tuples-only --no-align --command \
  "select count(*) from pg_tables where schemaname = 'public'")"
if [ "$existing_tables" -ne 0 ]; then
  echo "The target already has ${existing_tables} tables in public. Restore only into an empty database." >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
readonly WORK_DIR
chmod 700 "$WORK_DIR"
trap 'rm -rf "$WORK_DIR"' EXIT
readonly PLAIN="$WORK_DIR/backup.dump"

age --decrypt --identity="$IDENTITY" --output="$PLAIN" "$ENCRYPTED"

# The grants of the dump name pos_app, the role of the core (ADR 0035). Without a password it cannot log in
# until someone sets one, which is what a drill wants.
psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_app') THEN
        CREATE ROLE pos_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
END
$$;
SQL

# A dump of one schema carries its CREATE SCHEMA, but every PostgreSQL database already has public.
pg_restore --list "$PLAIN" | grep -v ' SCHEMA - public ' >"$WORK_DIR/restore.list"

# One transaction: a restore that fails halfway leaves the target as empty as it was.
pg_restore --dbname="${PGDATABASE:-postgres}" --no-owner --exit-on-error --single-transaction \
  --use-list="$WORK_DIR/restore.list" "$PLAIN"

psql --no-psqlrc --tuples-only --no-align --command "
  select 'tables: ' || (select count(*) from pg_tables where schemaname = 'public')
      || ', policies: ' || (select count(*) from pg_policies where schemaname = 'public')
      || ', migrations: ' || (select count(*) from public.flyway_schema_history where success)"
