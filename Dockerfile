FROM node:22-alpine As production
# RUN npm config set @keystone:registry=https://artifactory.asurint.net/artifactory/api/npm/npm/
RUN apk update \
    && apk upgrade --no-cache --purge
 
WORKDIR /app
 
COPY . .

COPY entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/entrypoint.sh
#COPY ["package.json", "package-lock.json*", "./"]
 
RUN npm install
 
RUN npm run build
 
EXPOSE 3000
 
# Start the server using the production build
# CMD [ "node", "dist/main.js" ]
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["npm", "run", "start:prod"]