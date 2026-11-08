# Money

Money and quantity logic in TypeScript, using integers only, as defined in [ADR 0011](../../docs/adr/0011-precision-monetaria.md). The Java core has the same rules in [`pos.money`](../../services/core/src/main/java/io/github/mauriciotorrez1/pos/money/), and the shared cases of [`packages/contracts`](../contracts/README.md) keep both equal.

| Function | What it does | Example |
| --- | --- | --- |
| `lineAmountCents(unitPriceE4, quantity)` | Amount of a sale line, rounded half up | `125000` × 3.275 m is `4094` |
| `sumCents(amountsCents)` | Total of the lines of a sale | `[4094, 107]` is `4201` |
| `quantityOf(milli, unit)` | A checked quantity. Pieces are whole | `quantityOf(3275, "meter")` |
| `parseQuantity(text, unit)` | Reads a typed quantity, up to 3 decimals | `"3.275"` is `3275` |
| `parseUnitPriceE4(text)` | Reads a unit price, up to 4 decimals | `"12.50"` is `125000` |
| `parseCents(text)` | Reads an amount, up to 2 decimals | `"40.94"` is `4094` |
| `formatCents(amountCents)` | Shows an amount as written in Mexico | `123456` is `"$1,234.56"` |
| `taxRateOf(factor, rateBp)` | A checked VAT rate: `rate` (even 0%) or `exempt` | `taxRateOf("rate", 1600)` is 16% |
| `lineTotals(unitPriceE4, quantity, taxRate)` | Base, VAT, and total of a line, VAT included | Cable at 16% is `3529` + `565` = `4094` |
| `splitIncludedTax(totalCents, taxRate)` | Splits the VAT out of a rounded amount | `11600` at 16% is `10000` + `1600` |
| `saleTotals(lines)` | Subtotal, VAT, and total of a sale, with the VAT grouped by rate | `checkout` collects its `totalCents` |

Every failure is a `MoneyError` with a `code`, the same one Java uses: `negative_input`, `unknown_unit`, `fractional_piece`, `overflow`, `invalid_format`, `too_many_decimals`, or `invalid_tax_rate`. Only `not_an_integer` is TypeScript's own, because a Java `long` cannot hold decimals.

## Rules
- No value goes above 2^53 − 1, the largest integer JavaScript holds exactly. Java fails at the same limit, so the register and the core never disagree.
- The product inside `lineAmountCents` uses `BigInt`, and it fails above the limit of a Java `long`, as Java does.
- Text is read with ASCII digits and one optional point. Signs, spaces, commas, `$`, and exponents are rejected, so the screen cleans what the cashier types ([ADR 0022](../../docs/adr/0022-libreria-de-dinero.md)).
- Negative values fail until returns decide how they round (E1-15).
- Prices include VAT. Each line rounds its base half up, and its VAT is the rest, so the base plus the VAT is always what the customer pays. The VAT of a sale is the sum of the VAT of its lines, as in CFDI 4.0 ([ADR 0023](../../docs/adr/0023-iva-incluido-por-linea.md)).
- A line keeps the rate it was sold at, so a later change of rate never rewrites an old sale.

## Use it from the register
The package exports its TypeScript source, and electron-vite bundles it into the register ([ADR 0022](../../docs/adr/0022-libreria-de-dinero.md)). The screen and the main process both use it, so it must never import Node or Electron.

```ts
import { formatCents, lineAmountCents, lineTotals, parseQuantity, saleTotals, taxRateOf } from "@pos-saas/money";

formatCents(lineAmountCents(125000, parseQuantity("3.275", "meter"))); // "$40.94"

const cable = lineTotals(125000, parseQuantity("3.275", "meter"), taxRateOf("rate", 1600));
// { subtotalCents: 3529, taxCents: 565, totalCents: 4094, taxRate: { factor: "rate", rateBp: 1600 } }
saleTotals([cable]).totalCents; // 4094, the amount checkout collects
```

## Tests
From the repository root, `pnpm test` runs the shared cases (`*.contract.test.ts`), the checks that only TypeScript needs (`typescript-only.test.ts`), and a check that the VAT of every total up to $1,000 stays within the limits the SAT accepts (`line-totals.test.ts`).
