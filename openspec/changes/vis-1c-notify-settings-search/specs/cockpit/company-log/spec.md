# Spec Delta

## ADDED Requirements

### Requirement: 时间线按可见岗位与可读作业收口
时间线的判定输入 SHALL 与岗位总览相同（调用者在驾驶舱企业的同一份判定输入）。自动化运行 SHALL 只取归属岗位对调用者可见的自动化（见 `cockpit/post-registry`「岗位卡片的可见条件」），过滤 SHALL 在来源查询里按自动化键完成，翻页仍满足「倒序游标分页且有窗口与条数上限」；平台 super_admin 不受此限。workforce 作业事件条目照常出现，`href` SHALL 只在该作业按显式工作域对调用者可读时为 `/workforce/<run id>`；没有显式工作域的，只在调用者可读全部工作域时给出；否则为 `null`。审计条目不因岗位可见性增减。

#### Scenario: Sunny 老板看不到平台专属岗位的运行
- **WHEN** 运行 `npx tsx src/lib/cockpit/__tests__/timeline.test.ts`，以 Sunny 持 `owner` 岗位的输入计算自动化可见键
- **THEN** 含 `tender-watch`，不含 `release-drift`，测试通过

#### Scenario: 自动化过滤在查询里
- **WHEN** 运行 `npx tsx src/lib/cockpit/__tests__/posts-read-model.test.ts`
- **THEN** 非 super_admin 调用时，自动化运行查询条件带可见自动化键；super_admin 调用时不带，测试通过

#### Scenario: 读不了的作业不带链接
- **WHEN** 以梦馨（未启用 `bids` / `projects`）持 `owner` + `trade_rep` 岗位的输入组装，来源里有一条工作域为 `tender` 的 workforce 作业事件
- **THEN** 该条出现，`href` 为 `null`（timeline 测试覆盖）

## MODIFIED Requirements

### Requirement: 条目的岗位归属只用结构化字段
自动化运行 SHALL 按岗位注册表的自动化归属；AI 运行事件 SHALL 按所属 AgentRun 的 runType 归属，workforce 作业按其 `metadata.workDomain`；目标为待审批动作的审计日志 SHALL 按该动作的归属规则；其余条目的 `post` SHALL 为 `null`，SHALL NOT 按文本推断。

#### Scenario: workforce 作业事件
- **WHEN** 一条 `job.waiting_human` 事件所属 run 为 `workforce_job` 且工作域为 `tender`，调用者可读 `tender` 工作域
- **THEN** 条目 `post` 为 `tender`，`href` 为 `/workforce/<run id>`

#### Scenario: 无法归属的审计日志
- **WHEN** 一条审计日志的目标类型不是待审批动作
- **THEN** 条目 `post` 为 `null`

### Requirement: 来源范围有界
时间线 SHALL 只取本组织的审计日志与 AI 运行事件。审计日志 SHALL 排除记账 / 查看类动作（配额预留 / 提交 / 释放 / 结算、模型供应商状态查看、敏感审批查看）。AI 运行事件 SHALL 只取有岗位归属的 run（岗位认领的 runType 或 workforce 作业）的、对用户可见且事件类型在白名单内的事件（`run.completed`、`run.failed`、`run.cancelled`、`run.needs_human`、`job.completed`、`job.failed`、`job.cancelled`、`job.waiting_human`、`approval.required`、`verification.needs_human`）。自动化运行是平台级的，SHALL 只取失败或部分失败的运行，以及最长正常间隔不小于 24 小时的自动化的运行。审计日志的变更前后数据 SHALL NOT 出现在条目里；唯一例外是 `cockpit/company-log-labels` 规定的商机阶段变更白名单枚举（流转来源、是否按策略、前后阶段）。

#### Scenario: 高频成功运行不进时间线
- **WHEN** `agent-runs`（每 2 分钟）近 7 天有大量成功运行和 1 次失败
- **THEN** 时间线里只出现那 1 次失败

#### Scenario: 低频成功运行进时间线
- **WHEN** 平台 super_admin 调用，`release-drift`（每日）成功运行一次
- **THEN** 时间线里出现这次运行

#### Scenario: 对话与配额记账不刷屏
- **WHEN** 一次网页对话 run 完成（写 `run.completed`），并写了配额预留 / 提交 / 释放审计
- **THEN** 这些都不进时间线；配额硬上限命中（`QUOTA_HARD_LIMIT_BLOCKED`）照常进

#### Scenario: 变更数据只出白名单枚举
- **WHEN** 运行 `npx tsx src/lib/cockpit/__tests__/posts-read-model.test.ts`
- **THEN** 审计主查询不读变更前后数据，只有商机阶段变更的白名单查询读、且只经枚举解析，退出码 0
