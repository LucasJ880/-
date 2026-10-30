# Proposal — sales-quote-stats-drilldown（STAT-1：报价统计明细与按销售筛选）

TASKFLOW：**STAT-1**（Phase P；任务书 `docs/QINGYAN_PRICE-1_PRICELIST_TASKBRIEF.md` §3.4，判断点 Q9 / Q10 已按推荐拍板：周一起算、销售能展开本人）。

## Why

KPI-1 已经给出"每个人报了多少钱 / 成了多少单"的按人合计，但点不进去看是哪几张报价、没有"本周 / 上周"、报价列表不能按销售筛，草稿不计入统计也没人提醒。本 change 只补这四个缺口，不改任何口径。

## What Changes

- 加周预设：首页期间面板预设加"本周""上周"（周一为一周开始），所有预设的"今天"改按组织时区计算。
- 加按人明细接口：`GET /api/sales/period-summary/quotes?from&to&repId&kind` 返回某位销售在期间内计入成单 / 报价的报价清单（报价单号、客户、发送 / 签字时间、含税总额、状态、价表版本）与小计，小计与按人表同一口径；授权同期间汇总，只持本人范围的调用者只能看自己；上限 500 行带 `truncated`。
- 加展开交互：按人表每行可展开明细；全企业范围的行带"在报价列表查看"链接。
- 加报价列表按销售筛选：`GET /api/sales/quotes/list` 接受 `createdById` 并返回可筛选的销售名单；`/sales/quotes` 加"按销售"下拉，`?rep=` 写进 URL。
- 加草稿提醒：期间汇总响应加 `draftsUnsent.count`（期间内创建、仍是草稿的报价数，不计入任何金额），面板在大于 0 时显示"本期草稿未发送 N 份"并链到草稿列表。

## Capabilities

### New Capabilities
- 无。

### Modified Capabilities
- `sales/period-summary`：响应结构加 `draftsUnsent`；看板展示加周预设、展开明细与草稿提醒；新增按人明细接口与报价列表按销售筛选两条要求。

受影响的 Muse 意图：无（`sales_overview` 只取 `period` 与 `totals`，二者不变）。

## Impact

- 新增：`src/app/api/sales/period-summary/quotes/route.ts`、`src/lib/sales/period/drilldown.ts`（取数）。
- 修改：`src/lib/sales/period/{summary-pure,load,types}.ts`、`src/components/sales-command-center/sales-period-panel.tsx`、`src/app/api/sales/quotes/list/route.ts`、`src/app/(main)/sales/quotes/page.tsx`。
- 测试：扩 `src/lib/sales/__tests__/period-pure.test.ts`（或新纯测试）与 `period-db.isolated.test.ts`。
- 无 schema、无 cron、无 LLM。

## Out of scope

- 不改成单 / 报价 / 在手未签口径，不改 Muse `sales_overview`。
- 不做提成、不做导出 Excel。
- 不改 KPI-2 AI 解读的输入。
- 不改报价列表的权限范围（仍按 `sales.quote.read` 的既有范围）。
