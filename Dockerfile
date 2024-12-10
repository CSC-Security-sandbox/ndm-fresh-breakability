FROM public.ecr.aws/docker/library/alpine:3.21.0 

RUN apk update && \
    apk upgrade --no-cache --purge && \
    apk add --no-cache npm nodejs && \
    rm -vrf /var/cache/apk/* && \
    npm i -g @nestjs/cli && \
    npm i -g pm2@latest 

WORKDIR /app

COPY ["package.json", "./"]
COPY [".npmrc", "./"]
RUN npm install 
RUN rm -f ./.npmrc

COPY ./src .
COPY tsconfig.json .
COPY tsconfig.build.json .
COPY nest-cli.json .
        
RUN npm run build 

EXPOSE 3000

CMD [ "pm2", "start", "dist/main.js", "--name", "admin-service", "--watch",  "--ignore-watch", "node_modules", "--no-daemon"]
