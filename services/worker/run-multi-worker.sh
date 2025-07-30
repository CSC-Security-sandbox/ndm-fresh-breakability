#!/bin/bash

ENVIRONMENT=${1:-development}
ENV_FILE=".env.${ENVIRONMENT}"

if [ ! -f $ENV_FILE ]; then
  echo "❌ Environment file $ENV_FILE not found!"
  exit 1
fi

echo "✅ Using environment file: $ENV_FILE"

# Copy the env file to .env
cp $ENV_FILE .env

# Start the app
npm run start
 