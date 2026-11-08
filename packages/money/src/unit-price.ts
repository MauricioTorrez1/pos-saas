import { formatCents } from "./cents.js";
import { readScaledInteger } from "./decimal-text.js";
import { requireNonNegativeInteger } from "./value-limits.js";

const UNIT_PRICE_DECIMALS = 4;
const E4_PER_CENT = 100;
const EXTRA_DECIMALS = 2;

/**
 * Reads a unit price written as text, such as a price from the catalog: "12.50" is 125000 ten-thousandths of a
 * peso, and "0.153" (a screw from a box of 1,000 at $153) is 1530.
 *
 * @param text - Digits with up to 4 decimals, without a peso sign or commas.
 * @returns The price in ten-thousandths of a peso.
 * @throws {MoneyError} `invalid_format`, `too_many_decimals`, or `overflow`.
 */
export function parseUnitPriceE4(text: string): number {
  return readScaledInteger(text, UNIT_PRICE_DECIMALS);
}

/**
 * Shows a unit price as people read it: two decimals, and more only when the price really has them. 125000 is
 * "$12.50", and 1530 (a screw from a box of 1,000 at $153) is "$0.153".
 *
 * @param unitPriceE4 - The price in ten-thousandths of a peso.
 * @returns The price with a peso sign, commas between thousands, and from two to four decimals.
 * @throws {MoneyError} `not_an_integer` or `negative_input`.
 */
export function formatUnitPriceE4(unitPriceE4: number): string {
  requireNonNegativeInteger(unitPriceE4, "a unit price in ten-thousandths of a peso");
  const fractionOfCent = unitPriceE4 % E4_PER_CENT;
  const wholeCents = formatCents((unitPriceE4 - fractionOfCent) / E4_PER_CENT);
  if (fractionOfCent === 0) {
    return wholeCents;
  }
  return `${wholeCents}${String(fractionOfCent).padStart(EXTRA_DECIMALS, "0").replace(/0$/, "")}`;
}
