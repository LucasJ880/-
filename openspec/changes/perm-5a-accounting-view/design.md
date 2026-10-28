# Design

## Context

- 本人提成：`src/app/api/sales/commission-summary/route.ts` 内联计算（`createdById = 本人`、`status = signed`、`signedAt >= 本月 1 日`；毛利 = Σ(price − costPrice) 只算有成本的行；提成 = 毛利 × `commissionRate`）。没有任何会计接口或页面。
- 报价审批轨迹直接在 `SalesQuote` 列上：`promotionApprovalStatus / Ratio / MaxPct / RequestedAt`、`promotionApprovedAt / ById`、`promotionRejectedAt / ById`、`finalDiscountPct`、`specialPromotion`、`totalMsrp`。
- 项目财务：`getTenderFinancialSummary(orgId, projectId)` 一次算完单项目成本 / 收入 / 结算 / 利润（收入与结算在 `TENDER_PROFITABILITY_SCHEMA_READY` 关闭时如实标 unavailable）；全部财务接口先过 `isFinancialControlEnabled()`（生产默认关）。既有单项目财务路由走 `requireCostAccess` → `requireProjectReadAccess`（要求负责人 / org_admin / 项目成员）。
- `accounting` 模板已有 `accounting.read`、`sales.quote.read`、`sales.customer.read`、`project.read`（ORG）；`owner` 已有 `accounting.read`。

## Goals / Non-Goals

**Goals**：会计看全员成交与提成（同一口径、可导出留痕）、报价全过程、项目结算汇总；招投标参与方只看参与项目的结算汇总；会计入口与默认落地。

**Non-Goals**：
- 不改 `src/lib/project-finance/access.ts`（`requireCostAccess`）与 `src/lib/projects/access.ts`（`requireProjectReadAccess`），不改 `src/app/api/projects/[id]/finance/**`。
- 不改 `src/app/(main)/sales/performance/page.tsx` 与 `/api/sales/quote-settings/**`。
- 不改 `src/lib/project-finance/**` 的计算。

## Decisions

### D1 提成口径抽成纯函数，两处共用
`src/lib/accounting/commission.ts` `summarizeCommission(quotes, rate)` 返回 `{ quotesSigned, quotesWithCost, itemsCosted, itemsTotal, signedAmount, realMargin, realCommission }`（四舍五入到分，逻辑逐行照搬现有路由）；`groupCommissionBySales` 按 `createdById` 分组。本人接口改调它，响应字段只取原有那些（不新增 `signedAmount`）。
- 否决：会计接口另写一份计算——两套口径会漂移，任务书明确要求共用。

### D2 月份窗口 `[本月 1 日, 下月 1 日)`，服务器本地时间
`parseMonth("YYYY-MM")` → `{ start, end }`；缺省本月。本人接口仍只用 `start`（`signedAt >= start`，本月之后不会有签约，行为不变）。
- 否决：改用 UTC——会让本人接口的边界与业绩页不一致。

### D3 新键 `project.finance.read`（ASSIGNED / ORG），只在 5a 新增这一个
`accounting` / `owner` ORG，`bids` ASSIGNED。项目结算接口用 `authorize` 不带资源取 scopes：含 ORG → 企业全部已派发项目；只有 ASSIGNED → `members some { userId, status: active }` 或 `ownerId = 本人`。
- 否决：等 PERM-4c 再做——用户要求 5a 不等 4c；4c 其余 `project.finance.*` 键照旧在 4c。
- 否决：`bids` 用 ORG——拍板 3 要求只看参与项目。

### D4 不改既有单项目财务路由的授权（偏离任务书 What-3 的"`requireCostAccess` 只读分支接受该权限"）
`requireCostAccess` 先过 `requireProjectReadAccess`，会计不是项目成员时在那一步就 403；要让它生效必须改项目读权限口径，属于 PERM-4c。会计的项目结算走新接口 `/api/accounting/projects`，直接调 `getTenderFinancialSummary`，只取汇总字段。
- 否决：在 `requireCostAccess` 加分支——对会计无效（被前一步拦），对已是项目成员的 `bids` 反而放开了逐笔费用，违反拍板 3。

### D5 报价过程走显式 select
`prisma.salesQuote.findMany({ select })` 只选规格列出的字段；客户只选 `name`；批准人 / 驳回人用一次 `user.findMany` 取 `name`。最多 500 条。
- 否决：复用销售列表接口——它返回客户联系方式与行明细。

### D6 CSV 服务端生成 + 审计
`format=csv` 由同一接口返回（`text/csv; charset=utf-8`，带 BOM 便于 Excel），`logAudit({ action: "accounting.export", targetType: "accounting_sales_summary", targetId: month, afterData: { rows } })`。
- 否决：前端拼 CSV——无法留审计。

### D7 入口与默认落地
`workspace-policy.ts` 新增 `canAccessAccountingWorkspace`（`accounting.read` 或 `project.finance.read`）与 `WorkspaceId "accounting"`；`getDefaultWorkspace` 在招投标分支前判断"持 `accounting.read`、非销售 / 运营专职、不持 `project.create|update`、`operations.*`"→ `/accounting`。导航 `biz-accounting`（`workspaceAccess: "accounting"`，`requireMembership`）。页面调三个接口，403 的页签不显示。
- 否决：只靠 `requiredPermissions` 不加工作区——默认落地需要工作区判定，与 INSTALL-1 的 `/install` 做法一致。

## 与八条硬纪律的关系

1. 零 schema：触碰。只读既有列；新键是代码常量；审计落 AuditLog。
2. 出站先审批：不涉及（全只读；CSV 是下载，不对外发送）。
3. 第三套队列：不涉及。
4. 脱敏：触碰（数据面）。会计视图不出逐行成本、客户联系方式；Muse 通道不涉及。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：触碰。全部是确定性汇总；不新增 LLM 调用。
8. 测试注册：触碰。新测试注册 `scripts/test-all.sh`，纯测试同时进 `scripts/test-ci-unit.sh`。

## Risks / Trade-offs

- 项目财务在生产默认关闭 → 项目结算页签今天显示"未启用"，这是如实状态。
- 项目结算逐个项目调用 `getTenderFinancialSummary`（每个项目数次查询），上限 100 个项目；Sunny 项目量远小于此。
- 平台 super_admin 经平台管理员全权持 `accounting.read` / `project.finance.read`，可进会计页（与其他模块一致）。

## 验证方式

- `npx tsx src/lib/accounting/__tests__/accounting.test.ts`（新，纯：`summarizeCommission` 与原内联逻辑逐项等价、分组、无成本单、月份 / 季度解析、CSV 转义、工作区与导航、源码断言 select 不含敏感列）
- `src/lib/accounting/__tests__/accounting-db.isolated.test.ts`（新，隔离库：销售 403、会计 200 且无 `costPrice` / 联系方式、按人分组、本人接口与汇总一致、CSV + 审计、报价审批轨迹与过滤、项目结算 ORG / ASSIGNED / 关闭、招投标看不到成交）
- `npx tsx src/lib/authorization/__tests__/authorize.test.ts`、`workspace-policy` / `default-workspace` / `home-redirect` / `navigation-workspace` 回归
- `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate perm-5a-accounting-view --strict`
