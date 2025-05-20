#!/bin/sh

CONFIG_FILE="/usr/share/nginx/html/assets/env-config.js"
INDEX_FILE="/usr/share/nginx/html/index.html"

echo "Injecting environment variables for production build..."

# Create env-config.js with environment variables
echo "window.env = {" > $CONFIG_FILE
echo "  VITE_PORT: \"${VITE_PORT}\"," >> $CONFIG_FILE
echo "  VITE_SESSION_KEY: \"${VITE_SESSION_KEY}\"," >> $CONFIG_FILE
echo "  VITE_HARD_CODE_ACCOUNT_ID: \"${VITE_HARD_CODE_ACCOUNT_ID}\"," >> $CONFIG_FILE
echo "  VITE_API_LIMIT: \"${VITE_API_LIMIT}\"," >> $CONFIG_FILE
echo "  VITE_TIME_INTERVAL: \"${VITE_TIME_INTERVAL}\"," >> $CONFIG_FILE
echo "  VITE_ADMIN_SERVICE_URL: \"${VITE_ADMIN_SERVICE_URL}\"," >> $CONFIG_FILE
echo "  VITE_CONFIG_SERVICE_URL: \"${VITE_CONFIG_SERVICE_URL}\"," >> $CONFIG_FILE
echo "  VITE_JOBS_SERVICE_URL: \"${VITE_JOBS_SERVICE_URL}\"," >> $CONFIG_FILE
echo "  VITE_WORKERS_SERVICE_URL: \"${VITE_WORKERS_SERVICE_URL}\"," >> $CONFIG_FILE
echo "  VITE_REPORTS_SERVICE_URL: \"${VITE_REPORTS_SERVICE_URL}\"," >> $CONFIG_FILE
echo "  VITE_ADMIN_SERVICE_ENDPOINT: \"${VITE_ADMIN_SERVICE_ENDPOINT}\"," >> $CONFIG_FILE
echo "  VITE_CONFIG_SERVICE_ENDPOINT: \"${VITE_CONFIG_SERVICE_ENDPOINT}\"," >> $CONFIG_FILE
echo "  VITE_JOBS_SERVICE_ENDPOINT: \"${VITE_JOBS_SERVICE_ENDPOINT}\"," >> $CONFIG_FILE
echo "  VITE_WORKERS_SERVICE_ENDPOINT: \"${VITE_WORKERS_SERVICE_ENDPOINT}\"," >> $CONFIG_FILE
echo "  VITE_REPORTS_SERVICE_ENDPOINT: \"${VITE_REPORTS_SERVICE_ENDPOINT}\"," >> $CONFIG_FILE
echo "  VITE_KEYCLOAK_HOST: \"${VITE_KEYCLOAK_HOST}\"," >> $CONFIG_FILE
echo "  VITE_KEYCLOAK_REALM: \"${VITE_KEYCLOAK_REALM}\"," >> $CONFIG_FILE
echo "  VITE_KEYCLOAK_CLIENT: \"${VITE_KEYCLOAK_CLIENT}\"," >> $CONFIG_FILE
echo "  VITE_KEYCLOAK_AUTHORITY: \"${VITE_KEYCLOAK_AUTHORITY}\"," >> $CONFIG_FILE
echo "  VITE_KEYCLOAK_GRANT_TYPE: \"${VITE_KEYCLOAK_GRANT_TYPE}\"," >> $CONFIG_FILE
echo "  VITE_KEYCLOAK_CLIENT_ID: \"${VITE_KEYCLOAK_CLIENT_ID}\"," >> $CONFIG_FILE
echo "  VITE_KEYCLOAK_CLIENT_SECRET: \"${VITE_KEYCLOAK_CLIENT_SECRET}\"," >> $CONFIG_FILE
echo "  VITE_KEYCLOAK_REDIRECT_URI: \"${VITE_KEYCLOAK_REDIRECT_URI}\"," >> $CONFIG_FILE
echo "  VITE_KEYCLOAK_RESPONSE_TYPE: \"${VITE_KEYCLOAK_RESPONSE_TYPE}\"," >> $CONFIG_FILE
echo "  VITE_KEYCLOAK_POST_LOGOUT_REDIRECT_URI: \"${VITE_KEYCLOAK_POST_LOGOUT_REDIRECT_URI}\"," >> $CONFIG_FILE
echo "  VITE_GRAFANA_URL: \"${VITE_GRAFANA_URL}\"" >> $CONFIG_FILE
echo "};" >> $CONFIG_FILE

echo "env-config.js created successfully."

# Inject <script> tag for env-config.js into index.html
if grep -q "env-config.js" "$INDEX_FILE"; then
  echo "env-config.js script tag already exists in index.html."
else
  echo "Injecting env-config.js into index.html..."
  sed -i 's#<head>#<head>\n<script src="/assets/env-config.js"></script>#' "$INDEX_FILE"
  echo "Injection completed."
fi