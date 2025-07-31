#!/bin/bash
# Update password to avoid Keycloak history issues
TIMESTAMP=$(date +%s)
sed -i '' "s/PASSWORD=.*/PASSWORD=TestPass@${TIMESTAMP}/" .env
echo "Updated password in .env to avoid Keycloak history conflicts"

# Run the tests
ginkgo run -v
