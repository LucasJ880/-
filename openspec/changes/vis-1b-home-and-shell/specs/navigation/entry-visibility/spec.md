# Spec Delta

## Purpose

页面上的入口（手机底栏页签、`/operations` 索引卡片、`/help` 功能地图、站内跳转链接与按钮）只在路由门对当前用户放行时出现，看得见的入口点进去都不会被弹回。

## ADDED Requirements

### Requirement: 入口判定与路由门同源
任何页面在决定是否展示一个指向已登录区的入口时，SHALL 用与路由门相同的规则与输入判断该地址对当前用户是否放行；平台 super_admin SHALL 一律视为放行。判定输入尚未取得时，入口 SHALL NOT 出现，SHALL NOT 先显示后消失。

#### Scenario: 客户端判定与路由门一致
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/entry-visibility.test.ts`
- **THEN** 对路由门测试里的每种身份与每条登记路径，客户端判定结果与路由门结果相同；平台 super_admin 全部放行，测试通过

### Requirement: /operations 索引只列放行的卡片
`/operations` 索引页 SHALL 只列对当前用户放行的卡片；外部 Postiz 链接仍只在配置了地址时出现。没有一张卡片放行时，页面 SHALL 显示"暂无可用的运营入口"。

#### Scenario: 运营看得到内容运营卡片
- **WHEN** 只持 `ops_staff` 岗位的成员打开 `/operations`
- **THEN** 页面列出增长中心、营销员工、营销分析与六个内容运营卡片，不列「投标业务档案」（`entry-visibility.test.ts` 覆盖）

#### Scenario: 招投标看得到投标档案
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
- `/tasks` 的「进入协同空间」（指向 `/assistant`）。

工艺单详情 / 编辑页回列表的链接与删除后的跳转，在 `/blinds-orders` 不放行时 SHALL 改为指向该工艺单的客户详情（无客户时为 `/tasks`）。

#### Scenario: 销售看工艺单
- **WHEN** 只持 `sales_rep` 岗位的成员打开 `/blinds-orders/<id>`
- **THEN** 页头返回链接指向该单的客户详情而不是 `/blinds-orders`；收口页签里没有维修单链接（`entry-visibility.test.ts` 覆盖目标判定，源码断言覆盖接线）

#### Scenario: 运营看工作台
- **WHEN** 只持 `ops_staff` 岗位的成员打开 `/assistant`
- **THEN** 数字员工工作台不显示「打开销售工作区」「创建报价」与指向销售客户的提醒链接
