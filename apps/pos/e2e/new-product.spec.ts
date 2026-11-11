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

const NEW_CODE = '7509876543210';

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

test('adds a product that is not in the catalog from the sale screen, writes everything together, and sells it right away (E1-42)', async ({ userDataDir, launch }) => {
  const register = await launch();
  const page = await signInWindow(register);
  const { databasePath } = testSalePaths(userDataDir);

  // The customer brings something the catalog does not have: the scan finds nothing and offers to add it.
  await page.keyboard.type(NEW_CODE);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText(`No encontramos «${NEW_CODE}»`);
  await page.keyboard.press('F5');

  await expect(page.getByRole('heading', { name: 'Producto nuevo' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Códigos del producto' })).toContainText(NEW_CODE);

  // Saving a form with nothing in it says what is missing and writes nothing.
  await page.keyboard.press('F2');
  await expect(page.getByRole('dialog')).toContainText('Escribe el nombre del producto.');
  await expect(page.getByRole('dialog')).toContainText('Escribe el precio');

  await page.getByRole('textbox', { name: 'Nombre' }).fill('Cinta métrica 5 m');
  await page.getByRole('textbox', { name: 'Precio (IVA incluido)' }).fill('89.50');
  await page.getByRole('textbox', { name: 'Costo (opcional)' }).fill('52.25');
  await page.getByRole('textbox', { name: 'Existencia inicial (opcional)' }).fill('12');
  await page.keyboard.press('F2');

  // The product the customer brought goes straight onto the sale.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Producto nuevo: Cinta métrica 5 m' })).toBeVisible();
  await expect(total(page)).toHaveText('$89.50');
  await expect(lookupBox(page)).toBeFocused();

  expect(await readRows(register, databasePath, "SELECT name, base_unit, unit_price_e4, unit_cost_e6, is_active FROM product WHERE name = 'Cinta métrica 5 m'")).toEqual([
    { name: 'Cinta métrica 5 m', base_unit: 'piece', unit_price_e4: 895_000, unit_cost_e6: 52_250_000, is_active: 1 },
  ]);
  expect(await readRows(register, databasePath, `SELECT code FROM product_barcode WHERE code = '${NEW_CODE}'`)).toEqual([{ code: NEW_CODE }]);
  expect(await readRows(register, databasePath, "SELECT type, quantity_milli, unit_cost_e6, source FROM stock_movement WHERE source = 'product_creation'")).toEqual([
    { type: 'opening_balance', quantity_milli: 12_000, unit_cost_e6: 52_250_000, source: 'product_creation' },
  ]);
  expect(await readRows(register, databasePath, "SELECT detail FROM audit_log WHERE action = 'product.create'")).toEqual([
    { detail: expect.stringContaining('Cinta métrica 5 m') },
  ]);
  expect(await readRows(register, databasePath, "SELECT type FROM sync_outbox WHERE type = 'product.created'")).toEqual([{ type: 'product.created' }]);

  // A new sale scans the code of the product that was just added, with no internet.
  await page.keyboard.press('Delete');
  await expect(total(page)).toHaveText('$0.00');
  await page.keyboard.type(NEW_CODE);
  await page.keyboard.press('Enter');
  await expect(total(page)).toHaveText('$89.50');

  // The same code cannot go to a second product: the form says which one has it.
  await page.keyboard.press('F5');
  await expect(page.getByRole('heading', { name: 'Producto nuevo' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Código de barras' }).fill(NEW_CODE);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toContainText(`El código ${NEW_CODE} ya lo usa «Cinta métrica 5 m».`);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
