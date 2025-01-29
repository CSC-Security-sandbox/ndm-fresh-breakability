#!/usr/bin/env bash
set -e

SOURCE_VAULT=false

if [ "$2" = "--source-vault" ]; then
  SOURCE_VAULT=true
fi

if [ "$SOURCE_VAULT" = true ]; then
  for env_file in /vault/secrets/*.env; do
    if [ -f "$env_file" ]; then
      echo "Sourcing $env_file"
      source "$env_file"
    else
      echo "No env file from vault present. Exiting."
      exit 1
    fi
  done
fi

cd /app
echo "Running liquibase"
liquibase --url="$LIQUIBASE_COMMAND_URL" \
          --username="$LIQUIBASE_COMMAND_USERNAME" \
          --password="$LIQUIBASE_COMMAND_PASSWORD" \
          --driver="$LIQUIBASE_COMMAND_DRIVER" \
          --changeLogFile="$LIQUIBASE_COMMAND_CHANGELOG_FILE" \
          --liquibase-schema-name="$LIQUIBASE_LIQUIBASE_SCHEMA_NAME" \
          --default-schema-name="$LIQUIBASE_COMMAND_DEFAULT_SCHEMA_NAME" \
          "$1"