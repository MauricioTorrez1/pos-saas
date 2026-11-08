import { describe, expect, test } from "vitest";

import cases from "@pos-saas/contracts/cases/line-amount.json" with { type: "json" };

import { lineAmountCents } from "./line-amount.js";
import { MoneyError } from "./money-error.js";
import type { Quantity } from "./quantity.js";
import type { Unit } from "./unit.js";

/** The cases name their unit as text. lineAmountCents checks it, so a misspelled unit fails the case. */
function quantityFromCase(quantityMilli: number, unit: string): Quantity {
  return { milli: quantityMilli, unit: unit as Unit };
}

describe("line amount contract", () => {
  test.each(cases.amounts)("$name", ({ unit_price_e4, quantity_milli, unit, expected_amount_cents }) => {
    expect(lineAmountCents(unit_price_e4, quantityFromCase(quantity_milli, unit))).toBe(expected_amount_cents);
  });

  test.each(cases.rejections)("$name", ({ unit_price_e4, quantity_milli, unit, expected_error }) => {
    const calculate = (): number => lineAmountCents(unit_price_e4, quantityFromCase(quantity_milli, unit));

    expect(calculate).toThrow(MoneyError);
    expect(calculate).toThrow(expect.objectContaining({ code: expected_error }));
  });
});
