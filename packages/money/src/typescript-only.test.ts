import { describe, expect, test } from "vitest";

import { formatCents, sumCents } from "./cents.js";
import { lineAmountCents } from "./line-amount.js";
import { splitIncludedTax } from "./line-totals.js";
import { quantityOf, type Quantity } from "./quantity.js";
import { taxRateOf, type TaxRate } from "./tax-rate.js";
import type { Unit } from "./unit.js";

// A JavaScript number can hold decimals and a Java long cannot, so these checks exist only here.
describe("values that only TypeScript can receive", () => {
  test.each([
    ["a price with decimals", 12.5, 1000],
    ["a quantity with decimals", 125000, 3.275],
    ["a price that lost its precision", 2 ** 53, 1000],
    ["a price that is not a number", Number.NaN, 1000],
  ])("rejects %s", (_description, unitPriceE4, quantityMilli) => {
    expect(() => lineAmountCents(unitPriceE4, { milli: quantityMilli, unit: "meter" })).toThrow(
      expect.objectContaining({ code: "not_an_integer" }),
    );
  });

  test("rejects an amount with decimals in a sum", () => {
    expect(() => sumCents([4094, 0.5])).toThrow(expect.objectContaining({ code: "not_an_integer" }));
  });

  test("rejects a unit that is not one of the base units, such as a bad row from the database", () => {
    expect(() => quantityOf(1000, "bucket" as Unit)).toThrow(expect.objectContaining({ code: "unknown_unit" }));
  });

  test("checks a quantity that did not come from quantityOf", () => {
    const halfScrew: Quantity = { milli: 500, unit: "piece" };

    expect(() => lineAmountCents(1530, halfScrew)).toThrow(expect.objectContaining({ code: "fractional_piece" }));
  });

  test("rejects a tax rate with decimals", () => {
    expect(() => taxRateOf("rate", 16.5)).toThrow(expect.objectContaining({ code: "not_an_integer" }));
  });

  test("rejects an amount with decimals before splitting its VAT", () => {
    expect(() => splitIncludedTax(40.94, taxRateOf("rate", 1600))).toThrow(
      expect.objectContaining({ code: "not_an_integer" }),
    );
  });

  test("checks a tax rate that did not come from taxRateOf, such as a bad row from the database", () => {
    const exemptWithRate: TaxRate = { factor: "exempt", rateBp: 1600 };

    expect(() => splitIncludedTax(7000, exemptWithRate)).toThrow(
      expect.objectContaining({ code: "invalid_tax_rate" }),
    );
  });
});

describe("rounding", () => {
  test("rounds each line on its own, so the total can differ from rounding the sum", () => {
    const nails = quantityOf(125, "kilogram");
    const lines = [lineAmountCents(450000, nails), lineAmountCents(450000, nails)];

    // Each line is 562.5 cents and rounds to 563. Rounding only the total would give 1125.
    expect(sumCents(lines)).toBe(1126);
  });
});

describe("formatCents", () => {
  test.each([
    [0, "$0.00"],
    [5, "$0.05"],
    [4094, "$40.94"],
    [100000, "$1,000.00"],
    [123456789, "$1,234,567.89"],
    [Number.MAX_SAFE_INTEGER, "$90,071,992,547,409.91"],
  ])("shows %i cents as %s", (amountCents, expected) => {
    expect(formatCents(amountCents)).toBe(expected);
  });

  test.each([
    ["a negative amount", -1, "negative_input"],
    ["an amount with decimals", 40.94, "not_an_integer"],
  ])("rejects %s", (_description, amountCents, code) => {
    expect(() => formatCents(amountCents)).toThrow(expect.objectContaining({ code }));
  });
});
