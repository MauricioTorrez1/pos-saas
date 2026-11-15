import { test as base, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';

import {
  createTemporaryUserData,
  forceClose,
  launchRegister,
  readMainPid,
  recordStartupOptions,
  removeTemporaryUserData,
  signInWindow,
  testSalePaths,
} from './register-harness.ts';

const HAMMER_CODE = '2000000000107';

const test = base.extend<{
  userDataDir: string;
  launch: () => Promise<ElectronApplication>;
}>({
  // Playwright requires an object pattern as the first argument, even when it is empty.
  userDataDir: async ({}, use) => {
    const userDataDir = createTemporaryUserData();
    await use(userDataDir);
    await removeTemporaryUserData(userDataDir);
  },
  // A failed test can leave the app open, and Windows would not let the folder be deleted.
  launch: async ({ userDataDir }, use) => {
    const running = new Set<number>();
    await use(async () => {
      const register = await launchRegister(userDataDir, recordStartupOptions(userDataDir));
      const mainPid = await readMainPid(register);
      running.add(mainPid);
      register.once('close', () => running.delete(mainPid));
      return register;
    });
    await Promise.all([...running].map(forceClose));
  },
});

function lookupBox(page: Page): Locator {
  return page.getByRole('combobox', { name: 'Buscar producto' });
}

function total(page: Page): Locator {
  return page.getByRole('status', { name: 'Total', exact: true });
}

/** Reads the local database from outside the screen, the way the owner's accountant would see it. */
async function readRows<Row>(register: ElectronApplication, databasePath: string, sql: string): Promise<Row[]> {
  return register.evaluate(
    (_electron, { path, query }) => {
      const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
      const database = new DatabaseSync(path, { readOnly: true });
      try {
        return database.prepare(query).all();
      } finally {
        database.close();
      }
    },
    { path: databasePath, query: sql },
  ) as Promise<Row[]>;
}

test('charges one line at another price for this sale only, and leaves the catalog alone (ADR 0061)', async ({ userDataDir, launch }) => {
  const register = await launch();
  const page = await signInWindow(register);
  const { databasePath } = testSalePaths(userDataDir);
  await expect(lookupBox(page)).toBeFocused();

  await page.keyboard.type(HAMMER_CODE);
  await page.keyboard.press('Enter');
  await expect(total(page)).toHaveText('$116.00');

  await page.keyboard.press('F7');
  const priceBox = page.getByRole('textbox', { name: 'Precio para esta venta (IVA incluido)' });
  await expect(priceBox).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Precio del catálogo: $116.00');
  // Letters never get into a box for money.
  await priceBox.fill('1x00');
  await expect(priceBox).toHaveValue('100');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(total(page)).toHaveText('$100.00');
  await expect(page.getByRole('status').filter({ hasText: 'solo en esta venta' })).toBeVisible();
  await expect(lookupBox(page)).toBeFocused();

  await page.keyboard.press('F12');
  await expect(page.getByRole('dialog', { name: 'Cobrar' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Total a cobrar' })).toHaveText('$100.00');

  expect(await readRows(register, databasePath, 'SELECT total_cents FROM sale')).toEqual([{ total_cents: 10_000 }]);
  expect(await readRows(register, databasePath, "SELECT unit_price_e4 FROM product WHERE name LIKE 'Martillo%'")).toEqual([{ unit_price_e4: 1_160_000 }]);
  expect(await readRows(register, databasePath, "SELECT action, detail FROM audit_log WHERE action = 'sale.price_override'")).toEqual([
    { action: 'sale.price_override', detail: expect.stringContaining('catalog 1160000, charged 1000000') },
  ]);
  expect(await readRows(register, databasePath, "SELECT type FROM sync_outbox WHERE type = 'product.price_changed'")).toEqual([]);
});

test('changes the price of the catalog from the panel of the product, and the sale in progress keeps its price (E1-39, ADR 0047)', async ({ userDataDir, launch }) => {
  const register = await launch();
  const page = await signInWindow(register);
  const { databasePath } = testSalePaths(userDataDir);
  const panel = page.locator('dialog[aria-labelledby="product-panel-title"]');

  await page.keyboard.type(HAMMER_CODE);
  await page.keyboard.press('Enter');
  await expect(total(page)).toHaveText('$116.00');

  await page.keyboard.press('F10');
  await expect(panel).toBeVisible();
  await page.keyboard.press('F8');
  await expect(page.getByRole('heading', { name: 'Cambiar precio' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Precio nuevo (IVA incluido)' }).fill('0');
  await page.keyboard.press('F2');
  await expect(page.getByRole('alert')).toContainText('mayor que cero');
  await page.getByRole('textbox', { name: 'Precio nuevo (IVA incluido)' }).fill('139.20');
  await page.keyboard.press('F2');
  await expect(panel).toContainText('Precio cambiado: $116.00 → $139.20');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // The keyboard comes back to the lookup box a moment after the dialog closes, and F12 typed before that is lost.
  await expect(lookupBox(page)).toBeFocused();

  // The line that was already on the sale keeps the price it showed.
  await page.keyboard.press('F12');
  await expect(page.getByRole('dialog', { name: 'Cobrar' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Total a cobrar' })).toHaveText('$116.00');

  expect(await readRows(register, databasePath, 'SELECT total_cents FROM sale')).toEqual([{ total_cents: 11_600 }]);
  expect(await readRows(register, databasePath, "SELECT unit_price_e4 FROM product WHERE name LIKE 'Martillo%'")).toEqual([{ unit_price_e4: 1_392_000 }]);
  expect(await readRows(register, databasePath, "SELECT action, detail FROM audit_log WHERE action = 'product.price_change'")).toEqual([
    { action: 'product.price_change', detail: expect.stringContaining('$116.00 to $139.20') },
  ]);
  expect(await readRows(register, databasePath, "SELECT type FROM sync_outbox WHERE type = 'product.price_changed'")).toEqual([{ type: 'product.price_changed' }]);
});
