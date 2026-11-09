# Tasks

## 1. 当前用户 hook

- [ ] 1.1 `src/lib/hooks/use-current-user.ts`：用 `useSyncExternalStore(subscribeNever, () => true, () => false)` 判定是否已水合；未水合时返回 `user: null`、`loading: true`、`isSuperAdmin` / `isPlatformAdmin` 为 `false`；已水合时返回原有 state；`reload`、模块缓存与 effect 逻辑不改；verify：`npm run typecheck` 通过，2.1 渲染测试通过

## 2. 测试与点验

- [ ] 2.1 新增渲染测试 `src/lib/hooks/__tests__/use-current-user-hydration.test.tsx`：替换 `globalThis.fetch` 让 `/api/auth/me` 返回 super_admin，经 hook 的 `reload()` 填好模块缓存后，用 `react-dom/server` 渲染只读当前用户的组件，断言输出为"加载中、无用户、非平台管理员"；源码断言 hook 用带服务端快照的 `useSyncExternalStore` 判定水合；注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`npx tsx src/lib/hooks/__tests__/use-current-user-hydration.test.tsx` 全过，临时撤回 1.1 后渲染断言失败，`bash scripts/check-test-registry.sh` 通过
- [ ] 2.2 新增手动点验脚本 `scripts/current-user-hydration-smoke.mjs`（地址、super_admin 与 boss 账号走环境变量）：super_admin 直接打开 `/admin/users`（3 次）、`/admin/audit-logs`、`/settings`、`/sales`、`/admin/invite-codes`、`/organizations`、`/tasks` 均无水合不一致错误且 `/admin/users` 出现用户表；boss 直接打开 `/admin/users` 无水合错误并显示"无权限访问"；从 `/admin/invite-codes` 客户端路由跳到 `/admin/users`，无 `/api/auth/me` 请求、无当前用户加载态、用户表出现；任一失败退出码非 0；verify：隔离库 + `next dev` 上 `node scripts/current-user-hydration-smoke.mjs` 退出码 0，临时撤回 1.1 后退出码非 0

## 3. 收尾

- [ ] 3.1 跑 `npm run typecheck`、`npm run lint:baseline`、`npm test`、`bash scripts/check-test-registry.sh`、`openspec validate fix-current-user-hydration --strict`，写 `docs/QINGYAN_FIX-CURRENT-USER-HYDRATION_REPORT.md`（根因、差异节点、改动、改前改后复现结果、测试结果）；verify：以上命令全绿，报告文件存在

## Workflow follow-up

- 开 PR（一个 change = 一个 PR；PR 描述附点验脚本改前改后输出），合并后 `/opsx:archive fix-current-user-hydration --yes`（独立小 PR，specs 增量合入 `openspec/specs/identity/current-user-client-state/`）。
- 若 LucasJ880/-#404（USR-1）先合并，rebase 时 `scripts/test-all.sh`、`scripts/test-ci-unit.sh` 两边新增行都保留。
