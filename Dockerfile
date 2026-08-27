# Node 22 per .nvmrc — better-sqlite3's native binding must be built inside this image, not
# copied from the host, or it crashes at the first DB-backed route (see CLAUDE.md).
#
# ponytail: single-stage, not multi-stage — image size isn't a stated requirement for a demo;
# revisit if Railway build/push time becomes a real problem.
FROM node:22-bookworm-slim
WORKDIR /app
# better-sqlite3 has no prebuilt binary for every image arch (confirmed missing on
# linux/arm64, which is what a build run on Apple Silicon produces) — node-gyp falls back to
# compiling from source, and the slim base ships neither Python nor a C++ toolchain for that.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# postinstall (below, via `npm ci`) runs scripts/copy-cesium-assets.mjs — it has to exist
# before npm ci fires, not just before the app build.
COPY scripts ./scripts
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
