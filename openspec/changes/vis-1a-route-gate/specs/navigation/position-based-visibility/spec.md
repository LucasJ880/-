# Spec Delta

## MODIFIED Requirements

### Requirement: 岗位模式判定
当前企业的行业包有岗位模板时（窗饰 `window_covering_services_v1`），导航、默认落地、管理层与底栏 SHALL 按岗位模式判定；否则 SHALL 按旧模式（本次改动前的平台角色规则）判定，结果与改动前一致（例外：平台用户管理入口，见"外贸与平台管理入口例外"；"微信集成"入口在微信入口开关关闭时不出现，见 `identity/wechat-entry`；营收中心与"今日询盘"只在企业启用 `trade` 模块时出现，见"外贸与平台管理入口例外"）。`/api/auth/active-org` 响应 SHALL 含 `positionMode` 布尔字段。

#### Scenario: Sunny 是岗位模式
- **WHEN** 当前企业的行业包为 `window_covering_services_v1`
- **THEN** `/api/auth/active-org` 返回 `positionMode: true`

#### Scenario: 无岗位模板企业沿用旧规则
- **WHEN** 当前企业无行业包，微信入口开关打开，平台角色为 `boss` 的成员加载导航
- **THEN** 可见入口与改动前完全相同

#### Scenario: 旧模式下微信入口开关关闭
- **WHEN** 当前企业无行业包，微信入口开关关闭，平台角色为 `boss` 的成员加载导航
- **THEN** 可见入口与开关打开时相比只少"微信集成"

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
- **THEN** 不可见"收入驾驶舱"与"今日询盘"

## ADDED Requirements

### Requirement: 手机底栏的招投标入口与招投标中心同口径
手机底栏的"招投标"入口 SHALL 与侧栏"招投标中心"按同一招投标工作区规则判定：岗位模式下只对持 `project.create` 或 `project.update` 的成员与管理层出现，只持 `project.read` 或只是某项目成员 SHALL NOT 使其出现；旧模式不变。

#### Scenario: 会计与出单的底栏没有招投标
- **WHEN** 岗位模式下只持 `accounting` 岗位、或只持 `fulfillment_vinyl` 岗位的成员打开手机端
- **THEN** 底栏没有"招投标"入口（`npx tsx src/lib/rbac/__tests__/workspace-policy.test.ts` 覆盖岗位模式的招投标工作区判定）

#### Scenario: 招投标岗位的底栏有招投标
- **WHEN** 岗位模式下只持 `ops_lead` + `bids` 岗位的成员打开手机端
- **THEN** 底栏有"招投标"入口
