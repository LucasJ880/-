# Proposal：当前用户状态在首屏水合时与服务端 HTML 一致

TASKFLOW：无（基础设施：前端首屏水合缺陷修复）

## Why

平台 super_admin 每次直接打开 `/admin/users` 都报 React「Hydration failed because the server rendered HTML didn't match the client」（隔离库 + `next dev` + Playwright 复现：每次加载 1–2 个 `pageerror`，`/admin/audit-logs`、`/settings`、`/sales` 同样各 1–2 个），React 因此丢弃服务端 HTML、整棵页面树在客户端重建；根因是当前用户的客户端状态在 `<Suspense>` 包住的页面晚于外壳水合时，首帧读到外壳刚写入的模块级缓存（已登录用户），而服务端 HTML 是「加载中」。

## What Changes

- 修改当前用户 hook（`src/lib/hooks/use-current-user.ts`）：服务端渲染与首屏水合这一帧一律返回「无用户、加载中」（与服务端 HTML 相同）；水合提交后立即重渲染，再返回模块缓存里的用户。客户端路由切换（不经水合）仍在首帧直接用缓存，行为不变。
- 新增渲染测试 `src/lib/hooks/__tests__/use-current-user-hydration.test.tsx`：模块缓存已有 super_admin 时，用服务端渲染（与水合同一快照路径）一个只读当前用户的组件，断言输出为「加载中、无用户、非平台管理员」；同文件源码断言 hook 用带服务端快照的外部存储订阅判定是否已水合。测试在 `scripts/test-all.sh` 注册，并进 `scripts/test-ci-unit.sh`。
- 新增手动浏览器点验脚本 `scripts/current-user-hydration-smoke.mjs`（与 `scripts/nav-permission-smoke.mjs` 同类，地址与账号走环境变量）：super_admin 直接打开 `/admin/users`（3 次）、`/admin/audit-logs`、`/settings`、`/sales`、`/admin/invite-codes`、`/organizations`、`/tasks`，boss 直接打开 `/admin/users`，均断言 0 个水合不一致错误；再从 `/admin/invite-codes` 客户端路由跳到 `/admin/users`，断言无 `/api/auth/me` 请求、无当前用户加载态、用户表出现。任一失败退出码非 0。在隔离库 + `next dev` 上跑一遍，结果记入 PR 描述。

## Capabilities

### New Capabilities

- `identity/current-user-client-state`：已登录页面在浏览器里拿到"当前用户"的时机——首屏水合这一帧与服务端 HTML 一致、水合后与客户端路由切换时复用已取得的用户。

### Modified Capabilities

（无）

## Out of scope

- 不改 `src/app/(main)/admin/users/page.tsx` 及其它页面文件；USR-1（LucasJ880/-#404）对该页的改动（按企业隔离、`useCurrentOrgId`）不受影响，二者不碰同一文件的逻辑。
- 不改 `useCurrentOrgId` / `useOrganizations`：前者已用服务端快照 `""` 读 localStorage，后者无模块缓存，首帧服务端与客户端一致。
- 不修 `/sales/quote-sheet` 的 iframe `src` 带 `Date.now()` 引起的属性不一致（`src/app/(main)/sales/quote-sheet/rough-quote-panel.tsx:79`）：那是另一个根因，另开 change。
- 不改 `/api/auth/me`、会话、权限判定或任何服务端行为；不新增依赖、不改 Prisma schema。
- 不把 Playwright 复现脚本加入 CI（它需要隔离库与运行中的 dev server）。

## Impact

- 代码：`src/lib/hooks/use-current-user.ts`（26 个调用方共用；只影响首屏水合这一帧的返回值，水合后与改前相同）。
- 测试：新增 `src/lib/hooks/__tests__/use-current-user-hydration.test.tsx`；`scripts/test-all.sh`、`scripts/test-ci-unit.sh` 各加一行；新增手动点验脚本 `scripts/current-user-hydration-smoke.mjs`（不进 CI）。与 LucasJ880/-#404 同改这两个脚本，合并时可能有行级冲突，按两边都保留解决。
- 用户可见：`/admin/users`、`/admin/audit-logs`、`/settings`、`/sales` 直接打开不再报水合错误、不再整页客户端重建；页面内容与改前相同。
