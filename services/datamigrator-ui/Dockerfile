FROM datamigratedev.azurecr.io/datamigrator-ui:0.0.4 AS builder

WORKDIR /app

COPY package*.json ./
COPY .npmrc ./
RUN --mount=type=secret,id=git_token \
    GITOPS_USER_GITHUB_TOKEN=$(cat /run/secrets/git_token) npm install \
    && rm -f ./.npmrc

COPY . ./
RUN npm run build

FROM nginx:1.28.0-alpine3.21-slim

RUN apk update && \
    apk upgrade --no-cache && \
    apk add --no-cache nodejs npm bash curl && \
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