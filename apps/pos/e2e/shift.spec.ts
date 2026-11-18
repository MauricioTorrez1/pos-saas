import { test as base, expect, type ElectronApplication, type Page } from '@playwright/test';

import {
  createTemporaryUserData,
  forceClose,
  launchRegister,
  readMainPid,
  recordStartupOptions,
  removeTemporaryUserData,
  testSalePaths,
  TEST_OWNER,
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

/** Signs in as the owner, creating it on the first start, and stops at whatever follows the sign-in. */
async function signIn(register: ElectronApplication): Promise<Page> {
  const page = await register.firstWindow();
  const welcome = page.getByRole('heading', { name: 'Bienvenido' });
  await expect(welcome.or(page.getByRole('heading', { name: '¿Quién cobra?' }))).toBeVisible();
  if (await welcome.isVisible()) {
    await page.getByRole('textbox', { name: 'Tu nombre' }).fill(TEST_OWNER.name);
    await page.getByRole('textbox', { name: 'Elige un PIN' }).fill(TEST_OWNER.pin);
    await page.getByRole('textbox', { name: 'Repite el PIN' }).fill(TEST_OWNER.pin);
  } else {
    await page.getByLabel('PIN', { exact: true }).fill(TEST_OWNER.pin);
  }
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Buscar producto' })).toBeVisible();
  return page;
}

async function readAudit(register: ElectronApplication, databasePath: string): Promise<unknown[]> {
  return register.evaluate((_electron, path) => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const database = new DatabaseSync(path, { readOnly: true });
    try {
      return database.prepare("SELECT action, detail FROM audit_log WHERE entity = 'cash_session' ORDER BY occurred_at").all();
    } finally {
      database.close();
    }
  }, databasePath);
}

test('asks for the opening float at sign-in and sells with it (E1-54)', async ({ launch }) => {
  const page = await signIn(await launch());

  const opening = page.getByRole('dialog', { name: 'Abrir la caja' });
  await expect(opening).toContainText('fondo de caja inicial');
  await page.getByRole('textbox', { name: 'Fondo de caja' }).fill('500');
  await page.keyboard.press('F2');
  await expect(page.getByLabel('Estado de la caja')).toHaveText('Caja abierta');
  await expect(page.getByLabel('Turno de caja')).toContainText(`Abrió ${TEST_OWNER.name}`);
  await expect(page.getByRole('combobox', { name: 'Buscar producto' })).toBeFocused();

  await page.keyboard.type(HAMMER_CODE);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status', { name: 'Total', exact: true })).toHaveText('$116.00');
  await page.keyboard.press('F12');
  await expect(page.getByRole('textbox', { name: 'Efectivo recibido' })).toBeFocused();
  await page.keyboard.type('116');
  await page.keyboard.press('F2');
  await expect(page.getByRole('status', { name: 'Cambio a entregar' })).toHaveText('Sin cambio');
});

test('lets the owner only administer, and refuses to charge until the cash is opened', async ({ launch }) => {
  const page = await signIn(await launch());
  await page.getByRole('button', { name: /Solo administrar/ }).click();

  await expect(page.getByRole('status', { name: 'Caja sin abrir' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Buscar producto' })).toBeFocused();
  await page.keyboard.type(HAMMER_CODE);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status', { name: 'Total', exact: true })).toHaveText('$116.00');
  await page.keyboard.press('F12');
  await expect(page.getByRole('alert')).toContainText('No se puede cobrar');
  await expect(page.getByRole('dialog', { name: 'Abrir la caja' })).toBeVisible();
});

test('asks before closing with the cash open, leaves it open in the audit log, and does not ask for the float again', async ({ launch, userDataDir }) => {
  const register = await launch();
  const page = await signIn(register);
  await page.getByRole('textbox', { name: 'Fondo de caja' }).fill('200');
  await page.keyboard.press('F2');
  await expect(page.getByLabel('Estado de la caja')).toHaveText('Caja abierta');

  // The same `close` event as the X and Alt+F4.
  await register.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  const question = page.getByRole('dialog', { name: '¿Cerrar la caja?' });
  await expect(question).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(question).toBeHidden();

  const closed = new Promise<void>((resolve) => register.once('close', () => resolve()));
  await register.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  // The click closes the window, so Playwright may lose the page before it reports the click.
  await question.getByRole('button', { name: /No hacer corte y salir/ }).click().catch(() => undefined);
  await closed;

  const reopened = await launch();
  const again = await signIn(reopened);
  await expect(again.getByLabel('Estado de la caja')).toHaveText('Caja abierta');
  await expect(again.getByRole('dialog', { name: 'Abrir la caja' })).toHaveCount(0);
  expect(await readAudit(reopened, testSalePaths(userDataDir).databasePath)).toEqual([
    { action: 'cash_session.opened', detail: `${TEST_OWNER.name} abrió la caja con un fondo de 20000 centavos` },
    { action: 'cash_session.exit_without_cut', detail: 'Cerró la caja sin hacer corte; la sesión quedó abierta' },
  ]);
});

test('makes the cut from the question and then closes', async ({ launch }) => {
  const register = await launch();
  const page = await signIn(register);
  await page.getByRole('textbox', { name: 'Fondo de caja' }).fill('0');
  await page.keyboard.press('F2');
  await expect(page.getByLabel('Estado de la caja')).toHaveText('Caja abierta');

  const closed = new Promise<void>((resolve) => register.once('close', () => resolve()));
  await register.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await page.getByRole('button', { name: /Hacer corte de caja/ }).click();
  await expect(page.getByRole('heading', { name: 'Corte de caja' })).toBeVisible();
  await page.keyboard.press('F2');
  await expect(page.getByRole('status', { name: 'Resultado del corte' })).toHaveText('El corte cuadra');
  await page.keyboard.press('Enter').catch(() => undefined);
  await closed;
});
