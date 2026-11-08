# Spec Delta

## MODIFIED Requirements

### Requirement: 岗位模式下销售不能读增长中心
营销工作区页面（`/marketing/**`、`/operations/growth/**`）SHALL 由路由门判定（见 `navigation/route-gate`），口径与侧栏"品牌增长"入口相同：岗位模式下只对持 `operations.read` 或 `operations.manage` 的成员与管理层放行，旧模式下按平台角色（销售不可见）；不放行者 SHALL 被 302 到其默认工作区（销售为 `/sales/home`）。增长中心只读接口（`/api/marketing/**` 的 GET）在岗位模式企业中 SHALL 对岗位派生平台角色为 `sales` 的人返回 403，旧模式企业 SHALL 继续由中间件按平台角色拦截，接口口径与改动前一致。

#### Scenario: 压扁后的销售打开增长中心
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `sales_rep` 的成员打开 `/operations/growth`
- **THEN** 返回 302，`Location` 为 `/sales/home`

#### Scenario: 安装工打开营销员工页
- **WHEN** 岗位模式企业中只绑定 `installer` 的成员打开 `/marketing/employee`
- **THEN** 返回 302，`Location` 为 `/install`

#### Scenario: 会计打开增长中心
- **WHEN** 岗位模式企业中只绑定 `accounting` 的成员打开 `/operations/growth/campaigns`
- **THEN** 返回 302，`Location` 为 `/accounting`

#### Scenario: 运营与老板照常进入
- **WHEN** 岗位模式企业中绑定 `ops_staff` 或 `owner` 的成员打开 `/operations/growth`
- **THEN** 页面正常打开

#### Scenario: 压扁后的销售读营销数据
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `sales_rep` 的成员请求 `/api/marketing/dashboard`
- **THEN** 返回 403

#### Scenario: 运营人员照常只读
- **WHEN** 岗位模式企业中绑定 `ops_staff` 的成员请求 `/api/marketing/dashboard`
- **THEN** 返回 200
