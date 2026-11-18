/**
 * Rows read from a photographed supplier catalog (E1-53, ADR 0069). They live only in the browser until the owner
 * approves them and downloads the CSV that the register imports (E1-51). Costs are integers in millionths of a peso
 * (`bigint`), never floats.
 */

/** Flags the analytics service puts on a row it is not sure about. */
export const ISSUE_LABELS: Record<string, string> = {
  price_unreadable: 'No se lee el precio',
  price_format_unclear: 'El precio tiene un formato dudoso',
  price_includes_vat: 'El precio parece incluir IVA',
  vat_unclear: 'No se sabe si el precio incluye IVA',
  multiple_prices: 'La línea tiene más de un precio',
  merged_lines: 'Puede estar mezclada con otra línea',
  text_unclear: 'El código o la descripción no se leen bien',
  code_missing: 'Sin código del proveedor',
  pieces_missing: 'No dice cuántas piezas trae',
  low_confidence: 'Lectura poco segura',
};

/** A row as the analytics service proposes it. `cost_e6` is digit text so no JSON number ever holds money. */
export interface ProposedRow {
  supplier_code: string | null;
  description: string;
  purchase_unit: string | null;
  pieces_per_unit: number | null;
  cost_e6: string | null;
  price_text: string | null;
  confidence: 'high' | 'medium' | 'low';
  issues: string[];
}

/** A row on the review screen: what the owner can edit, as text, plus whether it is approved. */
export interface ReviewRow {
  id: string;
  supplierCode: string;
  description: string;
  purchaseUnit: string;
  pieces: string;
  cost: string;
  issues: string[];
  approved: boolean;
}

/** A row that passed the checks of approval, ready for the CSV. */
export interface ApprovedRow {
  supplierCode: string;
  description: string;
  purchaseUnit: string;
  pieces: number;
  costE6: bigint;
}

const COST_SCALE = 6;
// Plain digits, or thousands groups of exactly three: "12,5" is a decimal comma and must not become 125.
const COST_INPUT = /^(\d{1,9}|\d{1,3}(?:,\d{3}){1,2})(?:\.(\d{1,6}))?$/;

/**
 * Reads a cost the owner typed, in pesos with up to six decimals.
 *
 * @param input - Text such as `"$1,234.5"`.
 * @returns The cost in millionths of a peso, or `null` when it is not a positive amount with at most six decimals.
 */
export function parseCostE6(input: string): bigint | null {
  const match = COST_INPUT.exec(input.trim().replace(/^\$/, '').replace(/\s/g, ''));
  if (!match) {
    return null;
  }
  const amount = BigInt((match[1] ?? '0').replace(/,/g, '')) * 10n ** BigInt(COST_SCALE) + BigInt((match[2] ?? '').padEnd(COST_SCALE, '0'));
  return amount > 0n ? amount : null;
}

/**
 * Writes millionths of a peso as pesos with two to six decimals: `1234500000n` gives `"1234.50"`.
 *
 * @param costE6 - A non-negative cost.
 */
export function formatCostE6(costE6: bigint): string {
  const scale = 10n ** BigInt(COST_SCALE);
  let fraction = String(costE6 % scale).padStart(COST_SCALE, '0');
  while (fraction.length > 2 && fraction.endsWith('0')) {
    fraction = fraction.slice(0, -1);
  }
  return `${costE6 / scale}.${fraction}`;
}

/**
 * Turns a proposed row into an editable one. A cost that is not digit text is left blank for the owner to type.
 *
 * @param row - The row of the service.
 * @param id - A key unique on the screen.
 */
export function toReviewRow(row: ProposedRow, id: string): ReviewRow {
  const cost = row.cost_e6 !== null && /^\d+$/.test(row.cost_e6) ? formatCostE6(BigInt(row.cost_e6)) : '';
  return {
    id,
    supplierCode: row.supplier_code ?? '',
    description: row.description,
    purchaseUnit: row.purchase_unit ?? '',
    pieces: row.pieces_per_unit === null ? '' : String(row.pieces_per_unit),
    cost,
    issues: row.issues,
    approved: false,
  };
}

/**
 * Checks a row before it is approved.
 *
 * @param row - The row as the owner left it.
 * @returns The approved row, or the reason in Spanish why it cannot be approved yet.
 */
export function approveRow(row: ReviewRow): { row: ApprovedRow } | { error: string } {
  const supplierCode = row.supplierCode.trim();
  const description = row.description.trim();
  if (!supplierCode) {
    return { error: 'Escribe el código del proveedor.' };
  }
  if (!description) {
    return { error: 'Escribe la descripción.' };
  }
  const pieces = /^\d{1,7}$/.test(row.pieces.trim()) ? Number.parseInt(row.pieces.trim(), 10) : 0;
  if (pieces < 1) {
    return { error: 'Escribe cuántas piezas trae (1 si se vende por pieza).' };
  }
  const costE6 = parseCostE6(row.cost);
  if (costE6 === null) {
    return { error: 'Escribe el costo sin IVA, con hasta 6 decimales.' };
  }
  return { row: { supplierCode, description, purchaseUnit: row.purchaseUnit.trim(), pieces, costE6 } };
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Columns agreed with the register's price-list import (E1-51). */
export const PRICE_LIST_HEADER = 'supplier_code,description,purchase_unit,pieces_per_unit,cost';

/**
 * Writes the approved rows as the CSV the register imports.
 *
 * @param rows - Approved rows, in the order they should appear.
 * @returns The file text, with CRLF line ends and no byte order mark.
 */
export function priceListCsv(rows: readonly ApprovedRow[]): string {
  const lines = rows.map((row) =>
    [row.supplierCode, row.description, row.purchaseUnit, String(row.pieces), formatCostE6(row.costE6)]
      .map(csvCell)
      .join(','),
  );
  return [PRICE_LIST_HEADER, ...lines].join('\r\n') + '\r\n';
}

/**
 * Builds a safe file name for a supplier's list.
 *
 * @param supplier - Name of the supplier as the owner typed it.
 */
export function priceListFileName(supplier: string): string {
  const slug = supplier
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `lista-${slug || 'proveedor'}.csv`;
}
