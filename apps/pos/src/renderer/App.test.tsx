import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE, type Appearance } from '../shared/appearance';
import type { CatalogProduct, PosApi } from '../shared/pos-api';
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
