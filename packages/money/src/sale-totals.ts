import { sumCents } from "./cents.js";
import { splitIncludedTax, type LineTotals } from "./line-totals.js";
import type { TaxRate } from "./tax-rate.js";

/** The lines that share a factor and a rate, added up. The invoice lists one per rate in its taxes node. */
export interface TaxGroup {
  readonly taxRate: TaxRate;
  /** The sum of the bases of the lines, in cents. */
  readonly baseCents: number;
  /** The sum of the VAT of the lines, in cents. */
  readonly taxCents: number;
}

/** The totals of a sale. The subtotal plus the VAT is always the total. */
export interface SaleTotals {
  readonly subtotalCents: number;
  readonly taxCents: number;
  /** What the customer pays: the amount checkout collects. */
  readonly totalCents: number;
  /** One group per rate, highest rate first, and exempt last. */
  readonly taxGroups: readonly TaxGroup[];
}

/** What a sale line needs for the totals: its total and its rate. */
export type TaxedLine = Pick<LineTotals, "totalCents" | "taxRate">;

/**
 * Adds up the lines of a sale. Each line is split from its own total and rate, so the totals always match the
 * lines, and the VAT of the sale is the sum of the VAT of its lines, as in CFDI 4.0 (ADR 0023).
 *
 * @param lines - The lines of the sale, such as the results of `lineTotals`.
 * @returns The subtotal, the VAT, the total, and the VAT grouped by rate. All zero for a sale with no lines.
 * @throws {MoneyError} The errors of `splitIncludedTax` for a bad line, or `overflow` if the total exceeds the largest
 * supported value.
 */
export function saleTotals(lines: readonly TaxedLine[]): SaleTotals {
  const splitLines = lines.map((line) => splitIncludedTax(line.totalCents, line.taxRate));
  const totalCents = sumCents(splitLines.map((line) => line.totalCents));
  // Bases and VAT are parts of the totals, so their sums stay within the limit once the total did.
  return {
    subtotalCents: sumCents(splitLines.map((line) => line.subtotalCents)),
    taxCents: sumCents(splitLines.map((line) => line.taxCents)),
    totalCents,
    taxGroups: groupByTaxRate(splitLines),
  };
}

/** Adds the base and the VAT of the lines that share a factor and a rate. */
function groupByTaxRate(lines: readonly LineTotals[]): TaxGroup[] {
  const groups = new Map<string, TaxGroup>();
  for (const line of lines) {
    const key = `${line.taxRate.factor}:${line.taxRate.rateBp}`;
    const group = groups.get(key);
    groups.set(key, {
      taxRate: line.taxRate,
      baseCents: (group?.baseCents ?? 0) + line.subtotalCents,
      taxCents: (group?.taxCents ?? 0) + line.taxCents,
    });
  }
  return [...groups.values()].sort(highestRateFirstExemptLast);
}

/** Orders the groups as the ticket and the invoice show them: 16%, 8%, 0%, and then exempt. */
function highestRateFirstExemptLast(first: TaxGroup, second: TaxGroup): number {
  if (first.taxRate.factor !== second.taxRate.factor) {
    return first.taxRate.factor === "exempt" ? 1 : -1;
  }
  return second.taxRate.rateBp - first.taxRate.rateBp;
}
