import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE, type Appearance } from '../shared/appearance';
import type { CatalogProduct, PendingSale, PosApi } from '../shared/pos-api';
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
    listPendingSales: () => Promise.resolve([]),
    confirmPendingSale: () => Promise.resolve(),
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

    await waitFor(() => expect(linesShown()[0]).toContain('Cable THW'));
  });

  it('recognizes the next scan after a match is chosen with the mouse', async () => {
    const searchProducts = vi.fn<PosApi['searchProducts']>(() => Promise.resolve([HAMMER, CABLE]));
    render(<App posApi={fakePosApi({ searchProducts })} />);
    // A correction marks the text as typed by a person, which must not carry over to the next scan.
    press('Backspace');
    typeText('cable');
    fireEvent.mouseDown((await screen.findAllByRole('option'))[1]!);
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

  it('confirms the sale with F2 and gives the keyboard back to the lookup box', async () => {
    const confirmPendingSale = vi.fn(() => Promise.resolve());
    render(<App posApi={fakePosApi({ ...withPending(OLDER), confirmPendingSale })} />);
    await findDialog();

    pressKey('F2');

    await dialogGone();
    expect(confirmPendingSale).toHaveBeenCalledExactlyOnceWith('older-sale');
    await waitFor(() => expect(document.activeElement).toBe(lookupBox()));
  });

  it('cancels the sale with F4', async () => {
    const cancelPendingSale = vi.fn(() => Promise.resolve());
    const confirmPendingSale = vi.fn(() => Promise.resolve());
    render(<App posApi={fakePosApi({ ...withPending(OLDER), cancelPendingSale, confirmPendingSale })} />);
    await findDialog();

    pressKey('F4');

    await dialogGone();
    expect(cancelPendingSale).toHaveBeenCalledExactlyOnceWith('older-sale');
    expect(confirmPendingSale).not.toHaveBeenCalled();
  });

  it('answers with the buttons too', async () => {
    const confirmPendingSale = vi.fn(() => Promise.resolve());
    render(<App posApi={fakePosApi({ ...withPending(OLDER), confirmPendingSale })} />);
    const dialog = await findDialog();

    fireEvent.click(within(dialog).getByRole('button', { name: /Sí, se cobró en efectivo/, hidden: true }));

    await dialogGone();
    expect(confirmPendingSale).toHaveBeenCalledExactlyOnceWith('older-sale');
  });

  it('goes through several sales one at a time, oldest first', async () => {
    const confirmPendingSale = vi.fn(() => Promise.resolve());
    const cancelPendingSale = vi.fn(() => Promise.resolve());
    render(<App posApi={fakePosApi({ ...withPending(OLDER, NEWER), confirmPendingSale, cancelPendingSale })} />);
    const dialog = await findDialog();
    expect(dialog.textContent).toContain('Cable THW');
    expect(dialog.textContent).toContain('Quedan 2 ventas por revisar');

    pressKey('F2');

    await waitFor(() => expect(dialog.textContent).not.toContain('Cable THW'));
    expect(dialog.textContent).not.toContain('por revisar');
    pressKey('F4');
    await dialogGone();
    expect(confirmPendingSale).toHaveBeenCalledExactlyOnceWith('older-sale');
    expect(cancelPendingSale).toHaveBeenCalledExactlyOnceWith('newer-sale');
  });

  it('does not take the Enter of a scanner for an answer', async () => {
    const confirmPendingSale = vi.fn(() => Promise.resolve());
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

  it('takes the keyboard off the button that was clicked, before the next sale appears', async () => {
    render(<App posApi={fakePosApi(withPending(OLDER, NEWER))} />);
    const dialog = await findDialog();
    const button = within(dialog).getByRole('button', { name: /Sí, se cobró en efectivo/, hidden: true });
    button.focus();

    fireEvent.click(button);

    await waitFor(() => expect(dialog.textContent).not.toContain('Cable THW'));
    expect(document.activeElement).toHaveProperty('tagName', 'SECTION');
  });

  it('ignores a second key while the first answer is being saved', async () => {
    let finishSaving: () => void = () => undefined;
    const confirmPendingSale = vi.fn(() => new Promise<void>((resolve) => (finishSaving = resolve)));
    render(<App posApi={fakePosApi({ ...withPending(OLDER, NEWER), confirmPendingSale })} />);
    await findDialog();

    pressKey('F2');
    pressKey('F2');
    finishSaving();

    await waitFor(() => expect(screen.getByRole('dialog', { hidden: true }).textContent).not.toContain('Cable THW'));
    expect(confirmPendingSale).toHaveBeenCalledTimes(1);
  });

  it('keeps the sale on the screen and explains when the answer cannot be saved', async () => {
    const confirmPendingSale = vi
      .fn<PosApi['confirmPendingSale']>()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce();
    render(<App posApi={fakePosApi({ ...withPending(OLDER), confirmPendingSale })} />);
    const dialog = await findDialog();

    pressKey('F2');

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
