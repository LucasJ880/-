# Spec Delta

## ADDED Requirements

### Requirement: 工具列表角色过滤取派生角色
智能体运行按平台角色过滤可用工具列表、并把角色放进工具执行上下文时，在岗位模式企业 SHALL 使用岗位派生平台角色（见 `agents/position-derived-role`），在旧模式企业 SHALL 使用原平台角色。工具策略表的 `allowRoles` 声明 SHALL NOT 因此改变。

#### Scenario: 岗位模式
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `sales_rep` 的成员启动智能体运行
- **THEN** 工具列表按 `sales` 过滤，工具执行上下文的角色为 `sales`

#### Scenario: 旧模式
- **WHEN** 无岗位模板企业中平台角色为 `sales` 的成员启动智能体运行
- **THEN** 工具列表按 `sales` 过滤，与本次改动前相同
