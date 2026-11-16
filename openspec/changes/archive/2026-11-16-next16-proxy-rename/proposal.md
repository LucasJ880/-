# Proposal：请求入口改用 Next 16 的 proxy 约定

TASKFLOW：无（基础设施）。前置：VIS-1a（LucasJ880/-#393，路由级可见性门）已合并，本 change 基于它之后的 main。

## Why

Next 16 已弃用 `middleware` 文件约定，`next build` 每次都输出「The "middleware" file convention is deprecated. Please use "proxy" instead」告警。把 `src/middleware.ts` 改成 `src/proxy.ts`，消掉这条告警，且不改任何请求处理行为。

## What Changes

- 把 `src/middleware.ts` 改名为 `src/proxy.ts`（`git mv`），对 Next 导出的入口函数从 `middleware` 改为 `proxy`；函数体与 `handleRequest` 一字不改。
- 删掉 `config` 里的 `runtime: "nodejs"`：Next 16 的 proxy 固定跑在 Node.js runtime，在 proxy 文件里写 `runtime` 会让构建报错（`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` §Runtime）。`matcher` 不变。
- 改 7 个读或 import 中间件的测试，让它们指向 `src/proxy.ts` / `proxy`：`scripts/public-route-auth-contracts.test.ts`、`src/lib/notifications/__tests__/notification-href.test.ts`、`src/lib/navigation/__tests__/route-gate.test.ts`、`src/lib/marketing/__tests__/marketing-middleware-access.test.ts`、`src/lib/authorization/__tests__/residual-reads.test.ts`、`src/lib/trade/__tests__/email-inbound.test.ts`、`src/lib/trade/__tests__/website-inquiry-async.test.ts`。除 route-gate 因下一条的一拆三从 132 项变为 134 项外，各测试的断言项数不变。
- 把 `route-gate.test.ts` 的「中间件声明 runtime: nodejs」改为三条断言：proxy 不声明 `runtime`；`src/middleware.ts` 不存在；`src/proxy.ts` 导出 `proxy` 函数。
- 把 10 个页面文件注释里的 `src/middleware.ts` 改为 `src/proxy.ts`（只改注释）。

不改的行为（由上面这些测试守住，改名前后同一批断言）：

- 登录校验：无 `qy_session` 或 JWT 校验失败时，接口返回 401（带 `x-auth-reason: session`），页面 307 到带原路径与查询串的登录页（`notification-href`、`route-gate`、`public-route-auth-contracts`）。
- 免登录路径：`PUBLIC_PATHS` 的 21 条及其匹配规则（`public-route-auth-contracts`、`email-inbound`、`website-inquiry-async`、`route-gate`）。
- public 图片：在登录检查之前放行，已登录区路径带图片扩展名照样要登录（`route-gate`）。
- `/api/marketing/**` 旧模式分支：JWT 平台角色 `sales` 返回 403（`marketing-middleware-access`、`residual-reads`）。
- 路由门：已登录页面请求的判定与 302 目标（`route-gate`、`marketing-middleware-access`）。
- 日志：`JWT_SECRET` 未配置时的报错文案 `[middleware] JWT_SECRET is not set — rejecting request` 保持原样。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。本 change 不改任何对外可观察行为（API 响应、重定向、状态码、日志文案都与改名前一致），只换 Next 识别请求入口的文件名与导出名，按 OpenSpec 约定在 `.openspec.yaml` 设 `skip_specs: true`。

## Out of scope

- 不改 `src/lib/navigation/route-gate.ts`、`src/lib/navigation/context-server.ts`、`src/lib/marketing/route-access.ts`、`src/lib/auth/safe-next.ts` 的任何代码。
- 不改 `matcher`、`PUBLIC_PATHS`、判定顺序、`COOKIE_NAME`。
- 不给测试文件 `marketing-middleware-access.test.ts` 改名（文件名已在 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh` 注册，改名只带来注册改动，不带来行为差异）。
- 不改 `docs/` 下历史报告与审计文档里对 `src/middleware.ts` 的提及（它们记录的是写作当时的状态）。
- 不改 API 路由注释里泛指的"middleware"一词。
- 不动 `next.config.*`、`vercel.json`、`.claude/launch.json`。

## Impact

- 代码：`src/middleware.ts` → `src/proxy.ts`；7 个测试文件；10 个页面文件的注释。
- 构建：`next build` 不再输出 middleware 弃用告警；路由表仍列出 `ƒ Proxy (Middleware)` 条目；产物里的 proxy 仍是 Node.js runtime。
- 部署：Vercel 上 proxy 与改名前一样按 Node.js runtime 运行（VIS-1a 已切到 Node.js runtime）。
- 依赖、schema、环境变量：不变。
