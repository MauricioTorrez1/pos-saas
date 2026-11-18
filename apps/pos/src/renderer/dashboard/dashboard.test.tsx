import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { UserSummary } from '../../shared/auth';
import type { BusinessReportRequest, DashboardApi, DashboardRequest, DashboardResult, DashboardSummary, ExportResult, PeriodTotals } from '../../shared/dashboard-api';
import type {
  Expense,
  ExpenseListResult,
  ExpenseRequest,
  ExpensesApi,
  RecordExpenseResult,
  SaveConceptsResult,
  VoidExpenseResult,
} from '../../shared/expenses';
import type { IncomeStatement, StatementResult } from '../../shared/income-statement';
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
    cashMovements: { inCents: 10_000, outCents: 65_000, drawerExpensesCents: 45_000 },
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
  cashMovements: null,
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
  const getIncomeStatement = vi.fn(() => Promise.resolve<StatementResult>({ status: 'ok', statement: STATEMENT }));
  const exportIncomeStatement = vi.fn(() => Promise.resolve(exportAnswer));
  const exportBusinessReport = vi.fn((_request: BusinessReportRequest) => Promise.resolve(exportAnswer));
  const api: DashboardApi = { getDashboard, exportDashboard, getIncomeStatement, exportIncomeStatement, exportBusinessReport };
  return { api, getDashboard, exportDashboard, getIncomeStatement, exportIncomeStatement, exportBusinessReport };
}

const ok = (summary: DashboardSummary): DashboardResult => ({ status: 'ok', summary });

describe('the search bar of «Resumen» (E1-50)', () => {
  it('finds sales by ticket, product or code and shows which products matched', async () => {
    const { api } = apiWith(() => ok(summaryOf()));
    const searchSales = vi.fn((text: string) =>
      Promise.resolve(
        text === 'cinta'
          ? [{ saleId: 'sale-9', folio: 'T1-000009', completedAt: '2026-11-15T18:00:00.000Z', totalCents: 4_500, refundedCents: 0, cashierName: 'Ana', lineCount: 3, matchedProducts: ['Cinta de aislar 3M'] }]
          : [],
      ),
    );
    render(<DashboardDialog api={api} user={OWNER} onClose={() => undefined} searchSales={searchSales} />);
    await screen.findByLabelText('Indicadores del periodo');

    fireEvent.change(screen.getByLabelText('Buscar ticket, producto o código'), { target: { value: 'cinta' } });
    const results = await screen.findByRole('table', { name: 'Ventas encontradas', hidden: true });
    expect(results.textContent).toContain('T1-000009');
    expect(results.textContent).toContain('Cinta de aislar 3M');
    expect(results.textContent).toContain('$45.00');

    fireEvent.change(screen.getByLabelText('Buscar ticket, producto o código'), { target: { value: 'serrucho' } });
    expect(await screen.findByText('Ninguna venta tiene ese ticket, producto o código.')).toBeTruthy();
    expect(searchSales).toHaveBeenLastCalledWith('serrucho');
  });

  it('is not offered to a cashier who only sees the shift', async () => {
    const { api } = apiWith(() => ok(summaryOf({ scope: 'shift' })));
    render(<DashboardDialog api={api} user={CASHIER} onClose={() => undefined} searchSales={() => Promise.resolve([])} />);
    await screen.findByLabelText('Indicadores del periodo');

    expect(screen.queryByLabelText('Buscar ticket, producto o código')).toBeNull();
  });
});

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

  it('saves the illustrated report with F5 for the period above, and says where (E1-57)', async () => {
    const { api, exportBusinessReport } = apiWith(() => ok(summaryOf()), { status: 'saved', path: 'C:\Documentos\reporte.pdf' });
    render(<DashboardDialog api={api} user={OWNER} onClose={() => undefined} />);
    await screen.findByLabelText('Indicadores del periodo');

    fireEvent.click(screen.getByRole('button', { name: 'Mes' }));
    fireEvent.keyDown(window, { key: 'F5' });

    expect((await screen.findByRole('status')).textContent).toContain('C:\Documentos\reporte.pdf');
    expect(exportBusinessReport).toHaveBeenCalledWith(expect.objectContaining({ period: 'month' }));
    expect(exportBusinessReport.mock.calls[0]?.[0]).not.toHaveProperty('ownerPin');
  });

  it('says it when the illustrated report could not be saved', async () => {
    const { api } = apiWith(() => ok(summaryOf()), { status: 'failed', message: 'No se pudo guardar el archivo.' });
    render(<DashboardDialog api={api} user={OWNER} onClose={() => undefined} />);
    await screen.findByLabelText('Indicadores del periodo');

    fireEvent.click(screen.getByRole('button', { name: /Reporte ilustrado/ }));

    expect((await screen.findByRole('alert')).textContent).toContain('No se pudo guardar el archivo.');
  });

  it('tells the person when the summary could not be read', async () => {
    const getDashboard = vi.fn(() => Promise.reject(new Error('boom')));
    render(<DashboardDialog api={{ getDashboard, exportDashboard: vi.fn(), getIncomeStatement: vi.fn(), exportIncomeStatement: vi.fn(), exportBusinessReport: vi.fn() }} user={OWNER} onClose={() => undefined} />);

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

  it('offers the illustrated report only with the PIN of an owner, and sends that PIN (E1-57)', async () => {
    const answer = (request: DashboardRequest): DashboardResult => (request.ownerPin === '4321' ? ok(summaryOf()) : ok(SHIFT_SUMMARY));
    const { api, exportBusinessReport } = apiWith(answer);
    render(<DashboardDialog api={api} user={CASHIER} onClose={() => undefined} />);
    await screen.findByText('Mi turno');

    expect(screen.queryByRole('button', { name: /Reporte ilustrado/ })).toBeNull();
    fireEvent.keyDown(window, { key: 'F5' });
    expect(exportBusinessReport).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Ver el resumen completo/ }));
    const pin = screen.getByLabelText('PIN del dueño');
    fireEvent.change(pin, { target: { value: '4321' } });
    fireEvent.keyDown(pin, { key: 'Enter' });
    await screen.findByRole('heading', { name: 'Resumen del negocio' });

    fireEvent.click(screen.getByRole('button', { name: /Reporte ilustrado/ }));
    await waitFor(() => expect(exportBusinessReport).toHaveBeenCalledWith(expect.objectContaining({ ownerPin: '4321', period: 'day' })));
  });
});

const STATEMENT: IncomeStatement = {
  period: { kind: 'day', fromDay: '2026-11-10', toDay: '2026-11-10', dayCount: 1 },
  generatedAt: '2026-11-12T18:00:00.000Z',
  hasActivity: true,
  grossSales: { amountCents: 43_529, shareBp: 12_982 },
  returns: { amountCents: 10_000, shareBp: 2_982 },
  discounts: { amountCents: 0, shareBp: 0 },
  netSales: { amountCents: 33_529, shareBp: 10_000 },
  costOfGoods: { amountCents: 19_638, shareBp: 5_857 },
  grossProfit: { amountCents: 13_891, shareBp: 4_143 },
  operatingExpenses: { amountCents: 20_000, shareBp: 5_965 },
  operatingProfit: { amountCents: -6_109, shareBp: -1_822 },
  netProfit: { amountCents: -6_109, shareBp: -1_822 },
  vatCollectedCents: 5_365,
  uncosted: { productCount: 1, netSalesCents: 1_000 },
  detail: {
    byTaxRate: [{ factor: 'rate', rateBp: 1600, soldCents: 43_529, returnedCents: 10_000, netCents: 33_529 }],
    costByProduct: [{ name: 'Martillo', costCents: 18_000, isRest: false }],
    expensesByConcept: [{ concept: 'Renta', amountCents: 20_000, count: 1, fromDrawerCents: 0 }],
  },
};

describe('the groups of «Resumen» (E1-56)', () => {
  it('puts the related numbers together under a heading', async () => {
    const { api } = apiWith(() => ok(summaryOf()));
    render(<DashboardDialog api={api} user={OWNER} onClose={() => undefined} />);
    await screen.findByLabelText('Indicadores del periodo');

    for (const title of ['Ventas', 'Clientes y tickets', 'Rentabilidad', 'Devoluciones y cancelaciones', 'Formas de pago', 'Caja', 'Cuándo se vende']) {
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    }
    const profit = screen.getByRole('region', { name: 'Rentabilidad' });
    expect(within(profit).getByText('Utilidad bruta')).toBeTruthy();
    expect(within(profit).getByText('Inventario a costo')).toBeTruthy();
    const drawer = screen.getByRole('region', { name: 'Caja' });
    expect(within(drawer).getByText('$650.00')).toBeTruthy();
    expect(within(drawer).getByText('Retiros y pagos · de ellos, gastos $450.00')).toBeTruthy();
    expect(within(drawer).getByRole('table', { name: 'Ventas por cajero' })).toBeTruthy();
  });

  it('keeps the comparison with the period before inside each group', async () => {
    const { api } = apiWith(() => ok(summaryOf()));
    render(<DashboardDialog api={api} user={OWNER} onClose={() => undefined} />);
    await screen.findByLabelText('Indicadores del periodo');

    expect(within(screen.getByRole('region', { name: 'Ventas' })).getByText('+100.0 % · antes $252.47')).toBeTruthy();
  });
});

describe('the income statement tab (E1-56)', () => {
  it('shows the general view with a sentence under each line, and the detail by rate, product and concept', async () => {
    const { api, getIncomeStatement } = apiWith(() => ok(summaryOf()));
    render(<DashboardDialog api={api} user={OWNER} onClose={() => undefined} />);
    await screen.findByLabelText('Indicadores del periodo');

    fireEvent.click(screen.getByRole('tab', { name: 'Estado de resultados' }));

    const general = await screen.findByRole('table', { name: 'Estado de resultados, vista general' });
    expect(within(general).getByText('Ventas netas')).toBeTruthy();
    expect(within(general).getByText('Lo que vendiste sin IVA, menos lo que devolviste.')).toBeTruthy();
    expect(within(general).getByText('$335.29')).toBeTruthy();
    expect(within(general).getByText('41.43 %')).toBeTruthy();
    expect(within(general).getAllByText('−$61.09')).toHaveLength(2);
    expect(screen.getByText(/1 producto\(s\) se vendieron sin costo/)).toBeTruthy();
    expect(screen.getByText(/IVA cobrado: \$53.65/)).toBeTruthy();
    expect(getIncomeStatement).toHaveBeenLastCalledWith({ period: 'day', date: expect.any(String) });

    fireEvent.click(screen.getByRole('button', { name: 'Detallado' }));
    expect(within(screen.getByRole('table', { name: 'Ventas por tasa de IVA' })).getByText('Con IVA 16 %')).toBeTruthy();
    expect(within(screen.getByRole('table', { name: 'Costo de lo vendido por producto' })).getByText('Martillo')).toBeTruthy();
    expect(within(screen.getByRole('table', { name: 'Gastos de operación por concepto' })).getByText('Renta')).toBeTruthy();
  });

  it('reads «Desde el inicio» and saves the statement alone with F3', async () => {
    const { api, getIncomeStatement, exportIncomeStatement } = apiWith(() => ok(summaryOf()));
    render(<DashboardDialog api={api} user={OWNER} onClose={() => undefined} />);
    await screen.findByLabelText('Indicadores del periodo');
    fireEvent.click(screen.getByRole('tab', { name: 'Estado de resultados' }));
    await screen.findByRole('table', { name: 'Estado de resultados, vista general' });

    fireEvent.click(screen.getByRole('button', { name: 'Desde el inicio' }));
    await waitFor(() => expect(getIncomeStatement).toHaveBeenLastCalledWith(expect.objectContaining({ period: 'all' })));

    fireEvent.keyDown(window, { key: 'F3' });
    await waitFor(() => expect(exportIncomeStatement).toHaveBeenCalledWith(expect.objectContaining({ period: 'all' }), 'xlsx'));
  });

  it('is not offered to a cashier on their shift', async () => {
    const { api } = apiWith(() => ok(SHIFT_SUMMARY));
    render(<DashboardDialog api={api} user={CASHIER} onClose={() => undefined} expensesApi={expensesApiWith().api} />);
    await screen.findByText('Mi turno');

    expect(screen.queryByRole('tab', { name: 'Estado de resultados' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Gastos' })).toBeNull();
  });
});

function expensesApiWith() {
  const expense: Expense = {
    id: 'expense-1',
    concept: 'Luz',
    amountCents: 45_050,
    day: '2026-11-10',
    note: 'recibo de octubre',
    paidFromDrawer: true,
    recordedBy: 'Mauricio',
    recordedAt: '2026-11-10T18:00:00.000Z',
    voided: null,
  };
  const record = vi.fn((request: ExpenseRequest) => Promise.resolve<RecordExpenseResult>({ status: 'recorded', expense: { ...expense, amountCents: request.amountCents } }));
  const list = vi.fn(() => Promise.resolve<ExpenseListResult>({ status: 'ok', expenses: [expense], concepts: ['Renta', 'Luz'] }));
  const voidExpense = vi.fn(() => Promise.resolve<VoidExpenseResult>({ status: 'voided', returnedToDrawer: true }));
  const saveConcepts = vi.fn((request: { concepts: readonly string[] }) => Promise.resolve<SaveConceptsResult>({ status: 'saved', concepts: request.concepts.filter((concept) => concept !== '') }));
  const api: ExpensesApi = { record, list, void: voidExpense, saveConcepts };
  return { api, record, list, voidExpense, saveConcepts };
}

describe('the expenses tab (E1-56)', () => {
  it('records an expense in cents, from the drawer when the owner says so', async () => {
    const { api } = apiWith(() => ok(summaryOf()));
    const expenses = expensesApiWith();
    render(<DashboardDialog api={api} user={OWNER} onClose={() => undefined} expensesApi={expenses.api} />);
    await screen.findByLabelText('Indicadores del periodo');

    fireEvent.click(screen.getByRole('tab', { name: 'Gastos' }));
    const form = await screen.findByRole('form', { name: 'Anotar un gasto' });
    await waitFor(() => expect((within(form).getByLabelText('Concepto') as HTMLSelectElement).value).toBe('Renta'));
    fireEvent.change(within(form).getByLabelText('Monto'), { target: { value: '450.50' } });
    fireEvent.click(within(form).getByLabelText(/Lo pagué con dinero de la caja/));
    fireEvent.click(within(form).getByRole('button', { name: 'Anotar gasto' }));

    await waitFor(() => expect(expenses.record).toHaveBeenCalledWith(expect.objectContaining({ concept: 'Renta', amountCents: 45_050, paidFromDrawer: true, note: null })));
    expect((await screen.findByRole('status')).textContent).toContain('salió de la caja');
    expect(within(screen.getByRole('table', { name: 'Gastos del periodo' })).getByText(/recibo de octubre/)).toBeTruthy();
  });

  it('refuses an amount that is not money before asking the main process', async () => {
    const { api } = apiWith(() => ok(summaryOf()));
    const expenses = expensesApiWith();
    render(<DashboardDialog api={api} user={OWNER} onClose={() => undefined} expensesApi={expenses.api} />);
    await screen.findByLabelText('Indicadores del periodo');
    fireEvent.click(screen.getByRole('tab', { name: 'Gastos' }));
    const form = await screen.findByRole('form', { name: 'Anotar un gasto' });

    fireEvent.change(within(form).getByLabelText('Monto'), { target: { value: '0' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Anotar gasto' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Escribe el monto en pesos');
    expect(expenses.record).not.toHaveBeenCalled();
  });

  it('voids an expense with a reason and says the cash went back', async () => {
    const { api } = apiWith(() => ok(summaryOf()));
    const expenses = expensesApiWith();
    render(<DashboardDialog api={api} user={OWNER} onClose={() => undefined} expensesApi={expenses.api} />);
    await screen.findByLabelText('Indicadores del periodo');
    fireEvent.click(screen.getByRole('tab', { name: 'Gastos' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Anular' }));
    fireEvent.change(screen.getByLabelText('Motivo de la anulación'), { target: { value: 'Se anotó dos veces' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(expenses.voidExpense).toHaveBeenCalledWith({ id: 'expense-1', reason: 'Se anotó dos veces' }));
    expect((await screen.findByRole('status')).textContent).toContain('regresó a la caja');
  });

  it('lets the owner change the list of concepts, one per line', async () => {
    const { api } = apiWith(() => ok(summaryOf()));
    const expenses = expensesApiWith();
    render(<DashboardDialog api={api} user={OWNER} onClose={() => undefined} expensesApi={expenses.api} />);
    await screen.findByLabelText('Indicadores del periodo');
    fireEvent.click(screen.getByRole('tab', { name: 'Gastos' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Cambiar la lista de conceptos' }));
    fireEvent.change(screen.getByLabelText('Conceptos, uno por renglón'), { target: { value: 'Renta\nCFE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar conceptos' }));

    await waitFor(() => expect(expenses.saveConcepts).toHaveBeenCalledWith({ concepts: ['Renta', 'CFE'] }));
  });
});
