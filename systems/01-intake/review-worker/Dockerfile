FROM node:22-alpine

RUN corepack enable
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json tsconfig.source.json ./
COPY packages/core/package.json packages/core/tsconfig.json packages/core/tsdown.config.ts ./packages/core/
COPY packages/core/src ./packages/core/src
COPY packages/durable/package.json packages/durable/tsconfig.json packages/durable/tsdown.config.ts ./packages/durable/
COPY packages/durable/src ./packages/durable/src
COPY packages/drizzle/package.json packages/drizzle/tsconfig.json packages/drizzle/tsdown.config.ts ./packages/drizzle/
COPY packages/drizzle/src ./packages/drizzle/src
COPY systems/01-intake/package.json systems/01-intake/tsconfig.json ./systems/01-intake/
COPY systems/01-intake/shared ./systems/01-intake/shared
COPY systems/01-intake/api/db ./systems/01-intake/api/db
COPY systems/01-intake/api/worker ./systems/01-intake/api/worker
COPY systems/01-intake/review-worker ./systems/01-intake/review-worker

RUN pnpm install --frozen-lockfile \
  --filter @openwizard/system-01-intake... \
  --filter @openwizard/intake-review-worker... \
  && pnpm --filter @openwizard/core build \
  && pnpm --filter @openwizard/durable build \
  && pnpm --filter @openwizard/drizzle build

EXPOSE 4320
CMD ["pnpm", "--dir", "systems/01-intake/review-worker", "start"]
