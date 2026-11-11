import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE } from '../../shared/appearance';
import type { UserSummary } from '../../shared/auth';
import type { CashStatus } from '../../shared/cash-api';
import type { AdjustStockResult } from '../../shared/inventory-api';
import type { CatalogProduct, PosApi } from '../../shared/pos-api';
import type { PricingApi } from '../../shared/pricing';
import { unitCostText, type ProductAdminApi, type ProductPanelDetail, type UpdateProductResult } from '../../shared/product-admin';
import { App } from '../App';
import { EMPTY_PRODUCT_FORM, formValuesOf, readEditForm } from './product-form';

const OWNER: UserSummary = { id: '019a5f2e-7c40-7b1a-9d2e-3f4a5b6c7d8e', name: 'Mauricio', role: 'owner' };
const CASHIER: UserSummary = { id: '019a5f2e-7c40-7b1a-9d2e-3f4a5b6c7d8f', name: 'Ana', role: 'cashier' };
const HAMMER: CatalogProduct = { id: 'hammer', name: 'Martillo', unit: 'piece', unitPriceE4: 1_160_000, taxRate: { factor: 'rate', rateBp: 1600 } };
const HAMMER_CODE = '2000000000107';
const DETAIL: ProductPanelDetail = {
  ...HAMMER,
  unitCostE6: 60_000_000,
  effectiveCostE6: 60_000_000,
  isActive: true,
  revision: 3,
  barcodes: [HAMMER_CODE],
  stockMilli: 8_000,
  movementCount: 2,
  recentMovements: [
    { occurredAt: '2026-11-10T15:00:00.000Z', type: 'sale', quantityMilli: -2_000, balanceMilli: 8_000 },
    { occurredAt: '2026-11-09T15:00:00.000Z', type: 'opening_balance', quantityMilli: 10_000, balanceMilli: 10_000 },
  ],
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
    findProductByCode: (code) => Promise.resolve(code === HAMMER_CODE ? HAMMER : null),
    searchProducts: () => Promise.resolve([HAMMER]),
    ...overrides,
  };
  return api as PosApi;
}

function productApiWith(overrides: Partial<ProductAdminApi> = {}): ProductAdminApi {
  return {
    createProduct: vi.fn(),
    findProducts: () => Promise.resolve([{ id: 'hammer', name: 'Martillo', unit: 'piece', unitPriceE4: 1_160_000, isActive: true }]),
    getProductDetail: () => Promise.resolve(DETAIL),
    updateProduct: () => Promise.resolve({ status: 'updated', product: { ...DETAIL, revision: 4, name: 'Martillo de bola' } }),
    ...overrides,
  };
}

const PRICING: PricingApi = {
  getPriceInfo: () => Promise.resolve({ product: HAMMER, lastCostE6: 60_000_000 }),
  changePrice: () => Promise.resolve({ status: 'changed', product: { ...HAMMER, unitPriceE4: 1_392_000 }, previousUnitPriceE4: HAMMER.unitPriceE4 }),
};

async function renderApp(posApi: PosApi, productApi: ProductAdminApi, pricingApi: PricingApi = PRICING): Promise<void> {
  render(<App posApi={posApi} productApi={productApi} pricingApi={pricingApi} />);
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

/** Opens the panel with F10 over a search result, as the cashier would, and waits for the product to load. */
async function openPanel(): Promise<void> {
  fireEvent.input(Object.assign(lookupBox(), { value: HAMMER_CODE }));
  fireEvent.keyDown(lookupBox(), { key: 'Enter' });
  await waitFor(() => expect(screen.getByRole('status', { name: 'Total' }).textContent).not.toBe('$0.00'));
  fireEvent.keyDown(lookupBox(), { key: 'F10' });
  await screen.findByRole('heading', { name: 'Martillo', hidden: true });
}

describe('the boxes of the panel', () => {
  it('shows a cost the way it can be typed again, and fills the form from the product', () => {
    expect(unitCostText(58_250_000)).toBe('58.25');
    expect(unitCostText(1)).toBe('0.000001');
    expect(unitCostText(1_500_000)).toBe('1.50');
    expect(formValuesOf(DETAIL)).toEqual({ ...EMPTY_PRODUCT_FORM, name: 'Martillo', unit: 'piece', cost: '60.00', taxKey: 'rate:1600', barcodes: [HAMMER_CODE], isActive: true });
  });

  it('reads the edited fields and ignores the price and the stock, which the panel never writes', () => {
    const reading = readEditForm({ ...formValuesOf(DETAIL), name: ' Martillo de bola ', cost: '', price: '999', stock: '5' });

    expect(reading).toEqual({
      ok: true,
      changes: { name: 'Martillo de bola', unit: 'piece', taxRate: { factor: 'rate', rateBp: 1600 }, unitCostE6: null, isActive: true, barcodes: [HAMMER_CODE] },
    });
  });

  it('reports every problem of the edit at once', () => {
    const reading = readEditForm({ ...formValuesOf(DETAIL), name: '', cost: '-1', barcodes: ['1', '1'] });

    expect(reading.ok).toBe(false);
    expect(reading.ok ? {} : reading.problems).toEqual({
      name: 'Escribe el nombre del producto.',
      cost: expect.stringContaining('solo números'),
      barcodes: expect.stringContaining('repetido'),
    });
  });
});

describe('the product panel (E1-43)', () => {
  it('opens with F10 on the product of the sale, and shows its stock, price, cost, margin and latest movements', async () => {
    await renderApp(posApiWith(OWNER), productApiWith());

    await openPanel();

    const summary = screen.getByLabelText('Resumen del producto', { selector: 'dl' }).textContent ?? '';
    expect(summary).toContain('Existencia8 pza');
    expect(summary).toContain('Precio (IVA incluido)$116.00 · IVA 16%');
    expect(summary).toContain('Costo$60.00');
    expect(summary).toContain('Margen40.0 %');
    const movements = screen.getByRole('table', { hidden: true, name: 'Últimos movimientos' });
    expect(within(movements).getByText('Venta')).toBeDefined();
    expect(within(movements).getByText('−2 pza')).toBeDefined();
    expect(within(movements).getByText('Existencia inicial')).toBeDefined();
    expect(box('Nombre').value).toBe('Martillo');
    expect((screen.getByRole('combobox', { name: 'Unidad de medida', hidden: true }) as HTMLSelectElement).disabled).toBe(true);
    expect(document.body.textContent).toContain('No se puede cambiar: el producto ya tiene movimientos de existencia.');
  });

  it('opens on a search when the sale points at nothing, and lists the products given up, marked', async () => {
    const findProducts = vi.fn<ProductAdminApi['findProducts']>(() =>
      Promise.resolve([
        { id: 'hammer', name: 'Martillo', unit: 'piece', unitPriceE4: 1_160_000, isActive: true },
        { id: 'old', name: 'Martillo viejo', unit: 'piece', unitPriceE4: 500_000, isActive: false },
      ]),
    );
    await renderApp(posApiWith(OWNER), productApiWith({ findProducts }));

    fireEvent.keyDown(lookupBox(), { key: 'F10' });
    await screen.findByRole('heading', { name: 'Producto', hidden: true });
    type('Producto', 'martillo');
    fireEvent.submit(box('Producto').closest('form')!);

    expect(await screen.findByRole('button', { name: /Martillo viejo · \$50\.00 \/ pza · dado de baja/, hidden: true })).toBeDefined();
    expect(findProducts).toHaveBeenCalledWith('martillo');
  });

  it('sends the new state with the revision it loaded, and shows the saved product', async () => {
    const updateProduct = vi.fn<ProductAdminApi['updateProduct']>(() => Promise.resolve<UpdateProductResult>({ status: 'updated', product: { ...DETAIL, revision: 4, name: 'Martillo de bola' } }));
    await renderApp(posApiWith(OWNER), productApiWith({ updateProduct }));
    await openPanel();

    type('Nombre', 'Martillo de bola');
    pressF2();

    await waitFor(() =>
      expect(updateProduct).toHaveBeenCalledExactlyOnceWith({
        productId: 'hammer',
        expectedRevision: 3,
        name: 'Martillo de bola',
        unit: 'piece',
        taxRate: { factor: 'rate', rateBp: 1600 },
        unitCostE6: 60_000_000,
        isActive: true,
        barcodes: [HAMMER_CODE],
      }),
    );
    expect(await screen.findByText(/Listo\. Los cambios quedaron guardados/)).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Martillo de bola', hidden: true })).toBeDefined();
  });

  it('does not ask the main process while the form is wrong, and marks each problem', async () => {
    const updateProduct = vi.fn<ProductAdminApi['updateProduct']>();
    await renderApp(posApiWith(OWNER), productApiWith({ updateProduct }));
    await openPanel();

    type('Nombre', '');
    type('Costo (opcional)', '-2');
    pressF2();

    expect(await screen.findByText('Escribe el nombre del producto.')).toBeDefined();
    expect(screen.getByText(/solo números y un punto decimal/)).toBeDefined();
    expect(updateProduct).not.toHaveBeenCalled();
  });

  it('adds a code with Enter and removes another, and sends the whole list', async () => {
    const updateProduct = vi.fn<ProductAdminApi['updateProduct']>(() => Promise.resolve<UpdateProductResult>({ status: 'unchanged', product: DETAIL }));
    await renderApp(posApiWith(OWNER), productApiWith({ updateProduct }));
    await openPanel();

    type('Código de barras', '7500000000001');
    fireEvent.keyDown(box('Código de barras'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('7500000000001', { selector: 'code' })).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: `Quitar el código ${HAMMER_CODE}`, hidden: true }));
    pressF2();

    await waitFor(() => expect(updateProduct).toHaveBeenCalledWith(expect.objectContaining({ barcodes: ['7500000000001'] })));
  });

  it('refuses a code another product has as soon as it is scanned, but not the code of the product itself', async () => {
    await renderApp(posApiWith(OWNER, { findProductByCode: (code) => Promise.resolve(code === '7500000000002' ? { ...HAMMER, id: 'other', name: 'Pinzas' } : code === HAMMER_CODE ? HAMMER : null) }), productApiWith());
    await openPanel();

    type('Código de barras', '7500000000002');
    fireEvent.keyDown(box('Código de barras'), { key: 'Enter' });

    expect(await screen.findByText('El código 7500000000002 ya lo usa «Pinzas».')).toBeDefined();
    type('Código de barras', HAMMER_CODE);
    fireEvent.keyDown(box('Código de barras'), { key: 'Enter' });
    expect(await screen.findByText(`El código ${HAMMER_CODE} ya está en la lista.`)).toBeDefined();
  });

  it('warns that the product changed while it was edited, shows the new state and writes nothing', async () => {
    const changed: ProductPanelDetail = { ...DETAIL, revision: 5, name: 'Martillo de uña', unitPriceE4: 1_200_000 };
    const updateProduct = vi.fn<ProductAdminApi['updateProduct']>(() => Promise.resolve<UpdateProductResult>({ status: 'stale', product: changed }));
    await renderApp(posApiWith(OWNER), productApiWith({ updateProduct }));
    await openPanel();

    type('Nombre', 'Mi nombre');
    pressF2();

    expect(await screen.findByText(/Este producto cambió mientras lo editabas, así que no se guardó nada/)).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Martillo de uña', hidden: true })).toBeDefined();
    expect(box('Nombre').value).toBe('Martillo de uña');
    // The next save uses the new revision, so it can go through once the person reviewed.
    updateProduct.mockImplementationOnce(() => Promise.resolve({ status: 'updated', product: { ...changed, revision: 6 } }));
    pressF2();
    await waitFor(() => expect(updateProduct).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 5 })));
  });

  it('tells why the unit is locked when the main process says so, and puts the old unit back', async () => {
    const updateProduct = vi.fn<ProductAdminApi['updateProduct']>(() => Promise.resolve<UpdateProductResult>({ status: 'unit_locked', movementCount: 2 }));
    await renderApp(posApiWith(OWNER), productApiWith({ updateProduct, getProductDetail: () => Promise.resolve({ ...DETAIL, movementCount: 0 }) }));
    await openPanel();

    fireEvent.change(screen.getByRole('combobox', { name: 'Unidad de medida', hidden: true }), { target: { value: 'meter' } });
    pressF2();

    expect(await screen.findByText(/ya tiene 2 movimientos de existencia, así que su unidad no se puede cambiar/)).toBeDefined();
    expect((screen.getByRole('combobox', { name: 'Unidad de medida', hidden: true }) as HTMLSelectElement).value).toBe('piece');
  });

  it('gives a product up by unticking it, and explains a product that is already given up', async () => {
    const updateProduct = vi.fn<ProductAdminApi['updateProduct']>(() => Promise.resolve<UpdateProductResult>({ status: 'updated', product: { ...DETAIL, revision: 4, isActive: false } }));
    await renderApp(posApiWith(OWNER), productApiWith({ updateProduct }));
    await openPanel();

    fireEvent.click(screen.getByRole('checkbox', { name: /A la venta/, hidden: true }));
    pressF2();

    await waitFor(() => expect(updateProduct).toHaveBeenCalledWith(expect.objectContaining({ isActive: false })));
    expect(await screen.findByText(/Este producto está dado de baja: no se vende ni aparece en la venta/)).toBeDefined();
    expect(screen.queryByRole('button', { name: /Cambiar precio/, hidden: true })).toBeNull();
  });

  it('makes a cashier type the PIN of the owner to save, and keeps the panel open on a wrong one', async () => {
    const updateProduct = vi.fn<ProductAdminApi['updateProduct']>(() => Promise.resolve<UpdateProductResult>({ status: 'wrong_pin', attemptsLeft: 4 }));
    await renderApp(posApiWith(CASHIER), productApiWith({ updateProduct }));
    await openPanel();
    // A cashier sees everything the owner sees.
    expect(document.body.textContent).toContain('Existencia8 pza');

    type('Nombre', 'Martillo de bola');
    pressF2();
    expect((await screen.findByRole('alert', { hidden: true })).textContent).toContain('Pídele al dueño que escriba su PIN.');
    expect(updateProduct).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('PIN del dueño', { selector: 'input' }), { target: { value: '0000' } });
    pressF2();

    await waitFor(() => expect(updateProduct).toHaveBeenCalledWith(expect.objectContaining({ ownerPin: '0000' })));
    expect(await screen.findByText(/PIN del dueño incorrecto. Quedan 4 intentos/)).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Martillo', hidden: true })).toBeDefined();
  });

  it('changes the price with the dialog of E1-39 and loads the product again', async () => {
    const changePrice = vi.fn<PricingApi['changePrice']>(PRICING.changePrice);
    const getProductDetail = vi.fn<ProductAdminApi['getProductDetail']>(() => Promise.resolve(DETAIL));
    await renderApp(posApiWith(OWNER), productApiWith({ getProductDetail }), { ...PRICING, changePrice });
    await openPanel();

    fireEvent.keyDown(document.body, { key: 'F8' });
    const price = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Precio nuevo (IVA incluido)', hidden: true });
    fireEvent.change(price, { target: { value: '139.20' } });
    pressF2();

    await waitFor(() => expect(changePrice).toHaveBeenCalledExactlyOnceWith({ productId: 'hammer', previousUnitPriceE4: 1_160_000, newUnitPriceE4: 1_392_000 }));
    expect(await screen.findByText(/Precio cambiado: \$116\.00 → \$139\.20/)).toBeDefined();
    expect(getProductDetail).toHaveBeenCalledTimes(2);
  });

  it('adjusts the stock with the dialog of the inventory, with a reason, and loads the product again', async () => {
    const adjustStock = vi.fn<PosApi['adjustStock']>((): Promise<AdjustStockResult> => Promise.resolve({ status: 'wrong_pin', attemptsLeft: 4 }));
    await renderApp(posApiWith(CASHIER, { adjustStock }), productApiWith());
    await openPanel();

    fireEvent.keyDown(document.body, { key: 'F9' });
    await screen.findByRole('heading', { name: 'Ajustar existencia', hidden: true });
    type('Cantidad', '2');
    pressF2();
    expect((await screen.findAllByRole('alert', { hidden: true })).map((alert) => alert.textContent).join(' ')).toContain('Escribe el motivo');
    type('Motivo', 'Se rompió');
    pressF2();
    expect((await screen.findAllByRole('alert', { hidden: true })).map((alert) => alert.textContent).join(' ')).toContain('Pídele al dueño que escriba su PIN.');
    expect(adjustStock).not.toHaveBeenCalled();

    fireEvent.change(screen.getAllByLabelText('PIN del dueño', { selector: 'input' }).at(-1)!, { target: { value: '0000' } });
    pressF2();

    await waitFor(() => expect(adjustStock).toHaveBeenCalledExactlyOnceWith({ productId: 'hammer', type: 'waste', quantityMilli: -2_000, reason: 'Se rompió', ownerPin: '0000' }));
    expect(await screen.findByText(/PIN del dueño incorrecto/)).toBeDefined();
  });

  it('Esc closes the panel without sending anything', async () => {
    const updateProduct = vi.fn<ProductAdminApi['updateProduct']>();
    await renderApp(posApiWith(OWNER), productApiWith({ updateProduct }));
    await openPanel();

    fireEvent.keyDown(document.body, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Martillo', hidden: true })).toBeNull());
    expect(updateProduct).not.toHaveBeenCalled();
  });

  it('does nothing when the register has no product API', async () => {
    render(<App posApi={posApiWith(OWNER)} />);
    await screen.findByRole('combobox', { name: 'Buscar producto' });

    fireEvent.keyDown(lookupBox(), { key: 'F10' });

    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
  });
});
