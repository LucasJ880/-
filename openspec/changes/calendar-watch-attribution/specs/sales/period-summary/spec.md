# Spec Delta

## MODIFIED Requirements

### Requirement: 响应结构
成功响应 SHALL 含 `period`（from / to / days / timezone）、`scope`（`org` 或 `own`）、`totals`、`comparison`（kind / period / totals / delta）、`byRep`、`insights`、`calendar`、`narrative`（固定为 `null`）。`calendar` SHALL 在该企业日历观察开启且范围为 `org` 时给出期间日程来源统计（`bySource` 与按成员新建数），否则为 `null`。`totals` SHALL 含 `wonCount`、`wonAmount`、`wonPreTax`、`quotedCount`、`quotedAmount`、`conversionRate`、`openQuotedCount`、`openQuotedAmount`、`staleOpenCount`、`staleOpenAmount`、`depositAmount`、`wonWithoutDepositCount`、`wonWithoutDepositAmount`、`nonCadExcludedCount`；金额单位为 CAD。

#### Scenario: 字段齐全
- **WHEN** 老板请求 `from=2026-10-01&to=2026-10-28`，该企业未开启日历观察
- **THEN** 响应含上述全部键，`period.days` 为 28，`calendar` 与 `narrative` 为 `null`；`period-db.isolated.test.ts` 覆盖

#### Scenario: 开启日历观察后有日程来源
- **WHEN** 该企业开启日历观察，老板请求 10 月期间汇总，账本中 10 月新建网站预约 4 条、成员日程 6 条
- **THEN** `calendar.bySource.website` 为 4、`member` 为 6，洞察中出现 `I9_CAL_WEBSITE_SHARE`；`period-db.isolated.test.ts` 覆盖

#### Scenario: 销售范围不给日程统计
- **WHEN** 同一企业只持 `sales_rep` 的销售请求期间汇总
- **THEN** `calendar` 为 `null`

## ADDED Requirements

### Requirement: 看板展示日程来源
`/sales/home` 期间面板 SHALL 在响应 `calendar` 非空时展示期间内新建日程的来源分布（青砚 / 成员 / 网站 / 不明）与按成员的新建数；`calendar` 为 `null` 时 SHALL NOT 显示该块，也 SHALL NOT 显示错误提示。

#### Scenario: 未开启观察
- **WHEN** 老板打开首页，企业未开启日历观察
- **THEN** 期间面板没有"日程来源"一块，其余内容不变；可观察产物：`npm run build` 通过，浏览器检查记录写入报告
