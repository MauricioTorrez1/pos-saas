import { defineConfig } from 'vitest/config';

/**
 * The end-to-end test of the sync against a real core (E1-20, ADR 0066). `pnpm test` does not run it: it needs the core
 * that `OfflineSyncEndToEndTest` in `services/core` starts, which passes the address and the credential in the environment.
 */
export default defineConfig({
  test: {
    name: 'offline-e2e',
    environment: 'node',
    include: ['src/main/sync/*.e2e.ts'],
    // The steps share one register and one core, so they run in order and never in parallel.
    sequence: { concurrent: false },
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
