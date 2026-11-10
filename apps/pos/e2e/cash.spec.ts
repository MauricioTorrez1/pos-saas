import { test as base, expect, type ElectronApplication, type Page } from '@playwright/test';

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

async function sellHammerInCash(page: Page): Promise<void> {
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
  await expect(page.getByRole('combobox', { name: 'Buscar producto' })).toBeFocused();
}

async function readCuts(register: ElectronApplication, databasePath: string): Promise<unknown> {
  return register.evaluate((_electron, path) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const database = new DatabaseSync(path, { readOnly: true });
    try {
      return {
        cuts: database.prepare('SELECT expected_cash_cents, counted_cash_cents, reason FROM cash_cut').all(),
        openSessions: database.prepare('SELECT count(*) AS total FROM cash_session WHERE closed_at IS NULL').get(),
        sale: database.prepare('SELECT cash_session_id IS NOT NULL AS in_session, cashier_id IS NOT NULL AS has_cashier FROM sale').all(),
      };
    } finally {
      database.close();
    }
  }, databasePath);
}

test('closes the register with a cut that balances, bill by bill (RF-027)', async ({ userDataDir, launch }) => {
  const register = await launch();
  const page = await signInWindow(register);
  await sellHammerInCash(page);

  await page.keyboard.press('F3');
  await expect(page.getByRole('heading', { name: 'Caja abierta' })).toBeVisible();
  await page.keyboard.press('F7');
  await expect(page.getByRole('heading', { name: 'Corte de caja' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Billetes de $100', exact: true }).fill('1');
  await page.getByRole('textbox', { name: 'Monedas de $10', exact: true }).fill('1');
  await page.getByRole('textbox', { name: 'Monedas de $5', exact: true }).fill('1');
  await page.getByRole('textbox', { name: 'Monedas de $1', exact: true }).fill('1');
  await page.keyboard.press('F2');

  await expect(page.getByRole('status', { name: 'Resultado del corte' })).toHaveText('El corte cuadra');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Estado de la caja')).toHaveText('Caja cerrada');
  expect(await readCuts(register, testSalePaths(userDataDir).databasePath)).toEqual({
    cuts: [{ expected_cash_cents: 11600, counted_cash_cents: 11600, reason: null }],
    openSessions: { total: 0 },
    sale: [{ in_session: 1, has_cashier: 1 }],
  });
});

test('asks for the reason of a difference, and keeps the register open until it has one', async ({ userDataDir, launch }) => {
  const register = await launch();
  const page = await signInWindow(register);
  await sellHammerInCash(page);
  await page.keyboard.press('F3');
  await expect(page.getByRole('heading', { name: 'Caja abierta' })).toBeVisible();
  await page.keyboard.press('F7');
  await page.getByRole('textbox', { name: 'Billetes de $100', exact: true }).fill('1');

  await page.keyboard.press('F2');

  await expect(page.getByRole('table', { name: 'Diferencias del corte' })).toContainText('Faltan $16.00');
  await expect(page.getByRole('alert')).toContainText('Escribe el motivo');
  expect(await readCuts(register, testSalePaths(userDataDir).databasePath)).toMatchObject({ cuts: [], openSessions: { total: 1 } });
  await page.getByRole('textbox', { name: 'Motivo de la diferencia' }).fill('Dejé el cambio en la bolsa');
  await page.keyboard.press('F2');
  await expect(page.getByRole('status', { name: 'Resultado del corte' })).toHaveText('El corte quedó con diferencia');
});

test('does not sell with the register closed, and sells again after opening it with a float (RF-024)', async ({ launch }) => {
  const page = await signInWindow(await launch());
  await page.keyboard.press('F3');
  await expect(page.getByRole('heading', { name: 'Caja abierta' })).toBeVisible();
  await page.keyboard.press('F7');
  await expect(page.getByRole('heading', { name: 'Corte de caja' })).toBeVisible();
  await page.keyboard.press('F2');
  await expect(page.getByRole('status', { name: 'Resultado del corte' })).toHaveText('El corte cuadra');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Abrir la caja' })).toBeHidden();
  await expect(page.getByLabel('Estado de la caja')).toHaveText('Caja cerrada');

  // The keyboard goes back to the lookup box once the cut closes, and F3 is read there, so it waits for that.
  await expect(page.getByRole('combobox', { name: 'Buscar producto' })).toBeFocused();
  await page.keyboard.press('F3');
  await expect(page.getByRole('dialog', { name: 'Abrir la caja' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Fondo de caja' }).fill('500');
  await page.keyboard.press('F2');

  await expect(page.getByLabel('Estado de la caja')).toHaveText('Caja abierta');
  await expect(page.getByRole('combobox', { name: 'Buscar producto' })).toBeFocused();
});

test('puts cash in and takes it out with a reason, and the expected cash follows (RF-025)', async ({ launch }) => {
  const page = await signInWindow(await launch());
  await page.keyboard.press('F3');
  await expect(page.getByRole('heading', { name: 'Caja abierta' })).toBeVisible();
  await page.keyboard.press('F6');
  await expect(page.getByRole('heading', { name: 'Salida de efectivo' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Monto' }).fill('35');
  await page.getByRole('textbox', { name: 'Motivo' }).fill('Pago a proveedor');
  await page.keyboard.press('F2');

  await expect(page.getByRole('heading', { name: 'Caja abierta' })).toBeVisible();
  await page.keyboard.press('F5');
  await expect(page.getByRole('heading', { name: 'Entrada de efectivo' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Monto' }).fill('100');
  await page.getByRole('textbox', { name: 'Motivo' }).fill('Cambio del dueño');
  await page.keyboard.press('F2');

  await expect(page.getByRole('dialog', { name: 'Caja abierta' })).toContainText('$65.00');
  await expect(page.getByLabel('Resumen de la caja')).toContainText('+$100.00 / −$35.00');
});