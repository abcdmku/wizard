FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.19.0 --activate
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/tsconfig.json packages/core/tsdown.config.ts ./packages/core/
COPY packages/http/package.json ./packages/http/package.json
COPY systems/02-fleet/packages/shared/package.json ./systems/02-fleet/packages/shared/package.json
COPY systems/02-fleet/apps/web/package.json ./systems/02-fleet/apps/web/package.json
RUN pnpm install --frozen-lockfile --prod=false
COPY systems/02-fleet/packages/shared/src ./systems/02-fleet/packages/shared/src
COPY systems/02-fleet/packages/shared/tsconfig.json ./systems/02-fleet/packages/shared/tsconfig.json
COPY packages/core/src ./packages/core/src
RUN pnpm --filter @openwizard/core build
COPY packages/http/src/client.ts packages/http/src/sse.ts ./packages/http/src/
COPY systems/02-fleet/apps/web/index.html ./systems/02-fleet/apps/web/index.html
COPY systems/02-fleet/apps/web/public ./systems/02-fleet/apps/web/public
COPY systems/02-fleet/apps/web/src ./systems/02-fleet/apps/web/src
COPY systems/02-fleet/apps/web/tsconfig.json ./systems/02-fleet/apps/web/tsconfig.json
COPY systems/02-fleet/apps/web/vite.config.ts ./systems/02-fleet/apps/web/vite.config.ts
RUN pnpm --filter @openwizard/fleet-web build

FROM nginx:1.27-alpine

ENV FLEET_API_UPSTREAM=http://fleet-api:8787 \
    FLEET_API_URL=/api \
    NGINX_ENVSUBST_FILTER=FLEET_API_UPSTREAM

COPY systems/02-fleet/apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY systems/02-fleet/apps/web/docker/40-fleet-config.sh /docker-entrypoint.d/40-fleet-config.sh
COPY --from=build /workspace/systems/02-fleet/apps/web/dist /usr/share/nginx/html

RUN chmod +x /docker-entrypoint.d/40-fleet-config.sh

EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
