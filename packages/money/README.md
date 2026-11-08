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

Every failure is a `MoneyError` with a `code`, the same one Java uses: `negative_input`, `unknown_unit`, `fractional_piece`, `overflow`, `invalid_format`, or `too_many_decimals`. Only `not_an_integer` is TypeScript's own, because a Java `long` cannot hold decimals.

## Rules
- No value goes above 2^53 − 1, the largest integer JavaScript holds exactly. Java fails at the same limit, so the register and the core never disagree.
- The product inside `lineAmountCents` uses `BigInt`, and it fails above the limit of a Java `long`, as Java does.
- Text is read with ASCII digits and one optional point. Signs, spaces, commas, `$`, and exponents are rejected, so the screen cleans what the cashier types ([ADR 0022](../../docs/adr/0022-libreria-de-dinero.md)).
- Negative values fail until returns decide how they round (E1-15).

## Use it from the register
The package exports its TypeScript source, and electron-vite bundles it into the register ([ADR 0022](../../docs/adr/0022-libreria-de-dinero.md)). The screen and the main process both use it, so it must never import Node or Electron.

```ts
import { formatCents, lineAmountCents, parseQuantity } from "@pos-saas/money";

formatCents(lineAmountCents(125000, parseQuantity("3.275", "meter"))); // "$40.94"
```

## Tests
From the repository root, `pnpm test` runs the shared cases (`*.contract.test.ts`) and the checks that only TypeScript needs (`typescript-only.test.ts`).
