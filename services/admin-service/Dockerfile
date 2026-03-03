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

COPY ["package.json", "package-lock.json", "./"]
COPY [".npmrc", "./"]
RUN --mount=type=secret,id=git_token \
    GITOPS_USER_GITHUB_TOKEN=$(cat /run/secrets/git_token) npm install \
    && rm -f ./.npmrc

COPY ./src ./src
COPY tsconfig.json .
COPY tsconfig.build.json .
COPY nest-cli.json .
COPY entrypoint.sh .
COPY ./templates ./templates

RUN npm run build && npm uninstall -g @nestjs/cli

EXPOSE 3000

RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]