import { describe, expect, test } from "vitest";

import cases from "@pos-saas/contracts/cases/text-input.json" with { type: "json" };

import { parseCents } from "./cents.js";
import { MoneyError } from "./money-error.js";
import { parseQuantity } from "./quantity.js";
import { parseUnitPriceE4 } from "./unit-price.js";
import type { Unit } from "./unit.js";

/** Reads the text the way the case asks: as cents, as a unit price, or as a quantity of a unit. */
function read(text: string, readsAs: string): number {
  switch (readsAs) {
    case "amount_cents":
      return parseCents(text);
    case "unit_price_e4":
      return parseUnitPriceE4(text);
    default:
      // parseQuantity checks the unit, so a misspelled one fails the case.
      return parseQuantity(text, readsAs as Unit).milli;
  }
}

describe("text input contract", () => {
  test.each(cases.values)("$name", ({ text, reads_as, expected_value }) => {
    expect(read(text, reads_as)).toBe(expected_value);
  });

  test.each(cases.rejections)("$name", ({ text, reads_as, expected_error }) => {
    expect(() => read(text, reads_as)).toThrow(MoneyError);
    expect(() => read(text, reads_as)).toThrow(expect.objectContaining({ code: expected_error }));
  });
});
