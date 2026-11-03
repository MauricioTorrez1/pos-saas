#!/usr/bin/env bash
# Simulates sales and sends their traces, metrics, and logs to the collector, like a real application.
# All the data is made up and labeled pos-demo. Most sales are fast, a few are slow, and some fail.
# The first trace of a run is always: <run id>0000000100000001
# Usage: bash scripts/send-test-telemetry.sh [rounds] [run id of 16 hexadecimal digits]

set -euo pipefail

readonly COLLECTOR_URL="http://127.0.0.1:4318"
readonly SALES_PER_ROUND=10
readonly SECONDS_BETWEEN_ROUNDS=5
readonly FAILED_SALES_PERCENT=5
readonly NANOS_PER_SECOND=1000000000
readonly NANOS_PER_MILLI=1000000
readonly SPAN_KIND_SERVER=2
readonly SPAN_KIND_CLIENT=3
readonly SPAN_STATUS_OK=1
readonly SPAN_STATUS_ERROR=2
readonly SEVERITY_INFO=9
readonly SEVERITY_ERROR=17
readonly CUMULATIVE=2
# Upper limit of each histogram bucket, in milliseconds. One more bucket counts everything above.
readonly BUCKET_LIMITS=(50 100 200 400 800 1600)
readonly RESOURCE='{"attributes":[{"key":"service.name","value":{"stringValue":"pos-demo"}},{"key":"deployment.environment.name","value":{"stringValue":"test"}}]}'
readonly SCOPE='{"name":"send-test-telemetry"}'

rounds=${1:-24}
run_id=${2:-$(openssl rand -hex 8)}
started_at=$(date +%s)
readonly rounds run_id started_at

# OTLP cumulative metrics report totals since the start of the run.
completed_sales=0
failed_sales=0
duration_sum_ms=0
bucket_counts=(0 0 0 0 0 0 0)

# JSON of the current round, built by add_sale.
round_spans=""
round_logs=""

# Prints a sale duration in milliseconds. A few slow sales are what moves the p95 away from the median.
random_duration_ms() {
  local roll=$((RANDOM % 100))
  if ((roll < 85)); then
    echo $((40 + RANDOM % 120))
  elif ((roll < 97)); then
    echo $((300 + RANDOM % 400))
  else
    echo $((900 + RANDOM % 800))
  fi
}

# Adds a duration to the histogram.
# Arguments: $1 - duration in milliseconds.
count_in_bucket() {
  local index=0 limit
  for limit in "${BUCKET_LIMITS[@]}"; do
    if (($1 <= limit)); then
      break
    fi
    index=$((index + 1))
  done
  bucket_counts[index]=$((bucket_counts[index] + 1))
  duration_sum_ms=$((duration_sum_ms + $1))
}

# Prints one span as JSON.
# Arguments: $1 - trace id; $2 - span id; $3 - parent span id; $4 - name; $5 - kind;
#            $6 - start in nanoseconds; $7 - end in nanoseconds; $8 - status code.
span_json() {
  printf '{"traceId":"%s","spanId":"%s","parentSpanId":"%s","name":"%s","kind":%d,"startTimeUnixNano":"%d","endTimeUnixNano":"%d","status":{"code":%d}}' "$@"
}

# Prints one log record as JSON.
# Arguments: $1 - trace id; $2 - span id; $3 - time in nanoseconds; $4 - severity number;
#            $5 - severity text; $6 - message.
log_json() {
  printf '{"traceId":"%s","spanId":"%s","timeUnixNano":"%d","severityNumber":%d,"severityText":"%s","body":{"stringValue":"%s"}}' "$@"
}

# Simulates one sale: a request span, a database span that takes most of its time, and a log line.
# Arguments: $1 - round number; $2 - sale number; $3 - end of the sale in nanoseconds.
add_sale() {
  local round=$1 sale=$2 end_ns=$3
  local duration_ms start_ns trace_id request_span_id database_span_id
  duration_ms=$(random_duration_ms)
  start_ns=$((end_ns - duration_ms * NANOS_PER_MILLI))
  printf -v trace_id '%s%08x%08x' "$run_id" "$round" "$sale"
  printf -v request_span_id '%08x%08x' "$round" "$sale"
  printf -v database_span_id '%08x%08x' "$round" $((sale + SALES_PER_ROUND))

  local status=$SPAN_STATUS_OK severity=$SEVERITY_INFO severity_text="INFO" message="sale completed"
  if ((RANDOM % 100 < FAILED_SALES_PERCENT)); then
    status=$SPAN_STATUS_ERROR severity=$SEVERITY_ERROR severity_text="ERROR" message="sale failed"
    failed_sales=$((failed_sales + 1))
  else
    completed_sales=$((completed_sales + 1))
  fi
  count_in_bucket "$duration_ms"

  local database_start_ns=$((start_ns + duration_ms * NANOS_PER_MILLI / 10))
  local database_end_ns=$((database_start_ns + duration_ms * NANOS_PER_MILLI * 8 / 10))
  round_spans+="${round_spans:+,}$(span_json "$trace_id" "$request_span_id" "" "POST /api/sales" "$SPAN_KIND_SERVER" "$start_ns" "$end_ns" "$status")"
  round_spans+=",$(span_json "$trace_id" "$database_span_id" "$request_span_id" "INSERT sales" "$SPAN_KIND_CLIENT" "$database_start_ns" "$database_end_ns" "$status")"
  round_logs+="${round_logs:+,}$(log_json "$trace_id" "$request_span_id" "$end_ns" "$severity" "$severity_text" "$message")"
}

# Prints the running totals as OTLP metrics. The run.id label gives each run its own series.
# Arguments: $1 - time of the data points in nanoseconds.
metrics_json() {
  local start_ns=$((started_at * NANOS_PER_SECOND))
  local times="\"startTimeUnixNano\":\"$start_ns\",\"timeUnixNano\":\"$1\""
  local run="{\"key\":\"run.id\",\"value\":{\"stringValue\":\"$run_id\"}}"
  local limits counts count=0 bucket_count
  limits=$(IFS=,; echo "${BUCKET_LIMITS[*]}")
  counts=$(IFS=,; echo "${bucket_counts[*]}")
  for bucket_count in "${bucket_counts[@]}"; do
    count=$((count + bucket_count))
  done

  local sales_ok="{$times,\"asInt\":\"$completed_sales\",\"attributes\":[$run,{\"key\":\"status\",\"value\":{\"stringValue\":\"ok\"}}]}"
  local sales_error="{$times,\"asInt\":\"$failed_sales\",\"attributes\":[$run,{\"key\":\"status\",\"value\":{\"stringValue\":\"error\"}}]}"
  local sales="{\"name\":\"pos.demo.sales\",\"unit\":\"{sale}\",\"sum\":{\"aggregationTemporality\":$CUMULATIVE,\"isMonotonic\":true,\"dataPoints\":[$sales_ok,$sales_error]}}"
  local duration="{\"name\":\"pos.demo.sale.duration\",\"unit\":\"ms\",\"histogram\":{\"aggregationTemporality\":$CUMULATIVE,\"dataPoints\":[{$times,\"count\":\"$count\",\"sum\":$duration_sum_ms,\"bucketCounts\":[$counts],\"explicitBounds\":[$limits],\"attributes\":[$run]}]}}"
  printf '{"resourceMetrics":[{"resource":%s,"scopeMetrics":[{"scope":%s,"metrics":[%s,%s]}]}]}' "$RESOURCE" "$SCOPE" "$sales" "$duration"
}

# Sends a JSON payload to the collector.
# Arguments: $1 - signal: traces, metrics, or logs; $2 - payload.
post_otlp() {
  if ! curl --silent --show-error --fail --output /dev/null \
    --header "Content-Type: application/json" --data-binary @- \
    "$COLLECTOR_URL/v1/$1" <<<"$2"; then
    echo "ERROR: the collector rejected the $1. Is it running? Try: bash scripts/wait-for-profile.sh observability" >&2
    exit 1
  fi
}

# Simulates and sends all the sales of one round.
# Arguments: $1 - round number.
send_round() {
  local sale end_ns=$(($(date +%s) * NANOS_PER_SECOND))
  round_spans=""
  round_logs=""
  for ((sale = 1; sale <= SALES_PER_ROUND; sale++)); do
    add_sale "$1" "$sale" "$end_ns"
  done
  post_otlp traces "$(printf '{"resourceSpans":[{"resource":%s,"scopeSpans":[{"scope":%s,"spans":[%s]}]}]}' "$RESOURCE" "$SCOPE" "$round_spans")"
  post_otlp logs "$(printf '{"resourceLogs":[{"resource":%s,"scopeLogs":[{"scope":%s,"logRecords":[%s]}]}]}' "$RESOURCE" "$SCOPE" "$round_logs")"
  post_otlp metrics "$(metrics_json "$end_ns")"
}

for ((round = 1; round <= rounds; round++)); do
  send_round "$round"
  echo "Round $round of $rounds sent."
  if ((round < rounds)); then
    sleep "$SECONDS_BETWEEN_ROUNDS"
  fi
done

echo "Sent $((rounds * SALES_PER_ROUND)) simulated sales in run $run_id."
