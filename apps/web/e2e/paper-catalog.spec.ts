import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const FAKE_URL = 'http://127.0.0.1:4017';
// A 1×1 PNG: the fake reader ignores what the photo shows.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function control(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.request.post(`${FAKE_URL}/__control`, { data: patch });
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('link', { name: 'Iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.beforeEach(async ({ page }) => {
  await control(page, { reset: true });
});

test('the owner reviews a photographed page and downloads only the approved rows', async ({ page }) => {
  await signIn(page);
  await page.goto('/catalog/paper');
  await page.getByRole('textbox', { name: 'Proveedor' }).fill('Plásticos del Norte');
  await page.getByLabel('Fotos del catálogo').setInputFiles({ name: 'hoja-1.png', mimeType: 'image/png', buffer: PNG });

  const rows = page.getByTestId('paper-row');
  await expect(rows).toHaveCount(2);
  await expect(page.getByAltText('Foto hoja-1.png')).toBeVisible();
  await expect(rows.nth(1)).toHaveClass(/paper-row--doubtful/);
  await expect(rows.nth(1).getByText('No se lee el precio')).toBeVisible();
  await expect(rows.nth(0)).not.toHaveClass(/paper-row--doubtful/);

  // The doubtful row cannot be approved until the owner types its cost.
  await rows.nth(1).getByRole('button', { name: 'Aprobar' }).click();
  await expect(rows.nth(1).getByText(/Escribe el costo sin IVA/)).toBeVisible();
  await rows.nth(1).getByLabel('Costo sin IVA').fill('3.75');
  await rows.nth(1).getByRole('button', { name: 'Aprobar' }).click();
  await expect(page.getByTestId('approved-summary')).toHaveText(/^1 línea aprobada/);

  // The first row is edited and deleted: nothing of it reaches the file.
  await rows.nth(0).getByLabel('Descripción').fill('Tubo editado');
  await rows.nth(0).getByRole('button', { name: 'Eliminar' }).click();
  await expect(rows).toHaveCount(1);

  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar CSV para la caja' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('lista-plasticos-del-norte.csv');
  const text = await readFile((await download.path()) ?? '', 'utf-8');
  expect(text).toBe(
    'supplier_code,description,purchase_unit,pieces_per_unit,cost\r\nCD-9,Codo PVC 1/2 in,bolsa,25,3.75\r\n',
  );
});

test('a manager cannot open the paper catalog reader', async ({ page }) => {
  await control(page, { persona: 'manager' });
  await signIn(page);
  await page.goto('/catalog/paper');
  await expect(page.getByRole('heading', { name: 'Catálogo en papel' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Catálogo en papel' })).toHaveCount(0);
});

test('the owner can send a short scanned PDF instead of photos', async ({ page }) => {
  await signIn(page);
  await page.goto('/catalog/paper');
  await page.getByRole('textbox', { name: 'Proveedor' }).fill('Plásticos del Norte');
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%%EOF\n', 'latin1');
  await page.getByLabel('Fotos del catálogo').setInputFiles({ name: 'lista.pdf', mimeType: 'application/pdf', buffer: pdf });

  await expect(page.getByTestId('paper-row')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Quitar PDF' })).toBeVisible();
  await expect(page.getByAltText('Foto lista.pdf')).toHaveCount(0);
});
