# Spec Delta

## ADDED Requirements

### Requirement: 时间线按可见岗位与可读作业收口
时间线的判定输入 SHALL 与岗位总览相同（调用者在驾驶舱企业的同一份判定输入）。平台级自动化运行条目 SHALL 只在其岗位对调用者可见时出现（见 `cockpit/post-registry`「岗位卡片的可见条件」），归属为空的 SHALL NOT 出现；平台 super_admin 照旧全部出现。workforce 作业事件条目 SHALL 照常出现，但 `href` SHALL 只在该作业按其显式工作域对调用者可读时为 `/workforce/<run id>`，否则为 `null`（见 `agents/workforce-job-scope`）。审计条目不因岗位可见性增减。

#### Scenario: Sunny 老板看不到平台专属岗位的运行
- **WHEN** 运行 `npx tsx src/lib/cockpit/__tests__/timeline.test.ts`，以 Sunny 持 `owner` 岗位的输入组装时间线，来源里有 `release-drift`（运维与知识）失败与 `tender-watch`（投标）失败各一条
- **THEN** 只出现 `tender-watch` 那条，测试通过

#### Scenario: 读不了的作业不带链接
- **WHEN** 以梦馨（未启用 `bids` / `projects`）持 `owner` + `trade_rep` 岗位的输入组装，来源里有一条投标域 workforce 作业事件
- **THEN** 该条出现，`href` 为 `null`（同一测试覆盖）
