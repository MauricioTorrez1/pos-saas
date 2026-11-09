import { test as base, expect, type ElectronApplication } from '@playwright/test';

import {
  createTemporaryUserData,
  forceClose,
  launchRegister,
  readMainPid,
  recordStartupOptions,
  removeTemporaryUserData,
  signInWindow,
  TEST_OWNER,
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

test('asks for an owner on the first start, and for the PIN on the next ones (RF-009)', async ({ launch }) => {
  const first = await launch();
  const page = await signInWindow(first);
  await expect(page.getByLabel('Persona en la caja')).toHaveText(TEST_OWNER.name);
  await first.close();

  const second = await (await launch()).firstWindow();

  await expect(second.getByRole('heading', { name: '¿Quién cobra?' })).toBeVisible();
  await expect(second.getByRole('radio', { name: new RegExp(TEST_OWNER.name) })).toBeChecked();
  await expect(second.getByLabel('PIN', { exact: true })).toBeFocused();
});

test('refuses sales and the catalog until somebody is signed in', async ({ launch }) => {
  const page = await (await launch()).firstWindow();
  await expect(page.getByRole('heading', { name: 'Bienvenido' })).toBeVisible();

  const refusals = await page.evaluate(async () => {
    const attempts = [
      window.pos.findProductByCode('2000000000107'),
      window.pos.searchProducts('martillo'),
      window.pos.listPendingSales(),
      window.pos.reprintLastTicket(),
    ];
    return (await Promise.allSettled(attempts)).map(({ status }) => status);
  });

  expect(refusals).toEqual(['rejected', 'rejected', 'rejected', 'rejected']);
});

test('says how many tries are left, and locks the person after five wrong PINs, even after a restart', async ({ launch }) => {
  const first = await launch();
  await signInWindow(first);
  await first.close();
  const second = await launch();
  const page = await second.firstWindow();
  const pin = page.getByLabel('PIN', { exact: true });

  await pin.fill('0000');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Te quedan 4 intentos');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await pin.fill('0000');
    await page.keyboard.press('Enter');
  }
  await expect(page.getByRole('alert')).toContainText('Se bloqueó');
  await pin.fill(TEST_OWNER.pin);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Demasiados intentos');

  await second.close();
  const reopened = await launch();
  const reopenedPage = await reopened.firstWindow();
  await reopenedPage.getByLabel('PIN', { exact: true }).fill(TEST_OWNER.pin);
  await reopenedPage.keyboard.press('Enter');
  await expect(reopenedPage.getByRole('alert')).toContainText('Demasiados intentos');
});

test('signs out with F6 and asks for the PIN again', async ({ launch }) => {
  const page = await signInWindow(await launch());

  await page.keyboard.press('F6');

  await expect(page.getByRole('heading', { name: '¿Quién cobra?' })).toBeVisible();
  await page.getByLabel('PIN', { exact: true }).fill(TEST_OWNER.pin);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Buscar producto' })).toBeFocused();
});