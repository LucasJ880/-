# Proposal: muse-sales-inquiry-loop

**TASKFLOW：** S2（Phase S — Sales Pilot，跨助理询问与回复）。上位文档：`LucasJ880/Muse--Bridge-bot` 的 `docs/prd/sales-pilot-prd.md` 批次 Q2。
**受影响的 Muse 意图：** 新增 `ask_colleague`、`reply_inquiry`；`opportunity_status` 的 `employeeConfirmations` 开始有内容，并为管理角色给出"问负责人"的下一步；新增事件 `inquiry.received`、`inquiry.replied`、`inquiry.overdue`（本批次只定义与发出前两种，逾期扫描在 S3）。

## Why

管理者能看到商机排序之后，下一步是"去问一下负责人"，而 CRM 字段经常落后于真实进展。S2 让管理者的助理把结构化问题发给商机负责人，负责人从自己的助理或青砚网页回复，回复作为"员工确认"和 CRM 事实分开呈现。

## What Changes

- `muse-bridge/v1` 只追加：意图 `ask_colleague`（`opportunityId`、`questions` 1–5 条、`replyBy?`、`note?`）与 `reply_inquiry`（`inquiryId`、`nextStep`、`customerFeedback?`、`lastContactAt?`、`nextStepDueAt?`、`needs?`、`note?`）；事件 `inquiry.received`、`inquiry.replied`、`inquiry.overdue`；事件信封可选字段 `opportunityId`、`inquiryId`；错误码 `INQUIRY_NOT_FOUND`、`INQUIRY_CLOSED`、`OPPORTUNITY_UNASSIGNED`。
- 询问落在既有 `Task`：`sourceType=muse_inquiry`、`sourceId=商机 ID`、`sourceTemplateKey=inq:<requestId>`（唯一约束即幂等）、负责人 = 商机负责人、状态 `waiting_internal`、期限默认 24 小时；问题与 CRM 快照写进 `TaskActivity`。零 schema。
- 回复写 `TaskComment`（作者 = 回复人）与 `TaskActivity`（结构化答案与渠道 `muse` / `web`），询问 Task 置 `done`；向发起人发 `inquiry.replied`，向负责人发 `inquiry.received`（创建时）。
- 权限：只有管理角色能发起询问；只有询问的负责人能回复；已回复或已取消的询问再回复返回 `INQUIRY_CLOSED`；跨组织与不存在同一口径。
- `opportunity_status`：`employeeConfirmations` 列出该商机已回复的询问，新增 `openInquiries`；管理角色且无未结束询问时，下一步给出带默认问题的 `ask_colleague`。
- 青砚网页：新页面 `/sales/inquiries/[id]` 与 `GET/POST /api/sales/inquiries/[id]`（登录态），没有绑定助理的负责人在这里看问题、提交回复；通知点击 `muse_inquiry` 跳到该页。
- 测试：纯逻辑测试与隔离库端到端测试，注册进 `scripts/test-all.sh`（纯逻辑同时进 `scripts/test-ci-unit.sh`）；写 `docs/QINGYAN_S2_REPORT.md` 并更新 TASKFLOW。

## Capabilities

### New Capabilities

（无。）

### Modified Capabilities

- `muse-bridge/sales-intents`：追加询问与回复相关的要求（S1 建立的能力，本 change 合并时一并归档）。

## Impact

- `src/lib/muse-bridge/contract.ts`、`router.ts`、`router-pure.ts`、`events.ts`、`sales-pure.ts`、`sales.ts`；新文件 `src/lib/muse-bridge/inquiry-pure.ts`、`inquiry.ts`。
- 新页面 `src/app/(main)/sales/inquiries/[id]/page.tsx`、新路由 `src/app/api/sales/inquiries/[id]/route.ts`；`src/components/header.tsx` 通知跳转加一个分支。
- 新测试 `src/lib/muse-bridge/__tests__/inquiry-pure.test.ts`、`inquiry-db.isolated.test.ts`；`muse-bridge-pure.test.ts` 意图数 14 → 16。
- 生产行为零变化：两个新意图默认不开放。

## Out of scope

- 询问逾期扫描与 `inquiry.overdue` 的实际发出、跟进任务（`create_followup` / `update_followup`）——S3。
- Connector 侧写工具、客户端幂等键、`get_updates`——Bridge 批次 C2。
- 不改 `SalesOpportunity` 任何字段；不改 Prisma schema；不加 cron / 队列。
- 不改任务看板（`src/app/(main)/tasks/**`）与既有 Task API 的行为。
- 不发送任何对外消息（邮件、微信给客户等）；通知只在青砚站内与 Muse 事件通道。
