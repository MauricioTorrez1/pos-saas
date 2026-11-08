import { MoneyError } from "./money-error.js";
import { MAX_VALUE } from "./value-limits.js";

// Only ASCII digits and one optional point. Java uses the same pattern, so both read the same text the same way.
const DECIMAL_TEXT = /^([0-9]*)(?:\.([0-9]*))?$/;
const MAX_VALUE_DIGITS = String(MAX_VALUE).length;

/**
 * Reads a decimal number typed as text into an integer with a fixed number of decimals, without floating point:
 * "3.275" with 3 decimals is 3275. `parseFloat("1.005") * 1000` gives 1004.999..., which is why this exists.
 *
 * Accepts digits with an optional point, such as "12", "12.5", ".5", or "12.". Rejects signs, spaces, commas,
 * currency signs, and exponents: the screen cleans what the cashier types, and the rule stays equal in Java.
 *
 * @param text - The number as text.
 * @param decimals - How many decimals the integer keeps: 2 for cents, 3 for quantities, 4 for unit prices.
 * @returns The number times 10 to the power of `decimals`.
 * @throws {MoneyError} `invalid_format`, `too_many_decimals`, or `overflow` if the result exceeds the limit.
 */
export function readScaledInteger(text: string, decimals: number): number {
  const match = typeof text === "string" ? DECIMAL_TEXT.exec(text) : null;
  const wholeDigits = match?.[1] ?? "";
  const fractionDigits = match?.[2] ?? "";
  if (match === null || wholeDigits.length + fractionDigits.length === 0) {
    throw new MoneyError("invalid_format", `Expected digits with an optional decimal point, got "${String(text)}"`);
  }
  if (fractionDigits.length > decimals) {
    throw new MoneyError("too_many_decimals", `Expected at most ${decimals} decimals, got "${text}"`);
  }

  const digits = (wholeDigits + fractionDigits.padEnd(decimals, "0")).replace(/^0+(?=[0-9])/, "");
  // Counting digits first keeps BigInt away from a text of thousands of digits.
  if (digits.length > MAX_VALUE_DIGITS || BigInt(digits) > BigInt(MAX_VALUE)) {
    throw new MoneyError("overflow", `"${text}" exceeds the largest supported value`);
  }
  return Number(digits);
}
