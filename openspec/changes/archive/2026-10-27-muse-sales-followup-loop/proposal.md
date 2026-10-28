# Proposal: muse-sales-followup-loop

**TASKFLOW：** S3（Phase S — Sales Pilot，跟进引擎）。上位文档：`LucasJ880/Muse--Bridge-bot` 的 `docs/prd/sales-pilot-prd.md` 批次 Q3。
**受影响的 Muse 意图：** 新增 `create_followup`、`update_followup`；`opportunity_status` 增加 `followups`；`inquiry.replied` 的建议动作改为"创建跟进"；新增事件 `followup.assigned`、`followup.due`、`followup.overdue`、`followup.updated`，并开始实际发出 `inquiry.overdue`。

## Why

S2 让管理者问到了员工的真实进展，但"问完"之后还缺一步：把下一步变成有负责人、有期限、会提醒、逾期会升级的跟进，并且整条链能被追溯。这是 CEO 10 步验收的第 7–10 步。

## What Changes

- `muse-bridge/v1` 只追加：意图 `create_followup`（`opportunityId`、`title`、`dueAt`、`fromInquiryId?`、`assigneeUserId?`）与 `update_followup`（`followupId`、`status`：`in_progress` / `completed` / `dismissed`、`evidence?`、`reason?`）；事件 `followup.assigned`、`followup.due`、`followup.overdue`、`followup.updated`；信封可选字段 `followupId`；错误码 `FOLLOWUP_NOT_FOUND`、`FOLLOWUP_CLOSED`。
- 跟进落在既有 `SalesAction`：`source=muse_followup`、`signalKey=activeKey=muse_followup:<requestId>`（唯一键防并发重复；结束后 `activeKey` 置空，按 `signalKey` 查重防重放）、`category=muse_followup`、`inputContext={workflowId, inquiryTaskId}`。状态机复用 `canTransitionSalesAction` 与 `validateSalesActionResolution`：完成必须有证据（写 `resolutionNote`），搁置必须有原因。零 schema。
- 权限：管理角色可给本组织有效成员建跟进（缺省给商机负责人）；销售只能给自己负责的商机、给自己建。只有负责人或创建人能更新。
- 提醒扫描挂在既有 `sales-actions` cron（15 分钟）：到期前 24 小时发一次 `followup.due`（负责人）；逾期发一次 `followup.overdue`（负责人 + 创建人）；询问过期未回复发一次 `inquiry.overdue`（发起人 + 收件人）。幂等键 `<事件>:<对象 id>:<期限毫秒>:<收件人>`，改期限会重新提醒一次。扫描单独记一条 AutomationRun（`muse-reminder-scan`）。
- 网页 `PATCH /api/sales/actions/[id]` 改 `muse_followup` 状态时同样发 `followup.updated`（发给创建人）。
- 事件拉取加复合游标：`GET /api/bridge/muse/events` 新增 `cursor` 参数与响应字段 `nextCursor`（`<ISO>|<通知 id>`），按 `(createdAt, id)` 排序，同一毫秒的事件不再在分页边界丢失；`since` / `nextSince` 原样保留，已有调用方不受影响。
- 请求账本：响应带 `workflowId` 时写入 `AuditLog.traceId`，整条链可按 workflowId 查。
- `opportunity_status` 增加 `followups`（未结束在前，含逾期标记、证据 / 原因）。商机详情页增加"协作追踪"区块：询问、回复、跟进按时间排列。
- 证据导出脚本 `npx tsx scripts/muse-pilot-evidence.ts --workflow <id>`：按 workflowId 输出请求账本、询问、回复、跟进、事件与提醒扫描记录。
- 测试：纯逻辑与隔离库端到端测试，注册进 `scripts/test-all.sh`（纯逻辑同时进 `scripts/test-ci-unit.sh`）；写 `docs/QINGYAN_S3_REPORT.md` 并更新 TASKFLOW。

## Capabilities

### New Capabilities

（无。）

### Modified Capabilities

- `muse-bridge/sales-intents`：追加跟进、提醒扫描、复合游标与证据追溯的要求。

## Impact

- `src/lib/muse-bridge/contract.ts`、`router.ts`、`router-pure.ts`、`events.ts`、`events-pure.ts`、`inquiry-pure.ts`、`sales-pure.ts`、`sales.ts`；新文件 `followup-pure.ts`、`followup.ts`、`reminder-scan.ts`。
- `src/app/api/cron/sales-actions/route.ts`（追加一段扫描）、`src/app/api/bridge/muse/events/route.ts`、`src/app/api/sales/actions/[id]/route.ts`（状态变化后发事件）、商机详情页一个区块；新脚本 `scripts/muse-pilot-evidence.ts`。
- 生产行为零变化：两个新意图默认不开放；提醒扫描与事件都受 `MUSE_BRIDGE_ENABLED` 与组织白名单约束。

## Out of scope

- 多级升级链（只升级一次，D5）；对外消息（邮件、给客户的微信）。
- 修改 `SalesOpportunity` 字段（阶段、下次跟进时间）；Prisma schema；新 cron 或队列。
- Connector 侧工具与游标切换（Bridge 批次 C3）。
