#!/bin/sh

if [ "$1" = "--source-vault" ]; then
  SOURCE_VAULT=true
fi

if [ "$SOURCE_VAULT" = true ]; then
  for env_file in /vault/secrets/*.env; do
    if [ -f "$env_file" ]; then
      echo "Sourcing $env_file"
      source "$env_file"
    fi
  done
fi
# Extract the replica index from the hostname
REPLICA_INDEX=${HOSTNAME##*-}

echo "Starting replica with index: $REPLICA_INDEX"

# Export the replica index so it is available to the application
export REPLICA_INDEX

# Run the NestJS application
exec pm2 start dist/main.js --name "job-service" --watch --ignore-watch "node_modules" --no-daemon