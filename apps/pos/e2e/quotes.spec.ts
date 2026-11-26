import { test as base, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';

import { createTemporaryUserData, forceClose, launchRegister, readMainPid, recordStartupOptions, removeTemporaryUserData, signInWindow, testSalePaths } from './register-harness.ts';

/** The sample products the register starts with. Written out here so a change in the list breaks these tests. */
const HAMMER_CODE = '2000000000107';
const HAMMER_NAME = 'Martillo uña curva 16 oz';
const CABLE_NAME = 'Cable THW calibre 12';

interface QuoteRows {
  readonly statuses: readonly { status: string; sale_id: string | null }[];
  readonly completedSales: readonly { id: string; total_cents: number }[];
  readonly stockMovements: number;
}

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

function panel(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Cotizaciones' });
}

async function readRows(register: ElectronApplication, databasePath: string): Promise<QuoteRows> {
  return register.evaluate((_electron, path) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const database = new DatabaseSync(path, { readOnly: true });
    try {
      return {
        statuses: database.prepare('SELECT status, sale_id FROM quote_status ORDER BY sequence').all(),
        completedSales: database.prepare("SELECT id, total_cents FROM sale WHERE status = 'completed'").all(),
        stockMovements: (database.prepare('SELECT count(*) AS total FROM stock_movement').get() as { total: number }).total,
      } as unknown as QuoteRows;
    } finally {
      database.close();
    }
  }, databasePath);
}

/** The owner raises the price of the hammer while the quote is open, as a new price list would. */
async function raiseHammerPrice(register: ElectronApplication, databasePath: string): Promise<void> {
  await register.evaluate(
    (_electron, { path, name }) => {
      const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
      const database = new DatabaseSync(path, { timeout: 5_000 });
      try {
        database.prepare('UPDATE product SET unit_price_e4 = 1300000 WHERE name = ?').run(name);
      } finally {
        database.close();
      }
    },
    { path: databasePath, name: HAMMER_NAME },
  );
}

test('creates a quote, previews its print, and sells it at the quoted price (F2-07)', async ({ userDataDir, launch }) => {
  const register = await launch();
  const page = await signInWindow(register);
  const { databasePath } = testSalePaths(userDataDir);
  const stockBefore = (await readRows(register, databasePath)).stockMovements;

  await page.keyboard.press('Shift+F12');
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toContainText('Todavía no hay cotizaciones.');
  await panel(page).getByRole('button', { name: 'Nueva cotización' }).click();

  await panel(page).getByRole('textbox', { name: 'Cliente (opcional)' }).fill('Martín López');
  const productBox = panel(page).getByRole('textbox', { name: 'Agregar producto a la cotización' });
  await productBox.fill(HAMMER_CODE);
  await productBox.press('Enter');
  await expect(panel(page).getByRole('cell', { name: HAMMER_NAME, exact: true })).toBeVisible();
  await productBox.fill('cable thw');
  await productBox.press('Enter');
  await panel(page).getByRole('button', { name: new RegExp(`^${CABLE_NAME}`) }).click();
  await panel(page).getByRole('textbox', { name: `Cantidad de ${CABLE_NAME}` }).fill('3.5');
  await expect(panel(page).getByRole('status', { name: 'Total de la cotización' })).toHaveText('Total $159.75');
  await panel(page).getByRole('button', { name: 'Guardar cotización' }).click();

  await expect(panel(page)).toContainText('Cotización COT-000001 guardada.');
  await expect(panel(page).getByRole('heading', { name: /COT-000001/ })).toContainText('Vigente');
  expect((await readRows(register, databasePath)).stockMovements).toBe(stockBefore);

  await panel(page).getByRole('button', { name: 'Imprimir', exact: true }).click();
  const preview = panel(page).getByLabel('Vista previa de la cotización', { exact: true });
  await expect(preview).toContainText('COTIZACIÓN');
  await expect(preview).toContainText('Folio COT-000001');
  await expect(preview).toContainText('Cliente: Martín López');
  await expect(preview).toContainText('Este documento no es una venta');
  await expect(preview).toContainText('$159.75');

  await raiseHammerPrice(register, databasePath);
  await panel(page).getByRole('button', { name: 'Convertir en venta' }).click();

  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByLabel('Venta de cotización')).toHaveText('Cotización COT-000001');
  await expect(page.getByRole('status').filter({ hasText: 'Un precio de hoy es distinto: se respeta el precio cotizado.' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Total', exact: true })).toHaveText('$159.75');

  await page.keyboard.press('F12');
  await expect(page.getByRole('textbox', { name: 'Efectivo recibido' })).toBeFocused();
  await page.keyboard.type('200');
  await page.keyboard.press('F2');
  await expect(page.getByRole('status', { name: 'Cambio a entregar' })).toHaveText('Entrega $40.25 de cambio');
  await page.keyboard.press('Enter');

  await expect.poll(async () => (await readRows(register, databasePath)).statuses.map((row) => row.status)).toEqual(['draft', 'converted']);
  const rows = await readRows(register, databasePath);
  expect(rows.completedSales).toEqual([{ id: rows.statuses[1]!.sale_id, total_cents: 15_975 }]);

  // The key is read by the lookup box, which takes the keyboard back a moment after the payment closes.
  await expect(page.getByRole('combobox', { name: 'Buscar producto' })).toBeFocused();
  await page.keyboard.press('Shift+F12');
  await expect(panel(page).getByRole('row', { name: /COT-000001/ })).toContainText('Vendida');
});
