import type { TaxRate } from '@pos-saas/money';

import { costNumberText, percentText, pesosText, quantityNumberText } from '../../shared/dashboard-format';
import type { Cell, Sheet } from '../export/xlsx';
import type { CatalogRow, CatalogTotals, CostSource } from './catalog-rows';

/** What every file of the catalog says at the top. */
export interface CatalogHeader {
  readonly businessName: string;
  /** When the file was made, as the owner reads it. */
  readonly generatedAt: string;
  readonly activeOnly: boolean;
}

const UNIT_NAMES = { piece: 'Pieza', meter: 'Metro', kilogram: 'Kilogramo', liter: 'Litro' } as const;
const COST_SOURCE_NAMES: Readonly<Record<CostSource, string>> = { typed: 'Capturado', average: 'Promedio de entradas', none: 'Sin costo' };
const NO_COST = 'sin costo';
const NO_PRICE = 'sin precio';

export const CATALOG_COLUMNS = [
  'Estado',
  'Código principal',
  'Otros códigos',
  'Producto',
  'Unidad',
  'Proveedores (código)',
  'Costo sin IVA',
  'Costo con IVA',
  'Precio con IVA',
  'IVA',
  'Existencia',
  'Margen bruto',
  'Margen neto',
  'Origen del costo',
] as const;

/** The legend every file carries, so nobody has to guess what a margin means (ADR 0071). */
export const CATALOG_LEGEND: readonly string[] = [
  'Margen bruto = (precio sin IVA − costo sin IVA) ÷ precio sin IVA. Es lo que se gana de cada peso de venta antes de IVA.',
  'Margen neto = (precio sin IVA − costo sin IVA) ÷ precio con IVA. Es lo que queda de cada peso que se cobra en caja, ya repuesto el producto y pagado el IVA al SAT.',
  'La caja no registra gastos (renta, sueldos, luz ni comisiones de tarjeta), así que el margen neto no los descuenta.',
  'Costo: el que capturó el dueño o, si no hay, el promedio ponderado de las entradas con costo. "sin costo" quiere decir que no hay ninguno: no se inventa un margen.',
  'Existencia: la suma del libro de movimientos de inventario. Las existencias en cero o negativas no suman al valor del inventario.',
  'Valor a costo = existencia × costo sin IVA. Valor a precio = existencia × precio con IVA.',
];

/** A whole number of ten-thousandths as exact decimal text, such as 125000 → `12.5000`. */
function priceNumberText(unitPriceE4: number): string {
  const rest = unitPriceE4 % 10_000;
  return `${(unitPriceE4 - rest) / 10_000}.${String(rest).padStart(4, '0')}`;
}

/** Leaves at least two decimals and drops the zeros after them: `12.500000` → `12.50`, `0.333300` → `0.3333`. */
function trimDecimals(text: string): string {
  const [whole, decimals = ''] = text.split('.');
  return `${whole}.${decimals.replace(/0+$/, '').padEnd(2, '0')}`;
}

function taxText(taxRate: TaxRate): string {
  return taxRate.factor === 'exempt' ? 'Exento' : `${percentText(taxRate.rateBp).replace(/\.00$/, '')} %`;
}

function suppliersText(row: CatalogRow): string {
  return row.suppliers.map((supplier) => `${supplier.supplierName} (${supplier.supplierCode})`).join('; ');
}

function marginText(row: CatalogRow, marginBp: number | null): string {
  if (row.costE6 === null) {
    return NO_COST;
  }
  return marginBp === null ? NO_PRICE : `${percentText(marginBp)} %`;
}

/** The texts of a row, the way the CSV and the PDF write them. */
function rowTexts(row: CatalogRow): string[] {
  return [
    row.isActive ? 'Activo' : 'Dado de baja',
    row.mainBarcode ?? '',
    row.otherBarcodes.join(' '),
    row.name,
    UNIT_NAMES[row.unit],
    suppliersText(row),
    row.costE6 === null ? NO_COST : trimDecimals(costNumberText(row.costE6)),
    row.costWithTaxE6 === null ? NO_COST : trimDecimals(costNumberText(row.costWithTaxE6)),
    trimDecimals(priceNumberText(row.unitPriceE4)),
    taxText(row.taxRate),
    quantityNumberText(row.stockMilli),
    marginText(row, row.grossMarginBp),
    marginText(row, row.netMarginBp),
    COST_SOURCE_NAMES[row.costSource],
  ];
}

function totalLines(totals: CatalogTotals): [string, string][] {
  const lines: [string, string][] = [
    ['Productos', String(totals.productCount)],
    ['Activos', String(totals.activeCount)],
    ['Dados de baja', String(totals.inactiveCount)],
    ['Sin costo', String(totals.withoutCostCount)],
    ['Valor del inventario a costo (sin IVA)', pesosText(totals.stockValueAtCostCents)],
    ['Valor del inventario a precio (con IVA)', pesosText(totals.stockValueAtPriceCents)],
  ];
  if (totals.stockedWithoutCostCount > 0) {
    lines.push(['Con existencia y sin costo (no suman al valor a costo)', String(totals.stockedWithoutCostCount)]);
  }
  return lines;
}

function titleOf(header: CatalogHeader): string {
  return header.activeOnly ? 'Catálogo de productos (solo activos)' : 'Catálogo de productos (activos y dados de baja)';
}

// --- CSV ---------------------------------------------------------------------------------------------------------------

/** Excel on Windows reads a CSV as UTF-8 only when it starts with this mark; without it the accents come out broken. */
export const UTF8_BOM = '﻿';
/** A text that starts with one of these is a formula for Excel, so a product named `=1+1` would be evaluated. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Writes one field of a CSV: quoted when it has a comma, a quote or a line break, with its quotes doubled (RFC 4180). A
 * text that Excel would take for a formula gets an apostrophe in front, so opening the file never runs anything.
 *
 * @param value the text of the field
 * @param isText false for the numbers the export itself wrote, which may start with a minus sign
 * @returns the field, ready to join with commas
 */
export function csvField(value: string, isText = true): string {
  const safe = isText && FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The columns of a row that hold a number the export wrote, and not a text a person typed. */
const NUMERIC_COLUMNS = new Set([6, 7, 8, 10, 11, 12]);

/**
 * Writes the catalog as a CSV for Excel on Windows: UTF-8 with its byte order mark, commas, and lines that end in CRLF.
 * The totals and the legend go after a blank line at the end.
 *
 * @param rows the rows
 * @param totals their totals
 * @param header the name of the business and when the file was made
 * @returns the text of the file, starting with the byte order mark
 */
export function catalogCsv(rows: readonly CatalogRow[], totals: CatalogTotals, header: CatalogHeader): string {
  const lines = [CATALOG_COLUMNS.map((column) => csvField(column)).join(',')];
  for (const row of rows) {
    lines.push(
      rowTexts(row)
        .map((value, index) => csvField(value, !(NUMERIC_COLUMNS.has(index) && /^-?\d/.test(value))))
        .join(','),
    );
  }
  lines.push('', csvField(`${titleOf(header)} · ${header.businessName} · ${header.generatedAt}`));
  for (const [label, value] of totalLines(totals)) {
    lines.push(`${csvField(label)},${csvField(value, false)}`);
  }
  lines.push('', csvField('Leyenda'), ...CATALOG_LEGEND.map((line) => csvField(line)));
  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}

// --- Excel -------------------------------------------------------------------------------------------------------------

const HEADER_ROW = 4;
const money = (decimal: string): Cell => ({ decimal, format: 'money' });
const percent = (basisPoints: number): Cell => ({ decimal: percentText(basisPoints), format: 'percent' });
const heading = (text: string): Cell => ({ heading: text });

function marginCell(row: CatalogRow, marginBp: number | null): Cell {
  if (row.costE6 === null) {
    return NO_COST;
  }
  return marginBp === null ? NO_PRICE : percent(marginBp);
}

function rowCells(row: CatalogRow): Cell[] {
  return [
    row.isActive ? 'Activo' : 'Dado de baja',
    row.mainBarcode,
    row.otherBarcodes.length === 0 ? null : row.otherBarcodes.join(' '),
    row.name,
    UNIT_NAMES[row.unit],
    row.suppliers.length === 0 ? null : suppliersText(row),
    row.costE6 === null ? NO_COST : money(costNumberText(row.costE6)),
    row.costWithTaxE6 === null ? NO_COST : money(costNumberText(row.costWithTaxE6)),
    money(priceNumberText(row.unitPriceE4)),
    taxText(row.taxRate),
    { decimal: quantityNumberText(row.stockMilli), format: 'quantity' },
    marginCell(row, row.grossMarginBp),
    marginCell(row, row.netMarginBp),
    COST_SOURCE_NAMES[row.costSource],
  ];
}

/**
 * Lays the catalog out as an Excel workbook: one sheet with a row per product and the totals at the end, with the
 * header row frozen, and a second sheet with the legend. Money, stock and margins are numbers, written from integers.
 * Codes are texts, so a barcode never loses its leading zeros.
 *
 * @param rows the rows
 * @param totals their totals
 * @param header the name of the business and when the file was made
 * @returns the sheets
 */
export function catalogSheets(rows: readonly CatalogRow[], totals: CatalogTotals, header: CatalogHeader): Sheet[] {
  const catalog: Cell[][] = [
    [{ text: titleOf(header), style: { bold: true, size: 14 } }],
    [header.businessName, `Generado el ${header.generatedAt}`],
    [],
    CATALOG_COLUMNS.map(heading),
    ...rows.map(rowCells),
    [],
    [heading('Totales')],
    ...totalLines(totals).map(([label, value], index): Cell[] => [label, index >= 4 && index <= 5 ? money(value) : { decimal: value, format: 'integer' }]),
  ];
  return [
    { name: 'Catálogo', rows: catalog, widths: [12, 16, 18, 42, 11, 30, 13, 13, 13, 8, 12, 12, 12, 20], frozenRows: HEADER_ROW },
    { name: 'Leyenda', rows: [[heading('Qué quiere decir cada columna')], ...CATALOG_LEGEND.map((line): Cell[] => [line])], widths: [140] },
  ];
}

// --- PDF ---------------------------------------------------------------------------------------------------------------

/**
 * Escapes a text for HTML. A product name is typed by a person and may hold `<`, `&` or quotes.
 *
 * @param text any text
 * @returns the text, safe inside an element or an attribute
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const PDF_STYLES = `
  @page { size: letter landscape; margin: 10mm 8mm 12mm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1b2328; font-size: 8px; margin: 0; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  h2 { font-size: 11px; margin: 12px 0 4px; page-break-after: avoid; }
  p { margin: 1px 0; color: #55626b; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; }
  thead { display: table-header-group; }
  th, td { padding: 2px 3px; border-bottom: 1px solid #c9d0d5; text-align: left; vertical-align: top; }
  thead th { border-bottom: 1.5px solid #1b2328; background: #eef1f3; }
  td.number { text-align: right; white-space: nowrap; }
  tr { page-break-inside: avoid; }
  tr.inactive td { color: #7a858d; }
  .totals { width: auto; page-break-inside: avoid; }
  .totals td { padding-right: 18px; }
  ul { margin: 0; padding-left: 14px; color: #55626b; }
`;

/** The columns the PDF right-aligns, by position. */
const PDF_NUMBER_COLUMNS = new Set([6, 7, 8, 10, 11, 12]);

/**
 * Builds the page that becomes the PDF: letter landscape, a header row that Chromium repeats on every page, the totals
 * and the legend at the end. Every text is escaped and the page carries a policy that blocks scripts and the network.
 *
 * @param rows the rows
 * @param totals their totals
 * @param header the name of the business and when the file was made
 * @returns the HTML
 */
export function catalogHtml(rows: readonly CatalogRow[], totals: CatalogTotals, header: CatalogHeader): string {
  const head = `<thead><tr>${CATALOG_COLUMNS.map((column) => `<th scope="col">${escapeHtml(column)}</th>`).join('')}</tr></thead>`;
  const body = rows
    .map(
      (row) =>
        `<tr${row.isActive ? '' : ' class="inactive"'}>${rowTexts(row)
          .map((text, index) => `<td${PDF_NUMBER_COLUMNS.has(index) ? ' class="number"' : ''}>${escapeHtml(text)}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  const totalsTable = `<table class="totals"><tbody>${totalLines(totals)
    .map(([label, value], index) => `<tr><td>${escapeHtml(label)}</td><td class="number">${escapeHtml(index >= 4 && index <= 5 ? `$${value}` : value)}</td></tr>`)
    .join('')}</tbody></table>`;
  const parts = [
    `<h1>${escapeHtml(header.businessName)}</h1>`,
    `<p>${escapeHtml(titleOf(header))} · Generado el ${escapeHtml(header.generatedAt)}</p>`,
    rows.length === 0 ? '<p>No hay productos que exportar.</p>' : `<table>${head}<tbody>${body}</tbody></table>`,
    '<h2>Totales</h2>',
    totalsTable,
    '<h2>Leyenda</h2>',
    `<ul>${CATALOG_LEGEND.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`,
  ];
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Catálogo de productos</title><style>${PDF_STYLES}</style></head><body>${parts.join('')}</body></html>`;
}

/**
 * Names the file of the catalog.
 *
 * @param day the day it is made, as `YYYY-MM-DD`
 * @param extension the format
 * @returns a name such as `catalogo-2026-11-18.xlsx`
 */
export function catalogFileName(day: string, extension: string): string {
  return `catalogo-${day}.${extension}`;
}
