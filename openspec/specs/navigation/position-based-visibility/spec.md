# navigation/position-based-visibility Specification

## Purpose
导航、默认落地与底栏的可见性在有岗位模板的企业里完全由岗位权限键决定；没有岗位模板的企业保持按平台角色的旧规则。外贸入口暂按平台角色例外处理。

## Requirements

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

### Requirement: 岗位模式的管理层
岗位模式下，管理层 SHALL 为平台 super_admin 或在当前企业持 `organization.dashboard.read` 的成员；平台角色 `boss` / `manager` / `admin` 与企业成员角色 `org_owner` / `org_admin` 本身 SHALL NOT 使人成为管理层。

#### Scenario: 老板岗位是管理层
- **WHEN** 岗位模式下持 `owner` 岗位、平台角色为 `user` 的成员进入首页
- **THEN** 停留在 `/`（管理总览）

#### Scenario: 平台 boss 无老板岗位不是管理层
- **WHEN** 岗位模式下平台角色为 `boss`、只持 `sales_rep` 岗位的成员进入首页
- **THEN** 被导向 `/sales/home`

### Requirement: 岗位模式的默认落地
岗位模式下，默认落地 SHALL 按以下顺序取第一个满足的：管理层 → `/`；持 `sales.quote.create` 或 `sales.quote.pricing_close` → `/sales/home`；持 `operations.read` 或 `operations.manage` → `/ops`；持 `project.create` 或 `project.update` → `/bids`；持 `accounting.read` → `/accounting`；持 `install.task.update`（安装工的工作键；出单岗只持 `install.task.read`）→ `/install`；其余 → `/tasks`。平台角色 SHALL NOT 参与判定。

#### Scenario: 各岗位落地
- **WHEN** 岗位模式下分别只持 `sales_rep`、`pricing_lead`、`ops_lead`、`ops_staff`、`bids`、`accounting`、`installer`、`fulfillment_vinyl` 岗位的成员进入首页
- **THEN** 依次被导向 `/sales/home`、`/sales/home`、`/ops`、`/ops`、`/bids`、`/accounting`、`/install`、`/tasks`

#### Scenario: 平台角色 operations 不影响落地
- **WHEN** 岗位模式下平台角色为 `operations`、只持 `sales_rep` 岗位的成员进入首页
- **THEN** 被导向 `/sales/home`

### Requirement: 岗位模式的导航入口
岗位模式下，除外贸入口与平台管理入口外，每个导航入口 SHALL 只按其声明的权限键（持任一即可见）与工作区判定；平台角色与"按平台角色整组 / 单条隐藏"的规则 SHALL NOT 参与。唯一的前置条件是平台开关：微信入口开关关闭时，"微信集成"入口 SHALL NOT 出现（见 `identity/wechat-entry`）。销售区入口 SHALL 要求 `sales.quote.create` 或 `sales.quote.pricing_close` 或管理层；企业经营、AI 能力与经营驾驶舱 SHALL 要求管理层；招投标中心、项目列表、项目情报与供应商库入口 SHALL 要求 `project.create` 或 `project.update` 或管理层，只持 `project.read` 或只是某项目成员 SHALL NOT 使这些入口可见；品牌增长入口 SHALL 要求 `operations.read` 或 `operations.manage`。

#### Scenario: 销售看不到运营与经营入口
- **WHEN** 岗位模式下只持 `sales_rep` 岗位的成员加载导航
- **THEN** 可见销售中心、报价、日程，不可见品牌增长、企业经营、AI 能力、招投标

#### Scenario: 运营看不到销售区
- **WHEN** 岗位模式下只持 `ops_staff` 岗位的成员加载导航
- **THEN** 可见运营中心与品牌增长，不可见销售中心与报价

#### Scenario: 多岗取并集
- **WHEN** 岗位模式下同时持 `owner`、`pricing_lead`、`accounting` 岗位的成员加载导航
- **THEN** 同时可见企业经营、销售报价与会计视图

#### Scenario: 岗位模式下微信入口开关关闭
- **WHEN** 微信入口开关关闭，岗位模式下持 `owner` 岗位的成员加载导航
- **THEN** 没有"微信集成"，其余可见入口与开关打开时相同

#### Scenario: 会计与出单看不到招投标与项目情报
- **WHEN** 岗位模式下只持 `accounting` 岗位、或只持 `fulfillment_vinyl` / `fulfillment_drapery` / `fulfillment_shades` 之一的成员加载导航（即使该成员是某项目的成员）
- **THEN** 不可见招投标中心、项目列表、智能调查室与情报子项、供应商库；会计仍可见会计视图

#### Scenario: 招投标与老板看得到招投标与项目情报
- **WHEN** 岗位模式下只持 `bids` 岗位、或只持 `owner` 岗位的成员加载导航
- **THEN** 可见招投标中心、项目列表、智能调查室与情报子项、供应商库

#### Scenario: 侧栏快照
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/position-nav.test.ts`
- **THEN** `accounting` 侧栏快照不含 `ws-bids` 与项目 / 情报 / 供应商组，三个出单岗位同样不含，其余岗位快照不变，测试通过

### Requirement: 外贸与平台管理入口例外
岗位模式下，外贸入口（`/trade/**`、营收中心、产品内容）SHALL 对平台角色 `trade` 或管理层可见。营收中心（`/revenue`、`/revenue/today`）SHALL 只在企业启用 `trade` 模块时出现，SHALL NOT 因企业启用 `sales` 模块而出现（两种模式相同）。两种模式下，平台用户管理入口 SHALL 只对平台 super_admin 可见（与 PERM-4b 用户管理接口口径一致）。

#### Scenario: 外贸角色看外贸
- **WHEN** 岗位模式下平台角色为 `trade`、无岗位的成员加载导航（企业启用外贸模块）
- **THEN** 可见外贸入口

#### Scenario: 平台 admin 看不到用户管理
- **WHEN** 平台角色为 `admin` 或 `boss`（非 super_admin）的成员在任一模式下加载导航
- **THEN** 不可见平台用户管理入口

#### Scenario: 未开外贸的企业没有营收中心
- **WHEN** 企业启用 `sales` 而未启用 `trade`，持 `owner` 岗位的成员加载导航
- **THEN** 不可见"收入驾驶舱"与"今日询盘"（`npx tsx src/lib/navigation/__tests__/position-nav.test.ts` 覆盖）

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
