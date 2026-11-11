import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
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

/** The window of Windows to choose a file cannot be clicked by a test, so it answers with the path the test picked. */
async function answerFileWindowWith(register: ElectronApplication, path: string): Promise<void> {
  await register.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = (() => Promise.resolve({ canceled: false, filePaths: [chosen] })) as unknown as typeof dialog.showOpenDialog;
  }, path);
}

test('loads the catalog and the stock of Eleventa, and then sells from it (RF-034)', async ({ userDataDir, launch }) => {
  const register = await launch();
  const page = await signInWindow(register);
  const file = join(userDataDir, 'productos.csv');
  writeFileSync(file, 'Código,Descripción,Precio Costo,Precio Venta,Existencia,Unidad\n7501,Martillo de bola,80,116,12,Pieza\n7502,Cable THW,6.25,12.5,100,m\n,Sin código,1,2,3,Pieza\n');
  await answerFileWindowWith(register, file);

  await page.keyboard.press('F1');
  await expect(page.getByRole('heading', { name: 'Administración' })).toBeVisible();
  await page.keyboard.press('F5');

  await expect(page.getByRole('heading', { name: 'Catálogo cargado' })).toBeVisible();
  const result = page.getByLabel('Resultado de la carga');
  await expect(result).toContainText('Productos nuevos2');
  await expect(result).toContainText('$1,585.00');
  await expect(page.getByRole('alert')).toContainText('Línea 4: El código está vacío');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Administración' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Buscar producto' })).toBeFocused();

  await page.keyboard.type('7501');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status', { name: 'Total', exact: true })).toHaveText('$116.00');
  await page.keyboard.type('2000000000107');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('No encontramos');
  expect(await register.evaluate((_electron, path) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const database = new DatabaseSync(path, { readOnly: true });
    try {
      return database.prepare("SELECT type, source, quantity_milli FROM stock_movement ORDER BY quantity_milli").all();
    } finally {
      database.close();
    }
  }, testSalePaths(userDataDir).databasePath)).toEqual([
    { type: 'opening_balance', source: 'import', quantity_milli: 12_000 },
    { type: 'opening_balance', source: 'import', quantity_milli: 100_000 },
  ]);
});

// The passphrase is protected with the encryption of Windows, which a Linux runner does not have. The rest is covered by unit tests.
test('makes an encrypted backup in the folder the owner chooses, and does not show the data (RNF-09)', async ({ userDataDir, launch }) => {
  test.skip(process.platform !== 'win32', 'The passphrase vault needs Windows');
  const register = await launch();
  const page = await signInWindow(register);
  const usb = join(userDataDir, 'usb');
  mkdirSync(usb);
  await answerFileWindowWith(register, usb);

  await page.keyboard.press('F1');
  await expect(page.getByRole('heading', { name: 'Administración' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('No hay respaldos configurados');
  await page.keyboard.press('F6');
  await page.getByLabel('Contraseña de los respaldos').fill('una contraseña larga');
  await page.keyboard.press('F2');

  await expect(page.getByText('Copia hecha. Ya está guardada y cifrada.')).toBeVisible();
  const copies = readdirSync(usb);
  expect(copies).toHaveLength(1);
  expect(copies[0]).toMatch(/^pos-.*\.posbak$/);
  await expect(page.getByText(/Última copia: (?!todavía)/)).toBeVisible();
});