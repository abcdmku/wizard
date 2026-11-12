FROM node:22-alpine

RUN corepack enable
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json tsconfig.source.json ./
COPY packages ./packages
COPY systems/01-intake ./systems/01-intake

RUN pnpm install --frozen-lockfile --filter @openwizard/system-01-intake... \
  && pnpm --filter @openwizard/core build \
  && pnpm --filter @openwizard/durable build \
  && pnpm --filter @openwizard/drizzle build

EXPOSE 4310
CMD ["pnpm", "--filter", "@openwizard/system-01-intake", "exec", "tsx", "api/main.ts"]
