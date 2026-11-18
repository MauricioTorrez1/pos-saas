import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { test as base, expect, type ElectronApplication } from '@playwright/test';

import { createTemporaryUserData, forceClose, launchRegister, readMainPid, recordStartupOptions, removeTemporaryUserData, signInWindow } from './register-harness.ts';

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

test('exports the whole catalog as a CSV that Excel opens with its accents (E1-55)', async ({ userDataDir, launch }) => {
  const register = await launch();
  const page = await signInWindow(register);
  const products = join(userDataDir, 'productos.csv');
  writeFileSync(products, 'Código,Descripción,Precio Costo,Precio Venta,Existencia,Unidad\n7501,Martillo de bola,80,116,12,Pieza\n7502,"Cable THW, calibre 12",6.25,12.5,100,m\n');
  await register.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = (() => Promise.resolve({ canceled: false, filePaths: [chosen] })) as unknown as typeof dialog.showOpenDialog;
  }, products);

  await page.keyboard.press('F1');
  await expect(page.getByRole('heading', { name: 'Administración' })).toBeVisible();
  await page.keyboard.press('F5');
  await expect(page.getByRole('heading', { name: 'Cargar productos desde un archivo' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Catálogo cargado' })).toBeVisible();
  await page.keyboard.press('Enter');

  // The window to save is the one of Windows, so the test answers it with a path.
  const csvPath = join(userDataDir, 'catalogo.csv');
  await register.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
  }, csvPath);
  await page.keyboard.press('F12');
  await expect(page.getByRole('heading', { name: 'Exportar catálogo' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Solo activos (F5)' })).toBeChecked();
  await page.keyboard.press('F4');
  await expect(page.getByRole('status')).toContainText(csvPath);

  const bytes = readFileSync(csvPath);
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const lines = bytes.toString('utf8').slice(1).split('\r\n');
  expect(lines[0]).toContain('Código principal');
  expect(lines).toContainEqual(expect.stringContaining('7501,,Martillo de bola,Pieza,,80.00,92.80,116.00,16 %,12.000,20.00 %,17.24 %,Capturado'));
  expect(lines).toContainEqual(expect.stringContaining('"Cable THW, calibre 12",Metro'));
  expect(lines).toContainEqual(expect.stringContaining('Leyenda'));

  // The PDF is printed in landscape from a temporary file by the real engine of the app.
  const pdfPath = join(userDataDir, 'catalogo.pdf');
  await register.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
  }, pdfPath);
  await page.keyboard.press('F2');
  await expect(page.getByRole('status')).toContainText(pdfPath);
  const pdf = readFileSync(pdfPath);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  // Letter landscape is 792 points wide and 612 tall.
  expect(pdf.toString('latin1')).toMatch(/\/MediaBox\s*\[\s*0 0 792 612\s*\]/);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Administración' })).toBeVisible();
});
