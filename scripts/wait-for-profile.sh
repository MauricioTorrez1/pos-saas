#!/usr/bin/env bash
# Starts a Compose profile and fails unless every service is healthy within the time limit.
# Images are downloaded first, because the download time only depends on the network.
# Usage: bash scripts/wait-for-profile.sh <core|observability>

set -euo pipefail

readonly HEALTH_LIMIT_SECONDS=120

profile=${1:-}
readonly profile

case "$profile" in
  core) readonly PROFILE_SERVICES=("postgres" "keycloak" "redis" "redpanda") ;;
  observability) readonly PROFILE_SERVICES=("prometheus" "loki" "tempo" "otel-collector" "grafana") ;;
  *)
    echo "Usage: bash scripts/wait-for-profile.sh <core|observability>" >&2
    exit 2
    ;;
esac

# Prints the state and recent logs of the profile, so a failed run explains itself.
show_diagnostics() {
  docker compose --profile "$profile" ps --all >&2
  docker compose --profile "$profile" logs --tail=50 >&2
}

# Prints the health of a service. A service that is missing or has no healthcheck is not healthy.
# Arguments: $1 - service name.
service_health() {
  local container
  container=$(docker compose --profile "$profile" ps --quiet "$1")
  if [[ -z "$container" ]]; then
    echo "not running"
    return
  fi
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no healthcheck{{end}}' "$container"
}

# Catches a service removed from the file or left without a healthcheck, which --wait would accept.
check_every_service() {
  local service health unhealthy=0
  for service in "${PROFILE_SERVICES[@]}"; do
    health=$(service_health "$service")
    echo "$service: $health"
    if [[ "$health" != "healthy" ]]; then
      unhealthy=1
    fi
  done
  return "$unhealthy"
}

if [[ ! -f .env ]]; then
  echo "ERROR: .env is missing. Run: bash scripts/create-dev-env.sh" >&2
  exit 1
fi

docker compose --profile "$profile" pull --policy missing --quiet

started_at=$SECONDS
if ! docker compose --profile "$profile" up --detach --wait --wait-timeout "$HEALTH_LIMIT_SECONDS"; then
  echo "ERROR: the $profile profile did not become healthy (limit: ${HEALTH_LIMIT_SECONDS} seconds)." >&2
  show_diagnostics
  exit 1
fi
elapsed=$((SECONDS - started_at))

if ! check_every_service; then
  echo "ERROR: not every $profile service is healthy." >&2
  show_diagnostics
  exit 1
fi

echo "All $profile services are healthy after ${elapsed} seconds (limit: ${HEALTH_LIMIT_SECONDS})."
