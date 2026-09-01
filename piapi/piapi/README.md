# PiAPI 自动注册系统

通过 Google OAuth 批量登录 [piapi.ai](https://piapi.ai)、获取 Cookie 和 API Key 的自动化工具。整套服务跑在 Docker 里，**主机上不会弹出任何命令行窗口或浏览器窗口**——Chromium 运行在容器内的虚拟显示器上，Google 要求额外验证时通过内嵌 noVNC 操作对应账号的独立浏览器。

## 快速开始

前置条件：Docker Desktop（Windows / macOS / Linux 均可）。

```bash
docker compose up -d --build
```

打开 <http://localhost:3000>。首次构建约 3-5 分钟（要拉 Playwright 基础镜像）。

```bash
docker compose logs -f      # 看日志
docker compose down         # 停止（数据保留）
docker compose down -v      # 停止并删除所有数据

# 看 api 容器里 5 个进程的状态（Xvfb / fluxbox / x11vnc / noVNC / node）
docker compose exec api supervisorctl -c /etc/supervisor/conf.d/piapi.conf status
```

## 架构

```mermaid
flowchart LR
  B["浏览器<br/>localhost:3000"]
  subgraph D ["Docker Compose"]
    W["piapi-web<br/>nginx + React 静态产物"]
    A["piapi-api<br/>Express + Playwright<br/>Xvfb · x11vnc · noVNC"]
    V[("piapi-data volume<br/>sqlite · profile · 截图")]
  end
  B -->|"/"| W
  W -->|"/api  ·  /api/events (SSE)"| A
  W -->|"/vnc/  websocket"| A
  A --> V
  A -->|Chromium| N["accounts.google.com<br/>piapi.ai"]
```

| 容器 | 说明 |
| --- | --- |
| `piapi-api` | 基于 `mcr.microsoft.com/playwright:v1.62.1-noble`。`supervisord` 拉起 5 个进程：Xvfb（虚拟显示器）、fluxbox（窗口管理）、x11vnc、noVNC/websockify、Node API |
| `piapi-web` | nginx。提供前端静态文件，反代 `/api`（SSE 关闭缓冲）与 `/vnc/`（websocket 升级） |

数据全部落在具名 volume `piapi-data`：`piapi.db`、每账号独立的 `browser-profile/`、`screenshots/`。

暴露端口：`3000` 前端（唯一需要访问的），`3001` 后端 API、`6080` noVNC（仅调试用）。

## 使用流程

### 1. 导入账号

「账号管理」→「批量导入」，每行一个，字段用 `----` 分隔：

```text
main@example.org----password----BASE32TOTP
main@example.org|password|recovery@gmail.com
main@example.org----password----BASE32TOTP----recovery@gmail.com
```

第一列必须是完整 Google 主账号邮箱。第三列含 `@` 时按辅助邮箱处理，否则按 base32 TOTP 处理；两者都有时使用四列。也支持 `|`、Tab、分号、逗号；`#` 开头的行忽略。输入时会实时预览并逐行说明错误。重复账号会更新凭据，不会重复创建。

导入后列表里的「当前验证码」列会实时显示每个账号的 TOTP 验证码，可用来核对密钥是否正确。

### 2. 跑批量注册

「注册控制」→「开始批量注册」。右侧是 SSE 实时日志，逐账号显示每一步。并发数、重试次数在「系统设置」里改。

**建议先打开 DRY-RUN 模式跑一遍**（系统设置 → DRY-RUN），它只模拟流程、不访问真实网站，用来确认队列、进度条、日志、导出这条链路是通的。

注册成功后会自动读取 PiAPI 已创建的 `Initial Key`；如果账号没有任何 Key，则自动创建
`PiAPI-Auto`。PiAPI 的 reveal 接口使用临时 RSA-OAEP-256 公钥加密返回值，后端在内存中解密后将
API Key 保存到账号记录，不依赖页面文本或剪贴板。

旧账号可在「账号管理」逐条点钥匙图标重新提取；也可点「补齐全部 API Key」。有勾选行时只处理
所选的已完成账号。在「数据导出」页也能先自动补齐，再复制全部 API Key 或下载 CSV / JSON。

### 3. 手动处理 Google 额外验证（需要时）

正常批量注册不需要预先手动授权。如果日志显示 Google 要求手机确认、验证码或其他 additional challenge，在「注册控制」选择该账号，点击「打开该账号浏览器」，在 noVNC 中完成验证后关闭浏览器。登录状态直接保留在该账号自己的持久化 profile 中；将失败账号重置为待处理后再运行即可。

### 4. 导出

「数据导出」支持 CSV（带 UTF-8 BOM，Excel 不乱码）、JSON、TXT。TXT 的格式与批量导入完全一致，可以直接回灌。文件由服务端生成，浏览器直接下载。

## Google 登录流程

系统固定使用 Google OAuth，不再包含提供方选择和其他登录流程：

1. 打开 PiAPI 登录弹窗并点击 `Continue with Google`。
2. 填写完整邮箱和密码。
3. 自动处理受管 Workspace 的首次登录确认。
4. 按页面实际顺序处理辅助邮箱确认、TOTP 和 Google consent；最多连续处理 8 个跳转步骤。
5. 等待 PiAPI OAuth 回调，验证真实会话 Cookie。
6. 提取现有 API Key；没有 Key 时创建 `PiAPI-Auto`。

Google 的邮箱错误和密码错误是就地渲染且可能本地化，程序使用「下一步骤件是否出现」判断成败，并把页面原始报错写入日志。手机确认、短信验证码或其他无法自动回答的挑战会截图并提示使用对应账号的 noVNC profile。

### 代理池

「系统设置 → 代理池」，右上角总开关控制开 / 关，关掉全部直连。地址支持 `http://user:pass@host:port` 与 `socks5://host:port`。

当前配置里的 Thordata 网关访问 PiAPI 正常，但访问 `accounts.google.com` 会挂起约 90 秒后
`net::ERR_ABORTED`，所以代理池默认关闭但条目和凭据仍保留。换成确认能访问 Google 的代理后，再打开代理池右上角总开关。

**`{session}` 占位符是重点。** 地址里写 `{session}`，运行时会被替换成该账号专属的会话标识。动态住宅代理默认每个请求换一个出口 IP，OAuth 中途换 IP 容易触发 Google 额外验证。各家语法不同，Thordata 是在用户名里加 `-sessid-<串>-sesstime-<分钟>`：

```
http://td-customer-XXXX-sessid-{session}-sesstime-30:PASS@gateway:9999
```

实测这个占位符确实起作用——同一账号连续三次都是 `181.14.155.7`，去掉 `sessid` 则三次分别落在三个国家。

三种分配策略：

| 策略 | 行为 | 什么时候用 |
| --- | --- | --- |
| 按账号固定（默认） | `hash(account-id) % 条目数`，同一账号整轮走同一条 | 每条代理是一个独立身份时 |
| 轮询 | 按顺序依次取 | 想把负载摊平 |
| 随机 | 每次独立随机 | 无所谓分布时 |

两种测试按钮，作用不一样：

- **测试 / 测试全部**：不开浏览器，直接用 HTTP 请求打 `ipinfo.io`，几秒出结果，适合快速筛掉打不通的条目。逐条串行执行，因为共享住宅网关会对并发探测限速，并发跑会把好条目误报成死的。
- **检测浏览器出口 IP**：真的启动 Chromium，和批量注册走完全相同的链路。左边的「模拟」框填 `account-3`，看到的就是那个账号实际会从哪个 IP 出去。这是唯一能证明代理真生效的办法。

用 `scripts/seed-proxy-pool.ps1` 可以一条命令把 Thordata 网关写进去（凭据只落数据库，不进代码库）：

```powershell
$env:THORDATA_GATEWAY='host:9999'
$env:THORDATA_USER='td-customer-XXXX'
$env:THORDATA_PASS='your-password'
powershell -ExecutionPolicy Bypass -File scripts\seed-proxy-pool.ps1
```

「恢复默认」会保留代理池——那里面是买来的凭据，本程序找不回来。

批量导入认三种写法：`host:port:user:pass`、`user:pass@host:port`、完整 URL。

每个账号开跑时会记一行日志说明走了哪条代理，方便事后判断某次拒绝是不是只发生在某个出口上。

程序会区分这几种情况，措辞不同：

| 现象 | 含义 |
| --- | --- |
| `error=access_denied` | Google consent 被取消，检查授权按钮选择器 |
| `error=AccessDenied`（驼峰，来自 NextAuth） | OAuth 成功，piapi 拒绝了这个账号——重试无用，已自动跳过剩余重试 |
| `Google did not accept the account address: …` | Google 侧就没通过，冒号后是 Google 的原话 |
| `Google stopped ... additional challenge` | 在注册控制中打开该账号 noVNC profile 手动确认 |

失败会自动截图存到 volume，在账号列表点日志图标就能看到当时的页面。

## 页面选择器

Google 和 piapi.ai 随时可能改版。所有选择器都存在数据库里，可在「系统设置 → 页面选择器」直接改，**保存即生效，不用重建镜像**。每项是一个候选列表，程序按顺序尝试第一个可见的。

几个容易踩的坑（默认值已经处理好）：

- piapi 的会话 cookie 是 `__Secure-next-auth.session-token`。判断是否登录成功时会按 PiAPI 域名过滤，并排除 `csrf-token` / `next-auth.state` 这些登录前就存在的 cookie。程序最终以页面上「Log in」按钮是否可见作为是否登录成功的判据。
- Google 的邮箱输入框是 `type="text"` 不是 `type="email"`，只有 `#identifierId` 靠得住。它的报错不跳转、就地内联渲染，而且文案会跟随界面语言、用的是弯引号 `’` 而不是 ASCII `'`——所以程序**不匹配文案**，而是用「下一步之后密码框有没有出现」这种结构信号判断成败，报错原文从 `div[jsname="B34EJ"]` 里读出来照抄给你。

## 本地开发（不用 Docker）

```bash
npm --prefix server install && npm --prefix server run dev    # :3001
npm --prefix client install && npm --prefix client run dev    # :3000，已配 /api 代理
```

注意：本地模式下没有 Xvfb，Playwright 会按「无头模式」设置运行；关掉无头会在你的机器上真的弹出浏览器窗口。

## 诊断脚本

`scripts/` 下的工具用于站点改版后重新校准：

| 脚本 | 用途 |
| --- | --- |
| `ui-smoke.js` | 用真实浏览器逐页访问前端，检查白屏与 console 报错，输出截图 |
| `vnc-check.js` | 验证 noVNC 弹窗能连上容器里的显示器 |
| `discover-selectors.js` | 探测 piapi.ai 登录入口的真实控件 |
| `trace-google.js` | 逐步走一遍 Google OAuth，并探测邮箱/密码步骤的选择器（容器内） |
| `inspect-dashboard.js` | 用已登录的 profile 打开面板，dump cookie 和疑似 API Key 的元素（容器内） |
| `probe-apikey-direct.js` | 验证通过 PiAPI reveal + RSA-OAEP-256 直接解密 API Key（容器内） |
| `probe-google-scope.sh` | 打印 PiAPI 向 Google 申请的 OAuth scope 和 client_id |
| `probe-google-error.js` | 定位 Google 内联报错渲染在哪个元素里（容器内） |
| `probe-signup-surface.sh` | 扫 piapi 有没有 OAuth 之外的注册入口、备用域名、开放接口 |
| `probe-app-host.sh` | 查 `app.piapi.ai` 是不是独立的认证体系 |
| `probe-botcheck.js` | 检查登录弹窗里有没有 Turnstile / hCaptcha 等人机验证（容器内） |
| `probe-proxy-sticky.sh` | 验证住宅代理是否支持粘性会话（连续三次是否同一出口 IP） |
| `seed-proxy-pool.ps1` | 把 Thordata 网关写进代理池（本机跑，凭据只落数据库） |
| `shot-proxy-pool.js` | 点一遍代理池卡片的「测试全部」并截图，验证 UI 到 API 的接线（本机跑） |

只需要本机跑的：

```bash
node scripts/ui-smoke.js http://localhost:3000
```

需要在容器里跑的（拷进去再执行）：

```bash
docker compose cp scripts/trace-google.js api:/tmp/trace-google.js
docker compose exec api node /tmp/trace-google.js <完整邮箱> <密码>
```

## 接口

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/health` | 健康检查 |
| `GET /api/events` | SSE 实时事件流（进度、日志、账号变更） |
| `GET/POST /api/accounts` | 列表 / 新增 |
| `POST /api/accounts/bulk` | 批量导入原始文本 |
| `POST /api/accounts/bulk/preview` | 只解析不写库，供弹窗预览 |
| `PATCH/DELETE /api/accounts/:id` | 修改 / 删除 |
| `POST /api/accounts/bulk-delete` | 按 id 数组或按状态批量删除 |
| `POST /api/accounts/reset` | 把某状态的账号重置为待处理 |
| `GET /api/accounts/:id/totp` | 该账号当前验证码 |
| `GET /api/accounts/:id/logs` | 该账号的日志 |
| `POST /api/accounts/:id/api-key` | 从该账号的持久化登录 profile 提取或创建 API Key |
| `POST /api/accounts/api-keys/sync` | 串行补齐 API Key；body 可传 `ids` 与 `force` |
| `POST /api/register/start` / `stop` | 启停队列 |
| `GET /api/register/status` | 队列 + 授权会话状态 |
| `POST /api/register/auth-session` | 传 `accountId`，打开该账号独立的 noVNC 浏览器 |
| `POST /api/register/auth-session/complete` | 关闭浏览器并保留该账号 profile |
| `POST /api/register/verify-totp` | 校验任意 base32 密钥 |
| `GET/PUT /api/settings` | 读写设置（含 Google/PiAPI 选择器、代理池） |
| `POST /api/settings/proxy-test` | 逐条测试代理池（不开浏览器） |
| `POST /api/settings/proxy-test/:id` | 测试单条代理 |
| `GET /api/settings/egress-ip` | 开一个真实浏览器查出口 IP，可加 `?profileKey=account-3` 模拟指定账号 |
| `POST /api/settings/clear-*` | 清理已完成账号 / 浏览器数据 / profile / 日志 / 截图 |
| `GET /api/export/csv\|json\|txt` | 导出，可加 `?status=` 与 `?includePasswords=true` |
| `GET /api/screenshots/:file` | 失败截图 |

## 安全提示

账号密码、TOTP 密钥、Cookie Token 和 API Key 以**明文**存在 SQLite 里（位于 Docker volume，不在仓库内，`data/` 已在 `.gitignore`）。导出时勾选「包含密码与 2FA 密钥」会把登录凭据写进文件；CSV / JSON 默认也包含 API Key 和 Cookie Token，注意保管。

服务本身没有鉴权，不要把 `3000`/`3001`/`6080` 暴露到公网。

## 技术栈

后端 Node.js 22 · TypeScript · Express 4 · sql.js · Playwright 1.62 · otplib（用 `authenticator`，base32 密钥必须用它，`totp` 会静默算错）。
前端 React 18 · TypeScript · Vite 5 · Ant Design 5 · React Router 6。
