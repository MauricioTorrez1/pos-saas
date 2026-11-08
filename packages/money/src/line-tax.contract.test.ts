import { describe, expect, test } from "vitest";

import cases from "@pos-saas/contracts/cases/line-tax.json" with { type: "json" };

import { lineTotals } from "./line-totals.js";
import { MoneyError } from "./money-error.js";
import type { TaxFactor, TaxRate } from "./tax-rate.js";
import type { Unit } from "./unit.js";

/** The cases name the factor and the unit as text. lineTotals checks both, so a misspelled one fails the case. */
function lineFromCase(row: {
  unit_price_e4: number;
  quantity_milli: number;
  unit: string;
  tax_factor: string;
  tax_rate_bp: number;
}): () => ReturnType<typeof lineTotals> {
  const taxRate: TaxRate = { factor: row.tax_factor as TaxFactor, rateBp: row.tax_rate_bp };
  return () => lineTotals(row.unit_price_e4, { milli: row.quantity_milli, unit: row.unit as Unit }, taxRate);
}

describe("line tax contract", () => {
  test.each(cases.lines)("$name", (row) => {
    expect(lineFromCase(row)()).toEqual({
      subtotalCents: row.expected_subtotal_cents,
      taxCents: row.expected_tax_cents,
      totalCents: row.expected_total_cents,
      taxRate: { factor: row.tax_factor, rateBp: row.tax_rate_bp },
    });
  });

  test.each(cases.lines)("$name: the base plus the VAT is the total", (row) => {
    expect(row.expected_subtotal_cents + row.expected_tax_cents).toBe(row.expected_total_cents);
  });

  test.each(cases.rejections)("$name", (row) => {
    const calculate = lineFromCase(row);

    expect(calculate).toThrow(MoneyError);
    expect(calculate).toThrow(expect.objectContaining({ code: row.expected_error }));
  });
});
