# marketing/growth-center-access Specification

## Purpose
增长中心（营销：品牌事实、活动、渠道账号、指标、实验、MMM、自动化、计划等）的写权限：只有持运营管理权的人能改，企业其他成员只读，平台角色不带来写权。

## Requirements

### Requirement: 增长中心写操作按 operations.manage
增长中心的全部写接口 SHALL 要求操作者在当前企业持有 `operations.manage`；不持有的人 SHALL 收到 403，响应文案说明当前账号只读。组织角色 `org_member` / `org_admin` 与平台角色 `admin` / `manager` SHALL NOT 因角色获得写权；平台 super_admin SHALL 通过平台管理员全权获得允许。

#### Scenario: 普通成员改活动
- **WHEN** 组织角色为 `org_member`、只持 `sales_rep` 岗位的人新建营销活动
- **THEN** 返回 403

#### Scenario: 运营主管改品牌事实
- **WHEN** 持 `ops_lead` 岗位的 Marty 保存增长中心品牌事实
- **THEN** 返回 200

#### Scenario: 平台 admin 无岗位
- **WHEN** 平台角色为 `admin`、在该企业无 `operations.manage` 的人保存增长中心品牌事实
- **THEN** 返回 403

### Requirement: 增长中心可编辑标记
增长中心品牌事实读取接口返回的 `permissions.canEdit` SHALL 与写接口判定一致：持 `operations.manage` 为 true，否则为 false。

#### Scenario: 运营人员看到只读
- **WHEN** 只持 `ops_staff` 岗位的 Maggie 读取增长中心品牌事实
- **THEN** 响应 `permissions.canEdit` 为 false

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
