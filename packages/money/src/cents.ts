import { readScaledInteger } from "./decimal-text.js";
import { MoneyError } from "./money-error.js";
import { MAX_VALUE, requireNonNegativeInteger } from "./value-limits.js";

const CENT_DECIMALS = 2;
const CENTS_PER_PESO = 100;

/**
 * Reads an amount of money typed as text, such as the cash a customer hands over: "40.94" is 4094 cents.
 *
 * @param text - Digits with up to 2 decimals, without a peso sign or commas.
 * @returns The amount in cents.
 * @throws {MoneyError} `invalid_format`, `too_many_decimals`, or `overflow`.
 */
export function parseCents(text: string): number {
  return readScaledInteger(text, CENT_DECIMALS);
}

/**
 * Adds amounts in cents, such as the lines of a sale. Each line was already rounded (ADR 0011), so the total is an
 * exact sum.
 *
 * @param amountsCents - The amounts to add.
 * @returns The total in cents, 0 for an empty list.
 * @throws {MoneyError} `not_an_integer` or `negative_input` for a bad amount, or `overflow` if the total exceeds
 * the largest supported value, as in Java.
 */
export function sumCents(amountsCents: readonly number[]): number {
  let totalCents = 0;
  for (const amountCents of amountsCents) {
    requireNonNegativeInteger(amountCents, "an amount in cents");
    // Checked before adding: past the limit, a JavaScript number silently loses cents.
    if (amountCents > MAX_VALUE - totalCents) {
      throw new MoneyError("overflow", `Adding ${amountCents} to ${totalCents} exceeds the largest supported value`);
    }
    totalCents += amountCents;
  }
  return totalCents;
}

/**
 * Shows an amount as people in Mexico write it: 123456 cents is "$1,234.56".
 *
 * It does not depend on the locale of the computer, so the screen and the ticket always agree.
 *
 * @param amountCents - The amount in cents.
 * @returns The amount with a peso sign, commas between thousands, and two decimals.
 * @throws {MoneyError} `not_an_integer` or `negative_input`.
 */
export function formatCents(amountCents: number): string {
  requireNonNegativeInteger(amountCents, "an amount in cents");
  const cents = amountCents % CENTS_PER_PESO;
  // A multiple of 100 divided by 100 is exact for any safe integer.
  const pesos = (amountCents - cents) / CENTS_PER_PESO;
  const pesosWithCommas = String(pesos).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${pesosWithCommas}.${String(cents).padStart(CENT_DECIMALS, "0")}`;
}
