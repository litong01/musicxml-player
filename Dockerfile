# Stage 1: Build the application artifacts
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Capture git hash at build time
ARG BUILD_VERSION
RUN if [ -z "$BUILD_VERSION" ]; then \
      BUILD_VERSION=$(git rev-parse --short HEAD 2>/dev/null || date +%s); \
      echo "$BUILD_VERSION" > /app/BUILD_VERSION; \
    else \
      echo "$BUILD_VERSION" > /app/BUILD_VERSION; \
    fi

# Stage 2: Production image with only runtime dependencies
FROM node:22-alpine AS production
WORKDIR /app

# Copy package files and install only production dependencies
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy built artifacts and demo files
COPY --from=build /app/build ./build
COPY --from=build /app/demo ./demo
COPY --from=build /app/BUILD_VERSION ./BUILD_VERSION

# Set BUILD_VERSION from file at runtime
RUN BUILD_VERSION=$(cat BUILD_VERSION) && echo "export BUILD_VERSION=${BUILD_VERSION}" >> /etc/profile

# Expose the default port
EXPOSE 8082

# Set environment variables (these can be overridden at runtime)
ENV PORT=8082
ENV KINDE_CLIENT_ID=""
ENV KINDE_DOMAIN=""
ENV KINDE_AUDIENCE=""

# Copy startup script
COPY demo/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "run", "demo:server"]
