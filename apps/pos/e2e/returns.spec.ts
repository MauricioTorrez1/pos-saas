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

/** Sells two hammers: $100 in cash and $132 by transfer, which is a mixed payment of $232. */
async function sellTwoHammersMixed(page: Page): Promise<void> {
  await page.keyboard.type(HAMMER_CODE);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status', { name: 'Total', exact: true })).toHaveText('$116.00');
  await page.keyboard.press('+');
  await expect(page.getByRole('status', { name: 'Total', exact: true })).toHaveText('$232.00');
  await page.keyboard.press('F12');
  await expect(page.getByRole('textbox', { name: 'Efectivo recibido' })).toBeFocused();
  await page.keyboard.type('192');
  await page.getByRole('textbox', { name: 'Transferencia', exact: true }).fill('40');
  await page.getByRole('textbox', { name: 'Referencia de la transferencia' }).fill('SPEI-778812');
  await expect(page.getByRole('status', { name: 'Estado del cobro' })).toHaveText('Pago exacto');
  await page.keyboard.press('F2');
  await expect(page.getByRole('status', { name: 'Cambio a entregar' })).toHaveText('Sin cambio');
  await expect(async () => {
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 1000 });
  }).toPass();
  await expect(page.getByRole('combobox', { name: 'Buscar producto' })).toBeFocused();
}

async function readReturns(register: ElectronApplication, databasePath: string): Promise<unknown> {
  return register.evaluate((_electron, path) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const database = new DatabaseSync(path, { readOnly: true });
    try {
      return {
        sale: database.prepare('SELECT status, total_cents FROM sale').all(),
        returns: database.prepare('SELECT total_cents FROM sale_return').all(),
        refunds: database.prepare('SELECT method, amount_cents, reference FROM refund_payment ORDER BY method').all(),
      };
    } finally {
      database.close();
    }
  }, databasePath);
}

test('takes back one hammer of a mixed payment, by the same means, and the sale stays as it was (RF-019)', async ({ userDataDir, launch }) => {
  const register = await launch();
  const page = await signInWindow(register);
  await sellTwoHammersMixed(page);

  await page.keyboard.press('F4');
  await expect(page.getByRole('heading', { name: 'Devolución' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Folio del ticket' }).fill('T1-000001');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Devolución del ticket T1-000001' })).toBeVisible();
  await page.getByLabel('Devuelve de Martillo uña curva 16 oz').fill('1');
  await expect(page.getByRole('status', { name: 'Lo que se regresa' })).toContainText('$116.00');
  await page.getByRole('textbox', { name: 'Motivo de la devolución' }).fill('No era el modelo');
  await page.keyboard.press('F2');

  await expect(page.getByRole('status', { name: 'Lo que se entrega' })).toContainText('en efectivo');
  expect(await readReturns(register, testSalePaths(userDataDir).databasePath)).toMatchObject({
    sale: [{ status: 'completed', total_cents: 23200 }],
    returns: [{ total_cents: 11600 }],
  });
});

test('says so when the folio does not exist, and when it is not a folio', async ({ launch }) => {
  const page = await signInWindow(await launch());
  await page.keyboard.press('F4');
  await expect(page.getByRole('heading', { name: 'Devolución' })).toBeVisible();

  await page.getByRole('textbox', { name: 'Folio del ticket' }).fill('T1-000999');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('No hay ninguna venta cobrada');
  await page.getByRole('textbox', { name: 'Folio del ticket' }).fill('hola');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('no parece un folio');
});

test('the refund leaves the drawer: the cut expects less cash after a cash return', async ({ launch }) => {
  const page = await signInWindow(await launch());
  await page.keyboard.type(HAMMER_CODE);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status', { name: 'Total', exact: true })).toHaveText('$116.00');
  await page.keyboard.press('F12');
  await expect(page.getByRole('textbox', { name: 'Efectivo recibido' })).toBeFocused();
  await page.keyboard.type('116');
  await page.keyboard.press('F2');
  await expect(page.getByRole('status', { name: 'Cambio a entregar' })).toHaveText('Sin cambio');
  await expect(async () => {
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 1000 });
  }).toPass();
  await page.keyboard.press('F4');
  await page.getByRole('textbox', { name: 'Folio del ticket' }).fill('1');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Devolución del ticket T1-000001' })).toBeVisible();
  await page.keyboard.press('F5');
  await page.getByRole('textbox', { name: 'Motivo de la devolución' }).fill('Ya no lo quiere');
  await page.keyboard.press('F2');
  await expect(page.getByRole('status', { name: 'Lo que se entrega' })).toHaveText('Entrega $116.00 en efectivo');
  // The keys of the finished return start working a moment after it shows, so Enter is retried until the dialog closes.
  await expect(async () => {
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 1000 });
  }).toPass();

  await page.keyboard.press('F3');
  await expect(page.getByRole('heading', { name: 'Caja abierta' })).toBeVisible();

  await expect(page.getByLabel('Resumen de la caja')).toContainText('Efectivo esperado en el cajón');
  await expect(page.getByLabel('Resumen de la caja')).toContainText('$0.00');
});