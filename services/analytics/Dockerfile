# Builds the two images of the analytics profile: the API and the dbt command line.
# Both install the versions in uv.lock, and neither needs uv at run time.

FROM ghcr.io/astral-sh/uv:0.13.6-python3.12-trixie-slim@sha256:bf889bda77474aa50c351caf1538b855ef2b7a30add45f26ca50dcb6ade06402 AS builder
ENV UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock README.md ./

FROM builder AS api-builder
# Third-party packages go first, so a code change does not download them again.
RUN uv sync --locked --no-dev --no-install-project
COPY src ./src
RUN uv sync --locked --no-dev --no-editable

FROM builder AS dbt-builder
RUN uv sync --locked --only-group dbt

FROM python:3.12.16-slim-trixie@sha256:b18b261e1b4974b4f321451ad5251ded85abb22c2b8b262da527dda1d031ab30 AS runtime
RUN useradd --uid 10001 --create-home app
ENV PATH=/app/.venv/bin:$PATH
WORKDIR /app

FROM runtime AS api
COPY --from=api-builder /app/.venv .venv
USER app
EXPOSE 8000
CMD ["uvicorn", "pos_analytics.main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM runtime AS dbt
COPY --from=dbt-builder /app/.venv .venv
COPY dbt/dbt_project.yml dbt/profiles.yml dbt/
RUN install --directory --owner=app --group=app /data
USER app
# Compose mounts the project read-only, so what dbt generates goes to /tmp.
ENV DBT_PROJECT_DIR=/app/dbt \
    DBT_PROFILES_DIR=/app/dbt \
    DBT_TARGET_PATH=/tmp/dbt/target \
    DBT_LOG_PATH=/tmp/dbt/logs \
    DBT_ENGINE_SEND_ANONYMOUS_USAGE_STATS=false \
    DBT_DISABLE_VERSION_CHECK=true \
    DUCKDB_PATH=/data/warehouse.duckdb
# dbt downloads the DuckDB driver the first time it connects. Doing it here keeps it in the image.
RUN DUCKDB_PATH=/tmp/driver-check.duckdb dbt debug && rm -f /tmp/driver-check.duckdb
ENTRYPOINT ["dbt"]
CMD ["--help"]
