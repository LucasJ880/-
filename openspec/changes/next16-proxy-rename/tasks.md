# Tasks

TASKFLOW：无（基础设施），不写 REPORT、不改 TASKFLOW 状态列。每条带验证。

## 1. 改名

- [x] 1.1 `git mv src/middleware.ts src/proxy.ts`；`export async function middleware` 改为 `export async function proxy`（函数体不变）；删掉 `config.runtime`，并把注释改为说明 proxy 固定 Node.js runtime；`handleRequest`、`PUBLIC_PATHS`、`matcher`、日志文案逐字不动；verify：`git diff -M --stat` 显示改名，`git diff -M` 里 `src/proxy.ts` 只动了导出名、`runtime` 行和注释，`npm run typecheck` 在本组之后的测试改完时一并通过（见 2.1）

## 2. 测试改指 proxy

- [x] 2.1 改 7 个测试：`scripts/public-route-auth-contracts.test.ts`、`src/lib/navigation/__tests__/route-gate.test.ts`、`src/lib/marketing/__tests__/marketing-middleware-access.test.ts` 的 import 与调用改为 `proxy` / `@/proxy`；`src/lib/notifications/__tests__/notification-href.test.ts`、`src/lib/authorization/__tests__/residual-reads.test.ts`、`src/lib/trade/__tests__/email-inbound.test.ts`、`src/lib/trade/__tests__/website-inquiry-async.test.ts` 改读 `src/proxy.ts`。route-gate 的 runtime 断言按 design D3 一拆三。不新增、不改名、不删除测试文件。verify：7 个测试逐个 `npx tsx` 全过，项数为 164 / 134 / 4 / 91 / 76 / 20 / 15；`npm run typecheck` 通过；`bash scripts/check-test-registry.sh` 输出 OK

## 3. 注释

- [x] 3.1 把 10 个页面文件（`src/app/(main)/{ops,install,accounting,bids}/**/page.tsx`）注释里的 `src/middleware.ts` 改为 `src/proxy.ts`；verify：`grep -rn "src/middleware\|@/middleware\|/middleware\"" src scripts --include=*.ts --include=*.tsx` 只剩 `route-gate.test.ts` 里断言 `src/middleware.ts` 不存在的那一行

## 4. 门禁

- [x] 4.1 `npm run test:ci`、`npm run lint:baseline`、`openspec validate next16-proxy-rename --strict`；verify：全部退出码 0
- [ ] 4.2 `NODE_OPTIONS=--max-old-space-size=$(node scripts/build-heap-mb.mjs) npx next build --webpack`；verify：退出码 0，输出里 `file convention is deprecated` 出现 0 次且仍有 `ƒ Proxy (Middleware)`，`.next/server/` 的 manifest 显示 proxy 为 Node.js runtime 且打进了 Prisma

## Workflow follow-up

- `/opsx:verify next16-proxy-rename` 后开 PR（一个 change = 一个 PR），PR 描述写明无对外行为变化。
- PR 合并后 `/opsx:archive next16-proxy-rename --yes`（独立小 PR；`skip_specs: true`，不合入任何 spec）。
