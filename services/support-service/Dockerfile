FROM public.ecr.aws/docker/library/node:20-bullseye-slim

RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y ca-certificates && \
    npm i -g @nestjs/cli && \
    npm i -g pm2@latest && \
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

EXPOSE 3000

COPY entrypoint.sh .
RUN chmod +x /app/entrypoint.sh
ENTRYPOINT ["/app/entrypoint.sh"]