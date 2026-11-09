import { test as base, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';

import {
  createTemporaryUserData,
  forceClose,
  launchRegister,
  readMainPid,
  recordStartupOptions,
  removeTemporaryUserData,
  testSalePaths,
} from './register-harness.ts';

/** The sample products the register starts with. Written out here so a change in the list breaks these tests. */
const HAMMER_CODE = '2000000000107';
const HAMMER_CENTS = 11600;
/** Built from parts, so the secret scan does not take a test value for a real card number. */
const SAMPLE_CARD_NUMBER = ['4111', '1111', '1111', '1111'];

interface SavedRows {
  readonly sales: readonly { status: string; total_cents: number }[];
  readonly payments: readonly { method: string; amount_cents: number; reference: string | null }[];
  readonly countedSales: number;
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

function lookupBox(page: Page): Locator {
  return page.getByRole('combobox', { name: 'Buscar producto' });
}

function payment(page: Page): Locator {
  return page.getByRole('dialog', { name: /^(Cobrar|Venta cobrada)$/ });
}

function status(page: Page): Locator {
  return page.getByRole('status', { name: 'Estado del cobro' });
}

function total(page: Page): Locator {
  return page.getByRole('status', { name: 'Total', exact: true });
}

/** The keys of the finished sale start working a moment after it shows, so Enter is retried until the dialog closes. */
async function closeDone(page: Page): Promise<void> {
  await expect(async () => {
    await page.keyboard.press('Enter');
    await expect(payment(page)).toHaveCount(0, { timeout: 1000 });
  }).toPass();
}

/** A scanner is a keyboard that types a whole code at once and ends it with Enter. */
async function scan(page: Page, code: string): Promise<void> {
  await page.keyboard.type(code);
  await page.keyboard.press('Enter');
}

/** Opens the register, rings up a hammer with the scanner, and opens the payment screen with F12. */
async function startCheckout(launch: () => Promise<ElectronApplication>): Promise<{ register: ElectronApplication; page: Page }> {
  const register = await launch();
  const page = await register.firstWindow();
  await expect(lookupBox(page)).toBeFocused();
  await scan(page, HAMMER_CODE);
  await expect(total(page)).toHaveText('$116.00');
  await page.keyboard.press('F12');
  await expect(payment(page)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Efectivo recibido' })).toBeFocused();
  return { register, page };
}

async function readSavedRows(register: ElectronApplication, databasePath: string): Promise<SavedRows> {
  return register.evaluate((_electron, path) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const database = new DatabaseSync(path, { readOnly: true });
    try {
      return {
        sales: database.prepare('SELECT status, total_cents FROM sale ORDER BY id').all(),
        payments: database.prepare('SELECT method, amount_cents, reference FROM payment ORDER BY method').all(),
        countedSales: (database.prepare('SELECT count(*) AS total FROM counted_sale').get() as { total: number }).total,
      } as unknown as SavedRows;
    } finally {
      database.close();
    }
  }, databasePath);
}

test('charges a sale in cash and shows the change, using only the keyboard (RF-014)', async ({ userDataDir, launch }) => {
  const { register, page } = await startCheckout(launch);
  await expect(status(page)).toHaveText('Faltan $116.00');

  await page.keyboard.type('150');
  await expect(status(page)).toHaveText('Cambio $34.00');
  await page.keyboard.press('F2');

  await expect(page.getByRole('status', { name: 'Cambio a entregar' })).toHaveText('Entrega $34.00 de cambio');
  await expect(payment(page)).toContainText('Folio T1-000001');
  await closeDone(page);
  await expect(total(page)).toHaveText('$0.00');
  await expect(lookupBox(page)).toBeFocused();
  expect(await readSavedRows(register, testSalePaths(userDataDir).databasePath)).toEqual({
    sales: [{ status: 'completed', total_cents: HAMMER_CENTS }],
    payments: [{ method: 'cash', amount_cents: HAMMER_CENTS, reference: null }],
    countedSales: 1,
  });
});

test('records cash and a transfer with its reference as two parts of one sale (RF-015)', async ({ userDataDir, launch }) => {
  const { register, page } = await startCheckout(launch);

  await page.keyboard.type('76');
  await page.keyboard.press('Enter');
  await page.keyboard.type('40');
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('Escribe la referencia de la transferencia.');
  await page.keyboard.type('SPEI-778812');
  await expect(status(page)).toHaveText('Pago exacto');
  await page.keyboard.press('F2');

  await expect(page.getByRole('status', { name: 'Cambio a entregar' })).toHaveText('Sin cambio');
  expect(await readSavedRows(register, testSalePaths(userDataDir).databasePath)).toEqual({
    sales: [{ status: 'completed', total_cents: HAMMER_CENTS }],
    payments: [
      { method: 'cash', amount_cents: 7600, reference: null },
      { method: 'transfer', amount_cents: 4000, reference: 'SPEI-778812' },
    ],
    countedSales: 1,
  });
});

test('takes the whole sale by transfer with F6', async ({ userDataDir, launch }) => {
  const { register, page } = await startCheckout(launch);

  await page.keyboard.press('F6');
  await expect(page.getByRole('textbox', { name: 'Transferencia', exact: true })).toHaveValue('116');
  await page.keyboard.type('SPEI-1');
  await page.keyboard.press('F2');

  await expect(page.getByRole('status', { name: 'Cambio a entregar' })).toHaveText('Sin cambio');
  const { payments } = await readSavedRows(register, testSalePaths(userDataDir).databasePath);
  expect(payments).toEqual([{ method: 'transfer', amount_cents: HAMMER_CENTS, reference: 'SPEI-1' }]);
});

test('records a card typed on the standalone terminal with its folio, and refuses a card number (RF-016)', async ({ userDataDir, launch }) => {
  const { register, page } = await startCheckout(launch);

  await page.keyboard.press('F7');
  await expect(page.getByRole('textbox', { name: 'Tarjeta', exact: true })).toHaveValue('116');
  await page.keyboard.type(SAMPLE_CARD_NUMBER.join(' '));
  await expect(status(page)).toContainText('número de tarjeta');
  await page.keyboard.press('F2');
  await expect(payment(page)).toContainText('Cobrar');
  await page.getByRole('textbox', { name: 'Folio de la terminal' }).fill('A48291');
  await page.keyboard.press('F2');

  await expect(page.getByRole('status', { name: 'Cambio a entregar' })).toHaveText('Sin cambio');
  expect(await readSavedRows(register, testSalePaths(userDataDir).databasePath)).toEqual({
    sales: [{ status: 'completed', total_cents: HAMMER_CENTS }],
    payments: [{ method: 'card_manual', amount_cents: HAMMER_CENTS, reference: 'A48291' }],
    countedSales: 1,
  });
});

test('does not complete a sale that is short, and a scanner Enter does not complete it either', async ({ userDataDir, launch }) => {
  const { register, page } = await startCheckout(launch);

  await page.keyboard.type('100');
  await page.keyboard.press('F2');
  await page.keyboard.press('Enter');

  await expect(status(page)).toHaveText('Faltan $16.00');
  await expect(payment(page)).toBeVisible();
  expect(await readSavedRows(register, testSalePaths(userDataDir).databasePath)).toEqual({
    sales: [{ status: 'pending_payment', total_cents: HAMMER_CENTS }],
    payments: [],
    countedSales: 0,
  });
});

test('cancels the saved sale with Esc and keeps the products on the screen', async ({ userDataDir, launch }) => {
  const { register, page } = await startCheckout(launch);

  await page.keyboard.press('Escape');

  await expect(payment(page)).toHaveCount(0);
  await expect(total(page)).toHaveText('$116.00');
  await expect(lookupBox(page)).toBeFocused();
  expect(await readSavedRows(register, testSalePaths(userDataDir).databasePath)).toEqual({
    sales: [{ status: 'cancelled', total_cents: HAMMER_CENTS }],
    payments: [],
    countedSales: 0,
  });
});

test('asks for the payment method of a sale left pending when the register is killed in the payment screen', async ({
  userDataDir,
  launch,
}) => {
  const first = await startCheckout(launch);
  await forceClose(await readMainPid(first.register));

  const reopened = await launch();
  const page = await reopened.firstWindow();
  const question = page.getByRole('dialog', { name: '¿Se cobró esta venta?' });
  await expect(question).toBeVisible();
  await page.keyboard.press('F2');
  await expect(question.getByRole('heading', { name: '¿Con qué se pagó?' })).toBeVisible();
  await page.keyboard.type('76');
  await page.keyboard.press('Enter');
  await page.keyboard.type('40');
  await page.keyboard.press('Enter');
  await page.keyboard.type('SPEI-778812');
  await page.keyboard.press('F2');

  await expect(question).toHaveCount(0);
  expect(await readSavedRows(reopened, testSalePaths(userDataDir).databasePath)).toEqual({
    sales: [{ status: 'completed', total_cents: HAMMER_CENTS }],
    payments: [
      { method: 'cash', amount_cents: 7600, reference: null },
      { method: 'transfer', amount_cents: 4000, reference: 'SPEI-778812' },
    ],
    countedSales: 1,
  });
});

test('numbers the sales and prints the last ticket again with F8 (RF-018)', async ({ launch }) => {
  const register = await launch();
  const page = await register.firstWindow();
  await expect(lookupBox(page)).toBeFocused();
  await page.keyboard.press('F8');
  await expect(page.getByText('Todavía no hay ventas cobradas para reimprimir.')).toBeVisible();

  for (const folio of ['T1-000001', 'T1-000002']) {
    await scan(page, HAMMER_CODE);
    await expect(total(page)).toHaveText('$116.00');
    await page.keyboard.press('F12');
    await expect(page.getByRole('textbox', { name: 'Efectivo recibido' })).toBeFocused();
    await page.keyboard.type('116');
    await page.keyboard.press('F2');
    await expect(payment(page)).toContainText(`Folio ${folio}`);
    if (folio === 'T1-000002') {
      // The keys start working a moment after the dialog shows, so the press is retried until the reprint answers.
      await expect(async () => {
        await page.keyboard.press('F8');
        await expect(payment(page)).toContainText('Ticket T1-000002 reimpreso.', { timeout: 1000 });
      }).toPass();
    }
    await closeDone(page);
    await expect(lookupBox(page)).toBeFocused();
  }
  await page.keyboard.press('F8');

  await expect(page.getByText('Ticket T1-000002 reimpreso.')).toBeVisible();
});

test('refuses payment requests that do not follow the rules of the bridge', async ({ launch }) => {
  const page = await (await launch()).firstWindow();
  await expect(lookupBox(page)).toBeFocused();

  const refusals = await page.evaluate(async () => {
    const pos = window.pos as unknown as Record<string, (value: unknown) => Promise<unknown>>;
    const saleId = '019a5f2e-7c40-7b1a-9d2e-3f4a5b6c7d8e';
    const attempts = [
      pos.checkoutSale!('x'),
      pos.checkoutSale!({ saleId: 'x', cashReceivedCents: 100, transfers: [] }),
      pos.checkoutSale!({ saleId, cashReceivedCents: -1, transfers: [] }),
      pos.checkoutSale!({ saleId, cashReceivedCents: 100, transfers: [{ amountCents: 0, reference: 'a' }] }),
      pos.checkoutSale!({ saleId, cashReceivedCents: 100, transfers: [] }),
    ];
    return (await Promise.allSettled(attempts)).map(({ status }) => status);
  });

  expect(refusals).toEqual(['rejected', 'rejected', 'rejected', 'rejected', 'rejected']);
});
