FROM node:22-alpine AS build

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.source.json ./
COPY packages/core/package.json packages/core/tsconfig.json packages/core/tsdown.config.ts ./packages/core/
COPY packages/core/src ./packages/core/src
COPY packages/http/package.json packages/http/tsconfig.json packages/http/tsdown.config.ts ./packages/http/
COPY packages/http/src ./packages/http/src
COPY systems/01-intake/shared ./systems/01-intake/shared
COPY systems/01-intake/web ./systems/01-intake/web

ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN pnpm install --frozen-lockfile --filter @openwizard/intake-web...
RUN pnpm --filter @openwizard/core build
RUN pnpm --filter @openwizard/http build
RUN pnpm --filter @openwizard/intake-web build

FROM nginx:1.27-alpine

COPY systems/01-intake/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/systems/01-intake/web/dist /usr/share/nginx/html

EXPOSE 3000
