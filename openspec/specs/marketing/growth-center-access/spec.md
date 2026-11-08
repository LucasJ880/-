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

### Requirement: 营销工作区页面与只读接口的门槛
营销工作区页面（`/marketing/**`、`/operations/growth/**`）SHALL 由路由门判定（见 `navigation/route-gate`），口径与侧栏"品牌增长"入口相同：
- 岗位模式（Sunny、梦馨）下，只对持 `operations.read` 或 `operations.manage` 的成员放行（两家的老板模板都含 `operations.read`）；
- 无行业包企业（旧模式）下，只对平台角色 super_admin / `boss` / `manager` / `operations` 放行，`sales` / `trade` / `user` 不放行。

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

#### Scenario: 外贸不再进营销工作区
- **WHEN** 梦馨只持 `trade_rep` 岗位的成员、或无行业包企业平台角色为 `trade` 的成员打开 `/marketing/employee`
- **THEN** 返回 302 到其落地页。改动前中间件与页面门只拦销售，外贸可进

#### Scenario: 压扁后的销售读营销数据
- **WHEN** 岗位模式企业中平台角色为 `user`、绑定 `sales_rep` 的成员请求 `/api/marketing/dashboard`
- **THEN** 返回 403

#### Scenario: 运营人员照常只读
- **WHEN** 岗位模式企业中绑定 `ops_staff` 的成员请求 `/api/marketing/dashboard`
- **THEN** 返回 200
