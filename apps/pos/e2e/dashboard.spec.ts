import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { test as base, expect, type ElectronApplication } from '@playwright/test';

import { createTemporaryUserData, forceClose, launchRegister, readMainPid, recordStartupOptions, removeTemporaryUserData, signInWindow } from './register-harness.ts';

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

test('shows the summary of the business after a sale and saves it as Excel and PDF (E1-45)', async ({ userDataDir, launch }) => {
  const register = await launch();
  const page = await signInWindow(register);

  await page.keyboard.type(HAMMER_CODE);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status', { name: 'Total', exact: true })).toHaveText('$116.00');
  await page.keyboard.press('F12');
  await expect(page.getByRole('textbox', { name: 'Efectivo recibido' })).toBeFocused();
  await page.keyboard.type('116');
  await page.keyboard.press('F2');
  await expect(page.getByRole('status', { name: 'Cambio a entregar' })).toHaveText('Sin cambio');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.keyboard.press('F11');
  const dashboard = page.locator('dialog[aria-labelledby="dashboard-title"]');
  await expect(dashboard.getByRole('heading', { name: 'Resumen del negocio' })).toBeVisible();
  const indicators = dashboard.getByLabel('Indicadores del periodo');
  await expect(indicators).toContainText('Ventas totales (con IVA)$116.00');
  await expect(indicators).toContainText('Tickets1');
  await expect(dashboard.getByRole('img', { name: 'Ventas por hora del día' })).toBeVisible();

  await dashboard.getByRole('tab', { name: 'Más vendidos' }).click();
  await expect(dashboard.getByRole('table', { name: 'Productos más vendidos' })).toContainText('Martillo uña curva 16 oz');
  await dashboard.getByRole('tab', { name: 'Inventario' }).click();
  await expect(dashboard.getByRole('region', { name: 'Sin movimiento' })).toBeVisible();

  // The window to choose where to save is the one of Windows, so the test answers it with a path.
  const excelPath = join(userDataDir, 'resumen.xlsx');
  const pdfPath = join(userDataDir, 'resumen.pdf');
  await register.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
  }, excelPath);
  await page.keyboard.press('F3');
  await expect(dashboard.getByRole('status')).toContainText(excelPath);
  expect(readFileSync(excelPath).subarray(0, 2).toString()).toBe('PK');

  await register.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
  }, pdfPath);
  await page.keyboard.press('F4');
  await expect(dashboard.getByRole('status')).toContainText(pdfPath);
  expect(existsSync(pdfPath)).toBe(true);
  expect(readFileSync(pdfPath).subarray(0, 5).toString()).toBe('%PDF-');

  await page.keyboard.press('Escape');
  await expect(dashboard).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Buscar producto' })).toBeFocused();
});
