import { percentLabel, percentText, periodLabel, pesosLabel, pesosText } from '../../shared/dashboard-format';
import { GENERAL_LINES, taxRateLabel, type IncomeStatement, type StatementLine } from '../../shared/income-statement';
import type { Cell, Sheet } from '../export/xlsx';

const money = (cents: number): Cell => ({ decimal: pesosText(cents), format: 'money' });
const heading = (text: string): Cell => ({ heading: text });
const share = (line: StatementLine): Cell => (line.shareBp === null ? 'sin datos' : { decimal: percentText(line.shareBp), format: 'percent' });
const shareLabel = (line: StatementLine): string => (line.shareBp === null ? 'sin datos' : percentLabel(line.shareBp));

/** The warnings that go with the numbers: missing costs, VAT and discounts. */
export function statementNotes(statement: IncomeStatement): string[] {
  const notes = [
    `IVA cobrado (no es ingreso, se le paga al SAT): ${pesosLabel(statement.vatCollectedCents)}.`,
    'La caja todavía no maneja descuentos, así que valen cero.',
    'Las comisiones de la tarjeta cuentan cuando las anotas en «Gastos» con el concepto «Comisiones del banco».',
  ];
  if (statement.uncosted.productCount > 0) {
    notes.unshift(
      `${String(statement.uncosted.productCount)} producto(s) vendidos sin costo (${pesosLabel(statement.uncosted.netSalesCents)} sin IVA): su venta sí cuenta pero su costo no, así que la utilidad sale más alta de lo real.`,
    );
  }
  return notes;
}

/**
 * Lays the income statement out as one sheet of Excel: the general view on top and the detail under it, every amount a
 * number with the format of money, written from integer cents.
 *
 * @param statement the statement
 * @returns the sheet
 */
export function statementSheet(statement: IncomeStatement): Sheet {
  const rows: Cell[][] = [
    [heading('Estado de resultados (antes de ISR, sin IVA)')],
    ['Periodo', periodLabel(statement.period)],
    ['Generado', statement.generatedAt],
    [],
    [heading('Renglón'), heading('Monto'), heading('% de ventas netas'), heading('Qué es')],
    ...GENERAL_LINES.map((line): Cell[] => [line.label, money(statement[line.key].amountCents), share(statement[line.key]), line.explanation]),
    [],
    [heading('Ventas por tasa de IVA'), heading('Vendido'), heading('Devuelto'), heading('Neto')],
    ...statement.detail.byTaxRate.map((rate): Cell[] => [taxRateLabel(rate), money(rate.soldCents), money(rate.returnedCents), money(rate.netCents)]),
    ['Ventas sin IVA', money(statement.grossSales.amountCents)],
    ['Devoluciones', money(statement.returns.amountCents)],
    ['Descuentos', money(statement.discounts.amountCents)],
    [],
    [heading('Costo de lo vendido por producto'), heading('Costo')],
    ...statement.detail.costByProduct.map((line): Cell[] => [line.name, money(line.costCents)]),
    [],
    [heading('Gastos por concepto'), heading('Monto'), heading('Veces'), heading('De la caja')],
    ...statement.detail.expensesByConcept.map((line): Cell[] => [
      line.concept,
      money(line.amountCents),
      { decimal: String(line.count), format: 'integer' },
      money(line.fromDrawerCents),
    ]),
    [],
    ...statementNotes(statement).map((note): Cell[] => [note]),
  ];
  return { name: 'Estado de resultados', rows, widths: [40, 18, 18, 60] };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function htmlTable(caption: string, headers: readonly string[], rows: readonly (readonly string[])[]): string {
  if (rows.length === 0) {
    return '';
  }
  return `<table><caption>${escapeHtml(caption)}</caption><thead><tr>${headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell, index) => (index === 0 ? `<th scope="row">${escapeHtml(cell)}</th>` : `<td>${escapeHtml(cell)}</td>`)).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

/**
 * Builds the income statement as a part of a page of HTML for the PDF, with every text escaped because a concept or a
 * product name is typed by a person.
 *
 * @param statement the statement
 * @returns the HTML of the section
 */
export function statementSection(statement: IncomeStatement): string {
  return [
    `<h2>Estado de resultados · ${escapeHtml(periodLabel(statement.period))}</h2>`,
    '<p>Antes del impuesto sobre la renta. Todos los montos son sin IVA.</p>',
    htmlTable(
      'Vista general',
      ['Renglón', 'Monto', '% de ventas netas'],
      GENERAL_LINES.map((line) => [`${line.label} — ${line.explanation}`, pesosLabel(statement[line.key].amountCents), shareLabel(statement[line.key])]),
    ),
    htmlTable(
      'Ventas por tasa de IVA',
      ['Tasa', 'Vendido', 'Devuelto', 'Neto'],
      statement.detail.byTaxRate.map((rate) => [taxRateLabel(rate), pesosLabel(rate.soldCents), pesosLabel(rate.returnedCents), pesosLabel(rate.netCents)]),
    ),
    htmlTable('Costo de lo vendido por producto', ['Producto', 'Costo'], statement.detail.costByProduct.map((line) => [line.name, pesosLabel(line.costCents)])),
    htmlTable(
      'Gastos por concepto',
      ['Concepto', 'Monto', 'Veces', 'De la caja'],
      statement.detail.expensesByConcept.map((line) => [line.concept, pesosLabel(line.amountCents), String(line.count), pesosLabel(line.fromDrawerCents)]),
    ),
    ...statementNotes(statement).map((note) => `<p>${escapeHtml(note)}</p>`),
  ].join('');
}

/**
 * Names the file the statement alone is saved as.
 *
 * @param statement the statement
 * @param extension `xlsx` or `pdf`
 * @returns a name such as `estado-de-resultados-2026-11-01_a_2026-11-30.pdf`
 */
export function statementFileName(statement: IncomeStatement, extension: 'xlsx' | 'pdf'): string {
  const { fromDay, toDay } = statement.period;
  return `estado-de-resultados-${fromDay === toDay ? fromDay : `${fromDay}_a_${toDay}`}.${extension}`;
}
