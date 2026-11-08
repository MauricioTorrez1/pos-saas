import { describe, expect, test } from "vitest";

import cases from "@pos-saas/contracts/cases/sale-totals.json" with { type: "json" };

import { MoneyError } from "./money-error.js";
import { saleTotals, type TaxedLine } from "./sale-totals.js";
import type { TaxFactor } from "./tax-rate.js";

interface CaseLine {
  total_cents: number;
  tax_factor: string;
  tax_rate_bp: number;
}

/** The cases name the factor as text. saleTotals checks it, so a misspelled factor fails the case. */
function linesFromCase(lines: readonly CaseLine[]): TaxedLine[] {
  return lines.map((line) => ({
    totalCents: line.total_cents,
    taxRate: { factor: line.tax_factor as TaxFactor, rateBp: line.tax_rate_bp },
  }));
}

describe("sale totals contract", () => {
  test.each(cases.sales)("$name", (sale) => {
    expect(saleTotals(linesFromCase(sale.lines))).toEqual({
      subtotalCents: sale.expected_subtotal_cents,
      taxCents: sale.expected_tax_cents,
      totalCents: sale.expected_total_cents,
      taxGroups: sale.expected_tax_groups.map((group) => ({
        taxRate: { factor: group.tax_factor, rateBp: group.tax_rate_bp },
        baseCents: group.base_cents,
        taxCents: group.tax_cents,
      })),
    });
  });

  test.each(cases.rejections)("$name", (sale) => {
    const calculate = (): unknown => saleTotals(linesFromCase(sale.lines));

    expect(calculate).toThrow(MoneyError);
    expect(calculate).toThrow(expect.objectContaining({ code: sale.expected_error }));
  });
});
