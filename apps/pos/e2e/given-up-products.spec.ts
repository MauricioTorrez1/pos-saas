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
const HAMMER_NAME = 'Martillo uña curva 16 oz';

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

test('gives a product up so a new one takes its code and name, and brings it back from the given-up list without stealing the code (E1-62)', async ({ userDataDir, launch }) => {
  const register = await launch();
  const page = await signInWindow(register);
  const { databasePath } = testSalePaths(userDataDir);
  const panel = page.locator('dialog[aria-labelledby="product-panel-title"]');
  const givenUpList = page.locator('dialog[aria-labelledby="given-up-title"]');

  // The hammer is given up from its panel.
  await page.keyboard.type(HAMMER_CODE);
  await page.keyboard.press('Enter');
  await expect(total(page)).toHaveText('$116.00');
  await page.keyboard.press('F10');
  await expect(page.getByRole('heading', { name: HAMMER_NAME })).toBeVisible();
  await page.getByRole('button', { name: 'Dar de baja' }).click();
  await page.getByRole('button', { name: /Sí, dar de baja/ }).click();
  await expect(panel).toContainText(`Sus códigos quedaron libres: ${HAMMER_CODE}.`);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Delete');
  await expect(total(page)).toHaveText('$0.00');

  // Its code is free: scanning it offers a new product, which keeps the same name and sells right away.
  await page.keyboard.type(HAMMER_CODE);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText(`No encontramos «${HAMMER_CODE}»`);
  await page.keyboard.press('F5');
  await expect(page.getByRole('list', { name: 'Códigos del producto' })).toContainText(HAMMER_CODE);
  await page.getByRole('textbox', { name: 'Nombre' }).fill(HAMMER_NAME);
  await page.getByRole('textbox', { name: 'Precio (IVA incluido)' }).fill('120.00');
  await page.keyboard.press('F2');
  await expect(total(page)).toHaveText('$120.00');

  expect(await readRows(register, databasePath, `SELECT is_active FROM product WHERE name = '${HAMMER_NAME}' ORDER BY is_active`)).toEqual([{ is_active: 0 }, { is_active: 1 }]);
  expect(
    await readRows(register, databasePath, `SELECT product.is_active FROM product_barcode JOIN product ON product.id = product_barcode.product_id WHERE code = '${HAMMER_CODE}'`),
  ).toEqual([{ is_active: 1 }]);
  expect(await readRows(register, databasePath, `SELECT code, restored_at FROM product_code_history`)).toEqual([{ code: HAMMER_CODE, restored_at: null }]);

  // The list of the given-up products opens from the panel while it searches.
  await page.keyboard.press('Delete');
  await page.keyboard.press('Escape');
  await page.keyboard.press('F10');
  await expect(page.getByRole('heading', { name: 'Producto', exact: true })).toBeVisible();
  await page.keyboard.press('F6');
  await expect(page.getByRole('heading', { name: 'Productos dados de baja' })).toBeVisible();
  const row = givenUpList.getByRole('row').filter({ hasText: HAMMER_NAME });
  await expect(row).toContainText(HAMMER_CODE);
  await expect(row).toContainText('$116.00');

  // Reactivating explains that the new product has the code and the name, and never takes them.
  await row.getByRole('button', { name: 'Reactivar' }).click();
  await expect(page.getByRole('heading', { name: `Reactivar ${HAMMER_NAME}` })).toBeVisible();
  await expect(page.getByText(`ya lo usa «${HAMMER_NAME}». Se reactiva sin este código`)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: `Recuperar ${HAMMER_CODE}` })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill(`${HAMMER_NAME} (viejo)`);
  await page.keyboard.press('F2');
  await expect(givenUpList).toContainText(`«${HAMMER_NAME} (viejo)» está a la venta otra vez, sin códigos.`);
  await expect(givenUpList).toContainText('No hay productos dados de baja.');

  await page.keyboard.press('Escape');
  await expect(givenUpList).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  // The code still sells the new product.
  await page.keyboard.type(HAMMER_CODE);
  await page.keyboard.press('Enter');
  await expect(total(page)).toHaveText('$120.00');
  expect(await readRows(register, databasePath, `SELECT name, is_active FROM product WHERE name LIKE 'Martillo uña%' ORDER BY name`)).toEqual([
    { name: HAMMER_NAME, is_active: 1 },
    { name: `${HAMMER_NAME} (viejo)`, is_active: 1 },
  ]);
});
