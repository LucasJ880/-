# Design：请求入口改用 Next 16 的 proxy 约定

## Context

- 动机见 proposal.md「Why」。
- 现状（VIS-1a 合并后的 main）：`src/middleware.ts` 导出 `middleware(request)`，它只做一件事 `handleRequest(request, ROUTE_GATE_LOADER)`。`handleRequest` 依次处理 public 图片、`PUBLIC_PATHS`、JWT 会话、`/api/marketing/**` 旧模式分支、`/api/**` 放行和路由门。`config` 为 `{ runtime: "nodejs", matcher: [...] }`。
- Next 16.2.0 的约束，源码与随包文档都能查到：
  - 入口文件识别：`node_modules/next/dist/build/index.js` 的 `PROXY_FILENAME = "proxy"`，项目根或 `src/` 下的 `proxy.ts` 都认。只要还有 `middleware.ts`，构建就 `warnOnce` 弃用告警。两个文件同时存在时直接报错 "Both middleware file … and proxy file … are detected"。
  - 导出校验：`node_modules/next/dist/build/analysis/get-page-static-info.js` 的 `validateMiddlewareProxyExports`。proxy 文件必须有 default 导出或具名 `proxy` 导出，具名 `middleware` 导出不算数。
  - runtime：同一文件的 `isProxyFile(page) && resolvedRuntime` 分支。proxy 文件只要声明 `config.runtime`，生产构建就抛 E1031 "Route segment config is not allowed in Proxy file … Proxy always runs on Node.js runtime"。随包文档 `proxy.md` §Runtime 写的也是这条。

## Goals / Non-Goals

**Goals:**

- `next build --webpack` 不再输出 middleware 弃用告警，路由表仍有 Proxy 条目，proxy 仍按 Node.js runtime 构建，路由门要用的 Prisma 仍打进 proxy。
- 请求处理逐字节不变：`handleRequest` 的函数体、`PUBLIC_PATHS`、`COOKIE_NAME`、`matcher`、判定顺序、响应体、状态码和头都不改。
- 7 个读或 import 中间件的测试全部改指 `src/proxy.ts`，除 route-gate 因 D3 从 132 项变为 134 项外，每个测试的通过项数与改名前相同。

**Non-Goals:**

- `src/lib/navigation/route-gate.ts`、`src/lib/navigation/context-server.ts`、`src/lib/marketing/route-access.ts`、`src/lib/auth/safe-next.ts`：不改。
- `scripts/test-all.sh`、`scripts/test-ci-unit.sh`、`ci/test-registry-baseline.txt`：不改。没有新增或改名的测试文件。
- `src/lib/marketing/__tests__/marketing-middleware-access.test.ts` 的文件名：不改。
- `src/app/api/visualizer/share/[token]/assets/[kind]/[id]/route.ts`、`src/app/api/trade/webhook/website/embed/route.ts`、`src/app/api/trade/webhook/website/status/route.ts` 注释里泛指的"middleware"：不改。
- `docs/**` 历史报告与审计文档里出现的 `src/middleware.ts`：不改。
- `next.config.*`、`vercel.json`、`.claude/launch.json`、`package.json`：不改。

## Decisions

### D1 文件与导出：`git mv src/middleware.ts src/proxy.ts`，具名导出 `proxy`

`export async function middleware` 改为 `export async function proxy`，函数体不变，`handleRequest` 照旧具名导出供测试注入假加载器。

- 否决「default 导出」：Next 也接受，但测试 import 和 Next 文档示例都用具名 `proxy`。具名导出让测试改动只是一次换名，grep `proxy(` 也能直接找到调用点。
- 否决「保留 `middleware` 作为 `proxy` 的别名导出」：Next 不认这个名字。留着它，grep 旧名时还会命中，读代码的人会误以为它仍是入口。
- 否决「复制成新文件再删旧文件」：`git mv` 能保住 `git log --follow` 的历史。

### D2 去掉 `config.runtime`

- 否决「保留 `runtime: "nodejs"`」：Next 16 生产构建在 proxy 文件里遇到 `config.runtime` 会抛 E1031，见 Context。proxy 固定跑 Node.js runtime，所以去掉之后运行时与 VIS-1a 的 `runtime: "nodejs"` 相同。注释改为说明 proxy 固定 Node.js runtime，路由门才能查库。
- 否决「把 runtime 挪到 `next.config` 或环境变量里」：Next 16 不提供这个开关，也没必要。

### D3 route-gate 测试里 runtime 断言的替代

原断言是「中间件声明 runtime: nodejs」，改为三条：

1. proxy 的 `config` 不含 `runtime`。
2. `src/middleware.ts` 不存在。
3. `src/proxy.ts` 源码有 `export async function proxy(`。

这三条守的是 Next 的入口约定，单测里秒级就能发现回退，不用等一次 `next build`。

- 否决「直接删掉这条断言」：有人把 `runtime` 加回来，或把 `middleware.ts` 恢复回来，都只能等构建才暴露。前者构建报错，后者构建也报错。测试项数会少 2 条以上，出问题时也看不出原因。

### D4 日志文案保持 `[middleware] JWT_SECRET is not set — rejecting request`

- 否决「改成 `[proxy] …`」：这是线上日志的可观察文案，Vercel 日志检索或告警可能按它匹配。本 change 承诺不改行为，所以文案不动。

### D5 测试文件名与注册不动

- 否决「`marketing-middleware-access.test.ts` 改名为 `marketing-proxy-access.test.ts`」：要同时改 `scripts/test-all.sh` 和 `scripts/test-ci-unit.sh` 两处注册，带来的只是注册改动，没有行为差异。文件头注释写明测的是 proxy（原中间件）。

## 与八条硬纪律的关系

1. 零 schema：不涉及。不改 Prisma schema、不写 migration。
2. 出站先审批：不涉及。不新增任何对外发送。
3. 禁止第三套队列：不涉及。
4. 脱敏：不涉及。不触碰 muse-bridge。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：不涉及。不新增 LLM 调用。
8. 测试注册：触碰。7 个测试只改内容，不新增、不改名、不删除测试文件，注册与基线都不变。用 `bash scripts/check-test-registry.sh` 验证，它也在 `npm run test:ci` 里。

## 验证方式

- 7 个测试逐个 `npx tsx <file>`，通过项数与改名前基线相同。基线在 VIS-1a 分支 a3967f3 上实测：public-route-auth-contracts 164、notification-href 91、route-gate 132、marketing-middleware-access 4、residual-reads 76、email-inbound 20、website-inquiry-async 15。route-gate 因 D3 一拆三，变为 134。
- `npm run test:ci` 退出码 0。
- `npm run typecheck` 与 `npm run lint:baseline` 通过。
- `NODE_OPTIONS=--max-old-space-size=$(node scripts/build-heap-mb.mjs) npx next build --webpack` 退出码 0，并检查三项：
  - 输出里 `grep -c 'file convention is deprecated'` 为 0。
  - 输出里仍有 `ƒ Proxy (Middleware)`。
  - `.next/server/middleware-manifest.json` / `functions-config-manifest.json` 显示 proxy 为 Node.js runtime，且包含 Prisma。
- `grep -rn "src/middleware\|@/middleware\|/middleware\"" src scripts --include=*.ts --include=*.tsx` 只剩 `route-gate.test.ts` 里断言 `src/middleware.ts` 不存在的那一行。
- `openspec validate next16-proxy-rename --strict` 通过。

## Risks / Trade-offs

- [Vercel 对 proxy 的打包与 middleware 不同] → VIS-1a 已在 Vercel Preview 验证过 Node.js runtime 中间件，本 change 的 Preview 也必须部署成功。本地构建核对 manifest 里的 runtime 与 Prisma。
- [别的分支在本 PR 合并前新增了对 `src/middleware.ts` 的读取或 import] → 合并前 rebase 到最新 main，重跑上面的 grep 与 `npm run test:ci`。
- [本地 Node 版本与 CI 不一致] → 全程用 Node 24（`.nvmrc`）。

## Migration Plan

- 部署：随 PR 合并正常部署，无数据迁移、无环境变量变化。
- 回滚：revert 本 PR 即恢复 `src/middleware.ts` 与 `runtime: "nodejs"`。改名前后行为一致，回滚无副作用。
