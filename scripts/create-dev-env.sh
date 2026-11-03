#!/usr/bin/env bash
# Creates .env from .env.example, with random passwords for the local stack.
# An existing .env is never replaced, because the Docker volumes were created with its passwords.

set -euo pipefail

readonly ENV_FILE=".env"
readonly TEMPLATE_FILE=".env.example"
readonly PASSWORD_BYTES=24
readonly GENERATED_PASSWORDS=(
  "POSTGRES_PASSWORD"
  "KEYCLOAK_DB_PASSWORD"
  "KEYCLOAK_ADMIN_PASSWORD"
  "REDIS_PASSWORD"
)

if [[ -e "$ENV_FILE" ]]; then
  echo "$ENV_FILE already exists. Nothing changed."
  exit 0
fi

env_content=$(<"$TEMPLATE_FILE")
for name in "${GENERATED_PASSWORDS[@]}"; do
  # Hexadecimal output is safe inside the sed expression and inside connection URLs.
  password=$(openssl rand -hex "$PASSWORD_BYTES")
  env_content=$(sed "s/^${name}=\$/${name}=${password}/" <<<"$env_content")
done

umask 077
printf '%s\n' "$env_content" >"$ENV_FILE"

echo "Created $ENV_FILE with random passwords for the local stack."
