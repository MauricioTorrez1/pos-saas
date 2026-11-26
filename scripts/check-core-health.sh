#!/usr/bin/env bash
# Asks a deployed core for /actuator/health until it answers UP (ADR 0082). The core scales to zero, so the
# first answer may wait for a cold start; three minutes cover it. The health includes the database, so an UP
# also proves the connection to Supabase (and keeps the free project from pausing).
# Usage: scripts/check-core-health.sh <base url of the core>

set -euo pipefail

readonly BASE_URL="${1:?Usage: $0 <base url of the core>}"
readonly HEALTH_URL="${BASE_URL%/}/actuator/health"
readonly ATTEMPTS="${HEALTH_ATTEMPTS:-18}"

body=""
for attempt in $(seq 1 "$ATTEMPTS"); do
  body="$(curl --silent --show-error --max-time 60 "$HEALTH_URL" || true)"
  if [[ "$body" == *'"status":"UP"'* ]]; then
    echo "The core is UP (attempt ${attempt})."
    exit 0
  fi
  sleep 10
done

echo "The core did not answer UP at ${HEALTH_URL}. Last answer: ${body:-none}" >&2
exit 1
