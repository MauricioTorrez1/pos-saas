# POS SaaS

Offline-first point of sale for small retail. It starts with a family hardware store in Mexico and is designed to grow into a multi-tenant SaaS.

**Status:** early development. The plan is complete and the repository is being set up, so there is no usable release yet.

[English](#english) · [Español](#español)

## English

### The problem
A hardware store sells by the piece, the meter, and the kilo. One customer can ask for loose nails, cut cable, and a tax invoice in the same sale, and the register has to keep selling when the internet goes down. Generic systems rarely handle all of that well.

### Planned features
| Stage | Scope |
| --- | --- |
| Foundation | Monorepo, CI, local stack, tenant isolation, catalog, and admin panel |
| Release 1 | Offline cash sales, keyed card payments, receipts, cash drawer, stock ledger, daily cash count, and CFDI invoices |
| Release 2 | Integrated Mercado Pago card terminal |
| Next phases | Full store operations, online store, self-service SaaS, analytics, and AI |

### Engineering rules
- **Money** is stored as integers, never as `float` or `double`.
- **Quantities** have three decimals and an explicit unit, such as 3.275 m of cable.
- **Stock** is an immutable ledger of movements. The current level is calculated.
- **Networked operations** carry a UUIDv7 and an idempotency key, so a retry cannot duplicate a sale.
- **Tenants** are isolated with PostgreSQL Row-Level Security.
- **Card data** never enters the system. Only the payment result does.

### Stack
| Area | Technology |
| --- | --- |
| Core | Java 21, Spring Boot 4.1, Spring Modulith, PostgreSQL 16, Flyway |
| Register | Electron, React, TypeScript, SQLite |
| Web | Next.js, React, TypeScript |
| Analytics and AI | Python 3.12, FastAPI, Polars, dbt, DuckDB, Claude API |
| Platform | Docker Compose, Keycloak, Redis, Redpanda, n8n |
| Operations | GitHub Actions, Terraform, OpenTelemetry, Prometheus, Loki, Tempo, Grafana, Sentry |

### Getting started
You need Node.js 24 or later, and Git. The applications are added in upcoming tasks.

```bash
npm install -g pnpm@12.16.1
```

```bash
pnpm install
```

```bash
cp .env.example .env
```

```bash
pnpm check:repo
```

### Repository layout
| Path | Contents |
| --- | --- |
| `apps/` | Register and web apps |
| `services/` | Java core and Python analytics |
| `packages/` | Shared contracts, money logic, and UI |
| `infra/` | Compose, Terraform, Keycloak, and Grafana |
| `scripts/` | Repository checks |
| `docs/` | Specification, architecture decisions, and plan (in Spanish) |

### Documentation
- [Specification](docs/especificacion.md)
- [Architecture](docs/plan/03-arquitectura.md)
- [Architecture decision records](docs/adr/README.md)
- [Roadmap](docs/plan/04-roadmap.md)

### License
[GNU AGPL-3.0](LICENSE).

## Español

### El problema
Una tlapalería vende por pieza, por metro y por kilo. Un mismo cliente puede pedir clavo a granel, cable cortado y factura en una sola venta, y la caja debe seguir vendiendo cuando se cae el internet. Los sistemas genéricos rara vez resuelven bien todo eso.

### Funciones planeadas
| Etapa | Alcance |
| --- | --- |
| Base | Monorepo, CI, stack local, aislamiento por negocio, catálogo y panel |
| Entrega 1 | Venta en efectivo sin internet, tarjeta tecleada, ticket, cajón, libro de inventario, corte diario y factura CFDI |
| Entrega 2 | Terminal de Mercado Pago integrada |
| Siguientes fases | Operación completa, tienda en línea, SaaS en autoservicio, analítica e IA |

### Reglas de ingeniería
- **El dinero** se guarda en enteros, nunca en `float` ni `double`.
- **Las cantidades** llevan tres decimales y unidad explícita, como 3.275 m de cable.
- **El inventario** es un libro inmutable de movimientos. La existencia se calcula.
- **Las operaciones por red** llevan UUIDv7 y llave de idempotencia, para que un reintento no duplique una venta.
- **Los negocios** se aíslan con Row-Level Security de PostgreSQL.
- **Los datos de tarjeta** nunca entran al sistema, solo el resultado del pago.

### Stack
| Área | Tecnología |
| --- | --- |
| Núcleo | Java 21, Spring Boot 4.1, Spring Modulith, PostgreSQL 16, Flyway |
| Caja | Electron, React, TypeScript, SQLite |
| Web | Next.js, React, TypeScript |
| Analítica e IA | Python 3.12, FastAPI, Polars, dbt, DuckDB, API de Claude |
| Plataforma | Docker Compose, Keycloak, Redis, Redpanda, n8n |
| Operación | GitHub Actions, Terraform, OpenTelemetry, Prometheus, Loki, Tempo, Grafana, Sentry |

### Cómo empezar
Necesitas Node.js 24 o posterior, y Git. Las aplicaciones se agregan en las siguientes tareas.

```bash
npm install -g pnpm@12.16.1
```

```bash
pnpm install
```

```bash
cp .env.example .env
```

```bash
pnpm check:repo
```

### Estructura del repositorio
| Ruta | Contenido |
| --- | --- |
| `apps/` | Caja y aplicación web |
| `services/` | Núcleo en Java y analítica en Python |
| `packages/` | Contratos, lógica de dinero e interfaz compartidos |
| `infra/` | Compose, Terraform, Keycloak y Grafana |
| `scripts/` | Revisiones del repositorio |
| `docs/` | Especificación, decisiones de arquitectura y plan |

### Documentación
- [Especificación](docs/especificacion.md)
- [Arquitectura](docs/plan/03-arquitectura.md)
- [Decisiones de arquitectura](docs/adr/README.md)
- [Roadmap](docs/plan/04-roadmap.md)

### Licencia
[GNU AGPL-3.0](LICENSE).
