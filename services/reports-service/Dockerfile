FROM public.ecr.aws/docker/library/alpine:3.22.0

# Install required packages
RUN apk update && \
    apk upgrade --no-cache --purge && \
    apk add --no-cache \
    npm \
    nodejs \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont && \
    npm i -g pm2@latest && \
    npm i -g @nestjs/cli && \
    rm -vrf /var/cache/apk/*

# Set environment variables
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
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
