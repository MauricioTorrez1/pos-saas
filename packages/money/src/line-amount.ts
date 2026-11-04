/** Ten-thousandths of a peso times thousandths of a unit, per cent (ADR 0011). */
const SCALE_PER_CENT = 100_000n;
const HALF_CENT = SCALE_PER_CENT / 2n;

/** The largest value of a Java long. Java fails above it, so TypeScript must fail too. */
const MAX_INTERMEDIATE = 2n ** 63n - 1n;

export type LineAmountErrorCode = "not_an_integer" | "negative_input" | "overflow";

/** Tells why a line amount could not be calculated. */
export class LineAmountError extends RangeError {
  readonly code: LineAmountErrorCode;

  constructor(code: LineAmountErrorCode, message: string) {
    super(message);
    this.name = "LineAmountError";
    this.code = code;
  }
}

/**
 * Calculates the amount of a sale line, rounding half up, as defined in ADR 0011.
 *
 * @param unitPriceE4 - Unit price in ten-thousandths of a peso: $12.50 is 125000.
 * @param quantityMilli - Quantity in thousandths of its unit: 3.275 m is 3275.
 * @returns The amount in cents: 4094 is $40.94.
 * @throws {LineAmountError} If an input is not a safe integer or is negative, or if the
 * calculation exceeds the range of a Java long.
 */
export function lineAmountCents(unitPriceE4: number, quantityMilli: number): number {
  if (!Number.isSafeInteger(unitPriceE4) || !Number.isSafeInteger(quantityMilli)) {
    throw new LineAmountError("not_an_integer", `Expected safe integers, got ${unitPriceE4} and ${quantityMilli}`);
  }
  if (unitPriceE4 < 0 || quantityMilli < 0) {
    throw new LineAmountError("negative_input", `Expected non-negative values, got ${unitPriceE4} and ${quantityMilli}`);
  }

  const roundedUpByHalfCent = BigInt(unitPriceE4) * BigInt(quantityMilli) + HALF_CENT;
  if (roundedUpByHalfCent > MAX_INTERMEDIATE) {
    throw new LineAmountError("overflow", `${unitPriceE4} times ${quantityMilli} exceeds the supported range`);
  }

  // Below the limit, the result always fits in a safe integer, so this conversion is exact.
  return Number(roundedUpByHalfCent / SCALE_PER_CENT);
}
