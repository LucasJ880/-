## MODIFIED Requirements

### Requirement: 窗饰企业岗位模板集
系统 SHALL 为 `industryPackId` 等于 `window_covering_services_v1` 的企业提供以下岗位模板：`owner`、`sales_rep`、`pricing_lead`、`ops_lead`、`ops_staff`、`accounting`、`bids`、`fulfillment_vinyl`、`fulfillment_drapery`、`fulfillment_shades`。每个模板 SHALL 带中文名称与说明。

#### Scenario: 窗饰企业落地模板
- **WHEN** 对 `industryPackId = window_covering_services_v1` 的企业执行岗位模板落地
- **THEN** 该企业的岗位表中存在上述 10 个 key，且重复执行不产生重复行

#### Scenario: 非窗饰企业不落地
- **WHEN** 对 `industryPackId` 不是 `window_covering_services_v1` 的企业执行岗位模板落地
- **THEN** 该企业不出现 `pricing_lead`、`fulfillment_*` 等窗饰岗位；无行业包岗位的企业只有系统模板

## ADDED Requirements

### Requirement: 家纺外贸企业岗位模板集
系统 SHALL 为 `industryPackId` 等于 `home_textile_trade_v1` 的企业（梦馨）提供行业包岗位 `owner`（老板），并沿用系统岗位 `trade_rep`（外贸业务员）。该企业 SHALL 因此按岗位模式判定（导航、默认落地、管理层、兼容回退关闭、岗位派生平台角色、压扁），判定规则与窗饰企业相同。

家纺外贸 `owner` SHALL 包含：
- 管理层信号 `organization.dashboard.read`；
- 外贸三键 `trade.read` / `trade.manage` / `trade.settings.manage`；
- 系统模板 `org_owner` 的读权限与招投标交接键。

它 SHALL NOT 包含成员 / 岗位管理键（成员与岗位仍只由平台 super_admin 管理）。

#### Scenario: 家纺外贸企业落地模板
- **WHEN** 对 `industryPackId = home_textile_trade_v1` 的企业执行岗位模板落地
- **THEN** 该企业岗位表中有 `owner` 与系统模板（含 `trade_rep`），没有窗饰岗位，重复执行不产生重复行

#### Scenario: 梦馨进入岗位模式
- **WHEN** 当前企业的行业包为 `home_textile_trade_v1`
- **THEN** `/api/auth/active-org` 返回 `positionMode: true`

#### Scenario: 外贸业务员在岗位模式照常工作
- **WHEN** 梦馨中平台角色 `trade` 或已压扁为 `user`、绑定 `trade_rep` 的成员访问外贸接口、营收中心并进入首页
- **THEN** 外贸与营收读写 200；默认落地 `/tasks`；侧栏使用外贸两段式布局；仍是默认询盘负责人

#### Scenario: 没有绑定即无权限
- **WHEN** 梦馨中某成员没有任何 active 岗位绑定（含系统模板绑定）
- **THEN** 外贸接口返回 403（不再按企业角色或平台 `trade` 兼容回退）

#### Scenario: 老板岗位是管理层
- **WHEN** 梦馨中绑定 `owner`、平台角色不是 super_admin 的成员
- **THEN** 是管理层（首页停在 `/`），收外贸管理层提醒，可发布营收策略
