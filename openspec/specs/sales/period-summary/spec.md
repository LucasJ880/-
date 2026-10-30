# sales/period-summary Specification

## Purpose
销售期间汇总：对任意一段当地日期区间给出成单、报价、转化、在手未签与定金的统一口径，按人拆分并与对比期比较，附带确定性洞察；所有看板、Muse 与叙述出口只认这一套数字。

## Requirements

### Requirement: 成单口径
期间汇总的"成单"SHALL 只计状态为 `signed` 或 `accepted`、且 `signedAt` 落在期间内的报价，每份已签报价各计一份（同一商机下多份已签报价是多张合同）。成单金额 SHALL 为上述报价 `grandTotal`（含税）之和，并同时给出 `preTaxTotal` 之和。成单金额 SHALL NOT 取商机的估值字段。

#### Scenario: 同一商机两份已签报价都计
- **WHEN** 某商机有两份已签报价，`signedAt` 分别为 10 月 3 日与 10 月 20 日，期间为 10 月 1 日至 28 日
- **THEN** 成单数为 2，成单金额为两份 `grandTotal` 之和；`npx tsx src/lib/sales/__tests__/period-pure.test.ts` 覆盖

#### Scenario: 签字后被修改回 draft 的报价不计
- **WHEN** 一份报价签字后被修改，签字作废、状态回到 `draft`
- **THEN** 该报价不计入成单

#### Scenario: 估值不进入成单金额
- **WHEN** 商机 `estimatedValue` 为 9,999，其唯一已签报价 `grandTotal` 为 5,000
- **THEN** 成单金额为 5,000

### Requirement: 报价口径
期间汇总的"报价"（报出去的）SHALL 只计 `sentAt` 落在期间内、且状态不是 `draft` 的报价（sent / viewed / accepted / signed / rejected / expired 均计）。同一商机的报价中，已签（`signed` / `accepted`）的 SHALL 每份都计，未签的 SHALL 只计 `sentAt` 最新的一份；没有关联商机的报价各计一份。报价金额 SHALL 为所计报价 `grandTotal` 之和。转化率 SHALL 为同期成单数除以报价数，报价数为 0 时 SHALL 为 `null`。

#### Scenario: 已过期与已拒绝的报价也算报出去
- **WHEN** 期间内发出的报价有 2 份 `expired`、1 份 `rejected`、3 份 `sent`
- **THEN** 报价数为 6，报价金额为六份 `grandTotal` 之和；`period-pure.test.ts` 覆盖

#### Scenario: 同一商机的修订版只计最新
- **WHEN** 某商机期间内先后发出未签报价 A（10 月 5 日）与 B（10 月 12 日），以及已签报价 C（10 月 20 日发出）
- **THEN** 报价数为 2（B 与 C），报价金额为 B 与 C 的 `grandTotal` 之和；`period-pure.test.ts` 覆盖

#### Scenario: 没有报价时转化率为空
- **WHEN** 期间内报价数为 0
- **THEN** `conversionRate` 为 `null`，不是 0 也不是错误

### Requirement: 在手未签与定金
期间汇总 SHALL 给出在手未签的数量与金额：取报价口径所计报价中 `signedAt` 为空、状态为 `sent` 或 `viewed` 的（同一提案的旧修订版不重复计），以及其中发出已超过 14 天的子集数量与金额；SHALL 给出 `depositCollectedAt` 落在期间内的 `depositAmount` 之和；SHALL 给出本期成单中 `depositCollectedAt` 为空（未登记定金）的数量与金额。

#### Scenario: 超过 14 天的子集
- **WHEN** 在手未签 5 份，其中 2 份 `sentAt` 距统计时刻超过 14 天
- **THEN** `openQuotedCount` 为 5，`staleOpenCount` 为 2，两者金额各自为对应报价 `grandTotal` 之和；`period-pure.test.ts` 覆盖

#### Scenario: 已签未登记定金
- **WHEN** 本期成单 4 份，其中 1 份已登记定金
- **THEN** `wonWithoutDepositCount` 为 3，`wonWithoutDepositAmount` 为另 3 份 `grandTotal` 之和；`period-pure.test.ts` 覆盖

### Requirement: 只汇总 CAD 报价
期间汇总的金额与计数 SHALL 只计币种为 CAD 的报价；落在期间内的非 CAD 报价 SHALL NOT 计入任何指标，其行数 SHALL 在 `totals.nonCadExcludedCount` 中给出。

#### Scenario: 外贸转入的美元报价
- **WHEN** 期间内有一份币种为 USD 的已签报价
- **THEN** 成单数与成单金额不含它，`nonCadExcludedCount` 为 1；`period-pure.test.ts` 覆盖

### Requirement: 排除已归档客户
期间汇总的全部指标 SHALL 只计客户未归档（`archivedAt` 为空）的报价，与销售首页一致。

#### Scenario: 归档客户的已签报价不计
- **WHEN** 期间内某已签报价的客户已被归档
- **THEN** 该报价不计入成单、报价、在手与定金；`period-db.isolated.test.ts` 覆盖

### Requirement: 期间按组织时区的当地日解释
`from` 与 `to` SHALL 为 `YYYY-MM-DD` 的当地日期，期间 SHALL 为组织时区下 `from` 当日零点（含）到 `to` 次日零点（不含）；组织未设置时区时 SHALL 用系统默认时区（多伦多）。缺省期间 SHALL 为组织当地的本月 1 日至今天。

#### Scenario: 月末最后一刻落在期间内
- **WHEN** 组织时区为 America/Toronto，期间为 10 月 1 日至 10 月 28 日，一份报价在当地 10 月 28 日 23:30 签字
- **THEN** 该报价计入成单；当地 10 月 29 日 00:10 签字的不计；`period-pure.test.ts` 覆盖

### Requirement: 期间参数校验
`GET /api/sales/period-summary` 的 `from` / `to` 不是合法日期、`to` 早于 `from`、或跨度超过 366 天时 SHALL 返回 400，响应 `code` 为 `INVALID_PERIOD`；`compare` 只接受 `prev_period` 与 `prev_month`，缺省为 `prev_period`，其它值 SHALL 返回 400 `INVALID_PERIOD`。

#### Scenario: 跨度超限
- **WHEN** 请求 `from=2025-01-01&to=2026-06-30`
- **THEN** 返回 400，`code` 为 `INVALID_PERIOD`；隔离库测试 `period-db.isolated.test.ts` 覆盖

### Requirement: 对比期
响应 SHALL 附带对比期的同口径汇总与变化率：`prev_period` 为紧邻在 `from` 之前、与本期同样天数的区间；`prev_month` 为上一个自然月中与本期相同日号的区间（日号超过该月天数时截到该月最后一天）。变化率 SHALL 为（本期 − 对比期）/ 对比期，对比期为 0 时 SHALL 为 `null`。

#### Scenario: 上月同期
- **WHEN** 本期为 10 月 1 日至 10 月 28 日、`compare=prev_month`
- **THEN** 对比期为 9 月 1 日至 9 月 28 日；本期为 3 月 31 日单日时对比期为 2 月 28 日（平年）；`period-pure.test.ts` 覆盖

### Requirement: 读范围与按人拆分
`GET /api/sales/period-summary` SHALL 按 `sales.analytics.read` 授权：无该权限 SHALL 返回 403；持 ORG 范围的调用者 SHALL 得到全企业汇总与按报价创建人拆分的 `byRep`；只持 PRINCIPAL 范围的调用者 SHALL 只得到本人创建的报价汇总，`byRep` SHALL 只含本人一行，响应 SHALL NOT 含其他人的任何数字或姓名。所有查询 SHALL 限定当前企业。

#### Scenario: 销售只看到自己
- **WHEN** 只持 `sales_rep` 岗位的销售请求期间汇总，企业内另一位销售同期有成单
- **THEN** `scope` 为 `own`，`totals` 只含本人数字，`byRep` 只有本人一行；`period-db.isolated.test.ts` 覆盖

#### Scenario: 老板看全企业
- **WHEN** 持 `owner` 岗位的用户请求期间汇总
- **THEN** `scope` 为 `org`，`totals` 为全企业，`byRep` 含每位有报价或成单的创建人各一行，按成单金额降序

#### Scenario: 跨企业不可见
- **WHEN** 另一企业的老板请求本企业的期间汇总
- **THEN** 响应中不含本企业任何报价的数字

### Requirement: 响应结构
成功响应 SHALL 含 `period`（from / to / days / timezone）、`scope`（`org` 或 `own`）、`totals`、`comparison`（kind / period / totals / delta）、`byRep`、`insights`、`calendar`（见"期间日程来源字段"）、`narrative`（固定为 `null`）。`totals` SHALL 含 `wonCount`、`wonAmount`、`wonPreTax`、`quotedCount`、`quotedAmount`、`conversionRate`、`openQuotedCount`、`openQuotedAmount`、`staleOpenCount`、`staleOpenAmount`、`depositAmount`、`wonWithoutDepositCount`、`wonWithoutDepositAmount`、`nonCadExcludedCount`；金额单位为 CAD。

#### Scenario: 字段齐全
- **WHEN** 老板请求 `from=2026-10-01&to=2026-10-28`，该企业未开启日历观察
- **THEN** 响应含上述全部键，`period.days` 为 28，`calendar` 与 `narrative` 为 `null`；`period-db.isolated.test.ts` 覆盖

### Requirement: 取数上限不静默
单次期间汇总取数 SHALL 有行数上限（20,000 行）；命中上限时响应 SHALL 带 `truncated: true` 且看板 SHALL 显示结果不完整的提示，未命中时 `truncated` 为 `false`。

#### Scenario: 未命中上限
- **WHEN** 老板请求 10 月期间汇总，企业 10 月报价远少于上限
- **THEN** 响应 `truncated` 为 `false`；`period-pure.test.ts` 覆盖透传

### Requirement: 确定性洞察
响应 `insights` SHALL 只由期间汇总的数字按固定规则表生成，SHALL NOT 调用任何模型，同样输入 SHALL 得到同样输出。每条洞察 SHALL 含 `code`、`severity`（info / warn）、`text`、`evidence`。规则为：成单金额环比达 ±20%（I1）、报价金额环比达 ±20%（I2）、超 14 天未签金额占在手 30% 以上或条数达 5（I3）、报价数达 10 且转化率低于 30%（I4）、某创建人本期报价为 0 而上一期大于 0（I5）、单人成单金额占全企业 60% 以上且企业成单数达 5（I6）、已签未登记定金达 3 份（I7）、日程不明来源大于 0（I8）、网站预约占新建日程 40% 以上（I9）。

#### Scenario: 环比触发
- **WHEN** 本期成单金额 63,000、对比期 51,900（+21.4%）
- **THEN** 出现 `code=I1_WON_DELTA`、`severity=info` 的洞察，`evidence` 含两期金额；`npx tsx src/lib/sales/__tests__/period-insights.test.ts` 覆盖

#### Scenario: 环比未达阈值不触发
- **WHEN** 本期成单金额 61,230、对比期 51,900（+18.0%），或对比期为 0
- **THEN** 不出现 `I1_WON_DELTA`

#### Scenario: 日程数据缺失时不出日程洞察
- **WHEN** `calendar` 为 `null`
- **THEN** 不出现 `I8_CAL_UNKNOWN` 与 `I9_CAL_WEBSITE_SHARE`

### Requirement: 销售范围不输出团队洞察
PRINCIPAL 范围的响应 SHALL NOT 含 `I5_REP_SILENT` 与 `I6_REP_CONCENTRATION`，其 `insights` 的 `text` 与 `evidence` SHALL NOT 含其他人的姓名或金额。

#### Scenario: 销售看不到集中度洞察
- **WHEN** 只持 `sales_rep` 岗位的销售请求期间汇总，且企业层面满足 I6 触发条件
- **THEN** 响应 `insights` 不含 `I6_REP_CONCENTRATION`；`period-insights.test.ts` 覆盖

### Requirement: 看板展示
`/sales/home` SHALL 提供期间选择（本月至今、上月、本季、最近 30 天、自定义），选择 SHALL 体现在 URL 查询参数并在刷新后保留；SHALL 展示成单数、成单金额、报价数、报价金额、转化率、在手未签六个指标及其对比期变化；ORG 范围 SHALL 展示按人表，PRINCIPAL 范围 SHALL 只展示本人一行；SHALL 按 `severity` 展示洞察列表。销售驾驶舱"本月签约"瓦片的标签 SHALL 改为"本月签约（商机估值）"，计算不变。

#### Scenario: 无分析权限时首页不受影响
- **WHEN** 持 `sales.customer.read`、不持 `sales.analytics.read` 的用户打开 `/sales/home`
- **THEN** 期间面板不显示，页面不出现错误提示，首页其余内容与改动前相同

#### Scenario: 刷新保留期间
- **WHEN** 用户在 `/sales/home` 选择"上月"后刷新页面
- **THEN** 页面仍显示上月的期间汇总；可观察产物：URL 含 `from` / `to` 查询参数，`npm run build` 通过

### Requirement: 期间日程来源字段
响应的 `calendar` SHALL 在该企业日历观察开启且范围为 `org` 时给出期间日程来源统计（`bySource` 与按成员新建数），否则为 `null`。

#### Scenario: 开启日历观察后有日程来源
- **WHEN** 该企业开启日历观察，老板请求 10 月期间汇总，账本中 10 月新建网站预约 4 条、成员日程 6 条
- **THEN** `calendar.bySource.website` 为 4、`member` 为 6，洞察中出现 `I9_CAL_WEBSITE_SHARE`；`period-db.isolated.test.ts` 覆盖

#### Scenario: 销售范围不给日程统计
- **WHEN** 同一企业只持 `sales_rep` 的销售请求期间汇总
- **THEN** `calendar` 为 `null`

### Requirement: 看板展示日程来源
`/sales/home` 期间面板 SHALL 在响应 `calendar` 非空时展示期间内新建日程的来源分布（青砚 / 成员 / 网站 / 不明）与按成员的新建数；`calendar` 为 `null` 时 SHALL NOT 显示该块，也 SHALL NOT 显示错误提示。

#### Scenario: 未开启观察
- **WHEN** 老板打开首页，企业未开启日历观察
- **THEN** 期间面板没有"日程来源"一块，其余内容不变；可观察产物：`npm run build` 通过，浏览器检查记录写入报告

### Requirement: 叙述开关回显
`GET /api/sales/period-summary` 的成功响应 SHALL 含布尔字段 `narrativeEnabled`，取值等于 AI 解读开关是否开启；`narrative` 字段 SHALL 仍固定为 `null`（解读只经独立接口按需生成）。

#### Scenario: 开关关闭
- **WHEN** 未设置 `SALES_PERIOD_NARRATIVE_ENABLED`，老板请求期间汇总
- **THEN** `narrativeEnabled` 为 `false`，`narrative` 为 `null`；`period-narrative-db.isolated.test.ts` 覆盖

#### Scenario: 开关开启
- **WHEN** `SALES_PERIOD_NARRATIVE_ENABLED=true`，老板请求期间汇总
- **THEN** `narrativeEnabled` 为 `true`，`narrative` 仍为 `null`
