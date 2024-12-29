#!/bin/sh
SOURCE_VAULT=false

if [ "$1" = "--source-vault" ]; then
  SOURCE_VAULT=true
fi

if [ "$SOURCE_VAULT" = true ]; then
  echo "Sourcing vault secrets.."
  source /vault/secrets/config
fi

echo "Starting admin-service.."
pm2 start dist/main.js --name "admin-service" --watch --ignore-watch "node_modules" --no-daemon
