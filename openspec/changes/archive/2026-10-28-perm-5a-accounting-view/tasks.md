# Tasks

## 1. 权限键与口径

- [x] 1.1 `permissions.ts` 新增 `project.finance.read`（"查看项目结算"，HIGH，`["ASSIGNED","ORG"]`）；`role-defaults.ts`：`accounting` / `owner` + ORG，`bids` + ASSIGNED；`authorize.test.ts` 加登记与模板快照（含 sales_rep 等不含）。verify：`npx tsx src/lib/authorization/__tests__/authorize.test.ts` 通过；typecheck。
- [x] 1.2 新建 `src/lib/accounting/commission.ts`（`summarizeCommission` / `groupCommissionBySales`，D1）与 `period.ts`（`parseMonth` / `parseQuarter`，D2）、`csv.ts`；`/api/sales/commission-summary` 改用 `summarizeCommission`，响应字段不变。verify：`npx tsx src/lib/accounting/__tests__/accounting.test.ts` 中口径等价用例通过；typecheck。

## 2. 接口

- [x] 2.1 `GET /api/accounting/sales-summary`（`accounting.read` ORG；按人分组；`format=csv` + 审计 `accounting.export`，D6）与 `GET /api/accounting/quotes`（`accounting.read` + `sales.quote.read` ORG；显式 select，D5）；`api-fetch.ts` 加 `/api/accounting/` 前缀。verify：`accounting.test` 源码断言"报价过程 select 不含成本 / 联系方式 / 备注 / 表单 / 签名 / PDF"通过（`costPrice` 只出现在成交汇总的计算 select）；typecheck。
- [x] 2.2 `GET /api/accounting/projects`（`project.finance.read`；ORG 全部 / ASSIGNED 参与项目；`quarter`；财务未启用 `available:false`；只取汇总字段，D3 / D4）。verify：typecheck；隔离库用例（task 4.1）。

## 3. 页面与入口

- [x] 3.1 `workspace-policy.ts` `canAccessAccountingWorkspace` + `WorkspaceId "accounting"` + 默认落地（D7）；导航 `biz-accounting`（`types.ts` / `filter.ts` 支持 `workspaceAccess: "accounting"`）；新建 `src/app/(main)/accounting/page.tsx`（三页签、403 页签隐藏、CSV 下载）。verify：`workspace-policy` / `default-workspace` / `home-redirect` / `navigation-workspace` 已注册测试通过；`npx eslint "src/app/(main)/accounting/page.tsx"` 无 error。

## 4. 测试与收尾

- [x] 4.1 新建 `src/lib/accounting/__tests__/accounting.test.ts`（纯）注册 test-all 与 test:ci；新建 `src/lib/accounting/__tests__/accounting-db.isolated.test.ts`（隔离库，design 验证方式所列场景）注册 test-all。verify：本地 Postgres 隔离库跑通；`bash scripts/check-test-registry.sh` 通过。
- [x] 4.2 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；`openspec validate perm-5a-accounting-view --strict` 通过；写 `docs/QINGYAN_PERM-5a_REPORT.md`；`docs/QINGYAN_PERMISSION_TASKFLOW.md` PERM-5a 改 `[G]`；更新 `docs/QINGYAN_PERMISSION_HANDOFF.md`。verify：四条命令退出 0；`grep -c "PERM-5a .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1。

## Workflow follow-up

- PR 合并后 `/opsx:archive perm-5a-accounting-view --yes`（独立小 PR），TASKFLOW PERM-5a 改 `[x]`；确认 `openspec list --specs` 出现 `accounting/sales-commission-view`、`accounting/quote-process-view`、`accounting/project-settlement-view`、`accounting/workspace`。
- 生产：合并后对 Sunny 重跑 `seedOrgAuthorizationProfiles`（accounting / owner / bids 加了 `project.finance.read`）。
