FROM datamigratedev.azurecr.io/ndm-datamigrator-ui:0.0.5 AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . ./
RUN npm run build

FROM nginx:1.28.0-alpine3.21-slim

RUN apk update && \
    apk upgrade --no-cache && \
    apk add --no-cache nodejs npm bash && \
    rm -vrf /var/cache/apk/*

WORKDIR /app

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
COPY generate_env.sh .
COPY entrypoint.sh .

RUN chmod +x /app/entrypoint.sh && \
    chmod +x /app/generate_env.sh

EXPOSE 80

ENTRYPOINT ["/app/entrypoint.sh"]