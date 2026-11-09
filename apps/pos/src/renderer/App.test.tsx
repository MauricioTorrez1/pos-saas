import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE, type Appearance } from '../shared/appearance';
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
    render(<App posApi={fakePosApi()} />);

    expect(await screen.findByText('Versión 1.2.3')).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('warns the cashier when the bridge fails', async () => {
    render(<App posApi={fakePosApi({ getAppInfo: () => Promise.reject(new Error('channel closed')) })} />);

    expect((await screen.findByRole('alert')).textContent).toContain('No se pudo leer la versión');
    expect(screen.queryByText(/^Versión/)).toBeNull();
  });

  it('gives the keyboard to the lookup box from the start', () => {
    render(<App posApi={fakePosApi()} />);

    expect(document.activeElement).toBe(lookupBox());
  });

  it('takes the keyboard back when something else takes it', async () => {
    render(<App posApi={fakePosApi()} />);

    lookupBox().blur();

    await waitFor(() => expect(document.activeElement).toBe(lookupBox()));
  });
});

describe('selling', () => {
  it('invites the cashier to start when the sale is empty', () => {
    render(<App posApi={fakePosApi()} />);

    expect(screen.getByText('Aún no hay productos en esta venta')).toBeDefined();
    expect(totalShown()).toBe('$0.00');
  });

  it('adds a scanned product, updates the totals, and empties the box', async () => {
    render(<App posApi={fakePosApi()} />);

    scan(HAMMER_CODE);

    await waitFor(() => expect(linesShown()).toEqual(['Martillo1 pza$116.00$116.00']));
    expect(totalShown()).toBe('$116.00');
    expect(screen.getByText('$100.00')).toBeDefined();
    expect(screen.getByText('IVA 16%')).toBeDefined();
    expect(lookupBox().value).toBe('');
  });

  it('adds one more unit when the same product is scanned again', async () => {
    render(<App posApi={fakePosApi()} />);

    scan(HAMMER_CODE);
    await waitFor(() => expect(totalShown()).toBe('$116.00'));
    scan(HAMMER_CODE);

    await waitFor(() => expect(linesShown()).toEqual(['Martillo2 pza$116.00$232.00']));
  });

  it('adds a code typed by hand', async () => {
    render(<App posApi={fakePosApi()} />);

    await addByCode();

    expect(linesShown()).toHaveLength(1);
  });

  it('says so when a scanned code does not exist, and does not search by name', async () => {
    const searchProducts = vi.fn(() => Promise.resolve([HAMMER]));
    render(<App posApi={fakePosApi({ searchProducts })} />);

    scan('9999999');

    expect((await screen.findByRole('alert')).textContent).toContain('«9999999»');
    expect(searchProducts).not.toHaveBeenCalled();
    expect(lookupBox().value).toBe('');
  });

  it('never searches by name during a scan', async () => {
    const searchProducts = vi.fn(() => Promise.resolve([HAMMER]));
    render(<App posApi={fakePosApi({ searchProducts })} />);

    scan(HAMMER_CODE);
    await waitFor(() => expect(totalShown()).toBe('$116.00'));
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(searchProducts).not.toHaveBeenCalled();
  });

  it('shows matches while typing a name, and Enter adds the first one', async () => {
    render(<App posApi={fakePosApi()} />);

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
    render(<App posApi={fakePosApi()} />);

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
    render(<App posApi={fakePosApi()} />);

    typeText('mart');
    press('Enter');

    expect(await screen.findAllByRole('option')).toHaveLength(2);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('adds a match with a click', async () => {
    render(<App posApi={fakePosApi()} />);

    typeText('cable');
    const options = await screen.findAllByRole('option');
    fireEvent.mouseDown(options[1]!);
    await confirmQuantity('2');

    await waitFor(() => expect(linesShown()[0]).toContain('Cable THW'));
  });

  it('recognizes the next scan after a match is chosen with the mouse', async () => {
    const searchProducts = vi.fn<PosApi['searchProducts']>(() => Promise.resolve([HAMMER, CABLE]));
    render(<App posApi={fakePosApi({ searchProducts })} />);
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
    render(<App posApi={fakePosApi()} />);

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
    render(<App posApi={fakePosApi({ searchProducts })} />);

    typeText('m');
    await waitFor(() => expect(searchProducts).toHaveBeenCalledTimes(1));
    typeText('ca');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    answerFirst([HAMMER, CABLE]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Cable THW$12.50 / m']);
  });

  it('clears the box and the matches with Esc', async () => {
    render(<App posApi={fakePosApi()} />);

    typeText('mart');
    await screen.findAllByRole('option');
    press('Escape');

    await waitFor(() => expect(screen.queryByRole('option')).toBeNull());
    expect(lookupBox().value).toBe('');
  });

  it('changes the quantity with + and − when the box is empty', async () => {
    render(<App posApi={fakePosApi()} />);
    await addByCode();

    press('+');
    await waitFor(() => expect(totalShown()).toBe('$232.00'));
    press('-');

    await waitFor(() => expect(totalShown()).toBe('$116.00'));
  });

  it('lets + and − be typed when there is text in the box', async () => {
    render(<App posApi={fakePosApi()} />);
    await addByCode();
    typeText('3');

    expect(press('-')).toBe(true);
    expect(totalShown()).toBe('$116.00');
  });

  it('removes the selected line with Supr', async () => {
    render(<App posApi={fakePosApi()} />);
    await addByCode();

    press('Delete');

    await waitFor(() => expect(totalShown()).toBe('$0.00'));
    expect(screen.getByText('Aún no hay productos en esta venta')).toBeDefined();
  });

  it('warns the cashier when the catalog cannot be read', async () => {
    render(<App posApi={fakePosApi({ findProductByCode: () => Promise.reject(new Error('closed')) })} />);

    scan(HAMMER_CODE);

    expect((await screen.findByRole('alert')).textContent).toContain('No se pudo consultar el catálogo');
  });

  it('removes the warning as soon as the cashier types again', async () => {
    render(<App posApi={fakePosApi()} />);
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
    render(<App posApi={fakePosApi()} />);
    await chooseCable();
    expect(totalShown()).toBe('$0.00');

    fireEvent.change(await screen.findByRole('textbox', { name: 'Cantidad', hidden: true }), { target: { value: '3.275' } });
    expect(importShown()).toBe('$40.94');
    pressKey('Enter');

    await waitFor(() => expect(linesShown()).toEqual(['Cable THW3.275 m$12.50$40.94']));
    expect(totalShown()).toBe('$40.94');
  });

  it('adds nothing when the cashier cancels with Esc', async () => {
    render(<App posApi={fakePosApi()} />);
    await chooseCable();

    pressKey('Escape');

    await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).toBeNull());
    expect(totalShown()).toBe('$0.00');
    await waitFor(() => expect(document.activeElement).toBe(lookupBox()));
  });

  it('adds nothing, and explains, while the quantity is not valid', async () => {
    render(<App posApi={fakePosApi()} />);
    await chooseCable();
    const box = await screen.findByRole('textbox', { name: 'Cantidad', hidden: true });

    fireEvent.change(box, { target: { value: '3.2755' } });
    pressKey('Enter');

    expect(screen.getByRole('alert', { hidden: true }).textContent).toContain('3 decimales');
    expect(totalShown()).toBe('$0.00');
  });

  it('asks for F2 when the quantity is more than a shop sells at once, so 125 is not taken for 1.25', async () => {
    render(<App posApi={fakePosApi()} />);
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
    render(<App posApi={fakePosApi()} />);
    await chooseCable();
    await confirmQuantity('1.5');
    await waitFor(() => expect(linesShown()).toHaveLength(1));

    await chooseCable();
    await confirmQuantity('2.25');

    await waitFor(() => expect(linesShown()).toEqual(['Cable THW3.750 m$12.50$46.88']));
  });

  it('does not let the Enter that ends a barcode scan add a line', async () => {
    render(<App posApi={fakePosApi()} />);
    await chooseCable();
    const box = await screen.findByRole('textbox', { name: 'Cantidad', hidden: true });

    fireEvent.change(box, { target: { value: HAMMER_CODE } });
    pressKey('Enter');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(totalShown()).toBe('$0.00');
  });

  it('adds pieces at once, without asking', async () => {
    render(<App posApi={fakePosApi()} />);

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
    render(<App posApi={fakePosApi({ listPendingSales })} />);

    await waitFor(() => expect(listPendingSales).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
    expect(document.activeElement).toBe(lookupBox());
  });

  it('shows a sale left pending as soon as the register starts, with what is needed to recognize it', async () => {
    render(<App posApi={fakePosApi(withPending(OLDER))} />);

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
    render(<App posApi={fakePosApi({ ...withPending(OLDER), confirmPendingSale })} />);
    const dialog = await findDialog();

    await confirmInCash(dialog);

    await dialogGone();
    expect(confirmPendingSale).toHaveBeenCalledExactlyOnceWith({ saleId: 'older-sale', cashReceivedCents: 15694, transfers: [] });
    await waitFor(() => expect(document.activeElement).toBe(lookupBox()));
  });

  it('records a transfer with its reference when the sale was paid that way', async () => {
    const confirmPendingSale = vi.fn<PosApi['confirmPendingSale']>(() => Promise.resolve(COMPLETED));
    render(<App posApi={fakePosApi({ ...withPending(OLDER), confirmPendingSale })} />);
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
    render(<App posApi={fakePosApi({ ...withPending(OLDER), confirmPendingSale })} />);
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
    render(<App posApi={fakePosApi({ ...withPending(OLDER), cancelPendingSale })} />);
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
    render(<App posApi={fakePosApi({ ...withPending(OLDER), cancelPendingSale, confirmPendingSale })} />);
    await findDialog();

    pressKey('F4');

    await dialogGone();
    expect(cancelPendingSale).toHaveBeenCalledExactlyOnceWith('older-sale');
    expect(confirmPendingSale).not.toHaveBeenCalled();
  });

  it('answers with the buttons too', async () => {
    const cancelPendingSale = vi.fn(() => Promise.resolve());
    render(<App posApi={fakePosApi({ ...withPending(OLDER), cancelPendingSale })} />);
    const dialog = await findDialog();

    fireEvent.click(within(dialog).getByRole('button', { name: /No se cobró, cancelar venta/, hidden: true }));

    await dialogGone();
    expect(cancelPendingSale).toHaveBeenCalledExactlyOnceWith('older-sale');
  });

  it('goes through several sales one at a time, oldest first', async () => {
    const confirmPendingSale = vi.fn<PosApi['confirmPendingSale']>(() => Promise.resolve(COMPLETED));
    const cancelPendingSale = vi.fn(() => Promise.resolve());
    render(<App posApi={fakePosApi({ ...withPending(OLDER, NEWER), confirmPendingSale, cancelPendingSale })} />);
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
    render(<App posApi={fakePosApi({ ...withPending(OLDER), confirmPendingSale, cancelPendingSale })} />);
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
    render(<App posApi={fakePosApi({ ...withPending(OLDER), confirmPendingSale })} />);
    const dialog = await findDialog();

    pressKey('F2');
    await within(dialog).findByRole('heading', { name: '¿Con qué se pagó?', hidden: true });
    typeInto('Efectivo recibido', '156.94');
    pressKey('Enter');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(confirmPendingSale).not.toHaveBeenCalled();
  });

  it('takes the keyboard off the button that was clicked, before the next sale appears', async () => {
    render(<App posApi={fakePosApi(withPending(OLDER, NEWER))} />);
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
    render(<App posApi={fakePosApi({ ...withPending(OLDER, NEWER), cancelPendingSale })} />);
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
    render(<App posApi={fakePosApi({ ...withPending(OLDER), confirmPendingSale })} />);
    const dialog = await findDialog();

    await confirmInCash(dialog);

    expect((await within(dialog).findByRole('alert', { hidden: true })).textContent).toContain('No se guardó tu respuesta');
    expect(dialog.textContent).toContain('Cable THW');
    pressKey('F2');
    await dialogGone();
    expect(confirmPendingSale).toHaveBeenCalledTimes(2);
  });

  it('asks the browser not to close the question with Esc', async () => {
    render(<App posApi={fakePosApi(withPending(OLDER))} />);

    expect((await findDialog()).getAttribute('closedby')).toBe('none');
  });

  it('warns the cashier when the pending sales cannot be read, and goes on selling', async () => {
    render(<App posApi={fakePosApi({ listPendingSales: () => Promise.reject(new Error('closed')) })} />);

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
    render(<App posApi={fakePosApi({ savePendingSale })} />);

    press('F12');

    expect((await screen.findByRole('alert')).textContent).toContain('Agrega al menos un producto');
    expect(savePendingSale).not.toHaveBeenCalled();
  });

  it('saves the sale with a fresh key before the payment screen opens (ADR 0010)', async () => {
    const savePendingSale = vi.fn<PosApi['savePendingSale']>(() => Promise.resolve({ status: 'saved', sale: SAVED }));
    render(<App posApi={fakePosApi({ savePendingSale })} />);

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
    render(<App posApi={fakePosApi({ checkoutSale })} />);
    await addByCode();

    press('F12');

    expect((await screen.findByRole('alert')).textContent).toContain('El catálogo cambió');
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
    expect(checkoutSale).not.toHaveBeenCalled();
    expect(totalShown()).toBe('$116.00');
  });

  it('says so when the sale cannot be saved', async () => {
    render(<App posApi={fakePosApi({ savePendingSale: () => Promise.reject(new Error('disk full')) })} />);
    await addByCode();

    press('F12');

    expect((await screen.findByRole('alert')).textContent).toContain('No se pudo guardar la venta');
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
  });

  it('shows the change while the cashier types the cash, and collects with F2 (RF-014)', async () => {
    const checkoutSale = vi.fn<PosApi['checkoutSale']>(() => Promise.resolve({ status: 'completed', folio: 'T1-000001', changeCents: 8400, problems: [] }));
    render(<App posApi={posApiThatSaves({ checkoutSale })} />);
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
    render(<App posApi={posApiThatSaves({ checkoutSale: () => Promise.resolve({ status: 'completed', folio: 'T1-000001', changeCents: 8400, problems: [] }) })} />);
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
    render(<App posApi={posApiThatSaves({ checkoutSale })} />);
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
    render(<App posApi={posApiThatSaves({ checkoutSale })} />);
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
    render(<App posApi={posApiThatSaves({ checkoutSale })} />);
    await openCheckout();

    typeInto('Tarjeta', '116');
    typeInto('Folio de la terminal', '4111 1111 1111 1111');
    pressKey('F2');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(status()).toContain('número de tarjeta');
    expect(checkoutSale).not.toHaveBeenCalled();
  });

  it('does not send a cards list when the sale was not paid with a card', async () => {
    const checkoutSale = vi.fn<PosApi['checkoutSale']>(() => Promise.resolve(COMPLETED));
    render(<App posApi={posApiThatSaves({ checkoutSale })} />);
    await openCheckout();
    typeInto('Efectivo recibido', '116');

    pressKey('F2');

    await waitFor(() => expect(checkoutSale).toHaveBeenCalledTimes(1));
    expect(checkoutSale.mock.calls[0]![0]).not.toHaveProperty('cards');
  });

  it('fills the cash that is missing with F5, and the transfer that is missing with F6', async () => {
    render(<App posApi={posApiThatSaves()} />);
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
    render(<App posApi={posApiThatSaves({ checkoutSale })} />);
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
    render(<App posApi={posApiThatSaves({ checkoutSale })} />);
    await openCheckout();
    typeInto('Efectivo recibido', '200');

    pressKey('Enter');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(checkoutSale).not.toHaveBeenCalled();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Transferencia');
  });

  it('cancels the saved sale with Esc, and keeps the products on the screen', async () => {
    const cancelPendingSale = vi.fn(() => Promise.resolve());
    render(<App posApi={posApiThatSaves({ cancelPendingSale })} />);
    await openCheckout();

    pressKey('Escape');

    await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).toBeNull());
    expect(cancelPendingSale).toHaveBeenCalledExactlyOnceWith('saved-sale');
    expect(totalShown()).toBe('$116.00');
    await waitFor(() => expect(document.activeElement).toBe(lookupBox()));
  });

  it('stays on the payment screen and explains when the sale cannot be cancelled', async () => {
    render(<App posApi={posApiThatSaves({ cancelPendingSale: () => Promise.reject(new Error('disk full')) })} />);
    const dialog = await openCheckout();

    pressKey('Escape');

    expect((await within(dialog).findByRole('alert', { hidden: true })).textContent).toContain('No se pudo cancelar la venta');
  });

  it('explains when the payment cannot be recorded, and lets the cashier try again', async () => {
    const checkoutSale = vi
      .fn<PosApi['checkoutSale']>()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce(COMPLETED);
    render(<App posApi={posApiThatSaves({ checkoutSale })} />);
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
    render(<App posApi={posApiThatSaves({ checkoutSale: () => Promise.resolve(result) })} />);
    const dialog = await openCheckout();
    typeInto('Efectivo recibido', '116');

    pressKey('F2');

    expect((await within(dialog).findByRole('alert', { hidden: true })).textContent).toContain('La venta quedó registrada');
    expect(within(dialog).getByRole('status', { name: 'Cambio a entregar', hidden: true }).textContent).toBe('Sin cambio');
  });

  it('sends one collection when F2 is pressed twice', async () => {
    let finish: (result: CheckoutSaleResult) => void = () => undefined;
    const checkoutSale = vi.fn<PosApi['checkoutSale']>(() => new Promise((resolve) => (finish = resolve)));
    render(<App posApi={posApiThatSaves({ checkoutSale })} />);
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
    render(<App posApi={fakePosApi({ savePendingSale: () => Promise.resolve({ status: 'saved', sale: saved }), reprintLastTicket })} />);
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
    render(<App posApi={fakePosApi({ reprintLastTicket })} />);

    press('F8');

    expect((await screen.findByText('Ticket T1-000007 reimpreso.')).textContent).toBeDefined();
  });

  it('says so when there is nothing to reprint', async () => {
    render(<App posApi={fakePosApi()} />);

    press('F8');

    expect(await screen.findByText('Todavía no hay ventas cobradas para reimprimir.')).toBeDefined();
  });

  it('says why when the printer fails, and that the sale is safe', async () => {
    const result = { status: 'printer_failed', folio: 'T1-000003', message: 'Sin papel' } as const;
    render(<App posApi={fakePosApi({ reprintLastTicket: () => Promise.resolve(result) })} />);

    press('F8');

    const message = await screen.findByText(/No se pudo imprimir el ticket T1-000003/);
    expect(message.textContent).toContain('Sin papel');
    expect(message.textContent).toContain('La venta quedó registrada');
  });

  it('says so when the register cannot even ask', async () => {
    render(<App posApi={fakePosApi({ reprintLastTicket: () => Promise.reject(new Error('closed')) })} />);

    press('F8');

    expect(await screen.findByText(/No se pudo reimprimir el ticket/)).toBeDefined();
  });
});

describe('appearance', () => {
  const SAVED: Appearance = { businessName: 'Tlapalería Torres', accent: 'blue', textSize: 'large', theme: 'dark' };

  async function openDialog(): Promise<HTMLElement> {
    press('F9');
    return screen.findByRole('dialog', { name: 'Apariencia de la caja', hidden: true });
  }

  it('applies the saved appearance and shows the business name', async () => {
    render(<App posApi={fakePosApi({ getAppearance: () => Promise.resolve(SAVED) })} />);

    expect(await screen.findByRole('heading', { name: 'Tlapalería Torres' })).toBeDefined();
    expect(document.documentElement.dataset).toMatchObject({ accent: 'blue', textSize: 'large', theme: 'dark' });
  });

  it('calls the register Caja until it has a name', () => {
    render(<App posApi={fakePosApi()} />);

    expect(screen.getByRole('heading', { name: 'Caja' })).toBeDefined();
  });

  it('goes on with the default look if the appearance cannot be read', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<App posApi={fakePosApi({ getAppearance: () => Promise.reject(new Error('closed')) })} />);

    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(screen.getByRole('combobox', { name: 'Buscar producto' })).toBeDefined();
    consoleError.mockRestore();
  });

  it('previews a change, and undoes it on cancel', async () => {
    render(<App posApi={fakePosApi()} />);
    const dialog = await openDialog();

    fireEvent.click(within(dialog).getByRole('radio', { name: 'Verde', hidden: true }));
    await waitFor(() => expect(document.documentElement.dataset.accent).toBe('green'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar', hidden: true }));

    await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).toBeNull());
    expect(document.documentElement.dataset.accent).toBe('yellow');
  });

  it('undoes a change when Esc closes the dialog', async () => {
    render(<App posApi={fakePosApi()} />);
    const dialog = await openDialog();

    fireEvent.click(within(dialog).getByRole('radio', { name: 'Rojo', hidden: true }));
    await waitFor(() => expect(document.documentElement.dataset.accent).toBe('red'));
    fireEvent(dialog, new Event('cancel', { cancelable: true }));

    await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).toBeNull());
    expect(document.documentElement.dataset.accent).toBe('yellow');
  });

  it('saves the changes, without spaces around the name, and gives the keyboard back', async () => {
    const saveAppearance = vi.fn(() => Promise.resolve());
    render(<App posApi={fakePosApi({ saveAppearance })} />);
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
    render(<App posApi={fakePosApi({ saveAppearance: () => Promise.reject(new Error('disk full')) })} />);
    const dialog = await openDialog();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar apariencia', hidden: true }));

    expect((await within(dialog).findByRole('alert', { hidden: true })).textContent).toContain('No se pudo guardar');
  });

  it('does not take the keyboard back while the dialog is open', async () => {
    render(<App posApi={fakePosApi()} />);
    const dialog = await openDialog();
    const nameField = within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Nombre del negocio', hidden: true });

    nameField.focus();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(document.activeElement).toBe(nameField);
  });
});
