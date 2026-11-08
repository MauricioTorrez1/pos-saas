import { describe, expect, test } from "vitest";

import cases from "@pos-saas/contracts/cases/amount-sum.json" with { type: "json" };

import { sumCents } from "./cents.js";
import { MoneyError } from "./money-error.js";

describe("amount sum contract", () => {
  test.each(cases.sums)("$name", ({ amounts_cents, expected_total_cents }) => {
    expect(sumCents(amounts_cents)).toBe(expected_total_cents);
  });

  test.each(cases.rejections)("$name", ({ amounts_cents, expected_error }) => {
    expect(() => sumCents(amounts_cents)).toThrow(MoneyError);
    expect(() => sumCents(amounts_cents)).toThrow(expect.objectContaining({ code: expected_error }));
  });
});
