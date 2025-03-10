#!/bin/sh
SOURCE_VAULT=false

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

echo "Starting datamigrator-ui-service"
npm run dev &
#pm2 start npm --name datamigrator-ui-service --watch --ignore-watch node_modules -- run dev

echo "Starting nginx"

# Replace forward slashes with escaped forward slashes
export _VITE_ADMIN_SERVICE_ENDPOINT=$(echo "$VITE_ADMIN_SERVICE_ENDPOINT" | sed 's/\//\\\//g')
sed -i "s/__VITE_ADMIN_SERVICE_ENDPOINT__/$_VITE_ADMIN_SERVICE_ENDPOINT/g" /etc/nginx/nginx.conf

export _VITE_CONFIG_SERVICE_ENDPOINT=$(echo "$VITE_CONFIG_SERVICE_ENDPOINT" | sed 's/\//\\\//g')
sed -i "s/__VITE_CONFIG_SERVICE_ENDPOINT__/$_VITE_CONFIG_SERVICE_ENDPOINT/g" /etc/nginx/nginx.conf

export _VITE_JOBS_SERVICE_ENDPOINT=$(echo "$VITE_JOBS_SERVICE_ENDPOINT" | sed 's/\//\\\//g')
sed -i "s/__VITE_JOBS_SERVICE_ENDPOINT__/$_VITE_JOBS_SERVICE_ENDPOINT/g" /etc/nginx/nginx.conf

export _VITE_REPORTS_SERVICE_ENDPOINT=$(echo "$VITE_REPORTS_SERVICE_ENDPOINT" | sed 's/\//\\\//g')
sed -i "s/__VITE_REPORTS_SERVICE_ENDPOINT__/$_VITE_REPORTS_SERVICE_ENDPOINT/g" /etc/nginx/nginx.conf

export _VITE_FILE_SERVICE_ENDPOINT=$(echo "$VITE_FILE_SERVICE_ENDPOINT" | sed 's/\//\\\//g')
sed -i "s/__VITE_FILE_SERVICE_ENDPOINT__/$_VITE_FILE_SERVICE_ENDPOINT/g" /etc/nginx/nginx.conf

nginx -g "daemon off;"