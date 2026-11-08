import { MoneyError } from "./money-error.js";

/**
 * The largest value of any amount, price, or quantity: the largest integer JavaScript represents exactly. Java
 * enforces the same limit, so a value means the same in both languages.
 */
export const MAX_VALUE = Number.MAX_SAFE_INTEGER;

/**
 * Checks that a value is a whole number from 0 up to {@link MAX_VALUE}.
 *
 * @param value - The value to check.
 * @param description - What the value is, for the error message: "a unit price".
 * @throws {MoneyError} `not_an_integer` if it has decimals or is beyond {@link MAX_VALUE}, or `negative_input`.
 */
export function requireNonNegativeInteger(value: number, description: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError("not_an_integer", `Expected ${description} to be a safe integer, got ${value}`);
  }
  // Negatives wait for returns (E1-15) to decide how they round (ADR 0020).
  if (value < 0) {
    throw new MoneyError("negative_input", `Expected ${description} to be zero or more, got ${value}`);
  }
}
