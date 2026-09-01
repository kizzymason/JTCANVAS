<p align="center">
  <img src="web/public/logo.svg" width="96" alt="JTCANVAS">
</p>

<h1 align="center">JTCANVAS</h1>

<p align="center">商业化 AI 创作画布。在无限画布上生成、连接和迭代图片、视频、文本与音频，账号、计费、渠道和文件全部由服务端托管。</p>

<p align="center">
  <a href="docs/content/docs/overview/quick-start.mdx">快速开始</a> ·
  <a href="docs/content/docs/overview/features.mdx">功能介绍</a> ·
  <a href="docs/content/docs/overview/docker.mdx">Docker 部署</a> ·
  <a href="docs/content/docs/canvas/canvas-node-manual.mdx">画布手册</a> ·
  <a href="docs/content/docs/canvas/canvas-shortcuts.mdx">快捷键</a>
</p>

JTCANVAS 面向要独立运营的创作平台：全站登录后使用，余额不足会在生成前拦截；第三方 API Key 只存在服务端并加密入库，由管理后台配置，前台不持有任何密钥。画布、素材和生成结果保存在 PostgreSQL 与对象存储中，同一账号跨设备可用。

## 核心功能

- **无限画布**：多画布项目、节点拖拽缩放、连线、组节点、小地图、撤销重做、导入导出。文本 / 图片 / 视频 / 音频 / 生成配置节点可互相引用，右键空白处创建节点。
- **工作台**：独立的生图工作台与视频创作台，和画布共用账号、模型和计费。
- **账号与计费**：登录注册、人民币钱包、卡密兑换、按张 / 按秒计费。提交时冻结估算金额，成功后按实际用量结算，失败全额退回。
- **管理后台**：用户、渠道与模型、价格、卡密、财务流水与对账、生成记录、存储策略、服务开关、PiAPI 账号池、站点设置与审计日志。
- **服务端生成**：API 进程只负责鉴权、计费和入队，worker 调用上游。支持 OpenAI 兼容 / Gemini / PiAPI 等渠道，以及管理员可配置的自定义调用脚本。
- **存储**：本机磁盘或 S3 兼容对象存储，可在后台切换；列表与画布使用自动生成的缩略图。
- **Agent**：可选接入本地 Canvas Agent，由管理后台服务开关控制前台入口。

完整说明见 [功能介绍](docs/content/docs/overview/features.mdx)。文档索引见 [docs/index.md](docs/index.md)。

## 快速开始

项目由 `web/` 前端与 `server/` 后端组成，部署形态为 nginx + api + worker + postgres + redis。

### Docker（推荐）

```bash
git clone https://github.com/kizzymason/JTCANVAS.git
cd JTCANVAS

cp .env.example .env
# 必填：POSTGRES_PASSWORD、APP_ENCRYPTION_KEY
# 生成加密主密钥：node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

docker compose up -d
```

默认端口 `3000`，打开 `http://localhost:3000`。

**第一个注册的账号会自动成为管理员。** 登录后访问 `/admin`，先添加渠道与模型并设置价格，用户才能开始生成。

### 本地开发

```bash
# 后端
cd server
npm install
docker compose -f docker-compose.dev.yml up -d postgres redis
cp .env.example .env   # 填入 APP_ENCRYPTION_KEY
npm run db:migrate
npm run dev            # API，默认 4000
npm run dev:worker     # worker，另开一个终端

# 前端
cd ../web
bun install
bun run dev            # 默认 3000，请求走 /api
```

后端细节见 [server/README.md](server/README.md)。
