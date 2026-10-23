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
# NEXT_PUBLIC_* is inlined into the client bundle at build time, and .dockerignore keeps .env*
# out of the image — so these must arrive as --build-arg or the deployed app links back to
# localhost:3000 (share links, metadata), the Satellite engine has no Cesium token, and Clerk's
# browser side never mounts (accounts off). Clerk's secret key and webhook secret are runtime-only
# and stay out of the image.
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_CESIUM_ION_TOKEN
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
# PostHog (analytics for consenting testers): the key and host are baked into the client bundle, and
# the host also shapes the Content-Security-Policy in next.config.ts, so they are needed here and
# not just at runtime. Unset key means analytics is off.
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_PRIVACY_CONTACT
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_CESIUM_ION_TOKEN=$NEXT_PUBLIC_CESIUM_ION_TOKEN \
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
    NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY \
    NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST \
    NEXT_PUBLIC_PRIVACY_CONTACT=$NEXT_PUBLIC_PRIVACY_CONTACT
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
