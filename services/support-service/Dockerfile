FROM public.ecr.aws/docker/library/node:22.19.0-trixie-slim

RUN apt-get update \
    && apt update -y \
    && apt-get install -y ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @nestjs/cli pm2@latest

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
COPY entrypoint.sh .

RUN npm run build

RUN chmod +x /app/entrypoint.sh
EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]