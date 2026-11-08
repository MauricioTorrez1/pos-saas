import { describe, expect, test } from "vitest";

import { splitIncludedTax } from "./line-totals.js";
import { taxRateOf } from "./tax-rate.js";

/** Every total from $0.00 to $1,000.00. */
const TOTALS_UP_TO_A_THOUSAND_PESOS = Array.from({ length: 100_001 }, (_, cents) => cents);

/**
 * The limits that Annex 20 of the SAT accepts for the VAT of an invoice line: (base − 0.005) × rate truncated, and
 * (base + 0.005) × rate rounded up. In cents and basis points: (2 × base ∓ 1) × rate / 20000.
 */
function satLimits(baseCents: number, rateBp: number): { lower: number; upper: number } {
  return {
    lower: Math.max(0, Math.floor(((2 * baseCents - 1) * rateBp) / 20_000)),
    upper: Math.ceil(((2 * baseCents + 1) * rateBp) / 20_000),
  };
}

describe("splitIncludedTax", () => {
  test.each([
    ["16%", 1600],
    ["8%", 800],
  ])("keeps the VAT within the SAT limits at %s for every total up to $1,000", (_description, rateBp) => {
    const taxRate = taxRateOf("rate", rateBp);
    const outsideTheLimits = TOTALS_UP_TO_A_THOUSAND_PESOS.filter((totalCents) => {
      const line = splitIncludedTax(totalCents, taxRate);
      const { lower, upper } = satLimits(line.subtotalCents, rateBp);
      return line.taxCents < lower || line.taxCents > upper;
    });

    expect(outsideTheLimits).toEqual([]);
  });

  test("always adds the base and the VAT up to the total", () => {
    const taxRate = taxRateOf("rate", 1600);
    const notAddingUp = TOTALS_UP_TO_A_THOUSAND_PESOS.filter((totalCents) => {
      const line = splitIncludedTax(totalCents, taxRate);
      return line.subtotalCents + line.taxCents !== totalCents || line.taxCents < 0;
    });

    expect(notAddingUp).toEqual([]);
  });
});
