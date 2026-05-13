FROM public.ecr.aws/docker/library/node:22.19.0-bookworm-slim

# p7zip-full: native 7za for ASUP packaging (USE_SYSTEM_7ZA=true replaces the
# glibc-linked 7zip-bin bundled binary).
# @temporalio/core-bridge ships a Rust native module compiled against glibc —
# Debian slim provides glibc natively, so no compatibility shims are needed.
RUN apt-get update && apt-get install -y --no-install-recommends p7zip-full \
    && rm -rf /var/lib/apt/lists/*

# Align with prior image: npm 11.11.0 + minimatch patch for bundled npm dependency advisories
RUN npm install -g npm@11.11.0 @nestjs/cli pm2@latest \
    && npm install --prefix /tmp minimatch@10.2.3 \
    && rm -rf "$(npm root -g)/npm/node_modules/minimatch" \
    && cp -r /tmp/node_modules/minimatch "$(npm root -g)/npm/node_modules/minimatch" \
    && rm -rf /tmp/node_modules /tmp/package.json /tmp/package-lock.json

ENV USE_SYSTEM_7ZA=true \
    NODE_ENV=production

WORKDIR /app

COPY ["package.json","package-lock.json","./"]
COPY [".npmrc", "./"]
RUN --mount=type=secret,id=git_token \
    GITOPS_USER_GITHUB_TOKEN=$(cat /run/secrets/git_token) npm install --legacy-peer-deps --omit=dev \
    && rm -f ./.npmrc

COPY ./src ./src
COPY tsconfig.json .
COPY tsconfig.build.json .
COPY nest-cli.json .
COPY entrypoint.sh .

RUN npm run build && npm uninstall -g @nestjs/cli

EXPOSE 3000

# Pre-create the reports directory structure so named volumes inherit the
# correct permissions on first mount. The entrypoint also runs chmod in case
# of a bind-mount or volume with restrictive host ownership.
RUN mkdir -p /reports/temp && chmod -R 777 /reports

RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
