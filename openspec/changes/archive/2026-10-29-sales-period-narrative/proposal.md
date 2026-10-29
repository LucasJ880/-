# Proposal — sales-period-narrative（KPI-2：期间看板 AI 解读）

TASKFLOW：**KPI-2**（Phase K — Sunny 日程归因与期间看板；设计稿 `docs/QINGYAN_SUNNY_SCHEDULE_KPI_DESIGN.md` §3.5，判断点 6）。

## Why

老板要的是"10 月 1 日到今天成了多少、报了多少钱"的 AI 分析；KPI-1 已给出确定性数字与九条表驱动洞察，但没有一段把数字串起来的人话解读。Evan 已于 2026-10-29 拍板为此在 `openspec/config.yaml` 第 7 条开一个只限本处的例外。

## What Changes

- 修改 `openspec/config.yaml` 第 7 条：追加唯一例外——销售期间看板的 AI 解读可调用一次 LLM，只解读已算好的期间汇总，输出数字不在输入中即整段丢弃，开关默认关。
- 新增 `POST /api/sales/period-summary/narrative?from&to&compare`：按 `sales.analytics.read` 授权，复用 KPI-1 的期间解析与汇总，把汇总、对比、按人、洞察、日程来源投影成模型输入，调用一次 LLM，返回结构化解读（本期结论 ≤ 3 句、原因 ≤ 3 条且必须引用输入中的洞察代码、下一步 ≤ 3 条且只能取自固定动作词表）。
- 新增确定性校验：输出中每一个数字（含千分位、百分比、"万"）必须能在输入数值集合中找到；出现中文数字计量词、未知动作、未引用洞察、格式不对任一情况，整段丢弃并返回 `narrative = null` 与回落原因。
- 新增开关 `SALES_PERIOD_NARRATIVE_ENABLED`（缺省关）：关闭时解读接口返回 404 `NARRATIVE_DISABLED`；`GET /api/sales/period-summary` 增加 `narrativeEnabled` 字段回显开关。
- 新增每人每分钟限次（429 `RATE_LIMITED`）与月费用预检（沿用既有 AI 用量台账与费用上限，超限回落 `budget_exceeded`）。
- 新增每次生成写一条审计（结果、模型、范围、期间、耗时），不存解读正文与任何金额。
- 修改首页期间面板：开关开启时显示"生成解读"按钮，点击才调用；解读标注"AI 解读 · 数字已与看板核对"；回落时提示已回落到上方确定性洞察。

## Capabilities

### New Capabilities
- `sales/period-narrative`：期间看板的 AI 解读——接口、模型输入投影、数字与词表校验、开关、限次、审计与面板展示。

### Modified Capabilities
- `sales/period-summary`：新增"叙述开关回显"要求（响应增加 `narrativeEnabled`）；`narrative` 字段在 `GET` 中仍固定为 `null`，解读只经独立接口按需生成。

受影响的 Muse 意图：无（不触碰 `muse-bridge`；`sales_overview` 不带解读）。

## Impact

- 新增：`src/lib/sales/period/narrative-pure.ts`（输入投影、提示词、解析、数字与词表校验）、`src/lib/sales/period/narrative.ts`（取数与一次模型调用）、`src/app/api/sales/period-summary/narrative/route.ts`。
- 修改：`openspec/config.yaml`（第 7 条例外）、`src/lib/sales/period/load.ts`（`narrativeEnabled`）、`src/components/sales-command-center/sales-period-panel.tsx`（按钮与展示）、`.env.example`（开关说明）。
- 测试：`src/lib/sales/__tests__/period-narrative-pure.test.ts`（进 test-all 与 test-ci-unit）、`src/lib/sales/__tests__/period-narrative-db.isolated.test.ts`（进 test-all，注入假的模型调用）。
- 依赖：既有 `createCompletionDetailed`（`src/lib/ai/client.ts`，`mode: "fast"`，月费用预检与用量台账已内建）、`checkRateLimitAsync`、`logAudit`。无 schema、无 cron、无队列、无出站。

## Out of scope

- 不在页面加载时自动生成；不进 cron；不缓存、不持久化解读正文。
- 不把解读接到 Muse / 微信 / 邮件；不做周报改造（`src/app/api/sales/cockpit/weekly-report/route.ts` 不动）。
- 不让模型决定"下一步"之外的任何动作；下一步只是文字建议，不建 PendingAction、不触发任何写操作。
- 不改 KPI-1 的口径、洞察规则与阈值，不改 CAL-1。
- 不做组织级开关或设置页面；开关只有环境变量一个。
- 不做多语言解读（只出中文）。
