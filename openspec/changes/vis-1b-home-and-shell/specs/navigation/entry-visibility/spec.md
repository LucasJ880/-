# Spec Delta

## Purpose

页面上的入口（手机底栏页签、`/operations` 索引卡片、`/help` 功能地图、站内跳转链接与按钮）只在路由门对当前用户放行时出现，看得见的入口点进去都不会被弹回。

## ADDED Requirements

### Requirement: 入口判定与路由门同源
任何页面在决定是否展示一个指向已登录区的入口时，SHALL 用与路由门相同的规则与输入判断该地址对当前用户是否放行；平台 super_admin SHALL 一律视为放行。客户端 SHALL 用同一个纯函数把 `/api/auth/active-org` 的响应与当前用户拼成判定输入，结果 SHALL 与路由门服务端取到的输入相同。判定输入尚未取得时，入口 SHALL NOT 出现，SHALL NOT 先显示后消失。

#### Scenario: 客户端判定输入与服务端一致
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/entry-visibility.test.ts`
- **THEN** 对每份测试企业输入，客户端由 active-org 响应拼出的判定输入与路由门取输入函数的产出逐字段相同，测试通过

#### Scenario: 客户端判定与路由门一致
- **WHEN** 运行同一测试
- **THEN** 对路由门测试里的每种身份与每条登记路径，客户端判定结果与路由门结果相同；平台 super_admin 全部放行，测试通过

### Requirement: /operations 索引只列放行的卡片
`/operations` 索引页 SHALL 只列对当前用户放行的卡片，平台 super_admin SHALL 看到全部卡片；外部 Postiz 链接仍只在配置了地址时出现。没有一张卡片放行时，页面 SHALL 显示"暂无可用的运营入口"。

#### Scenario: 运营看得到内容运营卡片
- **WHEN** 只持 `ops_staff` 岗位的成员打开 `/operations`
- **THEN** 页面列出增长中心、营销数字员工、市场情报、矩阵账号、视频资产、发布审核队列、数据看板、品牌记忆、内容日历 9 张卡片，不列「投标业务档案」（`entry-visibility.test.ts` 覆盖）

#### Scenario: 招投标岗位进不了索引页
- **WHEN** 只持 `bids` 岗位的成员请求 `/operations`
- **THEN** 路由门照旧拒绝（302 到 `/bids`）；`/operations/tender-profile` 仍可由招投标工作台进入

### Requirement: /help 功能地图从可见导航生成
`/help` 的功能地图 SHALL 由当前用户侧栏可见的导航入口生成，按侧栏分组与顺序列出，每项显示入口名称与一句说明。地图 SHALL NOT 列出当前用户侧栏不可见的入口。导航注册表与系统底栏的每一项 SHALL 有非空的一句说明。页面 SHALL NOT 再引用 `docs/PROJECT_AUDIT.md`。

#### Scenario: 销售只看到自己的入口
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/entry-visibility.test.ts`，以只持 `sales_rep` 岗位的输入生成功能地图
- **THEN** 地图里的入口与该身份的侧栏可见入口完全相同，不含招投标、营销、外贸入口，测试通过

#### Scenario: 每项都有说明
- **WHEN** 运行同一测试
- **THEN** 导航注册表与系统底栏共 72 项，每项说明非空且不超过 40 个字，测试通过

### Requirement: 站内链接与按钮只在目标放行时出现
以下站内入口 SHALL 只在其目标对当前用户放行时出现：
- 工艺单详情收口页签里的维修单链接（指向 `/install/repairs/<id>`）；
- 数字员工工作台的客户提醒、「打开销售工作区」「创建报价」（指向 `/sales/**`）；
- `/tasks` 的「进入协同空间」（指向 `/assistant`）；
- 投标 AI 分析卡片的「查看执行详情」（指向 `/workforce/<作业 id>`，作业为投标域，另要求「招投标中心」放行）。

工艺单详情 / 编辑页回列表的链接与删除后的跳转，在 `/blinds-orders` 不放行时 SHALL 依次退到：
1. 该工艺单的客户详情（有客户且客户详情对当前用户放行时）；
2. 当前用户的落地页（与路由门的重定向目标相同，见 `navigation/route-gate`「不放行时 302 到落地页」）。

#### Scenario: 销售看工艺单
- **WHEN** 只持 `sales_rep` 岗位的成员打开 `/blinds-orders/<id>`，该单有客户
- **THEN** 页头返回链接指向该单的客户详情而不是 `/blinds-orders`；收口页签里没有维修单链接（`entry-visibility.test.ts` 覆盖目标判定，源码断言覆盖接线）

#### Scenario: 会计看工艺单
- **WHEN** 只持 `accounting` 岗位的成员打开 `/blinds-orders/<id>`（`/blinds-orders` 与客户详情都不放行）
- **THEN** 页头返回链接指向 `/accounting`（同一测试覆盖）

#### Scenario: 运营看投标分析卡片
- **WHEN** 只持 `ops_staff` 岗位的成员在项目详情里看到投标 AI 分析卡片
- **THEN** 卡片不显示「查看执行详情」（投标域作业对其不可读；同一测试覆盖目标判定，源码断言覆盖接线）

#### Scenario: 运营看工作台
- **WHEN** 只持 `ops_staff` 岗位的成员打开 `/assistant`
- **THEN** 数字员工工作台不显示「打开销售工作区」「创建报价」与指向销售客户的提醒链接
