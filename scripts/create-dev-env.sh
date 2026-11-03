#!/usr/bin/env bash
# Creates .env from .env.example, with random passwords for the local stack.
# An existing .env keeps its values, because the Docker volumes were created with its passwords.
# It only receives the variables that the template added after it was created.

set -euo pipefail

readonly ENV_FILE=".env"
readonly TEMPLATE_FILE=".env.example"
readonly PASSWORD_BYTES=24
readonly GENERATED_PASSWORDS=(
  "POSTGRES_PASSWORD"
  "KEYCLOAK_DB_PASSWORD"
  "KEYCLOAK_ADMIN_PASSWORD"
  "REDIS_PASSWORD"
  "GRAFANA_ADMIN_PASSWORD"
)

# Prints a line of the template, with a random password if its variable needs one.
# Arguments: $1 - line of the template.
fill_password() {
  local name
  for name in "${GENERATED_PASSWORDS[@]}"; do
    if [[ "$1" == "${name}=" ]]; then
      # Hexadecimal output is safe inside connection URLs.
      printf '%s=%s\n' "$name" "$(openssl rand -hex "$PASSWORD_BYTES")"
      return
    fi
  done
  printf '%s\n' "$1"
}

create_env_file() {
  local line
  umask 077
  while IFS= read -r line || [[ -n "$line" ]]; do
    fill_password "$line"
  done <"$TEMPLATE_FILE" >"$ENV_FILE"
  echo "Created $ENV_FILE with random passwords for the local stack."
}

# Appends the variables that .env lacks. It only compares names, so it never prints a value.
add_missing_variables() {
  local line name added=0
  # A last line without a line break would otherwise join the first new variable.
  if [[ -n "$(tail -c 1 "$ENV_FILE")" ]]; then
    echo >>"$ENV_FILE"
  fi
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^([A-Z0-9_]+)= ]]; then
      name=${BASH_REMATCH[1]}
      if ! grep -q "^${name}=" "$ENV_FILE"; then
        fill_password "$line" >>"$ENV_FILE"
        echo "Added $name to $ENV_FILE."
        added=$((added + 1))
      fi
    fi
  done <"$TEMPLATE_FILE"
  if ((added == 0)); then
    echo "$ENV_FILE already has every variable. Nothing changed."
  fi
}

if [[ -e "$ENV_FILE" ]]; then
  add_missing_variables
else
  create_env_file
fi
