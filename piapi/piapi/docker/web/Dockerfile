FROM node:22-bookworm-slim AS builder

WORKDIR /app/client

COPY client/package*.json ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

COPY client/tsconfig.json client/tsconfig.node.json client/vite.config.ts client/index.html ./
COPY client/src ./src

RUN npm run build

FROM nginx:1.27-alpine AS runtime

RUN rm -f /etc/nginx/conf.d/default.conf
COPY docker/web/nginx.conf /etc/nginx/conf.d/piapi.conf
COPY --from=builder /app/client/dist /usr/share/nginx/html

EXPOSE 80

# 127.0.0.1 rather than localhost: busybox wget resolves localhost to ::1 first
# and, unlike curl, never falls back to IPv4.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
