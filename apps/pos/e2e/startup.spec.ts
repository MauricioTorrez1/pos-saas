import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { test as base, expect, type ElectronApplication, type Page } from '@playwright/test';

import { createTemporaryUserData, launchRegister, recordStartupOptions, removeTemporaryUserData, signInWindow } from './register-harness.ts';

const APP_ROOT = join(import.meta.dirname, '..');
const OUTSIDE_URL = 'https://example.com/';

/** Reports the preferences a window really received. Electron leaves it out of its types and docs. */
interface WebContentsWithPreferences {
  getLastWebPreferences(): { contextIsolation: boolean; nodeIntegration: boolean; sandbox: boolean };
}

const test = base.extend<{ electronApp: ElectronApplication; appWindow: Page }>({
  // Playwright requires an object pattern as the first argument, even when it is empty.
  electronApp: async ({}, use) => {
    const userDataDir = createTemporaryUserData();
    const electronApp = await launchRegister(userDataDir, recordStartupOptions(userDataDir));
    await use(electronApp);
    await electronApp.close();
    await removeTemporaryUserData(userDataDir);
  },
  appWindow: async ({ electronApp }, use) => {
    await use(await signInWindow(electronApp));
  },
});

test('opens the register screen with the version from the main process', async ({ appWindow }) => {
  const { version } = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as { version: string };

  await expect(appWindow.getByRole('heading', { name: 'Caja' })).toBeVisible();
  await expect(appWindow.getByText(`Versión ${version}`)).toBeVisible();
});

test('gives the screen no direct access to Node', async ({ appWindow }) => {
  const nodeGlobals = await appWindow.evaluate(() => ({
    require: typeof require,
    process: typeof process,
    module: typeof module,
    buffer: typeof Buffer,
    global: typeof global,
    dirname: typeof __dirname,
  }));

  expect(nodeGlobals).toEqual({
    require: 'undefined',
    process: 'undefined',
    module: 'undefined',
    buffer: 'undefined',
    global: 'undefined',
    dirname: 'undefined',
  });
});

test('runs the screen isolated and sandboxed', async ({ electronApp, appWindow }) => {
  await appWindow.waitForLoadState();

  const preferences = await electronApp.evaluate(({ BrowserWindow }) => {
    const { webContents } = BrowserWindow.getAllWindows()[0]!;
    const { contextIsolation, nodeIntegration, sandbox } = (
      webContents as unknown as WebContentsWithPreferences
    ).getLastWebPreferences();
    return { contextIsolation, nodeIntegration, sandbox };
  });

  expect(preferences).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true });
});

test('exposes only the agreed functions through the bridge', async ({ appWindow }) => {
  const bridgeFunctions = await appWindow.evaluate(() => Object.keys(window.pos));

  expect(bridgeFunctions).toEqual([
    'getAppInfo',
    'getAuthState',
    'setupOwner',
    'login',
    'logout',
    'createUser',
    'importCatalog',
    'getBackupStatus',
    'configureBackup',
    'backupNow',
    'restoreBackup',
    'getKardex',
    'adjustStock',
    'checkLedger',
    'getDailyReport',
    'findReturnableSale',
    'createReturn',
    'getCashStatus',
    'openCashSession',
    'recordCashMovement',
    'closeCashSession',
    'setWithdrawalLimit',
    'findProductByCode',
    'searchProducts',
    'getAppearance',
    'saveAppearance',
    'savePendingSale',
    'checkoutSale',
    'reprintLastTicket',
    'listPendingSales',
    'confirmPendingSale',
    'cancelPendingSale',
  ]);
});

test('keeps the window on its own screen when a page tries to leave', async ({ electronApp, appWindow }) => {
  const startUrl = appWindow.url();
  await electronApp.evaluate(({ BrowserWindow }) => {
    const { webContents } = BrowserWindow.getAllWindows()[0]!;
    (globalThis as { leaveAttempt?: Promise<boolean> }).leaveAttempt = new Promise((resolve) => {
      webContents.once('will-navigate', (event) => resolve(event.defaultPrevented));
    });
  });

  await appWindow.evaluate((url) => {
    window.location.href = url;
  }, OUTSIDE_URL);
  const wasBlocked = await electronApp.evaluate(() => (globalThis as { leaveAttempt?: Promise<boolean> }).leaveAttempt);

  expect(wasBlocked).toBe(true);
  expect(appWindow.url()).toBe(startUrl);
});

test('refuses to open other windows', async ({ electronApp, appWindow }) => {
  const opened = await appWindow.evaluate((url) => window.open(url) !== null, OUTSIDE_URL);

  expect(opened).toBe(false);
  expect(electronApp.windows()).toHaveLength(1);
});

test('does not run a script injected into the page', async ({ appWindow }) => {
  const scriptRan = await appWindow.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.injectedScriptRan = true;';
    document.head.append(script);
    return 'injectedScriptRan' in window;
  });

  expect(scriptRan).toBe(false);
});
