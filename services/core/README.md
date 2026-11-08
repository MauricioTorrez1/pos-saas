# Core service

Modular monolith built with Java 21, Spring Boot 4.1, and Spring Modulith. For now it holds an application that starts and reports its health, nine empty modules whose boundaries are checked on every build, and the money and quantity library.

| Path | Contents |
| --- | --- |
| `src/main/java/.../core/CoreApplication.java` | Entry point of the service |
| `src/main/java/.../core/<module>/` | One package per module |
| `src/main/java/.../money/` | `Money`, `UnitPrice`, `Quantity`, and `LineAmount`, outside the modules ([ADR 0020](../../docs/adr/0020-casos-compartidos.md), [ADR 0022](../../docs/adr/0022-libreria-de-dinero.md)) |
| `src/test/java/.../core/` | Startup test and module structure test |
| `src/test/java/.../money/` | Runs the shared cases of [`packages/contracts`](../../packages/contracts/README.md) |

## Money and quantities
The register does the same calculations in TypeScript ([`packages/money`](../../packages/money/README.md)), and the shared cases keep both equal.

```java
Money cable = LineAmount.of(UnitPrice.parse("12.50"), Quantity.parse("3.275", Unit.METER)); // 4094 cents
Money total = Money.sum(List.of(cable, new Money(107)));                                    // 4201 cents
```

The records check their values when they are created. A failure is a `MoneyException` whose `code()` matches the code of TypeScript, such as `FRACTIONAL_PIECE` for half a screw.

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
