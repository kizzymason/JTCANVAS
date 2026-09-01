# 依赖安装阶段：isolated-vm 需要 C++ 工具链，构建完成后不会进入运行镜像。
FROM node:24-bookworm-slim AS deps

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY server/package.json server/package-lock.json ./
RUN npm install

FROM deps AS build
COPY server/tsconfig.json server/tsconfig.build.json ./
COPY server/src ./src
RUN npm run build

# 运行阶段：只带生产依赖与编译产物。
FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

# sharp 与 isolated-vm 的运行时依赖。
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server/package.json ./package.json
# 迁移 SQL 不经过 tsc，需要单独复制。
COPY server/src/db/migrations ./dist/db/migrations

RUN mkdir -p /data/storage && chown -R node:node /data
USER node

EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD curl -fsS http://127.0.0.1:4000/api/health || exit 1

CMD ["node", "dist/main.js"]
