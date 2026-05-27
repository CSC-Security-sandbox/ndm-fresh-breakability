FROM public.ecr.aws/docker/library/alpine:3.22.0

RUN apk update && \
    apk upgrade --no-cache --purge && \
    apk add --no-cache npm nodejs nfs-utils cifs-utils krb5 && \
    rm -vrf /var/cache/apk/* && \
    npm i -g @nestjs/cli && \
    npm i -g pm2@latest

WORKDIR /app

# Workspace root manifest and lock file
COPY package.json package-lock.json ./

# Internal libs (source — compiled inside Docker by build:libs)
COPY lib/ ./lib/

# This service
COPY services/jobs-service/ ./services/jobs-service/

RUN --mount=type=secret,id=git_token \
    printf "@netapp-cloud-datamigrate:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=$(cat /run/secrets/git_token)\n" > .npmrc && \
    npm install && \
    rm -f .npmrc

RUN npm run build:libs && \
    npm run build --workspace=services/jobs-service && \
    npm uninstall -g @nestjs/cli

# Run from the service directory so dist/main.js resolves correctly
WORKDIR /app/services/jobs-service

EXPOSE 3000

RUN chmod +x /app/services/jobs-service/entrypoint.sh
ENTRYPOINT ["/app/services/jobs-service/entrypoint.sh"]
