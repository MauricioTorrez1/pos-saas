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

test('changes the price of a product from the sale screen, writes it down, and leaves the sale in progress alone (E1-39)', async ({ userDataDir, launch }) => {
  const register = await launch();
  const page = await signInWindow(register);
  const { databasePath } = testSalePaths(userDataDir);
  await expect(lookupBox(page)).toBeFocused();

  await page.keyboard.type(HAMMER_CODE);
  await page.keyboard.press('Enter');
  await expect(total(page)).toHaveText('$116.00');

  await page.keyboard.press('F7');
  await expect(page.getByRole('heading', { name: 'Cambiar precio' })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Precio actual: $116.00');
  await page.getByRole('textbox', { name: 'Precio nuevo (IVA incluido)' }).fill('0');
  await page.keyboard.press('F2');
  await expect(page.getByRole('alert')).toContainText('mayor que cero');
  await page.getByRole('textbox', { name: 'Precio nuevo (IVA incluido)' }).fill('139.20');
  await expect(page.getByRole('dialog')).toContainText('Antes $116.00 → ahora $139.20');
  await page.keyboard.press('F2');

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Precio de Martillo' })).toContainText('$116.00 → $139.20');
  // The line that was already on the sale keeps its price, and a new one gets the new price.
  await expect(total(page)).toHaveText('$116.00');
  await expect(lookupBox(page)).toBeFocused();
  await page.keyboard.press('Delete');
  await expect(total(page)).toHaveText('$0.00');
  await page.keyboard.type(HAMMER_CODE);
  await page.keyboard.press('Enter');
  await expect(total(page)).toHaveText('$139.20');

  expect(await readRows(register, databasePath, "SELECT unit_price_e4 FROM product WHERE name LIKE 'Martillo%'")).toEqual([{ unit_price_e4: 1_392_000 }]);
  expect(await readRows(register, databasePath, "SELECT action, detail FROM audit_log WHERE action = 'product.price_change'")).toEqual([
    { action: 'product.price_change', detail: expect.stringContaining('$116.00 to $139.20') },
  ]);
  expect(await readRows(register, databasePath, "SELECT type FROM sync_outbox WHERE type = 'product.price_changed'")).toEqual([{ type: 'product.price_changed' }]);
});

test('charges a sale rung up before the price changed with the prices it showed (ADR 0047)', async ({ userDataDir, launch }) => {
  const register = await launch();
  const page = await signInWindow(register);
  const { databasePath } = testSalePaths(userDataDir);

  await page.keyboard.type(HAMMER_CODE);
  await page.keyboard.press('Enter');
  await expect(total(page)).toHaveText('$116.00');
  await page.keyboard.press('F7');
  await page.getByRole('textbox', { name: 'Precio nuevo (IVA incluido)' }).fill('139.20');
  await page.keyboard.press('F2');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // The keyboard comes back to the lookup box a moment after the dialog closes, and F12 typed before that is lost.
  await expect(lookupBox(page)).toBeFocused();

  await page.keyboard.press('F12');
  await expect(page.getByRole('dialog', { name: 'Cobrar' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Total a cobrar' })).toHaveText('$116.00');
  expect(await readRows(register, databasePath, 'SELECT total_cents FROM sale')).toEqual([{ total_cents: 11_600 }]);
});
