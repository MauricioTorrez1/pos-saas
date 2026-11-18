#!/usr/bin/env bash
# Runs the end-to-end test of the offline sync (E1-20, ADR 0066): 1,000 sales made without network by the
# register's own code reach a real core over PostgreSQL once each, despite a cut request, a lost answer and replays.
# It needs Docker (Testcontainers), Java 21 and Node 24. CI runs it in the Java job.
# Usage: bash scripts/run-offline-sync-e2e.sh

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
readonly repo_root

if [[ ! -f "$repo_root/apps/pos/node_modules/vitest/vitest.mjs" ]]; then
  echo "Installing the dependencies of the register (without the Electron binary, which the test does not use)"
  (cd "$repo_root" && ELECTRON_SKIP_BINARY_DOWNLOAD=1 corepack pnpm install --frozen-lockfile --filter "@pos-saas/pos...")
fi

cd "$repo_root/services/core"
POS_OFFLINE_E2E=true ./mvnw --batch-mode --no-transfer-progress test \
  -Dtest=OfflineSyncEndToEndTest -Dsurefire.failIfNoSpecifiedTests=false
