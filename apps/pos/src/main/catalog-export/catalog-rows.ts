import type { TaxRate, Unit } from '@pos-saas/money';

import { costWithTaxE6 } from '../../shared/pricing';
import { costInCents, divideHalfUp } from '../reports/average-cost';

/** A supplier of a product, with the code the supplier gives it. */
export interface SupplierCode {
  readonly supplierName: string;
  readonly supplierCode: string;
}

/** Where the cost of a product comes from: typed by the owner, the weighted average of the entries, or nowhere. */
export type CostSource = 'typed' | 'average' | 'none';

/** A product as the database has it, before anything is worked out. */
export interface CatalogProductRecord {
  readonly id: string;
  readonly name: string;
  readonly unit: Unit;
  /** Sale price with VAT, in ten-thousandths of a peso. */
  readonly unitPriceE4: number;
  readonly taxRate: TaxRate;
  readonly isActive: boolean;
  /** Every barcode, in the order the product panel shows them. */
  readonly barcodes: readonly string[];
  readonly suppliers: readonly SupplierCode[];
  /** Cost per unit without VAT in millionths of a peso, or null when the register has none. */
  readonly costE6: number | null;
  readonly costSource: CostSource;
  /** The stock the ledger adds up to, in thousandths of the unit. */
  readonly stockMilli: number;
}

/** One row of the exported catalog: the record plus what is worked out from it with integer math. */
export interface CatalogRow extends CatalogProductRecord {
  /** The first barcode, or null when the product has none. */
  readonly mainBarcode: string | null;
  readonly otherBarcodes: readonly string[];
  /** Cost per unit with VAT in millionths of a peso, or null without a cost. */
  readonly costWithTaxE6: number | null;
  /** Gross margin in basis points (3,333 is 33.33 %), or null without a cost or without a price. */
  readonly grossMarginBp: number | null;
  /** Net margin in basis points, or null without a cost or without a price. */
  readonly netMarginBp: number | null;
  /** What the stock is worth at cost, in cents, or null when it is not counted: no cost, or no stock above zero. */
  readonly stockValueAtCostCents: number | null;
  /** What the stock is worth at the sale price with VAT, in cents, or null when there is no stock above zero. */
  readonly stockValueAtPriceCents: number | null;
}

/** The totals at the end of the file. */
export interface CatalogTotals {
  readonly productCount: number;
  readonly activeCount: number;
  readonly inactiveCount: number;
  readonly withoutCostCount: number;
  readonly stockValueAtCostCents: number;
  readonly stockValueAtPriceCents: number;
  /** Products with stock above zero and no cost: their stock is not in the value at cost. */
  readonly stockedWithoutCostCount: number;
}

const BP = 10_000n;
/** A cent is 100 thousand of quantity (thousandths) times price (ten-thousandths), as in ADR 0011. */
const PRICE_DIVISOR = 100_000n;
const E4_TO_E6 = 100n;

/** Divides rounding half away from zero, so a margin of −12.345 % reads −12.35 % like +12.345 % reads 12.35 %. */
function divideRounded(numerator: bigint, denominator: bigint): number {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const quotient = (magnitude * 2n + denominator) / (denominator * 2n);
  return Number(negative ? -quotient : quotient);
}

/** The stock at the sale price, rounded half up like a sale line; it also accepts a stray fraction of a piece. */
function priceValueCents(stockMilli: number, unitPriceE4: number): number {
  return Number(divideHalfUp(BigInt(stockMilli) * BigInt(unitPriceE4), PRICE_DIVISOR));
}

/**
 * Works out the gross and the net margin of a price over a cost, exactly, on integers (ADR 0071):
 * - gross = (price without VAT − cost without VAT) / price without VAT
 * - net = (price without VAT − cost without VAT) / price with VAT: of each peso the customer pays at the till, what stays
 *   once the product is replaced and the VAT is paid to the SAT. The register records no expenses, so none is taken out.
 * The price without VAT is never rounded on the way: both margins are one fraction rounded once, half away from zero.
 *
 * @param unitPriceE4 the sale price with VAT, in ten-thousandths of a peso
 * @param taxRate the VAT of the product
 * @param costE6 the cost without VAT, in millionths of a peso
 * @returns both margins in basis points, or null for a product with a price of zero
 */
export function marginsBp(unitPriceE4: number, taxRate: TaxRate, costE6: number): { readonly grossBp: number; readonly netBp: number } | null {
  if (unitPriceE4 <= 0) {
    return null;
  }
  const rateBp = taxRate.factor === 'rate' ? BigInt(taxRate.rateBp) : 0n;
  // With P the price with VAT in millionths and r the rate: base = P × 10000 / (10000 + r). Multiplying everything by
  // (10000 + r) keeps the base exact: profit × (10000 + r) = P × 10000 − cost × (10000 + r).
  const priceE6 = BigInt(unitPriceE4) * E4_TO_E6;
  const scaledProfit = priceE6 * BP - BigInt(costE6) * (BP + rateBp);
  const scaledBase = priceE6 * BP;
  return {
    grossBp: divideRounded(scaledProfit * BP, scaledBase),
    netBp: divideRounded(scaledProfit * BP, priceE6 * (BP + rateBp)),
  };
}

/**
 * Turns a product as the database has it into a row of the export: codes split into the main one and the others, the
 * cost with VAT, both margins and what its stock is worth. A product without a cost has no margin, never a made-up one.
 *
 * @param record the product
 * @returns the row
 */
export function buildCatalogRow(record: CatalogProductRecord): CatalogRow {
  const [mainBarcode = null, ...otherBarcodes] = record.barcodes;
  const margins = record.costE6 === null ? null : marginsBp(record.unitPriceE4, record.taxRate, record.costE6);
  const hasStock = record.stockMilli > 0;
  return {
    ...record,
    mainBarcode,
    otherBarcodes,
    costWithTaxE6: record.costE6 === null ? null : costWithTaxE6(record.costE6, record.taxRate),
    grossMarginBp: margins?.grossBp ?? null,
    netMarginBp: margins?.netBp ?? null,
    stockValueAtCostCents: hasStock && record.costE6 !== null ? costInCents(record.stockMilli, record.costE6) : null,
    stockValueAtPriceCents: hasStock ? priceValueCents(record.stockMilli, record.unitPriceE4) : null,
  };
}

/**
 * Adds up the rows for the end of the file. Stock at zero or below adds nothing: a negative stock is a count to fix, not
 * money the store has.
 *
 * @param rows the rows that were exported
 * @returns the totals
 */
export function catalogTotals(rows: readonly CatalogRow[]): CatalogTotals {
  let activeCount = 0;
  let withoutCostCount = 0;
  let stockedWithoutCostCount = 0;
  let atCost = 0;
  let atPrice = 0;
  for (const row of rows) {
    activeCount += row.isActive ? 1 : 0;
    withoutCostCount += row.costE6 === null ? 1 : 0;
    stockedWithoutCostCount += row.costE6 === null && row.stockMilli > 0 ? 1 : 0;
    atCost += row.stockValueAtCostCents ?? 0;
    atPrice += row.stockValueAtPriceCents ?? 0;
  }
  return {
    productCount: rows.length,
    activeCount,
    inactiveCount: rows.length - activeCount,
    withoutCostCount,
    stockValueAtCostCents: atCost,
    stockValueAtPriceCents: atPrice,
    stockedWithoutCostCount,
  };
}
