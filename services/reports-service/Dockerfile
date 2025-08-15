
FROM node:20-bullseye-slim

USER root

# Install system dependencies and global npm packages for Puppeteer/Chrome
RUN apt-get update \
    && apt-get install -y \
        ca-certificates \
        wget \
        gnupg \
        fonts-liberation \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libcups2 \
        libdrm2 \
        libgbm1 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libx11-xcb1 \
        libxcomposite1 \
        libxdamage1 \
        libxrandr2 \
        xdg-utils \
        --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @nestjs/cli pm2@latest puppeteer

# Set environment variables for Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false \
    NODE_ENV=production

WORKDIR /app

# Copy package files and install dependencies
COPY ["package.json","./"]
COPY [".npmrc", "./"]
RUN --mount=type=secret,id=git_token \
    GITOPS_USER_GITHUB_TOKEN=$(cat /run/secrets/git_token) npm install --legacy-peer-deps --only=production \
    && rm -f ./.npmrc 

# Copy application source code
COPY ./src ./src
COPY ./templates ./templates
COPY tsconfig.json .
COPY tsconfig.build.json .
COPY nest-cli.json .
COPY entrypoint.sh .

# Build the application
RUN npm run build

# Expose application port
EXPOSE 3000

# Ensure script is executable
RUN chmod +x /app/entrypoint.sh

# Start application
ENTRYPOINT ["/app/entrypoint.sh"]
