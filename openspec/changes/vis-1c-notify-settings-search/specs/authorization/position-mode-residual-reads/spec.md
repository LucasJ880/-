# Spec Delta

## MODIFIED Requirements

### Requirement: 前端按派生角色显示业务模块
`/api/auth/me` SHALL 返回 `effectiveRole`（当前企业的岗位派生平台角色；旧模式等于平台角色），`role` 字段 SHALL 保持平台角色不变。管理总览的销售 / 项目 / 外贸模块显示 SHALL 按 `effectiveRole` 判定。助手工作台的营销数字员工入口按其页面是否放行判定（见 `navigation/entry-visibility`「营销数字员工卡片只在其页面放行时出现」）。

#### Scenario: 压扁后的老板看管理总览
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `owner` 的成员打开管理总览
- **THEN** 显示销售模块与每日简报，与压扁前平台角色 `boss` 时相同

#### Scenario: me 接口保留平台角色
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `sales_rep` 的成员请求 `/api/auth/me`
- **THEN** `role` 为 `user`，`effectiveRole` 为 `sales`
