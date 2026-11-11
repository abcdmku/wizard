FROM node:22-alpine
RUN corepack enable
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @openwizard/core --filter @openwizard/durable --filter @openwizard/drizzle build
WORKDIR /workspace/systems/03-fulfillment
EXPOSE 3001
CMD ["pnpm", "--filter", "@fulfillment/orchestrator", "start"]
