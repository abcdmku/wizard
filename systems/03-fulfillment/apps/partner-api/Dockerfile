FROM node:22-alpine
RUN corepack enable
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile
WORKDIR /workspace/systems/03-fulfillment
EXPOSE 3002
CMD ["pnpm", "--filter", "@fulfillment/partner-api", "start"]
