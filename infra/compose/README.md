# Compose

Docker Compose profiles for the local stack. `core` and `observability` are ready, and each one starts without the other. `automation` and `analytics` are added in later tasks of the [roadmap](../../docs/plan/04-roadmap.md).

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

Fill the [Grafana dashboard](http://localhost:3001/d/pos-overview) with about two minutes of simulated sales:

```bash
bash scripts/send-test-telemetry.sh
```

Check the whole route. This sends a trace, metrics, and a log, and fails unless Grafana can read them:

```bash
bash scripts/check-observability.sh
```

Stop a profile and keep its data. If the other profile is still running, `Resource is still in use` only means that it still needs the network:

```bash
docker compose --profile core down
```

```bash
docker compose --profile observability down
```

Stop everything and delete all local data. `--volumes` only deletes the volumes of the profiles you name:

```bash
docker compose --profile core --profile observability down --volumes
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
