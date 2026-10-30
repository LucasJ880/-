## MODIFIED Requirements

### Requirement: 条目来源

时间线条目 SHALL 按以下规则标出来源：
- AI 运行事件为 `ai`，自动化运行为 `system`；
- 审计条目默认为 `human`；
- 固定由 FDE 写入的审计（FDE 草稿留底、跟进草稿被守卫拦下、草稿偏好有项被忽略）为 `ai`；
- 固定由系统写入的审计（审批被系统作废、配额守卫的三档提醒、询价邮件自动录入成功 / 失败、人工外发同步到商机、岗位日结）为 `system`；
- 商机阶段变更按审计记录的流转来源：人工为 `human`、FDE 为 `ai`、系统为 `system`；记录缺失或不是已知值时为 `human`；
- 发起审批按该审批记录的发起方：AI 发起为 `ai`，人工发起、缺失或找不到审批时为 `human`；批准、驳回等审批决定始终按人工。

#### Scenario: FDE 留底
- **WHEN** 一条审计动作为 FDE 草稿留底，操作人是负责人
- **THEN** 该条目 `source` 为 `ai`，`actor` 仍为负责人的用户 id

#### Scenario: 人工阶段变更
- **WHEN** 商机阶段变更审计记录来源为人工
- **THEN** 该条目 `source` 为 `human`

#### Scenario: FDE 发起的审批
- **WHEN** 一条"发起审批"审计对应的审批由 FDE（AI）发起，操作人是负责人
- **THEN** 该条目 `source` 为 `ai`；同一审批后续的"批准"条目 `source` 为 `human`

#### Scenario: 岗位日结
- **WHEN** 一条审计动作为岗位日结（`cockpit.post_daily_digest`），操作人是组织所有者
- **THEN** 该条目摘要为"岗位日结"，`source` 为 `system`
