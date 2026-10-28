# Spec Delta

## ADDED Requirements

### Requirement: 跟进意图默认不开放

`create_followup` 与 `update_followup` SHALL 不属于默认放行意图集；只有 `MUSE_BRIDGE_INTENTS` 显式列出时才执行，否则 SHALL 返回 `INTENT_NOT_ENABLED`，提示文字写"Sales Pilot（Phase S）"。

#### Scenario: 未开放

- **WHEN** `MUSE_BRIDGE_INTENTS` 未列出 `create_followup` 时发送该意图
- **THEN** 响应 `errorCode=INTENT_NOT_ENABLED`，不创建 SalesAction；`npx tsx src/lib/muse-bridge/__tests__/followup-pure.test.ts` 覆盖

### Requirement: 跟进的创建权限与负责人

管理角色 SHALL 能为本组织商机创建跟进，负责人为 `assigneeUserId`（须是本组织有效成员）或缺省为商机负责人；销售角色 SHALL 只能为自己负责的商机、以自己为负责人创建。商机不存在或不在本组织 SHALL 返回 `OPPORTUNITY_NOT_FOUND`；没有可用负责人 SHALL 返回 `OPPORTUNITY_UNASSIGNED`；`dueAt` 早于当前时间 SHALL 返回 `VALIDATION_FAILED`。`fromInquiryId` 给出时 SHALL 属于同一商机且调用者是该询问的发起人或收件人，否则返回 `INQUIRY_NOT_FOUND`。

#### Scenario: 销售给别人建跟进

- **WHEN** 销售 A 带 `assigneeUserId=销售 B` 调用 `create_followup`
- **THEN** 响应 `errorCode=PERMISSION_DENIED`，不创建 SalesAction；`followup-db.isolated.test.ts` 覆盖

### Requirement: 跟进落库与幂等

成功的 `create_followup` SHALL 创建一条 SalesAction：`source=muse_followup`、`category=muse_followup`、`signalKey` 与 `activeKey` 为 `muse_followup:<requestId>`、负责人、期限、创建人为调用者、`inputContext` 含 `workflowId` 与 `inquiryTaskId`。有 `fromInquiryId` 时 `workflowId` SHALL 沿用该询问的 workflowId，否则新建。同一 requestId 重放（包括跟进已结束、超过 24 小时）SHALL 返回同一跟进而不创建第二条。响应 `data` SHALL 含 `followupId`、`workflowId`、负责人与期限。

#### Scenario: 跟进完成后重放

- **WHEN** 跟进已完成后再次处理同一 requestId 的 `create_followup`
- **THEN** 返回原 `followupId`，SalesAction 数量不变；`followup-db.isolated.test.ts` 覆盖

### Requirement: 跟进状态更新

`update_followup` SHALL 只允许跟进的负责人或创建人调用，否则返回 `FOLLOWUP_NOT_FOUND`（与不存在同口径）。状态迁移 SHALL 遵守 `canTransitionSalesAction`；已结束的跟进 SHALL 返回 `FOLLOWUP_CLOSED`。`completed` SHALL 要求 `evidence`（写入 `resolutionNote`），`dismissed` SHALL 要求 `reason`（写入 `dismissedReason`），缺失返回 `VALIDATION_FAILED`。状态变化 SHALL 向创建人与负责人中不是操作者的一方发 `followup.updated`（两者是同一人时不发）；同一状态的两次变化（网页可退回 `open` 再开始）SHALL 各发一条。

#### Scenario: 完成不带证据

- **WHEN** 负责人以 `status=completed` 且无 `evidence` 调用
- **THEN** 响应 `errorCode=VALIDATION_FAILED`，跟进状态不变

#### Scenario: 网页更新同样发事件

- **WHEN** 负责人在网页 `PATCH /api/sales/actions/[id]` 把 `muse_followup` 跟进改为 `in_progress`
- **THEN** 创建人收到 `followup.updated`；创建人改状态时负责人收到；`followup-db.isolated.test.ts` 覆盖服务层

### Requirement: 创建与回复的事件

创建跟进 SHALL 向负责人发 `followup.assigned`（负责人就是创建人时不发）。`inquiry.replied` 的建议动作 SHALL 是 `create_followup`：标题取回复的下一步，期限取 `nextStepDueAt`，缺省 72 小时后，带 `fromInquiryId`。

#### Scenario: 回复后的建议动作

- **WHEN** 负责人回复询问且给出 `nextStepDueAt`
- **THEN** 发起人收到的 `inquiry.replied` 的 `action.command` 为 `create_followup`，`dueAt` 等于该时间

### Requirement: 到期提醒与逾期升级

`sales-actions` cron SHALL 在每次运行时扫描：未结束的 `muse_followup` 跟进到期前 24 小时内发 `followup.due`（负责人）；已逾期发 `followup.overdue`（负责人与创建人各一条）；`waiting_internal` 的询问过了期限发 `inquiry.overdue`（发起人与收件人各一条）。每条提醒的幂等键 SHALL 为 `<事件>:<对象 id>:<期限毫秒>:<收件人 userId>`，同一期限只提醒一次，改期限后再提醒一次。扫描 SHALL 记录一条 `muse-reminder-scan` AutomationRun，只覆盖期限在 30 天内的对象；临近到期与已逾期分两段各取最多 500 个，逾期段按期限倒序，已提醒过的旧逾期项不会挤掉新的提醒。

#### Scenario: 逾期两人都收到

- **WHEN** 跟进逾期且负责人与创建人不同，扫描运行两次
- **THEN** 两人各有一条 `followup.overdue`，第二次运行不新增；`followup-db.isolated.test.ts` 覆盖

#### Scenario: 改期限后再提醒

- **WHEN** 已发过 `followup.overdue` 后把期限改到新的过去时间并再扫描
- **THEN** 两人各新增一条（新期限的幂等键）

### Requirement: 事件复合游标

`GET /api/bridge/muse/events` SHALL 接受可选 `cursor`（`<ISO>|<通知 id>`），按 `(createdAt, id)` 升序返回其后的事件，并在响应中返回 `nextCursor`；同一毫秒的多条事件 SHALL 不因分页边界丢失。`since` 与 `nextSince` SHALL 保持原语义；同时给出 `cursor` 与 `since` 时以 `cursor` 为准；格式不对的 `cursor` SHALL 返回 400。

#### Scenario: 同一毫秒跨页

- **WHEN** 同一用户有三条 `createdAt` 相同的事件，以 `limit=2` 分两页按 `nextCursor` 拉取
- **THEN** 两页合计恰好三条、无重复；`events-db.isolated.test.ts` 或 `followup-db.isolated.test.ts` 覆盖

### Requirement: 链路追溯

请求账本 SHALL 在响应 `data.workflowId` 存在时写入 `AuditLog.traceId`。`opportunity_status` SHALL 返回 `followups`（负责人、期限、状态、逾期标记、证据或原因、workflowId）。商机详情页 SHALL 显示"协作追踪"区块（询问、回复、跟进按时间排列）。`scripts/muse-pilot-evidence.ts --workflow <id>` SHALL 输出该 workflow 的请求账本、询问、回复、跟进、事件与提醒扫描记录，不输出原始 Token 或金额。

#### Scenario: 证据导出

- **WHEN** 跑完一次询问 → 回复 → 创建跟进 → 完成后执行脚本
- **THEN** 输出含四条账本记录（同一 traceId）、询问 Task、回复、跟进及其证据、相关事件；`followup-db.isolated.test.ts` 覆盖导出函数
