# Spec Delta

## Purpose

在销售期间看板上按需生成一段 AI 解读：只解读 KPI-1 已算好的期间汇总与确定性洞察，数字不得由模型产生，任何校验不过即整段回落为空，开关默认关。

## ADDED Requirements

### Requirement: 解读接口与授权
`POST /api/sales/period-summary/narrative?from&to&compare` SHALL 按 `sales.analytics.read` 授权（无权限 403），期间参数的解析与校验 SHALL 与期间汇总相同（不合法 400 `INVALID_PERIOD`）；全企业范围解读全企业数据，本人范围只解读本人数据。开关关闭时 SHALL 返回 404 `NARRATIVE_DISABLED` 且不调用模型。

#### Scenario: 开关关闭
- **WHEN** 未设置 `SALES_PERIOD_NARRATIVE_ENABLED`，老板请求解读
- **THEN** 返回 404 `NARRATIVE_DISABLED`，模型调用次数为 0；`period-narrative-db.isolated.test.ts` 覆盖

#### Scenario: 无权限
- **WHEN** 开关开启，不持 `sales.analytics.read` 的成员请求解读
- **THEN** 返回 403，模型调用次数为 0

#### Scenario: 期间不合法
- **WHEN** 开关开启，老板请求 `from=2026-10-28&to=2026-10-01`
- **THEN** 返回 400 `INVALID_PERIOD`，模型调用次数为 0

### Requirement: 响应结构
成功响应 SHALL 含 `period`、`scope`、`narrative`、`fallbackReason`。`narrative` 非空时 SHALL 含 `conclusion`（1–3 句）、`reasons`（0–3 条，每条含文字与引用的洞察代码）、`nextSteps`（0–3 条，每条含动作键与文字）、`model`、`generatedAt`；校验不过时 `narrative` 为 `null`，`fallbackReason` 为 `invalid_format`、`invalid_numbers`、`invalid_reference`、`model_error` 或 `budget_exceeded` 之一，成功时为 `null`。

#### Scenario: 解读通过校验
- **WHEN** 开关开启，模型返回只用输入数字、引用输入洞察、动作在词表内的解读
- **THEN** 返回 200，`narrative.conclusion` 非空，`fallbackReason` 为 `null`；`period-narrative-db.isolated.test.ts` 以注入的模型调用覆盖

### Requirement: 数字不得由模型产生
解读中出现的每一个数字（含千分位、小数、百分比、正负号、货币符号与"万"单位）SHALL 能在模型输入的数值集合（含其按 0–2 位小数取整、百分比与"万"换算的写法，以及期间日期与天数）中找到；任一数字找不到，或出现中文数字加计量词（如"六份""三成"），整段 SHALL 丢弃，返回 `narrative = null`、`fallbackReason = invalid_numbers`。

#### Scenario: 编造数字
- **WHEN** 输入的成单金额为 61,230.5，模型写"本期成单 65,000"
- **THEN** `narrative` 为 `null`，`fallbackReason` 为 `invalid_numbers`；`period-narrative-pure.test.ts` 与隔离库测试覆盖

#### Scenario: 合法写法
- **WHEN** 输入转化率 0.4035、成单金额 61230.5，模型写"转化率 40.4%，成单 $61,230.50"
- **THEN** 数字校验通过；`period-narrative-pure.test.ts` 覆盖

#### Scenario: 中文数字
- **WHEN** 模型写"有六份报价超过 14 天未签"
- **THEN** 整段丢弃，`fallbackReason` 为 `invalid_numbers`

### Requirement: 原因与下一步可追溯
每条原因 SHALL 至少引用一个输入中存在的洞察代码；每条下一步的动作 SHALL 取自固定词表 `chase_signature`（催签）、`record_deposit`（补定金）、`review_rep`（看某销售）、`fix_calendar_rule`（补日程规则），且只在输入满足对应前提时可用：催签需在手未签数 > 0，补定金需已签未登记定金数 > 0，看某销售需全企业范围且销售姓名在按人表中，补日程规则需日程不明来源数 > 0。不满足 SHALL 整段丢弃，`fallbackReason = invalid_reference`；输出不是约定格式 SHALL 整段丢弃，`fallbackReason = invalid_format`。

#### Scenario: 引用不存在的洞察
- **WHEN** 输入只有 `I3_STALE_OPEN`，模型原因引用 `I1_WON_DELTA`
- **THEN** `narrative` 为 `null`，`fallbackReason` 为 `invalid_reference`；`period-narrative-pure.test.ts` 覆盖

#### Scenario: 本人范围看某销售
- **WHEN** 销售本人范围的解读给出 `review_rep`
- **THEN** 整段丢弃，`fallbackReason` 为 `invalid_reference`

### Requirement: 模型输入不含敏感信息
发给模型的输入 SHALL 只含期间、范围、汇总与对比数字、按人表（全企业范围时含销售姓名）、洞察（代码、等级、文字、证据数字）与日程来源计数；SHALL NOT 含客户姓名、电话、邮箱、地址、报价行明细、毛利或成本，本人范围 SHALL NOT 含他人姓名或数字。

#### Scenario: 本人范围输入
- **WHEN** 销售本人范围请求解读
- **THEN** 模型收到的输入只有本人一行，不含其他销售姓名；`period-narrative-db.isolated.test.ts` 检查注入调用收到的提示词

### Requirement: 一次调用与失败回落
每次请求 SHALL 只发起一次模型调用，本功能不另行重试（SDK 传输层对限流与服务端错误的既有自动重试不变），不缓存、不持久化解读正文；模型报错或超时 SHALL 返回 200、`narrative = null`、`fallbackReason = model_error`；月 AI 费用已达上限 SHALL 返回 `fallbackReason = budget_exceeded`。同一成员每分钟超过 6 次 SHALL 返回 429 `RATE_LIMITED` 且不调用模型。

#### Scenario: 模型报错
- **WHEN** 注入的模型调用抛错
- **THEN** 返回 200，`narrative` 为 `null`，`fallbackReason` 为 `model_error`；`period-narrative-db.isolated.test.ts` 覆盖

### Requirement: 生成审计
每次调用了模型的请求 SHALL 写一条审计（动作 `sales.period_narrative.generated`），含结果（通过或回落原因）、模型、范围、期间与耗时；SHALL NOT 含解读正文或任何金额。

#### Scenario: 回落也记审计
- **WHEN** 一次解读因编造数字被丢弃
- **THEN** 审计记录结果为 `invalid_numbers`，记录中不含解读文字与金额；`period-narrative-db.isolated.test.ts` 覆盖

### Requirement: 面板展示
`/sales/home` 期间面板 SHALL 只在 `narrativeEnabled` 为 `true` 时显示"生成解读"按钮，点击后才请求解读，页面加载时 SHALL NOT 自动请求；解读 SHALL 标注"AI 解读 · 数字已与看板核对"，按结论、原因、下一步三段展示；回落时 SHALL 显示"本次解读未通过核对，已以上方确定性洞察为准"，不显示模型原文。

#### Scenario: 开关关闭不显示按钮
- **WHEN** 开关关闭，老板打开首页
- **THEN** 期间面板没有"生成解读"按钮，也没有解读请求；可观察产物：浏览器检查记录写入报告
