# Spec Delta

## MODIFIED Requirements

### Requirement: 统一信封
每条时间线条目 SHALL 为 `{id, at, post, actor, actorName, kind, source, summary, href}`：`kind` 为 `audit`（审计日志）、`agent_event`（AI 运行事件）或 `automation_run`（自动化运行）之一；`id` 以来源前缀区分且全局唯一；`actor` 对审计日志为操作人用户 id，对 AI 运行事件为 `"ai"`，对自动化运行为 `"system"`；`source` 为 `human`、`ai` 或 `system` 之一，表示这条记录由人工、AI 还是系统产生（判定规则见 `cockpit/company-log-labels`）；`post` 为岗位键或 `null`；`href` 为站内路径或 `null`。

#### Scenario: 三种来源
- **WHEN** 运行 `npx tsx src/lib/cockpit/__tests__/timeline.test.ts`
- **THEN** 审计日志、AI 运行事件、自动化运行各转成一条信封，`kind` / `actor` / `source` / `id` 前缀分别正确，退出码 0
