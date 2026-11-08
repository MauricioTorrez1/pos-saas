import { MoneyError } from "./money-error.js";
import { requireNonNegativeInteger } from "./value-limits.js";

/** How VAT applies to a product, as CFDI 4.0 names it: a rate (Tasa), even 0%, or exempt (Exento). */
export const TAX_FACTORS = ["rate", "exempt"] as const;

/** `rate` (16%, 8%, or 0%) or `exempt`. A 0% product and an exempt one pay no VAT, but the invoice tells them apart. */
export type TaxFactor = (typeof TAX_FACTORS)[number];

/** 100% in basis points, the highest rate the library accepts. The catalog decides which rates it offers (F0-17). */
export const MAX_RATE_BP = 10_000;

/**
 * The VAT of a product: 16% is `{ factor: "rate", rateBp: 1600 }`, and exempt is `{ factor: "exempt", rateBp: 0 }`.
 *
 * It is plain data, so it survives the bridge to the screen and a row of SQLite unchanged (ADR 0023).
 */
export interface TaxRate {
  readonly factor: TaxFactor;
  readonly rateBp: number;
}

/**
 * Creates a tax rate after checking it.
 *
 * @param factor - `rate` or `exempt`.
 * @param rateBp - The rate in basis points, from 0 to 10000: 16% is 1600. Exempt is always 0.
 * @returns The tax rate.
 * @throws {MoneyError} `not_an_integer`, `negative_input`, or `invalid_tax_rate` for an unknown factor, a rate above
 * 100%, or an exempt product with a rate.
 */
export function taxRateOf(factor: TaxFactor, rateBp: number): TaxRate {
  if (!(TAX_FACTORS as readonly unknown[]).includes(factor)) {
    throw new MoneyError("invalid_tax_rate", `Expected rate or exempt, got ${String(factor)}`);
  }
  requireNonNegativeInteger(rateBp, "a tax rate in basis points");
  if (rateBp > MAX_RATE_BP) {
    throw new MoneyError("invalid_tax_rate", `Expected a rate of at most ${MAX_RATE_BP} basis points, got ${rateBp}`);
  }
  if (factor === "exempt" && rateBp !== 0) {
    throw new MoneyError("invalid_tax_rate", `An exempt product has no rate, got ${rateBp} basis points`);
  }
  return { factor, rateBp };
}
