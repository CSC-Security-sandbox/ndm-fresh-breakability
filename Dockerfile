FROM node:22-alpine AS production

# Set the working directory
WORKDIR /app

COPY . .

RUN npm install

# Build the application
RUN npm run build

# Expose the port
EXPOSE 3000

# Copy entrypoint script and set permissions
COPY entrypoint.sh /entrypoint.sh
# RUN chmod +x /entrypoint.sh

# Set the entrypoint and default command
ENTRYPOINT ["/entrypoint.sh"]
CMD ["npm", "run", "start:prod"]
