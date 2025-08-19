FROM public.ecr.aws/docker/library/node:22.18.0-trixie-slim

# Install system dependencies required for Puppeteer and Firefox
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    # fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-glib-1-2 \
    libdrm2 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxrandr2 \
    libxrender1 \
    libxtst6 \
    firefox-esr \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Install global npm packages
RUN npm install -g @nestjs/cli pm2@latest


ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/firefox \
    NODE_ENV=production \
    PUPPETEER_PRODUCT=firefox

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