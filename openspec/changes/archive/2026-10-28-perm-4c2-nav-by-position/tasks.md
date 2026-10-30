# Tasks

## 1. 权限键与岗位模式

- [x] 1.1 `permissions.ts` 新增 `organization.dashboard.read`（"查看企业经营总览"，MEDIUM，`["ORG"]`，HUMAN only）；`role-defaults.ts`：窗饰 `owner` + ORG（D1），新增 `hasPositionTemplates(industryPackId)`（D2）；`authorize.test.ts` 加登记、只有 `owner` 含、系统模板不含。verify：`npx tsx src/lib/authorization/__tests__/authorize.test.ts` 通过；typecheck。
- [x] 1.2 `src/lib/rbac/permission-keys.ts` 新增 `loadPositionMode(orgId)`（行业包有岗位模板 → true；出错 → false）；`resolve-workspace-context.ts`、`/api/ops/home`、`/api/ops/projects/[id]` 在 `permissionKeys` 旁带上 `positionMode`；`/api/auth/active-org` 响应加 `positionMode`。verify：typecheck；`navigation-workspace` / `ops-access` 已注册测试通过。

## 2. 工作区与导航

- [x] 2.1 `workspace-policy.ts`：`positionMode` 输入，岗位模式下管理层 / 销售工作区 / 默认落地 / 会计落地按键（D4），旧模式原样；`workspaceContextFromNav` 透传。verify：workspace-policy / default-workspace / home-redirect / accounting 已注册测试原样通过；typecheck。
- [x] 2.2 `navigation/types.ts` 加 `positionPermissions` / `tradeEntry` / `superAdminOnly` 与上下文 `positionMode`（`superAdminOnly` 直接看 `platformRole === "super_admin"`）；`filter.ts` 岗位模式分支（D3，旧模式原样）；`registry.ts` 按 D3 表给入口补 `positionPermissions` / `tradeEntry`，平台用户管理改 `superAdminOnly`；`sidebar.tsx` / `mobile-nav-drawer.tsx` / `mobile-tab-bar.tsx` 传 `positionMode`，底栏销售判定按 D5。verify：navigation-workspace / navigation-ia / nav-active-matcher 已注册测试通过；`npx eslint src/components/sidebar.tsx src/components/mobile-nav-drawer.tsx src/components/mobile-tab-bar.tsx` 无新增 error。

## 3. 测试与收尾

- [x] 3.1 新建 `src/lib/navigation/__tests__/position-nav.test.ts`（design 验证方式所列）注册 test-all 与 test:ci。verify：`npx tsx src/lib/navigation/__tests__/position-nav.test.ts` 通过；`bash scripts/check-test-registry.sh` 通过。
- [x] 3.2 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；`openspec validate perm-4c2-nav-by-position --strict` 通过；写 `docs/QINGYAN_PERM-4c2_REPORT.md`；`docs/QINGYAN_PERMISSION_TASKFLOW.md` PERM-4c2 改 `[G]`；更新 `docs/QINGYAN_PERMISSION_HANDOFF.md`。verify：四条命令退出 0；`grep -c "PERM-4c2 .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1。

## Workflow follow-up

- PR 合并后 `/opsx:archive perm-4c2-nav-by-position --yes`（独立小 PR），TASKFLOW PERM-4c2 改 `[x]`；确认 `openspec list --specs` 出现 `navigation/position-based-visibility`。
- 生产：合并后对 Sunny 重跑 `seedOrgAuthorizationProfiles`（owner 加 `organization.dashboard.read`）；确认 Sunny 老板都绑了 `owner`，否则合并后他们落到各自岗位工作区。
- 下一个：`perm-4c3-collapse-platform-roles`。
