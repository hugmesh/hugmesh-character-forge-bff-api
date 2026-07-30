# Character Forge — native-federation remote, served as a static bundle.
# Mirrors the org's micro-frontend serving pattern (nginx-unprivileged :8080),
# cloned from hugmesh-character-studio-ui/Dockerfile. Built + deployed only
# when the OPTIONAL character-forge mesh feature is enabled.
#
# The Godot web export (src/assets/game/index.{js,pck,wasm,...}) is baked into
# src/assets/game/ BEFORE this image builds (orchestrator/CI export step); the
# page boots fine without it and shows the "engine bundle not present" panel.

# ---- build ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build:character-forge

# ---- serve ----
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/character-forge/browser /usr/share/nginx/html
EXPOSE 8080
