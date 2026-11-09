# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: 响应按岗位注册表顺序返回七个岗位`
- TO: `### Requirement: 响应按岗位注册表顺序返回可见岗位`

## MODIFIED Requirements

### Requirement: 响应按岗位注册表顺序返回可见岗位
响应 SHALL 含 `orgId`、`generatedAt`、组织时区 `timezone`、`heartbeatScope: "platform"`、`quotaHit`、`waitingForYou` 与 `posts`；`posts` SHALL 只含对调用者可见的岗位（见 `cockpit/post-registry`「岗位卡片的可见条件」），顺序与岗位注册表一致，每项含 `key`、`name`、`nav`、`health`、`heartbeat`、`nextDueAt`、`automations`、`pendingApprovals`、`needsYou`、`actions7d`、`kpi`。不可见岗位的 KPI 与自动化 SHALL NOT 被读取。

#### Scenario: 七个岗位
- **WHEN** 平台 super_admin 在微信入口开关打开时调用接口
- **THEN** `posts` 依次为 `inbound_sales`、`tender`、`marketing`、`service`、`projects`、`ops_knowledge`、`content`，每个岗位的 `automations` 恰好是它在注册表里的自动化

#### Scenario: Sunny 老板只看到四个岗位
- **WHEN** 运行 `npx tsx src/lib/cockpit/__tests__/posts-read-model.test.ts`，以 Sunny（未启用 `trade`）持 `owner` 岗位、微信入口开关关闭的输入组装
- **THEN** `posts` 依次为 `tender`、`marketing`、`projects`、`content`；`inbound_sales`、`service`、`ops_knowledge` 不出现，它们的 KPI 加载器未被调用，测试通过

#### Scenario: 梦馨老板的岗位
- **WHEN** 以梦馨（`DEFAULT_MENGXIN_MODULES`）持 `owner` + `trade_rep` 岗位、微信入口开关关闭的输入组装
- **THEN** `posts` 依次为 `inbound_sales`、`marketing`、`content`（同一测试覆盖）

### Requirement: 等你 N 件按现成"待我审批"口径并与需要你去重
`waitingForYou` SHALL 由两部分组成：(1) 与 `/capabilities/approvals` 的"待我审批"相同口径的条目（PendingAction / ApprovalRequest / 产品内容审批中状态为待审批且调用者有决策权的），且只含落点对调用者放行的条目；(2) 本组织 workforce 中状态为需要你、且工作域对调用者可读的作业（见 `agents/workforce-job-scope`）。作业关联的 PendingAction 全部已在 (1) 中时 SHALL 不再单独计数。需决策类通知 SHALL NOT 另计。`total` 为去重后的条数，`items` 为按 `at` 倒序的前 10 条（`at`：审批取创建时间，需要你作业取最近活动时间），每条含 `kind`、`id`、`title`、`post`、`at`、`href`；`unattributed` 为 `post` 为空的条数；任一来源被截断时 `truncated: true`。

审批条目的 `href`（即落点）SHALL 按类型给出：
- `sales.approve_quote_promotion`、`sales.update_signed_quote` → `/sales/quote-sheet?mode=order&quoteId=<quoteId>`；
- `install.send_warranty_email` → `/accounting?tab=balance&order=<orderId>`；
- `install.send_repair_visit_email` → `/install/repairs/<repairId>`；
- `orders.cancel_blinds_order` → `/blinds-orders/<orderId>`；
- `tender.send_rfq`、`tender.send_chase` → `/projects/<projectId>?tab=bid#rfq-round-<inquiryId>`；
- `revenue_spine.*` → `/revenue`；
- 其余（或 payload 缺对应 id）→ `/capabilities/approvals/<approvalId>`。

#### Scenario: 作业与其审批去重
- **WHEN** 一个需要你的作业关联的 PendingAction 也在待我审批里
- **THEN** `total` 只计 1，`items` 里只出现这条 PendingAction

#### Scenario: 作业有未进待我审批的需要你
- **WHEN** 一个需要你的作业没有关联 PendingAction（如需要澄清）
- **THEN** 它作为 `kind: "workforce_job"` 计入 `total`，`href` 为 `/workforce/<作业 id>`

#### Scenario: 折扣审批跳报价单
- **WHEN** 运行 `npx tsx src/lib/cockpit/__tests__/waiting.test.ts`，待我审批里有一条 `sales.approve_quote_promotion`，payload 含 `quoteId = q1`
- **THEN** 该条 `href` 为 `/sales/quote-sheet?mode=order&quoteId=q1`，测试通过

#### Scenario: 质保邮件跳会计页
- **WHEN** 待我审批里有一条 `install.send_warranty_email`，payload 含 `orderId = o1`
- **THEN** 该条 `href` 为 `/accounting?tab=balance&order=o1`（同一测试覆盖）

#### Scenario: 落点不放行的条目不列
- **WHEN** Sunny（未启用 `trade`）持 `owner` 岗位的调用者的待我审批里有一条 `revenue_spine.propose_commercial_fact`
- **THEN** 该条不计入 `total`、不出现在 `items`（`/revenue` 对其不放行；同一测试覆盖）
