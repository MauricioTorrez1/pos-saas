import { join } from 'node:path';

import { test as base, expect, type ElectronApplication, type Page } from '@playwright/test';

import { createTemporaryUserData, forceClose, launchRegister, readMainPid, recordStartupOptions, removeTemporaryUserData, signInWindow, TEST_OWNER } from './register-harness.ts';

const HAMMER_CODE = '2000000000107';
const MS_PER_DAY = 86_400_000;
const UNFINISHED_SESSION = '0193a5c0-0000-7000-8000-0000000000e2';

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

/** Yesterday the owner opened the register with $500 and left it without a cut, as «No hacer corte y salir» does. */
async function leftOpenYesterday(register: ElectronApplication, databasePath: string): Promise<void> {
  await register.evaluate(
    (_electron, { path, id, openedAt }) => {
      const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
      const database = new DatabaseSync(path);
      try {
        const { tenant_id: tenantId, id: ownerId } = database.prepare("SELECT tenant_id, id FROM app_user WHERE role = 'owner'").get() as {
          tenant_id: string;
          id: string;
        };
        database
          .prepare('INSERT INTO cash_session (id, tenant_id, opened_by, opened_at, opening_float_cents) VALUES (?, ?, ?, ?, 50000)')
          .run(id, tenantId, ownerId, openedAt);
      } finally {
        database.close();
      }
    },
    { path: databasePath, id: UNFINISHED_SESSION, openedAt: new Date(Date.now() - MS_PER_DAY).toISOString() },
  );
}

async function readYesterday(register: ElectronApplication, databasePath: string): Promise<unknown> {
  return register.evaluate((_electron, path) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const database = new DatabaseSync(path, { readOnly: true });
    try {
      return {
        sessions: database.prepare('SELECT count(*) AS total FROM cash_session').get(),
        sales: database.prepare("SELECT cash_session_id AS sessionId, business_day IS NOT NULL AS onPastDay FROM sale WHERE status = 'completed'").all(),
        cuts: database.prepare('SELECT session_id AS sessionId, expected_cash_cents AS expectedCash FROM cash_cut').all(),
      };
    } finally {
      database.close();
    }
  }, databasePath);
}

/** Chooses yesterday at the sign-in, which says it resumes the cash left without a cut, and enters as the owner. */
async function resumeYesterday(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: '¿Quién cobra?' })).toBeVisible();
  const day = page.getByRole('combobox', { name: 'Día de captura' });
  await expect(day.locator('option').nth(1)).toHaveText(/^Ayer, .* · caja sin corte$/);
  await day.selectOption({ index: 1 });
  await expect(page.getByRole('status')).toContainText(`retomar la caja sin corte`);
  await expect(page.getByRole('status')).toContainText('$500.00');
  await page.getByLabel('PIN', { exact: true }).fill(TEST_OWNER.pin);
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Captura atrasada')).toContainText('Capturando ventas del');
  // The session is resumed with its float, so the register does not ask for a new one.
  await expect(page.getByLabel('Estado de la caja')).toHaveText('Caja abierta');
  await expect(page.getByRole('dialog', { name: 'Abrir la caja' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Buscar producto' })).toBeFocused();
}

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
}

test('resumes the cash yesterday left without a cut, leaves it again, and then cuts it with its own float (E1-61)', async ({ userDataDir, launch }) => {
  const databasePath = join(userDataDir, 'pos.db');
  const register = await launch();
  let page = await signInWindow(register);
  await leftOpenYesterday(register, databasePath);

  await page.getByRole('button', { name: /Salir/ }).click();
  await resumeYesterday(page);
  await sellHammerInCash(page);

  // Leaving without a cut again keeps the same session waiting for its day.
  const closed = new Promise<void>((resolve) => register.once('close', () => resolve()));
  await register.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  const question = page.getByRole('dialog', { name: '¿Cerrar la caja?' });
  await expect(question).toBeVisible();
  // The click closes the window, so Playwright may lose the page before it reports the click.
  await question.getByRole('button', { name: /No hacer corte y salir/ }).click().catch(() => undefined);
  await closed;

  const reopened = await launch();
  page = await reopened.firstWindow();
  await resumeYesterday(page);
  await page.keyboard.press('F3');
  await expect(page.getByRole('dialog')).toContainText('Retomaste la caja sin corte');
  await page.keyboard.press('F7');
  await expect(page.getByRole('heading', { name: /^Corte de caja del / })).toBeVisible();
  await page.getByRole('textbox', { name: 'Billetes de $500', exact: true }).fill('1');
  await page.getByRole('textbox', { name: 'Billetes de $100', exact: true }).fill('1');
  await page.getByRole('textbox', { name: 'Monedas de $10', exact: true }).fill('1');
  await page.getByRole('textbox', { name: 'Monedas de $5', exact: true }).fill('1');
  await page.getByRole('textbox', { name: 'Monedas de $1', exact: true }).fill('1');
  await page.keyboard.press('F2');
  await expect(page.getByRole('status', { name: 'Resultado del corte' })).toHaveText('El corte cuadra');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Estado de la caja')).toHaveText('Caja cerrada');

  // Today's drawer and yesterday's session, and nothing else: the sale and the cut went to the session of yesterday.
  expect(await readYesterday(reopened, databasePath)).toEqual({
    sessions: { total: 2 },
    sales: [{ sessionId: UNFINISHED_SESSION, onPastDay: 1 }],
    cuts: [{ sessionId: UNFINISHED_SESSION, expectedCash: 61_600 }],
  });
});
