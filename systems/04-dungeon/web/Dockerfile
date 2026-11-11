FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY systems/04-dungeon/shared ./systems/04-dungeon/shared
COPY systems/04-dungeon/web ./systems/04-dungeon/web
RUN pnpm install --frozen-lockfile --filter @wizard/dungeon-web...
ARG VITE_WS_URL=/ws
ENV VITE_WS_URL=$VITE_WS_URL
RUN pnpm --filter @wizard/dungeon-web build

FROM nginx:1.27-alpine
COPY systems/04-dungeon/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/systems/04-dungeon/web/dist /usr/share/nginx/html
EXPOSE 80
