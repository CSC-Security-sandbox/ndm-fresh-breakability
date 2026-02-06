FROM public.ecr.aws/docker/library/alpine:3.22.0

# Install Node.js, npm, and base deps (Alpine uses apk)
RUN apk add --no-cache \
    ca-certificates \
    curl \
    nodejs \
    npm \
    wget

# Enable community repo (firefox is in community) and install build deps + Firefox
RUN echo "https://dl-cdn.alpinelinux.org/alpine/v3.22/community" >> /etc/apk/repositories \
    && apk update \
    && apk add --no-cache \
        build-base \
        expat \
        tiff \
        firefox

# Install global npm packages
RUN npm install -g @nestjs/cli pm2@latest

# Install npm@11.7.0 then patch its bundled tar to 7.5.7 (CVE-2026-23745, 23950, 24842)
RUN npm install -g npm@11.7.0 \
    && cd "$(npm root -g)/npm/node_modules" \
    && rm -rf tar \
    && wget -q https://registry.npmjs.org/tar/-/tar-7.5.7.tgz -O tar.tgz \
    && mkdir -p tar && tar -xzf tar.tgz --strip-components=1 -C tar \
    && rm tar.tgz

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
