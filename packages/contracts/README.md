# Contracts

JSON schemas and calculation cases shared by the TypeScript register and the Java core. The register has to calculate without internet, so the same rule exists in two languages ([ADR 0009](../../docs/adr/0009-logica-local-typescript.md)). These cases keep both equal: if one language calculates differently, CI turns red. OpenAPI files will join them with the first endpoint.

| Path | Contents |
| --- | --- |
| `schemas/values.schema.json` | Integer scales from [ADR 0011](../../docs/adr/0011-precision-monetaria.md), and the base units |
| `schemas/*-cases.schema.json` | The shape of each file of cases |
| `cases/line-amount.json` | Line amounts: `amounts` must produce a result, and `rejections` must fail |
| `cases/text-input.json` | Numbers typed as text: `values` must be read, and `rejections` must fail |
| `cases/amount-sum.json` | Totals of a sale: `sums` must add up, and `rejections` must fail |
| `cases/line-tax.json` | Lines with VAT included at 16%, 8%, 0%, and exempt: `lines` must split into base and VAT, and `rejections` must fail |
| `cases/sale-totals.json` | Sales with their VAT grouped by rate: `sales` must add up, and `rejections` must fail |
| `schemas/sync-push-request.schema.json` | The batch the register uploads to `POST /sync/push` and the shape of each of its nine kinds of operation, the last three being `product.price_changed`, `product.created` and `product.updated` ([ADR 0040](../../docs/adr/0040-envio-desde-la-caja-con-outbox.md), [ADR 0047](../../docs/adr/0047-editar-precio-de-un-producto-en-la-caja.md), [ADR 0057](../../docs/adr/0057-alta-de-productos-en-la-caja.md), [ADR 0058](../../docs/adr/0058-panel-de-modificacion-de-productos.md)). `stock.adjusted` carries an optional `authorizedBy` when a cashier asked with the PIN of an owner |
| `schemas/sync-push-response.schema.json` | The answer of the core: one result per operation, `accepted`, `duplicate`, or `quarantined` |
| `cases/sync-push.json` | Batches and answers: `requests` and `responses` must pass the schema, and `request_rejections` and `response_rejections` must fail, each naming the schema keyword that rejects it |
| `schemas/sync-pull-query.schema.json` | The query of `GET /sync/pull`: an opaque `cursor` and a `limit` from 1 to 500 ([ADR 0048](../../docs/adr/0048-cambios-hacia-la-caja-con-cursor.md)) |
| `schemas/sync-pull-response.schema.json` | A page of changes to the register: `product` (with its price and barcodes), `staff_member` and `review_resolution` (the decision of the owner about a quarantined operation or a price discrepancy, E1-19), each the whole state of the entity, or a tombstone with no payload when it was deleted |
| `cases/sync-pull.json` | Queries and pages: `queries` and `responses` must pass, and `query_rejections` and `response_rejections` must fail, each naming the schema keyword that rejects it. Vitest checks them against the schemas and the register's reader; the core runs the same queries and validates its answers with the same schema |
| `src/cases.test.ts` | Checks that the cases follow their schema, and that the schema rejects bad ones |

Each rejection names the error it expects. Both languages use the same codes: `negative_input`, `fractional_piece`, `overflow`, `invalid_format`, `too_many_decimals`, and `invalid_tax_rate` ([ADR 0022](../../docs/adr/0022-libreria-de-dinero.md), [ADR 0023](../../docs/adr/0023-iva-incluido-por-linea.md)).

## Who runs the cases
| Cases | TypeScript ([`packages/money`](../money/README.md)) | Java ([`pos.money`](../../services/core/src/main/java/io/github/mauriciotorrez1/pos/money/)) |
| --- | --- | --- |
| Line amount | [`line-amount.contract.test.ts`](../money/src/line-amount.contract.test.ts) | [`LineAmountContractTest`](../../services/core/src/test/java/io/github/mauriciotorrez1/pos/money/LineAmountContractTest.java) |
| Text input | [`text-input.contract.test.ts`](../money/src/text-input.contract.test.ts) | [`TextInputContractTest`](../../services/core/src/test/java/io/github/mauriciotorrez1/pos/money/TextInputContractTest.java) |
| Amount sum | [`amount-sum.contract.test.ts`](../money/src/amount-sum.contract.test.ts) | [`AmountSumContractTest`](../../services/core/src/test/java/io/github/mauriciotorrez1/pos/money/AmountSumContractTest.java) |
| Line tax | [`line-tax.contract.test.ts`](../money/src/line-tax.contract.test.ts) | [`LineTaxContractTest`](../../services/core/src/test/java/io/github/mauriciotorrez1/pos/money/LineTaxContractTest.java) |
| Sale totals | [`sale-totals.contract.test.ts`](../money/src/sale-totals.contract.test.ts) | [`SaleTotalsContractTest`](../../services/core/src/test/java/io/github/mauriciotorrez1/pos/money/SaleTotalsContractTest.java) |

Only TypeScript validates against the schema, because the `TypeScript` job runs on every pull request. Java reads the same file with a strict parser, so a case with decimals or a misspelled field also fails there.

## Add a case
The files name their schema, so editors such as VS Code autocomplete and check them as you type.

### A line amount
Add an entry to `amounts` in `cases/line-amount.json`.

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

A quantity in pieces must be whole: `quantity_milli` is a multiple of 1000.

### A typed number
Add an entry to `values` in `cases/text-input.json`.

```json
{ "name": "Say what this case protects", "text": "3.275", "reads_as": "meter", "expected_value": 3275 }
```

`reads_as` is `amount_cents` (2 decimals), `unit_price_e4` (4 decimals), or a unit, which reads a quantity with 3 decimals.

### A line with VAT
Add an entry to `lines` in `cases/line-tax.json`. It has the fields of a line amount, plus the rate and the three results.

```json
{
  "name": "Say what this case protects",
  "unit_price_e4": 1160000,
  "quantity_milli": 1000,
  "unit": "piece",
  "tax_factor": "rate",
  "tax_rate_bp": 1600,
  "expected_subtotal_cents": 10000,
  "expected_tax_cents": 1600,
  "expected_total_cents": 11600
}
```

| Field | How to write it | Example |
| --- | --- | --- |
| `tax_factor` | `rate` for 16%, 8%, or 0%, and `exempt` for an exempt product | `rate` |
| `tax_rate_bp` | The rate times 100. Exempt is always `0` | 16% is `1600` |
| `expected_total_cents` | The line amount, as in `line-amount.json` | `11600` |
| `expected_subtotal_cents` | `total × 10000 / (10000 + tax_rate_bp)`, rounding half up. Exempt: the total | `10000` |
| `expected_tax_cents` | The total minus the subtotal | `1600` |

### Run them
TypeScript, from the repository root:

```bash
pnpm test
```

Java, from `services/core` (in PowerShell or CMD, use `mvnw.cmd`):

```bash
./mvnw test -Dtest='*ContractTest'
```

## Versioning
The version is in `package.json`. Today both languages live in the same commit, so CI catches any mismatch. The version starts to matter when a register that has not updated talks to a newer server.

| Change | Compatible? | Version |
| --- | --- | --- |
| Add a case, or an optional field | Yes, old readers keep working | Minor |
| Fix a typo in a description | Yes | Patch |
| Change an expected result, or the meaning of a field | No, it changes what a sale costs | Major, with a new ADR |
| Rename or remove a field, make one required, or add a unit that old readers reject | No, old readers fail | Major |
