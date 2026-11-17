import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE } from '../../shared/appearance';
import type { UserSummary } from '../../shared/auth';
import type { CashStatus } from '../../shared/cash-api';
import type { CatalogProduct, PosApi } from '../../shared/pos-api';
import { DEFAULT_KEYMAP, DEFAULT_TICKET_DESIGN, type Keymap, type SaleSummary, type ToolsApi } from '../../shared/register-tools';
import type { ReturnableSale } from '../../shared/returns-api';
import { App } from '../App';
import { costWithoutTaxText, costWithTaxText, markupText, priceForMarkup } from '../products/product-form';
import { keepNumeric } from '../ui/numeric';
import { SalesHistoryDialog } from './SalesHistoryDialog';
import { SettingsDialog } from './SettingsDialog';

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
const SALE: SaleSummary = { saleId: 'sale-1', folio: 'T1-000012', completedAt: '2026-11-10T18:30:00.000Z', totalCents: 23_200, refundedCents: 0, cashierName: 'Ana', lineCount: 2 };
const RETURNABLE: ReturnableSale = {
  saleId: 'sale-1',
  folio: 'T1-000012',
  completedAt: SALE.completedAt,
  totalCents: 23_200,
  daysOld: 1,
  lines: [
    { saleLineId: 'line-1', productName: 'Martillo', unit: 'piece', soldMilli: 2000, returnedMilli: 1000, returnableMilli: 1000, unitPriceE4: 1_160_000, lineTotalCents: 23_200, refundedCents: 11_600 },
    { saleLineId: 'line-2', productName: 'Clavo', unit: 'kilogram', soldMilli: 500, returnedMilli: 500, returnableMilli: 0, unitPriceE4: 480_000, lineTotalCents: 2400, refundedCents: 2400 },
  ],
  parts: [],
  violations: ['measured_product'],
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
    savePendingSale: () => Promise.resolve({ status: 'no_cash_session' }),
    ...overrides,
  };
  return api as PosApi;
}

function toolsWith(overrides: Partial<ToolsApi> = {}): ToolsApi {
  return {
    getKeymap: () => Promise.resolve(DEFAULT_KEYMAP),
    saveKeymap: () => Promise.resolve(),
    getTicketDesign: () => Promise.resolve(DEFAULT_TICKET_DESIGN),
    saveTicketDesign: () => Promise.resolve(),
    previewTicket: (design) => Promise.resolve([`ancho ${String(design.columns)}`, ...design.headerLines]),
    getPrinter: () => Promise.resolve(''),
    savePrinter: (share) => Promise.resolve({ status: 'saved', share }),
    testPrint: () => Promise.resolve({ status: 'printed' }),
    listRecentSales: () => Promise.resolve([SALE]),
    recordSaleCancelled: () => Promise.resolve(),
    ...overrides,
  };
}

function lookupBox(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('combobox', { name: 'Buscar producto' });
}

async function renderApp(posApi: PosApi, toolsApi: ToolsApi): Promise<void> {
  render(<App posApi={posApi} toolsApi={toolsApi} />);
  await screen.findByRole('combobox', { name: 'Buscar producto' });
}

async function addHammer(): Promise<void> {
  fireEvent.input(Object.assign(lookupBox(), { value: HAMMER_CODE }));
  fireEvent.keyDown(lookupBox(), { key: 'Enter' });
  await waitFor(() => expect(screen.getByRole('status', { name: 'Total' }).textContent).toBe('$116.00'));
}

describe('a box for numbers', () => {
  it('keeps digits and one decimal point, and drops everything else', () => {
    expect(keepNumeric('12a.5b0', 'decimal')).toBe('12.50');
    expect(keepNumeric('$1,250.50', 'decimal')).toBe('1250.50');
    expect(keepNumeric('1.2.3', 'decimal')).toBe('1.23');
    expect(keepNumeric('-5', 'decimal')).toBe('5');
    expect(keepNumeric('12.5 kg', 'integer')).toBe('125');
    expect(keepNumeric('abc', 'integer')).toBe('');
  });
});

describe('the cost with VAT and what is earned over it', () => {
  const sixteen = { factor: 'rate', rateBp: 1600 } as const;

  it('takes the VAT out of the cost typed, and shows it back to the cent', () => {
    expect(costWithoutTaxText('116', sixteen)).toBe('100.00');
    expect(costWithoutTaxText('100', sixteen)).toBe('86.206897');
    expect(costWithTaxText('86.206897', sixteen)).toBe('100.00');
    expect(costWithTaxText('100', sixteen)).toBe('116.00');
    expect(costWithoutTaxText('', sixteen)).toBe('');
    expect(costWithoutTaxText('1.2345678', sixteen)).toBeNull();
    expect(costWithoutTaxText('50', { factor: 'exempt', rateBp: 0 })).toBe('50.00');
  });

  it('works out the percentage from the price, and the price from the percentage', () => {
    expect(markupText('130', '100')).toBe('30.0');
    expect(markupText('99.50', '100')).toBe('-0.5');
    expect(markupText('', '100')).toBe('');
    expect(markupText('130', '')).toBe('');
    expect(priceForMarkup('100', '30')).toBe('130.00');
    expect(priceForMarkup('58', '50.5')).toBe('87.29');
    expect(priceForMarkup('', '30')).toBeNull();
    expect(priceForMarkup('100', 'x')).toBeNull();
  });
});

describe('dropping the sale being rung up', () => {
  it('asks first, clears the sale, and leaves an entry with what it held', async () => {
    const recordSaleCancelled = vi.fn<ToolsApi['recordSaleCancelled']>(() => Promise.resolve());
    await renderApp(posApiWith(CASHIER), toolsWith({ recordSaleCancelled }));
    await addHammer();

    fireEvent.keyDown(lookupBox(), { key: 'Delete', shiftKey: true });
    const dialog = await screen.findByRole('dialog', { name: '¿Cancelar esta venta?', hidden: true });
    expect(screen.getByRole('status', { name: 'Total' }).textContent).toBe('$116.00');
    fireEvent.click(within(dialog).getByRole('button', { name: /Sí, cancelar la venta/, hidden: true }));

    await waitFor(() => expect(screen.getByRole('status', { name: 'Total' }).textContent).toBe('$0.00'));
    expect(recordSaleCancelled).toHaveBeenCalledExactlyOnceWith({ lineCount: 1, totalCents: 11_600 });
    expect(document.body.textContent).toContain('Venta cancelada. No se cobró nada.');
  });

  it('keeps the sale when the cashier says no, and does nothing with an empty sale', async () => {
    const recordSaleCancelled = vi.fn<ToolsApi['recordSaleCancelled']>(() => Promise.resolve());
    await renderApp(posApiWith(CASHIER), toolsWith({ recordSaleCancelled }));

    fireEvent.keyDown(lookupBox(), { key: 'Delete', shiftKey: true });
    expect(screen.queryByRole('dialog', { name: '¿Cancelar esta venta?', hidden: true })).toBeNull();

    await addHammer();
    fireEvent.keyDown(lookupBox(), { key: 'Delete', shiftKey: true });
    await screen.findByRole('dialog', { name: '¿Cancelar esta venta?', hidden: true });
    fireEvent.keyDown(document.body, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '¿Cancelar esta venta?', hidden: true })).toBeNull());
    expect(screen.getByRole('status', { name: 'Total' }).textContent).toBe('$116.00');
    expect(recordSaleCancelled).not.toHaveBeenCalled();
  });
});

describe('the keys the owner chose', () => {
  it('answers to the saved keys and shows them, and the old key does nothing', async () => {
    const savePendingSale = vi.fn<PosApi['savePendingSale']>(() => Promise.resolve({ status: 'no_cash_session' }));
    const keymap: Keymap = { ...DEFAULT_KEYMAP, checkout: 'Ctrl+K' };
    await renderApp(posApiWith(OWNER, { savePendingSale }), toolsWith({ getKeymap: () => Promise.resolve(keymap) }));
    await addHammer();
    await waitFor(() => expect(screen.getByRole('list', { name: 'Atajos de teclado' }).textContent).toContain('Ctrl K Cobrar'));

    fireEvent.keyDown(lookupBox(), { key: 'F12' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(savePendingSale).not.toHaveBeenCalled();

    fireEvent.keyDown(lookupBox(), { key: 'k', ctrlKey: true });
    await waitFor(() => expect(savePendingSale).toHaveBeenCalledTimes(1));
  });

  it('offers the settings to the owner only', async () => {
    await renderApp(posApiWith(CASHIER), toolsWith());
    expect(screen.queryByRole('button', { name: /Ajustes/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Ventas/ })).toBeDefined();
    cleanup();

    await renderApp(posApiWith(OWNER), toolsWith());
    fireEvent.click(screen.getByRole('button', { name: /Ajustes/ }));
    expect(await screen.findByRole('dialog', { name: 'Ajustes de la caja', hidden: true })).toBeDefined();
  });
});

describe('the settings of the register', () => {
  function renderSettings(toolsApi: ToolsApi, onSaved = vi.fn<(keymap: Keymap) => void>()): typeof onSaved {
    render(<SettingsDialog toolsApi={toolsApi} keymap={DEFAULT_KEYMAP} onKeymapSaved={onSaved} onClose={() => undefined} />);
    return onSaved;
  }

  it('changes a key by pressing it, refuses one that is taken or cannot be used, and saves', async () => {
    const saveKeymap = vi.fn<ToolsApi['saveKeymap']>(() => Promise.resolve());
    const onSaved = renderSettings(toolsWith({ saveKeymap }));
    const change = (): void => {
      fireEvent.click(screen.getByRole('button', { name: 'Cambiar la tecla de Cobrar', hidden: true }));
    };

    change();
    fireEvent.keyDown(window, { key: 'F2' });
    expect((await screen.findByRole('alert', { hidden: true })).textContent).toContain('ya es la tecla de «Varios»');

    fireEvent.keyDown(window, { key: 'a' });
    expect(screen.getByRole('alert', { hidden: true }).textContent).toContain('necesita Ctrl o Alt');

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await waitFor(() => expect(screen.queryByRole('alert', { hidden: true })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Guardar atajos', hidden: true }));

    await waitFor(() => expect(saveKeymap).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_KEYMAP, checkout: 'Ctrl+K' }));
    expect(onSaved).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_KEYMAP, checkout: 'Ctrl+K' });
  });

  it('leaves a key as it was when the capture is given up with Esc', async () => {
    const saveKeymap = vi.fn<ToolsApi['saveKeymap']>(() => Promise.resolve());
    renderSettings(toolsWith({ saveKeymap }));

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar la tecla de Cobrar', hidden: true }));
    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Cambiar la tecla de Cobrar', hidden: true }).textContent).toBe('Cambiar'));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Guardar atajos', hidden: true }).disabled).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Ajustes de la caja', hidden: true })).toBeDefined();
  });

  it('shows the ticket as it is designed, and saves the design', async () => {
    const saveTicketDesign = vi.fn<ToolsApi['saveTicketDesign']>(() => Promise.resolve());
    renderSettings(toolsWith({ saveTicketDesign }));
    fireEvent.click(screen.getByRole('tab', { name: 'Diseño del ticket', hidden: true }));
    const preview = await screen.findByLabelText('Vista previa del ticket');
    await waitFor(() => expect(preview.textContent).toContain('ancho 48'));

    fireEvent.change(screen.getByLabelText('Encabezado del ticket'), { target: { value: 'Av. Juárez 12\nTel. 555 123' } });
    fireEvent.change(screen.getByLabelText('Ancho del papel'), { target: { value: '32' } });
    fireEvent.click(screen.getByLabelText('Total en letra grande'));
    fireEvent.change(screen.getByLabelText('Fuente'), { target: { value: 'b' } });
    fireEvent.change(screen.getByLabelText('Tamaño de letra'), { target: { value: 'tall' } });
    expect(screen.getByText('Caben 42 letras por renglón con este papel, fuente y tamaño.').tagName).toBe('SMALL');
    await waitFor(() => expect(preview.textContent).toContain('ancho 32\nAv. Juárez 12\nTel. 555 123'));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar diseño', hidden: true }));

    await waitFor(() =>
      expect(saveTicketDesign).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_TICKET_DESIGN, headerLines: ['Av. Juárez 12', 'Tel. 555 123'], columns: 32, bigTotal: true, font: 'b', textSize: 'tall' }),
    );
  });

  it('saves the printer by its shared name, and says when a test print cannot be made', async () => {
    const savePrinter = vi.fn<ToolsApi['savePrinter']>(() => Promise.resolve({ status: 'saved', share: '\\\\localhost\\TM-T20' }));
    renderSettings(toolsWith({ savePrinter, testPrint: () => Promise.resolve({ status: 'failed', message: 'la impresora no responde' }) }));
    fireEvent.click(screen.getByRole('tab', { name: 'Impresora', hidden: true }));

    fireEvent.change(await screen.findByLabelText('Nombre compartido de la impresora'), { target: { value: 'TM-T20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar impresora', hidden: true }));
    expect((await screen.findByRole('status', { hidden: true })).textContent).toContain('\\\\localhost\\TM-T20');

    fireEvent.click(screen.getByRole('button', { name: 'Imprimir un ticket de prueba', hidden: true }));
    expect((await screen.findByRole('alert', { hidden: true })).textContent).toContain('la impresora no responde');
  });
});

describe('cancelling a past sale', () => {
  it('returns everything that is left of the sale, with the reason and the PIN of the owner for a cashier', async () => {
    const createReturn = vi.fn<PosApi['createReturn']>(() => Promise.resolve({ status: 'returned', returnId: 'r1', totalCents: 11_600, refunds: [] }));
    const onCancelled = vi.fn<() => void>();
    const posApi = posApiWith(CASHIER, { findReturnableSale: () => Promise.resolve({ status: 'found', sale: RETURNABLE }), createReturn });
    render(<SalesHistoryDialog posApi={posApi} toolsApi={toolsWith()} isOwner={false} onCancelled={onCancelled} onClose={() => undefined} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar la venta T1-000012', hidden: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar la venta T1-000012', hidden: true }));
    expect((await screen.findByRole('alert', { hidden: true })).textContent).toContain('Escribe por qué se cancela');

    fireEvent.change(screen.getByLabelText('Motivo de la cancelación'), { target: { value: 'Se cobró dos veces' } });
    fireEvent.change(screen.getByLabelText('PIN del dueño'), { target: { value: '43a21' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar la venta T1-000012', hidden: true }));

    await waitFor(() =>
      expect(createReturn).toHaveBeenCalledExactlyOnceWith({
        saleId: 'sale-1',
        // Only what is still returnable: one hammer. The nails already went back.
        lines: [{ saleLineId: 'line-1', quantityMilli: 1000 }],
        reason: 'Cancelación de venta: Se cobró dos veces',
        override: true,
        ownerPin: '4321',
      }),
    );
    expect((await screen.findByRole('status', { hidden: true })).textContent).toContain('Venta T1-000012 cancelada. Devuelve $116.00 al cliente');
    expect(onCancelled).toHaveBeenCalledTimes(1);
  });

  it('marks a sale that already went back whole, and offers no button for it', async () => {
    const cancelled: SaleSummary = { ...SALE, saleId: 'sale-2', folio: 'T1-000013', refundedCents: 23_200 };
    render(<SalesHistoryDialog posApi={posApiWith(OWNER)} toolsApi={toolsWith({ listRecentSales: () => Promise.resolve([cancelled]) })} isOwner onCancelled={() => undefined} onClose={() => undefined} />);

    expect((await screen.findByText('Cancelada')).textContent).toBe('Cancelada');
    expect(screen.queryByRole('button', { name: 'Cancelar la venta T1-000013', hidden: true })).toBeNull();
  });

  it('says why the owner PIN was refused, and keeps the sale as it was', async () => {
    const posApi = posApiWith(CASHIER, {
      findReturnableSale: () => Promise.resolve({ status: 'found', sale: RETURNABLE }),
      createReturn: () => Promise.resolve({ status: 'wrong_pin', attemptsLeft: 3 }),
    });
    const onCancelled = vi.fn<() => void>();
    render(<SalesHistoryDialog posApi={posApi} toolsApi={toolsWith()} isOwner={false} onCancelled={onCancelled} onClose={() => undefined} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar la venta T1-000012', hidden: true }));
    fireEvent.change(screen.getByLabelText('Motivo de la cancelación'), { target: { value: 'Error' } });
    fireEvent.change(screen.getByLabelText('PIN del dueño'), { target: { value: '0000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar la venta T1-000012', hidden: true }));

    expect((await screen.findByRole('alert', { hidden: true })).textContent).toContain('Quedan 3 intentos');
    expect(onCancelled).not.toHaveBeenCalled();
  });
});
