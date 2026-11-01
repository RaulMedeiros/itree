# Build a partir da raiz do monorepo: docker build -f apps/web/Dockerfile .
FROM node:26-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39 AS build
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

FROM nginx:1.29-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de
ENV ITREE_API_UPSTREAM=api:8000
# Origens extras liberadas na CSP para imagens, conexões e iframes (provedor OIDC,
# armazenamento S3, servidores de mapa base). Separe por espaço.
ENV ITREE_CSP_ORIGENS="https:"
COPY apps/web/docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY apps/web/docker/40-config-itree.sh /docker-entrypoint.d/40-config-itree.sh
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
# O nginx roda como root só para abrir a porta; workers rodam como "nginx".
RUN chown nginx /usr/share/nginx/html/config.js
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
