# Spec Delta

## MODIFIED Requirements

### Requirement: 岗位模式判定
当前企业的行业包有岗位模板时（窗饰 `window_covering_services_v1`），导航、默认落地、管理层与底栏 SHALL 按岗位模式判定；否则 SHALL 按旧模式（本次改动前的平台角色规则）判定，结果与改动前一致（例外：平台用户管理入口，见"外贸与平台管理入口例外"；"微信集成"入口在微信入口开关关闭时不出现，见 `identity/wechat-entry`；营收中心与"今日询盘"只在企业启用 `trade` 模块时出现，见"外贸与平台管理入口例外"；平台角色 `sales` 的侧栏不含「AI 任务」「数字员工」，见"纯销售侧栏不含 AI 任务与数字员工"；手机底栏每个页签只在目标放行时出现，见 `navigation/entry-visibility`「入口判定与路由门同源」；手机底栏首格指向落地页，见 `navigation/entry-visibility`「底栏首格指向落地页」）。`/api/auth/active-org` 响应 SHALL 含 `positionMode` 布尔字段。

#### Scenario: Sunny 是岗位模式
- **WHEN** 当前企业的行业包为 `window_covering_services_v1`
- **THEN** `/api/auth/active-org` 返回 `positionMode: true`

#### Scenario: 无岗位模板企业沿用旧规则
- **WHEN** 当前企业无行业包，微信入口开关打开，平台角色为 `boss` 的成员加载导航
- **THEN** 可见入口与改动前完全相同

#### Scenario: 旧模式下微信入口开关关闭
- **WHEN** 当前企业无行业包，微信入口开关关闭，平台角色为 `boss` 的成员加载导航
- **THEN** 可见入口与开关打开时相比只少"微信集成"

#### Scenario: 旧模式未开外贸没有营收中心
- **WHEN** 当前企业无行业包、启用 `sales` 未启用 `trade`，平台角色为 `boss` 的成员加载导航
- **THEN** 不可见"收入驾驶舱"与"今日询盘"，其余可见入口与改动前相同（`npx tsx src/lib/navigation/__tests__/position-nav.test.ts` 覆盖）

## ADDED Requirements

### Requirement: 管理总览只对管理层
岗位模式下，侧栏「管理总览」（`/`）SHALL 只对管理层出现（见「岗位模式的管理层」：平台 super_admin 或持 `organization.dashboard.read` 的成员）。旧模式不变。`/` 本身仍为登录即可的路由，进入后的落地规则不变。

#### Scenario: 非管理层的侧栏
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/position-nav.test.ts`
- **THEN** 只持 `ops_lead`、`ops_staff`、`bids`、`accounting`、`installer`、出单岗位或无岗位成员的侧栏不含 `work-home`；`owner` 仍含；其余快照不变，测试通过

#### Scenario: 未绑岗位的平台管理员
- **WHEN** 岗位模式下平台 super_admin 未绑任何岗位
- **THEN** 侧栏仍含 `work-home`（同一测试覆盖）
