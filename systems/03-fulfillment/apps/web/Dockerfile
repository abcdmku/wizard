FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY systems/03-fulfillment/packages/contracts ./systems/03-fulfillment/packages/contracts
COPY systems/03-fulfillment/apps/web ./systems/03-fulfillment/apps/web
RUN corepack enable && pnpm install --filter @openwizard/fulfillment-web --frozen-lockfile
ARG VITE_API_MODE=live
ARG VITE_API_BASE_URL=/api
ENV VITE_API_MODE=$VITE_API_MODE
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm --filter @openwizard/fulfillment-web build

FROM nginx:1.29-alpine
COPY systems/03-fulfillment/apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/systems/03-fulfillment/apps/web/dist /usr/share/nginx/html
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
