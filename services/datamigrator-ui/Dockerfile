FROM datamigratedev.azurecr.io/ndm-datamigrator-ui:0.0.5 AS builder

WORKDIR /app

# Workspace root manifest and lock file
COPY package.json package-lock.json ./

# This service (no internal lib dependencies — pure frontend)
COPY services/datamigrator-ui/ ./services/datamigrator-ui/

# Copy NetApp registry config so @netapp/* packages resolve correctly
RUN cp /app/services/datamigrator-ui/.npmrc .npmrc

RUN npm install && rm -f .npmrc

RUN npm run build --workspace=services/datamigrator-ui

FROM nginx:1.28.0-alpine3.21-slim

RUN apk update && \
    apk upgrade --no-cache && \
    apk add --no-cache nodejs npm bash && \
    rm -vrf /var/cache/apk/*

WORKDIR /app

COPY --from=builder /app/services/datamigrator-ui/dist /usr/share/nginx/html
COPY services/datamigrator-ui/nginx.conf /etc/nginx/nginx.conf
COPY services/datamigrator-ui/generate_env.sh .
COPY services/datamigrator-ui/entrypoint.sh .

RUN chmod +x /app/entrypoint.sh && \
    chmod +x /app/generate_env.sh

EXPOSE 80

ENTRYPOINT ["/app/entrypoint.sh"]
