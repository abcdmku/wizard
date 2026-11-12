FROM node:22-alpine AS dependencies
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.source.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/drizzle/package.json packages/drizzle/package.json
COPY packages/durable/package.json packages/durable/package.json
COPY systems/04-dungeon/shared/package.json systems/04-dungeon/shared/package.json
COPY systems/04-dungeon/server/package.json systems/04-dungeon/server/package.json
RUN pnpm install --frozen-lockfile --prod=false

FROM dependencies AS build
COPY packages/core/src packages/core/src
COPY packages/core/tsconfig.json packages/core/tsdown.config.ts packages/core/
COPY packages/durable/src packages/durable/src
COPY packages/durable/tsconfig.json packages/durable/tsdown.config.ts packages/durable/
COPY packages/drizzle/src packages/drizzle/src
COPY packages/drizzle/tsconfig.json packages/drizzle/tsdown.config.ts packages/drizzle/
COPY systems/04-dungeon/shared/src systems/04-dungeon/shared/src
COPY systems/04-dungeon/shared/tsconfig.json systems/04-dungeon/shared/vitest.config.ts systems/04-dungeon/shared/
COPY systems/04-dungeon/server/src systems/04-dungeon/server/src
COPY systems/04-dungeon/server/tests systems/04-dungeon/server/tests
COPY systems/04-dungeon/server/migrations systems/04-dungeon/server/migrations
COPY systems/04-dungeon/server/tsconfig.json systems/04-dungeon/server/
RUN pnpm --filter @openwizard/core build \
  && pnpm --filter @openwizard/durable build \
  && pnpm --filter @openwizard/drizzle build \
  && pnpm --filter @wizard/dungeon-shared build \
  && pnpm --filter @wizard/dungeon-server typecheck

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
USER node
EXPOSE 8080
CMD ["node", "--import", "tsx", "systems/04-dungeon/server/src/main.ts"]
