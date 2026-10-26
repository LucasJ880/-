# Spec Delta

## MODIFIED Requirements

### Requirement: 统一信封
每条时间线条目 SHALL 为 `{id, at, post, actor, actorName, kind, source, summary, href}`：`kind` 为 `audit`（审计日志）、`agent_event`（AI 运行事件）或 `automation_run`（自动化运行）之一；`id` 以来源前缀区分且全局唯一；`actor` 对审计日志为操作人用户 id，对 AI 运行事件为 `"ai"`，对自动化运行为 `"system"`；`source` 为 `human`、`ai` 或 `system` 之一，表示这条记录由人工、AI 还是系统产生（判定规则见 `cockpit/company-log-labels`）；`post` 为岗位键或 `null`；`href` 为站内路径或 `null`。

#### Scenario: 三种来源
- **WHEN** 运行 `npx tsx src/lib/cockpit/__tests__/timeline.test.ts`
- **THEN** 审计日志、AI 运行事件、自动化运行各转成一条信封，`kind` / `actor` / `source` / `id` 前缀分别正确，退出码 0

### Requirement: 来源范围有界
时间线 SHALL 只取本组织的审计日志与 AI 运行事件。审计日志 SHALL 排除记账 / 查看类动作（配额预留 / 提交 / 释放 / 结算、模型供应商状态查看、敏感审批查看）。AI 运行事件 SHALL 只取有岗位归属的 run（岗位认领的 runType 或 workforce 作业）的、对用户可见且事件类型在白名单内的事件（`run.completed`、`run.failed`、`run.cancelled`、`run.needs_human`、`job.completed`、`job.failed`、`job.cancelled`、`job.waiting_human`、`approval.required`、`verification.needs_human`）。自动化运行是平台级的，SHALL 只取失败或部分失败的运行，以及最长正常间隔不小于 24 小时的自动化的运行。审计日志的变更前后数据 SHALL NOT 出现在条目里；唯一例外是 `cockpit/company-log-labels` 规定的商机阶段变更白名单枚举（流转来源、是否按策略、前后阶段）。

#### Scenario: 高频成功运行不进时间线
- **WHEN** `agent-runs`（每 2 分钟）近 7 天有大量成功运行和 1 次失败
- **THEN** 时间线里只出现那 1 次失败

#### Scenario: 低频成功运行进时间线
- **WHEN** `release-drift`（每日）成功运行一次
- **THEN** 时间线里出现这次运行

#### Scenario: 对话与配额记账不刷屏
- **WHEN** 一次网页对话 run 完成（写 `run.completed`），并写了配额预留 / 提交 / 释放审计
- **THEN** 这些都不进时间线；配额硬上限命中（`QUOTA_HARD_LIMIT_BLOCKED`）照常进

#### Scenario: 变更数据只出白名单枚举
- **WHEN** 运行 `npx tsx src/lib/cockpit/__tests__/posts-read-model.test.ts`
- **THEN** 审计主查询不读变更前后数据，只有商机阶段变更的白名单查询读、且只经枚举解析，退出码 0
