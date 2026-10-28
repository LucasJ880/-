# muse-bridge/sales-intents Specification

## Purpose
Muse 通道上的销售协作意图：让绑定了青砚用户的个人助理在服务端权限范围内读取销售商机、获得可解释的优先级，并在后续批次里完成询问、回复与跟进。

## Requirements

### Requirement: 销售意图默认不开放

`sales_overview` 与 `opportunity_status` SHALL 不属于默认放行意图集；只有当 `MUSE_BRIDGE_INTENTS` 显式列出时才执行，否则 SHALL 返回 `INTENT_NOT_ENABLED` 与 `availableInPhase`。

#### Scenario: 未配置时被诚实拒绝

- **WHEN** `MUSE_BRIDGE_INTENTS` 未设置，Bridge 发送 `sales_overview`
- **THEN** 响应 `ok=false`、`errorCode=INTENT_NOT_ENABLED`、带 `availableInPhase`，不访问任何销售数据；`npx tsx src/lib/muse-bridge/__tests__/sales-pure.test.ts` 覆盖

### Requirement: 契约只追加

`muse-bridge/v1` SHALL 接受 `sales_overview`（可选 `days` 1–90、`assigneeUserId`、`limit` 1–20）与 `opportunity_status`（必填 `opportunityId`）；越界或缺参 SHALL 整包拒绝为 `VALIDATION_FAILED`；未知字段 SHALL 被丢弃；既有 12 个意图的解析结果 SHALL 不变。

#### Scenario: 合法与非法参数

- **WHEN** 解析 `{intent:"sales_overview", days:30}`、`{intent:"sales_overview", days:0}`、`{intent:"opportunity_status"}`
- **THEN** 第一条成功，后两条失败；`npx tsx src/lib/muse-bridge/__tests__/muse-bridge-pure.test.ts` 断言意图总数为 14

### Requirement: 读范围由服务端角色决定

系统 SHALL 只根据已绑定身份的平台角色与组织角色决定读范围：管理角色（平台 admin、super_admin、boss、manager，或组织 org_owner、org_admin）读本组织全部商机；销售角色（平台 sales、trade）只读 `assignedToId` 等于本人的商机；其余角色 SHALL 得到 `PERMISSION_DENIED`。请求里的任何身份字段 SHALL NOT 影响读范围。

#### Scenario: 销售只看到自己的商机

- **WHEN** 平台角色为 sales 的用户调用 `sales_overview`，组织里有分配给他和分配给别人的开放商机
- **THEN** 响应只包含分配给他的商机；隔离库测试 `sales-db.isolated.test.ts` 覆盖

#### Scenario: 销售指定别人的 assigneeUserId

- **WHEN** 销售角色调用 `sales_overview` 且 `assigneeUserId` 不是本人
- **THEN** 响应 `errorCode=PERMISSION_DENIED`，不返回任何商机

#### Scenario: 无销售角色

- **WHEN** 平台角色为 user、组织角色为 org_member 的用户调用任一销售意图
- **THEN** 响应 `errorCode=PERMISSION_DENIED`

### Requirement: 跨范围商机一律视为不存在

`opportunity_status` 对不属于本组织、或不在调用者读范围内的商机 SHALL 返回 `OPPORTUNITY_NOT_FOUND`，消息文字与真正不存在时相同。

#### Scenario: 其他组织的商机

- **WHEN** 调用者传入另一组织的商机 ID
- **THEN** 响应 `errorCode=OPPORTUNITY_NOT_FOUND`，`data` 为空；隔离库测试覆盖

### Requirement: 可解释的确定性优先级

`sales_overview` SHALL 只对开放态商机排序（Sunny 历史阶段按既有投影表折算），排序 SHALL 只依赖商机已有字段与当前时间、不调用 LLM，同样输入 SHALL 得到同样顺序。每条商机 SHALL 附带命中的规则理由，规则为：客户来信后没有我方外发记录、约定跟进日已过、有逾期的跟进行动、CRM 超过停滞阈值无互动、所处阶段、热度标记、金额在本次列表中的位置。

#### Scenario: 客户在等回复的商机排第一

- **WHEN** 两个开放商机其余条件相同，只有一个的 `lastCustomerReplyAt` 晚于 `lastOutboundAt`
- **THEN** 该商机排第一，理由含"之后没有我方外发记录"；纯逻辑测试覆盖

#### Scenario: 终态商机不进入排序

- **WHEN** 商机阶段为 won、lost、disqualified、nurture、stale 或历史阶段 signed / completed / on_hold
- **THEN** 它不出现在排序列表里，但计入窗口内成交 / 丢单统计（如适用）

### Requirement: 不把缺失记录说成没跟进

当商机在 CRM 中超过停滞阈值没有互动记录时，理由文字 SHALL 写明"未核实是否有线下跟进"，SHALL NOT 断言负责人没有跟进；缺失的负责人、下次跟进日、最近互动（以及管理角色下的金额）SHALL 列入该商机的 `unverified`。

#### Scenario: 停滞商机的理由

- **WHEN** 开放商机最后互动距今超过组织的停滞阈值
- **THEN** 理由包含"CRM"与"未核实是否有线下跟进"，不包含"未跟进"或"没跟进"

### Requirement: 商机状态视图把事实与建议分开

`opportunity_status` SHALL 在 `data` 中分开返回：CRM 事实（商机 ID、标题、客户、阶段、负责人、各时间戳、`updatedAt` 作为记录版本、`observedAt`）、最近 5 条互动、未结束的跟进行动、系统写入的下一步建议（标注来源）、优先级理由、`unverified`、`employeeConfirmations`（本批次恒为空数组）。

#### Scenario: 状态视图字段齐全

- **WHEN** 管理角色查询一个有互动和未结束跟进行动的商机
- **THEN** `data` 含上述各段，`opportunity.id` 与数据库记录一致，`employeeConfirmations` 为 `[]`；隔离库测试覆盖

### Requirement: 金额只对管理角色输出（决定 B）

销售意图 SHALL 只在管理角色的响应中输出商机金额。销售角色的响应 `data` SHALL NOT 含 `amount` 字段，消息与理由 SHALL NOT 含金额数字。互动摘要命中既有出站敏感模式时 SHALL 整段替换为脱敏提示。

#### Scenario: 销售角色看不到金额

- **WHEN** 销售角色查询自己负责、`estimatedValue` 非空的商机
- **THEN** 响应 JSON 中不出现 `amount` 键，也不出现该金额数字；隔离库测试覆盖

#### Scenario: 互动摘要含敏感词

- **WHEN** 某条互动摘要包含"毛利"
- **THEN** 该条在 `data` 中的摘要被替换为脱敏提示原文

### Requirement: 回复格式与重放

销售意图的成功回复 SHALL 走既有建议式格式（结论 ≤ 60 字、理由 ≤ 3 条、下一步至多 1 个且只指向已放行意图）；同一 `requestId` 在 24 小时内重放 SHALL 返回首次响应且不重新查询。

#### Scenario: 重放

- **WHEN** 同一 `requestId` 的 `sales_overview` 发送两次，期间新增了一个商机
- **THEN** 第二次响应与第一次完全相同；隔离库测试覆盖

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
