# Spec Delta

## ADDED Requirements

### Requirement: 岗位卡片的可见条件
一个岗位卡片对某用户可见，当且仅当：其跳转页面（`nav`）对该用户经路由门放行（平台 super_admin 视为放行，见 `navigation/route-gate`）；「客服」岗位另要求微信入口开关打开。可见条件 SHALL 只来自岗位注册表里的跳转页面与字面量标记，注册表 SHALL NOT 为此新增运行时导入。

#### Scenario: 可见条件表
- **WHEN** 运行 `npx tsx src/lib/cockpit/__tests__/posts.test.ts`
- **THEN** 只有 `service` 带「需微信入口开关」标记；其余六个岗位的可见性只由跳转页面决定；注册表模块仍无运行时导入，测试通过

#### Scenario: 询盘销售随外贸模块
- **WHEN** 以 Sunny（未启用 `trade`）持 `owner` 岗位的输入判定 `inbound_sales`
- **THEN** 不可见（其跳转页 `/revenue` 不放行；`posts-read-model.test.ts` 覆盖）

#### Scenario: 运维与知识只对平台管理员
- **WHEN** 以 Sunny 持 `owner` 岗位、平台角色为 `user` 的输入判定 `ops_knowledge`
- **THEN** 不可见；平台 super_admin 可见（同一测试覆盖）
