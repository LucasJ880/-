## Purpose

数字员工发起需要审批的动作时，审批记录归谁、谁来批、审计怎么标记，保证数字员工永远不是审批人、审计能区分人与数字员工。

## ADDED Requirements

### Requirement: 数字员工审批的归属与审批人
数字员工发起的审批 SHALL 创建为 PendingAction，归属（创建人）与指定审批人 SHALL 都是该数字员工的 sponsor，执行者类型 SHALL 标记为 `agent`，载荷 SHALL 记录 Agent id、岗位、sponsor。审批人 SHALL NOT 是任何 Agent id。批准前 SHALL NOT 发生任何出站。

#### Scenario: 审批人是 sponsor
- **WHEN** sponsor 为 Alex 的销售数字员工发起一条外发邮件审批
- **THEN** 生成的 PendingAction 创建人与审批人都是 Alex，状态为待确认

#### Scenario: 审批人不是数字员工
- **WHEN** 数字员工发起任意审批
- **THEN** PendingAction 的审批人字段不等于该 Agent id

#### Scenario: 解析失败不建审批
- **WHEN** 发起审批的 Agent 已停用
- **THEN** 不创建 PendingAction，返回失败

### Requirement: 数字员工审计标记
数字员工相关的审计记录 SHALL 在 AI 执行关联信息中记录 `actorKind = digital_employee`、Agent id、Agent 名称、岗位 key、sponsor user id。审计日志列表接口对这类记录 SHALL 返回展示文本"数字员工 <Agent 名称> 代 岗位 <岗位 key>"；人类操作的记录 SHALL NOT 返回该文本。

#### Scenario: 审计展示
- **WHEN** 审计日志列表包含一条 `actorKind = digital_employee`、Agent 名称"销售助手"、岗位 `sales_rep` 的记录
- **THEN** 该条返回的展示文本为"数字员工 销售助手 代 岗位 sales_rep"

#### Scenario: 人类记录无标记
- **WHEN** 审计日志列表包含一条普通用户操作记录
- **THEN** 该条不返回数字员工展示文本
