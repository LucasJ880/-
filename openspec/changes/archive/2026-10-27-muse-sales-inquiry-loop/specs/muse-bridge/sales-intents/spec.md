# Spec Delta

## ADDED Requirements

### Requirement: 询问与回复意图默认不开放

`ask_colleague` 与 `reply_inquiry` SHALL 不属于默认放行意图集；只有 `MUSE_BRIDGE_INTENTS` 显式列出时才执行，否则 SHALL 返回 `INTENT_NOT_ENABLED` 与 `availableInPhase`，提示文字 SHALL 写"Sales Pilot（Phase S）"。

#### Scenario: 未开放

- **WHEN** `MUSE_BRIDGE_INTENTS` 未列出 `ask_colleague` 时发送该意图
- **THEN** 响应 `errorCode=INTENT_NOT_ENABLED`，不创建任何 Task；`npx tsx src/lib/muse-bridge/__tests__/inquiry-pure.test.ts` 覆盖

### Requirement: 只有管理角色能发起询问，收件人由服务端决定

`ask_colleague` SHALL 只允许管理角色（与 S1 读范围相同的判定）发起；收件人 SHALL 是商机当前负责人，请求里不能指定收件人。商机不存在或不在本组织 SHALL 返回 `OPPORTUNITY_NOT_FOUND`；商机没有负责人、负责人不是有效成员或负责人就是发起人 SHALL 返回 `OPPORTUNITY_UNASSIGNED`，不创建 Task。

#### Scenario: 销售角色发起询问

- **WHEN** 平台角色为 sales 的用户发送 `ask_colleague`
- **THEN** 响应 `errorCode=PERMISSION_DENIED`，不创建 Task；隔离库测试 `inquiry-db.isolated.test.ts` 覆盖

#### Scenario: 商机没有负责人

- **WHEN** 管理者对 `assignedToId` 为空的商机发送 `ask_colleague`
- **THEN** 响应 `errorCode=OPPORTUNITY_UNASSIGNED`，不创建 Task

### Requirement: 询问落库为可追踪的内部任务

成功的 `ask_colleague` SHALL 创建一条 Task：负责人为商机负责人、创建人为发起人、状态 `waiting_internal`、期限为 `replyBy`（缺省为 24 小时后）、来源为 `muse_inquiry` 并关联商机 ID；问题、发起人备注、商机记录版本与 workflowId SHALL 记入该 Task 的活动记录。同一 `requestId` 重放 SHALL 返回首次响应且不创建第二条 Task。响应 `data` SHALL 含 `inquiryId`、`workflowId`、收件人与期限。

#### Scenario: 创建询问

- **WHEN** 管理者对有负责人的商机发送 `ask_colleague`，问题 2 条
- **THEN** 数据库中出现 1 条 `sourceType=muse_inquiry`、`sourceId=该商机` 的 Task，负责人正确；响应带 `inquiryId`；隔离库测试覆盖

#### Scenario: 重放

- **WHEN** 同一 `requestId` 再发一次
- **THEN** 响应与首次相同，Task 数量仍为 1

### Requirement: 询问事件通知收件人

创建询问后 SHALL 向收件人发出一条 `inquiry.received` 事件（同时是青砚站内通知），信封 SHALL 带 `opportunityId` 与 `inquiryId`，摘要 SHALL NOT 含商机金额；同一询问 SHALL 只发一次。站内通知点击 SHALL 打开 `/sales/inquiries/<inquiryId>`。

#### Scenario: 收件人收到事件

- **WHEN** 询问创建成功
- **THEN** 收件人的 `GET /api/bridge/muse/events` 能拉到 1 条 `inquiry.received`，带 `inquiryId`；隔离库测试覆盖

### Requirement: 只有收件人能回复，且只能回复一次

`reply_inquiry` 与网页回复 SHALL 只接受该询问负责人本人的回复，其他人 SHALL 得到 `INQUIRY_NOT_FOUND`（与不存在同一口径）。回复 SHALL 必填下一步（`nextStep`），可选客户反馈、最近联系时间、下一步期限与需要的支持（资料 / 会议 / 样板 / 报价修订 / 其他）。询问已回复或已取消时 SHALL 返回 `INQUIRY_CLOSED`。成功回复 SHALL 写入一条以回复人为作者的评论与一条带渠道（`muse` 或 `web`）的结构化活动记录，并把询问 Task 置为 `done`。

#### Scenario: 非收件人回复

- **WHEN** 发起人或其他销售对该询问发送 `reply_inquiry`
- **THEN** 响应 `errorCode=INQUIRY_NOT_FOUND`，Task 状态不变

#### Scenario: 重复回复

- **WHEN** 收件人对已回复的询问再次回复（不同 requestId）
- **THEN** 响应 `errorCode=INQUIRY_CLOSED`，评论数仍为 1

### Requirement: 回复事件通知发起人

成功回复后 SHALL 向发起人发出一条 `inquiry.replied` 事件，摘要包含回复人与下一步，SHALL NOT 含商机金额；同一询问 SHALL 只发一次。

#### Scenario: 发起人收到回复事件

- **WHEN** 收件人回复成功
- **THEN** 发起人能拉到 1 条 `inquiry.replied`，带 `inquiryId` 与 `opportunityId`；隔离库测试覆盖

### Requirement: 商机状态把员工确认与 CRM 事实分开

`opportunity_status` 的 `data.employeeConfirmations` SHALL 列出该商机已回复的询问（回复人、回复时间、渠道、结构化答案、询问 ID），`data.openInquiries` SHALL 列出未结束的询问（负责人、期限、是否逾期）。管理角色且该商机没有未结束询问时，回复的下一步 SHALL 是 `ask_colleague`，参数带系统按已知信号生成的默认问题；销售角色 SHALL NOT 得到该下一步。

#### Scenario: 回复后查看商机

- **WHEN** 收件人回复后，管理者查询该商机
- **THEN** `employeeConfirmations` 含 1 条，`channel` 与 `nextStep` 正确，`openInquiries` 为空；隔离库测试覆盖

### Requirement: 网页回复入口

`GET /api/sales/inquiries/<id>` SHALL 只向登录的负责人或发起人返回问题、商机标题、期限与状态；`POST` SHALL 只接受负责人提交，校验规则与 `reply_inquiry` 相同，渠道记为 `web`。其他登录用户 SHALL 得到 404。页面 `/sales/inquiries/<id>` SHALL 展示问题并在可回复时提供表单。

#### Scenario: 网页回复

- **WHEN** 负责人通过 `POST /api/sales/inquiries/<id>` 提交下一步
- **THEN** 结果与 `reply_inquiry` 相同，活动记录渠道为 `web`；隔离库测试直接调用服务层覆盖
