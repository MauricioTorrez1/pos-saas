import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { UserSummary } from '../../shared/auth';
import type { DashboardApi, DashboardRequest, DashboardResult, DashboardSummary, ExportResult, PeriodTotals } from '../../shared/dashboard-api';
import { DashboardDialog } from './DashboardDialog';

const OWNER: UserSummary = { id: 'owner-id', name: 'Mauricio', role: 'owner' };
const CASHIER: UserSummary = { id: 'cashier-id', name: 'Ana', role: 'cashier' };

const TOTALS: PeriodTotals = {
  salesCount: 3,
  totalCents: 50_494,
  subtotalCents: 43_529,
  taxCents: 6_965,
  lineCount: 4,
  averageTicketCents: 16_831,
  linesPerTicketX100: 133,
  returnsCount: 1,
  returnsCents: 11_600,
  netCents: 38_894,
  netSubtotalCents: 33_529,
  costOfGoodsCents: 19_638,
  grossProfitCents: 13_891,
  marginBp: 4_143,
  productsWithoutCostSold: 1,
};

function summaryOf(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    scope: 'business',
    includesCosts: true,
    generatedAt: '2026-11-12T18:00:00.000Z',
    period: { kind: 'day', fromDay: '2026-11-10', toDay: '2026-11-10', dayCount: 1 },
    previousPeriod: { kind: 'day', fromDay: '2026-11-09', toDay: '2026-11-09', dayCount: 1 },
    isInProgress: false,
    totals: TOTALS,
    previousTotals: { ...TOTALS, totalCents: 25_247, salesCount: 0 },
    cancellations: { count: 1, totalCents: 11_600 },
    paymentKinds: [
      { kind: 'cash', salesCount: 1, totalCents: 23_200 },
      { kind: 'card', salesCount: 0, totalCents: 0 },
      { kind: 'transfer', salesCount: 1, totalCents: 11_600 },
      { kind: 'mixed', salesCount: 1, totalCents: 15_694 },
    ],
    methodAmounts: [
      { method: 'cash', amountCents: 31_047 },
      { method: 'card', amountCents: 7_847 },
      { method: 'transfer', amountCents: 11_600 },
    ],
    trendUnit: 'day',
    trend: [{ key: '2026-11-10', salesCount: 3, totalCents: 50_494 }],
    byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, salesCount: hour === 10 ? 2 : 0, totalCents: hour === 10 ? 38_894 : 0 })),
    byWeekday: Array.from({ length: 7 }, (_, weekday) => ({ weekday, salesCount: weekday === 1 ? 3 : 0, totalCents: weekday === 1 ? 50_494 : 0 })),
    byCashier: [{ name: 'Mauricio', salesCount: 3, totalCents: 50_494 }],
    topMetric: 'quantity',
    topLimit: 10,
    topSellers: [
      { rank: 1, productId: 'cable', name: 'Cable THW', unit: 'meter', quantityMilli: 12_250, amountCents: 15_313, profitCents: 7_076, costE6: 5_000_000, costSource: 'average' },
      { rank: 2, productId: 'nails', name: 'Clavos', unit: 'kilogram', quantityMilli: 1_500, amountCents: 4_500, profitCents: null, costE6: null, costSource: 'none' },
      { rank: 3, productId: 'hammer', name: 'Martillo', unit: 'piece', quantityMilli: 3_000, amountCents: 34_800, profitCents: 12_000, costE6: 60_000_000, costSource: 'typed' },
    ],
    inventory: {
      valueCents: 650_000,
      stockedWithoutCost: 1,
      notSelling: { total: 2, items: [{ productId: 'paint', name: 'Pintura', unit: 'piece', stockMilli: 5_000, valueCents: 50_000 }] },
      outOfStock: { total: 1, items: [{ productId: 'brush', name: 'Brochas', unit: 'piece', stockMilli: 0, valueCents: null }] },
      runningLow: { total: 0, items: [] },
      withoutCost: { total: 1, items: [{ productId: 'nails', name: 'Clavos', unit: 'kilogram', stockMilli: 20_000, valueCents: null }] },
    },
    ...overrides,
  };
}

const SHIFT_SUMMARY = summaryOf({
  scope: 'shift',
  includesCosts: false,
  period: { kind: 'shift', fromDay: '2026-11-12', toDay: '2026-11-12', dayCount: 1 },
  previousPeriod: null,
  previousTotals: null,
  totals: { ...TOTALS, costOfGoodsCents: null, grossProfitCents: null, marginBp: null, productsWithoutCostSold: 0 },
  byCashier: null,
  inventory: null,
  topSellers: [{ rank: 1, productId: 'hammer', name: 'Martillo', unit: 'piece', quantityMilli: 1_000, amountCents: 11_600, profitCents: null, costE6: null, costSource: null }],
});

beforeAll(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
});

afterEach(cleanup);

function apiWith(answer: (request: DashboardRequest) => DashboardResult, exportAnswer: ExportResult = { status: 'saved', path: 'C:\\Documentos\\resumen.xlsx' }) {
  const getDashboard = vi.fn((request: DashboardRequest) => Promise.resolve(answer(request)));
  const exportDashboard = vi.fn(() => Promise.resolve(exportAnswer));
  const api: DashboardApi = { getDashboard, exportDashboard };
  return { api, getDashboard, exportDashboard };
}

const ok = (summary: DashboardSummary): DashboardResult => ({ status: 'ok', summary });

describe('the summary for the owner', () => {
  it('shows the indicators with their comparison, costs and the note about products without a cost', async () => {
    const { api } = apiWith(() => ok(summaryOf()));
    render(<DashboardDialog api={api} user={OWNER} onClose={() => undefined} />);

    const indicators = await screen.findByLabelText('Indicadores del periodo');

    expect(within(indicators).getByText('$504.94')).toBeTruthy();
    expect(within(indicators).getByText('Sin IVA $435.29 · IVA $69.65')).toBeTruthy();
    expect(within(indicators).getByText('$168.31')).toBeTruthy();
    expect(within(indicators).getByText('1.33')).toBeTruthy();
    expect(within(indicators).getByText('$388.94')).toBeTruthy();
    expect(within(indicators).getByText('$138.91')).toBeTruthy();
    expect(within(indicators).getByText('41.43 %')).toBeTruthy();
    // 50,494 against 25,247 is up 100 %.
    expect(within(indicators).getAllByText(/\+100\.0 % · antes \$252\.47/).length).toBe(1);
    expect(within(indicators).getByText('No aplica')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('1 producto(s) que se vendieron no tienen costo');
    expect(screen.getByRole('heading', { name: 'Resumen del negocio' })).toBeTruthy();
  });

  it('asks for another period and moves with the arrows', async () => {
    const { api, getDashboard } = apiWith(() => ok(summaryOf()));
    render(<DashboardDialog api={api} user={OWNER} onClose={() => undefined} />);
    await screen.findByLabelText('Indicadores del periodo');

    fireEvent.click(screen.getByRole('button', { name: 'Semana' }));
    await waitFor(() => expect(getDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ period: 'week' })));
    const firstDate = (getDashboard.mock.lastCall?.[0] as DashboardRequest).date;
    fireEvent.click(screen.getByRole('button', { name: 'Periodo anterior' }));
    await waitFor(() => expect((getDashboard.mock.lastCall?.[0] as DashboardRequest).date).not.toBe(firstDate));
    expect((getDashboard.mock.lastCall?.[0] as DashboardRequest).date < firstDate).toBe(true);
  });

  it('offers two dates for a custom range and refuses a range that runs backwards', async () => {
    const { api, getDashboard } = apiWith(() => ok(summaryOf()));
    render(<DashboardDialog api={api} user={OWNER} onClose={() => undefined} />);
    await screen.findByLabelText('Indicadores del periodo');

    fireEvent.click(screen.getByRole('button', { name: 'Rango' }));
    const [from, to] = [screen.getByLabelText('Desde'), screen.getByLabelText('Hasta')];
    fireEvent.change(from, { target: { value: '2026-11-01' } });
    fireEvent.change(to, { target: { value: '2026-11-10' } });
    await waitFor(() => expect(getDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ period: 'custom', date: '2026-11-01', endDate: '2026-11-10' })));

    const calls = getDashboard.mock.calls.length;
    fireEvent.change(to, { target: { value: '2026-10-01' } });
    expect((await screen.findByRole('alert')).textContent).toContain('Revisa las fechas');
    expect(getDashboard.mock.calls.length).toBe(calls);
  });

  it('draws the charts with a text for the screen reader and the same numbers as a table', async () => {
    const { api } = apiWith(() => ok(summaryOf()));
    render(<DashboardDialog api={api} user={OWNER} onClose={() => undefined} />);
    await screen.findByLabelText('Indicadores del periodo');

    const chart = screen.getByRole('img', { name: 'Ventas por hora del día' });
    expect(chart.querySelector('title')?.textContent).toBe('Ventas por hora del día. La barra más alta es 10h, con $388.94.');
    expect(chart.querySelectorAll('rect')).toHaveLength(24);
    const table = screen.getByRole('table', { name: 'Ventas por hora del día, tabla', hidden: true });
    expect(within(table).getAllByRole('row', { hidden: true })).toHaveLength(25);
    expect(within(table).getByText('$388.94')).toBeTruthy();
  });

  it('says there were no sales in a chart without any', async () => {
    const empty = summaryOf({
      totals: { ...TOTALS, salesCount: 0, totalCents: 0 },
      byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, salesCount: 0, totalCents: 0 })),
    });
    const { api } = apiWith(() => ok(empty));
    render(<DashboardDialog api={api} user={OWNER} onClose={() => undefined} />);

    const chart = await screen.findByRole('img', { name: 'Ventas por hora del día' });

    expect(chart.querySelector('title')?.textContent).toBe('Ventas por hora del día. No hubo ventas.');
  });

  it('lists the best sellers with units, flags a product without a cost, and changes the order and the size', async () => {
    const { api, getDashboard } = apiWith(() => ok(summaryOf()));
    render(<DashboardDialog api={api} user={OWNER} onClose={() => undefined} />);
    await screen.findByLabelText('Indicadores del periodo');

    fireEvent.click(screen.getByRole('tab', { name: 'Más vendidos' }));
    const table = screen.getByRole('table', { name: 'Productos más vendidos' });
    const rows = within(table).getAllByRole('row');

    expect(within(rows[1]!).getByText('12.250 m')).toBeTruthy();
    expect(within(rows[2]!).getByText('1.500 kg')).toBeTruthy();
    expect(within(rows[2]!).getByText('sin costo')).toBeTruthy();
    expect(within(rows[3]!).getByText('3 pza')).toBeTruthy();
    expect(within(rows[1]!).getByText('$5.00')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Por importe' }));
    await waitFor(() => expect(getDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ topMetric: 'amount', topLimit: 10 })));
    fireEvent.click(screen.getByRole('button', { name: 'Top 50' }));
    await waitFor(() => expect(getDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ topMetric: 'amount', topLimit: 50 })));
  });

  it('shows the inventory with what has no cost, and cuts nothing silently', async () => {
    const { api } = apiWith(() => ok(summaryOf()));
    render(<DashboardDialog api={api} user={OWNER} onClose={() => undefined} />);
    await screen.findByLabelText('Indicadores del periodo');

    fireEvent.click(screen.getByRole('tab', { name: 'Inventario' }));

    expect(screen.getByText('$6,500.00')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Agotados o en negativo' })).toBeTruthy();
    const notSelling = screen.getByRole('region', { name: 'Sin movimiento' });
    expect(within(notSelling).getByText('Pintura')).toBeTruthy();
    expect(within(notSelling).getByText(/Se muestran los primeros 1/)).toBeTruthy();
  });

  it('saves the Excel file and the PDF, and says where', async () => {
    const { api, exportDashboard } = apiWith(() => ok(summaryOf()));
    render(<DashboardDialog api={api} user={OWNER} onClose={() => undefined} />);
    await screen.findByLabelText('Indicadores del periodo');

    fireEvent.click(screen.getByRole('button', { name: /Excel/ }));
    expect((await screen.findByRole('status')).textContent).toContain('C:\\Documentos\\resumen.xlsx');
    expect(exportDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ period: 'day' }), 'xlsx');
    fireEvent.click(screen.getByRole('button', { name: /PDF/ }));
    await waitFor(() => expect(exportDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ period: 'day' }), 'pdf'));
  });

  it('answers the keys: F3 for Excel, F4 for PDF and Esc to leave', async () => {
    const { api, exportDashboard } = apiWith(() => ok(summaryOf()));
    const onClose = vi.fn();
    render(<DashboardDialog api={api} user={OWNER} onClose={onClose} />);
    await screen.findByLabelText('Indicadores del periodo');

    fireEvent.keyDown(window, { key: 'F3' });
    await waitFor(() => expect(exportDashboard).toHaveBeenCalledWith(expect.anything(), 'xlsx'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tells the person when the summary could not be read', async () => {
    const getDashboard = vi.fn(() => Promise.reject(new Error('boom')));
    render(<DashboardDialog api={{ getDashboard, exportDashboard: vi.fn() }} user={OWNER} onClose={() => undefined} />);

    expect((await screen.findByRole('alert')).textContent).toContain('No se pudo leer el resumen');
  });
});

describe('the summary for a cashier', () => {
  it('shows only the shift, with no period, costs, profit or inventory', async () => {
    const { api } = apiWith(() => ok(SHIFT_SUMMARY));
    render(<DashboardDialog api={api} user={CASHIER} onClose={() => undefined} />);

    await screen.findByText('Mi turno');

    expect(screen.queryByRole('group', { name: 'Periodo' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Inventario' })).toBeNull();
    expect(screen.queryByText(/Utilidad|Costo|Margen|Inventario a costo/)).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Más vendidos' }));
    expect(screen.queryByRole('button', { name: 'Por utilidad' })).toBeNull();
    expect(screen.queryByText(/Costo unitario|Utilidad/)).toBeNull();
  });

  it('opens the whole summary with the PIN of an owner and explains a wrong one', async () => {
    const answer = vi.fn((request: DashboardRequest): DashboardResult => {
      if (request.ownerPin === '4321') {
        return ok(summaryOf());
      }
      return request.ownerPin === undefined ? ok(SHIFT_SUMMARY) : { status: 'wrong_pin', attemptsLeft: 4 };
    });
    const { api, getDashboard } = apiWith(answer);
    render(<DashboardDialog api={api} user={CASHIER} onClose={() => undefined} />);
    await screen.findByText('Mi turno');

    fireEvent.click(screen.getByRole('button', { name: /Ver el resumen completo/ }));
    const pin = screen.getByLabelText('PIN del dueño');
    fireEvent.change(pin, { target: { value: '0000' } });
    fireEvent.keyDown(pin, { key: 'Enter' });
    expect((await screen.findAllByRole('alert'))[0]!.textContent).toContain('Te quedan 4 intento(s)');
    expect(screen.queryByRole('group', { name: 'Periodo' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Ver el resumen completo/ }));
    const second = screen.getByLabelText('PIN del dueño');
    fireEvent.change(second, { target: { value: '4321' } });
    fireEvent.keyDown(second, { key: 'Enter' });

    expect(await screen.findByRole('heading', { name: 'Resumen del negocio' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Periodo' })).toBeTruthy();
    expect(getDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ ownerPin: '4321' }));
    expect(screen.queryByText(/Te quedan/)).toBeNull();
  });
});
