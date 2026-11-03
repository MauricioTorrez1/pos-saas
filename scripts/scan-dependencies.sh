#!/usr/bin/env bash
# Scans the dependency files of the three projects for known vulnerabilities.
# On a pull request a vulnerability only warns, because a new advisory must not block
# unrelated work. Anywhere else it fails the run, so GitHub notifies the repository owner.
# A scan that could not finish always fails: it must not look like a clean result.

set -euo pipefail

readonly DEPENDENCY_FILES=(
  "services/core/pom.xml"
  "pnpm-lock.yaml"
  "services/analytics/uv.lock"
)

# Exit codes documented at https://google.github.io/osv-scanner/output/
readonly EXIT_NO_VULNERABILITIES=0
readonly EXIT_VULNERABILITIES_FOUND=1

# Reports vulnerabilities as a warning on a pull request and as a failure anywhere else.
report_vulnerabilities() {
  if [[ "${GITHUB_EVENT_NAME:-}" == "pull_request" ]]; then
    echo "::warning title=Vulnerable dependencies::OSV-Scanner found known vulnerabilities. See the scan log."
    return 0
  fi
  echo "ERROR: OSV-Scanner found known vulnerabilities." >&2
  return 1
}

lockfile_flags=()
for file in "${DEPENDENCY_FILES[@]}"; do
  lockfile_flags+=("--lockfile=$file")
done

status=0
osv-scanner scan source "${lockfile_flags[@]}" || status=$?

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
