#!/bin/sh

# Extract the replica index from the hostname
REPLICA_INDEX=${HOSTNAME##*-}

echo "Starting replica with index: $REPLICA_INDEX"

# Export the replica index so it is available to the application
export REPLICA_INDEX

# Run the NestJS application
exec pm2 start dist/main.js --name "job-service" --watch --ignore-watch "node_modules" --no-daemon