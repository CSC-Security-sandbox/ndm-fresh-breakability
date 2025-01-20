FROM public.ecr.aws/docker/library/alpine:3.21.0 


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
    rm -vrf /var/cache/apk/* && \
    npm i -g @nestjs/cli && \
    npm i -g pm2@latest 


ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

COPY ["package.json", "./"]
COPY [".npmrc", "./"]
RUN npm install 
RUN rm -f ./.npmrc

COPY ./src ./src
COPY tsconfig.json .
COPY tsconfig.build.json .
COPY nest-cli.json .
COPY entrypoint.sh .

RUN npm run build 

EXPOSE 3000

RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
