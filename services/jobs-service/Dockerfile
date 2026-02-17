FROM public.ecr.aws/docker/library/alpine:3.22.0

RUN apk update && \
    apk upgrade --no-cache --purge && \
    apk add --no-cache npm nodejs nfs-utils cifs-utils && \
    rm -vrf /var/cache/apk/* && \
    npm i -g @nestjs/cli && \
    npm i -g pm2@latest 

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