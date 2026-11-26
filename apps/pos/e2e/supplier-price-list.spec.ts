import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { test as base, expect, type ElectronApplication } from '@playwright/test';

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

test('imports the price list of a supplier from the agreed CSV, links by barcode and by hand, and remembers it (E1-51)', async ({ userDataDir, launch }) => {
  const register = await launch();
  const page = await signInWindow(register);
  const { databasePath } = testSalePaths(userDataDir);
  const csvPath = join(userDataDir, 'lista.csv');
  const dialog = page.locator('dialog[aria-labelledby="order-title"]');
  writeFileSync(
    csvPath,
    `supplier_code,description,purchase_unit,pieces_per_unit,cost\n${HAMMER_CODE},MARTILLO UÑA CURVA 16 OZ,Caja,6,330\nDES-14,"DESARMADOR PLANO 1/4""",Pieza,1,41.5\n`,
  );
  // The window to choose a file is the one of Windows, which a test cannot click: it answers with the list.
  await register.evaluate(({ dialog: electronDialog }, path) => {
    electronDialog.showOpenDialog = (() => Promise.resolve({ canceled: false, filePaths: [path] })) as typeof electronDialog.showOpenDialog;
  }, csvPath);

  await page.keyboard.press('Shift+F11');
  await expect(page.getByRole('heading', { name: 'Pedido al proveedor' })).toBeVisible();
  await page.getByRole('button', { name: /Proveedores/ }).click();
  await page.getByRole('textbox', { name: 'Nombre del proveedor' }).fill('Ferretera del Centro');
  await page.keyboard.press('F2');
  await expect(dialog).toContainText('Listo. El proveedor quedó guardado');
  await page.getByRole('button', { name: /Lista de precios/ }).click();
  await expect(page.getByRole('heading', { name: 'Lista de precios de Ferretera del Centro' })).toBeVisible();

  await page.getByRole('button', { name: /Importar lista/ }).click();
  await expect(dialog).toContainText('ya reconocí sus columnas');
  await expect(page.getByRole('combobox', { name: '¿Los costos del archivo incluyen IVA?' })).toHaveValue('no');
  await page.getByRole('button', { name: /Reemplazar la lista/ }).click();
  await expect(dialog).toContainText('Entraron 2 artículos y 1 quedaron ligados');

  // The screwdriver has no barcode in the list: the owner links it by hand once.
  await page.getByRole('button', { name: 'Ligar DES-14' }).click();
  await page.getByRole('textbox', { name: 'Producto', exact: true }).fill('desarmador');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Desarmador plano 1/4"' }).click();
  await expect(dialog).toContainText('la próxima lista lo recordará');

  // Importing the same list again keeps both links.
  await page.getByRole('button', { name: /Importar lista/ }).click();
  await expect(dialog).toContainText('Usé las mismas columnas');
  await page.getByRole('button', { name: /Reemplazar la lista/ }).click();
  await expect(dialog).toContainText('Entraron 2 artículos y 2 quedaron ligados');
  expect(
    await readRows(register, databasePath, 'SELECT supplier_code, pieces_per_unit_milli, list_cost_e6, link_origin, source FROM supplier_catalog_item ORDER BY supplier_code'),
  ).toEqual([
    { supplier_code: HAMMER_CODE, pieces_per_unit_milli: 6_000, list_cost_e6: 330_000_000, link_origin: 'barcode', source: 'paper' },
    { supplier_code: 'DES-14', pieces_per_unit_milli: 1_000, list_cost_e6: 41_500_000, link_origin: 'manual', source: 'paper' },
  ]);
  expect(await readRows(register, databasePath, "SELECT action FROM audit_log WHERE action IN ('supplier_price_list.import', 'supplier_catalog.link') ORDER BY rowid")).toEqual([
    { action: 'supplier_price_list.import' },
    { action: 'supplier_catalog.link' },
    { action: 'supplier_price_list.import' },
  ]);
});

test('compares two suppliers per piece, switches a line, gets the PDF and turns the cart into a draft order (E1-52)', async ({ userDataDir, launch }) => {
  const register = await launch();
  const page = await signInWindow(register);
  const { databasePath } = testSalePaths(userDataDir);
  const dialog = page.locator('dialog[aria-labelledby="order-title"]');
  const firstList = join(userDataDir, 'centro.csv');
  const secondList = join(userDataDir, 'norte.csv');
  const pdfPath = join(userDataDir, 'comparador.pdf');
  // A box of 6 hammers at $330.00 is $55.00 each; the other supplier sells one at $60.00. The screwdriver is cheaper there.
  writeFileSync(firstList, `codigo,descripcion,costo,piezas,barras\nMAR-6,Martillo 16 oz caja,330,6,${HAMMER_CODE}\nDES-1,Desarmador plano,45,1,\n`);
  writeFileSync(secondList, `codigo,descripcion,costo,piezas,barras\nN-MAR,Martillo uña curva,60,1,${HAMMER_CODE}\n`);
  await register.evaluate(({ dialog: electronDialog }, paths) => {
    const opened = [...paths.open];
    electronDialog.showOpenDialog = (() => Promise.resolve({ canceled: false, filePaths: [opened.shift() ?? ''] })) as typeof electronDialog.showOpenDialog;
    electronDialog.showSaveDialog = (() => Promise.resolve({ canceled: false, filePath: paths.save })) as typeof electronDialog.showSaveDialog;
  }, { open: [firstList, secondList], save: pdfPath });

  await page.keyboard.press('Shift+F11');
  await expect(page.getByRole('heading', { name: 'Pedido al proveedor' })).toBeVisible();
  await page.getByRole('button', { name: /Proveedores/ }).click();
  for (const name of ['Ferretera del Centro', 'Eléctrica del Norte']) {
    await page.getByRole('button', { name: /Proveedor nuevo/ }).click();
    await page.getByRole('textbox', { name: 'Nombre del proveedor' }).fill(name);
    await page.getByRole('button', { name: /Guardar/ }).click();
    await expect(dialog).toContainText('Listo. El proveedor quedó guardado');
    await page.getByRole('button', { name: /Lista de precios/ }).click();
    await page.getByRole('button', { name: /Importar lista/ }).click();
    await page.getByRole('button', { name: /Reemplazar la lista/ }).click();
    await expect(dialog).toContainText('Entraron');
    await page.getByRole('button', { name: /Volver/ }).click();
    await expect(page.getByRole('heading', { name: 'Proveedores' })).toBeVisible();
  }

  await page.getByRole('button', { name: /Comparar precios/ }).click();
  await page.getByRole('textbox', { name: 'Buscar en las listas' }).fill('martillo');
  await page.keyboard.press('Enter');
  const prices = page.getByRole('table', { name: 'Precios de Martillo uña curva 16 oz' });
  await expect(prices.locator('tr.price-cheapest')).toContainText('Ferretera del Centro');
  await expect(prices.locator('tr.price-highest')).toContainText('+$5.00 (+9.1 %)');
  await page.getByRole('button', { name: 'Agregar Martillo uña curva 16 oz' }).click();
  await page.getByRole('textbox', { name: 'Cantidad de Martillo uña curva 16 oz' }).fill('12');

  await page.getByRole('textbox', { name: 'Buscar en las listas' }).fill('desarmador');
  await page.getByRole('button', { name: /Buscar/ }).click();
  // The screwdriver is not tied to a product yet, so it cannot go in the cart.
  await expect(dialog).toContainText('lígalos a un producto');

  // Switching the hammer to the dearer supplier shows what it costs.
  await page.getByRole('combobox', { name: 'Proveedor de Martillo uña curva 16 oz' }).selectOption({ label: 'Eléctrica del Norte · $60.00' });
  await expect(page.getByRole('status', { name: 'Total del carrito' })).toContainText('ahorro posible: $60.00');
  await page.getByRole('button', { name: /PDF del pedido/ }).click();
  await expect(dialog).toContainText('PDF guardado en');
  expect(existsSync(pdfPath)).toBe(true);

  await page.getByRole('combobox', { name: 'Proveedor de Martillo uña curva 16 oz' }).selectOption({ label: 'Ferretera del Centro · $55.00 (el más barato)' });
  await page.getByRole('button', { name: /Crear pedidos/ }).click();
  await expect(dialog).toContainText('Quedaron como borrador: PED-0001 para Ferretera del Centro ($660.00)');
  expect(await readRows(register, databasePath, 'SELECT supplier_code, quantity_milli, unit_cost_e6, line_total_cents FROM purchase_order_line')).toEqual([
    { supplier_code: 'MAR-6', quantity_milli: 12_000, unit_cost_e6: 55_000_000, line_total_cents: 66_000 },
  ]);
});

test('proposes the same drill bit written two ways, approves it and compares both prices side by side (E1-63)', async ({ userDataDir, launch }) => {
  const register = await launch();
  const page = await signInWindow(register);
  const { databasePath } = testSalePaths(userDataDir);
  const dialog = page.locator('dialog[aria-labelledby="order-title"]');
  const firstList = join(userDataDir, 'centro.csv');
  const secondList = join(userDataDir, 'norte.csv');
  // Neither the names nor the codes agree: one says HSS and inches, the other «alta velocidad» and millimetres.
  writeFileSync(firstList, 'codigo,descripcion,costo,piezas\nB-14,"BROCAS HSS 1/4"" P/METAL",30,1\nB-38,"BROCAS HSS 3/8"" P/METAL",45,1\n');
  writeFileSync(secondList, 'codigo,descripcion,costo,piezas\nAV-635,Broca de alta velocidad 6.35 mm,26,1\nAV-953,Broca de alta velocidad 9.53 mm,50,1\n');
  await register.evaluate(({ dialog: electronDialog }, paths) => {
    const opened = [...paths];
    electronDialog.showOpenDialog = (() => Promise.resolve({ canceled: false, filePaths: [opened.shift() ?? ''] })) as typeof electronDialog.showOpenDialog;
  }, [firstList, secondList]);

  await page.keyboard.press('Shift+F11');
  await expect(page.getByRole('heading', { name: 'Pedido al proveedor' })).toBeVisible();
  await page.getByRole('button', { name: /Proveedores/ }).click();
  for (const name of ['Ferretera del Centro', 'Eléctrica del Norte']) {
    await page.getByRole('button', { name: /Proveedor nuevo/ }).click();
    await page.getByRole('textbox', { name: 'Nombre del proveedor' }).fill(name);
    await page.getByRole('button', { name: /Guardar/ }).click();
    await expect(dialog).toContainText('Listo. El proveedor quedó guardado');
    await page.getByRole('button', { name: /Lista de precios/ }).click();
    await page.getByRole('button', { name: /Importar lista/ }).click();
    await page.getByRole('button', { name: /Reemplazar la lista/ }).click();
    await expect(dialog).toContainText('Entraron 2 artículos');
    await page.getByRole('button', { name: /Volver/ }).click();
    await expect(page.getByRole('heading', { name: 'Proveedores' })).toBeVisible();
  }

  await page.keyboard.press('F7');
  await expect(page.getByRole('heading', { name: 'Productos equivalentes' })).toBeVisible();
  await page.getByRole('button', { name: /Buscar equivalentes/ }).click();
  await expect(dialog).toContainText('Revisé 4 artículos');
  const quarter = page.getByRole('region', { name: /^Propuesta/ }).filter({ hasText: 'B-14' });
  await expect(quarter).toContainText('AV-635');
  await expect(quarter).not.toContainText('AV-953');
  await expect(quarter.locator('tr.price-cheapest')).toContainText('Eléctrica del Norte');
  await quarter.getByRole('textbox', { name: /Nombre del grupo/ }).fill('Broca HSS 1/4"');
  await quarter.getByRole('button', { name: /Aprobar propuesta/ }).click();
  await expect(dialog).toContainText('«Broca HSS 1/4"» ya se compara junto');
  // The other size is not the same product as this one; the owner says so once.
  await page.getByRole('region', { name: /^Propuesta/ }).filter({ hasText: 'B-38' }).getByRole('button', { name: 'No son iguales' }).click();
  await expect(dialog).toContainText('no te los volveré a proponer');

  await page.getByRole('button', { name: /Volver/ }).click();
  await page.getByRole('button', { name: /Comparar precios/ }).click();
  await page.getByRole('textbox', { name: 'Buscar en las listas' }).fill('broca alta velocidad 6.35');
  await page.keyboard.press('Enter');
  const prices = page.getByRole('table', { name: 'Precios de Broca HSS 1/4"' });
  await expect(prices.locator('tr')).toHaveCount(3);
  await expect(prices.locator('tr.price-cheapest')).toContainText('Eléctrica del Norte');
  await expect(prices.locator('tr.price-highest')).toContainText('+$4.00 (+15.4 %)');

  expect(await readRows(register, databasePath, 'SELECT kind, supplier_code, other_supplier_code FROM catalog_match_decision ORDER BY seq')).toEqual([
    { kind: 'join', supplier_code: 'B-14', other_supplier_code: null },
    { kind: 'join', supplier_code: 'AV-635', other_supplier_code: null },
    { kind: 'name', supplier_code: null, other_supplier_code: null },
    { kind: 'reject', supplier_code: 'B-38', other_supplier_code: 'AV-953' },
  ]);
  expect(await readRows(register, databasePath, "SELECT action FROM audit_log WHERE action LIKE 'catalog_equivalence.%' ORDER BY rowid")).toEqual([
    { action: 'catalog_equivalence.approve' },
    { action: 'catalog_equivalence.reject' },
  ]);
});
