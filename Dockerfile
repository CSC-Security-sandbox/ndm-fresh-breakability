FROM datamigratedev.azurecr.io/datamigrator-ui:0.0.3 AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . ./
#RUN npm run build

FROM nginx:stable-alpine

# Install Nodejs and required tools
RUN apk update && \
    apk upgrade --no-cache && \
    apk add --no-cache nodejs npm bash curl && \
    rm -vrf /var/cache/apk/*

RUN npm install -g pm2@latest

WORKDIR /app

COPY --from=builder /app /app
COPY nginx.conf /etc/nginx/nginx.conf
COPY entrypoint.sh .

RUN chmod +x /app/entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/app/entrypoint.sh"]