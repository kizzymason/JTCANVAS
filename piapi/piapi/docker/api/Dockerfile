# Ships Chromium plus every shared library Playwright needs; the tag must track
# the `playwright` version in server/package.json or the browser will not launch.
FROM mcr.microsoft.com/playwright:v1.62.1-noble AS base

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      xvfb \
      x11vnc \
      novnc \
      websockify \
      supervisor \
      fluxbox \
      curl \
 && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------- build stage
FROM base AS builder

WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

# ------------------------------------------------------------------ runtime
FROM base AS runtime

ENV NODE_ENV=production \
    IN_CONTAINER=1 \
    PORT=3001 \
    DATA_DIR=/data \
    DISPLAY=:99 \
    SCREEN_GEOMETRY=1440x900x24

WORKDIR /app/server

COPY server/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

COPY --from=builder /app/server/dist ./dist

RUN mkdir -p /data/screenshots /data/browser-profile

COPY docker/api/supervisord.conf /etc/supervisor/conf.d/piapi.conf
COPY docker/api/entrypoint.sh /usr/local/bin/entrypoint.sh
# The repo is edited on Windows; CRLF in a shebang makes the kernel look for `bash\r`.
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh /etc/supervisor/conf.d/piapi.conf \
 && chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3001 6080

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD curl -fsS http://127.0.0.1:3001/health || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["supervisord", "-c", "/etc/supervisor/conf.d/piapi.conf", "-n"]
