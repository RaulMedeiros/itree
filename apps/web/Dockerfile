# Build a partir da raiz do monorepo: docker build -f apps/web/Dockerfile .
FROM node:22-slim AS build
RUN npm install -g pnpm@10.28.0
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/api-client/package.json packages/api-client/
COPY packages/domain/package.json packages/domain/
COPY packages/ui-tokens/package.json packages/ui-tokens/
RUN pnpm install --frozen-lockfile
COPY apps/web apps/web
COPY packages packages
RUN pnpm --filter @itree/web build

FROM nginx:1.29-alpine
ENV ITREE_API_UPSTREAM=api:8000
COPY apps/web/docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY apps/web/docker/40-config-itree.sh /docker-entrypoint.d/40-config-itree.sh
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
# O nginx roda como root só para abrir a porta; workers rodam como "nginx".
RUN chown nginx /usr/share/nginx/html/config.js
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
