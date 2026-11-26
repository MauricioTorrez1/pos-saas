# Analytics service

Python service for analytics and AI, with no business rules: the Java core decides, and this service only reads and suggests. For now it holds a minimal FastAPI API and a dbt project with synthetic data.

| Path | Contents |
| --- | --- |
| `src/pos_analytics/` | FastAPI application, with `GET /health`, `POST /catalog-pages/read` and `POST /catalog-matching/group` |
| `tests/` | pytest tests of the API |
| `dbt/` | dbt project that runs on DuckDB |
| `Dockerfile` | The API and dbt images of the `analytics` Compose profile |

## API
Run the tests from this folder:

```bash
uv run pytest
```

## Paper catalog reader (E1-53)
`POST /catalog-pages/read` takes one photo of a printed supplier catalog page as the raw body (`image/jpeg` or `image/png`, up to 5 MB), or a scanned PDF (`application/pdf`, up to 20 MB and 4 pages) and returns the proposed rows: `supplier_code`, `description`, `purchase_unit`, `pieces_per_unit`, `cost_e6` (millionths of a peso, as digit text), `confidence` and `issues`. Doubtful values are flagged, never guessed. Only the owner may call it: the service asks the core `GET /me` with the bearer token. Nothing is stored.

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude API key. Without it the endpoint answers 503 |
| `CATALOG_READER_MODEL` | Model id, `claude-opus-5-5` by default |
| `ANALYTICS_CORE_API_URL` | Address of the core, used to check the owner |

The tests use a fake client and never reach the network. [ADR 0069](../../docs/adr/0069-lectura-de-catalogos-en-papel-con-claude.md) explains the model, the cost per page and why a person approves every row.

## Equivalent products (E1-63)
`POST /catalog-matching/group` takes up to 200 supplier price-list items that the register's own rules could not group (`id`, `supplier` as a letter, `description`, `purchase_unit`, `pieces_per_unit`; never costs nor supplier names) and returns the groups Claude thinks are the same product, each with a reason in Spanish and a confidence. Impossible groups (unknown items, two items of one supplier, an item twice) are dropped; the register vetoes the rest against its rules and the owner approves each one. The register calls it with `Authorization: Device <token>`; the owner of the panel may call it with a bearer token.

| Variable | Purpose |
| --- | --- |
| `ANALYTICS_REGISTER_TOKEN` | Device token of the register, compared in constant time. Without it the register is refused (503) |
| `CATALOG_MATCHER_MODEL` | Model id, `claude-opus-5-5` by default |

[ADR 0078](../../docs/adr/0078-productos-equivalentes-entre-catalogos.md) explains the rules, the veto and what never leaves the register.

## dbt project
`seeds/sample_sales.csv` holds invented sales. `stg_sales` prepares them, and `daily_sales` adds them up by tenant and day. Money stays in integer cents, and every row has a `tenant_id`.

dbt runs in Docker, so you do not need to install it. The project is mounted into the container, so an edited model takes effect on the next run. Run these commands from the repository root.

Load the data, create the models, and run their tests:

```bash
docker compose run --rm dbt build
```

See the result of a model:

```bash
docker compose run --rm dbt show --select daily_sales
```

Run only the tests against the data already stored:

```bash
docker compose run --rm dbt test
```

[ADR 0017](../../docs/adr/0017-n8n-y-dbt-locales.md) explains why this is dbt v2 OSS and why it only runs on demand.
