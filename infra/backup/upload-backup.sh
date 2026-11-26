#!/usr/bin/env bash
# Uploads an encrypted backup to Cloudflare R2 under daily/ and, on the first day of the month, also under
# monthly/ (ADR 0083). The lifecycle rules of the bucket (infra/terraform/r2.tf) delete daily/ after 30 days
# and monthly/ after 365, so this script never deletes anything.
# Usage: upload-backup.sh <encrypted file>
# Variables: R2_ACCOUNT_ID, R2_BUCKET, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (an R2 token limited to the
# bucket). Needs the AWS CLI v2 on PATH.

set -euo pipefail

readonly FILE="${1:?Usage: $0 <encrypted file>}"
readonly ACCOUNT_ID="${R2_ACCOUNT_ID:?Set R2_ACCOUNT_ID}"
readonly BUCKET="${R2_BUCKET:?Set R2_BUCKET}"
: "${AWS_ACCESS_KEY_ID:?Set AWS_ACCESS_KEY_ID}" "${AWS_SECRET_ACCESS_KEY:?Set AWS_SECRET_ACCESS_KEY}"

readonly ENDPOINT="https://${ACCOUNT_ID}.r2.cloudflarestorage.com"
export AWS_DEFAULT_REGION=auto
# Recent AWS CLI versions send checksum headers that R2 does not accept on every operation.
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required

# The business day is the one of the store, not of UTC.
readonly NAME="pos-saas-$(TZ=America/Mexico_City date +%Y-%m-%dT%H%M%S%z).dump.age"

upload() {
  local key="$1"
  aws s3 cp --only-show-errors --endpoint-url "$ENDPOINT" "$FILE" "s3://${BUCKET}/${key}"
  local size
  size="$(aws s3api head-object --endpoint-url "$ENDPOINT" --bucket "$BUCKET" --key "$key" \
    --query ContentLength --output text)"
  if [ "$size" -ne "$(wc -c <"$FILE")" ]; then
    echo "R2 reports ${size} bytes for ${key}, not the size of the file." >&2
    exit 1
  fi
  echo "Uploaded ${key} (${size} bytes)."
}

upload "daily/${NAME}"
if [ "$(TZ=America/Mexico_City date +%d)" = "01" ]; then
  upload "monthly/${NAME}"
fi
