import { join } from 'node:path';

import { test as base, expect, type ElectronApplication } from '@playwright/test';

import { createTemporaryUserData, forceClose, launchRegister, readMainPid, recordStartupOptions, removeTemporaryUserData, signInWindow, TEST_OWNER } from './register-harness.ts';

const HAMMER_CODE = '2000000000107';
const MS_PER_DAY = 86_400_000;

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

/** The register has been in use for a few days: its first cash session was opened, and cut, three days ago. */
async function startedDaysAgo(register: ElectronApplication, databasePath: string, days: number): Promise<void> {
  await register.evaluate(
    (_electron, { path, openedAt }) => {
      const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
      const database = new DatabaseSync(path);
      try {
        const { tenant_id: tenantId, id: ownerId } = database.prepare("SELECT tenant_id, id FROM app_user WHERE role = 'owner'").get() as {
          tenant_id: string;
          id: string;
        };
        database
          .prepare('INSERT INTO cash_session (id, tenant_id, opened_by, opened_at, opening_float_cents, closed_by, closed_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
          .run('0193a5c0-0000-7000-8000-0000000000e1', tenantId, ownerId, openedAt, ownerId, openedAt);
      } finally {
        database.close();
      }
    },
    { path: databasePath, openedAt: new Date(Date.now() - days * MS_PER_DAY).toISOString() },
  );
}

async function readBackdatedSale(register: ElectronApplication, databasePath: string): Promise<unknown> {
  return register.evaluate((_electron, path) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const database = new DatabaseSync(path, { readOnly: true });
    try {
      return database
        .prepare("SELECT s.business_day AS saleDay, c.business_day AS sessionDay FROM sale s JOIN cash_session c ON c.id = s.cash_session_id WHERE s.status = 'completed'")
        .all();
    } finally {
      database.close();
    }
  }, databasePath);
}

test('signs in to yesterday with the owner PIN, and a sale rung up lands on the summary of yesterday (E1-60)', async ({ userDataDir, launch }) => {
  const register = await launch();
  let page = await signInWindow(register);
  const databasePath = join(userDataDir, 'pos.db');
  await startedDaysAgo(register, databasePath, 3);

  await page.getByRole('button', { name: /Salir/ }).click();
  await expect(page.getByRole('heading', { name: '¿Quién cobra?' })).toBeVisible();
  const day = page.getByRole('combobox', { name: 'Día de captura' });
  await expect(day.locator('option').first()).toHaveText(/^Hoy, /);
  await day.selectOption({ index: 1 });
  const yesterday = await day.inputValue();
  await expect(page.getByRole('status')).toContainText('ventas atrasadas');
  await page.getByLabel('PIN', { exact: true }).fill(TEST_OWNER.pin);
  await page.keyboard.press('Enter');

  // A backdated capture opens its own cash, apart from the drawer of today that is still open.
  page = register.windows()[0]!;
  await expect(page.getByLabel('Captura atrasada')).toContainText('Capturando ventas del');
  await expect(page.getByRole('heading', { name: 'Abrir la caja' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Fondo de caja' }).fill('0');
  await page.keyboard.press('F2');
  await expect(page.getByLabel('Estado de la caja')).toHaveText('Caja abierta');
  await expect(page.getByRole('combobox', { name: 'Buscar producto' })).toBeFocused();

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
  expect(await readBackdatedSale(register, databasePath)).toEqual([{ saleDay: yesterday, sessionDay: yesterday }]);

  await page.keyboard.press('F11');
  const dashboard = page.locator('dialog[aria-labelledby="dashboard-title"]');
  const indicators = dashboard.getByLabel('Indicadores del periodo');
  await expect(indicators).toContainText('Tickets0');
  await dashboard.getByRole('button', { name: 'Periodo anterior' }).click();
  await expect(indicators).toContainText('Ventas totales (con IVA)$116.00');
  await expect(indicators).toContainText('Tickets1');
});
