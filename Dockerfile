# ---- Build the web app ----
FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN npm run build

# ---- Build the API ----
FROM node:22-bookworm-slim AS api
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
# --ignore-scripts: skip ffmpeg-static's download, the runtime image uses Debian's ffmpeg.
RUN npm ci --ignore-scripts
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

# ---- Runtime ----
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    WEB_DIST_DIR=/app/dist
WORKDIR /app/server
COPY --from=api /app/server/node_modules ./node_modules
COPY --from=api /app/server/dist ./dist
COPY --from=api /app/server/package.json ./
COPY --from=web /app/dist /app/dist
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "dist/index.js"]
