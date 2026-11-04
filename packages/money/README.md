# Money

Money and quantity logic in TypeScript, using integers only. For now it holds [`lineAmountCents`](src/line-amount.ts), the line amount formula of [ADR 0011](../../docs/adr/0011-precision-monetaria.md), which runs the shared cases of [`packages/contracts`](../contracts/README.md). The rest of the library arrives in a later task of the [roadmap](../../docs/plan/04-roadmap.md), and it replaces the placeholder function that keeps its own small test.

Java can only fail above the limit of a `long`, so `lineAmountCents` fails there too, even though `BigInt` could keep going. Otherwise the two languages would disagree on the same sale.
