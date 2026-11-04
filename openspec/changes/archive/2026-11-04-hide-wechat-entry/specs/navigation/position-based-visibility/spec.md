# Spec Delta

## MODIFIED Requirements

### Requirement: 岗位模式判定
当前企业的行业包有岗位模板时（窗饰 `window_covering_services_v1`），导航、默认落地、管理层与底栏 SHALL 按岗位模式判定；否则 SHALL 按旧模式（本次改动前的平台角色规则）判定，结果与改动前一致（例外：平台用户管理入口，见"外贸与平台管理入口例外"；"微信集成"入口在微信入口开关关闭时不出现，见 `identity/wechat-entry`）。`/api/auth/active-org` 响应 SHALL 含 `positionMode` 布尔字段。

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
岗位模式下，除外贸入口与平台管理入口外，每个导航入口 SHALL 只按其声明的权限键（持任一即可见）与工作区判定；平台角色与"按平台角色整组 / 单条隐藏"的规则 SHALL NOT 参与。唯一的前置条件是平台开关：微信入口开关关闭时，"微信集成"入口 SHALL NOT 出现（见 `identity/wechat-entry`）。销售区入口 SHALL 要求 `sales.quote.create` 或 `sales.quote.pricing_close` 或管理层；企业经营、AI 能力与经营驾驶舱 SHALL 要求管理层；招投标与项目情报入口 SHALL 要求 `project.read`；品牌增长入口 SHALL 要求 `operations.read` 或 `operations.manage`。

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
