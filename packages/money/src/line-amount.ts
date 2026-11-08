import { MoneyError } from "./money-error.js";
import { quantityOf, type Quantity } from "./quantity.js";
import { requireNonNegativeInteger } from "./value-limits.js";

/** Ten-thousandths of a peso times thousandths of a unit, per cent (ADR 0011). */
const SCALE_PER_CENT = 100_000n;
const HALF_CENT = SCALE_PER_CENT / 2n;

/** The largest value of a Java long. Java fails above it, so TypeScript must fail too. */
const MAX_INTERMEDIATE = 2n ** 63n - 1n;

/**
 * Calculates the amount of a sale line, rounding half up, as defined in ADR 0011. Each line is rounded on its own,
 * and the total of a sale is the sum of its lines.
 *
 * @param unitPriceE4 - Unit price in ten-thousandths of a peso: $12.50 is 125000.
 * @param quantity - What was sold: 3.275 m is `quantityOf(3275, "meter")`. It is checked again, because a plain
 * object may not have come from {@link quantityOf}.
 * @returns The amount in cents: 4094 is $40.94.
 * @throws {MoneyError} If the price or the quantity is invalid, or `overflow` if the calculation exceeds the range
 * of a Java long.
 */
export function lineAmountCents(unitPriceE4: number, quantity: Quantity): number {
  requireNonNegativeInteger(unitPriceE4, "a unit price");
  const { milli } = quantityOf(quantity.milli, quantity.unit);

  // BigInt keeps the product exact: 125000 × 3275 is fine as a number, but large prices times large quantities
  // pass 2^53, where a number starts to drop digits.
  const roundedUpByHalfCent = BigInt(unitPriceE4) * BigInt(milli) + HALF_CENT;
  if (roundedUpByHalfCent > MAX_INTERMEDIATE) {
    throw new MoneyError("overflow", `${unitPriceE4} times ${milli} exceeds the supported range`);
  }

  // Below the limit, the result always fits in a safe integer, so this conversion is exact.
  return Number(roundedUpByHalfCent / SCALE_PER_CENT);
}
