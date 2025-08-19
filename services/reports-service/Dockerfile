FROM public.ecr.aws/docker/library/node:22.18.0-trixie-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        wget \
        gnupg \
        fonts-liberation \
        libnss3 \
        libx11-xcb1 \
        libxcomposite1 \
        libxdamage1 \
        libxrandr2 \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libcups2 \
        libdrm2 \
        libgbm1 \
        libgtk-3-0 \
        libnspr4 \
        chromium \
    # Remove vulnerable or unnecessary packages if not required for your app
    && apt-get purge -y --auto-remove xdg-utils libsndfile1 || true \
    # Attempt to upgrade only the affected packages (if patched versions are available in the repo)
    && apt-get install -y --only-upgrade libopenjp2-7 libxslt1.1 \
    # Clean up
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @nestjs/cli pm2@latest \
    && rm -vrf /var/cache/apk/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

COPY ["package.json","./"]
COPY [".npmrc", "./"]
RUN --mount=type=secret,id=git_token \
    GITOPS_USER_GITHUB_TOKEN=$(cat /run/secrets/git_token) npm install --legacy-peer-deps --only=production \
    && rm -f ./.npmrc

COPY ./src ./src
COPY ./templates ./templates
COPY tsconfig.json .
COPY tsconfig.build.json .
COPY nest-cli.json .
COPY entrypoint.sh .

RUN npm run build

EXPOSE 3000

RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]