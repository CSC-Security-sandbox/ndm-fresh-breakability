# Build stage
FROM public.ecr.aws/docker/library/node:20-bullseye-slim AS builder

RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y ca-certificates && \
    npm i -g @nestjs/cli && \
    rm -rf /var/lib/apt/lists/*

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

FROM public.ecr.aws/docker/library/alpine:3.22.0

RUN apk update && \
    apk upgrade --no-cache --purge && \
    apk add --no-cache \
    npm \
    nodejs \
    ca-certificates && \
    npm i -g pm2@latest && \
    rm -vrf /var/cache/apk/*

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

COPY entrypoint.sh .
RUN chmod +x /app/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]