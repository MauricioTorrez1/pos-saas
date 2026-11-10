# Core service

Modular monolith built with Java 21, Spring Boot 4.1, and Spring Modulith. For now it holds an application that starts and reports its health, nine empty modules whose boundaries are checked on every build, the money and quantity library, and the first PostgreSQL tables managed by Flyway.

| Path | Contents |
| --- | --- |
| `src/main/java/.../core/CoreApplication.java` | Entry point of the service |
| `src/main/java/.../core/<module>/` | One package per module |
| `src/main/java/.../money/` | `Money`, `UnitPrice`, `Quantity`, `LineAmount`, and the VAT of `LineTotals` and `SaleTotals`, outside the modules ([ADR 0020](../../docs/adr/0020-casos-compartidos.md), [ADR 0022](../../docs/adr/0022-libreria-de-dinero.md), [ADR 0023](../../docs/adr/0023-iva-incluido-por-linea.md)) |
| `src/main/java/.../id/` | `Uuid7`, the UUIDv7 generator ([ADR 0034](../../docs/adr/0034-flyway-y-modelo-base.md)) |
| `src/main/resources/db/migration/` | Flyway migrations: `tenant`, `branch`, `register` and `app_user` |
| `src/main/java/.../tenant/` | `TenantContext` and the transaction manager that pins the tenant ([ADR 0035](../../docs/adr/0035-rls-rol-de-aplicacion-y-tenant-por-transaccion.md)) |
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

## Events and the outbox
An event that implements `BusinessEvent` and is annotated `@Externalized("topic::#{tenantId()}")` is saved in `event_publication` inside the transaction that publishes it, and sent to Redpanda after the commit ([ADR 0036](../../docs/adr/0036-outbox-con-modulith-y-redpanda.md)). A rollback publishes nothing; if the broker is down, the row waits and `IncompleteEventPublications` resubmits it. Delivery is at least once, so consumers must be idempotent by `eventId`. Externalized types must live in the root package or in a module. The Kafka client uses `spring.kafka.bootstrap-servers` (`localhost:19092` with the compose `core` profile).

## Audit log
`AuditLog.record(AuditEntry)` appends who did what to which entity, with the value before and after, in the transaction of the change ([ADR 0038](../../docs/adr/0038-bitacora-de-auditoria-solo-agregar.md)). It fails without a transaction. The table is append-only: `pos_app` has no `UPDATE`, `DELETE` or `TRUNCATE`, and a trigger rejects them for every role. Store ids and business values only, never PINs, tokens, card data or needless personal data.

## Invoicing (Facturapi)
Other modules depend on the `FiscalInvoicing` interface (`invoicing` root package) and never on the client, so tests use a fake ([ADR 0041](../../docs/adr/0041-cliente-de-facturapi.md)). It creates receivers, stamps invoices (including the `global` object and credit notes), reads and cancels them, and downloads PDF and XML. Amounts use the scales of ADR 0011.

Failures are `FacturapiRejectedException` (4xx, do not repeat), `FacturapiUnavailableException` (5xx, 429, timeout; outcome unknown for writes) and `FacturapiNotConfiguredException` (no key). Only reads are retried; a stamp or cancellation is sent once, so look the invoice up before repeating a doubtful one. Messages and logs never carry the key, bodies or fiscal data; `providerMessage()` may, so show it but do not log it.

| Variable | Default | Purpose |
| --- | --- | --- |
| `FACTURAPI_API_KEY` | empty (calls fail without touching the network) | Secret key of the account; use the test key outside production |

Timeouts and retries are the `facturapi.connect-timeout` (3s), `facturapi.read-timeout` (20s), `facturapi.max-retries` (2) and `facturapi.retry-backoff` (300ms) properties. Tests run against a fake server and need no key.

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
| `inventory` | The inventory movement ledger |
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
