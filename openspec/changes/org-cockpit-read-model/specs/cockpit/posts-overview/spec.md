# Spec Delta

## Purpose

组织驾驶舱的岗位总览接口：一次请求返回七个岗位各自的自动化心跳、调度与健康度、待审批、需要你、近 7 天动作数与 KPI，以及顶部去重后的"等你 N 件"，供首页岗位卡片使用。只读、按组织限定、只对管理层开放。

## ADDED Requirements

### Requirement: 岗位总览接口只对本组织管理层只读开放
`GET /api/cockpit/posts` SHALL 要求登录；组织 SHALL 按只读的 workforce 组织解析规则确定（多组织未选择时 403 并提示选择组织，无组织时 403）；调用者 SHALL 是平台超管 / 高管，或该组织的 `org_admin` / `org_owner`，否则 403。接口 SHALL NOT 写入任何表、SHALL NOT 改变调用者的活动组织。

#### Scenario: 非管理层成员
- **WHEN** 组织的普通成员（`org_member`）调用 `GET /api/cockpit/posts`
- **THEN** 返回 403，响应体不含任何岗位数据

#### Scenario: 多组织未选择
- **WHEN** 有多个可用组织且未选择活动组织的用户调用接口
- **THEN** 返回 403 且 `needsSelection: true`

#### Scenario: 只读
- **WHEN** 运行 `npx tsx src/lib/cockpit/__tests__/posts-read-model.test.ts`
- **THEN** 静态断言读模型与两个路由源码中不出现 `create(` / `update(` / `upsert(` / `delete(` / `createMany` / `updateMany` / `deleteMany` / `$executeRaw` / `resolvePreferredOrgId`，退出码 0

### Requirement: 响应按岗位注册表顺序返回七个岗位
响应 SHALL 含 `orgId`、`generatedAt`、组织时区 `timezone`、`heartbeatScope: "platform"`、`quotaHit`、`waitingForYou` 与 `posts`；`posts` SHALL 恰好七项、顺序与岗位注册表一致，每项含 `key`、`name`、`nav`、`health`、`heartbeat`、`nextDueAt`、`automations`、`pendingApprovals`、`needsYou`、`actions7d`、`kpi`。

#### Scenario: 七个岗位
- **WHEN** 管理层用户调用接口
- **THEN** `posts` 依次为 `inbound_sales`、`tender`、`marketing`、`service`、`projects`、`ops_knowledge`、`content`，每个岗位的 `automations` 恰好是它在注册表里的自动化

### Requirement: 自动化调度表与线上调度一致
系统 SHALL 为每个自动化维护一条调度：随 cron 每次触发都记录运行的、按 cron 计划；按本地时刻门控的（在本地某些小时才记录运行）、给出门控小时与时区（组织时区或固定时区）；按需运行的。每条 cron 计划 SHALL 与 `vercel.json` 中该自动化路由的 `schedule` 一致，每组门控小时 SHALL 与路由源码中的门控数组一致。

#### Scenario: 调度表与 vercel.json 对照
- **WHEN** 运行 `npx tsx src/lib/cockpit/__tests__/schedule.test.ts`
- **THEN** 28 个自动化各有一条调度；非按需的每一条都能在 `vercel.json` 找到同路径同 `schedule` 的 cron；门控小时与路由源码一致，退出码 0

#### Scenario: 新增自动化未配调度
- **WHEN** 自动化注册表新增一个键而调度表未配
- **THEN** `npm run typecheck` 失败，调度测试失败

### Requirement: 下次应跑时间按调度与组织时区推算
`nextDueAt` SHALL 是当前时刻之后第一个满足调度的触发时刻：cron 计划按 UTC 推算；本地时刻门控的取 cron 触发时刻中、换算到对应时区后小时落在门控小时内（及星期匹配）的第一个；按需运行的为 `null`。岗位的 `nextDueAt` SHALL 是其自动化中最早的一个。

#### Scenario: 组织时区的每日简报
- **WHEN** 组织时区为 `Asia/Shanghai`，当前为 UTC `2026-10-25T22:30:00Z`（上海 06:30）
- **THEN** `daily-brief` 的 `nextDueAt` 为 `2026-10-25T23:00:00Z`（上海 07:00）

#### Scenario: 跨日边界
- **WHEN** 组织时区为 `America/Toronto`，当前为多伦多当地 07:10
- **THEN** `daily-brief` 的 `nextDueAt` 为次日当地 07:00 对应的 UTC 时刻

#### Scenario: 按需运行
- **WHEN** 推算 `marketing-mmm`
- **THEN** `nextDueAt` 为 `null`，健康度为 `n/a`

### Requirement: 单个自动化的健康度按固定顺序判定
单个自动化的健康度 SHALL 按以下顺序取第一个命中：按需运行 → `n/a`；缺必需环境变量或开关未开 → `not_configured`；从未运行 → `never_ran`；最近一次运行失败，或仍为运行中且已超过 30 分钟 → `failed`；距最近一次开始超过"最长正常间隔 × 1.5" → `late`；否则 `on_time`。最长正常间隔 SHALL 由调度推出：cron 计划取相邻两次触发的最大间隔，本地时刻门控取门控小时之间的最大环形间隔（带星期的为 7 天）。

#### Scenario: 迟到
- **WHEN** `inquiry-sla`（每 5 分钟）最近一次开始于 8 分钟前且成功
- **THEN** 健康度为 `late`（8 > 5 × 1.5）

#### Scenario: 跟进建议的最长间隔
- **WHEN** 推算 `trade-followup`（门控小时 9、14）
- **THEN** 最长正常间隔为 19 小时；最近一次开始于 20 小时前时为 `on_time`，30 小时前时为 `late`

#### Scenario: 卡住的运行
- **WHEN** 最近一次运行状态为 `running` 且开始于 31 分钟前
- **THEN** 健康度为 `failed`

#### Scenario: 未配置
- **WHEN** `aivora-sync` 缺 `AIVORA_API_KEY`
- **THEN** 健康度为 `not_configured`，不是 `never_ran`

### Requirement: 岗位健康度取最严重者并反映配额命中
岗位健康度 SHALL 按 `failed` > `quota_hit` > `late` > `never_ran` > `not_configured` > `on_time` > `n/a` 取其自动化中最严重者；当天（UTC）该组织 `DAILY_AGENT_RUNS` 硬上限命中时，有 AgentRun 工作的岗位（有 runType 或工作域归属）SHALL 至少为 `quota_hit`。配额命中 SHALL 由当天的 `QUOTA_HARD_LIMIT_BLOCKED` 审计记录或查看人收到的 `quota_hard_limit` 通知判定。

#### Scenario: 配额命中
- **WHEN** 当天有 `DAILY_AGENT_RUNS` 的硬上限命中记录，询盘销售岗位的自动化都 `on_time`
- **THEN** `inbound_sales` 的健康度为 `quota_hit`，`marketing`（没有 AgentRun 工作）不受影响，响应 `quotaHit: true`

#### Scenario: 失败优先于配额
- **WHEN** 配额命中且投标岗位有一个自动化 `failed`
- **THEN** `tender` 的健康度为 `failed`

### Requirement: 心跳取岗位自动化中最近的一次运行
岗位 `heartbeat` SHALL 是其自动化最近一次运行中开始时间最晚的一条（含 `automationKey`、`status`、`startedAt`、`completedAt`），没有任何运行时为 `null`。心跳与健康度 SHALL 按平台级运行记录计算，响应 SHALL 以 `heartbeatScope: "platform"` 标明。

#### Scenario: 无运行记录
- **WHEN** 某岗位的所有自动化都没有运行记录
- **THEN** 该岗位 `heartbeat` 为 `null`

### Requirement: 等你 N 件按现成"待我审批"口径并与需要你去重
`waitingForYou` SHALL 由两部分组成：(1) 与 `/capabilities/approvals` 的"待我审批"相同口径的条目（PendingAction / ApprovalRequest / 产品内容审批中状态为待审批且调用者有决策权的）；(2) 本组织 workforce 中状态为需要你的作业。作业关联的 PendingAction 全部已在 (1) 中时 SHALL 不再单独计数。需决策类通知 SHALL NOT 另计。`total` 为去重后的条数，`items` 为按创建时间倒序的前 10 条，每条含 `kind`、`id`、`title`、`post`、`createdAt`、`href`；`unattributed` 为 `post` 为空的条数；任一来源被截断时 `truncated: true`。

#### Scenario: 作业与其审批去重
- **WHEN** 一个需要你的作业关联的 PendingAction 也在待我审批里
- **THEN** `total` 只计 1，`items` 里只出现这条 PendingAction

#### Scenario: 作业有未进待我审批的需要你
- **WHEN** 一个需要你的作业没有关联 PendingAction（如需要澄清）
- **THEN** 它作为 `kind: "workforce_job"` 计入 `total`，`href` 为 `/workforce/<作业 id>`

### Requirement: 待审批与需要你按岗位归属
每个岗位的 `pendingApprovals` SHALL 是 `waitingForYou` 第 (1) 部分里归属该岗位的条数：PendingAction 按岗位注册表的动作归属规则（通用动作类型按行上下文）；ApprovalRequest 按其项目工作域，无法判定时归 `projects`；产品内容审批归 `content`。每个岗位的 `needsYou` SHALL 是第 (2) 部分里工作域归属该岗位的作业数（不受去重影响）；工作域缺失的旧作业 SHALL 按既有的有效工作域解析规则判定，判定不出不归属任何岗位。

#### Scenario: 通用动作按上下文归属
- **WHEN** 待我审批里有一条 `grader.email_draft`，payload 的 `targetType` 为 `CUSTOMER`
- **THEN** 它计入 `inbound_sales` 的 `pendingApprovals`

#### Scenario: 销售工作域的需要你作业
- **WHEN** 一个需要你作业的 `metadata.workDomain` 为 `sales`
- **THEN** 它计入 `inbound_sales` 的 `needsYou`

### Requirement: 近 7 天动作数
每个岗位的 `actions7d` SHALL 含 `automationRuns`（其自动化近 7 天开始的运行数，平台级）与 `agentRuns`（本组织近 7 天创建、runType 归属该岗位，或为 workforce 作业且工作域归属该岗位的 AgentRun 数）。

#### Scenario: 归属计数
- **WHEN** 本组织近 7 天有 3 个 `fde_inbound_sales` 与 2 个工作域为 `sales` 的 workforce 作业
- **THEN** `inbound_sales.actions7d.agentRuns` 为 5

### Requirement: KPI 只经岗位注册表声明取值
每个岗位的 `kpi` SHALL 为以下之一：`{status: "ok", window, metrics: [{label, format, value}] × 3}`，值只取注册表声明的三个路径；`{status: "unavailable", reason}`（注册表标为未接入）；`{status: "disabled", reason}`（投标 KPI 在 `TENDER_FINANCIAL_CONTROL_ENABLED` 未开启时）；`{status: "error"}`（读函数抛错）。一个岗位的 KPI 失败 SHALL NOT 影响其他岗位与接口整体。

#### Scenario: 财务控制未开启
- **WHEN** `TENDER_FINANCIAL_CONTROL_ENABLED` 未开启
- **THEN** `tender.kpi.status` 为 `disabled`，投标汇总读函数不被调用

#### Scenario: 读函数抛错
- **WHEN** 营销看板读函数抛错
- **THEN** `marketing.kpi` 为 `{status: "error"}`，其余岗位与接口照常返回 200

### Requirement: 岗位总览不输出敏感字段
响应 SHALL NOT 包含毛利 / 毛利率、利润、项目估值、我方报价或最终报价（`winningBidPrice` / `ourBidPrice`）、中标金额的字段或数值；KPI 读函数结果 SHALL NOT 被整体透出。自由文本（条目标题）命中敏感词检测时 SHALL 整段替换为固定提示，不做局部遮盖。

#### Scenario: 标题含毛利
- **WHEN** 一条待我审批的标题含"毛利"
- **THEN** 该条 `title` 被整段替换为驾驶舱脱敏提示

#### Scenario: KPI 只含声明字段
- **WHEN** 投标汇总读函数的返回值含 `wonProjects.finalizedMarginPercentage`
- **THEN** 响应里不出现该字段名与数值
