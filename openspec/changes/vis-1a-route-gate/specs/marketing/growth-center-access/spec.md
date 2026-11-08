# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: 岗位模式下销售不能读增长中心`
- TO: `### Requirement: 营销工作区页面与只读接口的门槛`

## MODIFIED Requirements

### Requirement: 营销工作区页面与只读接口的门槛
营销工作区页面（`/marketing/**`、`/operations/growth/**`）SHALL 由路由门判定（见 `navigation/route-gate`），口径与侧栏"品牌增长"入口相同：
- 岗位模式下，只对持 `operations.read` 或 `operations.manage` 的成员与管理层放行；
- 旧模式下，只对平台角色 super_admin / `boss` / `manager` / `operations` 放行，`sales` / `trade` / `user` 不放行。

不放行者 SHALL 被 302 到其落地页（销售为 `/sales/home`）。增长中心只读接口（`/api/marketing/**` 的 GET）SHALL 与改动前一致：岗位模式企业对岗位派生平台角色为 `sales` 的人返回 403；旧模式企业继续由中间件按平台角色 `sales` 拦截。

#### Scenario: 压扁后的销售打开增长中心
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `sales_rep` 的成员打开 `/operations/growth`
- **THEN** 返回 302，`Location` 为 `/sales/home`（`npx tsx src/lib/navigation/__tests__/route-gate.test.ts` 覆盖）

#### Scenario: 安装工打开营销员工页
- **WHEN** 岗位模式企业中只绑定 `installer` 的成员打开 `/marketing/employee`
- **THEN** 返回 302，`Location` 为 `/install`

#### Scenario: 会计打开增长中心
- **WHEN** 岗位模式企业中只绑定 `accounting` 的成员打开 `/operations/growth/campaigns`
- **THEN** 返回 302，`Location` 为 `/accounting`

#### Scenario: 运营与老板照常进入
- **WHEN** 岗位模式企业中绑定 `ops_staff` 或 `owner` 的成员打开 `/operations/growth`
- **THEN** 页面正常打开

#### Scenario: 旧模式外贸不再进营销工作区
- **WHEN** 旧模式企业中平台角色为 `trade` 的成员打开 `/marketing/employee`
- **THEN** 返回 302 到其落地页（改动前中间件只拦平台角色 `sales`，外贸可进）

#### Scenario: 压扁后的销售读营销数据
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `sales_rep` 的成员请求 `/api/marketing/dashboard`
- **THEN** 返回 403

#### Scenario: 运营人员照常只读
- **WHEN** 岗位模式企业中绑定 `ops_staff` 的成员请求 `/api/marketing/dashboard`
- **THEN** 返回 200
