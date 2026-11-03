# POS SaaS

[![CI](https://github.com/MauricioTorrez1/pos-saas/actions/workflows/ci.yml/badge.svg)](https://github.com/MauricioTorrez1/pos-saas/actions/workflows/ci.yml)
[![Security](https://github.com/MauricioTorrez1/pos-saas/actions/workflows/security.yml/badge.svg)](https://github.com/MauricioTorrez1/pos-saas/actions/workflows/security.yml)

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
| Core | Java 21, Maven, Spring Boot 4.1, Spring Modulith, PostgreSQL 16, Flyway |
| Register | Electron, React, TypeScript, SQLite |
| Web | Next.js, React, TypeScript |
| Analytics and AI | Python 3.12, uv, FastAPI, Polars, dbt, DuckDB, Claude API |
| Platform | Docker Compose, Keycloak, Redis, Redpanda, n8n |
| Operations | GitHub Actions, Terraform, OpenTelemetry, Prometheus, Loki, Tempo, Grafana, Sentry |

### Getting started
You need Git, Node.js 24 or later, JDK 21, [uv](https://docs.astral.sh/uv/), and [Docker](https://docs.docker.com/get-started/get-docker/) with Compose. The applications are added in upcoming tasks. On Windows, run the `bash` commands in Git Bash.

```bash
npm install -g pnpm@12.16.1
```

```bash
pnpm install
```

```bash
bash scripts/create-dev-env.sh
```

```bash
pnpm check:repo
```

### Local stack
The `core` profile runs PostgreSQL 16, Keycloak, Redis, and Redpanda. This command starts it in the background and fails unless every service is healthy within two minutes. The first run also downloads the images, about 560 MiB, and that time does not count:

```bash
bash scripts/wait-for-profile.sh core
```

Stop it and keep the data:

```bash
docker compose --profile core down
```

The `observability` profile runs the OpenTelemetry Collector, Prometheus, Loki, Tempo, and Grafana. Start it only when you need it, with or without `core`. Its first run downloads about 720 MiB. If you already have a `.env`, run `bash scripts/create-dev-env.sh` first, which adds the new variables and keeps your values:

```bash
bash scripts/wait-for-profile.sh observability
```

This command fills the [Grafana dashboard](http://localhost:3001/d/pos-overview) with about two minutes of simulated sales. The Grafana user and password are in your `.env`:

```bash
bash scripts/send-test-telemetry.sh
```

The `automation` profile runs n8n on its own, without `core`. Its first run downloads about 300 MiB:

```bash
bash scripts/wait-for-profile.sh automation
```

The `analytics` profile runs a minimal FastAPI service, also on its own. Its first run builds two images:

```bash
bash scripts/wait-for-profile.sh analytics
```

dbt with DuckDB does not start with that profile, because it runs on demand and then exits. This command loads the sample sales, creates the models, and runs their tests:

```bash
docker compose run --rm dbt build
```

This one shows the result of a model:

```bash
docker compose run --rm dbt show --select daily_sales
```

[`infra/compose`](infra/compose/README.md) lists the addresses and how to start over with empty data.

### Running the tests
TypeScript, from the repository root:

```bash
pnpm typecheck
```

```bash
pnpm test
```

Java, from `services/core` (in PowerShell or CMD, use `mvnw.cmd`):

```bash
./mvnw verify
```

Python, from `services/analytics`:

```bash
uv run pytest
```

dbt, from the repository root:

```bash
docker compose run --rm dbt build
```

### Continuous integration
Every pull request and every push to `main` runs [three jobs](.github/workflows/ci.yml), one each for Java, TypeScript, and Python. Each job compiles and tests its project, and a single failing test turns it red. Until their real code arrives, `services/core` and `packages/money` each hold a small placeholder with one test. A fourth job, `Compose core`, starts the local stack and fails unless every service is healthy within two minutes. A fifth job, `Compose observability`, does the same with its profile, sends test telemetry, and fails unless Grafana can read the trace, the metrics, and the log. A sixth job, `Compose automation`, does the same with n8n. A seventh job, `Compose analytics`, does the same with the API, and also runs the dbt models and their tests.

### Security checks
GitHub secret scanning and push protection stop known secret formats at `git push`. The [security workflow](.github/workflows/security.yml) adds two jobs on every pull request, on every push to `main`, and once a week:

| Job | Tool | What it reads | When it finds something |
| --- | --- | --- | --- |
| `Secret scan` | [Gitleaks](https://github.com/gitleaks/gitleaks) | Every commit of the change, with the default rules plus [card number rules](.gitleaks.toml) | Fails, and `main` rejects the merge |
| `Dependency scan` | [OSV-Scanner](https://google.github.io/osv-scanner/) | `pom.xml`, `pnpm-lock.yaml`, and `uv.lock` | Warns on a pull request. Fails on `main` and on the weekly run, so GitHub notifies the owner |

[Dependabot](.github/dependabot.yml) opens weekly update pull requests for Maven, pnpm, uv, GitHub Actions, the Compose images, and the analytics Dockerfile. Its alerts appear in the **Security** tab, next to the secret scanning alerts. They do not cover the two-document lockfile of pnpm 12 and can miss transitive Maven dependencies, which is why OSV-Scanner runs too. [ADR 0015](docs/adr/0015-escaneo-de-seguridad.md) explains the choice.

`main` only accepts pull requests, and `Java`, `TypeScript`, `Python`, `Compose core`, `Compose observability`, `Compose automation`, `Compose analytics`, `Sensitive files stay out of Git`, and `Secret scan` must pass before a merge.

**If a secret leaks:** revoke it first, because deleting the commit does not help once it has been pushed. Then check the provider's logs for unauthorized use, issue a new secret, and remove the old one from the code.

**If the scan raises a false alarm:** add the fingerprint shown in the log to `.gitleaksignore`.

### Repository layout
| Path | Contents |
| --- | --- |
| `apps/` | Register and web apps |
| `services/` | Java core and Python analytics |
| `packages/` | Shared contracts, money logic, and UI |
| `infra/` | Compose, Terraform, Keycloak, and Grafana |
| `scripts/` | Repository checks and local stack setup |
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
| Núcleo | Java 21, Maven, Spring Boot 4.1, Spring Modulith, PostgreSQL 16, Flyway |
| Caja | Electron, React, TypeScript, SQLite |
| Web | Next.js, React, TypeScript |
| Analítica e IA | Python 3.12, uv, FastAPI, Polars, dbt, DuckDB, API de Claude |
| Plataforma | Docker Compose, Keycloak, Redis, Redpanda, n8n |
| Operación | GitHub Actions, Terraform, OpenTelemetry, Prometheus, Loki, Tempo, Grafana, Sentry |

### Cómo empezar
Necesitas Git, Node.js 24 o posterior, JDK 21, [uv](https://docs.astral.sh/uv/) y [Docker](https://docs.docker.com/get-started/get-docker/) con Compose. Las aplicaciones se agregan en las siguientes tareas. En Windows, corre los comandos `bash` en Git Bash.

```bash
npm install -g pnpm@12.16.1
```

```bash
pnpm install
```

```bash
bash scripts/create-dev-env.sh
```

```bash
pnpm check:repo
```

### Stack local
El perfil `core` corre PostgreSQL 16, Keycloak, Redis y Redpanda. Este comando lo arranca en segundo plano y falla si algún servicio no está sano en dos minutos. La primera vez también descarga las imágenes, unos 560 MiB, y ese tiempo no cuenta:

```bash
bash scripts/wait-for-profile.sh core
```

Para detenerlo sin perder los datos:

```bash
docker compose --profile core down
```

El perfil `observability` corre el colector de OpenTelemetry, Prometheus, Loki, Tempo y Grafana. Arráncalo solo cuando lo necesites, con `core` o sin él. La primera vez descarga unos 720 MiB. Si ya tienes un `.env`, corre primero `bash scripts/create-dev-env.sh`, que agrega las variables nuevas y conserva tus valores:

```bash
bash scripts/wait-for-profile.sh observability
```

Este comando llena el [tablero de Grafana](http://localhost:3001/d/pos-overview) con unos dos minutos de ventas simuladas. El usuario y la contraseña de Grafana están en tu `.env`:

```bash
bash scripts/send-test-telemetry.sh
```

El perfil `automation` corre n8n por su cuenta, sin `core`. La primera vez descarga unos 300 MiB:

```bash
bash scripts/wait-for-profile.sh automation
```

El perfil `analytics` corre un servicio mínimo de FastAPI, también por su cuenta. La primera vez construye dos imágenes:

```bash
bash scripts/wait-for-profile.sh analytics
```

dbt con DuckDB no arranca con ese perfil, porque corre bajo pedido y termina. Este comando carga las ventas de ejemplo, crea los modelos y corre sus pruebas:

```bash
docker compose run --rm dbt build
```

Este otro muestra el resultado de un modelo:

```bash
docker compose run --rm dbt show --select daily_sales
```

[`infra/compose`](infra/compose/README.md) indica las direcciones y cómo empezar de nuevo con datos vacíos.

### Cómo correr las pruebas
TypeScript, desde la raíz del repositorio:

```bash
pnpm typecheck
```

```bash
pnpm test
```

Java, desde `services/core` (en PowerShell o CMD, usa `mvnw.cmd`):

```bash
./mvnw verify
```

Python, desde `services/analytics`:

```bash
uv run pytest
```

dbt, desde la raíz del repositorio:

```bash
docker compose run --rm dbt build
```

### Integración continua
Cada pull request y cada push a `main` corren [tres trabajos](.github/workflows/ci.yml), uno para Java, otro para TypeScript y otro para Python. Cada trabajo compila y prueba su proyecto, y una sola prueba rota lo pone en rojo. Mientras llega su código real, `services/core` y `packages/money` tienen un relleno pequeño con una prueba. Un cuarto trabajo, `Compose core`, arranca el stack local y falla si algún servicio no está sano en dos minutos. Un quinto trabajo, `Compose observability`, hace lo mismo con su perfil, envía telemetría de prueba y falla si Grafana no puede leer la traza, las métricas y el log. Un sexto trabajo, `Compose automation`, hace lo mismo con n8n. Un séptimo trabajo, `Compose analytics`, hace lo mismo con la API, y además corre los modelos de dbt y sus pruebas.

### Revisiones de seguridad
El escaneo de secretos y la protección al subir de GitHub detienen en el `git push` los secretos con formato conocido. El [workflow de seguridad](.github/workflows/security.yml) agrega dos trabajos en cada pull request, en cada push a `main` y una vez por semana:

| Trabajo | Herramienta | Qué lee | Cuando encuentra algo |
| --- | --- | --- | --- |
| `Secret scan` | [Gitleaks](https://github.com/gitleaks/gitleaks) | Cada commit del cambio, con las reglas predeterminadas y las [reglas de números de tarjeta](.gitleaks.toml) | Falla, y `main` rechaza la fusión |
| `Dependency scan` | [OSV-Scanner](https://google.github.io/osv-scanner/) | `pom.xml`, `pnpm-lock.yaml` y `uv.lock` | Avisa en un pull request. Falla en `main` y en la corrida semanal, para que GitHub notifique al dueño |

[Dependabot](.github/dependabot.yml) abre cada semana pull requests de actualización para Maven, pnpm, uv, GitHub Actions, las imágenes de Compose y el Dockerfile de analítica. Sus alertas aparecen en la pestaña **Security**, junto a las del escaneo de secretos. No cubren el lockfile de dos documentos de pnpm 12 y pueden omitir dependencias transitivas de Maven, por eso también corre OSV-Scanner. El [ADR 0015](docs/adr/0015-escaneo-de-seguridad.md) explica la decisión.

`main` solo acepta pull requests, y `Java`, `TypeScript`, `Python`, `Compose core`, `Compose observability`, `Compose automation`, `Compose analytics`, `Sensitive files stay out of Git` y `Secret scan` deben pasar antes de fusionar.

**Si se filtra un secreto:** primero revócalo, porque borrar el commit no sirve una vez que se subió. Después revisa en los registros del proveedor si alguien lo usó, genera uno nuevo y quita el anterior del código.

**Si el escaneo da una falsa alarma:** agrega a `.gitleaksignore` la huella (`Fingerprint`) que aparece en el log.

### Estructura del repositorio
| Ruta | Contenido |
| --- | --- |
| `apps/` | Caja y aplicación web |
| `services/` | Núcleo en Java y analítica en Python |
| `packages/` | Contratos, lógica de dinero e interfaz compartidos |
| `infra/` | Compose, Terraform, Keycloak y Grafana |
| `scripts/` | Revisiones del repositorio y preparación del stack local |
| `docs/` | Especificación, decisiones de arquitectura y plan |

### Documentación
- [Especificación](docs/especificacion.md)
- [Arquitectura](docs/plan/03-arquitectura.md)
- [Decisiones de arquitectura](docs/adr/README.md)
- [Roadmap](docs/plan/04-roadmap.md)

### Licencia
[GNU AGPL-3.0](LICENSE).
