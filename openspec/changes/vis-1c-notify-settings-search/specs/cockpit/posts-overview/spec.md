# Spec Delta

## REMOVED Requirements

### Requirement: 等你 N 件按现成"待我审批"口径并与需要你去重
**Reason**：需求正文超过 500 字（`openspec validate --specs --strict` 告警），按「组成与去重」「计数与截断」「销售与安装审批的落点」「其余审批的落点」拆成四条；行为不变。
**Migration**：无。原有 8 个场景按内容分到这四条下（只移动了「运行测试」说明的位置），由 `src/lib/cockpit/__tests__/waiting.test.ts` 照旧覆盖。

## ADDED Requirements

### Requirement: 等你 N 件的组成与去重
`waitingForYou` SHALL 由两部分组成：
1. 与 `/capabilities/approvals` 的"待我审批"相同口径的条目（PendingAction / ApprovalRequest / 产品内容审批中状态为待审批且调用者有决策权的），且只含落点（见「销售与安装审批的落点」「其余审批的落点」）对调用者放行的条目（平台 super_admin 视为全部放行）；
2. 本组织 workforce 中状态为需要你、且对调用者可读的作业（见 `agents/workforce-job-scope`）。

作业关联的 PendingAction 全部已在第 1 部分中时 SHALL 不再单独计数。需决策类通知 SHALL NOT 另计。

#### Scenario: 作业与其审批去重
- **WHEN** 一个需要你的作业关联的 PendingAction 也在待我审批里
- **THEN** `total` 只计 1，`items` 里只出现这条 PendingAction

#### Scenario: 作业有未进待我审批的需要你
- **WHEN** 一个需要你的作业没有关联 PendingAction（如需要澄清）
- **THEN** 它作为 `kind: "workforce_job"` 计入 `total`，`href` 为 `/workforce/<作业 id>`

#### Scenario: 落点不放行的条目不列
- **WHEN** 运行 `npx tsx src/lib/cockpit/__tests__/waiting.test.ts`，Sunny（未启用 `trade`）持 `owner` 岗位的调用者的待我审批里有一条 `revenue_spine.propose_commercial_fact`
- **THEN** 该条不计入 `total`、不出现在 `items`（`/revenue` 对其不放行），测试通过

### Requirement: 等你 N 件的计数与截断
`waitingForYou` 的字段 SHALL 为：
- `total`：已取到且落点放行的审批条数，加上"待我审批"总数中未取到的条数（无法判定落点，原样计入），再加上去重后单独计数的需要你作业条数；
- `truncated`：任一来源被截断时（含"待我审批"总数大于已取到的条数）为 true；
- `items`：按 `at` 倒序的前 10 条（审批取创建时间，需要你作业取最近活动时间），每条含 `kind`、`id`、`title`、`post`、`at`、`href`；
- `unattributed`：`post` 为空的条数。

`post` 沿用既有归属规则，归属岗位对调用者不可见时也照常返回（横幅是否显示岗位名见 `cockpit/home-view`「等你 N 件横幅」）。

#### Scenario: 待我审批被截断时的总数
- **WHEN** 运行同一测试，待我审批总数为 120，已取到 100 条，其中 3 条落点不放行，没有单独计数的需要你作业
- **THEN** `total` 为 117（97 + 未取到的 20），`truncated` 为 true，测试通过

### Requirement: 销售与安装审批的落点
销售与安装类审批条目的 `href`（即落点）SHALL 按类型给出：
- `sales.approve_quote_promotion`、`sales.update_signed_quote` → `/sales/quote-sheet?mode=order&quoteId=<quoteId>`；
- `sales.update_quote_settings` → `/sales/cockpit`；
- `install.send_warranty_email` → `/accounting?tab=balance&order=<orderId>`；
- `install.send_repair_visit_email` → `/install/repairs/<repairId>`。

payload 缺对应 id 时按「其余审批的落点」给出。

#### Scenario: 折扣审批跳报价单
- **WHEN** 运行同一测试，待我审批里有一条 `sales.approve_quote_promotion`，payload 含 `quoteId = q1`
- **THEN** 该条 `href` 为 `/sales/quote-sheet?mode=order&quoteId=q1`，测试通过

#### Scenario: 折扣设置变更跳销售驾驶舱
- **WHEN** 待我审批里有一条 `sales.update_quote_settings`
- **THEN** 该条 `href` 为 `/sales/cockpit`（同一测试覆盖）

#### Scenario: 质保邮件跳会计页
- **WHEN** 待我审批里有一条 `install.send_warranty_email`，payload 含 `orderId = o1`
- **THEN** 该条 `href` 为 `/accounting?tab=balance&order=o1`（同一测试覆盖）

### Requirement: 其余审批的落点
其余审批条目的 `href` SHALL 按类型给出：
- `orders.cancel_blinds_order` → `/blinds-orders/<orderId>`；
- `tender.send_rfq`、`tender.send_chase` → `/projects/<projectId>?tab=bid#rfq-round-<inquiryId>`；
- `revenue_spine.*` → `/revenue`；
- 其余 PendingAction 类型、payload 缺对应 id 的条目、ApprovalRequest 与产品内容审批 → 审批详情 `/capabilities/approvals/<编码后的审批 id>`，审批 id 为 `<来源类型>:<来源 id>`，整段 SHALL 经 URL 编码，与审批中心列表的链接写法相同。

#### Scenario: 没有专属落点的审批跳详情
- **WHEN** 待我审批里有一条 `grader.email_draft`，PendingAction id 为 `pa1`
- **THEN** 该条 `href` 为 `/capabilities/approvals/PENDING_ACTION%3Apa1`（同一测试覆盖）
