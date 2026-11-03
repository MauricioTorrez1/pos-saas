# Analytics service

Python service for analytics and AI, with no business rules: the Java core decides, and this service only reads and suggests. For now it holds a minimal FastAPI API and a dbt project with synthetic data.

| Path | Contents |
| --- | --- |
| `src/pos_analytics/` | FastAPI application, with a `GET /health` endpoint |
| `tests/` | pytest tests of the API |
| `dbt/` | dbt project that runs on DuckDB |
| `Dockerfile` | The API and dbt images of the `analytics` Compose profile |

## API
Run the tests from this folder:

```bash
uv run pytest
```

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
