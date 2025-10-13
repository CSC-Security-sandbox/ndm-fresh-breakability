FROM public.ecr.aws/docker/library/node:22.19.0-trixie-slim

# Install system dependencies and build tools first
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    build-essential \
    equivs \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Create virtual packages and install patched libraries from source
# Fix CVE-2025-59375 (libexpat1) and CVE-2025-9900 (libtiff6)
RUN ARCH=$(dpkg --print-architecture) \
    && if [ "$ARCH" = "amd64" ]; then LIBDIR="/lib/x86_64-linux-gnu"; else LIBDIR="/lib/aarch64-linux-gnu"; fi \
    && printf "Package: libexpat1\nVersion: 2.7.3-1override\nArchitecture: %s\nMaintainer: Security Fix <security@example.com>\nDescription: Virtual libexpat1 package - replaced by compiled 2.7.3\n This virtual package satisfies libexpat1 dependencies while\n the actual library is provided by source compilation.\nProvides: libexpat1\nReplaces: libexpat1\nConflicts: libexpat1\n" "$ARCH" > /tmp/libexpat1-virtual \
    && printf "Package: libtiff6\nVersion: 4.7.1-1override\nArchitecture: %s\nMaintainer: Security Fix <security@example.com>\nDescription: Virtual libtiff6 package - replaced by compiled 4.7.1\n This virtual package satisfies libtiff6 dependencies while\n the actual library is provided by source compilation.\nProvides: libtiff6\nReplaces: libtiff6\nConflicts: libtiff6\n" "$ARCH" > /tmp/libtiff6-virtual \
    && cd /tmp && equivs-build libexpat1-virtual && equivs-build libtiff6-virtual \
    && dpkg -i libexpat1_*.deb libtiff6_*.deb \
    && wget https://github.com/libexpat/libexpat/releases/download/R_2_7_3/expat-2.7.3.tar.xz \
    && wget https://download.osgeo.org/libtiff/tiff-4.7.1.tar.xz \
    && tar -xf expat-2.7.3.tar.xz && cd expat-2.7.3 \
    && ./configure --prefix=/usr --libdir="$LIBDIR" \
    && make -j"$(nproc)" && make install && ldconfig \
    && cd /tmp && tar -xf tiff-4.7.1.tar.xz && cd tiff-4.7.1 \
    && ./configure --prefix=/usr --libdir="$LIBDIR" \
    && make -j"$(nproc)" && make install && ldconfig \
    && cd / && rm -rf /tmp/expat* /tmp/libexpat* /tmp/tiff* /tmp/libtiff* \
    && apt-get purge -y build-essential equivs && apt-get autoremove -y

# Install remaining system dependencies including Firefox ESR
RUN apt-get update && apt-get install -y \
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