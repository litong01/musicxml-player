# Stage 1: Build the application artifacts
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build

CMD ["npm", "run", "demo:server"]
