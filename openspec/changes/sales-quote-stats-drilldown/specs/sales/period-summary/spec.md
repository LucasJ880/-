# Spec Delta

## ADDED Requirements

### Requirement: 按人报价明细
`GET /api/sales/period-summary/quotes?from&to&repId&kind` SHALL 返回指定报价创建人在期间内计入成单与报价的报价清单，每行含报价 ID、报价单号、客户名、发送时间、签字时间、含税总额、状态、价表版本；两组的条数与金额小计 SHALL 与同期间按人表该行一致（同一分组规则：草稿、非 CAD、归档客户不计，同商机未签只计最新一份）。授权 SHALL 同期间汇总：无 `sales.analytics.read` 返回 403；只持本人范围时 `repId` 缺省为本人、为他人 SHALL 返回 403；全企业范围缺 `repId` SHALL 返回 400。`kind` 只能是 `won` 或 `quoted`，缺省两组都返回；每组最多 500 行，超出 SHALL 带 `truncated: true`。

#### Scenario: 明细合计等于按人表
- **WHEN** 老板请求本期销售 A 的明细，A 有 2 份已发送、1 份已签、1 份草稿
- **THEN** 两组条数与金额小计等于期间汇总里 A 的按人行，草稿不出现；`period-db.isolated.test.ts` 覆盖

#### Scenario: 销售不能看别人
- **WHEN** 只持 `sales_rep` 岗位的销售 B 请求销售 A 的明细
- **THEN** 返回 403；不带 `repId` 时返回 B 本人的明细

#### Scenario: 全企业范围缺 repId
- **WHEN** 老板请求明细但不带 `repId`
- **THEN** 返回 400 `INVALID_REP`

### Requirement: 报价列表按销售筛选
`GET /api/sales/quotes/list` SHALL 接受 `createdById` 参数，在既有 `sales.quote.read` 授权范围内只返回该创建人的报价，并 SHALL 返回授权范围内出现过的报价创建人名单（ID 与姓名）与每份报价的创建人 ID。`/sales/quotes` SHALL 在名单多于一人时提供"按销售"筛选，筛选 SHALL 写入 URL `rep` 参数并在刷新后保留。

#### Scenario: 老板筛选销售 A
- **WHEN** 老板请求 `createdById=<A>`
- **THEN** 只返回 A 创建的报价，`reps` 含 A 与 B；`period-db.isolated.test.ts` 覆盖

#### Scenario: 销售只看到自己
- **WHEN** 只能读本人报价的销售请求列表并带 `createdById=<他人>`
- **THEN** 返回空列表，不泄露他人报价

## MODIFIED Requirements

### Requirement: 响应结构
成功响应 SHALL 含 `period`（from / to / days / timezone）、`scope`（`org` 或 `own`）、`totals`、`comparison`（kind / period / totals / delta）、`byRep`、`insights`、`calendar`（见"期间日程来源字段"）、`narrative`（固定为 `null`）、`draftsUnsent`。`totals` SHALL 含 `wonCount`、`wonAmount`、`wonPreTax`、`quotedCount`、`quotedAmount`、`conversionRate`、`openQuotedCount`、`openQuotedAmount`、`staleOpenCount`、`staleOpenAmount`、`depositAmount`、`wonWithoutDepositCount`、`wonWithoutDepositAmount`、`nonCadExcludedCount`；金额单位为 CAD。`draftsUnsent.count` SHALL 为调用者范围内、客户未归档、期间内创建且仍为草稿的报价数，SHALL NOT 计入任何金额或 `totals`。

#### Scenario: 字段齐全
- **WHEN** 老板请求 `from=2026-10-01&to=2026-10-28`，该企业未开启日历观察
- **THEN** 响应含上述全部键，`period.days` 为 28，`calendar` 与 `narrative` 为 `null`；`period-db.isolated.test.ts` 覆盖

#### Scenario: 草稿计数按范围
- **WHEN** 期间内销售 A、B 各有 1 份草稿
- **THEN** 老板看到 `draftsUnsent.count` 为 2，销售 A 看到 1；`totals` 不受影响；`period-db.isolated.test.ts` 覆盖

### Requirement: 看板展示
`/sales/home` SHALL 提供期间选择（本周、上周、本月至今、上月、本季、最近 30 天、自定义；一周从周一开始，"今天"按组织时区），选择 SHALL 体现在 URL 查询参数并在刷新后保留；SHALL 展示成单数、成单金额、报价数、报价金额、转化率、在手未签六个指标及其对比期变化；ORG 范围 SHALL 展示按人表，PRINCIPAL 范围 SHALL 只展示本人一行；按人表每行 SHALL 可展开该人的报价明细（见"按人报价明细"），ORG 范围的行 SHALL 提供到按该销售筛选的报价列表的链接；`draftsUnsent.count` 大于 0 时 SHALL 显示"本期草稿未发送 N 份"并链到草稿列表；SHALL 按 `severity` 展示洞察列表。销售驾驶舱"本月签约"瓦片的标签 SHALL 改为"本月签约（商机估值）"，计算不变。

#### Scenario: 无分析权限时首页不受影响
- **WHEN** 持 `sales.customer.read`、不持 `sales.analytics.read` 的用户打开 `/sales/home`
- **THEN** 期间面板不显示，页面不出现错误提示，首页其余内容与改动前相同

#### Scenario: 刷新保留期间
- **WHEN** 用户在 `/sales/home` 选择"上月"后刷新页面
- **THEN** 页面仍显示上月的期间汇总；可观察产物：URL 含 `from` / `to` 查询参数，`npm run build` 通过

#### Scenario: 本周从周一起
- **WHEN** 组织当地今天是 2026-10-28（周三），用户选"本周"
- **THEN** 期间为 2026-10-26 至 2026-10-28；"上周"为 2026-10-19 至 2026-10-25；`period-drilldown-pure.test.ts` 覆盖区间计算
