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
# --base-href is REQUIRED: this UI is served under /character-forge/ behind the
# fe-gateway. Without it Angular emits ROOT-relative asset URLs, so loading
# /character-forge/ fetches /styles-*.css from the gateway root, gets the
# shell's HTML back, and the remote renders BLANK — it only works when opened
# at the container's own address (operator report, 2026-08-14). The
# generator's .stack-src tree carried this as an UNCOMMITTED local edit;
# committed here so a clean clone builds a working image.
RUN npm run build:character-forge -- --base-href=/character-forge/

# ---- serve ----
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/character-forge/browser /usr/share/nginx/html
EXPOSE 8080

#### Runtime THEME injection (the fleet-wide login-ui 50-hug-theme.sh
#### mechanism; see hugmesh-host-shell PR #11 for the full rationale). The hook
#### writes $SNAP_THEME_CSS verbatim at container start; nginx serves it via
#### the exact-match /hug-theme.css alias. /tmp, NOT the docroot: on the
#### nginx-unprivileged images uid 101 cannot write the docroot, and on the
#### root images /tmp is equally correct — ONE stanza for the whole fleet.
#### COPY --chmod, NOT COPY + RUN chmod: unprivileged final stages run as
#### uid 101 and a RUN chmod on root-owned COPY output exits 1 (BuildKit is
#### always on for this stack: Makefile DOCKER_BUILDKIT=1).
COPY --chmod=0755 docker-entrypoint.d/50-hug-theme.sh /docker-entrypoint.d/50-hug-theme.sh
ENV HUG_THEME_OUT=/tmp/hug-theme.css
