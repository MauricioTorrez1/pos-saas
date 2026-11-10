import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE } from '../../shared/appearance';
import type { UserSummary } from '../../shared/auth';
import type { CashStatus } from '../../shared/cash-api';
import type { CatalogProduct, PosApi } from '../../shared/pos-api';
import type { ChangePriceResult, PriceInfo, PricingApi } from '../../shared/pricing';
import { App } from '../App';
import { readNewPrice } from './price-input';

const HAMMER: CatalogProduct = { id: 'hammer', name: 'Martillo', unit: 'piece', unitPriceE4: 1_160_000, taxRate: { factor: 'rate', rateBp: 1600 } };
const HAMMER_CODE = '2000000000107';
const OWNER: UserSummary = { id: '019a5f2e-7c40-7b1a-9d2e-3f4a5b6c7d8e', name: 'Mauricio', role: 'owner' };
const CASHIER: UserSummary = { id: '019a5f2e-7c40-7b1a-9d2e-3f4a5b6c7d8f', name: 'Ana', role: 'cashier' };
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

/** The parts of the bridge a price change touches. The rest answers like an empty register. */
function posApiWith(user: UserSummary, overrides: Partial<PosApi> = {}): PosApi {
  const api: Partial<PosApi> = {
    getAppInfo: () => Promise.resolve({ version: '1.0.0' }),
    getAuthState: () => Promise.resolve({ needsSetup: false, users: [user], current: user }),
    getAppearance: () => Promise.resolve(DEFAULT_APPEARANCE),
    getCashStatus: () => Promise.resolve(OPEN_CASH),
    listPendingSales: () => Promise.resolve([]),
    findProductByCode: (code) => Promise.resolve(code === HAMMER_CODE ? HAMMER : null),
    searchProducts: () => Promise.resolve([HAMMER]),
    savePendingSale: () => Promise.resolve({ status: 'catalog_changed' }),
    ...overrides,
  };
  return api as PosApi;
}

function pricingWith(overrides: Partial<PricingApi> = {}): PricingApi {
  const info: PriceInfo = { product: HAMMER, lastCostE6: 60_000_000 };
  return {
    getPriceInfo: () => Promise.resolve(info),
    changePrice: () => Promise.resolve({ status: 'changed', product: { ...HAMMER, unitPriceE4: 1_392_000 }, previousUnitPriceE4: HAMMER.unitPriceE4 }),
    ...overrides,
  };
}

async function renderApp(posApi: PosApi, pricingApi: PricingApi): Promise<void> {
  render(<App posApi={posApi} pricingApi={pricingApi} />);
  await screen.findByRole('combobox', { name: 'Buscar producto' });
}

function lookupBox(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('combobox', { name: 'Buscar producto' });
}

async function addHammer(): Promise<void> {
  fireEvent.input(Object.assign(lookupBox(), { value: HAMMER_CODE }));
  fireEvent.keyDown(lookupBox(), { key: 'Enter' });
  await waitFor(() => expect(screen.getByRole('status', { name: 'Total' }).textContent).not.toBe('$0.00'));
}

async function openPriceDialog(): Promise<HTMLInputElement> {
  fireEvent.keyDown(lookupBox(), { key: 'F7' });
  return screen.findByRole<HTMLInputElement>('textbox', { name: 'Precio nuevo (IVA incluido)', hidden: true });
}

function typePrice(box: HTMLInputElement, text: string): void {
  fireEvent.change(box, { target: { value: text } });
}

function pressF2(): void {
  fireEvent.keyDown(document.body, { key: 'F2' });
}

describe('reading the price that was typed', () => {
  it.each([
    ['135.50', 1_355_000],
    ['135', 1_350_000],
    ['0.153', 1530],
    ['12.3456', 123_456],
    [' 12.50 ', 125_000],
  ])('reads %s as %i ten-thousandths', (text, expected) => {
    expect(readNewPrice(text)).toEqual({ ok: true, unitPriceE4: expected });
  });

  it.each([
    ['', 'Escribe el precio nuevo.'],
    ['0', 'mayor que cero'],
    ['0.0000', 'mayor que cero'],
    ['-5', 'solo números'],
    ['12.34567', 'hasta 4 decimales'],
    ['1,200', 'solo números'],
    ['$12', 'solo números'],
    ['1000000.01', 'demasiado alto'],
    ['99999999999999999999', 'demasiado alto'],
  ])('refuses %j with a message that says what to fix', (text, fragment) => {
    const reading = readNewPrice(text);

    expect(reading.ok).toBe(false);
    expect(reading.ok ? '' : reading.message).toContain(fragment);
  });
});

describe('changing the price from the sale screen (E1-39)', () => {
  it('opens with F7 on the product of the selected line, and shows the price, the margin and the new margin', async () => {
    await renderApp(posApiWith(OWNER), pricingWith());
    await addHammer();

    const box = await openPriceDialog();
    typePrice(box, '139.20');

    expect(await screen.findByText(/Precio actual:/, { selector: 'p', exact: false })).toBeDefined();
    const text = document.body.textContent ?? '';
    expect(text).toContain('Martillo');
    expect(text).toContain('Precio actual: $116.00 por pza, con IVA incluido. Margen: 40.0 %');
    expect(text).toContain('Antes $116.00 → ahora $139.20. Margen: 50.0 %');
  });

  it('warns when the new price is below the cost, and says there is no margin without a cost', async () => {
    await renderApp(posApiWith(OWNER), pricingWith({ getPriceInfo: () => Promise.resolve({ product: HAMMER, lastCostE6: 150_000_000 }) }));
    await addHammer();

    typePrice(await openPriceDialog(), '100');

    expect(document.body.textContent).toContain('Ojo: queda por debajo del costo.');
    cleanup();

    await renderApp(posApiWith(OWNER), pricingWith({ getPriceInfo: () => Promise.resolve({ product: HAMMER, lastCostE6: null }) }));
    await addHammer();
    typePrice(await openPriceDialog(), '100');

    expect(document.body.textContent).toContain('Sin costo registrado: no se puede calcular el margen.');
  });

  it('asks the owner nothing but the price, and sends what the screen saw as the previous price', async () => {
    const changePrice = vi.fn<PricingApi['changePrice']>(() =>
      Promise.resolve({ status: 'changed', product: { ...HAMMER, unitPriceE4: 1_392_000 }, previousUnitPriceE4: HAMMER.unitPriceE4 }),
    );
    await renderApp(posApiWith(OWNER), pricingWith({ changePrice }));
    await addHammer();

    const box = await openPriceDialog();
    expect(screen.queryByLabelText('PIN del dueño')).toBeNull();
    typePrice(box, '139.20');
    pressF2();

    await waitFor(() => expect(changePrice).toHaveBeenCalledExactlyOnceWith({ productId: 'hammer', previousUnitPriceE4: 1_160_000, newUnitPriceE4: 1_392_000 }));
    expect(await screen.findByText(/Precio de Martillo: \$116\.00 → \$139\.20/)).toBeDefined();
  });

  it('refuses a price of zero, a negative one, and one with too many decimals before asking the main process', async () => {
    const changePrice = vi.fn<PricingApi['changePrice']>();
    await renderApp(posApiWith(OWNER), pricingWith({ changePrice }));
    await addHammer();
    const box = await openPriceDialog();

    for (const [text, message] of [
      ['0', 'mayor que cero'],
      ['-1', 'solo números'],
      ['10.00001', 'hasta 4 decimales'],
    ] as const) {
      typePrice(box, text);
      pressF2();
      expect((await screen.findByRole('alert', { hidden: true })).textContent).toContain(message);
    }
    expect(changePrice).not.toHaveBeenCalled();
  });

  it('makes a cashier type the PIN of the owner, and shows a wrong one without closing', async () => {
    const changePrice = vi.fn<PricingApi['changePrice']>((): Promise<ChangePriceResult> => Promise.resolve({ status: 'wrong_pin', attemptsLeft: 4 }));
    await renderApp(posApiWith(CASHIER), pricingWith({ changePrice }));
    await addHammer();

    const box = await openPriceDialog();
    typePrice(box, '139.20');
    pressF2();
    expect((await screen.findByRole('alert', { hidden: true })).textContent).toContain('Pídele al dueño que escriba su PIN.');
    expect(changePrice).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('PIN del dueño'), { target: { value: '0000' } });
    pressF2();

    await waitFor(() => expect(changePrice).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ownerPin: '0000', newUnitPriceE4: 1_392_000 })));
    expect((await screen.findByRole('alert', { hidden: true })).textContent).toContain('Quedan 4 intentos');
    expect(screen.getByRole('dialog', { name: 'Cambiar precio', hidden: true })).toBeDefined();
  });

  it('closes with Esc and changes nothing', async () => {
    const changePrice = vi.fn<PricingApi['changePrice']>();
    await renderApp(posApiWith(OWNER), pricingWith({ changePrice }));
    await addHammer();
    await openPriceDialog();

    fireEvent.keyDown(document.body, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Cambiar precio', hidden: true })).toBeNull());
    expect(changePrice).not.toHaveBeenCalled();
  });

  it('finds the product by name when none is selected, and then changes its price', async () => {
    const changePrice = vi.fn<PricingApi['changePrice']>(() =>
      Promise.resolve({ status: 'changed', product: { ...HAMMER, unitPriceE4: 1_392_000 }, previousUnitPriceE4: HAMMER.unitPriceE4 }),
    );
    await renderApp(posApiWith(OWNER), pricingWith({ changePrice }));

    fireEvent.keyDown(lookupBox(), { key: 'F7' });
    const search = await screen.findByRole('textbox', { name: 'Producto', hidden: true });
    fireEvent.change(search, { target: { value: 'mart' } });
    fireEvent.submit(search.closest('form')!);
    typePrice(await screen.findByRole<HTMLInputElement>('textbox', { name: 'Precio nuevo (IVA incluido)', hidden: true }), '139.20');
    pressF2();

    await waitFor(() => expect(changePrice).toHaveBeenCalledTimes(1));
  });
});

describe('the sale in progress and the next one (ADR 0047)', () => {
  it('keeps the total of the lines already added when the price changes meanwhile', async () => {
    const repriced: CatalogProduct = { ...HAMMER, unitPriceE4: 1_392_000 };
    let current = HAMMER;
    await renderApp(
      posApiWith(OWNER, { findProductByCode: (code) => Promise.resolve(code === HAMMER_CODE ? current : null) }),
      pricingWith({
        changePrice: () => {
          current = repriced;
          return Promise.resolve({ status: 'changed', product: repriced, previousUnitPriceE4: HAMMER.unitPriceE4 });
        },
      }),
    );
    await addHammer();
    expect(screen.getByRole('status', { name: 'Total' }).textContent).toBe('$116.00');

    typePrice(await openPriceDialog(), '139.20');
    pressF2();
    await screen.findByText(/Precio de Martillo/);

    // The line on the screen is the old one.
    expect(screen.getByRole('status', { name: 'Total' }).textContent).toBe('$116.00');
  });

  it('offers the sale again with the prices it shows when the catalog says it changed, and only once', async () => {
    const savePendingSale = vi.fn<PosApi['savePendingSale']>(() => Promise.resolve({ status: 'catalog_changed' }));
    await renderApp(posApiWith(OWNER, { savePendingSale }), pricingWith());
    await addHammer();

    fireEvent.keyDown(lookupBox(), { key: 'F12' });

    await waitFor(() => expect(savePendingSale).toHaveBeenCalledTimes(2));
    expect(savePendingSale.mock.calls[0]![0].lines).toEqual([{ productId: 'hammer', quantityMilli: 1000 }]);
    expect(savePendingSale.mock.calls[1]![0].lines).toEqual([{ productId: 'hammer', quantityMilli: 1000, unitPriceE4: 1_160_000 }]);
    expect(savePendingSale.mock.calls[1]![0].idempotencyKey).toBe(savePendingSale.mock.calls[0]![0].idempotencyKey);
    expect((await screen.findByRole('alert')).textContent).toContain('El catálogo cambió');
  });

  it('does not ask twice when the first answer is already a saved sale', async () => {
    const savePendingSale = vi.fn<PosApi['savePendingSale']>(() => Promise.resolve({ status: 'no_cash_session' }));
    await renderApp(posApiWith(OWNER, { savePendingSale }), pricingWith());
    await addHammer();

    fireEvent.keyDown(lookupBox(), { key: 'F12' });

    await waitFor(() => expect(savePendingSale).toHaveBeenCalledTimes(1));
  });
});

describe('changing the price from the product view of the owner', () => {
  it('has a button and F8 in the product of the inventory, and tells what changed', async () => {
    const changePrice = vi.fn<PricingApi['changePrice']>(() =>
      Promise.resolve({ status: 'changed', product: { ...HAMMER, unitPriceE4: 1_392_000 }, previousUnitPriceE4: HAMMER.unitPriceE4 }),
    );
    await renderApp(
      posApiWith(OWNER, {
        getBackupStatus: () => Promise.resolve({ folder: null, lastBackupAt: null, lastError: null }),
        getKardex: () => Promise.resolve({ productId: 'hammer', productName: 'Martillo', unit: 'piece', stockMilli: 5000, rows: [], totalMovements: 0 }),
      }),
      pricingWith({ changePrice }),
    );
    fireEvent.keyDown(lookupBox(), { key: 'F1' });
    await screen.findByRole('dialog', { name: /Administración|Inventario|Respaldos/, hidden: true });
    fireEvent.keyDown(document.body, { key: 'F2' });
    const search = await screen.findByRole('textbox', { name: 'Producto', hidden: true });
    fireEvent.change(search, { target: { value: HAMMER_CODE } });
    fireEvent.submit(search.closest('form')!);
    fireEvent.click(await screen.findByRole('button', { name: /Cambiar precio/, hidden: true }));

    typePrice(await screen.findByRole<HTMLInputElement>('textbox', { name: 'Precio nuevo (IVA incluido)', hidden: true }), '139.20');
    pressF2();

    expect(await screen.findByText(/Precio cambiado: \$116\.00 → \$139\.20/)).toBeDefined();
    expect(changePrice).toHaveBeenCalledExactlyOnceWith({ productId: 'hammer', previousUnitPriceE4: 1_160_000, newUnitPriceE4: 1_392_000 });
    // The kardex stays open: Esc of the price dialog must not have gone back to the search.
    expect(screen.getByRole('table', { name: 'Movimientos del producto', hidden: true })).toBeDefined();
  });
});
