import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE, type Appearance } from '../shared/appearance';
import type { UserSummary } from '../shared/auth';
import type { CashStatus } from '../shared/cash-api';
import type { ReturnableSale } from '../shared/returns-api';
import type { CatalogProduct, CheckoutSaleResult, PendingSale, PosApi } from '../shared/pos-api';
import { App } from './App';

const HAMMER: CatalogProduct = {
  id: 'hammer',
  name: 'Martillo',
  unit: 'piece',
  unitPriceE4: 1_160_000,
  taxRate: { factor: 'rate', rateBp: 1600 },
};
const CABLE: CatalogProduct = {
  id: 'cable',
  name: 'Cable THW',
  unit: 'meter',
  unitPriceE4: 125_000,
  taxRate: { factor: 'rate', rateBp: 1600 },
};

const HAMMER_CODE = '2000000000107';
const OWNER: UserSummary = { id: '019a5f2e-7c40-7b1a-9d2e-3f4a5b6c7d8e', name: 'Mauricio', role: 'owner' };
const OPEN_CASH: CashStatus = {
  session: { id: 'session', openedBy: 'Mauricio', openedAt: '2026-11-08T14:00:00.000Z', openingFloatCents: 50000 },
  totals: {
    openingFloatCents: 50000,
    cashSalesCents: 10000,
    cardSalesCents: 0,
    transferSalesCents: 0,
    cashInCents: 0,
    cashOutCents: 0,
    cashRefundsCents: 0,
    cardRefundsCents: 0,
    transferRefundsCents: 0,
  },
  expected: { cashCents: 60000, cardCents: 0, transferCents: 0 },
  withdrawalLimitCents: 500_000,
  shouldWithdraw: false,
};
const CLOSED_CASH: CashStatus = { session: null, totals: null, expected: null, withdrawalLimitCents: 500_000, shouldWithdraw: false };
const COMPLETED: CheckoutSaleResult = { status: 'completed', folio: 'T1-000001', changeCents: 0, problems: [] };

beforeAll(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
});

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.accent;
});

function fakePosApi(overrides: Partial<PosApi> = {}): PosApi {
  return {
    getAppInfo: () => Promise.resolve({ version: '1.2.3' }),
    getAuthState: () => Promise.resolve({ needsSetup: false, users: [OWNER], current: OWNER }),
    setupOwner: () => Promise.resolve(OWNER),
    login: () => Promise.resolve({ status: 'ok', user: OWNER }),
    logout: () => Promise.resolve(),
    createUser: () => Promise.resolve(OWNER),
    getKardex: () => Promise.resolve(null),
    adjustStock: () => Promise.resolve({ status: 'not_found' }),
    checkLedger: () => Promise.resolve({ checkedMovements: 0, problems: [] }),
    getDailyReport: (date) =>
      Promise.resolve({
        date,
        salesCount: 0,
        totalCents: 0,
        averageTicketCents: 0,
        returnsCount: 0,
        returnsCents: 0,
        byHour: [],
        byCashier: [],
        marginCents: 0,
        linesWithoutCost: 0,
        outOfStock: [],
        notSelling: [],
      }),
    importCatalog: () => Promise.resolve({ status: 'cancelled' }),
    getBackupStatus: () => Promise.resolve({ folder: null, lastBackupAt: null, lastError: null }),
    configureBackup: () => Promise.resolve({ status: 'not_configured' }),
    backupNow: () => Promise.resolve({ status: 'not_configured' }),
    restoreBackup: () => Promise.resolve({ status: 'cancelled' }),
    findReturnableSale: () => Promise.resolve({ status: 'not_found' }),
    createReturn: () => Promise.resolve({ status: 'not_found' }),
    getCashStatus: () => Promise.resolve(OPEN_CASH),
    openCashSession: () => Promise.resolve({ status: 'opened', cash: OPEN_CASH }),
    recordCashMovement: () => Promise.resolve({ status: 'recorded', cash: OPEN_CASH }),
    closeCashSession: () => Promise.resolve({ status: 'no_session' }),
    setWithdrawalLimit: () => Promise.resolve(OPEN_CASH),
    findProductByCode: (code) => Promise.resolve(code === HAMMER_CODE ? HAMMER : null),
    searchProducts: (text) => Promise.resolve(text.startsWith('xyz') ? [] : [HAMMER, CABLE]),
    getAppearance: () => Promise.resolve(DEFAULT_APPEARANCE),
    saveAppearance: () => Promise.resolve(),
    savePendingSale: () => Promise.resolve({ status: 'catalog_changed' }),
    checkoutSale: () => Promise.resolve(COMPLETED),
    reprintLastTicket: () => Promise.resolve({ status: 'no_sales' }),
    listPendingSales: () => Promise.resolve([]),
    confirmPendingSale: () => Promise.resolve(COMPLETED),
    cancelPendingSale: () => Promise.resolve(),
    ...overrides,
  };
}

/** Renders the register and waits for the sign-in gate to let it through, because the person is found out asynchronously. */
async function renderApp(posApi: PosApi): Promise<void> {
  render(<App posApi={posApi} />);
  await screen.findByRole('combobox', { name: 'Buscar producto' });
}

function lookupBox(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('combobox', { name: 'Buscar producto' });
}

function typeText(text: string): void {
  const box = lookupBox();
  box.value = text;
  fireEvent.input(box);
}

function press(key: string): boolean {
  return fireEvent.keyDown(lookupBox(), { key });
}

/** Sends each character as a real keydown, as fast as a scanner would. */
function scan(code: string): void {
  for (const character of code) {
    press(character);
  }
  typeText(code);
  press('Enter');
}

function totalShown(): string | null {
  return screen.getByRole('status', { name: 'Total' }).textContent;
}

function linesShown(): string[] {
  return within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.textContent ?? '');
}

/** Says how much of a measured product to add, in the dialog that opens when it is chosen. */
async function confirmQuantity(text: string): Promise<void> {
  const box = await screen.findByRole('textbox', { name: 'Cantidad', hidden: true });
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: 'Enter' });
}

async function addByCode(): Promise<void> {
  typeText(HAMMER_CODE);
  press('Enter');
  await waitFor(() => expect(totalShown()).not.toBe('$0.00'));
}

describe('App', () => {
  it('shows the version that the bridge reports', async () => {
    await renderApp(fakePosApi());

    expect(await screen.findByText('Versión 1.2.3')).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('warns the cashier when the bridge fails', async () => {
    await renderApp(fakePosApi({ getAppInfo: () => Promise.reject(new Error('channel closed')) }));

    expect((await screen.findByRole('alert')).textContent).toContain('No se pudo leer la versión');
    expect(screen.queryByText(/^Versión/)).toBeNull();
  });

  it('gives the keyboard to the lookup box from the start', async () => {
    await renderApp(fakePosApi());

    await waitFor(() => expect(document.activeElement).toBe(lookupBox()));
  });

  it('takes the keyboard back when something else takes it', async () => {
    await renderApp(fakePosApi());

    lookupBox().blur();

    await waitFor(() => expect(document.activeElement).toBe(lookupBox()));
  });
});

describe('selling', () => {
  it('invites the cashier to start when the sale is empty', async () => {
    await renderApp(fakePosApi());

    expect(screen.getByText('Aún no hay productos en esta venta')).toBeDefined();
    expect(totalShown()).toBe('$0.00');
  });

  it('adds a scanned product, updates the totals, and empties the box', async () => {
    await renderApp(fakePosApi());

    scan(HAMMER_CODE);

    await waitFor(() => expect(linesShown()).toEqual(['Martillo1 pza$116.00$116.00']));
    expect(totalShown()).toBe('$116.00');
    expect(screen.getByText('$100.00')).toBeDefined();
    expect(screen.getByText('IVA 16%')).toBeDefined();
    expect(lookupBox().value).toBe('');
  });

  it('adds one more unit when the same product is scanned again', async () => {
    await renderApp(fakePosApi());

    scan(HAMMER_CODE);
    await waitFor(() => expect(totalShown()).toBe('$116.00'));
    scan(HAMMER_CODE);

    await waitFor(() => expect(linesShown()).toEqual(['Martillo2 pza$116.00$232.00']));
  });

  it('adds a code typed by hand', async () => {
    await renderApp(fakePosApi());

    await addByCode();

    expect(linesShown()).toHaveLength(1);
  });

  it('says so when a scanned code does not exist, and does not search by name', async () => {
    const searchProducts = vi.fn(() => Promise.resolve([HAMMER]));
    await renderApp(fakePosApi({ searchProducts }));

    scan('9999999');

    expect((await screen.findByRole('alert')).textContent).toContain('«9999999»');
    expect(searchProducts).not.toHaveBeenCalled();
    expect(lookupBox().value).toBe('');
  });

  it('never searches by name during a scan', async () => {
    const searchProducts = vi.fn(() => Promise.resolve([HAMMER]));
    await renderApp(fakePosApi({ searchProducts }));

    scan(HAMMER_CODE);
    await waitFor(() => expect(totalShown()).toBe('$116.00'));
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(searchProducts).not.toHaveBeenCalled();
  });

  it('shows matches while typing a name, and Enter adds the first one', async () => {
    await renderApp(fakePosApi());

    typeText('mart');
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]!.getAttribute('aria-selected')).toBe('true');
    expect(lookupBox().getAttribute('aria-activedescendant')).toBe(options[0]!.id);
    press('Enter');

    await waitFor(() => expect(totalShown()).toBe('$116.00'));
    expect(screen.queryByRole('option')).toBeNull();
    expect(lookupBox().value).toBe('');
  });

  it('moves through the matches with the arrows and wraps at the ends', async () => {
    await renderApp(fakePosApi());

    typeText('c');
    await screen.findAllByRole('option');
    press('ArrowDown');
    expect((await screen.findAllByRole('option'))[1]!.getAttribute('aria-selected')).toBe('true');
    press('ArrowDown');
    expect((await screen.findAllByRole('option'))[0]!.getAttribute('aria-selected')).toBe('true');
    press('ArrowUp');
    press('Enter');
    await confirmQuantity('2');

    await waitFor(() => expect(linesShown()[0]).toContain('Cable THW'));
  });

  it('shows the matches first when Enter arrives before they do', async () => {
    await renderApp(fakePosApi());

    typeText('mart');
    press('Enter');

    expect(await screen.findAllByRole('option')).toHaveLength(2);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('adds a match with a click', async () => {
    await renderApp(fakePosApi());

    typeText('cable');
    const options = await screen.findAllByRole('option');
    fireEvent.mouseDown(options[1]!);
    await confirmQuantity('2');

    await waitFor(() => expect(linesShown()[0]).toContain('Cable THW'));
  });

  it('recognizes the next scan after a match is chosen with the mouse', async () => {
    const searchProducts = vi.fn<PosApi['searchProducts']>(() => Promise.resolve([HAMMER, CABLE]));
    await renderApp(fakePosApi({ searchProducts }));
    // A correction marks the text as typed by a person, which must not carry over to the next scan.
    press('Backspace');
    typeText('cable');
    fireEvent.mouseDown((await screen.findAllByRole('option'))[1]!);
    await confirmQuantity('2');
    await waitFor(() => expect(linesShown()).toHaveLength(1));
    searchProducts.mockClear();

    scan('9999999');

    expect((await screen.findByRole('alert')).textContent).toContain('«9999999»');
    expect(searchProducts).not.toHaveBeenCalled();
  });

  it('says so when a name matches nothing', async () => {
    await renderApp(fakePosApi());

    typeText('xyz');
    press('Enter');

    expect((await screen.findByRole('alert')).textContent).toContain('«xyz»');
  });

  it('keeps the list from showing the answer to an older search', async () => {
    let answerFirst: (results: CatalogProduct[]) => void = () => undefined;
    const searchProducts = vi
      .fn<PosApi['searchProducts']>()
      .mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve)))
      .mockImplementationOnce(() => Promise.resolve([CABLE]));
    await renderApp(fakePosApi({ searchProducts }));

    typeText('m');
    await waitFor(() => expect(searchProducts).toHaveBeenCalledTimes(1));
    typeText('ca');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    answerFirst([HAMMER, CABLE]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Cable THW$12.50 / m']);
  });

  it('clears the box and the matches with Esc', async () => {
    await renderApp(fakePosApi());

    typeText('mart');
    await screen.findAllByRole('option');
    press('Escape');

    await waitFor(() => expect(screen.queryByRole('option')).toBeNull());
    expect(lookupBox().value).toBe('');
  });

  it('changes the quantity with + and − when the box is empty', async () => {
    await renderApp(fakePosApi());
    await addByCode();

    press('+');
    await waitFor(() => expect(totalShown()).toBe('$232.00'));
    press('-');

    await waitFor(() => expect(totalShown()).toBe('$116.00'));
  });

  it('lets + and − be typed when there is text in the box', async () => {
    await renderApp(fakePosApi());
    await addByCode();
    typeText('3');

    expect(press('-')).toBe(true);
    expect(totalShown()).toBe('$116.00');
  });

  it('removes the selected line with Supr', async () => {
    await renderApp(fakePosApi());
    await addByCode();

    press('Delete');

    await waitFor(() => expect(totalShown()).toBe('$0.00'));
    expect(screen.getByText('Aún no hay productos en esta venta')).toBeDefined();
  });

  it('warns the cashier when the catalog cannot be read', async () => {
    await renderApp(fakePosApi({ findProductByCode: () => Promise.reject(new Error('closed')) }));

    scan(HAMMER_CODE);

    expect((await screen.findByRole('alert')).textContent).toContain('No se pudo consultar el catálogo');
  });

  it('removes the warning as soon as the cashier types again', async () => {
    await renderApp(fakePosApi());
    scan('9999999');
    await screen.findByRole('alert');

    typeText('m');

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});

describe('products sold by length, weight, or volume (RF-012, E1-08)', () => {
  async function chooseCable(): Promise<void> {
    typeText('cable');
    const options = await screen.findAllByRole('option');
    fireEvent.mouseDown(options[1]!);
    await screen.findByRole('dialog', { name: /¿Cuánto Cable THW\?/, hidden: true });
  }

  function importShown(): string | null {
    return screen.getByRole('status', { name: 'Importe de la línea', hidden: true }).textContent;
  }

  function pressKey(key: string): void {
    fireEvent.keyDown(document.activeElement ?? document.body, { key });
  }

  it('asks how much before adding, and shows what the line costs: 3.275 m at $12.50 is $40.94', async () => {
    await renderApp(fakePosApi());
    await chooseCable();
    expect(totalShown()).toBe('$0.00');

    fireEvent.change(await screen.findByRole('textbox', { name: 'Cantidad', hidden: true }), { target: { value: '3.275' } });
    expect(importShown()).toBe('$40.94');
    pressKey('Enter');

    await waitFor(() => expect(linesShown()).toEqual(['Cable THW3.275 m$12.50$40.94']));
    expect(totalShown()).toBe('$40.94');
  });

  it('adds nothing when the cashier cancels with Esc', async () => {
    await renderApp(fakePosApi());
    await chooseCable();

    pressKey('Escape');

    await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).toBeNull());
    expect(totalShown()).toBe('$0.00');
    await waitFor(() => expect(document.activeElement).toBe(lookupBox()));
  });

  it('adds nothing, and explains, while the quantity is not valid', async () => {
    await renderApp(fakePosApi());
    await chooseCable();
    const box = await screen.findByRole('textbox', { name: 'Cantidad', hidden: true });

    fireEvent.change(box, { target: { value: '3.2755' } });
    pressKey('Enter');

    expect(screen.getByRole('alert', { hidden: true }).textContent).toContain('3 decimales');
    expect(totalShown()).toBe('$0.00');
  });

  it('asks for F2 when the quantity is more than a shop sells at once, so 125 is not taken for 1.25', async () => {
    await renderApp(fakePosApi());
    await chooseCable();
    const box = await screen.findByRole('textbox', { name: 'Cantidad', hidden: true });

    fireEvent.change(box, { target: { value: '125' } });
    pressKey('Enter');
    expect(screen.getByRole('alert', { hidden: true }).textContent).toContain('es mucho');
    expect(totalShown()).toBe('$0.00');
    pressKey('F2');

    await waitFor(() => expect(linesShown()).toEqual(['Cable THW125.000 m$12.50$1,562.50']));
  });

  it('adds the new meters to the line that already has some', async () => {
    await renderApp(fakePosApi());
    await chooseCable();
    await confirmQuantity('1.5');
    await waitFor(() => expect(linesShown()).toHaveLength(1));

    await chooseCable();
    await confirmQuantity('2.25');

    await waitFor(() => expect(linesShown()).toEqual(['Cable THW3.750 m$12.50$46.88']));
  });

  it('does not let the Enter that ends a barcode scan add a line', async () => {
    await renderApp(fakePosApi());
    await chooseCable();
    const box = await screen.findByRole('textbox', { name: 'Cantidad', hidden: true });

    fireEvent.change(box, { target: { value: HAMMER_CODE } });
    pressKey('Enter');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(totalShown()).toBe('$0.00');
  });

  it('adds pieces at once, without asking', async () => {
    await renderApp(fakePosApi());

    await addByCode();

    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
    expect(linesShown()).toEqual(['Martillo1 pza$116.00$116.00']);
  });
});

describe('pending sales', () => {
  const OLDER: PendingSale = {
    id: 'older-sale',
    occurredAt: '2026-11-08T20:05:00.000Z',
    totalCents: 15694,
    lines: [
      { productName: 'Cable THW', quantity: { milli: 3275, unit: 'meter' }, unitPriceE4: 125_000, totalCents: 4094 },
      { productName: 'Martillo', quantity: { milli: 1000, unit: 'piece' }, unitPriceE4: 1_160_000, totalCents: 11600 },
    ],
  };
  const NEWER: PendingSale = {
    id: 'newer-sale',
    occurredAt: '2026-11-08T21:00:00.000Z',
    totalCents: 11600,
    lines: [{ productName: 'Martillo', quantity: { milli: 1000, unit: 'piece' }, unitPriceE4: 1_160_000, totalCents: 11600 }],
  };

  function withPending(...sales: PendingSale[]): Pick<PosApi, 'listPendingSales'> {
    return { listPendingSales: () => Promise.resolve(sales) };
  }

  function findDialog(): Promise<HTMLElement> {
    return screen.findByRole('dialog', { name: '¿Se cobró esta venta?', hidden: true });
  }

  function dialogGone(): Promise<void> {
    return waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).toBeNull());
  }

  function pressKey(key: string): void {
    fireEvent.keyDown(document.activeElement ?? document.body, { key });
  }

  it('does not interrupt the cashier when nothing was left pending', async () => {
    const listPendingSales = vi.fn(() => Promise.resolve([]));
    await renderApp(fakePosApi({ listPendingSales }));

    await waitFor(() => expect(listPendingSales).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
    expect(document.activeElement).toBe(lookupBox());
  });

  it('shows a sale left pending as soon as the register starts, with what is needed to recognize it', async () => {
    await renderApp(fakePosApi(withPending(OLDER)));

    const dialog = await findDialog();

    const text = dialog.textContent ?? '';
    expect(text).toContain('Cable THW');
    expect(text).toContain('3.275 m');
    expect(text).toContain('$40.94');
    expect(text).toContain('Martillo');
    expect(text).toContain('1 pza');
    expect(within(dialog).getByRole('status', { name: 'Total de la venta pendiente', hidden: true }).textContent).toBe('$156.94');
    expect(text).toContain('2026');
    expect(text).toContain('No cuenta en existencias ni en el corte');
  });

  function typeInto(name: string, value: string): void {
    fireEvent.change(screen.getByRole('textbox', { name, hidden: true }), { target: { value } });
  }

  /** F2 asks how it was paid, and then the cashier says it was $156.94 in cash. */
  async function confirmInCash(dialog: HTMLElement): Promise<void> {
    pressKey('F2');
    await within(dialog).findByRole('heading', { name: '¿Con qué se pagó?', hidden: true });
    typeInto('Efectivo recibido', '156.94');
    pressKey('F2');
  }

  it('asks how the sale was paid when the cashier says it was, and records that', async () => {
    const confirmPendingSale = vi.fn<PosApi['confirmPendingSale']>(() => Promise.resolve(COMPLETED));
    await renderApp(fakePosApi({ ...withPending(OLDER), confirmPendingSale }));
    const dialog = await findDialog();

    await confirmInCash(dialog);

    await dialogGone();
    expect(confirmPendingSale).toHaveBeenCalledExactlyOnceWith({ saleId: 'older-sale', cashReceivedCents: 15694, transfers: [] });
    await waitFor(() => expect(document.activeElement).toBe(lookupBox()));
  });

  it('records a transfer with its reference when the sale was paid that way', async () => {
    const confirmPendingSale = vi.fn<PosApi['confirmPendingSale']>(() => Promise.resolve(COMPLETED));
    await renderApp(fakePosApi({ ...withPending(OLDER), confirmPendingSale }));
    const dialog = await findDialog();

    pressKey('F2');
    await within(dialog).findByRole('heading', { name: '¿Con qué se pagó?', hidden: true });
    typeInto('Efectivo recibido', '56.94');
    typeInto('Transferencia', '100');
    typeInto('Referencia de la transferencia', 'SPEI-778812');
    pressKey('F2');

    await dialogGone();
    expect(confirmPendingSale).toHaveBeenCalledExactlyOnceWith({
      saleId: 'older-sale',
      cashReceivedCents: 5694,
      transfers: [{ amountCents: 10000, reference: 'SPEI-778812' }],
    });
  });

  it('does not record a payment that does not reach the total', async () => {
    const confirmPendingSale = vi.fn<PosApi['confirmPendingSale']>(() => Promise.resolve(COMPLETED));
    await renderApp(fakePosApi({ ...withPending(OLDER), confirmPendingSale }));
    const dialog = await findDialog();

    pressKey('F2');
    await within(dialog).findByRole('heading', { name: '¿Con qué se pagó?', hidden: true });
    typeInto('Efectivo recibido', '100');
    pressKey('F2');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(confirmPendingSale).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('status', { name: 'Estado del cobro', hidden: true }).textContent).toBe('Faltan $56.94');
  });

  it('goes back to the question with Esc, without answering', async () => {
    const cancelPendingSale = vi.fn(() => Promise.resolve());
    await renderApp(fakePosApi({ ...withPending(OLDER), cancelPendingSale }));
    const dialog = await findDialog();

    pressKey('F2');
    await within(dialog).findByRole('heading', { name: '¿Con qué se pagó?', hidden: true });
    pressKey('Escape');

    await waitFor(() => expect(within(dialog).queryByRole('heading', { name: '¿Con qué se pagó?', hidden: true })).toBeNull());
    expect(dialog.isConnected).toBe(true);
    expect(cancelPendingSale).not.toHaveBeenCalled();
  });

  it('cancels the sale with F4', async () => {
    const cancelPendingSale = vi.fn(() => Promise.resolve());
    const confirmPendingSale = vi.fn<PosApi['confirmPendingSale']>(() => Promise.resolve(COMPLETED));
    await renderApp(fakePosApi({ ...withPending(OLDER), cancelPendingSale, confirmPendingSale }));
    await findDialog();

    pressKey('F4');

    await dialogGone();
    expect(cancelPendingSale).toHaveBeenCalledExactlyOnceWith('older-sale');
    expect(confirmPendingSale).not.toHaveBeenCalled();
  });

  it('answers with the buttons too', async () => {
    const cancelPendingSale = vi.fn(() => Promise.resolve());
    await renderApp(fakePosApi({ ...withPending(OLDER), cancelPendingSale }));
    const dialog = await findDialog();

    fireEvent.click(within(dialog).getByRole('button', { name: /No se cobró, cancelar venta/, hidden: true }));

    await dialogGone();
    expect(cancelPendingSale).toHaveBeenCalledExactlyOnceWith('older-sale');
  });

  it('goes through several sales one at a time, oldest first', async () => {
    const confirmPendingSale = vi.fn<PosApi['confirmPendingSale']>(() => Promise.resolve(COMPLETED));
    const cancelPendingSale = vi.fn(() => Promise.resolve());
    await renderApp(fakePosApi({ ...withPending(OLDER, NEWER), confirmPendingSale, cancelPendingSale }));
    const dialog = await findDialog();
    expect(dialog.textContent).toContain('Cable THW');
    expect(dialog.textContent).toContain('Quedan 2 ventas por revisar');

    await confirmInCash(dialog);

    await waitFor(() => expect(dialog.textContent).not.toContain('Cable THW'));
    expect(dialog.textContent).not.toContain('por revisar');
    expect(within(dialog).queryByRole('heading', { name: '¿Con qué se pagó?', hidden: true })).toBeNull();
    pressKey('F4');
    await dialogGone();
    expect(confirmPendingSale).toHaveBeenCalledExactlyOnceWith({ saleId: 'older-sale', cashReceivedCents: 15694, transfers: [] });
    expect(cancelPendingSale).toHaveBeenCalledExactlyOnceWith('newer-sale');
  });

  it('does not take the Enter of a scanner for an answer', async () => {
    const confirmPendingSale = vi.fn<PosApi['confirmPendingSale']>(() => Promise.resolve(COMPLETED));
    const cancelPendingSale = vi.fn(() => Promise.resolve());
    await renderApp(fakePosApi({ ...withPending(OLDER), confirmPendingSale, cancelPendingSale }));
    const dialog = await findDialog();

    await waitFor(() => expect(document.activeElement).toHaveProperty('tagName', 'SECTION'));
    pressKey('2');
    pressKey('Enter');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(confirmPendingSale).not.toHaveBeenCalled();
    expect(cancelPendingSale).not.toHaveBeenCalled();
    expect(dialog.isConnected).toBe(true);
  });

  it('does not take the Enter of a scanner for a payment either', async () => {
    const confirmPendingSale = vi.fn<PosApi['confirmPendingSale']>(() => Promise.resolve(COMPLETED));
    await renderApp(fakePosApi({ ...withPending(OLDER), confirmPendingSale }));
    const dialog = await findDialog();

    pressKey('F2');
    await within(dialog).findByRole('heading', { name: '¿Con qué se pagó?', hidden: true });
    typeInto('Efectivo recibido', '156.94');
    pressKey('Enter');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(confirmPendingSale).not.toHaveBeenCalled();
  });

  it('takes the keyboard off the button that was clicked, before the next sale appears', async () => {
    await renderApp(fakePosApi(withPending(OLDER, NEWER)));
    const dialog = await findDialog();
    const button = within(dialog).getByRole('button', { name: /No se cobró, cancelar venta/, hidden: true });
    button.focus();

    fireEvent.click(button);

    await waitFor(() => expect(dialog.textContent).not.toContain('Cable THW'));
    expect(document.activeElement).toHaveProperty('tagName', 'SECTION');
  });

  it('ignores a second key while the first answer is being saved', async () => {
    let finishSaving: () => void = () => undefined;
    const cancelPendingSale = vi.fn(() => new Promise<void>((resolve) => (finishSaving = resolve)));
    await renderApp(fakePosApi({ ...withPending(OLDER, NEWER), cancelPendingSale }));
    await findDialog();

    pressKey('F4');
    pressKey('F4');
    finishSaving();

    await waitFor(() => expect(screen.getByRole('dialog', { hidden: true }).textContent).not.toContain('Cable THW'));
    expect(cancelPendingSale).toHaveBeenCalledTimes(1);
  });

  it('keeps the sale on the screen and explains when the answer cannot be saved', async () => {
    const confirmPendingSale = vi
      .fn<PosApi['confirmPendingSale']>()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce(COMPLETED);
    await renderApp(fakePosApi({ ...withPending(OLDER), confirmPendingSale }));
    const dialog = await findDialog();

    await confirmInCash(dialog);

    expect((await within(dialog).findByRole('alert', { hidden: true })).textContent).toContain('No se guardó tu respuesta');
    expect(dialog.textContent).toContain('Cable THW');
    pressKey('F2');
    await dialogGone();
    expect(confirmPendingSale).toHaveBeenCalledTimes(2);
  });

  it('asks the browser not to close the question with Esc', async () => {
    await renderApp(fakePosApi(withPending(OLDER)));

    expect((await findDialog()).getAttribute('closedby')).toBe('none');
  });

  it('warns the cashier when the pending sales cannot be read, and goes on selling', async () => {
    await renderApp(fakePosApi({ listPendingSales: () => Promise.reject(new Error('closed')) }));

    expect((await screen.findByRole('alert')).textContent).toContain('No se pudieron revisar las ventas pendientes');
    expect(document.activeElement).toBe(lookupBox());
  });
});

describe('checkout', () => {
  const SAVED: PendingSale = {
    id: 'saved-sale',
    occurredAt: '2026-11-08T20:05:00.000Z',
    totalCents: 11600,
    lines: [{ productName: 'Martillo', quantity: { milli: 1000, unit: 'piece' }, unitPriceE4: 1_160_000, totalCents: 11600 }],
  };

  function posApiThatSaves(overrides: Partial<PosApi> = {}): PosApi {
    return fakePosApi({ savePendingSale: () => Promise.resolve({ status: 'saved', sale: SAVED }), ...overrides });
  }

  async function openCheckout(): Promise<HTMLElement> {
    await addByCode();
    press('F12');
    const dialog = await screen.findByRole('dialog', { name: 'Cobrar', hidden: true });
    // The form is drawn once the dialog is open, so the keys only work from here on.
    await screen.findByRole('textbox', { name: 'Efectivo recibido', hidden: true });
    return dialog;
  }

  function typeInto(name: string, value: string): void {
    fireEvent.change(screen.getByRole('textbox', { name, hidden: true }), { target: { value } });
  }

  function pressKey(key: string): void {
    fireEvent.keyDown(document.activeElement ?? document.body, { key });
  }

  function status(): string | null {
    return screen.getByRole('status', { name: 'Estado del cobro', hidden: true }).textContent;
  }

  it('asks the cashier to add a product before charging an empty sale', async () => {
    const savePendingSale = vi.fn<PosApi['savePendingSale']>();
    await renderApp(fakePosApi({ savePendingSale }));

    press('F12');

    expect((await screen.findByRole('alert')).textContent).toContain('Agrega al menos un producto');
    expect(savePendingSale).not.toHaveBeenCalled();
  });

  it('saves the sale with a fresh key before the payment screen opens (ADR 0010)', async () => {
    const savePendingSale = vi.fn<PosApi['savePendingSale']>(() => Promise.resolve({ status: 'saved', sale: SAVED }));
    await renderApp(fakePosApi({ savePendingSale }));

    const dialog = await openCheckout();

    expect(savePendingSale).toHaveBeenCalledExactlyOnceWith({
      idempotencyKey: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      lines: [{ productId: 'hammer', quantityMilli: 1000 }],
      expectedTotalCents: 11600,
    });
    expect(within(dialog).getByRole('status', { name: 'Total a cobrar', hidden: true }).textContent).toBe('$116.00');
  });

  it('tells the cashier when the catalog changed, and charges nothing', async () => {
    const checkoutSale = vi.fn<PosApi['checkoutSale']>();
    await renderApp(fakePosApi({ checkoutSale }));
    await addByCode();

    press('F12');

    expect((await screen.findByRole('alert')).textContent).toContain('El catálogo cambió');
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
    expect(checkoutSale).not.toHaveBeenCalled();
    expect(totalShown()).toBe('$116.00');
  });

  it('says so when the sale cannot be saved', async () => {
    await renderApp(fakePosApi({ savePendingSale: () => Promise.reject(new Error('disk full')) }));
    await addByCode();

    press('F12');

    expect((await screen.findByRole('alert')).textContent).toContain('No se pudo guardar la venta');
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
  });

  it('shows the change while the cashier types the cash, and collects with F2 (RF-014)', async () => {
    const checkoutSale = vi.fn<PosApi['checkoutSale']>(() => Promise.resolve({ status: 'completed', folio: 'T1-000001', changeCents: 8400, problems: [] }));
    await renderApp(posApiThatSaves({ checkoutSale }));
    const dialog = await openCheckout();
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Efectivo recibido'));

    expect(status()).toBe('Faltan $116.00');
    typeInto('Efectivo recibido', '$200');
    expect(status()).toBe('Cambio $84.00');
    pressKey('F2');

    expect((await within(dialog).findByRole('status', { name: 'Cambio a entregar', hidden: true })).textContent).toBe(
      'Entrega $84.00 de cambio',
    );
    expect(checkoutSale).toHaveBeenCalledExactlyOnceWith({ saleId: 'saved-sale', cashReceivedCents: 20000, transfers: [] });
  });

  it('starts a new sale when the cashier has seen the change', async () => {
    await renderApp(posApiThatSaves({ checkoutSale: () => Promise.resolve({ status: 'completed', folio: 'T1-000001', changeCents: 8400, problems: [] }) }));
    await openCheckout();
    typeInto('Efectivo recibido', '200');
    pressKey('F2');
    await screen.findByRole('status', { name: 'Cambio a entregar', hidden: true });

    pressKey('Enter');

    await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).toBeNull());
    expect(totalShown()).toBe('$0.00');
    expect(screen.getByText('Aún no hay productos en esta venta')).toBeDefined();
    await waitFor(() => expect(document.activeElement).toBe(lookupBox()));
  });

  it('records cash and a transfer with its reference as two parts of one sale (RF-015)', async () => {
    const checkoutSale = vi.fn<PosApi['checkoutSale']>(() => Promise.resolve(COMPLETED));
    await renderApp(posApiThatSaves({ checkoutSale }));
    await openCheckout();

    typeInto('Efectivo recibido', '76');
    typeInto('Transferencia', '40');
    expect(status()).toBe('Escribe la referencia de la transferencia.');
    typeInto('Referencia de la transferencia', ' SPEI-778812 ');
    expect(status()).toBe('Pago exacto');
    pressKey('F2');

    await waitFor(() => expect(checkoutSale).toHaveBeenCalledTimes(1));
    expect(checkoutSale).toHaveBeenCalledWith({
      saleId: 'saved-sale',
      cashReceivedCents: 7600,
      transfers: [{ amountCents: 4000, reference: 'SPEI-778812' }],
    });
  });

  it('records the card typed on the standalone terminal with its folio (RF-016)', async () => {
    const checkoutSale = vi.fn<PosApi['checkoutSale']>(() => Promise.resolve(COMPLETED));
    await renderApp(posApiThatSaves({ checkoutSale }));
    await openCheckout();

    typeInto('Efectivo recibido', '16');
    pressKey('F7');
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Tarjeta', hidden: true }).value).toBe('100');
    expect(status()).toBe('Escribe el folio que dio la terminal de tarjeta.');
    typeInto('Folio de la terminal', ' A48291 ');
    expect(status()).toBe('Pago exacto');
    pressKey('F2');

    await waitFor(() => expect(checkoutSale).toHaveBeenCalledTimes(1));
    expect(checkoutSale).toHaveBeenCalledWith({
      saleId: 'saved-sale',
      cashReceivedCents: 1600,
      transfers: [],
      cards: [{ amountCents: 10000, reference: 'A48291' }],
    });
  });

  it('refuses a folio that looks like a card number, and never sends it', async () => {
    const checkoutSale = vi.fn<PosApi['checkoutSale']>(() => Promise.resolve(COMPLETED));
    await renderApp(posApiThatSaves({ checkoutSale }));
    await openCheckout();

    typeInto('Tarjeta', '116');
    typeInto('Folio de la terminal', ['4111', '1111', '1111', '1111'].join(' '));
    pressKey('F2');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(status()).toContain('número de tarjeta');
    expect(checkoutSale).not.toHaveBeenCalled();
  });

  it('does not send a cards list when the sale was not paid with a card', async () => {
    const checkoutSale = vi.fn<PosApi['checkoutSale']>(() => Promise.resolve(COMPLETED));
    await renderApp(posApiThatSaves({ checkoutSale }));
    await openCheckout();
    typeInto('Efectivo recibido', '116');

    pressKey('F2');

    await waitFor(() => expect(checkoutSale).toHaveBeenCalledTimes(1));
    expect(checkoutSale.mock.calls[0]![0]).not.toHaveProperty('cards');
  });

  it('fills the cash that is missing with F5, and the transfer that is missing with F6', async () => {
    await renderApp(posApiThatSaves());
    await openCheckout();

    typeInto('Transferencia', '16');
    pressKey('F5');
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Efectivo recibido', hidden: true }).value).toBe('100');
    typeInto('Efectivo recibido', '');
    typeInto('Transferencia', '');
    typeInto('Efectivo recibido', '116.5');
    typeInto('Efectivo recibido', '16');
    pressKey('F6');

    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Transferencia', hidden: true }).value).toBe('100');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Referencia de la transferencia');
  });

  it.each([
    ['cash that does not reach the total', '100', '', 'Faltan $16.00'],
    ['a transfer for more than the total', '', '120', 'No dan cambio'],
    ['cash when the transfer already covers the total', '10', '116', 'Quita el efectivo'],
    ['text that is not an amount', 'cien', '', 'Escribe solo números'],
  ])('does not collect with %s', async (_case, cash, transfer, message) => {
    const checkoutSale = vi.fn<PosApi['checkoutSale']>(() => Promise.resolve(COMPLETED));
    await renderApp(posApiThatSaves({ checkoutSale }));
    await openCheckout();

    typeInto('Efectivo recibido', cash);
    typeInto('Transferencia', transfer);
    typeInto('Referencia de la transferencia', 'SPEI-1');
    pressKey('F2');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(status()).toContain(message);
    expect(checkoutSale).not.toHaveBeenCalled();
  });

  it('does not collect with the Enter of a scanner, which only moves to the next box', async () => {
    const checkoutSale = vi.fn<PosApi['checkoutSale']>(() => Promise.resolve(COMPLETED));
    await renderApp(posApiThatSaves({ checkoutSale }));
    await openCheckout();
    typeInto('Efectivo recibido', '200');

    pressKey('Enter');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(checkoutSale).not.toHaveBeenCalled();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Transferencia');
  });

  it('cancels the saved sale with Esc, and keeps the products on the screen', async () => {
    const cancelPendingSale = vi.fn(() => Promise.resolve());
    await renderApp(posApiThatSaves({ cancelPendingSale }));
    await openCheckout();

    pressKey('Escape');

    await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).toBeNull());
    expect(cancelPendingSale).toHaveBeenCalledExactlyOnceWith('saved-sale');
    expect(totalShown()).toBe('$116.00');
    await waitFor(() => expect(document.activeElement).toBe(lookupBox()));
  });

  it('stays on the payment screen and explains when the sale cannot be cancelled', async () => {
    await renderApp(posApiThatSaves({ cancelPendingSale: () => Promise.reject(new Error('disk full')) }));
    const dialog = await openCheckout();

    pressKey('Escape');

    expect((await within(dialog).findByRole('alert', { hidden: true })).textContent).toContain('No se pudo cancelar la venta');
  });

  it('explains when the payment cannot be recorded, and lets the cashier try again', async () => {
    const checkoutSale = vi
      .fn<PosApi['checkoutSale']>()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce(COMPLETED);
    await renderApp(posApiThatSaves({ checkoutSale }));
    const dialog = await openCheckout();
    typeInto('Efectivo recibido', '116');

    pressKey('F2');
    expect((await within(dialog).findByRole('alert', { hidden: true })).textContent).toContain('No se pudo registrar el cobro');
    pressKey('F2');

    await within(dialog).findByRole('status', { name: 'Cambio a entregar', hidden: true });
    expect(checkoutSale).toHaveBeenCalledTimes(2);
  });

  it('reports a device that failed after the sale was collected, without calling the sale a failure', async () => {
    const result: CheckoutSaleResult = { status: 'completed', folio: 'T1-000001', changeCents: 0, problems: [{ device: 'printer', message: 'Sin papel' }] };
    await renderApp(posApiThatSaves({ checkoutSale: () => Promise.resolve(result) }));
    const dialog = await openCheckout();
    typeInto('Efectivo recibido', '116');

    pressKey('F2');

    expect((await within(dialog).findByRole('alert', { hidden: true })).textContent).toContain('La venta quedó registrada');
    expect(within(dialog).getByRole('status', { name: 'Cambio a entregar', hidden: true }).textContent).toBe('Sin cambio');
  });

  it('sends one collection when F2 is pressed twice', async () => {
    let finish: (result: CheckoutSaleResult) => void = () => undefined;
    const checkoutSale = vi.fn<PosApi['checkoutSale']>(() => new Promise((resolve) => (finish = resolve)));
    await renderApp(posApiThatSaves({ checkoutSale }));
    await openCheckout();
    typeInto('Efectivo recibido', '116');

    pressKey('F2');
    pressKey('F2');
    finish(COMPLETED);

    await screen.findByRole('status', { name: 'Cambio a entregar', hidden: true });
    expect(checkoutSale).toHaveBeenCalledTimes(1);
  });
});

describe('reprinting the last ticket', () => {
  function pressKey(key: string): void {
    fireEvent.keyDown(document.activeElement ?? document.body, { key });
  }

  it('shows the folio when a sale is collected, and reprints it from there with F8', async () => {
    const reprintLastTicket = vi.fn<PosApi['reprintLastTicket']>(() => Promise.resolve({ status: 'printed', folio: 'T1-000001' }));
    const saved: PendingSale = { id: 'saved-sale', occurredAt: '2026-11-08T20:05:00.000Z', totalCents: 11600, lines: [] };
    await renderApp(fakePosApi({ savePendingSale: () => Promise.resolve({ status: 'saved', sale: saved }), reprintLastTicket }));
    await addByCode();
    press('F12');
    await screen.findByRole('textbox', { name: 'Efectivo recibido', hidden: true });
    fireEvent.change(screen.getByRole('textbox', { name: 'Efectivo recibido', hidden: true }), { target: { value: '116' } });
    pressKey('F2');

    const dialog = await screen.findByRole('dialog', { name: 'Venta cobrada', hidden: true });
    expect(dialog.textContent).toContain('Folio T1-000001');
    pressKey('F8');

    await waitFor(() => expect(dialog.textContent).toContain('Ticket T1-000001 reimpreso.'));
    expect(reprintLastTicket).toHaveBeenCalledTimes(1);
  });

  it('reprints from the sale screen with F8', async () => {
    const reprintLastTicket = vi.fn<PosApi['reprintLastTicket']>(() => Promise.resolve({ status: 'printed', folio: 'T1-000007' }));
    await renderApp(fakePosApi({ reprintLastTicket }));

    press('F8');

    expect((await screen.findByText('Ticket T1-000007 reimpreso.')).textContent).toBeDefined();
  });

  it('says so when there is nothing to reprint', async () => {
    await renderApp(fakePosApi());

    press('F8');

    expect(await screen.findByText('Todavía no hay ventas cobradas para reimprimir.')).toBeDefined();
  });

  it('says why when the printer fails, and that the sale is safe', async () => {
    const result = { status: 'printer_failed', folio: 'T1-000003', message: 'Sin papel' } as const;
    await renderApp(fakePosApi({ reprintLastTicket: () => Promise.resolve(result) }));

    press('F8');

    const message = await screen.findByText(/No se pudo imprimir el ticket T1-000003/);
    expect(message.textContent).toContain('Sin papel');
    expect(message.textContent).toContain('La venta quedó registrada');
  });

  it('says so when the register cannot even ask', async () => {
    await renderApp(fakePosApi({ reprintLastTicket: () => Promise.reject(new Error('closed')) }));

    press('F8');

    expect(await screen.findByText(/No se pudo reimprimir el ticket/)).toBeDefined();
  });
});

describe('signing in (E1-04)', () => {
  const ANA: UserSummary = { id: '019a5f2e-7c41-7b1a-9d2e-3f4a5b6c7d8f', name: 'Ana', role: 'cashier' };

  function signedOut(users: UserSummary[] = [OWNER, ANA]): Pick<PosApi, 'getAuthState'> {
    return { getAuthState: () => Promise.resolve({ needsSetup: false, users, current: null }) };
  }

  function pinBox(): HTMLInputElement {
    return screen.getByLabelText<HTMLInputElement>('PIN');
  }

  function typePin(value: string): void {
    fireEvent.change(pinBox(), { target: { value } });
    fireEvent.submit(pinBox().closest('form')!);
  }

  it('asks who is charging, and sells nothing until somebody enters', async () => {
    render(<App posApi={fakePosApi(signedOut())} />);

    expect(await screen.findByRole('heading', { name: '¿Quién cobra?' })).toBeDefined();
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('value'))).toEqual([OWNER.id, ANA.id]);
    expect(screen.queryByRole('combobox', { name: 'Buscar producto' })).toBeNull();
    expect(document.activeElement).toBe(pinBox());
  });

  it('signs in the person with their PIN, and shows the register with their name', async () => {
    const login = vi.fn<PosApi['login']>(() => Promise.resolve({ status: 'ok', user: ANA }));
    let signedIn = false;
    const getAuthState = (): ReturnType<PosApi['getAuthState']> =>
      Promise.resolve({ needsSetup: false, users: [OWNER, ANA], current: signedIn ? ANA : null });
    render(<App posApi={fakePosApi({ getAuthState, login: (request) => ((signedIn = true), login(request)) })} />);
    await screen.findByRole('heading', { name: '¿Quién cobra?' });

    fireEvent.click(screen.getByRole('radio', { name: /Ana/ }));
    typePin('5555');

    expect(await screen.findByRole('combobox', { name: 'Buscar producto' })).toBeDefined();
    expect(login).toHaveBeenCalledExactlyOnceWith({ userId: ANA.id, pin: '5555' });
    expect(screen.getByLabelText('Persona en la caja').textContent).toBe('Ana');
  });

  it('changes the person with the arrows', async () => {
    const login = vi.fn<PosApi['login']>(() => Promise.resolve({ status: 'wrong_pin', attemptsLeft: 4 }));
    render(<App posApi={fakePosApi({ ...signedOut(), login })} />);
    await screen.findByRole('heading', { name: '¿Quién cobra?' });

    fireEvent.keyDown(pinBox(), { key: 'ArrowDown' });
    typePin('1111');

    await waitFor(() => expect(login).toHaveBeenCalledWith({ userId: ANA.id, pin: '1111' }));
  });

  it('says how many tries are left after a wrong PIN, and empties the box', async () => {
    render(<App posApi={fakePosApi({ ...signedOut(), login: () => Promise.resolve({ status: 'wrong_pin', attemptsLeft: 2 }) })} />);
    await screen.findByRole('heading', { name: '¿Quién cobra?' });

    typePin('1111');

    expect((await screen.findByRole('alert')).textContent).toContain('Te quedan 2 intentos');
    expect(pinBox().value).toBe('');
  });

  it('says when the person is locked, and until when', async () => {
    render(<App posApi={fakePosApi({ ...signedOut(), login: () => Promise.resolve({ status: 'locked', until: '2026-11-08T20:05:00.000Z' }) })} />);
    await screen.findByRole('heading', { name: '¿Quién cobra?' });

    typePin('4321');

    expect((await screen.findByRole('alert')).textContent).toContain('Demasiados intentos');
  });

  it('only lets numbers into the PIN box', async () => {
    render(<App posApi={fakePosApi(signedOut())} />);
    await screen.findByRole('heading', { name: '¿Quién cobra?' });

    fireEvent.change(pinBox(), { target: { value: '12ab 34' } });

    expect(pinBox().value).toBe('1234');
  });

  it('makes the first person the owner, after checking that both PINs match', async () => {
    const setupOwner = vi.fn<PosApi['setupOwner']>(() => Promise.resolve(OWNER));
    render(<App posApi={fakePosApi({ getAuthState: () => Promise.resolve({ needsSetup: true, users: [], current: null }), setupOwner })} />);
    await screen.findByRole('heading', { name: 'Bienvenido' });

    fireEvent.change(screen.getByLabelText('Tu nombre'), { target: { value: ' Mauricio ' } });
    fireEvent.change(screen.getByLabelText('Elige un PIN'), { target: { value: '4321' } });
    fireEvent.change(screen.getByLabelText('Repite el PIN'), { target: { value: '4322' } });
    fireEvent.submit(screen.getByLabelText('Tu nombre').closest('form')!);

    expect((await screen.findByRole('alert')).textContent).toContain('no son iguales');
    expect(setupOwner).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Repite el PIN'), { target: { value: '4321' } });
    fireEvent.submit(screen.getByLabelText('Tu nombre').closest('form')!);

    await waitFor(() => expect(setupOwner).toHaveBeenCalledExactlyOnceWith({ name: 'Mauricio', pin: '4321' }));
  });

  it('refuses a PIN that is too short when creating the owner', async () => {
    const setupOwner = vi.fn<PosApi['setupOwner']>(() => Promise.resolve(OWNER));
    render(<App posApi={fakePosApi({ getAuthState: () => Promise.resolve({ needsSetup: true, users: [], current: null }), setupOwner })} />);
    await screen.findByRole('heading', { name: 'Bienvenido' });

    fireEvent.change(screen.getByLabelText('Tu nombre'), { target: { value: 'Mauricio' } });
    fireEvent.change(screen.getByLabelText('Elige un PIN'), { target: { value: '12' } });
    fireEvent.submit(screen.getByLabelText('Tu nombre').closest('form')!);

    expect((await screen.findByRole('alert')).textContent).toContain('de 4 a 8 números');
    expect(setupOwner).not.toHaveBeenCalled();
  });

  it('signs out with F6 and goes back to the sign-in', async () => {
    let signedIn = true;
    const logout = vi.fn(() => ((signedIn = false), Promise.resolve()));
    const getAuthState = (): ReturnType<PosApi['getAuthState']> =>
      Promise.resolve({ needsSetup: false, users: [OWNER], current: signedIn ? OWNER : null });
    await renderApp(fakePosApi({ getAuthState, logout }));

    press('F6');

    expect(await screen.findByRole('heading', { name: '¿Quién cobra?' })).toBeDefined();
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('shows the appearance only to the owner', async () => {
    const cashier = { getAuthState: () => Promise.resolve({ needsSetup: false, users: [ANA], current: ANA }) };
    await renderApp(fakePosApi(cashier));

    press('F9');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
    expect(screen.queryByRole('button', { name: /Apariencia/ })).toBeNull();
  });
});

describe('the cash of the register (E1-21, E1-22, E1-23)', () => {
  const CASHIER: UserSummary = { id: '019a5f2e-7c41-7b1a-9d2e-3f4a5b6c7d8f', name: 'Ana', role: 'cashier' };

  function typeInto(name: string, value: string): void {
    fireEvent.change(screen.getByRole('textbox', { name, hidden: true }), { target: { value } });
  }

  function pressKey(key: string): void {
    fireEvent.keyDown(document.activeElement ?? document.body, { key });
  }

  async function openCashDialog(title: string): Promise<HTMLElement> {
    press('F3');
    return screen.findByRole('dialog', { name: title, hidden: true });
  }

  it('shows how to open the register when it is closed, and opens it with the float (RF-024)', async () => {
    const openCashSession = vi.fn<PosApi['openCashSession']>(() => Promise.resolve({ status: 'opened', cash: OPEN_CASH }));
    render(<App posApi={fakePosApi({ getCashStatus: () => Promise.resolve(CLOSED_CASH), openCashSession })} />);
    await screen.findByRole('dialog', { name: 'Abrir la caja', hidden: true });

    typeInto('Fondo de caja', '500');
    pressKey('F2');

    await waitFor(() => expect(openCashSession).toHaveBeenCalledExactlyOnceWith({ floatCents: 50000 }));
    await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).toBeNull());
    expect(screen.getByLabelText('Estado de la caja').textContent).toBe('Caja abierta');
  });

  it('refuses a float that is not an amount', async () => {
    const openCashSession = vi.fn<PosApi['openCashSession']>();
    render(<App posApi={fakePosApi({ getCashStatus: () => Promise.resolve(CLOSED_CASH), openCashSession })} />);
    await screen.findByRole('dialog', { name: 'Abrir la caja', hidden: true });

    typeInto('Fondo de caja', 'mucho');
    pressKey('F2');

    expect((await screen.findByRole('alert', { hidden: true })).textContent).toContain('Escribe solo números');
    expect(openCashSession).not.toHaveBeenCalled();
  });

  it('opens the cash dialog when a sale is started with the register closed', async () => {
    await renderApp(fakePosApi({ savePendingSale: () => Promise.resolve({ status: 'no_cash_session' }) }));
    await addByCode();

    press('F12');

    expect((await screen.findByRole('alert')).textContent).toContain('La caja está cerrada');
  });

  it('warns about withdrawing cash without stopping the sale (RF-026)', async () => {
    await renderApp(fakePosApi({ getCashStatus: () => Promise.resolve({ ...OPEN_CASH, shouldWithdraw: true }) }));

    expect((await screen.findByText(/Hay mucho efectivo en el cajón/)).textContent).toContain('Puedes seguir vendiendo');
    await addByCode();
    expect(totalShown()).toBe('$116.00');
  });

  it('shows the owner what the drawer should hold, and does not show it to a cashier', async () => {
    await renderApp(fakePosApi());
    const dialog = await openCashDialog('Caja abierta');
    expect(dialog.textContent).toContain('$600.00');
    cleanup();

    const cashier = { getAuthState: () => Promise.resolve({ needsSetup: false, users: [CASHIER], current: CASHIER }) };
    await renderApp(fakePosApi(cashier));
    const cashierDialog = await openCashDialog('Caja abierta');

    expect(cashierDialog.textContent).not.toContain('$600.00');
  });

  it('records an exit with its reason, and refuses one without it (RF-025)', async () => {
    const recordCashMovement = vi.fn<PosApi['recordCashMovement']>(() => Promise.resolve({ status: 'recorded', cash: OPEN_CASH }));
    await renderApp(fakePosApi({ recordCashMovement }));
    await openCashDialog('Caja abierta');

    pressKey('F6');
    await screen.findByRole('heading', { name: 'Salida de efectivo', hidden: true });
    typeInto('Monto', '350');
    pressKey('F2');
    expect((await screen.findByRole('alert', { hidden: true })).textContent).toContain('Escribe el motivo');
    expect(recordCashMovement).not.toHaveBeenCalled();
    typeInto('Motivo', ' Pago a proveedor ');
    pressKey('F2');

    await waitFor(() => expect(recordCashMovement).toHaveBeenCalledExactlyOnceWith({ kind: 'out', amountCents: 35000, reason: 'Pago a proveedor' }));
  });

  it('asks a cashier for the PIN of an owner to take cash out, and not to put it in', async () => {
    const recordCashMovement = vi.fn<PosApi['recordCashMovement']>(() => Promise.resolve({ status: 'recorded', cash: OPEN_CASH }));
    const cashier = { getAuthState: () => Promise.resolve({ needsSetup: false, users: [CASHIER], current: CASHIER }) };
    await renderApp(fakePosApi({ ...cashier, recordCashMovement }));
    await openCashDialog('Caja abierta');

    pressKey('F6');
    await screen.findByRole('heading', { name: 'Salida de efectivo', hidden: true });
    expect(screen.getByLabelText('PIN del dueño')).toBeDefined();
    typeInto('Monto', '100');
    typeInto('Motivo', 'Gas');
    fireEvent.change(screen.getByLabelText('PIN del dueño'), { target: { value: '4321' } });
    pressKey('F2');

    await waitFor(() => expect(recordCashMovement).toHaveBeenCalledWith({ kind: 'out', amountCents: 10000, reason: 'Gas', ownerPin: '4321' }));
    cleanup();
    await renderApp(fakePosApi(cashier));
    await openCashDialog('Caja abierta');
    pressKey('F5');
    await screen.findByRole('heading', { name: 'Entrada de efectivo', hidden: true });
    expect(screen.queryByLabelText('PIN del dueño')).toBeNull();
  });

  it('asks for a reason when the cut does not balance, and shows the difference of each form of payment (RF-027)', async () => {
    const line = (expectedCents: number, countedCents: number) => ({ expectedCents, countedCents, differenceCents: countedCents - expectedCents });
    const comparison = { cash: line(60000, 54000), card: line(0, 0), transfer: line(0, 0), isBalanced: false };
    const closeCashSession = vi
      .fn<PosApi['closeCashSession']>()
      .mockResolvedValueOnce({ status: 'reason_required', comparison })
      .mockResolvedValueOnce({ status: 'closed', cut: { ...comparison, id: 'cut', cutAt: '2026-11-08T22:00:00.000Z', cutBy: 'Mauricio', reason: 'Se me cayó una moneda' } });
    await renderApp(fakePosApi({ closeCashSession, getCashStatus: vi.fn().mockResolvedValueOnce(OPEN_CASH).mockResolvedValue(CLOSED_CASH) }));
    const dialog = await openCashDialog('Caja abierta');

    pressKey('F7');
    await screen.findByRole('heading', { name: 'Corte de caja', hidden: true });
    typeInto('Billetes de $500', '1');
    typeInto('Billetes de $20', '2');
    pressKey('F2');

    expect((await within(dialog).findByRole('table', { name: 'Diferencias del corte', hidden: true })).textContent).toContain('Faltan $60.00');
    expect(closeCashSession).toHaveBeenCalledWith({ counts: { 50000: 1, 2000: 2 }, cardCountedCents: 0, transferCountedCents: 0, reason: '' });
    typeInto('Motivo de la diferencia', 'Se me cayó una moneda');
    pressKey('F2');

    expect((await screen.findByRole('status', { name: 'Resultado del corte', hidden: true })).textContent).toBe('El corte quedó con diferencia');
  });

  it('tells the cashier to answer the pending sales before the cut', async () => {
    await renderApp(fakePosApi({ closeCashSession: () => Promise.resolve({ status: 'pending_sales', count: 2 }) }));
    await openCashDialog('Caja abierta');

    pressKey('F7');
    await screen.findByRole('heading', { name: 'Corte de caja', hidden: true });
    pressKey('F2');

    expect((await screen.findByRole('alert', { hidden: true })).textContent).toContain('2 venta(s) sin resolver');
  });

  it('lets only the owner change the withdrawal limit', async () => {
    const setWithdrawalLimit = vi.fn<PosApi['setWithdrawalLimit']>(() => Promise.resolve(OPEN_CASH));
    await renderApp(fakePosApi({ setWithdrawalLimit }));
    await openCashDialog('Caja abierta');

    pressKey('F8');
    await screen.findByRole('heading', { name: 'Aviso de retiro', hidden: true });
    typeInto('Nuevo límite', '8000');
    pressKey('F2');

    await waitFor(() => expect(setWithdrawalLimit).toHaveBeenCalledExactlyOnceWith({ limitCents: 800_000 }));
  });
});

describe('returns (E1-15)', () => {
  const CASHIER: UserSummary = { id: '019a5f2e-7c41-7b1a-9d2e-3f4a5b6c7d8f', name: 'Ana', role: 'cashier' };
  const SALE: ReturnableSale = {
    saleId: '019a5f2e-7c42-7b1a-9d2e-3f4a5b6c7d80',
    folio: 'T1-000123',
    completedAt: '2026-11-08T20:05:00.000Z',
    totalCents: 23200,
    daysOld: 10,
    lines: [
      { saleLineId: '019a5f2e-7c43-7b1a-9d2e-3f4a5b6c7d81', productName: 'Martillo', unit: 'piece', soldMilli: 2000, returnedMilli: 0, returnableMilli: 2000, unitPriceE4: 1_160_000, lineTotalCents: 23200, refundedCents: 0 },
    ],
    parts: [
      { method: 'cash', reference: null, remainingCents: 19200 },
      { method: 'transfer', reference: 'SPEI-778812', remainingCents: 4000 },
    ],
    violations: [],
  };

  function typeInto(name: string, value: string): void {
    fireEvent.change(screen.getByRole('textbox', { name, hidden: true }), { target: { value } });
  }

  function pressKey(key: string): void {
    fireEvent.keyDown(document.activeElement ?? document.body, { key });
  }

  async function openFound(overrides: Partial<PosApi> = {}, sale: ReturnableSale = SALE): Promise<void> {
    await renderApp(fakePosApi({ findReturnableSale: () => Promise.resolve({ status: 'found', sale }), ...overrides }));
    press('F4');
    await screen.findByRole('heading', { name: 'Devolución', hidden: true });
    typeInto('Folio del ticket', 'T1-000123');
    pressKey('Enter');
    await screen.findByRole('heading', { name: 'Devolución del ticket T1-000123', hidden: true });
  }

  it('looks the sale up by the folio, and says so when there is none', async () => {
    const findReturnableSale = vi.fn<PosApi['findReturnableSale']>(() => Promise.resolve({ status: 'not_found' }));
    await renderApp(fakePosApi({ findReturnableSale }));
    press('F4');
    await screen.findByRole('heading', { name: 'Devolución', hidden: true });

    typeInto('Folio del ticket', 't1-000999');
    pressKey('Enter');

    expect((await screen.findByRole('alert', { hidden: true })).textContent).toContain('No hay ninguna venta cobrada');
    expect(findReturnableSale).toHaveBeenCalledExactlyOnceWith('t1-000999');
  });

  it('shows what is given back by each means before the owner confirms, and then gives the cash to hand over', async () => {
    const createReturn = vi.fn<PosApi['createReturn']>(() =>
      Promise.resolve({ status: 'returned', returnId: 'r1', totalCents: 23200, refunds: [{ method: 'cash', reference: null, amountCents: 19200 }, { method: 'transfer', reference: 'SPEI-778812', amountCents: 4000 }] }),
    );
    await openFound({ createReturn });

    pressKey('F5');
    expect(screen.getByRole('status', { name: 'Lo que se regresa', hidden: true }).textContent).toContain('Se regresan $232.00: Efectivo $192.00 y Transferencia $40.00');
    typeInto('Motivo de la devolución', ' No era el modelo ');
    pressKey('F2');

    expect((await screen.findByRole('status', { name: 'Lo que se entrega', hidden: true })).textContent).toBe('Entrega $192.00 en efectivo');
    expect(createReturn).toHaveBeenCalledExactlyOnceWith({ saleId: SALE.saleId, lines: [{ saleLineId: SALE.lines[0]!.saleLineId, quantityMilli: 2000 }], reason: 'No era el modelo' });
  });

  it('returns only part of a line, and never lets more than was sold be typed', async () => {
    const createReturn = vi.fn<PosApi['createReturn']>(() => Promise.resolve({ status: 'exceeds_sold' }));
    await openFound({ createReturn });

    fireEvent.change(screen.getByLabelText('Devuelve de Martillo'), { target: { value: '3' } });
    typeInto('Motivo de la devolución', 'x');
    pressKey('F2');
    expect((await screen.findByRole('alert', { hidden: true })).textContent).toContain('Revisa las cantidades');
    expect(createReturn).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Devuelve de Martillo'), { target: { value: '1' } });

    expect(screen.getByRole('status', { name: 'Lo que se regresa', hidden: true }).textContent).toContain('$116.00');
  });

  it('asks for a reason, and does not send the return without one', async () => {
    const createReturn = vi.fn<PosApi['createReturn']>();
    await openFound({ createReturn });

    pressKey('F5');
    pressKey('F2');

    expect((await screen.findByRole('alert', { hidden: true })).textContent).toContain('Escribe el motivo');
    expect(createReturn).not.toHaveBeenCalled();
  });

  it('asks a cashier for the PIN of the owner, and sends it with the return', async () => {
    const createReturn = vi.fn<PosApi['createReturn']>(() => Promise.resolve({ status: 'wrong_pin', attemptsLeft: 4 }));
    await openFound({ createReturn, getAuthState: () => Promise.resolve({ needsSetup: false, users: [CASHIER], current: CASHIER }) });

    pressKey('F5');
    typeInto('Motivo de la devolución', 'x');
    fireEvent.change(screen.getByLabelText('PIN del dueño'), { target: { value: '4321' } });
    pressKey('F2');

    await waitFor(() => expect(createReturn).toHaveBeenCalledWith(expect.objectContaining({ ownerPin: '4321' })));
    expect((await screen.findByRole('alert', { hidden: true })).textContent).toContain('PIN del dueño incorrecto');
  });

  it('warns that a rule is broken, and only sends the exception when the owner is said to allow it (RF-019)', async () => {
    const createReturn = vi.fn<PosApi['createReturn']>(() => Promise.resolve({ status: 'needs_override', violations: ['older_than_window'] }));
    await openFound({ createReturn }, { ...SALE, daysOld: 45, violations: ['older_than_window'] });

    expect(screen.getByRole('alert', { hidden: true }).textContent).toContain('tiene más de 30 días');
    pressKey('F5');
    typeInto('Motivo de la devolución', 'x');
    pressKey('F2');
    await waitFor(() => expect(createReturn).toHaveBeenCalledTimes(1));
    expect(createReturn.mock.calls[0]![0]).not.toHaveProperty('override');
    fireEvent.click(screen.getByRole('checkbox', { hidden: true }));
    pressKey('F2');

    await waitFor(() => expect(createReturn).toHaveBeenCalledTimes(2));
    expect(createReturn.mock.calls[1]![0]).toMatchObject({ override: true });
  });
});

describe('administration (E1-29, E1-35)', () => {
  function pressKey(key: string): void {
    fireEvent.keyDown(document.activeElement ?? document.body, { key });
  }

  async function openAdmin(overrides: Partial<PosApi> = {}): Promise<HTMLElement> {
    await renderApp(fakePosApi(overrides));
    press('F1');
    return screen.findByRole('dialog', { name: 'Administración', hidden: true });
  }

  it('is only for the owner', async () => {
    const cashier = { getAuthState: () => Promise.resolve({ needsSetup: false, users: [], current: { id: 'c', name: 'Ana', role: 'cashier' as const } }) };
    await renderApp(fakePosApi(cashier));

    press('F1');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
    expect(screen.queryByRole('button', { name: /Administración/ })).toBeNull();
  });

  it('warns when there are no backups, because a broken computer would lose the sales', async () => {
    const dialog = await openAdmin();

    expect((await within(dialog).findByRole('alert', { hidden: true })).textContent).toContain('No hay respaldos configurados');
  });

  it('says whether the inventory agrees with the sales, and how many movements do not', async () => {
    const checkLedger = vi
      .fn<PosApi['checkLedger']>()
      .mockResolvedValueOnce({ checkedMovements: 12, problems: [] })
      .mockResolvedValueOnce({ checkedMovements: 12, problems: [{ kind: 'wrong_quantity', sourceId: 'line-1' }] });
    const dialog = await openAdmin({ checkLedger });

    pressKey('F3');
    expect((await within(dialog).findByRole('status', { hidden: true })).textContent).toContain('Todo cuadra: 12 movimientos');

    pressKey('F3');
    expect(await within(dialog).findByText(/1 movimiento\(s\) no cuadran/)).toBeDefined();
  });

  it('opens the report on today and shows the sales, the margin and what ran out', async () => {
    const getDailyReport = vi.fn<PosApi['getDailyReport']>((date) =>
      Promise.resolve({
        date,
        salesCount: 3,
        totalCents: 120_050,
        averageTicketCents: 40_017,
        returnsCount: 1,
        returnsCents: 5000,
        byHour: [{ hour: 9, salesCount: 3, totalCents: 120_050 }],
        byCashier: [{ name: 'Ana', salesCount: 3, totalCents: 120_050 }],
        marginCents: 30_000,
        linesWithoutCost: 2,
        outOfStock: [{ productId: 'p1', name: 'Clavos', unit: 'piece', stockMilli: -2000 }],
        notSelling: [],
      }),
    );
    const dialog = await openAdmin({ getDailyReport });

    pressKey('F4');

    await within(dialog).findByRole('heading', { name: 'Reporte del día', hidden: true });
    await waitFor(() => expect(dialog.textContent).toContain('$1,200.50'));
    expect(dialog.textContent).toContain('2 partida(s) no tienen costo conocido');
    expect(dialog.textContent).toContain('Clavos: −2 pza');
    expect(getDailyReport).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it('registers a loss with its reason and shows the new stock in the history of the product', async () => {
    const hammer = { id: '01900000-0000-7000-8000-000000000001', name: 'Martillo', unit: 'piece' as const, unitPriceE4: 1_000_000, taxRate: { factor: 'rate' as const, rateBp: 1600 } };
    const kardex = (stockMilli: number) => ({ productId: hammer.id, productName: 'Martillo', unit: 'piece' as const, stockMilli, rows: [], totalMovements: 0 });
    const adjustStock = vi.fn<PosApi['adjustStock']>(() => Promise.resolve({ status: 'recorded', kardex: kardex(4000) }));
    const dialog = await openAdmin({ findProductByCode: () => Promise.resolve(hammer), getKardex: () => Promise.resolve(kardex(5000)), adjustStock });

    pressKey('F2');
    fireEvent.change(await within(dialog).findByRole('textbox', { name: 'Producto', hidden: true }), { target: { value: '750100' } });
    fireEvent.submit(within(dialog).getByRole('textbox', { name: 'Producto', hidden: true }));
    await within(dialog).findByRole('heading', { name: 'Martillo', hidden: true });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Cantidad', hidden: true }), { target: { value: '1' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Motivo', hidden: true }), { target: { value: 'Se cayó del estante' } });
    pressKey('F2');

    await waitFor(() => expect(adjustStock).toHaveBeenCalledWith({ productId: hammer.id, type: 'waste', quantityMilli: -1000, reason: 'Se cayó del estante' }));
    expect((await within(dialog).findByRole('status', { hidden: true })).textContent).toContain('Quedó guardado');
    expect(dialog.textContent).toContain('Existencia: 4 pza');
  });

  it('refuses a quantity that is not a number and a reason that is empty, before asking the main process', async () => {
    const hammer = { id: '01900000-0000-7000-8000-000000000001', name: 'Martillo', unit: 'piece' as const, unitPriceE4: 1_000_000, taxRate: { factor: 'rate' as const, rateBp: 1600 } };
    const adjustStock = vi.fn<PosApi['adjustStock']>();
    const dialog = await openAdmin({
      findProductByCode: () => Promise.resolve(hammer),
      getKardex: () => Promise.resolve({ productId: hammer.id, productName: 'Martillo', unit: 'piece', stockMilli: 5000, rows: [], totalMovements: 0 }),
      adjustStock,
    });
    pressKey('F2');
    fireEvent.change(await within(dialog).findByRole('textbox', { name: 'Producto', hidden: true }), { target: { value: '750100' } });
    fireEvent.submit(within(dialog).getByRole('textbox', { name: 'Producto', hidden: true }));
    await within(dialog).findByRole('heading', { name: 'Martillo', hidden: true });

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Cantidad', hidden: true }), { target: { value: '1.5' } });
    pressKey('F2');
    expect((await within(dialog).findByRole('alert', { hidden: true })).textContent).toContain('La cantidad no es válida');

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Cantidad', hidden: true }), { target: { value: '1' } });
    pressKey('F2');
    await waitFor(() => expect(within(dialog).getByRole('alert', { hidden: true }).textContent).toContain('Escribe el motivo'));
    expect(adjustStock).not.toHaveBeenCalled();
  });

  it('shows the report of a catalog load so the owner can compare it with Eleventa, and the rows that were left out', async () => {
    const importCatalog = vi.fn<PosApi['importCatalog']>(() =>
      Promise.resolve({
        status: 'done',
        report: { rowsRead: 5, created: 3, alreadyThere: 1, openingBalances: 3, inventoryValueCents: 158_500, samplesRemoved: 33, invalid: [{ line: 4, reason: 'El código está vacío.' }] },
      }),
    );
    const dialog = await openAdmin({ importCatalog });

    pressKey('F5');

    const result = await within(dialog).findByRole('heading', { name: 'Catálogo cargado', hidden: true });
    expect(result).toBeDefined();
    expect(dialog.textContent).toContain('$1,585.00');
    expect(dialog.textContent).toContain('Línea 4: El código está vacío.');
    expect(importCatalog).toHaveBeenCalledTimes(1);
  });

  it('says why a file cannot be loaded, and does nothing when the owner closes the file window', async () => {
    const importCatalog = vi
      .fn<PosApi['importCatalog']>()
      .mockResolvedValueOnce({ status: 'cancelled' })
      .mockResolvedValueOnce({ status: 'unreadable', message: 'No se encontró el código en la primera fila del archivo.' });
    const dialog = await openAdmin({ importCatalog });

    pressKey('F5');
    await waitFor(() => expect(importCatalog).toHaveBeenCalledTimes(1));
    expect(within(dialog).queryByRole('heading', { name: 'Catálogo cargado', hidden: true })).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 30));
    pressKey('F5');

    expect((await within(dialog).findByText(/No se encontró el código/, { selector: 'p' })).textContent).toBeDefined();
  });

  it('sets up the backups with a passphrase of at least 8 characters, and shows the last copy', async () => {
    const configureBackup = vi.fn<PosApi['configureBackup']>(() =>
      Promise.resolve({ status: 'done', backup: { folder: 'E:\\Respaldos', lastBackupAt: '2026-11-08T20:00:00.000Z', lastError: null } }),
    );
    const dialog = await openAdmin({ configureBackup });

    pressKey('F6');
    await within(dialog).findByRole('heading', { name: 'Configurar los respaldos', hidden: true });
    fireEvent.change(screen.getByLabelText('Contraseña de los respaldos'), { target: { value: 'corta' } });
    pressKey('F2');
    expect((await within(dialog).findByRole('alert', { hidden: true })).textContent).toContain('al menos 8 caracteres');
    expect(configureBackup).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Contraseña de los respaldos'), { target: { value: 'una contraseña larga' } });
    pressKey('F2');

    await waitFor(() => expect(configureBackup).toHaveBeenCalledExactlyOnceWith({ passphrase: 'una contraseña larga' }));
    expect((await within(dialog).findByText(/Respaldos en E:\\Respaldos/)).textContent).toContain('Última copia');
    expect(within(dialog).getByRole('status', { hidden: true }).textContent).toContain('Copia hecha');
  });

  it('shows a copy that failed, so a backup that stopped working is not a secret', async () => {
    const dialog = await openAdmin({ getBackupStatus: () => Promise.resolve({ folder: 'E:\\Respaldos', lastBackupAt: null, lastError: 'ENOENT' }) });

    expect((await within(dialog).findByText(/La última copia falló/)).textContent).toContain('USB');
  });

  it('tells the owner to restart after a restore is ready', async () => {
    const restoreBackup = vi.fn<PosApi['restoreBackup']>(() => Promise.resolve({ status: 'staged' }));
    const dialog = await openAdmin({ restoreBackup });

    pressKey('F8');
    await within(dialog).findByRole('heading', { name: 'Restaurar un respaldo', hidden: true });
    fireEvent.change(screen.getByLabelText('Contraseña de los respaldos'), { target: { value: 'una contraseña larga' } });
    pressKey('F2');

    expect((await within(dialog).findByRole('status', { hidden: true })).textContent).toContain('Cierra la caja y ábrela otra vez');
  });

  it('says why a restore failed, such as a wrong passphrase', async () => {
    const dialog = await openAdmin({ restoreBackup: () => Promise.resolve({ status: 'failed', message: 'La contraseña es incorrecta o el respaldo está dañado.' }) });

    pressKey('F8');
    await within(dialog).findByRole('heading', { name: 'Restaurar un respaldo', hidden: true });
    fireEvent.change(screen.getByLabelText('Contraseña de los respaldos'), { target: { value: 'otra contraseña' } });
    pressKey('F2');

    expect((await within(dialog).findByRole('alert', { hidden: true })).textContent).toContain('contraseña es incorrecta');
  });
});

describe('appearance', () => {
  const SAVED: Appearance = { businessName: 'Tlapalería Torres', accent: 'blue', textSize: 'large', theme: 'dark' };

  async function openDialog(): Promise<HTMLElement> {
    press('F9');
    return screen.findByRole('dialog', { name: 'Apariencia de la caja', hidden: true });
  }

  it('applies the saved appearance and shows the business name', async () => {
    await renderApp(fakePosApi({ getAppearance: () => Promise.resolve(SAVED) }));

    expect(await screen.findByRole('heading', { name: 'Tlapalería Torres' })).toBeDefined();
    expect(document.documentElement.dataset).toMatchObject({ accent: 'blue', textSize: 'large', theme: 'dark' });
  });

  it('calls the register Caja until it has a name', async () => {
    await renderApp(fakePosApi());

    expect(screen.getByRole('heading', { name: 'Caja' })).toBeDefined();
  });

  it('goes on with the default look if the appearance cannot be read', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await renderApp(fakePosApi({ getAppearance: () => Promise.reject(new Error('closed')) }));

    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(screen.getByRole('combobox', { name: 'Buscar producto' })).toBeDefined();
    consoleError.mockRestore();
  });

  it('previews a change, and undoes it on cancel', async () => {
    await renderApp(fakePosApi());
    const dialog = await openDialog();

    fireEvent.click(within(dialog).getByRole('radio', { name: 'Verde', hidden: true }));
    await waitFor(() => expect(document.documentElement.dataset.accent).toBe('green'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar', hidden: true }));

    await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).toBeNull());
    expect(document.documentElement.dataset.accent).toBe('yellow');
  });

  it('undoes a change when Esc closes the dialog', async () => {
    await renderApp(fakePosApi());
    const dialog = await openDialog();

    fireEvent.click(within(dialog).getByRole('radio', { name: 'Rojo', hidden: true }));
    await waitFor(() => expect(document.documentElement.dataset.accent).toBe('red'));
    fireEvent(dialog, new Event('cancel', { cancelable: true }));

    await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).toBeNull());
    expect(document.documentElement.dataset.accent).toBe('yellow');
  });

  it('saves the changes, without spaces around the name, and gives the keyboard back', async () => {
    const saveAppearance = vi.fn(() => Promise.resolve());
    await renderApp(fakePosApi({ saveAppearance }));
    const dialog = await openDialog();

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Nombre del negocio', hidden: true }), {
      target: { value: '  Tlapalería Torres ' },
    });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Azul', hidden: true }));
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Muy grande', hidden: true }));
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Oscuro', hidden: true }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar apariencia', hidden: true }));

    expect(await screen.findByRole('heading', { name: 'Tlapalería Torres' })).toBeDefined();
    expect(saveAppearance).toHaveBeenCalledWith({
      businessName: 'Tlapalería Torres',
      accent: 'blue',
      textSize: 'extra-large',
      theme: 'dark',
    });
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(lookupBox()));
  });

  it('keeps the dialog open and explains when saving fails', async () => {
    await renderApp(fakePosApi({ saveAppearance: () => Promise.reject(new Error('disk full')) }));
    const dialog = await openDialog();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar apariencia', hidden: true }));

    expect((await within(dialog).findByRole('alert', { hidden: true })).textContent).toContain('No se pudo guardar');
  });

  it('does not take the keyboard back while the dialog is open', async () => {
    await renderApp(fakePosApi());
    const dialog = await openDialog();
    const nameField = within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Nombre del negocio', hidden: true });

    nameField.focus();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(document.activeElement).toBe(nameField);
  });
});
