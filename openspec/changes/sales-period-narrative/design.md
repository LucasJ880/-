# Design — sales-period-narrative（KPI-2）

## Context

动机见 proposal.md。现状（2026-10-29 对 main `173cbabe` 核对）：

- **KPI-1 已交付**：`loadSalesPeriodSummary`（`src/lib/sales/period/load.ts`）一次给出 `period / scope / totals / comparison / byRep / insights / calendar / truncated`，`narrative` 固定 `null`。洞察九条在 `src/lib/sales/period/insights.ts`，阈值表 `INSIGHT_THRESHOLDS`（0.2 / 0.3 / 5 / 10 / 0.3 / 0.6 / 5 / 3 / 0.4），在手未签"超 14 天"常量 `STALE_OPEN_DAYS = 14`（`summary-pure.ts`）。Muse `sales_overview` 只取 `period` 与 `totals`，不受本 change 影响。
- **LLM 调用基础设施**：`createCompletionDetailed`（`src/lib/ai/client.ts:170`）。
  - 传 `orgId + userId` 时先做月费用预检，超限抛"配额限制：月 AI 费用已达 hard limit"。
  - 调用后经 `recordAiCall → usage-ledger-bridge` 记入既有 AI 用量台账。
  - `mode: "fast"` 的模型取 `ProviderRouter.getFastModel()`（`src/lib/ai/config.ts`），缺省 2048 token、温度 0.6、`reasoningEffort: low`。
  - 设计稿 §3.5 写的"模型经 ProviderRouter"只对模型选择成立；调用本身走 `getClient()`。本设计按实际情况写。
- **限次**：`checkRateLimitAsync({ name, windowMs, maxRequests }, key)`（`src/lib/common/rate-limit.ts`，有 Upstash 时走 Redis），用法见 `src/app/api/ai/chat/route.ts:51`。
- **开关惯例**：环境变量字符串比较，如 `process.env.AGENT_CORE_ENABLED === "true"`；`.env.example` 有同类说明。
- **纪律 7**：`openspec/config.yaml` 第 7 条"不增加新的 LLM 调用"。Evan 2026-10-29 拍板为 KPI-2 开例外（用户转达），config 原文尚未改。

## Goals / Non-Goals

**Goals:**
- 数字只来自 KPI-1：模型输出里任何一个对不上输入的数字都导致整段丢弃，看板回落到确定性洞察。
- 解读可追溯：原因必须引用输入中的洞察代码；下一步只能取自固定词表且满足前提。
- 输入、提示词、解析、校验全是纯函数，表驱动测试穷举；取数与一次模型调用之外没有副作用（审计除外）。
- 默认关，开了也只在用户点按钮时调用，一次请求最多一次模型调用。

**Non-Goals:**
- 不改 `src/lib/sales/period/summary-pure.ts`、`insights.ts`、`types.ts` 的口径与规则；`load.ts` 只加 `narrativeEnabled`。
- 不改 `src/lib/ai/client.ts`、`src/lib/ai/model-policy/**`、`src/lib/ai/model-registry/**`。
- 不改 `src/app/api/sales/cockpit/weekly-report/route.ts`（它直连 OpenAI 的问题不在本 change）。
- 不碰 `src/lib/muse-bridge/**`、`src/lib/calendar-watch/**`。
- 不新增组织设置字段、不新增设置页面。

## Decisions

### D1 纪律 7 的例外写进 config.yaml，范围收窄到这一处
- 在第 7 条末尾追加一句："唯一例外（KPI-2，Evan 2026-10-29 拍板）：销售期间看板的 AI 解读可调用一次 LLM，只解读已算好的期间汇总；输出数字不在输入中即整段丢弃；开关默认关。"
- 这一改动放在本 change 的第一条 task，随功能 PR 一起给 Evan 过目，合并即生效。
- 否决：
  - **只在本 change 的 design 里记例外、不改 config**：config 是每次 `/opsx:*` 注入的唯一事实源，不改会让后续 change 的审查误判 KPI-2 违纪。
  - **写成"看板可用 LLM"的宽例外**：等于废掉第 7 条，后续任何看板都能加模型调用。

### D2 独立的按需接口，不进 GET、不进 cron
- `POST /api/sales/period-summary/narrative`，查询参数与 `GET` 相同（`orgId`、`from`、`to`、`compare`）。
  - 授权与范围：`resolveSalesOrgIdForRequest` + `resolveSalesScope(user, orgId, "sales.analytics.read")`。
  - 期间：`resolvePeriodParams` 与组织时区。
  - 取数：`buildSalesPeriodResponse` 拿到与看板完全相同的 JSON。
- 处理顺序：开关 → 授权 → 期间 → 限次 → 取数 → 投影 → 一次模型调用 → 校验 → 审计 → 返回。前四步任一失败都不调用模型。
- 否决：
  - **在 `GET /api/sales/period-summary` 里同步生成**：每次打开首页都花一次调用、增加数秒延迟，Muse 复用的取数也会被拖慢。
  - **cron 预生成并缓存到 settingsJson**：要新增定时步骤，且会把含金额的正文落库，违反第 7 条"不存金额"的精神。

### D3 输出为约定 JSON，校验完全确定
- 模型只允许返回一个 JSON 对象：
  - `conclusion: string[]`（1–3 句）；
  - `reasons: { text, insightCodes: string[] }[]`（0–3 条）；
  - `nextSteps: { action, text, repName? }[]`（0–3 条）。
  - 每段文字 ≤ 200 字。
- 解析：去掉首尾空白与 ```` ```json ```` 围栏后 `JSON.parse`；结构、条数、长度任一不符 → `invalid_format`。
- 引用：`reasons[].insightCodes` 非空且全部属于输入 `insights[].code`；`nextSteps[].action` 属于输入 `allowedActions`；`review_rep` 的 `repName` 必须在输入按人表中。任一不符 → `invalid_reference`。
- `allowedActions` 由纯函数按前提算出后放进输入：
  - `chase_signature`：`openQuotedCount > 0`；
  - `record_deposit`：`wonWithoutDepositCount > 0`；
  - `review_rep`：全企业范围且按人表非空；
  - `fix_calendar_rule`：`calendar.bySource.unknown > 0`。
- 下一步只是文字建议，不生成 PendingAction、不触发任何写操作。
- 否决：
  - **自由 Markdown + 只查数字**：无法核对"下一步"是否越出词表、"原因"是否有出处。
  - **占位符模板（模型写 `{{totals.wonAmount}}`、代码填值）**：数字最可控，但模型对占位符的遵守不稳定，回落率高，读起来也像模板。数字比对已能保证"不产生新数字"。

### D4 数字比对：输入数值集合 + 有限的写法换算
- **允许集合**由纯函数从投影后的输入构造：
  - 递归收集所有有限数值（汇总、对比、变化率、按人、洞察证据、日程计数、天数、阈值表 `thresholds`）；
  - 输入字符串（洞察文字、日期）里能解析出的数字也计入，例如"超过 14 天"里的 14、`2026-10-01` 拆出的 2026 / 10 / 1；
  - 阈值表 `INSIGHT_THRESHOLDS` 与 `STALE_OPEN_DAYS` 随输入一起给模型，让它可以合法地说"超过 14 天""低于 30%"。
- **输出切词**：
  - 正则匹配可带 `$` / `CAD` / 正负号、千分位、小数、尾随 `%` 或 `万` 的数字；
  - 去掉千分位与货币符号，按绝对值比较。
- **一个数字 x（d 位小数）算命中的条件**（满足其一即可）：
  - 存在输入值 v，`round(|v|, d) = x`；
  - 带 `%` 时：存在 v 使 `round(|v| × 100, d) = x`，或 x 本身在集合中（如阈值文字"30%"）；
  - 带 `万` 时：存在 v 使 `round(|v| / 10000, d) = x`。
- **中文数字计量词**一律拒绝：正则 `[零〇一二两三四五六七八九十百千万]+[份单条个位天名次笔倍成]` 命中即 `invalid_numbers`（误杀如"看一条"可以接受，回落是安全方向）。
- 只扫描 `conclusion / reasons[].text / nextSteps[].text`；`repName` 单独按名单校验。
- 否决：
  - **再调一次模型自查**：不确定、翻倍费用，违背"最多一次调用"。
  - **容差比较（±1%）**：会放过"61,230 写成 61,800"这类编造。

### D5 一次调用，失败即回落
- 调用参数：
  - `createCompletionDetailed({ mode: "fast", temperature: 0.2, maxTokens: 1200, timeoutMs: 25000, orgId, userId, workflow: "sales_period_narrative", source: "sales_period_narrative" })`；
  - `temperature` 对推理族模型会被 `buildTuningParams` 丢弃（只剩 `reasoningEffort`），所以不依赖低温度保证格式，格式靠 D3 校验兜底；
  - 系统提示词固定（中文，写明三段结构、只用输入数字、只用 `allowedActions`、只引用输入洞察、只输出 JSON），用户提示词为 `JSON.stringify(投影输入)`。
- 异常映射：
  - 消息以"配额限制"开头 → `budget_exceeded`；
  - 其它异常或超时 → `model_error`；
  - 都返回 200 与 `narrative = null`，看板不报错。
- 限次：`checkRateLimitAsync({ name: "sales-period-narrative", windowMs: 60_000, maxRequests: 6 }, "{orgId}:{userId}")`，超限 429 `RATE_LIMITED`。
- 服务函数的模型调用可注入（缺省 `createCompletionDetailed`），隔离库测试不打真模型。
- 否决：**失败自动重试一次**：费用与延迟翻倍；回落到确定性洞察已经是可用结果。

### D6 开关只用环境变量
- `SALES_PERIOD_NARRATIVE_ENABLED === "true"` 才开；纯函数 `isPeriodNarrativeEnabled(env)` 判定；`.env.example` 加注释行（缺省不写值即关）。
- `GET` 响应加 `narrativeEnabled` 让面板决定是否显示按钮。
- 否决：**组织级开关（settingsJson + 设置接口）**：需要新接口与审计，Sunny 目前是唯一使用方；需要时再单独 change。

### D7 审计只记结果
- 每次调用了模型的请求 `logAudit`：
  - `action = "sales.period_narrative.generated"`，`targetType = "sales_period_narrative"`，`targetId = "{from}..{to}"`；
  - `afterData = { outcome, model, scope, from, to, compare, elapsedMs }`，`outcome` 为 `ok` 或回落原因。
- 不存解读正文、不存任何金额、不存提示词。用于事后看回落率（报告里给出验证期的统计方法）。
- 否决：**存正文供复盘**：正文含金额，违反第 7 条"不存金额"。

### D8 面板
- 期间面板在洞察列表下方加一块：`narrativeEnabled` 为真时显示"生成解读"按钮；点击后 POST，同一期间的结果只留在组件内存（换期间清空），不进 localStorage。
- 结果按"本期结论 / 原因 / 下一步"三段展示，标"AI 解读 · 数字已与看板核对"；回落显示"本次解读未通过核对，已以上方确定性洞察为准"；429 显示"请稍后再试"。
- 否决：**页面加载自动生成**：违背按需与费用控制。

## 与八条硬纪律的关系

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 遵守：无模型、无字段、无迁移；审计用既有 AuditLog |
| 2 | 出站先审批 | 不涉及：无邮件、无 Muse 动作、无改价锁标；下一步只是文字，不建 PendingAction。模型调用是内部推理服务调用，不是对外业务发送 |
| 3 | 禁止第三套队列 | 遵守：按需同步调用，无 cron、队列、租约、调度器 |
| 4 | 脱敏 | 不涉及 Muse 通道；另行约束模型输入不含客户信息、报价行、毛利与成本，本人范围不含他人（spec"模型输入不含敏感信息"） |
| 5 | 不爬登录页 | 不涉及 |
| 6 | 邮箱分离 | 不涉及 |
| 7 | 确定性优先 | **触碰并开例外**（D1，Evan 拍板）：数字全部来自 KPI-1 且逐个比对（D4）；"下一步"只能取自按前提算出的固定词表，不由模型决定动作；不存正文与金额（D7） |
| 8 | 测试注册 | 遵守：纯测试进 test-all + test-ci-unit，隔离库测试进 test-all，同一 task 注册 |

## Risks / Trade-offs

- **[回落率高，用户常看到"未通过核对"]** → 提示词把允许的数字、动作、洞察都列给模型，温度 0.2；审计记 outcome 便于统计；回落时确定性洞察仍在，页面不缺内容。
- **[误杀合法写法，如"前两位销售"]** → 中文数字一律拒绝是有意的保守选择；报告里记录验证期观察到的误杀类型，必要时在后续 change 放宽。
- **[销售姓名进入模型输入]** → 只在全企业范围，且只有成员姓名与聚合数字，与现有 AI 功能（客户建议、周报）发给同一服务商的数据同级或更少。
- **[姓名里含提示词注入]** → 姓名只作为 JSON 字符串值出现；输出仍要过结构、词表、数字三重校验，注入最多导致回落。
- **[月费用]** → 一次 fast 调用、限次每人每分钟 6 次、既有月费用硬上限兜底。

## Migration Plan

- 部署后默认关（不设环境变量），对现有行为零影响；`GET` 多一个 `narrativeEnabled: false`。
- 上线：在 Vercel 设置 `SALES_PERIOD_NARRATIVE_ENABLED=true` 并重新部署；老板在首页点"生成解读"做人工验收（报告记录 10 次的通过 / 回落分布）。
- 回滚：删掉环境变量即停；revert PR 无数据残留（审计只追加）。

## 验证方式

- `npx tsx src/lib/sales/__tests__/period-narrative-pure.test.ts`：
  - 开关判定；
  - 输入投影（org / own，不含客户信息、本人范围无他人）；
  - `allowedActions` 前提；
  - 提示词含三段与只输出 JSON 的约束；
  - 解析（围栏、坏 JSON、超条数、超长）；
  - 数字比对（取整、千分位、货币、正负号、百分比、万、日期、阈值、编造、中文数字）；
  - 引用与词表校验。
- `NODE_ENV=test DATABASE_ENVIRONMENT=isolated DATABASE_URL=… npx tsx src/lib/sales/__tests__/period-narrative-db.isolated.test.ts`（注入假模型调用）：
  - 开关关 404 且零调用、`GET narrativeEnabled` 两种取值；
  - 403 / 400 零调用；
  - 合法输出 200；
  - 编造数字、越词表回落；
  - 模型抛错 `model_error`、费用超限 `budget_exceeded`；
  - 本人范围提示词不含他人姓名；
  - 审计 outcome 正确且不含正文与金额；
  - 第 7 次请求 429。
- 回归：`period-pure`、`period-insights`、`period-db.isolated`、Muse `sales-pure` / `sales-db.isolated` 全过。
- 门禁：
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`
  - `npm run lint:baseline`
  - `npm run test:ci`
  - `bash scripts/check-test-registry.sh`
  - `openspec validate sales-period-narrative --strict`
  - `npm run build`
- 浏览器（`next start` + Playwright）：
  - 开关关：无按钮、无解读请求；
  - 开关开：`OPENAI_BASE_URL` 指向本机一个返回固定 JSON 的 OpenAI 兼容假服务（`getAIConfig` 读该变量），点击后显示三段与"数字已与看板核对"；
  - 让假服务返回编造数字时显示回落提示。
  - 真实模型的输出质量不在本地验证，由上线人工验收补（报告写明）。
