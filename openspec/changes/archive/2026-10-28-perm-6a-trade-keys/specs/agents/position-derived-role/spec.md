# Spec Delta

## MODIFIED Requirements

### Requirement: 岗位派生平台角色规则
系统 SHALL 提供岗位派生平台角色：
- 企业不是岗位模式时，SHALL 等于原平台角色；
- 原平台角色为 `super_admin`、`admin` 或 `trade` 时，SHALL 等于原平台角色；
- 否则按该人在该企业的有效权限键依次取第一个满足的：
  - 持 `organization.dashboard.read` → `boss`；
  - 持 `sales.quote.create` 或 `sales.quote.pricing_close` → `sales`；
  - 持 `operations.read` 或 `operations.manage` → `operations`；
  - 持 `trade.read` → `trade`；
  - 其余 → `user`。

派生角色 SHALL NOT 写回 `User.role`；有效权限键解析失败时 SHALL 按无权限键处理（派生为 `user`）。

#### Scenario: 压扁后的销售
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `sales_rep` 的成员
- **THEN** 派生角色为 `sales`

#### Scenario: 平台角色不决定派生
- **WHEN** 岗位模式企业中平台角色为 `boss`、只绑定 `ops_staff` 的成员
- **THEN** 派生角色为 `operations`

#### Scenario: 老板岗位
- **WHEN** 岗位模式企业中绑定 `owner` 与 `pricing_lead` 的成员
- **THEN** 派生角色为 `boss`

#### Scenario: 外贸与平台管理员保留
- **WHEN** 岗位模式企业中平台角色为 `trade` 或 `admin` 的成员
- **THEN** 派生角色等于原平台角色

#### Scenario: 旧模式企业不变
- **WHEN** 无岗位模板企业中平台角色为 `sales` 的成员
- **THEN** 派生角色为 `sales`，与岗位绑定无关

#### Scenario: 岗位模式外贸业务员
- **WHEN** 岗位模式企业中平台角色为 `user`、只绑定 `trade_rep` 的成员
- **THEN** 派生角色为 `trade`
