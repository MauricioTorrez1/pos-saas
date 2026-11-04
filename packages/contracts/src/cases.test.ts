import { describe, expect, test } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";

import lineAmountCases from "../cases/line-amount.json" with { type: "json" };
import lineAmountSchema from "../schemas/line-amount-cases.schema.json" with { type: "json" };
import valuesSchema from "../schemas/values.schema.json" with { type: "json" };

const ajv = new Ajv2020({ allErrors: true });
ajv.addSchema(valuesSchema, "values.schema.json");
const validateLineAmountCases = ajv.compile(lineAmountSchema);

const VALID_AMOUNT_CASE = lineAmountCases.amounts[0];

/** Wraps one amount case in a file that is valid except for that case. */
function fileWithAmountCase(amountCase: unknown): unknown {
  return { amounts: [amountCase], rejections: lineAmountCases.rejections };
}

describe("line amount cases", () => {
  test("follow their schema", () => {
    const isValid = validateLineAmountCases(lineAmountCases);

    expect(validateLineAmountCases.errors).toBeNull();
    expect(isValid).toBe(true);
  });

  test("accept a well-formed case, so the rejections below mean something", () => {
    expect(validateLineAmountCases(fileWithAmountCase(VALID_AMOUNT_CASE))).toBe(true);
  });

  test.each([
    ["a price with decimals", { unit_price_e4: 12.5 }],
    ["a quantity with decimals", { quantity_milli: 3.275 }],
    ["an amount with decimals", { expected_amount_cents: 40.94 }],
    ["a price above the safe integer limit", { unit_price_e4: 9007199254740992 }],
    ["a negative quantity in an amount case", { quantity_milli: -1 }],
    ["a number written as text", { quantity_milli: "3275" }],
    ["an unknown unit", { unit: "bucket" }],
    ["a misspelled field", { expected_amount: 4094 }],
  ])("reject %s", (_description, change) => {
    const brokenCase = { ...VALID_AMOUNT_CASE, ...change };

    expect(validateLineAmountCases(fileWithAmountCase(brokenCase))).toBe(false);
  });

  test("reject a case with no unit", () => {
    const { unit: _unit, ...caseWithoutUnit } = VALID_AMOUNT_CASE!;

    expect(validateLineAmountCases(fileWithAmountCase(caseWithoutUnit))).toBe(false);
  });

  test("reject an empty list of cases", () => {
    expect(validateLineAmountCases({ amounts: [], rejections: lineAmountCases.rejections })).toBe(false);
  });
});
