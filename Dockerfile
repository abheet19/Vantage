# Dockerfile — one image that runs the whole Vantage web app behind one port.
#
# Stage 1 builds the API (apps/api) and the web dashboard (apps/web) from source. Stage 2 is a slim
# runtime holding the built dist, the production node_modules, the migrations and the fixture, plus a
# static Caddy binary lifted from caddy:2-alpine. At runtime docker-entrypoint.sh starts the NestJS API on
# loopback (VANTAGE_BIND=127.0.0.1 ⟨D4⟩) and hands PID 1 to Caddy, which serves the SPA and reverse-proxies
# /v1/* and /health to the API. Only Caddy's port is ever published.

# ---- build ----------------------------------------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /repo

# Install with the lockfile first, using only the manifests, so the dep layer caches across source edits.
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --legacy-peer-deps

# Build the API (tsc -b contracts + api) and the web bundle (vite build → apps/web/dist).
COPY . .
RUN npm run build && npm run web:build

# Drop devDependencies so the runtime carries only what `node dist/*.js` needs.
RUN npm prune --omit=dev --legacy-peer-deps

# ---- caddy binary ---------------------------------------------------------------------------------
FROM caddy:2-alpine AS caddy

# ---- runtime --------------------------------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app
ARG VANTAGE_RELEASE_SHA=""
ENV NODE_ENV=production \
    VANTAGE_RELEASE_SHA=$VANTAGE_RELEASE_SHA
LABEL org.opencontainers.image.revision=$VANTAGE_RELEASE_SHA

# The static Caddy binary (no Alpine runtime needed — it is statically linked).
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy

# Pruned production dependencies (incl. the @vantage/contracts workspace symlink → packages/contracts) and
# the built app: API dist + migrations + fixture, contracts dist, and the web bundle Caddy serves.
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/api ./apps/api
COPY --from=build /repo/apps/web/dist ./apps/web/dist
COPY --from=build /repo/package.json ./package.json

# The edge config and the launcher.
COPY Caddyfile /etc/caddy/Caddyfile
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Loopback API (unchanged ⟨D4⟩) on 4100; Caddy on 8080 is the only published surface.
ENV VANTAGE_BIND=127.0.0.1 \
    VANTAGE_PORT=4100 \
    PORT=8080
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
