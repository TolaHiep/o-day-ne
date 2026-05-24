# ---- Stage 1: build Vite bundle + install production deps ----
FROM node:20-alpine AS builder
WORKDIR /app

# python3/make/g++ only needed when a prebuilt musl binary of better-sqlite3
# isn't available for the current Node version. Builder stage drops these
# tools before runtime image, so image size stays small.
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# Frontend sources + configs (vite reads frontend/vite.config.ts; outputs dist/)
COPY tsconfig.json ./
COPY frontend ./frontend
RUN npm run build

RUN npm prune --omit=dev

# ---- Stage 2: runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=4174 \
    API_PORT=8788 \
    BIND_HOST=0.0.0.0

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY backend ./backend
# Include the data pipeline so operators can run `docker exec o-day-ne
# node pipeline/scripts/sync-sheet-to-db.mjs --write` against the container's
# data volume. No runtime deps — pipeline uses only node:* built-ins +
# better-sqlite3 (already a runtime dep for the API).
COPY pipeline ./pipeline
COPY package.json ./

RUN mkdir -p /app/backend/data && chown -R node:node /app

USER node

EXPOSE 4174

VOLUME ["/app/backend/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1

CMD ["node", "backend/src/docker-entry.mjs"]
