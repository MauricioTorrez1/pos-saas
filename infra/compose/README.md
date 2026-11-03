# Compose

Docker Compose profiles for the local stack. `core` is ready. `observability`, `automation`, and `analytics` are added in later tasks of the [roadmap](../../docs/plan/04-roadmap.md).

## Profile `core`
| Service | From your PC | From another container | Data |
| --- | --- | --- | --- |
| PostgreSQL 16 | `localhost:5432` | `postgres:5432` | `postgres-data` volume |
| Keycloak | <http://localhost:8180> | `http://keycloak:8080` | `keycloak` database in PostgreSQL |
| Redis | `localhost:6379` | `redis:6379` | `redis-data` volume |
| Redpanda, Kafka API | `localhost:19092` | `redpanda:9092` | `redpanda-data` volume |
| Redpanda, Admin API | `localhost:19644` | `redpanda:9644` | Same volume |

Ports listen on `127.0.0.1` only. Users and passwords are in your `.env`.

## Commands
Run them from the repository root, after `bash scripts/create-dev-env.sh`.

Start the stack and check that every service is healthy within two minutes:

```bash
bash scripts/wait-for-core.sh
```

Stop it and keep the data:

```bash
docker compose --profile core down
```

Stop it and delete all local data:

```bash
docker compose --profile core down --volumes
```

The Keycloak database and role are created only when the PostgreSQL volume is empty. If you replace `.env`, delete the volumes too, because they still expect the old passwords.

## Measured resources
Measured on 2026-11-02 with `docker stats --no-stream`, on Windows 11 with Docker Desktop and WSL2, which gives Docker 7.6 GiB of RAM. The stack was idle, shortly after a first start with empty data:

| Service | Memory |
| --- | --- |
| Keycloak | 642 MiB |
| Redpanda | 194 MiB |
| PostgreSQL | 63 MiB |
| Redis | 8 MiB |
| **Total** | **907 MiB** |

These numbers will grow under real use, and they do not include the WSL2 virtual machine itself. The first start with empty data took 49 seconds, and a restart with existing data took 27. Neither includes the image download.
