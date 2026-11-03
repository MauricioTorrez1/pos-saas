#!/usr/bin/env bash
# Sends test telemetry through the collector and checks that Grafana can read it from every store.
# It asks through the data source proxy of Grafana, so it proves the whole route at once.
# Run it after: bash scripts/wait-for-profile.sh observability

set -euo pipefail

readonly GRAFANA_URL="http://127.0.0.1:3001"
readonly DASHBOARD_UID="pos-overview"
readonly DATA_SOURCES=("prometheus" "loki" "tempo")
readonly SEARCH_LIMIT_SECONDS=60
readonly RETRY_SECONDS=2

# Prints the value of a variable in .env.
# Arguments: $1 - variable name.
read_env_value() {
  sed -n "s/^$1=//p" .env
}

# Prints the answer of an authenticated request to Grafana.
# The password goes through stdin, so it never appears in the list of processes.
# Arguments: $1 - path; the rest - extra curl options.
grafana_get() {
  local path=$1
  shift
  curl --silent --show-error --fail --config - "$@" "${GRAFANA_URL}${path}" <<<"user = \"${grafana_user}:${grafana_password}\""
}

# Fails unless an authenticated answer of Grafana contains a text.
# Arguments: $1 - expected text; $2 - path; the rest - extra curl options.
answer_contains() {
  local expected=$1 answer
  shift
  answer=$(grafana_get "$@" 2>/dev/null) || return 1
  [[ "$answer" == *"$expected"* ]]
}

check_login_is_required() {
  local status
  status=$(curl --silent --output /dev/null --write-out '%{http_code}' "$GRAFANA_URL/api/dashboards/uid/$DASHBOARD_UID")
  if [[ "$status" != "401" ]]; then
    echo "ERROR: Grafana answered $status without a password. Expected 401." >&2
    exit 1
  fi
  echo "OK: Grafana requires a password."
}

check_dashboard_is_provisioned() {
  if ! answer_contains '"provisioned":true' "/api/dashboards/uid/$DASHBOARD_UID"; then
    echo "ERROR: dashboard $DASHBOARD_UID is not provisioned from the repository files." >&2
    exit 1
  fi
  echo "OK: dashboard $DASHBOARD_UID is provisioned from the repository files."
}

check_data_sources() {
  local uid
  for uid in "${DATA_SOURCES[@]}"; do
    if ! answer_contains '"status":"OK"' "/api/datasources/uid/$uid/health"; then
      echo "ERROR: Grafana cannot reach data source $uid." >&2
      exit 1
    fi
    echo "OK: data source $uid answers."
  done
}

# Repeats a search until it finds the data, because each store takes a moment to make it visible.
# Arguments: $1 - description of the data; the rest - arguments for answer_contains.
wait_for_data() {
  local description=$1 deadline=$((SECONDS + SEARCH_LIMIT_SECONDS))
  shift
  until answer_contains "$@"; do
    if ((SECONDS >= deadline)); then
      echo "ERROR: Grafana did not show the $description within $SEARCH_LIMIT_SECONDS seconds." >&2
      docker compose --profile observability logs --tail=30 otel-collector >&2
      exit 1
    fi
    sleep "$RETRY_SECONDS"
  done
  echo "OK: Grafana shows the $description."
}

if [[ ! -f .env ]]; then
  echo "ERROR: .env is missing. Run: bash scripts/create-dev-env.sh" >&2
  exit 1
fi

grafana_user=$(read_env_value GRAFANA_ADMIN_USER)
grafana_password=$(read_env_value GRAFANA_ADMIN_PASSWORD)
run_id=$(openssl rand -hex 8)
readonly grafana_user grafana_password run_id
readonly trace_id="${run_id}0000000100000001"

check_login_is_required
check_dashboard_is_provisioned
check_data_sources

bash scripts/send-test-telemetry.sh 1 "$run_id"

wait_for_data "test trace" "POST /api/sales" \
  "/api/datasources/proxy/uid/tempo/api/traces/$trace_id" --header "Accept: application/json"
wait_for_data "test counter" '"__name__":"pos_demo_sales_total"' \
  "/api/datasources/proxy/uid/prometheus/api/v1/query" --get \
  --data-urlencode "query=pos_demo_sales_total{run_id=\"$run_id\"}"
wait_for_data "test histogram" '"__name__":"pos_demo_sale_duration_milliseconds_count"' \
  "/api/datasources/proxy/uid/prometheus/api/v1/query" --get \
  --data-urlencode "query=pos_demo_sale_duration_milliseconds_count{run_id=\"$run_id\"}"
wait_for_data "test log" "sale " \
  "/api/datasources/proxy/uid/loki/loki/api/v1/query_range" --get \
  --data-urlencode "query={service_name=\"pos-demo\"} | trace_id=\"$trace_id\""

echo "Traces, metrics, and logs reach Grafana."
