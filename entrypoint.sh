#!/bin/sh

# Extract the replica index from the hostname
REPLICA_INDEX=${HOSTNAME##*-}

echo "Starting replica with index: $REPLICA_INDEX"

# Export the replica index so it is available to the application
export REPLICA_INDEX

# Run the NestJS application
exec npm run start