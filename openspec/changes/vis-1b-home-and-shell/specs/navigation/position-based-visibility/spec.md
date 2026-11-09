# Spec Delta

## MODIFIED Requirements

### Requirement: 岗位模式判定
当前企业的行业包有岗位模板时（窗饰 `window_covering_services_v1`），导航、默认落地、管理层与底栏 SHALL 按岗位模式判定；否则 SHALL 按旧模式（本次改动前的平台角色规则）判定，结果与改动前一致（例外：平台用户管理入口，见"外贸与平台管理入口例外"；"微信集成"入口在微信入口开关关闭时不出现，见 `identity/wechat-entry`；营收中心与"今日询盘"只在企业启用 `trade` 模块时出现，见"外贸与平台管理入口例外"；平台角色 `sales` 的侧栏不含「AI 任务」「数字员工」，见"纯销售侧栏不含 AI 任务与数字员工"；手机底栏每个页签只在目标放行时出现，见 `navigation/entry-visibility`「入口判定与路由门同源」）。`/api/auth/active-org` 响应 SHALL 含 `positionMode` 布尔字段。

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

### Requirement: 岗位模式的底栏
岗位模式下，手机底栏 SHALL 在默认落地为 `/sales/home` 时使用销售布局，否则使用通用布局；平台角色 `sales` SHALL NOT 单独决定布局。两种布局里的每个页签 SHALL 只在其目标对当前用户放行时出现（见 `navigation/entry-visibility`「入口判定与路由门同源」）：通用布局的「AI」（`/capabilities`）只在 AI 工作中心放行时出现，「助手」（`/assistant`）只在数字员工放行时出现。

#### Scenario: 销售岗位用销售底栏
- **WHEN** 岗位模式下平台角色为 `user`、只持 `sales_rep` 岗位的成员打开手机端
- **THEN** 底栏为销售布局

#### Scenario: 出单的底栏没有 AI 页签
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/entry-visibility.test.ts`，以只持 `fulfillment_vinyl` 岗位的输入计算通用布局页签
- **THEN** 页签里没有「AI」（`/capabilities` 不放行），有「助手」，测试通过

### Requirement: 手机底栏的招投标入口与招投标中心同口径
手机底栏的"招投标"入口 SHALL 与侧栏"招投标中心"按同一规则判定（同一导航入口、同一判定输入，含成员身份、模块与岗位键），侧栏不可见时底栏 SHALL NOT 出现。岗位模式下只对持 `project.create` 或 `project.update` 的成员与管理层出现，只持 `project.read` 或只是某项目成员 SHALL NOT 使其出现；旧模式按旧模式侧栏。

#### Scenario: 会计与出单的底栏没有招投标
- **WHEN** 岗位模式下只持 `accounting` 岗位、或只持 `fulfillment_vinyl` 岗位的成员打开手机端
- **THEN** 底栏没有"招投标"入口（`npx tsx src/lib/navigation/__tests__/entry-visibility.test.ts` 覆盖）

#### Scenario: 招投标岗位的底栏有招投标
- **WHEN** 岗位模式下只持 `ops_lead` + `bids` 岗位的成员打开手机端
- **THEN** 底栏有"招投标"入口

#### Scenario: 底栏与侧栏一致
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/entry-visibility.test.ts`
- **THEN** 对每种测试身份，底栏是否出现"招投标"与侧栏"招投标中心"是否可见的结果相同，测试通过

## ADDED Requirements

### Requirement: 纯销售侧栏不含 AI 任务与数字员工
岗位模式的纯销售（持销售工作键、不是管理层、不持运营 / 招投标 / 会计 / 安装 / 出单键）与旧模式平台角色 `sales` 的侧栏 SHALL NOT 含「AI 任务」（`/workforce`）与「数字员工」（`/assistant`）。按路由门与侧栏同源的规则，这类用户请求 `/workforce/**`、`/assistant`、`/inbox` SHALL 被 302 到 `/sales/home`。其他岗位的「数字员工」不变。

#### Scenario: 销售侧栏快照
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/position-nav.test.ts`
- **THEN** `sales_rep` 与 `pricing_lead` 的侧栏为日历、销售首页、客户与商机、报价、报价记录、我的业绩、邮箱绑定，不含 `work-ai-jobs` 与 `work-assistant`，测试通过

#### Scenario: 销售敲 AI 任务
- **WHEN** 只持 `sales_rep` 岗位的成员请求 `/workforce` 或 `/assistant`
- **THEN** 返回 302，`Location` 为 `/sales/home`（`npx tsx src/lib/navigation/__tests__/route-gate.test.ts` 覆盖）

### Requirement: AI 任务只对有可读工作域的人出现
岗位模式下，侧栏「AI 任务」（`/workforce`）SHALL 只对持以下任一岗位键的成员出现：`organization.dashboard.read`、`project.create`、`project.update`、`operations.read`、`operations.manage`、`sales.quote.create`、`sales.quote.pricing_close`、`trade.read`；纯销售仍按上一条不含。这组键 SHALL 覆盖 `agents/workforce-job-scope`「工作域按导航入口判定可读」里每个入口在岗位模式下认的键。按路由门与侧栏同源的规则，其他成员请求 `/workforce/**` SHALL 被 302 到各自的落地页。旧模式不变（平台角色 `sales` 见上一条）。

入口按岗位键判定，可读域另看模块与平台角色，二者不一致的身份 SHALL 在测试里逐条列为已知例外。

#### Scenario: 一线岗位的侧栏没有 AI 任务
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/position-nav.test.ts`
- **THEN** 只持 `accounting`、只持 `installer`、只持 `fulfillment_vinyl`、无岗位成员的侧栏不含 `work-ai-jobs`；`bids`、`ops_staff`、`ops_lead`、`owner`、梦馨 `trade_rep` 的侧栏仍含；其余快照不变，测试通过

#### Scenario: 一线岗位敲 AI 任务
- **WHEN** 只持 `accounting`、只持 `installer`、只持 `fulfillment_vinyl` 的成员分别请求 `/workforce`
- **THEN** 依次 302 到 `/accounting`、`/install`、`/tasks`（`route-gate.test.ts` 覆盖）

#### Scenario: 已知例外
- **WHEN** 运行 `npx tsx src/lib/workforce-runtime/__tests__/readable-domains.test.ts`
- **THEN** 测试断言以下身份为已知例外，测试通过：
  - 企业未启用对应模块却持该键的成员（Sunny 里持系统岗位 `trade_rep`、梦馨里持 `project_manager`）：入口出现，列表为空；
  - 梦馨里平台角色为 `trade`、未绑任何岗位的成员：可读销售域，但入口不出现，绑上 `trade_rep` 后出现。

#### Scenario: 入口与可读域不漂移
- **WHEN** 运行 `npx tsx src/lib/workforce-runtime/__tests__/readable-domains.test.ts`
- **THEN** 对每个行业包岗位与无岗位成员（纯销售与旧模式 `sales` 除外），「AI 任务」是否可见与可读工作域是否非空的结果相同；已知例外按上一场景单列；测试通过
