import { defineConfig } from '@playwright/test';

const PANEL_URL = 'http://127.0.0.1:3107';
const FAKE_URL = 'http://127.0.0.1:4017';

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.ts',
  // The tests share one fake identity provider and change its behavior, so they run one at a time.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: PANEL_URL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    {
      command: 'node e2e/fake-oidc.ts',
      url: `${FAKE_URL}/__stats`,
      reuseExistingServer: false,
    },
    {
      command: 'next build && next start --hostname 127.0.0.1 --port 3107',
      url: PANEL_URL,
      reuseExistingServer: false,
      timeout: 240_000,
      env: {
        PANEL_OIDC_ISSUER_URL: `${FAKE_URL}/realms/pos`,
        PANEL_OIDC_CLIENT_ID: 'pos-panel',
        PANEL_BASE_URL: PANEL_URL,
        PANEL_CORE_API_URL: FAKE_URL,
        // Throwaway value for tests only.
        PANEL_SESSION_SECRET: 'e2e-only-session-secret-not-used-anywhere-else',
      },
    },
  ],
});
