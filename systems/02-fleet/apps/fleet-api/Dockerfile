FROM node:22-alpine AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY systems/02-fleet ./systems/02-fleet
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @openwizard/core build \
  && pnpm --filter @openwizard/durable build \
  && pnpm --filter @openwizard/drizzle build \
  && pnpm --filter @openwizard/effect build \
  && pnpm --filter @openwizard/fleet-shared build \
  && pnpm --filter @openwizard/fleet-api build

FROM node:22-alpine AS runtime
WORKDIR /workspace
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /workspace/package.json /workspace/pnpm-lock.yaml /workspace/pnpm-workspace.yaml ./
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/packages ./packages
COPY --from=build /workspace/systems/02-fleet/apps/fleet-api ./systems/02-fleet/apps/fleet-api
COPY --from=build /workspace/systems/02-fleet/packages/shared ./systems/02-fleet/packages/shared
EXPOSE 8787
CMD ["node", "systems/02-fleet/apps/fleet-api/dist/main.mjs"]
