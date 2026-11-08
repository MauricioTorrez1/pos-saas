import { lineAmountCents } from "./line-amount.js";
import type { Quantity } from "./quantity.js";
import { taxRateOf, type TaxRate } from "./tax-rate.js";
import { requireNonNegativeInteger } from "./value-limits.js";

/** 100% in basis points: a total that includes 16% VAT is 11600 / 10000 of its base. */
const BASIS_POINTS_PER_UNIT = 10_000;

/**
 * What a sale line keeps for the ticket and the invoice: the base without VAT, the VAT, and the total the customer
 * pays. The base plus the VAT is always the total (ADR 0023).
 */
export interface LineTotals {
  /** The base without VAT, in cents. The invoice calls it `Base`. */
  readonly subtotalCents: number;
  /** The VAT in cents. It is 0 for a product at 0% or exempt. */
  readonly taxCents: number;
  /** What the customer pays for the line, VAT included, in cents. */
  readonly totalCents: number;
  /** The rate the line was sold at. A later change of rate does not change the line. */
  readonly taxRate: TaxRate;
}

/**
 * Splits the VAT out of an amount that includes it: the base is rounded half up, and the VAT is the rest (ADR 0023).
 *
 * @param totalCents - The amount the customer pays, VAT included: 4094 is $40.94.
 * @param taxRate - The VAT of the product. It is checked again, because a plain object may not have come from
 * {@link taxRateOf}.
 * @returns The base, the VAT, and the total: 4094 at 16% is 3529 plus 565.
 * @throws {MoneyError} `not_an_integer` or `negative_input` for a bad amount, or the errors of {@link taxRateOf}.
 */
export function splitIncludedTax(totalCents: number, taxRate: TaxRate): LineTotals {
  requireNonNegativeInteger(totalCents, "an amount in cents");
  const checkedRate = taxRateOf(taxRate.factor, taxRate.rateBp);
  const subtotalCents =
    checkedRate.factor === "exempt" ? totalCents : baseOfIncludedTax(totalCents, checkedRate.rateBp);
  return { subtotalCents, taxCents: totalCents - subtotalCents, totalCents, taxRate: checkedRate };
}

/**
 * Calculates a sale line, VAT included: its amount as in ADR 0011, split into base and VAT as in ADR 0023.
 *
 * @param unitPriceE4 - Unit price with VAT, in ten-thousandths of a peso: $12.50 is 125000.
 * @param quantity - What was sold: 3.275 m is `quantityOf(3275, "meter")`.
 * @param taxRate - The VAT of the product: `taxRateOf("rate", 1600)` for 16%.
 * @returns The base, the VAT, and the total of the line.
 * @throws {MoneyError} The errors of `lineAmountCents` and of {@link taxRateOf}.
 */
export function lineTotals(unitPriceE4: number, quantity: Quantity, taxRate: TaxRate): LineTotals {
  return splitIncludedTax(lineAmountCents(unitPriceE4, quantity), taxRate);
}

/**
 * Calculates round_half_up(total × 10000 / (10000 + rate)) without multiplying the whole total, so no intermediate
 * value passes 2^53 and no BigInt is needed.
 */
function baseOfIncludedTax(totalCents: number, rateBp: number): number {
  const divisor = BASIS_POINTS_PER_UNIT + rateBp;
  // total = quotient × divisor + remainder, so total × 10000 / divisor = quotient × 10000 + remainder × 10000 / divisor.
  const remainder = totalCents % divisor;
  const quotient = (totalCents - remainder) / divisor;
  // The remainder is below 20001, so this product stays small. Adding half the divisor rounds half up.
  const roundedRemainder = floorDivide(2 * remainder * BASIS_POINTS_PER_UNIT + divisor, 2 * divisor);
  // quotient × 10000 is at most the total, so it is exact.
  return quotient * BASIS_POINTS_PER_UNIT + roundedRemainder;
}

/** Divides two non-negative safe integers, discarding the remainder, without going through a fraction. */
function floorDivide(dividend: number, divisor: number): number {
  return (dividend - (dividend % divisor)) / divisor;
}
