# Proposal：项目页「问供应商要价」——询价 Web 入口（W-1）

TASKFLOW：W-1（新增 Phase W「先把已建好的用起来」；任务书 `docs/QINGYAN_W-1_RFQ_WEB_ENTRY_TASKBRIEF.md`，Evan 2026-11-06 拍板：保留 `MUSE_BRIDGE_ENABLED` 旁路、旧单封直发直接下线）。

## Why

P1-1～P1-8 的询价引擎（结构化 RFQ → 审批 → project@ 发出 → 回信自动入表 → 催单）唯一入口是 Muse 的 `rfq` 意图，而 Muse Connector 已永久冻结（已决定第 10 条），Web 上能发询价的只剩绕过审批、不记 threadId 的单封直发。

## What Changes

- 新增 `GET /api/projects/[id]/tender-rfq/entry`：零副作用地算出「现在能不能发」（轮次锁 / 待批发送卡 / 没有已确认要求 / 敏感内容拦截 / 授权邮箱未连接或缺发信权限）、可选供应商（常用供应商标「常用」、没邮箱或已停用的标原因）、默认贸易条款、将发出的内容摘要（发件抬头、回复截止、将包含与不会发出的要求条数）、本项目待批发送卡与各轮「从发起到发出」耗时。
- 新增 `POST /api/projects/[id]/tender-rfq/rounds`：校验后调用与 Muse 同一个 `prepareRfqRound`（`source: "web"`），建一张 `tender.send_rfq` 审批卡，响应附该卡的审批能力（能否原地批准、payloadHash）。
- `PrepareRfqInput` 新增必填 `source: "web" | "muse"`，写入审批卡 `source.toolName`；询价轮次标题改用默认「第 N 轮询价」（修正原硬编码的「第 N 轮询价（Muse）」）。Muse 路由传 `source: "muse"`，响应不变。
- 新增纯函数 `src/lib/tender-rfq/web-entry-pure.ts`：入口状态判定、错误码 → 人话 + 出路链接、按钮旁说明文字、轮次状态行、耗时标签；全部查表。
- 「标书与报价」tab：主按钮「问供应商要价」+ 实时说明；右侧抽屉三块（问哪几家 / 条款 / 会发出什么）→「生成并送审」→ 结果页原地「批准并发送 / 驳回」（调用既有审批中心接口）；待批的轮次卡片内显示同一审批面板，并隐藏该轮的「标记发送」「开始询价」；已由引擎发出的轮次显示「已发出 N 家 · 等回复（截止 …）」+「回信自动进表 / N 天没回自动起草催单」+ 耗时。原「新建询价轮次」降级为次级链接「手工建一轮」。
- **BREAKING（已拍板）**：`POST …/items/[itemId]/email/send` 与 `…/email/generate` 返回 410；询价明细里的「生成邮件」按钮与 `EmailDraftDialog` 移除；首页 AI 建议「批量催促供应商」改为跳到项目「标书与报价」tab（它的发送步骤依赖已下线的 `email/send`）。

## Capabilities

### New Capabilities
- `tender/rfq-web-entry`：在项目页发起询价轮次的入口、前置判断、原地审批、发出后状态，以及旧单封直发的下线。

### Modified Capabilities
- 无（`tender/rfq-compare` 等既有规格不变）。

受影响的 Muse 意图：`rfq`（多传 `source: "muse"`；轮次标题从「第 N 轮询价（Muse）」变为「第 N 轮询价」，Muse 响应文本不含标题，不变）。`status` / `next_step` / `chase` / `compare` / `price_scenario` 不受影响。

## Impact

- 新增：`src/lib/tender-rfq/web-entry-pure.ts`、`src/lib/tender-rfq/web-entry.ts`、`src/lib/tender-rfq/__tests__/web-entry-pure.test.ts`、`src/app/api/projects/[id]/tender-rfq/entry/route.ts`、`src/app/api/projects/[id]/tender-rfq/rounds/route.ts`、`src/components/inquiry/rfq-web-entry-drawer.tsx`、`src/components/inquiry/rfq-approval-panel.tsx`、`src/components/inquiry/rfq-round-status-line.tsx`。
- 修改：`src/lib/tender-rfq/service.ts`、`src/lib/muse-bridge/router.ts`（一行）、`src/components/inquiry/project-inquiry-section.tsx`、`src/components/inquiry/inquiry-detail.tsx`、`src/components/dashboard/dashboard-ai-suggestions.tsx`、两条 `email/*` 路由、`scripts/test-all.sh`、`scripts/test-ci-unit.sh`。
- 删除：`src/components/inquiry/email-draft-dialog.tsx`、`src/components/batch-followup/batch-followup-dialog.tsx`（唯一调用方已改为跳转）。
- 硬纪律：零 schema、出站仍只经 `tender.send_rfq` 审批、无新队列 / cron、零新增 LLM 调用。

## Out of scope

- 往已发出的轮次追加供应商（`rfq-add-supplier-to-round`，另开 change）。
- RFQ 设置页（W-2）、比价进定价助手（W-3）、入站 / 催单站内通知（T-1）、跨项目询价追踪页与 `contacted` 状态过滤修复（T-2）。
- 审批卡创建时给审批人发站内通知（属 T-1；本 change 不声称「已通知」）。
- 不改 `execute.ts` / `chase-*` / `inbound-*` / 审批中心页面与权限模型；不新增 PendingAction 类型。
- `POST /api/projects/[id]/inquiries/batch-followup`（生成催促草稿）路由本身不动，留给 T-2 决定去留。
