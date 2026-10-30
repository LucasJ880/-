# Tasks

## 1. 权限键

- [x] 1.1 `permissions.ts` 新增 `project.finance.manage`（"管理项目财务"，HIGH，`["ORG"]`，`allowedPrincipalTypes: ["HUMAN"]`）；`role-defaults.ts`：窗饰 `owner` + ORG（D1，系统模板不绑）；`authorize.test.ts` 加登记、`owner` 含、系统模板 `org_owner` / `org_admin` 与 `bids` / `accounting` / 其余不含。verify：`npx tsx src/lib/authorization/__tests__/authorize.test.ts` 通过；typecheck。

## 2. 项目财务

- [x] 2.1 `project-finance/access.ts`：`resolveFinancePrivilege` + `requireCostAccess` 挂 `finance: { privileged, canReadAll }`、按 D2 判 perm、按 D3 非成员只读进入；`projects/access.ts` 导出 `findProjectForAccess`。verify：`p15-authz-contract`、`p16-authz-contract` 通过；typecheck。
- [x] 2.2 5 个路由（expenses、expenses/[expenseId]、expenses/[expenseId]/receipt、budget、payables）内联特权改读 `access.finance`。verify：`grep -rn 'orgRole === "org_admin"' src/app/api/projects src/lib/project-finance` 非测试为空；typecheck。

## 3. 报价引擎与交接

- [x] 3.1 `quote-engine/access.ts`：`resolveQuoteCapabilities(access, { financeManage })`，`requireQuoteAccess` 先 authorize（D4）；`quote-engine-contract.test` QE-02 改语义。`handoff/access.ts` 去掉 `canManageUsers`；删除 `roles.ts` / `permissions-client.ts` 的 `canManageUsers` / `canDeleteUsers`，`security1-owner-manager.test` 与 `onboarding-rules.ts` 注释同步（D5）。verify：`quote-engine-contract`、`quote-ops-contract`、`security1-owner-manager` 通过；`grep -rn "canManageUsers\|canDeleteUsers" src --include=*.ts --include=*.tsx | grep -v __tests__` 为空。

## 4. 测试与收尾

- [x] 4.1 新建 `src/lib/project-finance/__tests__/finance-access.test.ts`（纯，决策表 + 源码断言）注册 test-all 与 test:ci；新建 `src/lib/project-finance/__tests__/finance-access-db.isolated.test.ts`（design 验证方式所列场景）注册 test-all。verify：本地 Postgres 隔离库跑通；`bash scripts/check-test-registry.sh` 通过。
- [x] 4.2 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；`openspec validate perm-4c1-project-finance --strict` 通过；写 `docs/QINGYAN_PERM-4c1_REPORT.md`；`docs/QINGYAN_PERMISSION_TASKFLOW.md` PERM-4c1 改 `[G]`；更新 `docs/QINGYAN_PERMISSION_HANDOFF.md`。verify：四条命令退出 0；`grep -c "PERM-4c1 .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1。

## Workflow follow-up

- PR 合并后 `/opsx:archive perm-4c1-project-finance --yes`（独立小 PR），TASKFLOW PERM-4c1 改 `[x]`；确认 `openspec list --specs` 出现 `projects/finance-access`、`projects/handoff-access`。
- 生产：合并后对 Sunny 重跑 `seedOrgAuthorizationProfiles`（owner 加 `project.finance.manage`）；核对谁靠 `org_admin` 做项目财务，需要的绑 `owner`。
- 下一个：`perm-4c2-nav-by-position`（导航 / 默认工作区 / 底栏），再 `perm-4c3-collapse-platform-roles`。
