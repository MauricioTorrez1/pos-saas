import type { DashboardSummary, PeriodTotals, StockLine } from '../../shared/dashboard-api';
import { PAYMENT_KIND_LABELS, WEEKDAY_LABELS, changeLabel, percentLabel, periodLabel, pesosLabel, quantityText, trendLabel } from '../../shared/dashboard-format';
import { GENERAL_LINES, type IncomeStatement } from '../../shared/income-statement';
import { statementNotes } from '../reports/income-statement-export';
import { CHART_COLORS, barList, columnChart, donutChart, escapeMarkup, monogram, waterfallChart } from './report-charts';
import type { ReportExtras } from './report-reader';
import {
  cashReading,
  costReading,
  expensesReading,
  inventoryReading,
  paymentReading,
  purchasesReading,
  returnsReading,
  salesReading,
  statementReading,
  timeReading,
  topProductsReading,
} from './report-readings';

/** Everything one illustrated report shows (E1-57, ADR 0073). */
export interface BusinessReportData {
  readonly businessName: string;
  /** The color of the cover, from the accent of the register. */
  readonly accentColor: string;
  /** When it was made, already written for a person. */
  readonly generatedAt: string;
  readonly summary: DashboardSummary;
  readonly statement: IncomeStatement;
  readonly extras: ReportExtras;
}

/** How many rows each list of products shows; the full lists are in the Excel of the summary. */
const LIST_ROWS = 10;

/** Money without the cents, for the labels of a chart, rounded half up away from zero. */
export function wholePesosLabel(cents: number): string {
  const magnitude = Math.floor((Math.abs(cents) + 50) / 100);
  const text = `$${String(magnitude).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  return cents < 0 && magnitude > 0 ? `−${text}` : text;
}

const STYLES = `
  @page { size: letter portrait; margin: 14mm 14mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: ${CHART_COLORS.ink}; font-size: 11px; margin: 0; line-height: 1.4; }
  section { break-before: page; }
  section.flow { break-before: auto; margin-top: 22px; }
  section.cover { break-before: auto; display: flex; flex-direction: column; justify-content: center; min-height: 230mm; }
  h1 { font-size: 30px; margin: 16px 0 4px; }
  h2 { font-size: 18px; margin: 0 0 4px; padding-bottom: 4px; border-bottom: 3px solid var(--accent); }
  h3 { font-size: 13px; margin: 14px 0 4px; }
  p { margin: 4px 0; }
  .subtitle { font-size: 15px; color: ${CHART_COLORS.muted}; }
  .lead { color: ${CHART_COLORS.muted}; margin-bottom: 8px; }
  .reading { background: #f1f4f7; border-left: 4px solid var(--accent); padding: 6px 10px; margin: 6px 0 12px; break-inside: avoid; }
  .reading strong { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: ${CHART_COLORS.muted}; }
  .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 8px 0 12px; }
  .tile { border: 1px solid ${CHART_COLORS.grid}; border-radius: 6px; padding: 8px 10px; break-inside: avoid; }
  .tile .name { color: ${CHART_COLORS.muted}; font-size: 10px; }
  .tile .value { font-size: 18px; font-weight: 700; }
  .tile .change { font-size: 10px; }
  .up { color: ${CHART_COLORS.positive}; }
  .down { color: ${CHART_COLORS.negative}; }
  .loss { color: ${CHART_COLORS.negative}; }
  .chart { display: block; margin: 4px 0 6px; break-inside: avoid; }
  figure { margin: 0; break-inside: avoid; }
  figcaption { font-weight: 700; margin-top: 8px; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; }
  caption { text-align: left; font-weight: 700; padding: 4px 0; }
  th, td { padding: 3px 6px; border-bottom: 1px solid ${CHART_COLORS.grid}; text-align: right; white-space: nowrap; }
  table.explained td:last-child, table.explained thead th:last-child { white-space: normal; text-align: left; }
  th:first-child, td:first-child { text-align: left; }
  thead th { border-bottom: 2px solid ${CHART_COLORS.ink}; }
  tr { break-inside: avoid; }
  .contents { columns: 2; padding-left: 18px; }
  .notes li { margin-bottom: 4px; }
  dl.glossary dt { font-weight: 700; margin-top: 6px; }
  dl.glossary dd { margin: 0 0 0 12px; }
`;

function reading(text: string): string {
  return text === '' ? '' : `<div class="reading"><strong>Qué significa</strong>${escapeMarkup(text)}</div>`;
}

function figure(caption: string, chart: string): string {
  return `<figure><figcaption>${escapeMarkup(caption)}</figcaption>${chart}</figure>`;
}

function table(caption: string, headers: readonly string[], rows: readonly (readonly string[])[], className = ''): string {
  if (rows.length === 0) {
    return '';
  }
  const head = headers.map((header) => `<th scope="col">${escapeMarkup(header)}</th>`).join('');
  const body = rows.map((row) => `<tr>${row.map((cell, index) => (index === 0 ? `<th scope="row">${escapeMarkup(cell)}</th>` : `<td>${escapeMarkup(cell)}</td>`)).join('')}</tr>`).join('');
  return `<table${className === '' ? '' : ` class="${className}"`}><caption>${escapeMarkup(caption)}</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

interface Tile {
  readonly name: string;
  readonly value: string;
  /** The change against the period before, already written, and whether going up is good news. */
  readonly change?: { readonly text: string; readonly current: number; readonly previous: number; readonly upIsGood: boolean };
  readonly isLoss?: boolean;
}

function tiles(items: readonly Tile[]): string {
  return `<div class="tiles">${items
    .map((item) => {
      let change = '';
      if (item.change !== undefined) {
        const { current, previous, upIsGood, text } = item.change;
        const arrow = current > previous ? '▲' : current < previous ? '▼' : '＝';
        const good = current === previous ? '' : current > previous === upIsGood ? 'up' : 'down';
        change = `<div class="change ${good}">${arrow} ${escapeMarkup(text)}</div>`;
      }
      return `<div class="tile"><div class="name">${escapeMarkup(item.name)}</div><div class="value${item.isLoss === true ? ' loss' : ''}">${escapeMarkup(item.value)}</div>${change}</div>`;
    })
    .join('')}</div>`;
}

function compared(totals: PeriodTotals, previous: PeriodTotals | null, value: (t: PeriodTotals) => number | null, upIsGood = true): Tile['change'] {
  const now = value(totals);
  const before = previous === null ? null : value(previous);
  if (now === null || before === null) {
    return undefined;
  }
  return { text: `${changeLabel(now, before)} vs. periodo anterior`, current: now, previous: before, upIsGood };
}

function coverSection(data: BusinessReportData): string {
  const contents = [
    'De un vistazo',
    'Estado de resultados',
    'Ventas',
    'Productos y costos',
    'Gastos',
    'Caja',
    'Inventario',
    'Devoluciones y cancelaciones',
    'Proveedores',
    'Notas y glosario',
  ];
  return `<section class="cover">${monogram(data.businessName, data.accentColor)}<h1>${escapeMarkup(data.businessName)}</h1><p class="subtitle">Reporte del negocio · ${escapeMarkup(periodLabel(data.summary.period))}</p><p class="lead">Generado el ${escapeMarkup(data.generatedAt)} · Todo sale de la base de la caja: funciona sin internet y no se mandó a ningún lado.</p><h3>Contenido</h3><ol class="contents">${contents.map((name) => `<li>${escapeMarkup(name)}</li>`).join('')}</ol></section>`;
}

function glanceSection(data: BusinessReportData): string {
  const { summary, statement } = data;
  const { totals, previousTotals } = summary;
  const net = statement.netProfit.amountCents;
  const items: Tile[] = [
    { name: 'Ventas (con IVA)', value: pesosLabel(totals.totalCents), change: compared(totals, previousTotals, (t) => t.totalCents) },
    { name: 'Tickets', value: String(totals.salesCount), change: compared(totals, previousTotals, (t) => t.salesCount) },
    { name: 'Venta promedio por ticket', value: pesosLabel(totals.averageTicketCents), change: compared(totals, previousTotals, (t) => t.averageTicketCents) },
    {
      name: 'Utilidad bruta',
      value: totals.grossProfitCents === null ? 'sin datos' : pesosLabel(totals.grossProfitCents),
      change: compared(totals, previousTotals, (t) => t.grossProfitCents),
      isLoss: (totals.grossProfitCents ?? 0) < 0,
    },
    { name: 'Margen bruto', value: totals.marginBp === null ? 'sin datos' : percentLabel(totals.marginBp), change: compared(totals, previousTotals, (t) => t.marginBp) },
    { name: 'Utilidad neta (antes de ISR)', value: pesosLabel(net), isLoss: net < 0 },
  ];
  const facts = [salesReading(summary), statementReading(statement), inventoryReading(summary), cashReading(summary, data.extras)].filter((text) => text !== '');
  return `<section><h2>De un vistazo</h2><p class="lead">Las cifras más importantes del periodo, comparadas con el periodo anterior del mismo largo${
    summary.previousPeriod === null ? '' : ` (${escapeMarkup(periodLabel(summary.previousPeriod))})`
  }.</p>${tiles(items)}<h3>Lo más importante</h3><ul class="notes">${facts.map((text) => `<li>${escapeMarkup(text)}</li>`).join('')}</ul></section>`;
}

function statementSectionHtml(statement: IncomeStatement): string {
  const chart = waterfallChart(
    'Cómo se llega de las ventas a la utilidad',
    [
      { label: 'Ventas netas', value: statement.netSales.amountCents, kind: 'start' },
      { label: 'Costo de lo vendido', value: statement.costOfGoods.amountCents, kind: 'subtract' },
      { label: 'Utilidad bruta', value: statement.grossProfit.amountCents, kind: 'total' },
      { label: 'Gastos de operación', value: statement.operatingExpenses.amountCents, kind: 'subtract' },
      { label: 'Utilidad neta', value: statement.netProfit.amountCents, kind: 'total' },
    ],
    wholePesosLabel,
  );
  const rows = GENERAL_LINES.map((line) => [
    line.label,
    pesosLabel(statement[line.key].amountCents),
    statement[line.key].shareBp === null ? 'sin datos' : percentLabel(statement[line.key].shareBp ?? 0),
    line.explanation,
  ]);
  return `<section><h2>Estado de resultados</h2><p class="lead">Lo que ganó el negocio en el periodo, sin IVA y antes del impuesto sobre la renta (ISR).</p>${figure(
    'De las ventas a la utilidad',
    chart,
  )}${reading(statementReading(statement))}${table('Vista general', ['Renglón', 'Monto', '% de ventas netas', 'Qué es'], rows, 'explained')}<ul class="notes">${statementNotes(statement)
    .map((note) => `<li>${escapeMarkup(note)}</li>`)
    .join('')}</ul></section>`;
}

function salesSection(summary: DashboardSummary): string {
  const trend = columnChart({
    label: summary.trendUnit === 'day' ? 'Ventas por día' : 'Ventas por mes',
    data: summary.trend.map((bucket) => ({ label: trendLabel(bucket.key), value: bucket.totalCents })),
    format: wholePesosLabel,
  });
  const hours = summary.byHour.filter((bucket) => bucket.hour >= 6 && bucket.hour <= 22);
  const byHour = columnChart({
    label: 'Ventas por hora del día',
    data: (hours.some((bucket) => bucket.totalCents > 0) ? hours : summary.byHour).map((bucket) => ({ label: `${String(bucket.hour)}h`, value: bucket.totalCents })),
    format: wholePesosLabel,
    showValues: false,
    color: CHART_COLORS.series[1],
  });
  const byWeekday = columnChart({
    label: 'Ventas por día de la semana',
    data: summary.byWeekday.map((bucket) => ({ label: (WEEKDAY_LABELS[bucket.weekday] ?? '').slice(0, 3), value: bucket.totalCents })),
    format: wholePesosLabel,
    color: CHART_COLORS.series[2],
  });
  const paymentTotal = summary.paymentKinds.reduce((sum, row) => sum + row.totalCents, 0);
  const payments = donutChart({
    label: 'Cómo te pagaron',
    data: summary.paymentKinds.map((row) => ({ label: PAYMENT_KIND_LABELS[row.kind], value: row.totalCents })),
    format: pesosLabel,
    formatShare: percentLabel,
    centerText: wholePesosLabel(paymentTotal),
  });
  return `<section><h2>Ventas</h2><p class="lead">Cuánto se vendió, cuándo y cómo te pagaron. Los montos llevan IVA.</p>${figure(
    summary.trendUnit === 'day' ? 'Ventas por día' : 'Ventas por mes',
    trend,
  )}${reading(salesReading(summary))}${figure('Ventas por hora del día', byHour)}${figure('Ventas por día de la semana', byWeekday)}${reading(timeReading(summary))}${figure(
    'Formas de pago',
    payments,
  )}${reading(paymentReading(summary))}</section>`;
}

function productsSection(summary: DashboardSummary, statement: IncomeStatement): string {
  const sellers = barList({
    label: 'Los productos que más dinero trajeron',
    data: summary.topSellers.map((seller) => ({ label: `${String(seller.rank)}. ${seller.name}`, value: seller.amountCents })),
    format: wholePesosLabel,
    emptyText: 'Ningún producto se vendió en el periodo',
  });
  const profits = summary.topSellers.filter((seller) => seller.profitCents !== null);
  const profitChart = barList({
    label: 'Lo que dejó cada uno (sin IVA, menos su costo)',
    data: profits.map((seller) => ({ label: seller.name, value: seller.profitCents ?? 0 })),
    format: wholePesosLabel,
    color: CHART_COLORS.positive,
    emptyText: 'Ninguno de estos productos tiene costo capturado',
  });
  const costs = barList({
    label: 'Lo que más costó la mercancía vendida',
    data: statement.detail.costByProduct.map((line) => ({ label: line.name, value: line.costCents })),
    format: wholePesosLabel,
    color: CHART_COLORS.series[3],
    emptyText: 'No salió mercancía con costo en el periodo',
  });
  return `<section><h2>Productos y costos</h2><p class="lead">Los ${String(summary.topSellers.length)} productos que más vendieron por importe, lo que dejaron y lo que costó la mercancía.</p>${figure(
    'Más vendidos por importe (con IVA)',
    sellers,
  )}${reading(topProductsReading(summary))}${figure('Utilidad de los más vendidos', profitChart)}${figure('Costo de lo vendido por producto', costs)}${reading(costReading(statement))}</section>`;
}

function expensesSection(statement: IncomeStatement): string {
  const concepts = [...statement.detail.expensesByConcept].sort((a, b) => b.amountCents - a.amountCents);
  const chart = barList({
    label: 'Gastos por concepto',
    data: concepts.map((line) => ({ label: line.concept, value: line.amountCents })),
    format: wholePesosLabel,
    color: CHART_COLORS.series[4],
    emptyText: 'No anotaste gastos en el periodo',
  });
  return `<section><h2>Gastos</h2><p class="lead">Lo que anotaste en «Gastos»: renta, luz, sueldos y lo demás. Lo pagado con dinero de la caja también salió en el corte.</p>${figure(
    'Gastos por concepto',
    chart,
  )}${reading(expensesReading(statement))}${table(
    'Detalle',
    ['Concepto', 'Monto', 'Veces', 'De la caja'],
    concepts.map((line) => [line.concept, pesosLabel(line.amountCents), String(line.count), pesosLabel(line.fromDrawerCents)]),
  )}</section>`;
}

function cashSection(summary: DashboardSummary, extras: ReportExtras): string {
  const movements = summary.cashMovements ?? { inCents: 0, outCents: 0, drawerExpensesCents: 0 };
  const floats = extras.cashiers.reduce((sum, row) => sum + row.openingFloatCents, 0);
  const difference = extras.cashiers.reduce((sum, row) => sum + row.cashDifferenceCents, 0);
  const cashierChart = barList({
    label: 'Ventas por cajero',
    data: (summary.byCashier ?? []).map((row) => ({ label: row.name, value: row.totalCents })),
    format: wholePesosLabel,
    color: CHART_COLORS.series[0],
    emptyText: 'Sin ventas en el periodo',
  });
  const differenceText = (cents: number): string => (cents === 0 ? 'cuadró' : cents < 0 ? `faltó ${pesosLabel(-cents)}` : `sobró ${pesosLabel(cents)}`);
  return `<section><h2>Caja</h2><p class="lead">El fondo con que se abrió, el dinero que entró y salió a mano y si los cortes cuadraron.</p>${tiles([
    { name: 'Fondos de caja al abrir', value: pesosLabel(floats) },
    { name: 'Entradas a mano', value: pesosLabel(movements.inCents) },
    { name: 'Salidas a mano', value: pesosLabel(movements.outCents) },
    { name: 'De ellas, gastos pagados de la caja', value: pesosLabel(movements.drawerExpensesCents) },
    { name: 'Diferencia de efectivo en cortes', value: differenceText(difference), isLoss: difference < 0 },
    { name: 'Cortes hechos', value: String(extras.cashiers.reduce((sum, row) => sum + row.cuts, 0)) },
  ])}${reading(cashReading(summary, extras))}${table(
    'Por cajero',
    ['Cajero', 'Turnos', 'Fondo inicial', 'Cortes', 'Sin cuadrar', 'Efectivo', 'Tarjeta y transferencia'],
    extras.cashiers.map((row) => [
      row.name,
      String(row.sessions),
      pesosLabel(row.openingFloatCents),
      String(row.cuts),
      String(row.cutsWithDifference),
      differenceText(row.cashDifferenceCents),
      differenceText(row.otherDifferenceCents),
    ]),
  )}${figure('Ventas por cajero (con IVA)', cashierChart)}</section>`;
}

function stockTable(caption: string, list: { readonly total: number; readonly items: readonly StockLine[] }): string {
  const rows = list.items
    .slice(0, LIST_ROWS)
    .map((line) => [line.name, quantityText(line.stockMilli, line.unit), line.valueCents === null ? 'sin costo' : pesosLabel(line.valueCents)]);
  const more = list.total > rows.length ? ` · se muestran ${String(rows.length)} de ${String(list.total)}` : '';
  return table(`${caption} (${String(list.total)})${more}`, ['Producto', 'Existencia', 'Valor a costo'], rows);
}

function inventorySection(summary: DashboardSummary): string {
  const inventory = summary.inventory;
  if (inventory === null) {
    return '';
  }
  const chart = barList({
    label: 'Cuántos productos hay en cada situación',
    data: [
      { label: 'Sin movimiento en el periodo', value: inventory.notSelling.total },
      { label: 'Agotados o en negativo', value: inventory.outOfStock.total },
      { label: 'Por agotarse', value: inventory.runningLow.total },
      { label: 'Sin costo', value: inventory.withoutCost.total },
    ],
    format: (value) => `${String(value)} producto(s)`,
    color: CHART_COLORS.series[1],
    emptyText: 'Todo en orden: ningún producto en estas listas',
  });
  return `<section><h2>Inventario</h2><p class="lead">La mercancía que tienes hoy, valuada a su costo sin IVA, y la que pide atención.</p>${tiles([
    { name: 'Valor del inventario a costo', value: pesosLabel(inventory.valueCents) },
    { name: 'Con existencia y sin costo', value: String(inventory.stockedWithoutCost) },
    { name: 'Agotados o en negativo', value: String(inventory.outOfStock.total) },
  ])}${figure('Productos que piden atención', chart)}${reading(inventoryReading(summary))}${stockTable('Sin movimiento en el periodo', inventory.notSelling)}${stockTable(
    'Agotados o en negativo',
    inventory.outOfStock,
  )}${stockTable('Por agotarse', inventory.runningLow)}${stockTable('Sin costo', inventory.withoutCost)}</section>`;
}

function returnsSection(summary: DashboardSummary): string {
  const { totals, previousTotals, cancellations } = summary;
  return `<section><h2>Devoluciones y cancelaciones</h2><p class="lead">Lo que regresó el cliente después de pagar, y las ventas que se cancelaron antes de cobrarse.</p>${tiles([
    { name: 'Devoluciones', value: String(totals.returnsCount), change: compared(totals, previousTotals, (t) => t.returnsCount, false) },
    { name: 'Monto devuelto', value: pesosLabel(totals.returnsCents), change: compared(totals, previousTotals, (t) => t.returnsCents, false) },
    { name: 'Cancelaciones', value: `${String(cancellations.count)} por ${pesosLabel(cancellations.totalCents)}` },
  ])}${reading(returnsReading(summary))}</section>`;
}

function suppliersSection(extras: ReportExtras): string {
  const { purchases } = extras;
  return `<section class="flow"><h2>Proveedores</h2><p class="lead">Los pedidos que siguen en borrador y los que se enviaron en el periodo, a los costos conocidos.</p>${tiles([
    { name: 'Pedidos en borrador', value: `${String(purchases.draftCount)} por ${pesosLabel(purchases.draftTotalCents)}` },
    { name: 'Pedidos enviados', value: `${String(purchases.sentCount)} por ${pesosLabel(purchases.sentTotalCents)}` },
    { name: 'Renglones sin costo', value: String(purchases.linesWithoutCost) },
  ])}${reading(purchasesReading(extras))}</section>`;
}

function notesSection(): string {
  const glossary: readonly [string, string][] = [
    ['Ventas netas', 'Lo que vendiste sin IVA, menos lo que devolviste.'],
    ['Costo de lo vendido', 'Lo que te costó la mercancía que salió: el costo que capturaste o, si no, el promedio de tus compras.'],
    ['Utilidad bruta', 'Ventas netas menos el costo de lo vendido. Lo que deja vender, antes de la renta y los sueldos.'],
    ['Gastos de operación', 'Renta, luz, sueldos, comisiones del banco y lo demás que anotaste en «Gastos».'],
    ['Utilidad neta (antes de ISR)', 'Lo que ganó el negocio antes del impuesto sobre la renta. Si es negativa, el periodo dejó pérdida.'],
    ['IVA cobrado', 'El IVA que pagaron los clientes. No es tuyo: se le entrega al SAT, por eso no cuenta como ingreso.'],
    ['Margen', 'De cada peso vendido sin IVA, cuánto queda después del costo.'],
    ['Fondo de caja', 'El dinero con que se abre la caja para dar cambio.'],
    ['Corte', 'El conteo al cerrar la caja: lo contado contra lo que debía haber.'],
  ];
  return `<section class="flow"><h2>Notas y glosario</h2><ul class="notes"><li>Los montos se calculan en centavos exactos, sin redondeos intermedios; los porcentajes se redondean a la centésima.</li><li>Los productos sin costo capturado cuentan en las ventas pero no en el costo, así que la utilidad sale más alta de lo real hasta que les pongas costo.</li><li>Los gastos son solo los que anotaste en la caja. Si falta alguno, la utilidad sale más alta de lo real.</li><li>Las listas completas de productos están en el Excel del resumen (F11, F3).</li></ul><dl class="glossary">${glossary
    .map(([term, meaning]) => `<dt>${escapeMarkup(term)}</dt><dd>${escapeMarkup(meaning)}</dd>`)
    .join('')}</dl></section>`;
}

/**
 * Builds the page of the illustrated report: a cover, the numbers at a glance, and one section per area with its charts
 * and a plain reading under each. Every text is escaped and the page carries a policy that blocks scripts and the network,
 * so it prints the same without internet.
 *
 * @param data the summary, the statement and the extras of the period, with the name of the business
 * @returns the HTML
 */
export function businessReportHtml(data: BusinessReportData): string {
  const accent = /^#[0-9a-f]{6}$/i.test(data.accentColor) ? data.accentColor : CHART_COLORS.total;
  const body = [
    coverSection({ ...data, accentColor: accent }),
    glanceSection(data),
    statementSectionHtml(data.statement),
    salesSection(data.summary),
    productsSection(data.summary, data.statement),
    expensesSection(data.statement),
    cashSection(data.summary, data.extras),
    inventorySection(data.summary),
    returnsSection(data.summary),
    suppliersSection(data.extras),
    notesSection(),
  ].join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeMarkup(
    `Reporte del negocio · ${data.businessName}`,
  )}</title><style>:root { --accent: ${accent}; }${STYLES}</style></head><body>${body}</body></html>`;
}

/**
 * Names the file of the report.
 *
 * @param summary the summary of the period
 * @returns a name such as `reporte-del-negocio-2026-11-01_a_2026-11-30.pdf`
 */
export function businessReportFileName(summary: Pick<DashboardSummary, 'period'>): string {
  const { fromDay, toDay } = summary.period;
  return `reporte-del-negocio-${fromDay === toDay ? fromDay : `${fromDay}_a_${toDay}`}.pdf`;
}
