FROM node:20-alpine

# Set environment
ENV NODE_ENV=production
WORKDIR /usr/src/app

# Copy dependency configs
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application source
COPY server.js ./
COPY middleware/ ./middleware/
COPY services/ ./services/
COPY public/ ./public/
COPY venue.config.json ./

# Expose port
EXPOSE 8080

# Run application
CMD [ "npm", "start" ]
