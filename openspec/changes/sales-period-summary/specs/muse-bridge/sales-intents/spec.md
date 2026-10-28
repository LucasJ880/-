# Spec Delta

## MODIFIED Requirements

### Requirement: 契约只追加

`muse-bridge/v1` SHALL 接受 `sales_overview`（可选 `days` 1–90、`assigneeUserId`、`limit` 1–20、可选 `period`：`{ from, to }` 两个 `YYYY-MM-DD` 当地日期，`to` 不早于 `from` 且跨度不超过 366 天）与 `opportunity_status`（必填 `opportunityId`）；越界或缺参 SHALL 整包拒绝为 `VALIDATION_FAILED`；未知字段 SHALL 被丢弃；既有 12 个意图的解析结果 SHALL 不变。

#### Scenario: 合法与非法参数

- **WHEN** 解析 `{intent:"sales_overview", days:30}`、`{intent:"sales_overview", days:0}`、`{intent:"opportunity_status"}`
- **THEN** 第一条成功，后两条失败；`npx tsx src/lib/muse-bridge/__tests__/muse-bridge-pure.test.ts` 断言意图总数为 14

#### Scenario: period 参数校验

- **WHEN** 解析 `{intent:"sales_overview", period:{from:"2026-10-01", to:"2026-10-28"}}`、`{intent:"sales_overview", period:{from:"2026-10-28", to:"2026-10-01"}}`、`{intent:"sales_overview", period:{from:"2026/10/01", to:"2026-10-28"}}`
- **THEN** 第一条成功，后两条 `VALIDATION_FAILED`；`muse-bridge-pure.test.ts` 覆盖

## ADDED Requirements

### Requirement: 期间汇总随 sales_overview 输出
`sales_overview` 带 `period` 时，响应 `data.period` SHALL 附带与看板同一口径的期间汇总（期间、成单数、报价数、转化率、在手未签数），范围与意图的读范围一致（管理范围为全企业，销售范围为本人创建的报价）；不带 `period` 时 SHALL NOT 出现 `data.period`，响应其余内容 SHALL 与改动前相同。

#### Scenario: 管理者带 period

- **WHEN** 管理角色调用 `sales_overview` 并带 `period`
- **THEN** `data.period.totals` 含 `wonCount`、`wonAmount`、`quotedCount`、`quotedAmount`、`conversionRate`、`openQuotedCount`，数字与 `GET /api/sales/period-summary` 同期同范围一致；隔离库测试 `sales-db.isolated.test.ts` 覆盖

#### Scenario: 不带 period 时不变

- **WHEN** 调用 `sales_overview` 不带 `period`
- **THEN** `data` 中没有 `period` 键；`sales-pure.test.ts` 覆盖

### Requirement: 期间汇总遵守决定 B
销售范围的 `data.period` SHALL NOT 含 `wonAmount`、`wonPreTax`、`quotedAmount`、`openQuotedAmount`、`staleOpenAmount`、`depositAmount` 任一金额字段，结论与理由文字 SHALL NOT 含期间金额数字；管理范围 SHALL 输出上述金额。

#### Scenario: 销售带 period 只得到计数

- **WHEN** 平台角色为 sales 的用户调用 `sales_overview` 并带 `period`，本人期间内有已签报价
- **THEN** `data.period.totals` 含 `wonCount` 与 `quotedCount`，不含任何以 `Amount` 或 `PreTax` 结尾的键，响应 JSON 中不出现该报价的 `grandTotal` 数字；`sales-db.isolated.test.ts` 覆盖
