import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { test as base, expect, type ElectronApplication } from '@playwright/test';
import ExcelJS from 'exceljs';

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

test('orders from a supplier: finds the product by the code of the supplier, saves a draft, gets the Excel and the PDF, and sends it (E1-44)', async ({
  userDataDir,
  launch,
}) => {
  const register = await launch();
  const page = await signInWindow(register);
  const { databasePath } = testSalePaths(userDataDir);
  const xlsxPath = join(userDataDir, 'pedido.xlsx');
  const pdfPath = join(userDataDir, 'pedido.pdf');
  const dialog = page.locator('dialog[aria-labelledby="order-title"]');
  const stockBefore = await readRows(register, databasePath, 'SELECT count(*) AS total FROM stock_movement');

  // The window to choose where to save is the one of Windows, which a test cannot click: it answers with these paths.
  await register.evaluate(({ dialog: electronDialog }, paths) => {
    const answers = [...paths];
    electronDialog.showSaveDialog = (() => Promise.resolve({ canceled: false, filePath: answers.shift() ?? '' })) as typeof electronDialog.showSaveDialog;
  }, [xlsxPath, pdfPath]);

  // Shift+F11 on the sale screen opens the orders (plain F11 is the summary of the business).
  await page.keyboard.press('Shift+F11');
  await expect(page.getByRole('heading', { name: 'Pedido al proveedor' })).toBeVisible();
  await expect(dialog).toContainText('Todavía no has hecho ningún pedido.');

  // A supplier, and the code it gives to the hammer, with the cost of its list.
  await page.keyboard.press('F3');
  await expect(page.getByRole('heading', { name: 'Proveedores' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Nombre del proveedor' }).fill('Ferretera del Centro');
  await page.getByRole('textbox', { name: 'Contacto (opcional)' }).fill('Pedidos: 55 1234 5678');
  await page.keyboard.press('F2');
  await expect(dialog).toContainText('Listo. El proveedor quedó guardado');
  await page.keyboard.press('F4');
  await expect(page.getByRole('heading', { name: 'Códigos de Ferretera del Centro' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Producto', exact: true }).fill(HAMMER_CODE);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: HAMMER_NAME })).toBeVisible();
  await page.getByRole('button', { name: 'Agregar un código' }).click();
  await page.getByRole('textbox', { name: 'Código o SKU del proveedor 1' }).fill('MAR-16');
  await page.getByRole('textbox', { name: 'Costo de lista 1 (opcional)' }).fill('55');
  await page.getByRole('textbox', { name: 'Presentación 1 (opcional)' }).fill('Caja con 6');
  await page.keyboard.press('F2');
  await expect(dialog).toContainText('Listo. Los códigos quedaron guardados');
  // Each Esc goes back one step, and the next one waits for the screen it reached.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'Producto', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Proveedores' })).toBeVisible();
  // The keys wait while the list of suppliers is being read, so the next Esc waits for the list.
  await expect(page.getByRole('button', { name: 'Ferretera del Centro' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Pedido al proveedor' })).toBeVisible();

  // The list is read again on the way back, and the keys wait until it is there.
  await expect(page.getByRole('button', { name: /Pedido nuevo/ })).toBeEnabled();
  await expect(dialog).toContainText('Todavía no has hecho ningún pedido.');
  // A new order: the supplier is already chosen, and the code of the supplier finds the product.
  await page.keyboard.press('F2');
  await expect(page.getByRole('heading', { name: 'Pedido nuevo' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Buscar producto para el pedido' }).fill('mar-16');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: `Cantidad de ${HAMMER_NAME}` })).toHaveValue('1');
  await expect(page.getByRole('textbox', { name: `Costo estimado de ${HAMMER_NAME}` })).toHaveValue('55.00');
  await page.getByRole('textbox', { name: `Cantidad de ${HAMMER_NAME}` }).fill('3');
  await expect(page.getByRole('status', { name: 'Total estimado del pedido' })).toContainText('$165.00');

  // The draft is saved with a folio, and nothing moved in the stock.
  await page.keyboard.press('F2');
  await expect(dialog).toContainText('Borrador guardado: PED-0001');
  expect(await readRows(register, databasePath, 'SELECT folio, status, supplier_name FROM purchase_order')).toEqual([
    { folio: 1, status: 'draft', supplier_name: 'Ferretera del Centro' },
  ]);
  expect(await readRows(register, databasePath, 'SELECT supplier_code, quantity_milli, unit_cost_e6, line_total_cents FROM purchase_order_line')).toEqual([
    { supplier_code: 'MAR-16', quantity_milli: 3_000, unit_cost_e6: 55_000_000, line_total_cents: 16_500 },
  ]);

  // The Excel file reads back with what was ordered.
  await page.keyboard.press('F5');
  await expect(dialog).toContainText('Archivo guardado en');
  expect(existsSync(xlsxPath)).toBe(true);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);
  const sheet = workbook.getWorksheet('Pedido')!;
  expect(sheet.getRow(6).values).toEqual([undefined, 'Código del proveedor', 'Descripción', 'Código de barras', 'Cantidad', 'Unidad', 'Costo estimado', 'Importe']);
  expect(sheet.getRow(7).values).toEqual([undefined, 'MAR-16', HAMMER_NAME, HAMMER_CODE, 3, 'pza', 55, 165]);
  expect(sheet.getRow(8).getCell(7).value).toBe(165);

  // The PDF is printed by the engine of the app itself.
  await page.keyboard.press('F6');
  await expect(dialog).toContainText('pedido.pdf');
  expect(readFileSync(pdfPath).subarray(0, 5).toString()).toBe('%PDF-');

  // Marking it as sent asks first, keeps the history and queues the operation for the core.
  await page.keyboard.press('F4');
  await expect(dialog).toContainText('¿Marcar como enviado?');
  await page.keyboard.press('F4');
  await expect(dialog).toContainText('PED-0001 quedó como enviado');
  await expect(page.getByRole('textbox', { name: `Cantidad de ${HAMMER_NAME}` })).toHaveCount(0);
  expect(await readRows(register, databasePath, 'SELECT status FROM purchase_order')).toEqual([{ status: 'sent' }]);
  expect(await readRows(register, databasePath, "SELECT type FROM sync_outbox WHERE type LIKE 'supplier%' OR type LIKE 'purchase_order%' ORDER BY device_seq")).toEqual([
    { type: 'supplier.upserted' },
    { type: 'supplier_product.upserted' },
    { type: 'purchase_order.sent' },
  ]);
  expect(await readRows(register, databasePath, "SELECT action FROM audit_log WHERE action LIKE 'purchase_order.%' ORDER BY rowid")).toEqual([
    { action: 'purchase_order.create' },
    { action: 'purchase_order.export' },
    { action: 'purchase_order.export' },
    { action: 'purchase_order.send' },
  ]);
  expect(await readRows(register, databasePath, 'SELECT count(*) AS total FROM stock_movement')).toEqual(stockBefore);

  // Esc goes back to the list, where the sent order stays as the history, and then back to the sale.
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('table', { name: 'Pedidos' })).toContainText('Enviado');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Buscar producto' })).toBeFocused();
});
