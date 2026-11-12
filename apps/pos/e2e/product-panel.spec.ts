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
const NEW_CODE = '7509990000001';

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

test('edits a product from the panel, gives it up so the sale cannot find it, and brings it back (E1-43)', async ({ userDataDir, launch }) => {
  const register = await launch();
  const page = await signInWindow(register);
  const { databasePath } = testSalePaths(userDataDir);
  // The panel is the dialog that stays open while the dialogs of the price and the stock open and close over it.
  const panel = page.locator('dialog[aria-labelledby="product-panel-title"]');

  // The panel opens on the product the sale points at.
  await page.keyboard.type(HAMMER_CODE);
  await page.keyboard.press('Enter');
  await expect(total(page)).toHaveText('$116.00');
  await page.keyboard.press('F10');
  await expect(page.getByRole('heading', { name: 'Martillo uña curva 16 oz' })).toBeVisible();
  await expect(panel).toContainText('Precio (IVA incluido)$116.00');
  await expect(panel).toContainText('Existencia0 pza');

  // A form with a mistake says what to fix and writes nothing.
  await page.getByRole('textbox', { name: 'Nombre' }).fill('');
  await page.keyboard.press('F2');
  await expect(panel).toContainText('Escribe el nombre del producto.');
  expect(await readRows(register, databasePath, "SELECT action FROM audit_log WHERE action = 'product.update'")).toEqual([]);

  // A code that another product has is refused as soon as it is typed, naming that product.
  await page.getByRole('textbox', { name: 'Nombre' }).fill('Martillo de bola 16 oz');
  await page.getByRole('textbox', { name: 'Código de barras' }).fill('2000000000206');
  await page.keyboard.press('Enter');
  await expect(panel).toContainText('El código 2000000000206 ya lo usa');

  await page.getByRole('textbox', { name: 'Código de barras' }).fill(NEW_CODE);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('list', { name: 'Códigos del producto' })).toContainText(NEW_CODE);
  await page.getByRole('textbox', { name: 'Costo (opcional)' }).fill('60');
  await page.keyboard.press('F2');
  await expect(panel).toContainText('Listo. Los cambios quedaron guardados');
  await expect(page.getByRole('heading', { name: 'Martillo de bola 16 oz' })).toBeVisible();

  expect(await readRows(register, databasePath, "SELECT name, unit_cost_e6, revision FROM product WHERE name = 'Martillo de bola 16 oz'")).toEqual([
    { name: 'Martillo de bola 16 oz', unit_cost_e6: 60_000_000, revision: 2 },
  ]);
  expect(await readRows(register, databasePath, `SELECT code FROM product_barcode WHERE code IN ('${HAMMER_CODE}', '${NEW_CODE}') ORDER BY code`)).toEqual([
    { code: HAMMER_CODE },
    { code: NEW_CODE },
  ]);
  expect(await readRows(register, databasePath, "SELECT detail FROM audit_log WHERE action = 'product.update'")).toEqual([
    { detail: expect.stringContaining('name "Martillo uña curva 16 oz" -> "Martillo de bola 16 oz"') },
  ]);
  expect(await readRows(register, databasePath, "SELECT type FROM sync_outbox WHERE type = 'product.updated'")).toEqual([{ type: 'product.updated' }]);

  // The stock only moves with an adjustment that has its reason, from the same panel.
  await page.keyboard.press('F9');
  await expect(page.getByRole('heading', { name: 'Ajustar existencia' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Cantidad' }).fill('1');
  await page.getByRole('textbox', { name: 'Motivo' }).fill('Se rompió en la bodega');
  await page.keyboard.press('F2');
  await expect(panel).toContainText('Existencia ajustada.');
  await expect(panel).toContainText('No se puede cambiar: el producto ya tiene movimientos');
  expect(await readRows(register, databasePath, "SELECT type, quantity_milli FROM stock_movement WHERE type = 'waste'")).toEqual([{ type: 'waste', quantity_milli: -1_000 }]);

  // Giving it up hides it from the sale, and nothing is deleted.
  await page.getByRole('checkbox', { name: /A la venta/ }).uncheck();
  await page.keyboard.press('F2');
  await expect(panel).toContainText('Este producto está dado de baja');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(lookupBox(page)).toBeFocused();
  expect(await readRows(register, databasePath, "SELECT is_active FROM product WHERE name = 'Martillo de bola 16 oz'")).toEqual([{ is_active: 0 }]);

  await page.keyboard.press('Delete');
  await expect(total(page)).toHaveText('$0.00');
  await page.keyboard.type(NEW_CODE);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText(`No encontramos «${NEW_CODE}»`);
  await expect(total(page)).toHaveText('$0.00');

  // The panel still finds it, marked, and bringing it back makes it sellable again.
  await page.keyboard.press('Escape');
  await page.keyboard.press('F10');
  await expect(page.getByRole('heading', { name: 'Producto', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Producto', exact: true }).fill(NEW_CODE);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Martillo de bola 16 oz' })).toBeVisible();
  await expect(panel).toContainText('Este producto está dado de baja');
  await page.getByRole('checkbox', { name: /A la venta/ }).check();
  await page.keyboard.press('F2');
  await expect(panel).not.toContainText('Este producto está dado de baja');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(lookupBox(page)).toBeFocused();

  await page.keyboard.type(NEW_CODE);
  await page.keyboard.press('Enter');
  await expect(total(page)).toHaveText('$116.00');
  expect(await readRows(register, databasePath, "SELECT count(*) AS total FROM product WHERE name = 'Martillo de bola 16 oz'")).toEqual([{ total: 1 }]);
});
