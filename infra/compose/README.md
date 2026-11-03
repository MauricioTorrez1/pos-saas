# Compose

Docker Compose profiles for the local stack: `core`, `observability`, `automation`, and `analytics`. Each one starts without the others.

## Profile `core`
| Service | From your PC | From another container | Data |
| --- | --- | --- | --- |
| PostgreSQL 16 | `localhost:5432` | `postgres:5432` | `postgres-data` volume |
| Keycloak | <http://localhost:8180> | `http://keycloak:8080` | `keycloak` database in PostgreSQL |
| Redis | `localhost:6379` | `redis:6379` | `redis-data` volume |
| Redpanda, Kafka API | `localhost:19092` | `redpanda:9092` | `redpanda-data` volume |
| Redpanda, Admin API | `localhost:19644` | `redpanda:9644` | Same volume |

Ports listen on `127.0.0.1` only. Users and passwords are in your `.env`.

## Profile `observability`
Applications send everything to the collector, which routes traces to Tempo, metrics to Prometheus, and logs to Loki. Grafana reads all three.

| Service | From your PC | From another container | Data |
| --- | --- | --- | --- |
| OpenTelemetry Collector, OTLP/HTTP | `localhost:4318` | `otel-collector:4318` | None |
| OpenTelemetry Collector, OTLP/gRPC | `localhost:4317` | `otel-collector:4317` | None |
| Prometheus | <http://localhost:9090> | `http://prometheus:9090` | `prometheus-data` volume, 7 days |
| Loki | Not published | `http://loki:3100` | `loki-data` volume, 7 days |
| Tempo | Not published | `http://tempo:3200` | `tempo-data` volume, 7 days |
| Grafana | <http://localhost:3001> | `http://grafana:3000` | None. Its [data sources and dashboards](../grafana/README.md) come from Git |

Two things that look wrong and are not:

- `health-tools` shows `Exited (0)` in `docker compose ps --all`. The Loki and collector images have no shell or HTTP client, so this service copies a static BusyBox to a shared volume for their health checks and then exits.
- Tempo logs `no jobs found` every 15 seconds while it has nothing to compact.

## Profile `automation`
| Service | From your PC | From another container | Data |
| --- | --- | --- | --- |
| n8n | <http://localhost:5678> | `http://n8n:5678` | `n8n-data` volume, with SQLite |

The first visit asks you to create the owner account, which only exists on that volume. `N8N_ENCRYPTION_KEY` encrypts the credentials stored there. If you change the key, n8n cannot read them, so delete the volume too.

Compose uses the version that n8n tags as `stable`. Its prereleases have normal-looking Docker tags, so before you merge a Dependabot update, check that `stable` already points to that version.

n8n lists some deprecated settings when it starts. None of them affects local use today.

## Profile `analytics`
| Service | From your PC | From another container | Data |
| --- | --- | --- | --- |
| Analytics API | <http://localhost:8000/health> | `http://analytics-api:8000` | None |
| dbt with DuckDB | A command, not a server | Not applicable | `analytics-data` volume |

dbt does not start with the profile, because it runs and then exits. A failed run leaves its data on the volume until the next `dbt build` with correct data. The [analytics service](../../services/analytics/README.md) lists its commands.

## Commands
Run them from the repository root, after `bash scripts/create-dev-env.sh`.

Run that script again after pulling changes. It adds new variables to `.env` and keeps the values it already has. Until then, every `docker compose` command fails and names the missing variable, even for another profile, because Compose reads the whole file.

Start a profile and check that every service is healthy within two minutes:

```bash
bash scripts/wait-for-profile.sh core
```

```bash
bash scripts/wait-for-profile.sh observability
```

```bash
bash scripts/wait-for-profile.sh automation
```

```bash
bash scripts/wait-for-profile.sh analytics
```

The script also builds the images of the profile. It prints `No services to build` for a profile that only uses published images.

Fill the [Grafana dashboard](http://localhost:3001/d/pos-overview) with about two minutes of simulated sales:

```bash
bash scripts/send-test-telemetry.sh
```

Check the whole route. This sends a trace, metrics, and a log, and fails unless Grafana can read them:

```bash
bash scripts/check-observability.sh
```

Stop a profile and keep its data. If another profile is still running, `Resource is still in use` only means that it still needs the network:

```bash
docker compose --profile core down
```

```bash
docker compose --profile observability down
```

```bash
docker compose --profile automation down
```

```bash
docker compose --profile analytics down
```

Stop everything and delete all local data. `--volumes` only deletes the volumes of the profiles you name:

```bash
docker compose --profile core --profile observability --profile automation --profile analytics down --volumes
```

The Keycloak database and role are created only when the PostgreSQL volume is empty. If you replace `.env`, delete the volumes too, because they still expect the old passwords.

## Measured resources
Measured with `docker stats --no-stream`, on Windows 11 with Docker Desktop and WSL2, which gives Docker 7.6 GiB of RAM. These numbers will grow under real use, and they do not include the WSL2 virtual machine itself.

### Profile `core`
Measured on 2026-11-02. The stack was idle, shortly after a first start with empty data:

| Service | Memory |
| --- | --- |
| Keycloak | 642 MiB |
| Redpanda | 194 MiB |
| PostgreSQL | 63 MiB |
| Redis | 8 MiB |
| **Total** | **907 MiB** |

The first start with empty data took 49 seconds, and a restart with existing data took 27. Neither includes the image download.

### Profile `observability`
Measured on 2026-11-03, shortly after two minutes of simulated sales, with the dashboard and some traces opened in Grafana:

| Service | Memory |
| --- | --- |
| Grafana | 796 MiB |
| Tempo | 378 MiB |
| Loki | 89 MiB |
| Prometheus | 33 MiB |
| OpenTelemetry Collector | 27 MiB |
| **Total** | **1,323 MiB** |

Grafana and Tempo vary the most: a shorter session on a throwaway stack gave 343 MiB and 89 MiB. With `core` running too, the local stack uses about 2.2 GiB of the 7.6 GiB that Docker sees. The first start took 35 seconds, and a restart with existing data took 34. Neither includes the image download.

### Profiles `automation` and `analytics`
Measured on 2026-11-03 on a throwaway stack. Both profiles were idle, and n8n had no workflows:

| Service | Memory |
| --- | --- |
| n8n | 383 MiB |
| Analytics API | 43 MiB |
| **Total** | **426 MiB** |

n8n varies the most: it used 897 MiB shortly after a first start with empty data. dbt only uses memory while it runs.

| Profile | First start | Restart with existing data |
| --- | --- | --- |
| `automation` | 27 seconds | 11 to 17 seconds |
| `analytics` | 6 seconds | 7 seconds |

Neither column includes downloading or building the images. The n8n download is about 300 MiB, and the two analytics images take about 760 MB of disk.
