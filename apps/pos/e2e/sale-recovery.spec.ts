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

/** The sample products the register starts with. Written out here so a change in the list breaks these tests. */
const HAMMER_CODE = '2000000000107';
const SCREWDRIVER_CODE = '2000000000206';
const HAMMER_CENTS = 11600;
const SCREWDRIVER_CENTS = 5800;
const ONE_PIECE = 1000;

interface SavedRows {
  readonly sales: readonly { status: string; total_cents: number }[];
  readonly payments: readonly { method: string; amount_cents: number }[];
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

function question(page: Page): Locator {
  return page.getByRole('dialog', { name: '¿Se cobró esta venta?' });
}

function lookupBox(page: Page): Locator {
  return page.getByRole('combobox', { name: 'Buscar producto' });
}

/** Saves a sale through the bridge, as the payment screen does. The key comes from the screen itself. */
async function savePendingSale(page: Page, code: string, totalCents: number): Promise<void> {
  const status = await page.evaluate(
    async ({ barcode, quantityMilli, expectedTotalCents }) => {
      const product = await window.pos.findProductByCode(barcode);
      const result = await window.pos.savePendingSale({
        idempotencyKey: crypto.randomUUID(),
        lines: [{ productId: product!.id, quantityMilli }],
        expectedTotalCents,
      });
      return result.status;
    },
    { barcode: code, quantityMilli: ONE_PIECE, expectedTotalCents: totalCents },
  );
  expect(status).toBe('saved');
}

/** Opens the register, leaves sales pending, and kills it with no chance to clean up. */
async function crashWithPendingSales(launch: () => Promise<ElectronApplication>, sales: readonly (readonly [string, number])[]): Promise<void> {
  const register = await launch();
  const page = await signInWindow(register);
  await expect(lookupBox(page)).toBeFocused();
  await expect(question(page)).toHaveCount(0);
  for (const [code, cents] of sales) {
    await savePendingSale(page, code, cents);
  }
  await forceClose(await readMainPid(register));
}

async function readSavedRows(register: ElectronApplication, databasePath: string): Promise<SavedRows> {
  return register.evaluate((_electron, path) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const database = new DatabaseSync(path, { readOnly: true });
    try {
      return {
        sales: database.prepare('SELECT status, total_cents FROM sale ORDER BY id').all(),
        payments: database.prepare('SELECT method, amount_cents FROM payment').all(),
        countedSales: (database.prepare('SELECT count(*) AS total FROM counted_sale').get() as { total: number }).total,
      } as unknown as SavedRows;
    } finally {
      database.close();
    }
  }, databasePath);
}

test('shows a pending sale after the register is killed, and confirms it', async ({ userDataDir, launch }) => {
  await crashWithPendingSales(launch, [[HAMMER_CODE, HAMMER_CENTS]]);

  const reopened = await launch();
  const page = await signInWindow(reopened, { hasPendingSales: true });
  await expect(question(page)).toBeVisible();
  await expect(question(page)).toContainText('Martillo uña curva 16 oz');
  await expect(question(page).getByRole('status', { name: 'Total de la venta pendiente' })).toHaveText('$116.00');
  const whilePending = await readSavedRows(reopened, testSalePaths(userDataDir).databasePath);
  expect(whilePending).toEqual({ sales: [{ status: 'pending_payment', total_cents: HAMMER_CENTS }], payments: [], countedSales: 0 });

  await page.keyboard.press('F2');
  await expect(question(page).getByRole('heading', { name: '¿Con qué se pagó?' })).toBeVisible();
  await page.keyboard.type('116');
  await page.keyboard.press('F2');

  await expect(question(page)).toHaveCount(0);
  await expect(lookupBox(page)).toBeFocused();
  const afterConfirming = await readSavedRows(reopened, testSalePaths(userDataDir).databasePath);
  expect(afterConfirming).toEqual({
    sales: [{ status: 'completed', total_cents: HAMMER_CENTS }],
    payments: [{ method: 'cash', amount_cents: HAMMER_CENTS }],
    countedSales: 1,
  });
});

test('keeps the sale cancelled, and does not ask again after another restart', async ({ userDataDir, launch }) => {
  await crashWithPendingSales(launch, [[HAMMER_CODE, HAMMER_CENTS]]);

  const reopened = await launch();
  const page = await signInWindow(reopened, { hasPendingSales: true });
  await expect(question(page)).toBeVisible();
  await page.keyboard.press('F4');
  await expect(question(page)).toHaveCount(0);
  await reopened.close();

  const thirdOpening = await launch();
  const thirdPage = await signInWindow(thirdOpening);
  await expect(lookupBox(thirdPage)).toBeFocused();
  await expect(question(thirdPage)).toHaveCount(0);
  const rows = await readSavedRows(thirdOpening, testSalePaths(userDataDir).databasePath);
  expect(rows).toEqual({ sales: [{ status: 'cancelled', total_cents: HAMMER_CENTS }], payments: [], countedSales: 0 });
});

test('goes through several pending sales, oldest first, using only the keyboard', async ({ launch }) => {
  await crashWithPendingSales(launch, [
    [HAMMER_CODE, HAMMER_CENTS],
    [SCREWDRIVER_CODE, SCREWDRIVER_CENTS],
  ]);

  const page = await signInWindow(await launch(), { hasPendingSales: true });
  await expect(question(page)).toContainText('Martillo uña curva 16 oz');
  await expect(question(page)).toContainText('Quedan 2 ventas por revisar');

  await page.keyboard.press('F2');
  await expect(question(page).getByRole('heading', { name: '¿Con qué se pagó?' })).toBeVisible();
  await page.keyboard.type('116');
  await page.keyboard.press('F2');
  await expect(question(page)).toContainText('Desarmador plano');
  await expect(question(page)).not.toContainText('por revisar');
  await page.keyboard.press('F4');

  await expect(question(page)).toHaveCount(0);
});

test('keeps asking when the cashier presses Esc or a scanner fires', async ({ userDataDir, launch }) => {
  await crashWithPendingSales(launch, [[HAMMER_CODE, HAMMER_CENTS]]);

  const reopened = await launch();
  const page = await signInWindow(reopened, { hasPendingSales: true });
  await expect(question(page)).toBeVisible();

  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.type(HAMMER_CODE);
  await page.keyboard.press('Enter');

  await expect(question(page)).toBeVisible();
  const rows = await readSavedRows(reopened, testSalePaths(userDataDir).databasePath);
  expect(rows.sales).toEqual([{ status: 'pending_payment', total_cents: HAMMER_CENTS }]);
});

test('refuses sale requests that do not follow the rules of the bridge', async ({ launch }) => {
  const page = await signInWindow(await launch());
  await expect(lookupBox(page)).toBeFocused();

  const refusals = await page.evaluate(async () => {
    const pos = window.pos as unknown as Record<string, (value: unknown) => Promise<unknown>>;
    const attempts = [
      pos.savePendingSale!({ idempotencyKey: 'abc', lines: [], expectedTotalCents: 100 }),
      pos.savePendingSale!({ idempotencyKey: crypto.randomUUID(), lines: [], expectedTotalCents: 100 }),
      pos.confirmPendingSale!('not-a-sale'),
      pos.cancelPendingSale!(42),
      pos.confirmPendingSale!('019a5f2e-7c40-7b1a-9d2e-3f4a5b6c7d8e'),
    ];
    return (await Promise.allSettled(attempts)).map(({ status }) => status);
  });

  expect(refusals).toEqual(['rejected', 'rejected', 'rejected', 'rejected', 'rejected']);
});

test('does not save a sale whose total is not the one the catalog gives', async ({ userDataDir, launch }) => {
  const register = await launch();
  const page = await signInWindow(register);
  await expect(lookupBox(page)).toBeFocused();

  const status = await page.evaluate(async (code) => {
    const product = await window.pos.findProductByCode(code);
    const result = await window.pos.savePendingSale({
      idempotencyKey: crypto.randomUUID(),
      lines: [{ productId: product!.id, quantityMilli: 1000 }],
      expectedTotalCents: 1,
    });
    return result.status;
  }, HAMMER_CODE);

  expect(status).toBe('catalog_changed');
  expect((await readSavedRows(register, testSalePaths(userDataDir).databasePath)).sales).toEqual([]);
});
