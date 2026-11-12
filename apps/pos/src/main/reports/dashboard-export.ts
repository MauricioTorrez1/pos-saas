import type { DashboardSummary, PeriodTotals, StockLine, TopSeller } from '../../shared/dashboard-api';
import {
  PAYMENT_KIND_LABELS,
  TOP_METRIC_LABELS,
  WEEKDAY_LABELS,
  changeLabel,
  costNumberText,
  hundredthsLabel,
  pesosLabel,
  percentLabel,
  percentText,
  periodLabel,
  pesosText,
  quantityNumberText,
  quantityText,
  trendLabel,
} from '../../shared/dashboard-format';
import type { Cell, Sheet } from '../export/xlsx';

const UNIT_NAMES = { piece: 'Pieza', meter: 'Metro', kilogram: 'Kilogramo', liter: 'Litro' } as const;
const COST_SOURCE_NAMES = { typed: 'Capturado', average: 'Promedio ponderado', none: 'Sin costo' } as const;

const money = (cents: number): Cell => ({ decimal: pesosText(cents), format: 'money' });
const count = (value: number): Cell => ({ decimal: String(value), format: 'integer' });
const heading = (text: string): Cell => ({ heading: text });

type IndicatorKind = 'money' | 'count' | 'percent' | 'hundredths';

interface Indicator {
  readonly label: string;
  readonly kind: IndicatorKind;
  readonly value: (totals: PeriodTotals) => number | null;
}

function indicators(includesCosts: boolean): Indicator[] {
  const common: Indicator[] = [
    { label: 'Ventas totales (con IVA)', kind: 'money', value: (t) => t.totalCents },
    { label: 'Ventas sin IVA', kind: 'money', value: (t) => t.subtotalCents },
    { label: 'IVA', kind: 'money', value: (t) => t.taxCents },
    { label: 'Tickets', kind: 'count', value: (t) => t.salesCount },
    { label: 'Venta promedio por ticket', kind: 'money', value: (t) => t.averageTicketCents },
    { label: 'Partidas por ticket', kind: 'hundredths', value: (t) => t.linesPerTicketX100 },
    { label: 'Devoluciones (cantidad)', kind: 'count', value: (t) => t.returnsCount },
    { label: 'Devoluciones (monto)', kind: 'money', value: (t) => t.returnsCents },
    { label: 'Venta neta (con IVA)', kind: 'money', value: (t) => t.netCents },
    { label: 'Venta neta (sin IVA)', kind: 'money', value: (t) => t.netSubtotalCents },
  ];
  if (!includesCosts) {
    return common;
  }
  return [
    ...common,
    { label: 'Costo de lo vendido', kind: 'money', value: (t) => t.costOfGoodsCents },
    { label: 'Utilidad bruta', kind: 'money', value: (t) => t.grossProfitCents },
    { label: 'Margen (%)', kind: 'percent', value: (t) => t.marginBp },
  ];
}

/** An indicator as a spreadsheet cell: a number with its format, or "sin datos" when it does not exist. */
function indicatorCell(kind: IndicatorKind, value: number | null): Cell {
  if (value === null) {
    return 'sin datos';
  }
  switch (kind) {
    case 'money':
      return money(value);
    case 'count':
      return count(value);
    case 'percent':
      return { decimal: percentText(value), format: 'percent' };
    case 'hundredths':
      return { decimal: pesosText(value), format: 'money' };
  }
}

function indicatorLabel(kind: IndicatorKind, value: number | null): string {
  if (value === null) {
    return 'sin datos';
  }
  return kind === 'money' ? pesosLabel(value) : kind === 'percent' ? percentLabel(value) : kind === 'hundredths' ? hundredthsLabel(value) : String(value);
}

function stockRows(section: string, list: { readonly items: readonly StockLine[] }): Cell[][] {
  return list.items.map((line) => [
    section,
    line.name,
    UNIT_NAMES[line.unit],
    { decimal: quantityNumberText(line.stockMilli), format: 'quantity' },
    line.valueCents === null ? 'sin costo' : money(line.valueCents),
  ]);
}

function topRow(seller: TopSeller, includesCosts: boolean): Cell[] {
  const row: Cell[] = [
    count(seller.rank),
    seller.name,
    UNIT_NAMES[seller.unit],
    { decimal: quantityNumberText(seller.quantityMilli), format: 'quantity' },
    money(seller.amountCents),
  ];
  if (includesCosts) {
    row.push(
      seller.costE6 === null ? 'sin costo' : { decimal: costNumberText(seller.costE6), format: 'money' },
      seller.profitCents === null ? 'sin costo' : money(seller.profitCents),
      COST_SOURCE_NAMES[seller.costSource ?? 'none'],
    );
  }
  return row;
}

/**
 * Lays the summary out as the sheets of an Excel workbook. Money, quantities and percents are numbers with their own
 * format, written from integers, so the owner can add them up.
 *
 * @param summary what the dashboard showed
 * @returns the sheets
 */
export function summarySheets(summary: DashboardSummary): Sheet[] {
  const { totals, previousTotals, includesCosts } = summary;
  const summaryRows: Cell[][] = [
    [heading(summary.scope === 'shift' ? 'Resumen de mi turno' : 'Resumen del negocio')],
    ['Periodo', periodLabel(summary.period)],
    ['Generado', summary.generatedAt],
    [],
    [heading('Indicador'), heading('Periodo'), ...(previousTotals === null ? [] : [heading('Periodo anterior'), heading('Cambio')])],
  ];
  for (const indicator of indicators(includesCosts)) {
    const now = indicator.value(totals);
    const row: Cell[] = [indicator.label, indicatorCell(indicator.kind, now)];
    if (previousTotals !== null) {
      const before = indicator.value(previousTotals);
      row.push(indicatorCell(indicator.kind, before), now === null || before === null ? '' : changeLabel(now, before));
    }
    summaryRows.push(row);
  }
  summaryRows.push(['Cancelaciones (cantidad)', count(summary.cancellations.count)], ['Cancelaciones (monto)', money(summary.cancellations.totalCents)]);
  if (summary.inventory !== null) {
    summaryRows.push(['Valor del inventario a costo', money(summary.inventory.valueCents)]);
  }
  if (includesCosts && totals.productsWithoutCostSold > 0) {
    summaryRows.push([`${totals.productsWithoutCostSold} producto(s) vendidos sin costo no cuentan en la utilidad`]);
  }

  const sheets: Sheet[] = [
    { name: 'Resumen', rows: summaryRows, widths: [38, 18, 18, 14] },
    {
      name: 'Formas de pago',
      rows: [
        [heading('Forma de pago'), heading('Ventas'), heading('Total (con IVA)')],
        ...summary.paymentKinds.map((row): Cell[] => [PAYMENT_KIND_LABELS[row.kind], count(row.salesCount), money(row.totalCents)]),
        [],
        [heading('Dinero recibido por'), heading('Monto')],
        ...summary.methodAmounts.map((row): Cell[] => [PAYMENT_KIND_LABELS[row.method], money(row.amountCents)]),
      ],
      widths: [24, 14, 18],
    },
    {
      name: 'Por hora',
      rows: [[heading('Hora'), heading('Ventas'), heading('Total (con IVA)')], ...summary.byHour.map((row): Cell[] => [`${String(row.hour).padStart(2, '0')}:00`, count(row.salesCount), money(row.totalCents)])],
      widths: [10, 12, 18],
    },
    {
      name: 'Por día de la semana',
      rows: [
        [heading('Día'), heading('Ventas'), heading('Total (con IVA)')],
        ...summary.byWeekday.map((row): Cell[] => [WEEKDAY_LABELS[row.weekday] ?? '', count(row.salesCount), money(row.totalCents)]),
      ],
      widths: [14, 12, 18],
    },
    {
      name: summary.trendUnit === 'day' ? 'Por día' : 'Por mes',
      rows: [
        [heading(summary.trendUnit === 'day' ? 'Día' : 'Mes'), heading('Ventas'), heading('Total (con IVA)')],
        ...summary.trend.map((row): Cell[] => [row.key, count(row.salesCount), money(row.totalCents)]),
      ],
      widths: [14, 12, 18],
    },
    {
      name: 'Más vendidos',
      rows: [
        [heading(`Más vendidos (${TOP_METRIC_LABELS[summary.topMetric].toLowerCase()}, ${summary.topLimit})`)],
        [
          heading('#'),
          heading('Producto'),
          heading('Unidad'),
          heading('Cantidad'),
          heading('Importe (con IVA)'),
          ...(includesCosts ? [heading('Costo unitario'), heading('Utilidad (sin IVA)'), heading('Origen del costo')] : []),
        ],
        ...summary.topSellers.map((seller) => topRow(seller, includesCosts)),
      ],
      widths: [6, 40, 12, 14, 18, 16, 18, 22],
    },
  ];
  if (summary.byCashier !== null) {
    sheets.push({
      name: 'Cajeros',
      rows: [[heading('Cajero'), heading('Ventas'), heading('Total (con IVA)')], ...summary.byCashier.map((row): Cell[] => [row.name, count(row.salesCount), money(row.totalCents)])],
      widths: [24, 12, 18],
    });
  }
  if (summary.inventory !== null) {
    const { inventory } = summary;
    sheets.push({
      name: 'Existencias',
      rows: [
        [heading('Sección'), heading('Producto'), heading('Unidad'), heading('Existencia'), heading('Valor a costo')],
        ...stockRows('Sin movimiento en el periodo', inventory.notSelling),
        ...stockRows('Agotados o en negativo', inventory.outOfStock),
        ...stockRows('Por agotarse', inventory.runningLow),
        ...stockRows('Sin costo', inventory.withoutCost),
      ],
      widths: [30, 40, 12, 14, 16],
    });
  }
  return sheets;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function table(caption: string, headers: readonly string[], rows: readonly (readonly string[])[]): string {
  if (rows.length === 0) {
    return '';
  }
  return `<table><caption>${escapeHtml(caption)}</caption><thead><tr>${headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell, index) => (index === 0 ? `<th scope="row">${escapeHtml(cell)}</th>` : `<td>${escapeHtml(cell)}</td>`)).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

const PDF_STYLES = `
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1b2328; font-size: 11px; margin: 0; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  h2 { font-size: 14px; margin: 18px 0 6px; }
  p { margin: 2px 0; color: #55626b; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 12px; page-break-inside: auto; }
  caption { text-align: left; font-weight: 700; padding: 4px 0; }
  th, td { padding: 3px 6px; border-bottom: 1px solid #bfc7cd; text-align: right; }
  th:first-child, td:first-child, th[scope='row'] { text-align: left; font-weight: 400; }
  thead th { font-weight: 700; border-bottom: 2px solid #1b2328; }
  tr { page-break-inside: avoid; }
`;

/**
 * Builds the page that becomes the PDF: the same numbers as the screen, as plain tables, with every text escaped because
 * a product name is typed by a person. It carries a policy that blocks scripts and any request to the network.
 *
 * @param summary what the dashboard showed
 * @param businessName the name of the business for the title
 * @returns the HTML
 */
export function summaryHtml(summary: DashboardSummary, businessName: string): string {
  const { totals, previousTotals, includesCosts } = summary;
  const indicatorRows = indicators(includesCosts).map((indicator) => {
    const now = indicator.value(totals);
    const row = [indicator.label, indicatorLabel(indicator.kind, now)];
    if (previousTotals !== null) {
      const before = indicator.value(previousTotals);
      row.push(indicatorLabel(indicator.kind, before), now === null || before === null ? '' : changeLabel(now, before));
    }
    return row;
  });
  const parts = [
    `<h1>${escapeHtml(businessName)}</h1>`,
    `<p>${summary.scope === 'shift' ? 'Resumen de mi turno' : 'Resumen del negocio'} · ${escapeHtml(periodLabel(summary.period))}</p>`,
    `<p>Generado el ${escapeHtml(summary.generatedAt)}</p>`,
    table('Indicadores', ['Indicador', 'Periodo', ...(previousTotals === null ? [] : ['Periodo anterior', 'Cambio'])], indicatorRows),
    `<p>Cancelaciones: ${summary.cancellations.count} por ${escapeHtml(pesosLabel(summary.cancellations.totalCents))}. La caja todavía no maneja descuentos.</p>`,
    summary.inventory === null ? '' : `<p>Valor del inventario a costo: ${escapeHtml(pesosLabel(summary.inventory.valueCents))}</p>`,
    includesCosts && totals.productsWithoutCostSold > 0
      ? `<p>${totals.productsWithoutCostSold} producto(s) vendidos sin costo no cuentan en la utilidad.</p>`
      : '',
    table(
      'Formas de pago',
      ['Forma de pago', 'Ventas', 'Total (con IVA)'],
      summary.paymentKinds.map((row) => [PAYMENT_KIND_LABELS[row.kind], String(row.salesCount), pesosLabel(row.totalCents)]),
    ),
    table(
      'Ventas por hora',
      ['Hora', 'Ventas', 'Total (con IVA)'],
      summary.byHour.filter((row) => row.salesCount > 0).map((row) => [`${String(row.hour).padStart(2, '0')}:00`, String(row.salesCount), pesosLabel(row.totalCents)]),
    ),
    table(
      'Ventas por día de la semana',
      ['Día', 'Ventas', 'Total (con IVA)'],
      summary.byWeekday.map((row) => [WEEKDAY_LABELS[row.weekday] ?? '', String(row.salesCount), pesosLabel(row.totalCents)]),
    ),
    table(
      summary.trendUnit === 'day' ? 'Ventas por día' : 'Ventas por mes',
      [summary.trendUnit === 'day' ? 'Día' : 'Mes', 'Ventas', 'Total (con IVA)'],
      summary.trend.map((row) => [trendLabel(row.key), String(row.salesCount), pesosLabel(row.totalCents)]),
    ),
    table(
      `Más vendidos (${TOP_METRIC_LABELS[summary.topMetric].toLowerCase()}, ${summary.topLimit})`,
      ['Producto', 'Cantidad', 'Importe (con IVA)', ...(includesCosts ? ['Utilidad (sin IVA)', 'Costo'] : [])],
      summary.topSellers.map((seller) => [
        `${seller.rank}. ${seller.name}`,
        quantityText(seller.quantityMilli, seller.unit),
        pesosLabel(seller.amountCents),
        ...(includesCosts ? [seller.profitCents === null ? 'sin costo' : pesosLabel(seller.profitCents), COST_SOURCE_NAMES[seller.costSource ?? 'none']] : []),
      ]),
    ),
  ];
  if (summary.byCashier !== null) {
    parts.push(
      table(
        'Ventas por cajero',
        ['Cajero', 'Ventas', 'Total (con IVA)'],
        summary.byCashier.map((row) => [row.name, String(row.salesCount), pesosLabel(row.totalCents)]),
      ),
    );
  }
  if (summary.inventory !== null) {
    const toRows = (items: readonly StockLine[]): string[][] =>
      items.map((line) => [line.name, quantityText(line.stockMilli, line.unit), line.valueCents === null ? 'sin costo' : pesosLabel(line.valueCents)]);
    const { inventory } = summary;
    parts.push(
      table(`Sin movimiento en el periodo (${inventory.notSelling.total})`, ['Producto', 'Existencia', 'Valor a costo'], toRows(inventory.notSelling.items)),
      table(`Agotados o en negativo (${inventory.outOfStock.total})`, ['Producto', 'Existencia', 'Valor a costo'], toRows(inventory.outOfStock.items)),
      table(`Por agotarse (${inventory.runningLow.total})`, ['Producto', 'Existencia', 'Valor a costo'], toRows(inventory.runningLow.items)),
      table(`Sin costo (${inventory.withoutCost.total})`, ['Producto', 'Existencia', 'Valor a costo'], toRows(inventory.withoutCost.items)),
    );
  }
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Resumen del negocio</title><style>${PDF_STYLES}</style></head><body>${parts.join('')}</body></html>`;
}

/**
 * Names the file a summary is saved as.
 *
 * @param summary what the dashboard showed
 * @param extension `xlsx` or `pdf`
 * @returns a name such as `resumen-2026-11-01_a_2026-11-30.xlsx`
 */
export function exportFileName(summary: DashboardSummary, extension: 'xlsx' | 'pdf'): string {
  const { fromDay, toDay } = summary.period;
  return `resumen-${fromDay === toDay ? fromDay : `${fromDay}_a_${toDay}`}.${extension}`;
}
