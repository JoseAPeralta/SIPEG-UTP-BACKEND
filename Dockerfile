# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24.21.0
ARG PNPM_VERSION=12.4.2

FROM node:${NODE_VERSION}-slim AS base
ARG PNPM_VERSION
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS prod-deps
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM deps AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.build.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
RUN pnpm run prisma:generate
RUN pnpm run build

FROM deps AS dev
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node --chmod=644 package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json prisma.config.ts ./
COPY --chown=node:node prisma ./prisma
ENV NODE_ENV=development
USER node
RUN pnpm --version
EXPOSE 3000
CMD ["sh", "-c", "pnpm run prisma:generate && pnpm run dev"]

FROM deps AS migrate
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node --chmod=644 package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY --chown=node:node prisma ./prisma
ENV NODE_ENV=production
USER node
RUN pnpm --version
ENTRYPOINT ["pnpm", "exec", "prisma"]
CMD ["migrate", "deploy"]

FROM node:${NODE_VERSION}-slim AS runtime
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3000

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "const port = process.env.PORT || 3000; fetch('http://127.0.0.1:' + port + '/api/v1/health').then((res) => { if (!res.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["node", "dist/server.js"]
