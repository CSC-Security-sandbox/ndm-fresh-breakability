FROM public.ecr.aws/docker/library/node:22.19.0-trixie-slim

# Install system dependencies for NFS
RUN apt-get update && apt-get install -y \
    nfs-common \
    cifs-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Install global npm packages
RUN npm install -g @nestjs/cli pm2@latest

WORKDIR /app

COPY ["package.json", "./"]
COPY [".npmrc", "./"]

RUN --mount=type=secret,id=git_token \
    GITOPS_USER_GITHUB_TOKEN=$(cat /run/secrets/git_token) npm install \
    && rm -f ./.npmrc

COPY ./src ./src
COPY tsconfig.json .
COPY tsconfig.build.json .
COPY nest-cli.json .

RUN npm run build

EXPOSE 3000

COPY entrypoint.sh .
RUN chmod +x /app/entrypoint.sh
ENTRYPOINT ["/app/entrypoint.sh"]