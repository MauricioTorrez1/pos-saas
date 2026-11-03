#!/usr/bin/env bash
# Creates the Keycloak role and database inside the shared PostgreSQL server.
# The official image runs this file only when the data volume is empty.

set -euo pipefail

psql --variable=ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
  --variable=password="$KEYCLOAK_DB_PASSWORD" <<'SQL'
CREATE ROLE keycloak LOGIN PASSWORD :'password';
CREATE DATABASE keycloak OWNER keycloak;
SQL
