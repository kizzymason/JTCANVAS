# infinite-canvas server

商业化后端：账号体系、余额钱包、按量计费，以及全部 AI 生成的服务端代理。

前端不再直连任何第三方 AI 接口，也不再持有任何第三方 API Key。所有生成请求先在这里鉴权、估价、冻结余额，再由独立的 worker 进程调用上游。

## 技术栈

- **NestJS 11 + Fastify 适配器** —— 按领域拆模块，Guard/Interceptor 承载鉴权、限流、幂等与审计
- **Drizzle ORM + PostgreSQL 16** —— 钱包需要 `SELECT ... FOR UPDATE` 与 `NUMERIC` 的 SQL 侧运算
- **Redis 7 + BullMQ** —— 任务队列、会话、价格表缓存、分布式限流、文本 SSE 的 pub/sub 桥接
- **对象存储双驱动** —— S3 兼容 或 本机磁盘，由管理后台切换
- **isolated-vm** —— 管理员自定义脚本的沙箱，只在 worker 进程执行

## 进程拆分

| 进程 | 入口 | 职责 |
| --- | --- | --- |
| API | `src/main.ts` | 鉴权、估价、冻结余额、入队、读写业务数据 |
| worker | `src/worker.ts` | 调用上游 provider、落盘结果、结算余额、定时维护 |

拆开的原因：视频任务的上游轮询可能持续数十分钟，放在 API 进程里会占满请求处理能力；同时让第三方密钥只在 worker 内存中出现，用户请求永远碰不到。

## 本地开发

```bash
cd server
npm install

# 启动依赖服务（Postgres 5442 / Redis 6389 / MinIO 9010，端口特意避开常用值）
docker compose -f docker-compose.dev.yml up -d postgres redis

cp .env.example .env
# 生成加密主密钥并填入 APP_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

npm run db:migrate      # 应用数据库迁移
npm run dev             # API，默认 4000
npm run dev:worker      # worker，另开一个终端
```

第一个注册的账号会自动成为管理员，因此全新部署不需要额外的初始化脚本。需要补建或重置管理员时：

```bash
npm run seed:admin -- <username> <password>
```

## 常用命令

```bash
npm run dev          # API（nest start --watch）
npm run dev:worker   # worker
npm run build        # 编译到 dist
npm run typecheck    # tsc --noEmit
npm run db:generate  # 按 schema 变更生成迁移
npm run db:migrate   # 应用迁移
npm run test         # vitest（钱包测试需要 Postgres 在跑）
```

> `npm run dev` 用 `nest start`（tsc）而不是 tsx。esbuild 不产出 `emitDecoratorMetadata`，NestJS 的依赖注入会因此拿不到构造参数类型。

## 目录结构

```
src/
  common/          金额工具、错误、装饰器、Guard、Interceptor
  config/          环境变量加载与启动期校验
  db/              Drizzle schema、迁移、迁移执行器
  redis/           Redis 连接（普通连接 + 订阅连接）
  modules/
    auth/          注册登录、会话
    wallet/         钱包、账本、卡密
    pricing/        渠道模型价格与估价
    generation/     任务提交、队列、provider adapter、脚本沙箱
    storage/        对象存储双驱动、缩略图派生
    projects/       画布
    assets/         素材
    admin/          管理后台接口
    audit/          审计日志
    settings/       站点与存储设置
    maintenance/    定时任务（孤儿文件回收、超时释放、对账）
```

## 金额与计费

- 金额一律 `NUMERIC(18,6)`，单位人民币元。数据库不允许出现浮点列。
- 余额加减只在 SQL 表达式里做，JS 侧用 `decimal.js` 仅做比较与展示。
- 钱包变动必须在事务内先 `SELECT ... FOR UPDATE` 锁行；`wallets.balance` 带 `CHECK (balance >= 0)` 兜底。
- 计费为冻结-结算-退款三段式：提交冻结估价，成功按实际用量结算，失败全额释放。**失败不计费。**
- 账本 append-only，且满足 `sum(wallet_ledger.amount) == wallets.balance`，由 `reconcile` 校验。
- 生成提交与卡密兑换要求 `Idempotency-Key`，重复请求返回首次结果而不是再扣一次。

## 安全

- 渠道 apiKey、S3 secret 均 AES-256-GCM 加密入库，表内带 `key_id` 支持轮换（`APP_ENCRYPTION_KEY_OLD_<id>` 保留旧密钥的解密能力）。接口只回传掩码。
- 管理员脚本在 `isolated-vm` 独立 isolate 中执行，限制内存与执行时长，出网走受控 shim 并对域名做白名单。禁止 `eval` / `new Function` / `node:vm`。
- 管理动作全部写 `audit_logs`，含操作人、前后值与来源 IP。
- 所有按 id 的查询都同时校验归属；文件回收按 owner 范围执行，不做全库扫描删除。

## 接口文档

OpenAPI 只在管理后台「接口文档」页提供，需管理员登录。不要再访问 `/api/docs`，该路径已关闭。
