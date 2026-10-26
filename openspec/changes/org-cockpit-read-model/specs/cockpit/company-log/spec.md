# Spec Delta

## Purpose

组织驾驶舱的 company.log：把审计日志、AI 运行事件与自动化运行合成一条按时间倒序的只读时间线，统一信封、可分页，供首页底部展示"系统、AI 与人这几天做了什么"。

## ADDED Requirements

### Requirement: 时间线接口与岗位总览同一访问控制
`GET /api/cockpit/timeline` SHALL 与岗位总览接口使用相同的登录、组织解析与管理层校验；非管理层 SHALL 返回 403。接口 SHALL NOT 写入任何表。

#### Scenario: 非管理层
- **WHEN** 组织普通成员调用 `GET /api/cockpit/timeline`
- **THEN** 返回 403

### Requirement: 统一信封
每条时间线条目 SHALL 为 `{id, at, post, actor, actorName, kind, summary, href}`：`kind` 为 `audit`（审计日志）、`agent_event`（AI 运行事件）或 `automation_run`（自动化运行）之一；`id` 以来源前缀区分且全局唯一；`actor` 对审计日志为操作人用户 id，对 AI 运行事件为 `"ai"`，对自动化运行为 `"system"`；`post` 为岗位键或 `null`；`href` 为站内路径或 `null`。

#### Scenario: 三种来源
- **WHEN** 运行 `npx tsx src/lib/cockpit/__tests__/timeline.test.ts`
- **THEN** 审计日志、AI 运行事件、自动化运行各转成一条信封，`kind` / `actor` / `id` 前缀分别正确，退出码 0

### Requirement: 条目的岗位归属只用结构化字段
自动化运行 SHALL 按岗位注册表的自动化归属；AI 运行事件 SHALL 按所属 AgentRun 的 runType 归属，workforce 作业按其 `metadata.workDomain`；目标为待审批动作的审计日志 SHALL 按该动作的归属规则；其余条目的 `post` SHALL 为 `null`，SHALL NOT 按文本推断。

#### Scenario: workforce 作业事件
- **WHEN** 一条 `job.waiting_human` 事件所属 run 为 `workforce_job` 且工作域为 `tender`
- **THEN** 条目 `post` 为 `tender`，`href` 为 `/workforce/<run id>`

#### Scenario: 无法归属的审计日志
- **WHEN** 一条审计日志的目标类型不是待审批动作
- **THEN** 条目 `post` 为 `null`

### Requirement: 来源范围有界
时间线 SHALL 只取本组织的审计日志与 AI 运行事件；AI 运行事件 SHALL 只取对用户可见、且事件类型在白名单内的（`run.completed`、`run.failed`、`run.cancelled`、`run.needs_human`、`job.completed`、`job.failed`、`job.waiting_human`、`job.resume_blocked`、`approval.required`）。自动化运行是平台级的，SHALL 只取失败或部分失败的运行，以及最长正常间隔不小于 24 小时的自动化的运行。审计日志的变更前后数据 SHALL NOT 出现在条目里。

#### Scenario: 高频成功运行不进时间线
- **WHEN** `agent-runs`（每 2 分钟）近 7 天有大量成功运行和 1 次失败
- **THEN** 时间线里只出现那 1 次失败

#### Scenario: 低频成功运行进时间线
- **WHEN** `release-drift`（每日）成功运行一次
- **THEN** 时间线里出现这次运行

### Requirement: 倒序游标分页且有窗口与条数上限
条目 SHALL 按 `(at, id)` 严格倒序；查询参数 `limit` 默认 20、取值 1..50，`days` 默认 7、取值 1..7，超出范围或格式错误 SHALL 返回 400；`cursor` 为上一页返回的 `nextCursor`，格式错误 SHALL 返回 400。翻页 SHALL NOT 重复或遗漏条目；最后一页 `nextCursor` 为 `null`。响应 SHALL 含 `window: {from, to}`。每个来源每次查询 SHALL 最多取 `limit + 1` 条。

#### Scenario: 三路归并翻页
- **WHEN** 三个来源共 7 条、时间交错，以 `limit=3` 连续翻页
- **THEN** 依次得到 3、3、1 条，合起来恰好是 7 条且按时间倒序，最后一页 `nextCursor` 为 `null`

#### Scenario: 参数越界
- **WHEN** 请求 `limit=51` 或 `days=8` 或 `cursor=not-a-cursor`
- **THEN** 返回 400

### Requirement: 时间线文本脱敏
条目的 `summary` 命中敏感词检测（毛利、利润、估值、`winningBidPrice`、`ourBidPrice`、内部成本等）时 SHALL 整段替换为固定提示，不做局部遮盖；自动化运行的错误信息 SHALL 截断后再经同一检测。

#### Scenario: 运行错误里含利润字样
- **WHEN** 一次失败运行的错误信息含"利润"
- **THEN** 该条目 `summary` 为驾驶舱脱敏提示
