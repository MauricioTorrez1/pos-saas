import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE } from '../../shared/appearance';
import type { UserSummary } from '../../shared/auth';
import type { CashStatus } from '../../shared/cash-api';
import type { PosApi } from '../../shared/pos-api';
import type { OrderCandidate, PurchaseOrder, PurchasingApi, Supplier } from '../../shared/supplier-order';
import { App } from '../App';
import { lineFromCandidate, quantityInputText, readLine, totalsOf } from './order-form';
import { SupplierOrderDialog } from './SupplierOrderDialog';

const OWNER: UserSummary = { id: '019a5f2e-7c40-7b1a-9d2e-3f4a5b6c7d8e', name: 'Mauricio', role: 'owner' };
const CASHIER: UserSummary = { id: '019a5f2e-7c40-7b1a-9d2e-3f4a5b6c7d8f', name: 'Ana', role: 'cashier' };
const SUPPLIER: Supplier = { id: '019a5f2e-7c40-7b1a-9d2e-aaaaaaaaaaa1', name: 'Ferretera del Centro', contact: null, notes: null, isActive: true, revision: 1 };
const TAPE: OrderCandidate = {
  productId: '019a5f2e-7c40-7b1a-9d2e-bbbbbbbbbbb1',
  name: 'Cinta métrica 5 m',
  unit: 'piece',
  barcode: '7501234567890',
  stockMilli: 2_000,
  estimatedCostE6: 52_250_000,
  supplierCodes: [{ supplierCode: 'CM-5', listCostE6: null, purchaseUnit: null }],
  minimumMilli: null,
  maximumMilli: null,
  suggestedMilli: null,
  matchedBy: 'name',
};
const CABLE: OrderCandidate = {
  productId: '019a5f2e-7c40-7b1a-9d2e-bbbbbbbbbbb2',
  name: 'Cable THW calibre 12',
  unit: 'meter',
  barcode: null,
  stockMilli: 3_000,
  estimatedCostE6: null,
  supplierCodes: [],
  minimumMilli: 10_000,
  maximumMilli: null,
  suggestedMilli: 17_000,
  matchedBy: 'low_stock',
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

/** An order as the main process would answer after saving it. */
function savedOrder(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: '019a5f2e-7c40-7b1a-9d2e-ccccccccccc1',
    folio: 1,
    supplierId: SUPPLIER.id,
    supplierName: SUPPLIER.name,
    status: 'draft',
    notes: null,
    createdAt: '2026-11-11T16:00:00.000Z',
    updatedAt: '2026-11-11T16:00:00.000Z',
    sentAt: null,
    revision: 1,
    lines: [
      { lineNumber: 1, productId: TAPE.productId, description: TAPE.name, supplierCode: 'CM-5', barcode: TAPE.barcode, unit: 'piece', quantityMilli: 12_000, unitCostE6: 52_250_000, lineTotalCents: 62_700 },
    ],
    totalCents: 62_700,
    linesWithoutCost: 0,
    ...overrides,
  };
}

function apiWith(overrides: Partial<PurchasingApi> = {}): PurchasingApi {
  return {
    listSuppliers: vi.fn(() => Promise.resolve([SUPPLIER])),
    saveSupplier: vi.fn(),
    getSupplierLinks: vi.fn(() => Promise.resolve([])),
    setSupplierCodes: vi.fn(),
    searchOrderProducts: vi.fn(({ text }) => Promise.resolve(text === '7501234567890' || text === 'cinta' ? [{ ...TAPE, matchedBy: text === 'cinta' ? 'name' : 'barcode' } as OrderCandidate] : [])),
    suggestOrderProducts: vi.fn(() => Promise.resolve([CABLE])),
    setReorderLevel: vi.fn(),
    listOrders: vi.fn(() => Promise.resolve([])),
    getOrder: vi.fn(() => Promise.resolve(null)),
    saveOrder: vi.fn(() => Promise.resolve({ status: 'saved', order: savedOrder() })),
    markOrderSent: vi.fn(() => Promise.resolve({ status: 'sent', order: savedOrder({ status: 'sent', revision: 2, sentAt: '2026-11-11T17:00:00.000Z' }) })),
    discardOrder: vi.fn(() => Promise.resolve({ status: 'discarded' })),
    exportOrder: vi.fn(() => Promise.resolve({ status: 'saved', path: 'C:\\Pedidos\\PED-0001.xlsx' })),
    revealFile: vi.fn(() => Promise.resolve()),
    ...overrides,
  } as PurchasingApi;
}

function press(key: string): void {
  fireEvent.keyDown(document.body, { key });
}

async function openNewOrder(api: PurchasingApi, user: UserSummary = OWNER): Promise<void> {
  render(<SupplierOrderDialog api={api} isOwner={user.role === 'owner'} onClose={vi.fn()} />);
  await waitFor(() => expect(api.listOrders).toHaveBeenCalled());
  const button = await screen.findByRole('button', { name: /Pedido nuevo/ });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  await screen.findByRole('heading', { name: 'Pedido nuevo' });
}

function searchBox(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('textbox', { name: 'Buscar producto para el pedido' });
}

async function find(text: string): Promise<void> {
  fireEvent.change(searchBox(), { target: { value: text } });
  fireEvent.keyDown(searchBox(), { key: 'Enter' });
}

function lineBox(label: string): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('textbox', { name: label });
}

describe('the lines of an order', () => {
  it('shows a quantity the way it is typed and reads it without decimal numbers', () => {
    expect(quantityInputText(12_000, 'piece')).toBe('12');
    expect(quantityInputText(2_500, 'meter')).toBe('2.5');
    expect(quantityInputText(3_275, 'kilogram')).toBe('3.275');

    const line = lineFromCandidate(TAPE, 12_000);
    expect(readLine(line)).toEqual({ ok: true, request: { productId: TAPE.productId, supplierCode: 'CM-5', quantityMilli: 12_000, unitCostE6: 52_250_000 }, totalCents: 62_700 });
    expect(readLine({ ...line, quantityText: '2.5' })).toMatchObject({ ok: false, quantityProblem: 'Las piezas van enteras.' });
    expect(readLine({ ...line, quantityText: '0' })).toMatchObject({ ok: false, quantityProblem: 'Debe ser mayor que cero.' });
    expect(readLine({ ...line, costText: '1.5555555' })).toMatchObject({ ok: false, costProblem: 'El costo admite hasta 6 decimales.' });
    expect(readLine({ ...line, costText: '' })).toMatchObject({ ok: true, totalCents: null });
  });

  it('adds up the lines that have a cost and counts the ones that do not', () => {
    const lines = [lineFromCandidate(TAPE, 12_000), lineFromCandidate(CABLE, 2_500), { ...lineFromCandidate(TAPE, 1_000), costText: '0.333333' }];

    expect(totalsOf(lines)).toEqual({ totalCents: 62_700 + 33, linesWithoutCost: 1, isComplete: true });
    expect(totalsOf([...lines, { ...lines[0]!, quantityText: 'abc' }]).isComplete).toBe(false);
  });
});

describe('the order screen (E1-44)', () => {
  it('starts from the list: with no orders it says so and offers a new one and the suppliers', async () => {
    render(<SupplierOrderDialog api={apiWith()} isOwner onClose={vi.fn()} />);

    expect(await screen.findByText('Todavía no has hecho ningún pedido.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Proveedores/ })).toBeTruthy();
  });

  it('lists the orders with their folio, state and total, and reopens one', async () => {
    const api = apiWith({
      listOrders: vi.fn(() =>
        Promise.resolve([
          { id: savedOrder().id, folio: 1, supplierName: SUPPLIER.name, status: 'draft' as const, updatedAt: '2026-11-11T16:00:00.000Z', lineCount: 1, totalCents: 62_700 },
          { id: 'other', folio: 2, supplierName: SUPPLIER.name, status: 'sent' as const, updatedAt: '2026-11-11T16:00:00.000Z', lineCount: 3, totalCents: 1_000 },
        ]),
      ),
      getOrder: vi.fn(() => Promise.resolve(savedOrder())),
    });
    render(<SupplierOrderDialog api={api} isOwner onClose={vi.fn()} />);

    const table = await screen.findByRole('table', { name: 'Pedidos' });
    expect(within(table).getByText('Borrador')).toBeTruthy();
    expect(within(table).getByText('Enviado')).toBeTruthy();
    expect(within(table).getByText('$627.00')).toBeTruthy();
    fireEvent.click(within(table).getByRole('button', { name: 'PED-0001' }));

    expect(await screen.findByRole('heading', { name: 'Pedido PED-0001 · Borrador' })).toBeTruthy();
    expect(lineBox('Cantidad de Cinta métrica 5 m').value).toBe('12');
    expect(lineBox('Costo estimado de Cinta métrica 5 m').value).toBe('52.25');
    expect(screen.getByRole('status', { name: 'Total estimado del pedido' }).textContent).toContain('$627.00');
  });

  it('asks for a supplier first when there is none', async () => {
    const api = apiWith({ listSuppliers: vi.fn(() => Promise.resolve([])) });
    await openNewOrder(api);

    expect(screen.getByText(/Primero da de alta un proveedor/)).toBeTruthy();
  });

  it('adds a line by name, a scanned barcode adds one more piece, and the total follows without decimals', async () => {
    const api = apiWith();
    await openNewOrder(api);

    await find('cinta');
    expect(await screen.findByRole('table', { name: 'Renglones del pedido' })).toBeTruthy();
    expect(lineBox('Cantidad de Cinta métrica 5 m').value).toBe('1');
    expect(screen.getByRole('status', { name: 'Total estimado del pedido' }).textContent).toContain('$52.25');

    await find('7501234567890');
    await waitFor(() => expect(lineBox('Cantidad de Cinta métrica 5 m').value).toBe('2'));
    expect(screen.getByRole('status', { name: 'Total estimado del pedido' }).textContent).toContain('$104.50');
    expect(api.searchOrderProducts).toHaveBeenCalledWith({ supplierId: SUPPLIER.id, text: '7501234567890' });
    expect(screen.getAllByRole('row')).toHaveLength(2);

    fireEvent.change(lineBox('Cantidad de Cinta métrica 5 m'), { target: { value: '12' } });
    expect(screen.getByRole('status', { name: 'Total estimado del pedido' }).textContent).toContain('$627.00');
    fireEvent.change(lineBox('Costo estimado de Cinta métrica 5 m'), { target: { value: '' } });
    expect(screen.getByRole('status', { name: 'Total estimado del pedido' }).textContent).toContain('$0.00 · 1 renglón(es) sin costo no suman');
  });

  it('lists several matches to choose from, and tells when nothing matches', async () => {
    const api = apiWith({ searchOrderProducts: vi.fn(({ text }) => Promise.resolve(text === 'x' ? [TAPE, CABLE] : [])) });
    await openNewOrder(api);

    await find('nada');
    expect(await screen.findByText('No encontramos «nada». Busca por nombre, código de barras o código del proveedor.')).toBeTruthy();

    await find('x');
    const choices = await screen.findByRole('list', { name: 'Productos encontrados' });
    fireEvent.click(within(choices).getByRole('button', { name: /Cable THW/ }));

    expect(lineBox('Cantidad de Cable THW calibre 12').value).toBe('17');
    expect(screen.queryByRole('list', { name: 'Productos encontrados' })).toBeNull();
  });

  it('removes a line', async () => {
    await openNewOrder(apiWith());
    await find('cinta');
    await screen.findByRole('table', { name: 'Renglones del pedido' });

    fireEvent.click(screen.getByRole('button', { name: 'Quitar Cinta métrica 5 m' }));

    expect(screen.queryByRole('table', { name: 'Renglones del pedido' })).toBeNull();
    expect(screen.getByText(/Todavía no hay renglones/)).toBeTruthy();
  });

  it('does not save a line with a mistake: it marks it and asks the main process nothing', async () => {
    const api = apiWith();
    await openNewOrder(api);
    await find('cinta');
    await screen.findByRole('table', { name: 'Renglones del pedido' });
    fireEvent.change(lineBox('Cantidad de Cinta métrica 5 m'), { target: { value: '2.5' } });

    press('F2');

    expect(await screen.findByText('Revisa lo marcado en rojo.')).toBeTruthy();
    expect(screen.getByText('Las piezas van enteras.')).toBeTruthy();
    expect(api.saveOrder).not.toHaveBeenCalled();
  });

  it('saves a draft with the lines as whole numbers, and keeps working on it with its revision', async () => {
    const api = apiWith();
    await openNewOrder(api);
    await find('cinta');
    await screen.findByRole('table', { name: 'Renglones del pedido' });
    fireEvent.change(lineBox('Cantidad de Cinta métrica 5 m'), { target: { value: '12' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Notas del pedido' }), { target: { value: 'Urgente' } });

    press('F2');

    expect(await screen.findByText(/Borrador guardado: PED-0001/)).toBeTruthy();
    expect(api.saveOrder).toHaveBeenCalledWith({
      supplierId: SUPPLIER.id,
      notes: 'Urgente',
      lines: [{ productId: TAPE.productId, supplierCode: 'CM-5', quantityMilli: 12_000, unitCostE6: 52_250_000 }],
    });
    expect(screen.getByRole('heading', { name: 'Pedido PED-0001 · Borrador' })).toBeTruthy();

    fireEvent.change(lineBox('Cantidad de Cinta métrica 5 m'), { target: { value: '13' } });
    press('F2');
    await waitFor(() => expect(api.saveOrder).toHaveBeenCalledTimes(2));
    expect(api.saveOrder).toHaveBeenLastCalledWith(expect.objectContaining({ orderId: savedOrder().id, expectedRevision: 1 }));
  });

  it('needs the PIN of an owner from a cashier, and sends it with the request', async () => {
    const api = apiWith();
    await openNewOrder(api, CASHIER);
    await find('cinta');
    await screen.findByRole('table', { name: 'Renglones del pedido' });

    press('F2');
    expect(await screen.findByText('Pídele al dueño que escriba su PIN.')).toBeTruthy();
    expect(api.saveOrder).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('PIN del dueño'), { target: { value: '4321' } });
    press('F2');
    await waitFor(() => expect(api.saveOrder).toHaveBeenCalledWith(expect.objectContaining({ ownerPin: '4321' })));
  });

  it('tells a wrong PIN and clears it', async () => {
    const api = apiWith({ saveOrder: vi.fn(() => Promise.resolve({ status: 'wrong_pin' as const, attemptsLeft: 2 })) });
    await openNewOrder(api, CASHIER);
    await find('cinta');
    await screen.findByRole('table', { name: 'Renglones del pedido' });
    fireEvent.change(screen.getByLabelText('PIN del dueño'), { target: { value: '0000' } });

    press('F2');

    expect(await screen.findByText(/PIN del dueño incorrecto. Quedan 2 intentos/)).toBeTruthy();
    expect((screen.getByLabelText('PIN del dueño') as HTMLInputElement).value).toBe('');
  });

  it('asks to confirm before marking as sent, then saves, sends and leaves the order read only', async () => {
    const api = apiWith();
    await openNewOrder(api);
    await find('cinta');
    await screen.findByRole('table', { name: 'Renglones del pedido' });

    press('F4');
    expect(await screen.findByText(/¿Marcar como enviado\? Ya no se podrá cambiar/)).toBeTruthy();
    expect(api.markOrderSent).not.toHaveBeenCalled();

    press('F4');
    expect(await screen.findByText(/PED-0001 quedó como enviado/)).toBeTruthy();
    expect(api.markOrderSent).toHaveBeenCalledWith({ orderId: savedOrder().id, expectedRevision: 1 });
    expect(screen.getByRole('heading', { name: 'Pedido PED-0001 · Enviado' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Cantidad de Cinta métrica 5 m' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Guardar borrador/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Excel/ })).toBeTruthy();
  });

  it('cancels the confirmation with Esc and does not send', async () => {
    const api = apiWith();
    await openNewOrder(api);
    await find('cinta');
    await screen.findByRole('table', { name: 'Renglones del pedido' });
    press('F4');
    await screen.findByText(/¿Marcar como enviado\?/);

    press('Escape');

    await waitFor(() => expect(screen.queryByText(/¿Marcar como enviado\?/)).toBeNull());
    expect(api.markOrderSent).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Pedido nuevo' })).toBeTruthy();
  });

  it('does not send an order with no lines', async () => {
    const api = apiWith();
    await openNewOrder(api);

    press('F4');

    expect(await screen.findByText('Agrega al menos un renglón antes de marcarlo como enviado.')).toBeTruthy();
    expect(api.markOrderSent).not.toHaveBeenCalled();
  });

  it('gets the Excel file after saving the draft, and opens its folder', async () => {
    const api = apiWith();
    await openNewOrder(api);
    await find('cinta');
    await screen.findByRole('table', { name: 'Renglones del pedido' });

    press('F5');

    expect(await screen.findByText(/Archivo guardado en C:\\Pedidos\\PED-0001.xlsx/)).toBeTruthy();
    expect(api.saveOrder).toHaveBeenCalledTimes(1);
    expect(api.exportOrder).toHaveBeenCalledWith({ orderId: savedOrder().id, format: 'xlsx' });
    fireEvent.click(screen.getByRole('button', { name: /Abrir carpeta/ }));
    expect(api.revealFile).toHaveBeenCalledWith('C:\\Pedidos\\PED-0001.xlsx');
  });

  it('gets the PDF, and tells when the person closed the window to choose where to save', async () => {
    const api = apiWith({ exportOrder: vi.fn(() => Promise.resolve({ status: 'cancelled' as const })) });
    await openNewOrder(api);
    await find('cinta');
    await screen.findByRole('table', { name: 'Renglones del pedido' });

    press('F6');

    expect(await screen.findByText('No se guardó el archivo.')).toBeTruthy();
    expect(api.exportOrder).toHaveBeenCalledWith({ orderId: savedOrder().id, format: 'pdf' });
    expect(screen.queryByRole('button', { name: /Abrir carpeta/ })).toBeNull();
  });

  it('suggests what is low and adds it with the suggested quantity, which can then be changed', async () => {
    const api = apiWith();
    await openNewOrder(api);

    press('F7');
    const suggestion = await screen.findByRole('button', { name: /Agregar Cable THW calibre 12: pedir 17.000 m/ });
    fireEvent.click(suggestion);

    expect(lineBox('Cantidad de Cable THW calibre 12').value).toBe('17');
    fireEvent.change(lineBox('Cantidad de Cable THW calibre 12'), { target: { value: '5.5' } });
    expect(lineBox('Cantidad de Cable THW calibre 12').value).toBe('5.5');
    expect(screen.getByText('Sugerido: 17')).toBeTruthy();
  });

  it('explains how to set the minimums when nothing is low, and sets one from the line', async () => {
    const api = apiWith({
      suggestOrderProducts: vi.fn(() => Promise.resolve([])),
      setReorderLevel: vi.fn(() => Promise.resolve({ status: 'saved' as const, candidate: { ...TAPE, minimumMilli: 5_000, maximumMilli: null, suggestedMilli: 8_000 } })),
    });
    await openNewOrder(api);
    press('F7');
    expect(await screen.findByText(/Ningún producto con mínimo está bajo/)).toBeTruthy();

    await find('cinta');
    await screen.findByRole('table', { name: 'Renglones del pedido' });
    fireEvent.click(screen.getByRole('button', { name: 'Mínimo de Cinta métrica 5 m' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Mínimo' }), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar mínimo' }));

    expect(await screen.findByText(/Cuando Cinta métrica 5 m baje de 5 pza/)).toBeTruthy();
    expect(api.setReorderLevel).toHaveBeenCalledWith({ productId: TAPE.productId, minimumMilli: 5_000, maximumMilli: null });
    expect(screen.getByText('Sugerido: 8')).toBeTruthy();
  });

  it('shows the order that changed meanwhile and writes nothing when the main process says it is stale', async () => {
    const newer = savedOrder({ revision: 3, notes: 'Otro lo cambió' });
    const api = apiWith({ saveOrder: vi.fn(() => Promise.resolve({ status: 'stale' as const, order: newer })) });
    await openNewOrder(api);
    await find('cinta');
    await screen.findByRole('table', { name: 'Renglones del pedido' });

    press('F2');

    expect(await screen.findByText(/Este pedido cambió mientras lo editabas/)).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Notas del pedido' }) as HTMLInputElement).value).toBe('Otro lo cambió');
  });

  it('discards a saved draft only after a second press, and goes back to the list', async () => {
    const api = apiWith({
      listOrders: vi.fn(() => Promise.resolve([{ id: savedOrder().id, folio: 1, supplierName: SUPPLIER.name, status: 'draft' as const, updatedAt: '2026-11-11T16:00:00.000Z', lineCount: 1, totalCents: 62_700 }])),
      getOrder: vi.fn(() => Promise.resolve(savedOrder())),
    });
    render(<SupplierOrderDialog api={api} isOwner onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'PED-0001' }));
    await screen.findByRole('heading', { name: 'Pedido PED-0001 · Borrador' });

    press('F8');
    expect(await screen.findByText(/¿Descartar este borrador\?/)).toBeTruthy();
    expect(api.discardOrder).not.toHaveBeenCalled();
    press('F8');

    await waitFor(() => expect(api.discardOrder).toHaveBeenCalledWith({ orderId: savedOrder().id, expectedRevision: 1 }));
    expect(await screen.findByRole('heading', { name: 'Pedido al proveedor' })).toBeTruthy();
  });
});

describe('opening the orders (E1-44)', () => {
  function posApiWith(user: UserSummary): PosApi {
    const api: Partial<PosApi> = {
      getAppInfo: () => Promise.resolve({ version: '1.0.0' }),
      getAuthState: () => Promise.resolve({ needsSetup: false, users: [user], current: user }),
      getAppearance: () => Promise.resolve(DEFAULT_APPEARANCE),
      getCashStatus: () => Promise.resolve(OPEN_CASH),
      listPendingSales: () => Promise.resolve([]),
    };
    return api as PosApi;
  }

  it('opens from the sale screen with F11, and Esc goes back to the sale', async () => {
    render(<App posApi={posApiWith(OWNER)} purchasingApi={apiWith()} />);
    const lookup = await screen.findByRole('combobox', { name: 'Buscar producto' });

    fireEvent.keyDown(lookup, { key: 'F11' });

    expect(await screen.findByRole('heading', { name: 'Pedido al proveedor', hidden: true })).toBeTruthy();
    press('Escape');
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Pedido al proveedor', hidden: true })).toBeNull());
  });

  it('does nothing on F11 when the register offers no orders', async () => {
    render(<App posApi={posApiWith(OWNER)} />);
    const lookup = await screen.findByRole('combobox', { name: 'Buscar producto' });

    fireEvent.keyDown(lookup, { key: 'F11' });

    expect(screen.queryByRole('heading', { name: 'Pedido al proveedor', hidden: true })).toBeNull();
  });

  it('opens from the inventory of the administration with F11, and comes back to the administration', async () => {
    const posApi = { ...posApiWith(OWNER), getBackupStatus: () => Promise.resolve({ folder: null, lastBackupAt: null, lastError: null }) } as PosApi;
    render(<App posApi={posApi} purchasingApi={apiWith()} />);
    fireEvent.keyDown(await screen.findByRole('combobox', { name: 'Buscar producto' }), { key: 'F1' });
    await screen.findByRole('heading', { name: 'Administración', hidden: true });
    press('F2');
    await screen.findByRole('heading', { name: 'Inventario', hidden: true });

    press('F11');

    expect(await screen.findByRole('heading', { name: 'Pedido al proveedor', hidden: true })).toBeTruthy();
    press('Escape');
    expect(await screen.findByRole('heading', { name: 'Administración', hidden: true })).toBeTruthy();
  });
});
