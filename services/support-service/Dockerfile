FROM public.ecr.aws/docker/library/node:22.19.0-trixie-slim

RUN apt-get update \
    && apt-get install -y --only-upgrade libc-bin libc6 \
    && apt-get install -y ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @nestjs/cli pm2@latest


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

RUN npm run build && npm uninstall -g @nestjs/cli

RUN chmod +x /app/entrypoint.sh
EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
