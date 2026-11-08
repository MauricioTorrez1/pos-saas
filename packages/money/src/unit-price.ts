import { readScaledInteger } from "./decimal-text.js";

const UNIT_PRICE_DECIMALS = 4;

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
