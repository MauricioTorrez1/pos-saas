# Contracts

JSON schemas and calculation cases shared by the TypeScript register and the Java core. The register has to calculate without internet, so the same rule exists in two languages ([ADR 0009](../../docs/adr/0009-logica-local-typescript.md)). These cases keep both equal: if one language calculates differently, CI turns red. OpenAPI files will join them with the first endpoint.

| Path | Contents |
| --- | --- |
| `schemas/values.schema.json` | Integer scales from [ADR 0011](../../docs/adr/0011-precision-monetaria.md), and the base units |
| `schemas/line-amount-cases.schema.json` | The shape of a file of line amount cases |
| `cases/line-amount.json` | The cases: `amounts` must produce a result, and `rejections` must fail |
| `src/cases.test.ts` | Checks that the cases follow their schema, and that the schema rejects bad ones |

## Who runs the cases
| Language | Test | Calculation |
| --- | --- | --- |
| TypeScript | [`line-amount.contract.test.ts`](../money/src/line-amount.contract.test.ts) | [`line-amount.ts`](../money/src/line-amount.ts) |
| Java | [`LineAmountContractTest`](../../services/core/src/test/java/io/github/mauriciotorrez1/pos/money/LineAmountContractTest.java) | [`LineAmount`](../../services/core/src/main/java/io/github/mauriciotorrez1/pos/money/LineAmount.java) |

Only TypeScript validates against the schema, because the `TypeScript` job runs on every pull request. Java reads the same file with a strict parser, so a case with decimals or a misspelled field also fails there.

## Add a case
Add an entry to `amounts` in `cases/line-amount.json`. The file names its schema, so editors such as VS Code autocomplete and check it as you type.

```json
{
  "name": "Say what this case protects",
  "unit_price_e4": 20000,
  "quantity_milli": 1000,
  "unit": "piece",
  "expected_amount_cents": 200
}
```

| Field | How to write it | Example |
| --- | --- | --- |
| `unit_price_e4` | Pesos times 10,000 | $2.00 is `20000` |
| `quantity_milli` | Quantity times 1,000 | 1 piece is `1000` |
| `unit` | `piece`, `meter`, `kilogram`, or `liter` | `piece` |
| `expected_amount_cents` | Work it out by hand: `unit_price_e4 × quantity_milli / 100000`, rounding half up | `200` |

Then run the cases in both languages. TypeScript, from the repository root:

```bash
pnpm test
```

Java, from `services/core` (in PowerShell or CMD, use `mvnw.cmd`):

```bash
./mvnw test -Dtest=LineAmountContractTest
```

## Versioning
The version is in `package.json`. Today both languages live in the same commit, so CI catches any mismatch. The version starts to matter when a register that has not updated talks to a newer server.

| Change | Compatible? | Version |
| --- | --- | --- |
| Add a case, or an optional field | Yes, old readers keep working | Minor |
| Fix a typo in a description | Yes | Patch |
| Change an expected result, or the meaning of a field | No, it changes what a sale costs | Major, with a new ADR |
| Rename or remove a field, make one required, or add a unit that old readers reject | No, old readers fail | Major |
