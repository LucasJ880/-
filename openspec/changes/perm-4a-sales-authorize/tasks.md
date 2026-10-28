# Tasks

## 1. 权限键与岗位

- [x] 1.1 `permissions.ts` 新增 `sales.quote.signed_amount.approve`（标签"批准签约单改价"，HIGH，`["ORG"]`，`allowedPrincipalTypes: ["HUMAN"]`）；`role-defaults.ts` 的 `owner` 以 ORG 追加 `sales.customer.update`、`sales.customer.archive`、`sales.opportunity.update`、`sales.quote.update`、`sales.quote.signed_amount.approve`（design D6 / D7）；`authorize.test.ts` 加 owner 五键快照、`pricing_lead` 不含新审批键与归档键、新键 HUMAN only。verify：`npx tsx src/lib/authorization/__tests__/authorize.test.ts` 全过。

## 2. 去掉销售区平台角色短路

- [x] 2.1 `src/lib/sales/org-context.ts` 删除 4 处 `isAdmin` 短路（D1）；`opportunities/[id]` GET / PATCH、`customers/[id]` GET / PATCH 删除 `isAdmin` 分支；`customers/[id]` DELETE 改为企业内查找 + `authorize(sales.customer.archive, resource)`（跨企业 404 / 无权 403）；`security1-sales-authz.test.ts` 追加"平台 admin 无绑定 → 客户读 / 商机读 / 归档拒绝"与"super_admin 允许"。verify：`npx tsx src/lib/sales/__tests__/security1-sales-authz.test.ts`、`archived-customer-visibility.test.ts` 通过；typecheck。
- [x] 2.2 `measurements` GET：解析当前企业，按 `customer.orgId` 过滤，`resolveSalesScope(sales.customer.read)` 定范围（ORG 全部 / 本人 `measuredById` / 无权 403，D3）；`home` PUT 代设他人目标要求 `sales.analytics.read` ORG 且目标人为本企业活跃成员（D4）；`knowledge/init` 改 `isPlatformSuperAdmin`；`mark-signed`、`pdf`、`record-deposit` 改为 `authorize(sales.quote.update, resource)`，超限未批拦截只对 `isPlatformSuperAdmin` 放行，`record-deposit` 加企业解析与企业内查找（跨企业 404）。verify：typecheck；`grep -rnE "isAdmin\(|isSuperAdmin\(|canManageUsers\(|user\.role\s*[!=]==" src/app/api/sales src/lib/sales --include=*.ts | grep -v __tests__` 为空；`phase5-contract.test.ts`、`deposit-payment-methods.test.ts`、`promotion-approval.test.ts` 通过。

## 3. 签约单改总价走审批

- [x] 3.1 抽出 `src/lib/sales/quote-update.ts` `applyQuoteUpdate`：把 `quotes/[quoteId]/route.ts` PUT 的定价计算 + 事务落库原样搬入（折扣三档按传入的操作者身份判定），PUT 改为调用它，行为不变（D5）。verify：`discount-tier.test.ts`、`promotion-approval.test.ts`、`quote-settings-approval.test.ts`、`phase5-contract.test.ts`、`src/lib/quote-engine/__tests__/quote-ops-contract.test.ts` 全过；typecheck。
- [x] 3.2 PUT 签约改价分支：已签约 + 新总价与当前差 > 0.005 + 非 super_admin → 已有待批 `sales.update_signed_quote` 则 409 `SIGNED_QUOTE_APPROVAL_PENDING`；收件人（持新键者排除提交人 → owner / org_admin 兜底 → 空则 409 `NO_APPROVER`）；`requestApproval`，载荷 = 提交内容 + `baseUpdatedAt` + 改前 / 改后总价 + 提交人，预览不含成本；返回 202 `{ pending, approvalId }`；super_admin 直接生效并审计自批。`pending-actions/types.ts` 加类型与载荷；`wechat-confirm-policy.ts` 加 `web_only_review`；新建 `src/lib/sales/__tests__/signed-quote-amount.test.ts`（纯函数：是否需审批阈值、收件人选择、预览不含成本字段）并在 `scripts/test-all.sh` / `scripts/test-ci-unit.sh` 注册。verify：新测试与 `wechat-confirm-policy.test.ts` 通过；`bash scripts/check-test-registry.sh`。
- [x] 3.3 `pending-actions/executor.ts` 加 `sales.update_signed_quote` 执行：`checkQuoteApprover(sales.quote.signed_amount.approve)` → 报价在本企业且 `updatedAt === baseUpdatedAt`（否则失败"报价已变化，请重新提交"）→ `applyQuoteUpdate`（折扣三档按提交人身份）→ 审计 `sales.signed_quote.amount_changed`（提交人 / 批准人 / 改前改后总价 / selfApproved）→ 通知提交人；新建 `src/lib/sales/__tests__/signed-quote-amount-db.isolated.test.ts`（202 → 另一老板批准 → 总价更新且 `draft`；自批拒绝；提交后改备注再批准失败；唯一老板 409 `NO_APPROVER`）并注册（无隔离库自动跳过）。verify：本地 Postgres 16 + pgvector 隔离库跑通该测试。
- [ ] 3.4 `src/app/(main)/sales/quote-sheet/page.tsx` 保存：202 提示"改价已提交审批，批准后生效"；409 `SIGNED_QUOTE_APPROVAL_PENDING` / `NO_APPROVER` 显示服务端文案。verify：typecheck；`npx eslint "src/app/(main)/sales/quote-sheet/page.tsx"` 无新增 error。

## 4. 收尾

- [ ] 4.1 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；`openspec validate perm-4a-sales-authorize --strict` 通过；写 `docs/QINGYAN_PERM-4a_REPORT.md`（做了什么 / 怎么验 / BREAKING 与上线顺序 / 已知限制：唯一老板无人可批）；`docs/QINGYAN_PERMISSION_TASKFLOW.md` PERM-4a 改 `[G]`；更新 `docs/QINGYAN_PERMISSION_HANDOFF.md`。verify：四条命令退出 0；`grep -c "PERM-4a .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1。

## Workflow follow-up

- PR 合并后 `/opsx:archive perm-4a-sales-authorize --yes`（独立小 PR），TASKFLOW PERM-4a 改 `[x]`；确认 `openspec list --specs` 出现 `sales/record-access`、`sales/signed-quote-amount-approval`。
- 生产：合并前清查平台 `admin` 账号；合并后对 Sunny 重跑 `seedOrgAuthorizationProfiles`。
