#!/usr/bin/env bash
# Verifies that files with secrets or private data stay out of Git.
# Reports every violation before exiting, so one run shows all the problems.

set -euo pipefail

readonly MUST_BE_IGNORED=(
  ".env"
  ".env.local"
  "services/core/.env"
  "apps/pos/.env.production"
  "secrets/keys.txt"
  "csd/tenant.key"
  "csd/tenant.cer"
  "private/eleventa-export.csv"
  "backups/2026-11-02.dump"
  "apps/pos/local.sqlite"
  "infra/terraform/terraform.tfstate"
  "infra/terraform/production.tfvars"
)

readonly MUST_NOT_BE_IGNORED=(
  ".env.example"
)

readonly SENSITIVE_FILE_PATTERN='(^|/)\.env(\..+)?$|\.(pem|key|cer|crt|p12|pfx|jks|keystore|sqlite|sqlite3|dump|tfstate|tfvars)$'
readonly ALLOWED_FILE_PATTERN='(^|/)\.env\.example$'

violations=0

# Prints a violation to stderr and adds it to the total.
# Arguments: $1 - description of the violation.
report_violation() {
  echo "ERROR: $1" >&2
  violations=$((violations + 1))
}

# Checks the ignore rules, even for paths that do not exist yet.
check_ignore_rules() {
  local path
  for path in "${MUST_BE_IGNORED[@]}"; do
    git check-ignore --quiet --no-index "$path" || report_violation "$path must be ignored"
  done
  for path in "${MUST_NOT_BE_IGNORED[@]}"; do
    if git check-ignore --quiet --no-index "$path"; then
      report_violation "$path must not be ignored"
    fi
  done
}

# Catches sensitive files already tracked, which ignore rules no longer protect.
check_tracked_files() {
  local path
  while IFS= read -r path; do
    report_violation "$path must not be tracked"
  done < <(git ls-files | grep -E "$SENSITIVE_FILE_PATTERN" | grep -vE "$ALLOWED_FILE_PATTERN" || true)
}

check_ignore_rules
check_tracked_files

if ((violations > 0)); then
  echo "Found $violations violation(s)." >&2
  exit 1
fi

echo "Sensitive files stay out of Git."
