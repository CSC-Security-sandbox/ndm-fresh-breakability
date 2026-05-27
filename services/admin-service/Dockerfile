FROM public.ecr.aws/docker/library/alpine:3.21.4

RUN apk update && \
    apk upgrade --no-cache --purge && \
    apk add --no-cache npm nodejs && \
    rm -vrf /var/cache/apk/* && \
    npm i -g @nestjs/cli && \
    npm i -g pm2@latest

# Upgrade npm to 11.11.0 for compatibility. npm@11.11.0 bundles minimatch 10.2.2
# which is vulnerable (CVE-2026-27903, CVE-2026-27904), so we patch it to 10.2.3.
RUN npm install -g npm@11.11.0 \
    && npm install --prefix /tmp "minimatch@^10.2.3" \
    && rm -rf $(npm root -g)/npm/node_modules/minimatch \
    && cp -r /tmp/node_modules/minimatch $(npm root -g)/npm/node_modules/minimatch \
    && rm -rf /tmp/node_modules /tmp/package.json /tmp/package-lock.json

WORKDIR /app

# Workspace root manifest and lock file
COPY package.json package-lock.json ./

# Internal libs (source — compiled inside Docker by build:libs)
COPY lib/ ./lib/

# This service
COPY services/admin-service/ ./services/admin-service/

RUN --mount=type=secret,id=git_token \
    printf "@netapp-cloud-datamigrate:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=$(cat /run/secrets/git_token)\n" > .npmrc && \
    npm install && \
    rm -f .npmrc

RUN npm run build:libs && \
    npm run build --workspace=services/admin-service && \
    npm uninstall -g @nestjs/cli

# Run from the service directory so dist/main.js resolves correctly
WORKDIR /app/services/admin-service

EXPOSE 3000

RUN chmod +x /app/services/admin-service/entrypoint.sh
ENTRYPOINT ["/app/services/admin-service/entrypoint.sh"]
