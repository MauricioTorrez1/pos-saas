#!/usr/bin/env bash
# Dumps the public schema of the database and encrypts it with age for every recipient (ADR 0082).
# Usage: create-backup.sh <output file>
# Connection: the standard libpq variables (PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD, PGSSLMODE).
# Needs pg_dump and pg_restore 17 or newer (Supabase runs 17) and age on PATH.
# Variables: AGE_RECIPIENTS_FILE (default: age-recipients.txt next to this script).
#
# The plain dump only lives in a private temporary directory, is checked with pg_restore --list before it is
# encrypted, and is deleted on exit whatever happens.

set -euo pipefail

readonly OUTPUT="${1:?Usage: $0 <output file>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
readonly SCRIPT_DIR
readonly RECIPIENTS="${AGE_RECIPIENTS_FILE:-$SCRIPT_DIR/age-recipients.txt}"

if ! grep -q '^age1' "$RECIPIENTS"; then
  echo "No age1 public key in $RECIPIENTS: nothing could decrypt the backup." >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
readonly WORK_DIR
chmod 700 "$WORK_DIR"
trap 'rm -rf "$WORK_DIR"' EXIT
readonly PLAIN="$WORK_DIR/backup.dump"

# Custom format: compressed, and pg_restore can pick objects from it. Only the public schema: the other
# schemas of a Supabase project (auth, storage, ...) belong to Supabase. Ownership is left out because the
# restore runs as whichever role owns the target database; grants to pos_app and the RLS policies stay in.
pg_dump --format=custom --compress=9 --schema=public --no-owner --file="$PLAIN"

# A dump that pg_restore cannot list is not a backup.
table_count="$(pg_restore --list "$PLAIN" | grep -c ' TABLE public ' || true)"
if [ "$table_count" -eq 0 ]; then
  echo "The dump has no tables of the public schema." >&2
  exit 1
fi

age --encrypt --recipients-file="$RECIPIENTS" --output="$OUTPUT" "$PLAIN"
echo "Encrypted backup with ${table_count} tables: $(wc -c <"$OUTPUT") bytes in ${OUTPUT}."
