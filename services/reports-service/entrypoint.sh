#!/bin/sh
SOURCE_VAULT=false

if [ "$1" = "--source-vault" ]; then
  SOURCE_VAULT=true
fi

if [ "$SOURCE_VAULT" = true ]; then
  for env_file in /vault/secrets/*.env; do
    if [ -f "$env_file" ]; then
      echo "Sourcing $env_file"
      . "$env_file"
    fi
  done
fi

echo "Starting reports-service.."
pm2 start dist/main.js --name "reports-service" --watch --ignore-watch "node_modules" --no-daemon
