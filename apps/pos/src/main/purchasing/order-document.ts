import { formatCents, type Unit } from '@pos-saas/money';

import { costNumberText, pesosText } from '../../shared/dashboard-format';
import { formatUnitCost } from '../../shared/product-admin';
import { formatFolio, type OrderLine, type PurchaseOrder } from '../../shared/supplier-order';
import { buildWorkbook, type Cell, type CellStyle, type Sheet } from '../export/xlsx';

/** The titles of the columns of the order, in the order they are printed and written. */
export const ORDER_COLUMNS = ['Código del proveedor', 'Descripción', 'Código de barras', 'Cantidad', 'Unidad', 'Costo estimado', 'Importe'] as const;

/** The words next to the total, which the tests and the spreadsheet readers find the total by. */
export const TOTAL_LABEL = 'Total estimado';

const UNIT_NAMES: Readonly<Record<Unit, string>> = { piece: 'pza', meter: 'm', kilogram: 'kg', liter: 'L' };
const MILLI_PER_UNIT = 1000;
const MILLI_DECIMALS = 3;
const DATE_FORMAT = new Intl.DateTimeFormat('es-MX', { dateStyle: 'long' });
const MISSING = '—';

/**
 * Writes a quantity the way the order shows it: whole for pieces, and with three decimals for what is measured.
 *
 * @param quantityMilli the quantity in thousandths of the unit
 * @param unit the unit of the product
 * @returns the number without the unit, such as "3" or "3.275"
 */
export function formatOrderQuantity(quantityMilli: number, unit: Unit): string {
  const thousandths = quantityMilli % MILLI_PER_UNIT;
  const whole = (quantityMilli - thousandths) / MILLI_PER_UNIT;
  return unit === 'piece' ? String(whole) : `${whole}.${String(thousandths).padStart(MILLI_DECIMALS, '0')}`;
}

/**
 * Names the unit of an order line.
 *
 * @param unit the unit of the product
 * @returns its short name, such as "pza"
 */
export function orderUnitName(unit: Unit): string {
  return UNIT_NAMES[unit];
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The day the order is dated: the day it was sent, or else the day it was last saved. */
function orderDate(order: PurchaseOrder): string {
  return DATE_FORMAT.format(new Date(order.sentAt ?? order.updatedAt));
}

function costText(line: OrderLine): string {
  return line.unitCostE6 === null ? MISSING : formatUnitCost(line.unitCostE6);
}

function amountText(line: OrderLine): string {
  return line.lineTotalCents === null ? MISSING : formatCents(line.lineTotalCents);
}

/**
 * Builds the page that is printed to PDF: the name of the business, the supplier, the date, the folio, the table of lines
 * and the total. Everything that comes from the database is escaped, and the page has no script and loads nothing, so printing
 * it cannot reach anything but its own text.
 *
 * @param order the order to print, draft or sent
 * @param businessName the name of the business for the header
 * @returns the HTML of the page
 */
export function renderOrderHtml(order: PurchaseOrder, businessName: string): string {
  const rows = order.lines
    .map(
      (line) => `<tr>
        <td>${escapeHtml(line.supplierCode ?? MISSING)}</td>
        <td>${escapeHtml(line.description)}</td>
        <td>${escapeHtml(line.barcode ?? MISSING)}</td>
        <td class="number">${formatOrderQuantity(line.quantityMilli, line.unit)}</td>
        <td>${orderUnitName(line.unit)}</td>
        <td class="number">${escapeHtml(costText(line))}</td>
        <td class="number">${escapeHtml(amountText(line))}</td>
      </tr>`,
    )
    .join('\n');
  const withoutCost =
    order.linesWithoutCost === 0
      ? ''
      : `<p class="note">${order.linesWithoutCost} renglón(es) sin costo no están en el total.</p>`;
  const notes = order.notes === null ? '' : `<p class="note"><strong>Notas:</strong> ${escapeHtml(order.notes)}</p>`;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(formatFolio(order.folio))} ${escapeHtml(order.supplierName)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 11pt; color: #111; }
  h1 { font-size: 18pt; margin: 0 0 2mm; }
  h2 { font-size: 13pt; margin: 0 0 4mm; font-weight: 600; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 1mm 4mm; margin: 0 0 6mm; }
  dt { font-weight: 600; }
  dd { margin: 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border-bottom: 1px solid #bbb; padding: 2mm; text-align: left; vertical-align: top; }
  th { background: #eee; font-size: 10pt; }
  .number { text-align: right; white-space: nowrap; }
  tfoot td { border-bottom: none; font-weight: 700; font-size: 12pt; }
  .note { margin-top: 4mm; font-size: 10pt; }
</style>
</head>
<body>
<h1>${escapeHtml(businessName)}</h1>
<h2>Pedido al proveedor</h2>
<dl>
  <dt>Proveedor</dt><dd>${escapeHtml(order.supplierName)}</dd>
  <dt>Fecha</dt><dd>${escapeHtml(orderDate(order))}</dd>
  <dt>Folio</dt><dd>${escapeHtml(formatFolio(order.folio))}</dd>
</dl>
<table>
  <thead><tr>${ORDER_COLUMNS.map((title) => `<th>${title}</th>`).join('')}</tr></thead>
  <tbody>
${rows}
  </tbody>
  <tfoot><tr><td colspan="6" class="number">${TOTAL_LABEL}</td><td class="number">${escapeHtml(formatCents(order.totalCents))}</td></tr></tfoot>
</table>
${withoutCost}
${notes}
</body>
</html>`;
}

const HEADER_ROW = 6;
const ORDER_WIDTHS = [22, 46, 18, 12, 9, 16, 16] as const;
const HEADER_STYLE: CellStyle = { bold: true, fill: 'EEEEEE', bottomBorder: true };
/** A code is text even when it is only digits, or a leading zero would be lost. */
const CODE_STYLE: CellStyle = { numFormat: '@' };
const MONEY_FORMAT = { code: '"$"#,##0.00' } as const;
const COST_FORMAT = { code: '"$"#,##0.00####' } as const;

function codeCell(code: string | null): Cell {
  return code === null ? null : { text: code, style: CODE_STYLE };
}

function lineCells(line: OrderLine): Cell[] {
  return [
    codeCell(line.supplierCode),
    line.description,
    codeCell(line.barcode),
    { decimal: formatOrderQuantity(line.quantityMilli, line.unit), format: { code: line.unit === 'piece' ? '#,##0' : '#,##0.000' } },
    orderUnitName(line.unit),
    line.unitCostE6 === null ? null : { decimal: costNumberText(line.unitCostE6), format: COST_FORMAT },
    line.lineTotalCents === null ? null : { decimal: pesosText(line.lineTotalCents), format: MONEY_FORMAT },
  ];
}

/**
 * Lays the order out as the sheet of an Excel workbook: the same header, table and total as the PDF, with the codes as text
 * (so a leading zero is kept), the quantity and the money as numbers written as the exact decimals of the integers the
 * register keeps, and the amounts worked out by the register in whole cents, never by the sheet.
 *
 * @param order the order to write, draft or sent
 * @param businessName the name of the business for the header
 * @returns the sheet, to be written by `buildWorkbook`
 */
export function orderSheet(order: PurchaseOrder, businessName: string): Sheet {
  const rows: Cell[][] = [
    [{ text: businessName, style: { bold: true, size: 14 } }],
    [{ text: 'Pedido al proveedor', style: { bold: true, size: 12 } }],
    [{ heading: 'Proveedor' }, order.supplierName],
    [{ heading: 'Fecha' }, orderDate(order)],
    [{ heading: 'Folio' }, formatFolio(order.folio)],
    ORDER_COLUMNS.map((title): Cell => ({ text: title, style: HEADER_STYLE })),
    ...order.lines.map(lineCells),
    [
      null,
      null,
      null,
      null,
      null,
      { text: TOTAL_LABEL, style: { bold: true, alignRight: true } },
      { decimal: pesosText(order.totalCents), format: MONEY_FORMAT, style: { bold: true } },
    ],
  ];
  if (order.linesWithoutCost > 0 || order.notes !== null) {
    rows.push([]);
  }
  if (order.linesWithoutCost > 0) {
    rows.push([`${order.linesWithoutCost} renglón(es) sin costo no están en el total.`]);
  }
  if (order.notes !== null) {
    rows.push([`Notas: ${order.notes}`]);
  }
  return { name: 'Pedido', rows, widths: ORDER_WIDTHS, frozenRows: HEADER_ROW, fitToPageWidth: true };
}

/**
 * Builds the spreadsheet of the order with the shared Excel writer.
 *
 * @param order the order to write, draft or sent
 * @param businessName the name of the business for the header and the author of the file
 * @returns the bytes of the .xlsx file
 */
export function buildOrderWorkbook(order: PurchaseOrder, businessName: string): Buffer {
  return buildWorkbook([orderSheet(order, businessName)], { creator: businessName, created: new Date(order.createdAt) });
}
