import { test as base, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';

import { LOCAL_TENANT_ID } from '../src/main/local-store/local-tenant';
import {
  createTemporaryUserData,
  forceClose,
  insertTestProducts,
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
const CATALOG_SIZE = 5_000;
const SCANS_TO_MEASURE = 200;
const SEARCHES_TO_MEASURE = 200;
/** RNF-02: adding a product must stay under this, at the 95th percentile. */
const MAX_P95_MS = 100;
const HUMAN_KEY_DELAY_MS = 120;

interface SpeedProbe {
  durations: number[];
  startedAt: number | null;
}

declare global {
  interface Window {
    speedProbe: SpeedProbe;
  }
}

const test = base.extend<{
  userDataDir: string;
  launch: () => Promise<ElectronApplication>;
  register: ElectronApplication;
  page: Page;
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
  register: async ({ launch }, use) => {
    await use(await launch());
  },
  page: async ({ register }, use) => {
    const page = await signInWindow(register);
    await expect(lookupBox(page)).toBeFocused();
    await use(page);
  },
});

function lookupBox(page: Page): Locator {
  return page.getByRole('combobox', { name: 'Buscar producto' });
}

function total(page: Page): Locator {
  return page.getByRole('status', { name: 'Total' });
}

function saleRows(page: Page): Locator {
  return page.locator('.sale-lines tbody tr');
}

/** A scanner is a keyboard that types a whole code at once and ends it with Enter. */
async function scan(page: Page, code: string): Promise<void> {
  await page.keyboard.type(code);
  await page.keyboard.press('Enter');
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
}

function describeTimes(values: readonly number[]): string {
  return `p50 ${percentile(values, 0.5).toFixed(1)} ms, p95 ${percentile(values, 0.95).toFixed(1)} ms, max ${Math.max(...values).toFixed(1)} ms`;
}

/**
 * Times from the moment Enter went down until the sale on the screen changed. It runs inside the page, so the time
 * Playwright takes to talk to the app does not count.
 */
async function installSpeedProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe: SpeedProbe = { durations: [], startedAt: null };
    window.speedProbe = probe;
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Enter') {
          probe.startedAt = event.timeStamp;
        }
      },
      true,
    );
    new MutationObserver(() => {
      if (probe.startedAt !== null) {
        probe.durations.push(performance.now() - probe.startedAt);
        probe.startedAt = null;
      }
    }).observe(document.querySelector('output')!, { characterData: true, childList: true, subtree: true });
  });
}

test('adds a scanned product and shows its totals', async ({ page }) => {
  await scan(page, HAMMER_CODE);

  await expect(saleRows(page)).toHaveText(['Martillo uña curva 16 oz1 pza$116.00$116.00']);
  await expect(total(page)).toHaveText('$116.00');
  await expect(page.getByText('IVA 16%')).toBeVisible();
  await expect(page.getByText('$100.00')).toBeVisible();
  await expect(lookupBox(page)).toHaveValue('');
});

test('adds one more unit when the same product is scanned again', async ({ page }) => {
  await scan(page, HAMMER_CODE);
  await expect(total(page)).toHaveText('$116.00');

  await scan(page, HAMMER_CODE);

  await expect(saleRows(page)).toHaveText(['Martillo uña curva 16 oz2 pza$116.00$232.00']);
});

test('finds a product by name without its accents, using only the keyboard', async ({ page }) => {
  await page.keyboard.type('flexometro', { delay: HUMAN_KEY_DELAY_MS });

  await expect(page.getByRole('option', { name: /Flexómetro 5 m/ })).toBeVisible();
  await page.keyboard.press('Enter');

  await expect(saleRows(page)).toHaveText(['Flexómetro 5 m1 pza$95.00$95.00']);
  await expect(page.getByRole('option')).toHaveCount(0);
});

test('moves through the matches with the arrows', async ({ page }) => {
  await page.keyboard.type('cable', { delay: HUMAN_KEY_DELAY_MS });
  await expect(page.getByRole('option')).toHaveCount(2);

  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Cantidad' })).toBeFocused();
  await page.keyboard.type('2');
  await page.keyboard.press('Enter');

  await expect(saleRows(page)).toHaveCount(1);
  await expect(page.getByRole('option')).toHaveCount(0);
});

test('sells cable by the meter: asks how much, shows the amount first, and adds it (RF-012)', async ({ page }) => {
  await page.keyboard.type('cable thw', { delay: HUMAN_KEY_DELAY_MS });
  await expect(page.getByRole('option', { name: /Cable THW/ })).toBeVisible();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: /¿Cuánto Cable THW/ });
  await expect(dialog).toBeVisible();
  await expect(saleRows(page)).toHaveCount(0);
  await page.keyboard.type('3.275');
  await expect(page.getByRole('status', { name: 'Importe de la línea' })).toHaveText('$40.94');
  await page.keyboard.press('Enter');

  await expect(dialog).toHaveCount(0);
  await expect(saleRows(page)).toHaveText([/Cable THW calibre 123\.275 m\$12\.50\$40\.94/]);
  await expect(total(page)).toHaveText('$40.94');
  await expect(lookupBox(page)).toBeFocused();
});

test('does not add 125 m by accident, because it asks for F2 first (E1-08)', async ({ page }) => {
  await page.keyboard.type('cable thw', { delay: HUMAN_KEY_DELAY_MS });
  await expect(page.getByRole('option', { name: /Cable THW/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Cantidad' })).toBeFocused();

  await page.keyboard.type('125');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('es mucho');
  await expect(saleRows(page)).toHaveCount(0);
  await page.keyboard.press('F2');

  await expect(saleRows(page)).toHaveText([/125\.000 m/]);
});

test('cancels the quantity with Esc and adds nothing', async ({ page }) => {
  await page.keyboard.type('cable thw', { delay: HUMAN_KEY_DELAY_MS });
  await expect(page.getByRole('option', { name: /Cable THW/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Cantidad' })).toBeFocused();

  await page.keyboard.press('Escape');

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(total(page)).toHaveText('$0.00');
  await expect(lookupBox(page)).toBeFocused();
});

test('runs a whole sale from the keyboard', async ({ page }) => {
  await scan(page, HAMMER_CODE);
  await expect(saleRows(page)).toHaveCount(1);
  await scan(page, SCREWDRIVER_CODE);
  await expect(total(page)).toHaveText('$174.00');

  await page.keyboard.press('+');
  await expect(total(page)).toHaveText('$232.00');
  await page.keyboard.press('ArrowUp');
  await expect(saleRows(page).first()).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('Delete');

  await expect(saleRows(page)).toHaveText([/Desarmador plano/]);
  await expect(total(page)).toHaveText('$116.00');
});

test('says so when a code does not exist, and adds nothing', async ({ page }) => {
  await scan(page, '7509999999999');

  await expect(page.getByRole('alert')).toContainText('«7509999999999»');
  await expect(total(page)).toHaveText('$0.00');
  await expect(lookupBox(page)).toHaveValue('');
});

test('keeps the lookup box ready for the next scan after a click elsewhere', async ({ page }) => {
  await page.locator('.sale-summary').click();

  await expect(lookupBox(page)).toBeFocused();
  await scan(page, HAMMER_CODE);
  await expect(total(page)).toHaveText('$116.00');
});

test('refuses requests that do not follow the rules of the bridge', async ({ page }) => {
  const refusals = await page.evaluate(async () => {
    const pos = window.pos as unknown as Record<string, (value: unknown) => Promise<unknown>>;
    const attempts = [
      pos.searchProducts!(5),
      pos.findProductByCode!('9'.repeat(101)),
      pos.saveAppearance!({ businessName: '', accent: 'pink', textSize: 'normal', theme: 'light' }),
    ];
    return (await Promise.allSettled(attempts)).map(({ status }) => status);
  });

  expect(refusals).toEqual(['rejected', 'rejected', 'rejected']);
});

test('keeps the appearance the owner chose after restarting', async ({ launch, register, page }) => {
  await page.keyboard.press('F9');
  const dialog = page.getByRole('dialog', { name: 'Apariencia de la caja' });
  await dialog.getByRole('textbox', { name: 'Nombre del negocio' }).fill('Tlapalería Torres');
  await dialog.locator('.choice', { hasText: 'Azul' }).click();
  await dialog.locator('.choice', { hasText: 'Oscuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await dialog.getByRole('button', { name: 'Guardar apariencia' }).click();

  await expect(page.getByRole('heading', { name: 'Tlapalería Torres' })).toBeVisible();
  await expect(lookupBox(page)).toBeFocused();
  await register.close();

  const reopened = await signInWindow(await launch());
  await expect(reopened.getByRole('heading', { name: 'Tlapalería Torres' })).toBeVisible();
  await expect(reopened.locator('html')).toHaveAttribute('data-accent', 'blue');
  await expect(reopened.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('undoes a preview when the owner presses Esc', async ({ page }) => {
  await page.keyboard.press('F9');
  const dialog = page.getByRole('dialog', { name: 'Apariencia de la caja' });
  await dialog.locator('.choice', { hasText: 'Verde' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'green');

  await page.keyboard.press('Escape');

  await expect(dialog).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'yellow');
  await expect(lookupBox(page)).toBeFocused();
});

test(`adds a product in under ${MAX_P95_MS} ms with ${CATALOG_SIZE} products`, async ({ userDataDir, register, page }) => {
  test.setTimeout(180_000);
  const codes = await insertTestProducts(register, testSalePaths(userDataDir).databasePath, LOCAL_TENANT_ID, CATALOG_SIZE);
  await installSpeedProbe(page);

  for (let scanNumber = 1; scanNumber <= SCANS_TO_MEASURE; scanNumber += 1) {
    await scan(page, codes[(scanNumber * 23) % codes.length]!);
    await page.waitForFunction((expected) => window.speedProbe.durations.length === expected, scanNumber, { polling: 5 });
  }

  const scanTimes = await page.evaluate(() => window.speedProbe.durations);
  const searchTimes = await page.evaluate(async (searches) => {
    const words = ['to', 'tornillo', 'tu', 'tuerca galv', 'medida 12', 'cl', 'tubo cobre 4'];
    const durations: number[] = [];
    for (let search = 0; search < searches; search += 1) {
      const startedAt = performance.now();
      await window.pos.searchProducts(words[search % words.length]!);
      durations.push(performance.now() - startedAt);
    }
    return durations;
  }, SEARCHES_TO_MEASURE);

  console.log(`Add a scanned product (${scanTimes.length} scans, ${CATALOG_SIZE} products): ${describeTimes(scanTimes)}`);
  console.log(`Search by name through the bridge (${searchTimes.length} searches): ${describeTimes(searchTimes)}`);
  expect(scanTimes).toHaveLength(SCANS_TO_MEASURE);
  expect(percentile(scanTimes, 0.95)).toBeLessThan(MAX_P95_MS);
  expect(percentile(searchTimes, 0.95)).toBeLessThan(MAX_P95_MS);
});
