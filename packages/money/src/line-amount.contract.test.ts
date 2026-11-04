import { describe, expect, test } from "vitest";

import cases from "@pos-saas/contracts/cases/line-amount.json" with { type: "json" };

import { LineAmountError, lineAmountCents } from "./line-amount.js";

describe("line amount contract", () => {
  test.each(cases.amounts)("$name", ({ unit_price_e4, quantity_milli, expected_amount_cents }) => {
    expect(lineAmountCents(unit_price_e4, quantity_milli)).toBe(expected_amount_cents);
  });

  test.each(cases.rejections)("$name", ({ unit_price_e4, quantity_milli, expected_error }) => {
    expect(() => lineAmountCents(unit_price_e4, quantity_milli)).toThrow(
      expect.objectContaining({ code: expected_error }),
    );
    expect(() => lineAmountCents(unit_price_e4, quantity_milli)).toThrow(LineAmountError);
  });
});

// A JavaScript number can hold decimals and a Java long cannot, so this check exists only here.
describe("line amount in TypeScript", () => {
  test.each([
    ["a price with decimals", 12.5, 1000],
    ["a quantity with decimals", 125000, 3.275],
    ["a price that lost its precision", 2 ** 53, 1000],
    ["a price that is not a number", Number.NaN, 1000],
  ])("rejects %s", (_description, unitPriceE4, quantityMilli) => {
    expect(() => lineAmountCents(unitPriceE4, quantityMilli)).toThrow(
      expect.objectContaining({ code: "not_an_integer" }),
    );
  });
});
