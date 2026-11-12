import { formatCents, type Unit } from '@pos-saas/money';
import ExcelJS from 'exceljs';

import { formatUnitCost } from '../../shared/product-admin';
import { formatFolio, type OrderLine, type PurchaseOrder } from '../../shared/supplier-order';

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

/**
 * Builds the spreadsheet of the order: the same header, table and total as the PDF, with the codes as text (so a leading
 * zero is kept), the quantity and the money as numbers, and the amounts worked out by the register in whole cents, never by
 * the sheet.
 *
 * @param order the order to write, draft or sent
 * @param businessName the name of the business for the header
 * @returns the bytes of the .xlsx file
 */
export async function buildOrderWorkbook(order: PurchaseOrder, businessName: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = businessName;
  workbook.created = new Date(order.createdAt);
  const sheet = workbook.addWorksheet('Pedido', { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  sheet.columns = [{ width: 22 }, { width: 46 }, { width: 18 }, { width: 12 }, { width: 9 }, { width: 16 }, { width: 16 }];

  sheet.getCell('A1').value = businessName;
  sheet.getCell('A1').font = { bold: true, size: 14 };
  sheet.getCell('A2').value = 'Pedido al proveedor';
  sheet.getCell('A2').font = { bold: true, size: 12 };
  const facts: readonly (readonly [string, string])[] = [
    ['Proveedor', order.supplierName],
    ['Fecha', orderDate(order)],
    ['Folio', formatFolio(order.folio)],
  ];
  facts.forEach(([label, value], index) => {
    sheet.getCell(3 + index, 1).value = label;
    sheet.getCell(3 + index, 1).font = { bold: true };
    sheet.getCell(3 + index, 2).value = value;
  });

  const header = sheet.getRow(HEADER_ROW);
  header.values = [...ORDER_COLUMNS];
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEEEEE' } };
    cell.border = { bottom: { style: 'thin' } };
  });

  order.lines.forEach((line, index) => {
    const row = sheet.getRow(HEADER_ROW + 1 + index);
    row.getCell(1).value = line.supplierCode ?? '';
    row.getCell(2).value = line.description;
    row.getCell(3).value = line.barcode ?? '';
    row.getCell(4).value = line.quantityMilli / MILLI_PER_UNIT;
    row.getCell(5).value = orderUnitName(line.unit);
    row.getCell(6).value = line.unitCostE6 === null ? null : line.unitCostE6 / 1_000_000;
    row.getCell(7).value = line.lineTotalCents === null ? null : line.lineTotalCents / 100;
    // A code is text even when it is only digits, or a leading zero would be lost.
    row.getCell(1).numFmt = '@';
    row.getCell(3).numFmt = '@';
    row.getCell(4).numFmt = line.unit === 'piece' ? '#,##0' : '#,##0.000';
    row.getCell(6).numFmt = '"$"#,##0.00####';
    row.getCell(7).numFmt = '"$"#,##0.00';
  });

  const totalRow = sheet.getRow(HEADER_ROW + 1 + order.lines.length);
  totalRow.getCell(6).value = TOTAL_LABEL;
  totalRow.getCell(7).value = order.totalCents / 100;
  totalRow.getCell(7).numFmt = '"$"#,##0.00';
  totalRow.font = { bold: true };
  totalRow.getCell(6).alignment = { horizontal: 'right' };

  let next = HEADER_ROW + 3 + order.lines.length;
  if (order.linesWithoutCost > 0) {
    sheet.getCell(next, 1).value = `${order.linesWithoutCost} renglón(es) sin costo no están en el total.`;
    next += 1;
  }
  if (order.notes !== null) {
    sheet.getCell(next, 1).value = `Notas: ${order.notes}`;
  }
  sheet.views = [{ state: 'frozen', ySplit: HEADER_ROW }];

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
