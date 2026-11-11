# Core service

Modular monolith built with Java 21, Spring Boot 4.1, and Spring Modulith. For now it holds an application that starts and reports its health, nine modules whose boundaries are checked on every build, the money and quantity library, the PostgreSQL tables managed by Flyway, and the endpoint that receives register batches.

| Path | Contents |
| --- | --- |
| `src/main/java/.../core/CoreApplication.java` | Entry point of the service |
| `src/main/java/.../core/<module>/` | One package per module |
| `src/main/java/.../money/` | `Money`, `UnitPrice`, `Quantity`, `LineAmount`, and the VAT of `LineTotals` and `SaleTotals`, outside the modules ([ADR 0020](../../docs/adr/0020-casos-compartidos.md), [ADR 0022](../../docs/adr/0022-libreria-de-dinero.md), [ADR 0023](../../docs/adr/0023-iva-incluido-por-linea.md)) |
| `src/main/java/.../id/` | `Uuid7`, the UUIDv7 generator ([ADR 0034](../../docs/adr/0034-flyway-y-modelo-base.md)) |
| `src/main/resources/db/migration/` | Flyway migrations: the base model, row-level security, the outbox, the audit log and the records that registers upload |
| `src/main/java/.../security/` | Resource server, `TenantFromTokenFilter` and `GET /me` ([ADR 0039](../../docs/adr/0039-keycloak-oidc-y-tenant-en-el-token.md)) |
| `src/main/java/.../tenant/` | `TenantContext` and the transaction manager that pins the tenant ([ADR 0035](../../docs/adr/0035-rls-rol-de-aplicacion-y-tenant-por-transaccion.md)) |
| `src/main/java/.../ingest/` | `OperationRecorder`, the contract that each module implements to store the operations a register uploads ([ADR 0046](../../docs/adr/0046-recepcion-idempotente-en-el-nucleo.md)) |
| `src/main/java/.../events/` | `BusinessEvent`, the contract of every event sent to Redpanda through the outbox ([ADR 0036](../../docs/adr/0036-outbox-con-modulith-y-redpanda.md)) |
| `src/test/java/.../core/` | Startup test and module structure test |
| `src/test/java/.../money/` | Runs the shared cases of [`packages/contracts`](../../packages/contracts/README.md) |

## Money and quantities
The register does the same calculations in TypeScript ([`packages/money`](../../packages/money/README.md)), and the shared cases keep both equal.

```java
Money cable = LineAmount.of(UnitPrice.parse("12.50"), Quantity.parse("3.275", Unit.METER)); // 4094 cents
Money total = Money.sum(List.of(cable, new Money(107)));                                    // 4201 cents

LineTotals line = LineTotals.of(UnitPrice.parse("12.50"), Quantity.parse("3.275", Unit.METER), TaxRate.of(1600));
// line.subtotal() is 3529 cents, line.tax() is 565, and line.total() is 4094
SaleTotals sale = SaleTotals.of(List.of(line));                     // with one TaxGroup per rate
```

The records check their values when they are created. A failure is a `MoneyException` whose `code()` matches the code of TypeScript, such as `FRACTIONAL_PIECE` for half a screw, or `INVALID_TAX_RATE` for an exempt product with a rate. A `LineTotals` whose base and VAT do not come from its total fails with `IllegalArgumentException`, because only a bug builds one.

## Database and migrations
The core needs PostgreSQL 16. Flyway applies `src/main/resources/db/migration` when the service starts, so an empty database is left up to date with no manual steps. **Never edit a migration that was already applied**: Flyway checks its checksum and refuses to start. Write a new `V<n>__<description>.sql` instead.

Every id is a UUIDv7 (`Uuid7.next()`), and each table rejects any other version with a `CHECK`. Every business table carries `tenant_id`.

### Tenant isolation
Row-level security keeps each business apart ([ADR 0035](../../docs/adr/0035-rls-rol-de-aplicacion-y-tenant-por-transaccion.md)). Every table has `ENABLE` and `FORCE ROW LEVEL SECURITY` and a policy on `current_tenant_id()`. The service connects as `pos_app`, a role without `BYPASSRLS` that owns no table, while Flyway runs as the migration role. `TenantAwareTransactionManager` runs `SET LOCAL app.tenant_id` when each transaction begins, taking the business from `TenantContext`:

```java
TenantContext.runAs(tenantId, () -> transactionTemplate.executeWithoutResult(status -> repository.save(branch)));
```

With no tenant set, queries return no rows. **A new table must enable RLS and add a policy in its migration**, or `RowLevelSecurityCoverageTest` fails in CI. The password of `pos_app` is never in a migration: set it once with `ALTER ROLE pos_app PASSWORD '...'`.

Connection settings come from environment variables; passwords have no default:

| Variable | Default | Used by |
| --- | --- | --- |
| `CORE_DB_URL` | `jdbc:postgresql://localhost:5432/pos_saas` | both |
| `CORE_DB_USER` | `pos_app` | the service |
| `CORE_DB_PASSWORD` | none | the service |
| `CORE_MIGRATION_DB_USER` | `pos_admin` | Flyway |
| `CORE_MIGRATION_DB_PASSWORD` | none | Flyway |

Tests start their own PostgreSQL 16.15 with Testcontainers, so they need Docker running.

## Authentication
The core is an OAuth2 resource server of the Keycloak realm `pos` ([ADR 0039](../../docs/adr/0039-keycloak-oidc-y-tenant-en-el-token.md)). Every request needs `Authorization: Bearer <JWT>` except `GET /actuator/health`. The core checks the signature, expiry, issuer and the audience `pos-core`; a missing or invalid token gets **401**. `TenantFromTokenFilter` then pins the `tenant_id` claim in `TenantContext` for the whole request, so row-level security and the logs receive it; a valid token without a usable `tenant_id` gets **403**. `GET /me` returns the token `subject` and the `tenantId` (ids only, no personal data).

| Variable | Default | Purpose |
| --- | --- | --- |
| `CORE_OIDC_ISSUER_URI` | `http://localhost:8180/realms/pos` | Issuer that tokens must come from |
| `CORE_OIDC_JWK_SET_URI` | issuer + `/protocol/openid-connect/certs` | Where the signing keys are fetched, lazily |

`KeycloakResourceServerTest` starts a real Keycloak with the realm file of the repository and covers 401, 403, a valid token and the isolation between two businesses.

## Events and the outbox
An event that implements `BusinessEvent` and is annotated `@Externalized("topic::#{tenantId()}")` is saved in `event_publication` inside the transaction that publishes it, and sent to Redpanda after the commit ([ADR 0036](../../docs/adr/0036-outbox-con-modulith-y-redpanda.md)). A rollback publishes nothing; if the broker is down, the row waits and `IncompleteEventPublications` resubmits it. Delivery is at least once, so consumers must be idempotent by `eventId`. Externalized types must live in the root package or in a module. The Kafka client uses `spring.kafka.bootstrap-servers` (`localhost:19092` with the compose `core` profile).

## Audit log
`AuditLog.record(AuditEntry)` appends who did what to which entity, with the value before and after, in the transaction of the change ([ADR 0038](../../docs/adr/0038-bitacora-de-auditoria-solo-agregar.md)). It fails without a transaction. The table is append-only: `pos_app` has no `UPDATE`, `DELETE` or `TRUNCATE`, and a trigger rejects them for every role. Store ids and business values only, never PINs, tokens, card data or needless personal data.

## Receiving register batches
`POST /sync/push` receives the batch that a register uploads from its local outbox ([ADR 0046](../../docs/adr/0046-recepcion-idempotente-en-el-nucleo.md), RF-021). The business comes from the token, never from the body: a body with an extra field, including a `tenantId`, is a `400`. Each operation is checked against the shared schema `packages/contracts/schemas/sync-push-request.schema.json` and applied **in its own transaction**, so a batch that fails halfway keeps what was confirmed before.

Idempotency lives in PostgreSQL: `sync_operation` has `UNIQUE (tenant_id, op_id)` and each operation claims its key with `INSERT ... ON CONFLICT DO NOTHING`. The same batch twice, or at the same time from many threads, stores everything once. `device_seq` is kept for information and never used to reject.

| Answer | Meaning |
| --- | --- |
| `200` with `results` | One result per operation handled: `accepted` (stored now), `duplicate` (stored before) or `quarantined` with a `reason` (kept for the owner, never retried). An operation that is not in `results` was not confirmed: send it again |
| `400` | The envelope is malformed (broken JSON, a `registerId` or `opId` that is not a UUIDv7, 0 or more than 100 operations, an unknown field). Nothing was confirmed |
| `503` | The core could not handle even the first operation. Nothing was confirmed |

Records go to the module that owns them through `OperationRecorder` (`pos.ingest`): `sales` (sales, returns), `cash` (sessions, movements, cuts) and `inventory` (adjustments and write-offs). To accept a new type, add a recorder; `sync` never depends on those modules. Cuts and stock adjustments are also written to the audit log in the same transaction. These tables are append-only and carry `tenant_id` with row-level security. A quarantined operation is stored whole in `sync_operation.raw_operation`.

**Price changes** (`product.price_changed`, E1-40, [ADR 0053](../../docs/adr/0053-recepcion-de-cambios-de-precio.md)) go to `catalog`. The change is stored in `product_price_change` (append-only, `tenant_id`, RLS), audited as `product.price_change` (who, when, before, after) and announced as `ProductPriceChanged` through the outbox, all in one transaction. It is idempotent by `op_id` and by `changeId`. The core never rejects a change for what it does not know yet: a product that is not in the core is kept (the catalog applies the latest change of each product when F0-16 creates it), and a previous price that differs from the one the core holds is kept and marked `discrepancy` for the owner to review (RF-022, E1-19).

```bash
curl -X POST http://localhost:8080/sync/push   -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json"   --data @batch.json   # same file twice: the second answer has only "duplicate"
```

## Cash cut reports by e-mail
When a cut is stored, the core publishes `CashCutRecorded` in the same transaction ([ADR 0052](../../docs/adr/0052-reporte-del-corte-por-correo.md), RF-028). An asynchronous listener in `reporting` e-mails the owner a Spanish summary: sales and refunds by payment method, cash taken out or in, expected against counted, and the difference. It holds no customer data. A slow or dead provider never delays `POST /sync/push`.

- **Once per cut.** `cut_report_delivery` has `UNIQUE (tenant_id, cut_id)` and records the state (`pending`, `sending`, `sent`, `failed`, `gave_up`, `rejected`, `skipped`); the call to the provider carries `Idempotency-Key: cut-report-<cutId>`.
- **Bounded retries.** Up to 5 attempts with a wait that doubles from 1 minute; the outbox offers pending events again every 30 seconds and after a restart.
- **Provider.** `EmailSender` is implemented with the [Resend](https://resend.com) HTTPS API (free tier). Without a key the core starts, logs a warning, and each report is `skipped`.
- **Recipient.** `tenant.owner_email`, or `REPORT_DEFAULT_RECIPIENT` until the panel can set it.

| Variable | Default | Purpose |
| --- | --- | --- |
| `RESEND_API_KEY` | none | API key of the e-mail provider; only from the environment |
| `RESEND_FROM` | none | Verified sender, such as `Reportes <reportes@your-domain.com>` |
| `REPORT_DEFAULT_RECIPIENT` | none | Recipient when the business has no `owner_email` |


## Changes for the registers
`GET /sync/pull?cursor=&limit=` gives a register what changed in the catalog, prices and permissions since its cursor ([ADR 0048](../../docs/adr/0048-cambios-hacia-la-caja-con-cursor.md), RF-023). The business comes from the token and row-level security; any parameter other than `cursor` and `limit` is a `400`. It needs the `sync.pull` permission.

Every change is a row of `sync_change`, numbered per business by `seq`. Taking the next number locks the business row in `sync_change_counter` until the transaction ends, so numbers follow the order of the commits and a change still in flight can never end up behind a cursor. A deletion is a tombstone (`deleted: true`, no `payload`); the table is append-only.

| Answer | Meaning |
| --- | --- |
| `200` with `changes`, `nextCursor`, `hasMore` | Up to `limit` changes (1 to 500, default 200) after the cursor, in order. `nextCursor` is what to send next; with nothing new it is the same cursor. The same cursor gives the same changes |
| `400` | A cursor that is not the `nextCursor` of an earlier answer (or `0`), a `limit` out of range, or an unknown parameter |
| `409` `cursor_ahead` | The cursor is beyond the last change of the business, as after a restore from a backup: start again from `0` |

Modules publish changes through `ChangePublisher` (`pos.feed`), inside the same transaction that changes their data: `publish(type, id, state)` or `publishDeletion(type, id)`. Types today: `product` (with its price and barcodes) and `staff_member`. The products module (F0-16) must call it.

```bash
curl "http://localhost:8080/sync/pull?cursor=0&limit=100" -H "Authorization: Bearer $TOKEN"
## Average cost (inventory)
The weighted moving average cost of a product is computed only in the core ([ADR 0049](../../docs/adr/0049-costo-promedio-en-el-servidor.md), RF-033). It is never stored: `InventoryValuation` replays the ledger of the product (entries in `stock_receipt`, sales, returns, adjustments and write-offs) in the order the events *happened*, so a late sale or a late entry lands where it belongs and recalculating always gives the same result. Costs are integers in millionths of a peso (`unit_cost_e6`, [ADR 0011](../../docs/adr/0011-precision-monetaria.md)), rounded half up. Sales and adjustments do not move the average, a return comes back at the cost of its sale, and stock at or below zero is worth zero.

```java
valuation.recordReceipt(new StockReceipt(opId, productId, Source.PURCHASE, 10_000, 10_000_000, arrivedAt, userId)); // 10 units at $10.00
ProductCost cost = valuation.costOf(productId);   // quantityMilli, averageCostE6, valueCents()
InventoryValue all = valuation.inventoryValue();   // total in cents and products without a known cost
```

## Invoicing (Facturapi)
Other modules depend on the `FiscalInvoicing` interface (`invoicing` root package) and never on the client, so tests use a fake ([ADR 0041](../../docs/adr/0041-cliente-de-facturapi.md)). It creates receivers, stamps invoices (including the `global` object and credit notes), reads and cancels them, and downloads PDF and XML. Amounts use the scales of ADR 0011.

Failures are `FacturapiRejectedException` (4xx, do not repeat), `FacturapiUnavailableException` (5xx, 429, timeout; outcome unknown for writes) and `FacturapiNotConfiguredException` (no key). Only reads are retried; a stamp or cancellation is sent once, so look the invoice up before repeating a doubtful one. Messages and logs never carry the key, bodies or fiscal data; `providerMessage()` may, so show it but do not log it.

| Variable | Default | Purpose |
| --- | --- | --- |
| `FACTURAPI_API_KEY` | empty (calls fail without touching the network) | Secret key of the account; use the test key outside production |

Timeouts and retries are the `facturapi.connect-timeout` (3s), `facturapi.read-timeout` (20s), `facturapi.max-retries` (2) and `facturapi.retry-backoff` (300ms) properties. Tests run against a fake server and need no key.

### Individual invoice (`POST /invoices`)
Invoices a sale the core already received ([ADR 0050](../../docs/adr/0050-factura-individual.md), RF-035). It needs the `invoice.issue` permission (owner and manager).

```json
{ "saleId": "<uuid>", "receiver": { "legalName": "ACME FERRETERIA", "taxId": "ABC010203AB1", "taxRegime": "601", "cfdiUse": "G03", "zipCode": "64000" },
  "paymentForm": "03", "satProductKeys": { "<saleLineId>": "27112700" } }
```
`paymentForm` and `satProductKeys` are optional: the payment form comes from the sale and the SAT product key from `invoicing.default-sat-product-key` until the catalog carries it. Answers: `201` stamped invoice (`fiscalUuid`, `providerInvoiceId`, `totalCents`), `404` unknown sale, `409` already invoiced or being invoiced, `422` invalid fiscal data (field and rule, never the value) or refused by the provider, `503` no API key or no answer from the provider. Sending the same request again is always safe: a doubtful stamping is looked up at the provider (`external_id`) before it is repeated, and the `invoice` table allows one invoice per sale. Only the receiver's RFC is stored; the PDF and XML are downloaded from the provider with `providerInvoiceId`.

## Observability
The core sends traces, metrics and logs over OTLP to the collector of the `observability` profile and errors to Sentry ([ADR 0037](../../docs/adr/0037-observabilidad-del-nucleo.md)). Every log line shows `[service,traceId,spanId,tenant_id]`; spans carry `tenant.id`, and no metric uses it as a label. Never log names, phones, emails, PINs, tokens or card data, only ids.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP/HTTP address of the collector |
| `CORE_TRACING_SAMPLING` | `1.0` | Share of requests that are traced |
| `SENTRY_DSN` | empty (Sentry off) | Where errors are sent |
| `CORE_ENVIRONMENT` | `local` | Environment tag in Sentry |

## Modules
| Module | Responsibility |
| --- | --- |
| `identity` | Businesses, registers, users, and PINs |
| `catalog` | Products, prices, and SAT codes |
| `sales` | Sales and returns |
| `payments` | Manually entered card payments and the integrated terminal |
| `cash` | Register sessions and cash closings |
| `inventory` | The inventory movement ledger and the average cost |
| `invoicing` | CFDI invoices through Facturapi |
| `sync` | Register batches, cursors, and discrepancies |
| `reporting` | Reports and the audit log |

## Module boundaries
The root package of a module is its public API, and its subpackages are internal. If `sales` uses `inventory.internal.StockLedger`, `ApplicationModules.verify()` fails with `Module 'sales' depends on non-exposed type`, and the `Java` job in CI turns red. [ADR 0001](../../docs/adr/0001-monolito-modular.md) explains why the core is a modular monolith.

## Commands
Run these from this folder (in PowerShell or CMD, use `mvnw.cmd`). From anywhere else, the Spring Modulith annotation processor writes its output to a `build/` folder in the current directory.

Compile and run the tests:

```bash
./mvnw verify
```

Start the service on port 8080:

```bash
./mvnw spring-boot:run
```

Check that it is running:

```bash
curl http://localhost:8080/actuator/health
```
