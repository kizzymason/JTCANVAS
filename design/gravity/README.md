# 灵感引力前台重构

前台采用冷黑 `#080B0C`、炭灰 `#111617`、净白 `#F5F7FA` 和荧光绿 `#C3FA55`。后台保留原主题。

- `originals/` 保存八张无文字生图原稿，`assets.json` 保存原始提示词；响应式 WebP 位于 `web/public/brand/gravity/`。
- `verify-ui.cjs` 使用独立 Edge 和模拟接口验证页面与弹层，不访问生产账号，不生成或付款。运行时需让 Node 能找到 Playwright，并在本机运行 Vite 3000 端口。
- `server/src/modules/homepage/` 包含权限、发布、媒体访问及事务测试。PostgreSQL 集成测试仅接受显式 `HOMEPAGE_TEST_DATABASE_URL`，数据库名必须以 `gravity_homepage_test` 开头，并且首页表为空；先应用项目现有迁移。
- `qa/` 是本机截图和验收输出，不提交运行环境路径。
- 部署脚本中的路径对应本次服务器部署；备份脚本拒绝覆盖同名备份。初始化脚本必须显式执行并记录审计，只处理空首页，绝不在应用启动时自动载入示例。

真实生成、付款、复杂画布保存和 Agent 连接仍需按 pending-test 手工验收；自动化检查不会发起收费请求。
