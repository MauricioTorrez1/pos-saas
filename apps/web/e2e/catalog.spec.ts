import { expect, test, type Page } from '@playwright/test';

const FAKE_URL = 'http://127.0.0.1:4017';

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

test('the owner creates a product with its price and finds it by code', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Abrir el catálogo' }).click();
  await expect(page.getByText('Tu catálogo está vacío')).toBeVisible();

  await page.getByRole('link', { name: 'Nuevo producto' }).first().click();
  await page.getByLabel('Nombre').fill('Cable THW calibre 12');
  await page.getByLabel('Se vende por').selectOption('meter');
  await page.getByLabel('Precio de venta con IVA').fill('12.345');
  await page.getByLabel('Códigos de barras').fill('7501000000012');
  await page.getByRole('button', { name: 'Agregar presentación' }).click();
  await page.getByLabel('Nombre de la presentación 1').fill('Rollo');
  await page.getByLabel('Unidades de la presentación 1').fill('100');
  await page.getByRole('button', { name: 'Crear producto' }).click();

  await expect(page.getByText('Producto creado.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cable THW calibre 12' })).toBeVisible();
  await expect(page.getByText('$12.345 por metro · Rollo de 100')).toBeVisible();

  await page.getByRole('navigation', { name: 'Catálogo' }).getByRole('link', { name: 'Productos' }).click();
  await page.getByRole('searchbox').fill('7501000000012');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.getByRole('link', { name: 'Cable THW calibre 12' })).toBeVisible();
  await expect(page.getByTestId('page-summary')).toHaveText('1–1 de 1 productos');
});

test('the form shows every mistake next to its field and keeps what was typed', async ({ page }) => {
  await signIn(page);
  await page.goto('/catalog/new');

  await page.getByLabel('Precio de venta con IVA').fill('0');
  await page.getByLabel('Clave de producto SAT').fill('123');
  await page.getByRole('button', { name: 'Crear producto' }).click();

  await expect(page.getByText('Escribe el nombre del producto.')).toBeVisible();
  await expect(page.getByText(/precio mayor que cero/)).toBeVisible();
  await expect(page.getByText(/8 dígitos/)).toBeVisible();
  await expect(page.getByLabel('Clave de producto SAT')).toHaveValue('123');
});

test('a code that belongs to another product is shown next to the codes', async ({ page }) => {
  await control(page, { seed: { count: 1, prefix: 'Pala', price: '150' } });
  await signIn(page);
  await page.goto('/catalog/new');

  await page.getByLabel('Nombre').fill('Pala cuadrada');
  await page.getByLabel('Códigos de barras').fill('PALA1');
  await page.getByRole('button', { name: 'Crear producto' }).click();

  await expect(page.getByText('El código PALA1 ya es de otro producto.')).toBeVisible();
  await expect(page.getByLabel('Nombre')).toHaveValue('Pala cuadrada');
});

test('the owner edits a product, changes its price and deactivates it', async ({ page }) => {
  await control(page, { seed: { count: 1, prefix: 'Martillo', price: '189' } });
  await signIn(page);
  await page.goto('/catalog');
  await page.getByRole('link', { name: 'Martillo 0001' }).click();

  await page.getByLabel('Nombre').fill('Martillo de uña 16 oz');
  await page.getByLabel('Estado').selectOption('inactive');
  await page.getByLabel('Claves propias de la tienda').fill('MART16');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Cambios guardados.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Martillo de uña 16 oz' })).toBeVisible();

  await page.getByLabel('Precio nuevo con IVA').fill('199.50');
  await page.getByRole('button', { name: 'Cambiar precio' }).click();
  await expect(page.getByText('Precio cambiado a $199.50.')).toBeVisible();

  await page.goto('/catalog?q=MART16');
  const row = page.getByRole('row', { name: /Martillo de uña 16 oz/ });
  await expect(row.getByText('$199.50')).toBeVisible();
  await expect(row.getByText('Inactivo')).toBeVisible();
});

test('the owner deletes a product after confirming', async ({ page }) => {
  await control(page, { seed: { count: 1, prefix: 'Lija', price: '9' } });
  await signIn(page);
  await page.goto('/catalog');
  await page.getByRole('link', { name: 'Lija 0001' }).click();

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Dar de baja' }).click();

  await expect(page.getByText('Producto dado de baja.')).toBeVisible();
  await expect(page.getByText('Tu catálogo está vacío')).toBeVisible();
});

test('a catalog of 5,000 products loads one page at a time and searches on the server', async ({ page }) => {
  await control(page, { seed: { count: 5000, prefix: 'Tornillo', price: '1.50' } });
  await signIn(page);

  const started = Date.now();
  await page.goto('/catalog');
  await expect(page.getByTestId('page-summary')).toHaveText('1–50 de 5,000 productos');
  expect(Date.now() - started).toBeLessThan(5000);
  await expect(page.locator('tbody tr')).toHaveCount(50);

  await page.getByRole('link', { name: 'Siguiente' }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByTestId('page-summary')).toHaveText('51–100 de 5,000 productos');
  await expect(page.getByRole('link', { name: 'Tornillo 0051' })).toBeVisible();

  await page.getByRole('searchbox').fill('tornillo 4321');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.getByTestId('page-summary')).toHaveText('1–1 de 1 productos');
});

const CSV = [
  'Código del producto,Nombre del producto,Precio de venta',
  '7501206612345,Martillo de uña 16 oz,189.00',
  'CAB-12,Cable THW calibre 12,12.50',
  'LIJA-80,Lija de agua 80,0',
].join('\n');

test('the owner checks a CSV file, reads the report and loads it', async ({ page }) => {
  await signIn(page);
  await page.goto('/catalog/import');

  await page.getByLabel('Archivo CSV del catálogo').setInputFiles({
    name: 'catalogo.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(CSV, 'utf-8'),
  });
  await expect(page.getByTestId('chosen-file')).toHaveText('catalogo.csv');
  await page.getByRole('button', { name: '2. Revisar archivo' }).click();

  await expect(page.getByText('Revisión del archivo')).toBeVisible();
  await expect(page.getByTestId('import-created')).toHaveText('2');
  await expect(page.getByTestId('import-invalid')).toHaveText('1');
  await expect(page.getByText('El precio de venta debe ser mayor que cero.')).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar filas con errores' }).click();
  expect((await download).suggestedFilename()).toBe('filas-no-cargadas.csv');

  await page.getByRole('button', { name: '3. Cargar 2 productos' }).click();
  await expect(page.getByText('Archivo cargado')).toBeVisible();

  await page.getByRole('link', { name: 'Ver el catálogo' }).click();
  await expect(page.getByTestId('page-summary')).toHaveText('1–2 de 2 productos');
  await expect(page.getByRole('row', { name: /Cable THW calibre 12/ }).getByText('$12.50')).toBeVisible();
});

test('the manager edits the catalog but sets no prices', async ({ page }) => {
  await control(page, { persona: 'manager' });
  await signIn(page);
  await page.goto('/catalog/new');

  await expect(page.getByLabel('Precio de venta con IVA')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Cambiar precios' })).toHaveCount(0);
  await page.getByLabel('Nombre').fill('Brocha de 2 pulgadas');
  await page.getByRole('button', { name: 'Crear producto' }).click();
  await expect(page.getByText('Producto creado.')).toBeVisible();
  await expect(page.getByLabel('Precio nuevo con IVA')).toHaveCount(0);

  await page.goto('/catalog/price-changes');
  await expect(page.getByRole('heading', { name: 'No tienes permiso para ver esto' })).toBeVisible();
});

test('the manager imports and is told the prices stay for the owner', async ({ page }) => {
  await control(page, { persona: 'manager' });
  await signIn(page);
  await page.goto('/catalog/import');

  await page.getByLabel('Archivo CSV del catálogo').setInputFiles({
    name: 'catalogo.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(CSV, 'utf-8'),
  });
  await page.getByRole('button', { name: '2. Revisar archivo' }).click();

  await expect(page.getByText(/2 productos quedan sin precio/)).toBeVisible();
});

test('the owner previews a bulk price change and applies it', async ({ page }) => {
  await control(page, { seed: { count: 3, prefix: 'Pala Truper', price: '100' } });
  await control(page, { seed: { count: 2, prefix: 'Pala Pretul', price: '80' } });
  await signIn(page);
  await page.goto('/catalog');
  await page.getByRole('link', { name: 'Cambiar precios' }).click();

  await page.getByLabel('Productos cuyo nombre contiene').fill('truper');
  await page.getByLabel('Cambio en %').fill('5');
  await page.getByLabel('Redondeo').selectOption('peso');
  await page.getByRole('button', { name: 'Ver vista previa' }).click();

  await expect(page.getByTestId('preview-count')).toHaveText('3 productos cambian');
  await expect(page.getByRole('row', { name: /Pala Truper 0001/ }).getByText('$105.00')).toBeVisible();
  await page.getByRole('button', { name: 'Aplicar a 3 productos' }).click();
  await expect(page.getByText('Listo: cambiaron 3 precios.', { exact: false })).toBeVisible();

  await page.goto('/catalog?q=pala');
  await expect(page.getByRole('row', { name: /Pala Truper 0002/ }).getByText('$105.00')).toBeVisible();
  await expect(page.getByRole('row', { name: /Pala Pretul 0001/ }).getByText('$80.00')).toBeVisible();
});

test('a bulk change whose preview went stale changes nothing and shows the new preview', async ({ page }) => {
  await control(page, { seed: { count: 2, prefix: 'Pinza Truper', price: '50' } });
  await signIn(page);
  await page.goto('/catalog/price-changes');
  await page.getByLabel('Productos cuyo nombre contiene').fill('truper');
  await page.getByLabel('Cambio en %').fill('10');
  await page.getByRole('button', { name: 'Ver vista previa' }).click();
  await expect(page.getByTestId('preview-count')).toHaveText('2 productos cambian');

  await control(page, { seed: { count: 1, prefix: 'Martillo Truper', price: '200' } });
  await page.getByRole('button', { name: 'Aplicar a 2 productos' }).click();

  await expect(page.getByText(/antes eran 2 productos y ahora son 3/)).toBeVisible();
  await expect(page.getByTestId('preview-count')).toHaveText('3 productos cambian');
  await page.goto('/catalog?q=pinza');
  await expect(page.getByRole('row', { name: /Pinza Truper 0001/ }).getByText('$50.00')).toBeVisible();
});
