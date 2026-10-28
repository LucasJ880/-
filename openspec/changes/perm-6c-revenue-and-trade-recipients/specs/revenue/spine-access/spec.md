## ADDED Requirements

### Requirement: 营收中心接口按外贸权限键
营收中心接口（`/api/revenue/**`）SHALL 按外贸权限键判定，SHALL NOT 因平台角色 `sales`、`boss`、`manager`、`admin` 放行：
- 读取（GET）SHALL 要求当前企业内持 `trade.read` 或 `trade.manage`；
- 写入（商机转阶段、记录互动、标记客户已回复、运行 FDE、手工建询盘）SHALL 要求 `trade.manage`；
- 发布营收策略（`PUT /api/revenue/policy`）SHALL 要求 `trade.settings.manage`；读取策略（`GET /api/revenue/policy`）SHALL 接受三键任一（只管设置的人需先看到当前策略）。

平台 super_admin SHALL 视为持有全部键。企业 SHALL 按 active 成员关系与当前企业解析，规则同外贸接口：显式 orgId 只做交叉校验，只有平台 super_admin 可显式指定任意企业。缺键 SHALL 返回 403。数据范围仍为全企业。

#### Scenario: 外贸业务员看营收驾驶舱
- **WHEN** 旧模式企业中平台角色 `trade` 的成员（兼容回退 `trade_rep`）请求 `GET /api/revenue/cockpit`
- **THEN** 返回 200

#### Scenario: 企业负责人发布策略
- **WHEN** 旧模式企业中平台角色 `admin`、企业角色 `org_owner` 的老板发布营收策略
- **THEN** 允许（系统模板 `org_owner` 含 `trade.settings.manage`）

#### Scenario: 外贸业务员不能发布策略
- **WHEN** 只持 `trade_rep` 的成员发布营收策略
- **THEN** 返回 403，策略不变

#### Scenario: 销售员不再经营收中心看全企业商机
- **WHEN** 平台角色 `sales`、只持 `sales_rep` 的成员请求 `GET /api/revenue/opportunities`
- **THEN** 返回 403

#### Scenario: 压扁后的老板
- **WHEN** 岗位模式企业中平台角色 `user`、绑定 `owner` 的成员请求营收中心读接口
- **THEN** 返回 200

#### Scenario: 平台 admin 不再隐含
- **WHEN** 平台角色 `admin`、企业角色 `org_member`、无外贸岗位的成员请求营收中心
- **THEN** 返回 403

### Requirement: 营收中心导航与接口一致
旧模式企业中，营收中心与"今日询盘"导航入口 SHALL NOT 因平台角色 `sales` 可见（与接口口径一致）。岗位模式企业的可见规则不变（外贸入口规则）。

#### Scenario: 旧模式销售看不到营收入口
- **WHEN** 旧模式企业中平台角色 `sales` 的成员加载导航（企业启用销售模块）
- **THEN** 不可见营收中心与今日询盘
