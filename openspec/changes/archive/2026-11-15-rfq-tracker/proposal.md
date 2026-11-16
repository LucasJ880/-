# Proposal：询价追踪页——一页看清所有在途询价（T-2）

TASKFLOW：T-2（依赖 T-1，已完成）
来源：任务书 `docs/QINGYAN_T-1_T-2_RFQ_TRACKING_TASKBRIEF.md` §3（Evan 2026-11-07 已拍板：下线 batch-followup、追踪页显示价格）；交接文档 §0.5e 推荐第 2 项。Lucas 2026-11-15 全权交给 Claude。

## Why

在途询价散在各个项目的询价区里，人要逐个项目点开才知道谁没回、谁该催、哪张催单卡在等批；首页「供应商未回复」还查的是早已不用的状态，列出来的不准。

## What Changes

- 新页面 `/bids/rfq`：默认「需要我处理」（催单卡待批、回信没报价、报价缺字段、过了回复截止还没回），顶部计数（需要我处理 · 等回复 · 已报价 · 未响应）；按项目 → 轮次分组；每家一行写明状态、发出日期、已催几次、系统下一步（下次自动催哪天 / 哪天标未响应 / 催单卡待批 / 手工联系不会自动催）、缺哪些字段、回复截止。
- 已报价的行显示原币种报价、交期、有效期，以及**比价矩阵**算出的落地价（CAD）与「最便宜」；换算不了写原因并给去比价的链接。不另算汇率、不另排序。
- 行内：待批催单卡原地「批准并发送 / 驳回」（同一轮多张有「全部批准」，前端逐张调用既有接口）；等回复且没有待批卡的「现在就催」（起草催单卡，原地出现审批）；「打开项目」。
- `/bids` 顶部一张汇总卡（只有计数，没有金额），点进 `/bids/rfq`。
- 首页 AI 建议「供应商未回复」改查真正在等回复的（`sent` 且超过负责人的催单天数），按钮「去询价追踪」。
- 下线 `POST /api/projects/[id]/inquiries/batch-followup`（返回 410）。
- 新接口：`GET /api/org/tender-rfq/tracker`、`POST /api/projects/[id]/tender-rfq/chase`。

## 受影响的 Muse 意图

`chase`：不变。`draftChasesForProject` 多一个调用方（网页「现在就催」）；`loadItems` 导出并可按项目过滤，Muse 与 cron 不传这个参数，行为不变。

## Out of scope

- 改 `decideChases` / `decideNoResponse` / 催单天数规则 / 催单模板 / 执行器；改比价矩阵与落地价换算。
- 追踪页显示项目估值、我方报价、毛利、价格情景；导出；换一家供应商补询；询价日报（T-3）；改审批中心。
- schema 变更、新 cron / 队列 / 轮询、模型调用：没有。

## Capabilities

### New Capabilities

- `tender/rfq-tracker`：跨项目的询价追踪页、汇总卡、「现在就催」、首页建议的口径、batch-followup 下线。

### Modified Capabilities

无。
