# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: 响应按岗位注册表顺序返回七个岗位`
- TO: `### Requirement: 响应按岗位注册表顺序返回可见岗位`

## MODIFIED Requirements

### Requirement: 响应按岗位注册表顺序返回可见岗位
响应 SHALL 含 `orgId`、`generatedAt`、组织时区 `timezone`、`heartbeatScope: "platform"`、`quotaHit`、`waitingForYou` 与 `posts`；`posts` SHALL 只含对调用者可见的岗位（见 `cockpit/post-registry`「岗位卡片的可见条件」），顺序与岗位注册表一致，每项含 `key`、`name`、`nav`、`health`、`heartbeat`、`nextDueAt`、`automations`、`pendingApprovals`、`needsYou`、`actions7d`、`kpi`。可见判定的输入 SHALL 与路由门相同，且 SHALL 取自调用者当前的驾驶舱企业。不可见岗位的 KPI 与自动化 SHALL NOT 被读取。

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
`waitingForYou` SHALL 由两部分组成：
1. 与 `/capabilities/approvals` 的"待我审批"相同口径的条目（PendingAction / ApprovalRequest / 产品内容审批中状态为待审批且调用者有决策权的），且只含落点对调用者放行的条目（平台 super_admin 视为全部放行）；
2. 本组织 workforce 中状态为需要你、且对调用者可读的作业（见 `agents/workforce-job-scope`）。

作业关联的 PendingAction 全部已在第 1 部分中时 SHALL 不再单独计数。需决策类通知 SHALL NOT 另计。

计数与截断：
- `total` SHALL 为：已取到且落点放行的审批条数，加上"待我审批"总数中未取到的条数（无法判定落点，原样计入），再加上去重后单独计数的需要你作业条数。
- 任一来源被截断时（含"待我审批"总数大于已取到的条数），SHALL 返回 `truncated: true`。
- `items` 为按 `at` 倒序的前 10 条（`at`：审批取创建时间，需要你作业取最近活动时间），每条含 `kind`、`id`、`title`、`post`、`at`、`href`。
- `unattributed` 为 `post` 为空的条数。`post` 沿用既有归属规则，归属岗位对调用者不可见时也照常返回（横幅是否显示岗位名见 `cockpit/home-view`「等你 N 件横幅」）。

审批条目的 `href`（即落点）SHALL 按类型给出：
- `sales.approve_quote_promotion`、`sales.update_signed_quote` → `/sales/quote-sheet?mode=order&quoteId=<quoteId>`；
- `sales.update_quote_settings` → `/sales/cockpit`；
- `install.send_warranty_email` → `/accounting?tab=balance&order=<orderId>`；
- `install.send_repair_visit_email` → `/install/repairs/<repairId>`；
- `orders.cancel_blinds_order` → `/blinds-orders/<orderId>`；
- `tender.send_rfq`、`tender.send_chase` → `/projects/<projectId>?tab=bid#rfq-round-<inquiryId>`；
- `revenue_spine.*` → `/revenue`；
- 其余 PendingAction 类型、payload 缺对应 id 的条目、ApprovalRequest 与产品内容审批 → 审批详情 `/capabilities/approvals/<编码后的审批 id>`，审批 id 为 `<来源类型>:<来源 id>`（如 `PENDING_ACTION:pa1`），整段 SHALL 经 URL 编码，与审批中心列表的链接写法相同。

#### Scenario: 作业与其审批去重
- **WHEN** 一个需要你的作业关联的 PendingAction 也在待我审批里
- **THEN** `total` 只计 1，`items` 里只出现这条 PendingAction

#### Scenario: 作业有未进待我审批的需要你
- **WHEN** 一个需要你的作业没有关联 PendingAction（如需要澄清）
- **THEN** 它作为 `kind: "workforce_job"` 计入 `total`，`href` 为 `/workforce/<作业 id>`

#### Scenario: 折扣审批跳报价单
- **WHEN** 运行 `npx tsx src/lib/cockpit/__tests__/waiting.test.ts`，待我审批里有一条 `sales.approve_quote_promotion`，payload 含 `quoteId = q1`
- **THEN** 该条 `href` 为 `/sales/quote-sheet?mode=order&quoteId=q1`，测试通过

#### Scenario: 折扣设置变更跳销售驾驶舱
- **WHEN** 待我审批里有一条 `sales.update_quote_settings`
- **THEN** 该条 `href` 为 `/sales/cockpit`（同一测试覆盖）

#### Scenario: 质保邮件跳会计页
- **WHEN** 待我审批里有一条 `install.send_warranty_email`，payload 含 `orderId = o1`
- **THEN** 该条 `href` 为 `/accounting?tab=balance&order=o1`（同一测试覆盖）

#### Scenario: 没有专属落点的审批跳详情
- **WHEN** 待我审批里有一条 `grader.email_draft`，PendingAction id 为 `pa1`
- **THEN** 该条 `href` 为 `/capabilities/approvals/PENDING_ACTION%3Apa1`（同一测试覆盖）

#### Scenario: 落点不放行的条目不列
- **WHEN** Sunny（未启用 `trade`）持 `owner` 岗位的调用者的待我审批里有一条 `revenue_spine.propose_commercial_fact`
- **THEN** 该条不计入 `total`、不出现在 `items`（`/revenue` 对其不放行；同一测试覆盖）

#### Scenario: 待我审批被截断时的总数
- **WHEN** 待我审批总数为 120，已取到 100 条，其中 3 条落点不放行，没有单独计数的需要你作业
- **THEN** `total` 为 117（97 + 未取到的 20），`truncated` 为 true（同一测试覆盖）
