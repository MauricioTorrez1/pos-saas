#!/usr/bin/env bash
# Scans the dependencies of the three projects for known vulnerabilities.
# On a pull request a vulnerability only warns, because a new advisory must not block
# unrelated work. Anywhere else it fails the run, so GitHub notifies the repository owner.
# A scan that could not finish always fails: it must not look like a clean result.

set -euo pipefail

# The Java list comes from Maven, because pom.xml inherits its versions from Spring Boot
# and OSV-Scanner skips a package with no version (ADR 0018).
readonly JAVA_DEPENDENCY_LIST="services/core/target/classes/META-INF/sbom/application.cdx.json"

readonly DEPENDENCY_FILES=(
  "$JAVA_DEPENDENCY_LIST"
  "pnpm-lock.yaml"
  "services/analytics/uv.lock"
)

# Exit codes documented at https://google.github.io/osv-scanner/output/
readonly EXIT_NO_VULNERABILITIES=0
readonly EXIT_VULNERABILITIES_FOUND=1

# Writes the list of the Java dependencies that ship in the JAR, with their exact versions.
generate_java_dependency_list() {
  (cd services/core && ./mvnw --batch-mode --no-transfer-progress generate-resources)
}

# Reports vulnerabilities as a warning on a pull request and as a failure anywhere else.
report_vulnerabilities() {
  if [[ "${GITHUB_EVENT_NAME:-}" == "pull_request" ]]; then
    echo "::warning title=Vulnerable dependencies::OSV-Scanner found known vulnerabilities. See the scan log."
    return 0
  fi
  echo "ERROR: OSV-Scanner found known vulnerabilities." >&2
  return 1
}

generate_java_dependency_list

lockfile_flags=()
for file in "${DEPENDENCY_FILES[@]}"; do
  lockfile_flags+=("--lockfile=$file")
done

scan_log="$(mktemp)"
trap 'rm -f "$scan_log"' EXIT

status=0
osv-scanner scan source "${lockfile_flags[@]}" 2>&1 | tee "$scan_log" || status="${PIPESTATUS[0]}"

# OSV-Scanner skips a package it cannot look up and still reports a clean result.
if grep --quiet "local/unscannable" "$scan_log"; then
  echo "ERROR: OSV-Scanner skipped packages, so this scan does not cover them." >&2
  exit 1
fi

case "$status" in
  "$EXIT_NO_VULNERABILITIES")
    echo "No known vulnerabilities."
    ;;
  "$EXIT_VULNERABILITIES_FOUND")
    report_vulnerabilities
    ;;
  *)
    echo "ERROR: OSV-Scanner could not finish (exit code $status)." >&2
    exit 1
    ;;
esac
