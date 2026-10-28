# Spec Delta

## ADDED Requirements

### Requirement: 岗位模式下销售不能读增长中心
在岗位模式企业中，岗位派生平台角色为 `sales` 的人 SHALL NOT 访问营销工作区页面（`/marketing/**`、`/operations/growth/**`，重定向到 `/sales`），且增长中心只读接口（`/api/marketing/**` 的 GET）SHALL 返回 403。这等同于旧模式中间件对平台角色 `sales` 的拦截。旧模式企业 SHALL 继续由中间件按平台角色拦截。

#### Scenario: 压扁后的销售打开增长中心
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `sales_rep` 的成员打开 `/operations/growth`
- **THEN** 被重定向到 `/sales`

#### Scenario: 压扁后的销售读营销数据
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `sales_rep` 的成员请求 `/api/marketing/dashboard`
- **THEN** 返回 403

#### Scenario: 运营人员照常只读
- **WHEN** 岗位模式企业中绑定 `ops_staff` 的成员请求 `/api/marketing/dashboard`
- **THEN** 返回 200
