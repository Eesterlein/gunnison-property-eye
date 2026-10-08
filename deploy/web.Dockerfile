# Builds the React app, then serves it (and proxies the API/tiles) with Caddy.
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_DEMO_MODE=false
# Same-origin URLs: Caddy routes /api to the backend and /tipg to the tile server
ENV VITE_API_URL="" VITE_TIPG_URL="/tipg/api" VITE_DEMO_MODE=${VITE_DEMO_MODE}
RUN npm run build

FROM caddy:2.8
COPY --from=build /app/dist /srv
