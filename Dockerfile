# Stage 1: Build the application artifacts
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Production image with only runtime dependencies
FROM node:22-alpine AS production
WORKDIR /app

# Copy package files and install only production dependencies
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy built artifacts and demo files
COPY --from=build /app/build ./build
COPY --from=build /app/demo ./demo

# Expose the default port
EXPOSE 8082

# Set environment variable for port (can be overridden)
ENV PORT=8082

CMD ["npm", "run", "demo:server"]
