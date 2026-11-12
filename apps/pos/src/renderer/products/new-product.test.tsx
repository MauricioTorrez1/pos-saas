import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE } from '../../shared/appearance';
import type { UserSummary } from '../../shared/auth';
import type { CashStatus } from '../../shared/cash-api';
import type { CatalogProduct, PosApi } from '../../shared/pos-api';
import {
  formatUnitCost,
  problemWithBarcode,
  problemWithBarcodes,
  readUnitCost,
  type CreateProductResult,
  type ProductAdminApi,
  type ProductDetail,
} from '../../shared/product-admin';
import { App } from '../App';
import { looksLikeBarcode, newProductFormFor, readNewProductForm, readStock, taxRateOfKey, EMPTY_PRODUCT_FORM, type ProductFormValues } from './product-form';

const OWNER: UserSummary = { id: '019a5f2e-7c40-7b1a-9d2e-3f4a5b6c7d8e', name: 'Mauricio', role: 'owner' };
const CASHIER: UserSummary = { id: '019a5f2e-7c40-7b1a-9d2e-3f4a5b6c7d8f', name: 'Ana', role: 'cashier' };
const HAMMER: CatalogProduct = { id: 'hammer', name: 'Martillo', unit: 'piece', unitPriceE4: 1_160_000, taxRate: { factor: 'rate', rateBp: 1600 } };
const CREATED: ProductDetail = {
  id: '019a5f2e-7c40-7b1a-9d2e-3f4a5b6c7d90',
  name: 'Cinta métrica',
  unit: 'piece',
  unitPriceE4: 895_000,
  taxRate: { factor: 'rate', rateBp: 1600 },
  unitCostE6: null,
  effectiveCostE6: null,
  isActive: true,
  revision: 1,
  barcodes: ['7501234567890'],
  stockMilli: 0,
  movementCount: 0,
};
const OPEN_CASH: CashStatus = {
  session: { id: 'session', openedBy: 'Mauricio', openedAt: '2026-11-08T14:00:00.000Z', openingFloatCents: 0 },
  totals: {
    openingFloatCents: 0,
    cashSalesCents: 0,
    cardSalesCents: 0,
    transferSalesCents: 0,
    cashInCents: 0,
    cashOutCents: 0,
    cashRefundsCents: 0,
    cardRefundsCents: 0,
    transferRefundsCents: 0,
  },
  expected: { cashCents: 0, cardCents: 0, transferCents: 0 },
  withdrawalLimitCents: 500_000,
  shouldWithdraw: false,
};

beforeAll(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
});

afterEach(cleanup);

function posApiWith(user: UserSummary, overrides: Partial<PosApi> = {}): PosApi {
  const api: Partial<PosApi> = {
    getAppInfo: () => Promise.resolve({ version: '1.0.0' }),
    getAuthState: () => Promise.resolve({ needsSetup: false, users: [user], current: user }),
    getAppearance: () => Promise.resolve(DEFAULT_APPEARANCE),
    getCashStatus: () => Promise.resolve(OPEN_CASH),
    listPendingSales: () => Promise.resolve([]),
    findProductByCode: (code) => Promise.resolve(code === '2000000000107' ? HAMMER : null),
    searchProducts: () => Promise.resolve([]),
    ...overrides,
  };
  return api as PosApi;
}

function productApiWith(createProduct: ProductAdminApi['createProduct']): ProductAdminApi {
  return { createProduct };
}

async function renderApp(posApi: PosApi, productApi: ProductAdminApi): Promise<void> {
  render(<App posApi={posApi} productApi={productApi} />);
  await screen.findByRole('combobox', { name: 'Buscar producto' });
}

function lookupBox(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('combobox', { name: 'Buscar producto' });
}

function box(label: string): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('textbox', { name: label, hidden: true });
}

function type(label: string, text: string): void {
  fireEvent.change(box(label), { target: { value: text } });
}

function pressF2(): void {
  fireEvent.keyDown(document.body, { key: 'F2' });
}

async function lookFor(text: string): Promise<void> {
  fireEvent.input(Object.assign(lookupBox(), { value: text }));
  fireEvent.keyDown(lookupBox(), { key: 'Enter' });
}

describe('reading a cost typed by a person', () => {
  it.each([
    ['58.25', 58_250_000],
    ['58', 58_000_000],
    ['0', 0],
    ['0.000001', 1],
    [' 1.5 ', 1_500_000],
    ['1000000', 1_000_000_000_000],
  ])('reads %s as %i millionths', (text, expected) => {
    expect(readUnitCost(text)).toEqual({ ok: true, unitCostE6: expected });
  });

  it.each([
    ['', 'solo números'],
    ['-1', 'solo números'],
    ['1,5', 'solo números'],
    ['$5', 'solo números'],
    ['1.1234567', 'hasta 6 decimales'],
    ['1000000.000001', 'demasiado alto'],
    ['99999999999999999999', 'demasiado alto'],
  ])('refuses %j with a message that says what to fix', (text, fragment) => {
    const reading = readUnitCost(text);

    expect(reading.ok).toBe(false);
    expect(reading.ok ? '' : reading.message).toContain(fragment);
  });

  it('shows a cost with two decimals, and more only when it has them', () => {
    expect(formatUnitCost(58_250_000)).toBe('$58.25');
    expect(formatUnitCost(1_500_000)).toBe('$1.50');
    expect(formatUnitCost(1)).toBe('$0.000001');
    expect(formatUnitCost(1_234_567_000)).toBe('$1,234.567');
  });
});

describe('checking barcodes', () => {
  it('accepts a code with letters, digits and dashes, and ignores the spaces around it', () => {
    expect(problemWithBarcode('  7501234567890 ')).toBeNull();
    expect(problemWithBarcode('CINTA-5M')).toBeNull();
  });

  it.each([
    ['', 'vacío'],
    ['   ', 'vacío'],
    ['12 34', 'espacios'],
    ['1'.repeat(65), 'hasta 64'],
    ['12\u0007', 'caracteres de control'],
  ])('refuses %j', (code, fragment) => {
    expect(problemWithBarcode(code)).toContain(fragment);
  });

  it('refuses a repeated code and more than twenty', () => {
    expect(problemWithBarcodes(['1', '2', '1'])).toContain('repetido');
    expect(problemWithBarcodes(Array.from({ length: 21 }, (_unused, index) => String(index)))).toContain('hasta 20');
    expect(problemWithBarcodes(['1', '2'])).toBeNull();
  });
});

describe('what the form of a new product starts with', () => {
  it('puts a scanned text in the barcode box and a typed word in the name', () => {
    expect(newProductFormFor('7501234567890', true).barcodes).toEqual(['7501234567890']);
    expect(newProductFormFor('cinta métrica', false)).toMatchObject({ name: 'cinta métrica', barcodes: [] });
    expect(newProductFormFor('7501234567890', false).barcodes).toEqual(['7501234567890']);
    expect(newProductFormFor('1/2', false)).toMatchObject({ name: '1/2', barcodes: [] });
    expect(newProductFormFor('', false)).toEqual(EMPTY_PRODUCT_FORM);
  });

  it('does not take a name with spaces for a code, even if a scanner sent it', () => {
    expect(looksLikeBarcode('cinta metrica', true)).toBe(false);
  });
});

describe('reading the form of a new product', () => {
  const filled: ProductFormValues = { ...EMPTY_PRODUCT_FORM, name: ' Cinta ', price: '89.50', cost: '52.25', stock: '12', barcodes: ['111', '222'] };

  it('turns the typed text into the request, with Quantity and price scales', () => {
    expect(readNewProductForm(filled)).toEqual({
      ok: true,
      request: {
        name: 'Cinta',
        unit: 'piece',
        unitPriceE4: 895_000,
        taxRate: { factor: 'rate', rateBp: 1600 },
        unitCostE6: 52_250_000,
        barcodes: ['111', '222'],
        initialStockMilli: 12_000,
        isActive: true,
      },
    });
  });

  it('sends no cost and no stock when those boxes are empty', () => {
    expect(readNewProductForm({ ...filled, cost: '', stock: '' })).toMatchObject({ ok: true, request: { unitCostE6: null, initialStockMilli: null } });
  });

  it('reports every problem at once, box by box, in Spanish', () => {
    const reading = readNewProductForm({ ...EMPTY_PRODUCT_FORM, name: '', price: '0', cost: '-2', stock: '1.5', barcodes: ['1', '1'] });

    expect(reading.ok).toBe(false);
    expect(reading.ok ? {} : reading.problems).toEqual({
      name: 'Escribe el nombre del producto.',
      price: 'El precio debe ser mayor que cero.',
      cost: expect.stringContaining('solo números'),
      stock: expect.stringContaining('piezas se cuentan enteras'),
      barcodes: expect.stringContaining('repetido'),
    });
  });

  it('reads the stock of a measured product with three decimals', () => {
    expect(readStock('12.5', 'meter')).toEqual({ ok: true, milli: 12_500 });
    expect(readStock('0.0005', 'meter')).toMatchObject({ ok: false });
    expect(readStock('0', 'kilogram')).toMatchObject({ ok: false });
  });

  it('turns the key of a VAT choice back into the rate and refuses another', () => {
    expect(taxRateOfKey('rate:1600')).toEqual({ factor: 'rate', rateBp: 1600 });
    expect(taxRateOfKey('exempt:0')).toEqual({ factor: 'exempt', rateBp: 0 });
    expect(() => taxRateOfKey('exempt:1600')).toThrow(RangeError);
    expect(() => taxRateOfKey('nonsense')).toThrow(RangeError);
  });
});

describe('adding a product from the sale screen (E1-42)', () => {
  it('offers to add what was not found, with the typed text loaded, and F5 opens the form', async () => {
    await renderApp(posApiWith(OWNER), productApiWith(vi.fn()));

    await lookFor('cinta métrica');
    const offer = await screen.findByRole('button', { name: /Dar de alta «cinta métrica»/ });
    fireEvent.click(offer);

    expect(await screen.findByRole('heading', { name: 'Producto nuevo', hidden: true })).toBeDefined();
    expect(box('Nombre').value).toBe('cinta métrica');
  });

  it('puts a scanned code that is not in the catalog in the barcode list', async () => {
    await renderApp(posApiWith(OWNER), productApiWith(vi.fn()));

    await lookFor('7509999999999');
    await screen.findByRole('button', { name: /Dar de alta «7509999999999»/ });
    fireEvent.keyDown(lookupBox(), { key: 'F5' });

    expect(await screen.findByLabelText('Códigos del producto', { selector: 'ul' })).toBeDefined();
    expect(screen.getByText('7509999999999', { selector: 'code' })).toBeDefined();
    expect(box('Nombre').value).toBe('');
  });

  it('does not offer it when the register has no product API', async () => {
    render(<App posApi={posApiWith(OWNER)} />);
    await screen.findByRole('combobox', { name: 'Buscar producto' });

    await lookFor('cinta');

    await screen.findByText(/No encontramos «cinta»/);
    expect(screen.queryByRole('button', { name: /Dar de alta/ })).toBeNull();
  });

  it('shows every problem in red and does not ask the main process while the form is wrong', async () => {
    const createProduct = vi.fn<ProductAdminApi['createProduct']>();
    await renderApp(posApiWith(OWNER), productApiWith(createProduct));
    fireEvent.keyDown(lookupBox(), { key: 'F5' });
    await screen.findByRole('heading', { name: 'Producto nuevo', hidden: true });

    type('Precio (IVA incluido)', '0');
    pressF2();

    expect(await screen.findByText('Escribe el nombre del producto.')).toBeDefined();
    expect(screen.getByText('El precio debe ser mayor que cero.')).toBeDefined();
    expect(createProduct).not.toHaveBeenCalled();
  });

  it('adds a code with Enter, like a scanner, and refuses one another product already has, naming it', async () => {
    await renderApp(posApiWith(OWNER), productApiWith(vi.fn()));
    fireEvent.keyDown(lookupBox(), { key: 'F5' });
    await screen.findByRole('heading', { name: 'Producto nuevo', hidden: true });

    type('Código de barras', '2000000000107');
    fireEvent.keyDown(box('Código de barras'), { key: 'Enter' });

    expect(await screen.findByText('El código 2000000000107 ya lo usa «Martillo».')).toBeDefined();
    expect(screen.queryByLabelText('Códigos del producto', { selector: 'ul' })).toBeNull();

    type('Código de barras', '7501234567890');
    fireEvent.keyDown(box('Código de barras'), { key: 'Enter' });

    await waitFor(() => expect(screen.getByText('7501234567890', { selector: 'code' })).toBeDefined());
    expect(box('Código de barras').value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Quitar el código 7501234567890', hidden: true }));
    expect(screen.queryByText('7501234567890', { selector: 'code' })).toBeNull();
  });

  it('sends the product as the form read it, closes, and puts the new product on the sale when it came from a search', async () => {
    const createProduct = vi.fn<ProductAdminApi['createProduct']>((): Promise<CreateProductResult> => Promise.resolve({ status: 'created', product: CREATED }));
    await renderApp(posApiWith(OWNER), productApiWith(createProduct));

    await lookFor('Cinta métrica');
    fireEvent.click(await screen.findByRole('button', { name: /Dar de alta/ }));
    await screen.findByRole('heading', { name: 'Producto nuevo', hidden: true });
    type('Precio (IVA incluido)', '89.50');
    type('Costo (opcional)', '52.25');
    type('Existencia inicial (opcional)', '12');
    pressF2();

    await waitFor(() =>
      expect(createProduct).toHaveBeenCalledExactlyOnceWith({
        name: 'Cinta métrica',
        unit: 'piece',
        unitPriceE4: 895_000,
        taxRate: { factor: 'rate', rateBp: 1600 },
        unitCostE6: 52_250_000,
        barcodes: [],
        initialStockMilli: 12_000,
        isActive: true,
      }),
    );
    expect(await screen.findByText(/Producto nuevo: Cinta métrica\. Ya está en la venta/)).toBeDefined();
    expect(screen.getByRole('status', { name: 'Total' }).textContent).toBe('$89.50');
    expect(screen.queryByRole('heading', { name: 'Producto nuevo', hidden: true })).toBeNull();
  });

  it('Esc cancels without sending anything', async () => {
    const createProduct = vi.fn<ProductAdminApi['createProduct']>();
    await renderApp(posApiWith(OWNER), productApiWith(createProduct));
    fireEvent.keyDown(lookupBox(), { key: 'F5' });
    await screen.findByRole('heading', { name: 'Producto nuevo', hidden: true });

    fireEvent.keyDown(document.body, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Producto nuevo', hidden: true })).toBeNull());
    expect(createProduct).not.toHaveBeenCalled();
  });

  it('makes a cashier type the PIN of the owner, and keeps the dialog open on a wrong one', async () => {
    const createProduct = vi.fn<ProductAdminApi['createProduct']>((): Promise<CreateProductResult> => Promise.resolve({ status: 'wrong_pin', attemptsLeft: 4 }));
    await renderApp(posApiWith(CASHIER), productApiWith(createProduct));
    fireEvent.keyDown(lookupBox(), { key: 'F5' });
    await screen.findByRole('heading', { name: 'Producto nuevo', hidden: true });
    type('Nombre', 'Cinta');
    type('Precio (IVA incluido)', '89.50');

    pressF2();
    expect((await screen.findByRole('alert', { hidden: true })).textContent).toContain('Pídele al dueño que escriba su PIN.');
    expect(createProduct).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('PIN del dueño', { selector: 'input' }), { target: { value: '0000' } });
    pressF2();

    await waitFor(() => expect(createProduct).toHaveBeenCalledWith(expect.objectContaining({ ownerPin: '0000' })));
    expect(await screen.findByText(/PIN del dueño incorrecto. Quedan 4 intentos/)).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Producto nuevo', hidden: true })).toBeDefined();
  });

  it('says which product has a code when the main process finds a duplicate at the end', async () => {
    const createProduct = vi.fn<ProductAdminApi['createProduct']>(
      (): Promise<CreateProductResult> => Promise.resolve({ status: 'duplicate_code', code: '7501', productId: 'other', productName: 'Cinta vieja' }),
    );
    await renderApp(posApiWith(OWNER), productApiWith(createProduct));
    fireEvent.keyDown(lookupBox(), { key: 'F5' });
    await screen.findByRole('heading', { name: 'Producto nuevo', hidden: true });
    type('Nombre', 'Cinta');
    type('Precio (IVA incluido)', '89.50');

    pressF2();

    const dialog = await screen.findByRole('dialog', { hidden: true });
    expect(await within(dialog).findByText(/El código 7501 ya lo usa «Cinta vieja»/)).toBeDefined();
  });
});
