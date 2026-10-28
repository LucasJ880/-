## Purpose

导航、默认落地与底栏的可见性在有岗位模板的企业里完全由岗位权限键决定；没有岗位模板的企业保持按平台角色的旧规则。外贸入口暂按平台角色例外处理。

## ADDED Requirements

### Requirement: 岗位模式判定
当前企业的行业包有岗位模板时（窗饰 `window_covering_services_v1`），导航、默认落地、管理层与底栏 SHALL 按岗位模式判定；否则 SHALL 按旧模式（本次改动前的平台角色规则）判定，结果与改动前一致（唯一例外：平台用户管理入口，见"外贸与平台管理入口例外"）。`/api/auth/active-org` 响应 SHALL 含 `positionMode` 布尔字段。

#### Scenario: Sunny 是岗位模式
- **WHEN** 当前企业的行业包为 `window_covering_services_v1`
- **THEN** `/api/auth/active-org` 返回 `positionMode: true`

#### Scenario: 无岗位模板企业沿用旧规则
- **WHEN** 当前企业无行业包，平台角色为 `boss` 的成员加载导航
- **THEN** 可见入口与改动前完全相同

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
岗位模式下，除外贸入口与平台管理入口外，每个导航入口 SHALL 只按其声明的权限键（持任一即可见）与工作区判定；平台角色与"按平台角色整组 / 单条隐藏"的规则 SHALL NOT 参与。销售区入口 SHALL 要求 `sales.quote.create` 或 `sales.quote.pricing_close` 或管理层；企业经营、AI 能力与经营驾驶舱 SHALL 要求管理层；招投标与项目情报入口 SHALL 要求 `project.read`；品牌增长入口 SHALL 要求 `operations.read` 或 `operations.manage`。

#### Scenario: 销售看不到运营与经营入口
- **WHEN** 岗位模式下只持 `sales_rep` 岗位的成员加载导航
- **THEN** 可见销售中心、报价、日程，不可见品牌增长、企业经营、AI 能力、招投标

#### Scenario: 运营看不到销售区
- **WHEN** 岗位模式下只持 `ops_staff` 岗位的成员加载导航
- **THEN** 可见运营中心与品牌增长，不可见销售中心与报价

#### Scenario: 多岗取并集
- **WHEN** 岗位模式下同时持 `owner`、`pricing_lead`、`accounting` 岗位的成员加载导航
- **THEN** 同时可见企业经营、销售报价与会计视图

### Requirement: 外贸与平台管理入口例外
岗位模式下，外贸入口（`/trade/**`、营收中心、产品内容）SHALL 对平台角色 `trade` 或管理层可见。两种模式下，平台用户管理入口 SHALL 只对平台 super_admin 可见（与 PERM-4b 用户管理接口口径一致）。

#### Scenario: 外贸角色看外贸
- **WHEN** 岗位模式下平台角色为 `trade`、无岗位的成员加载导航（企业启用外贸模块）
- **THEN** 可见外贸入口

#### Scenario: 平台 admin 看不到用户管理
- **WHEN** 平台角色为 `admin` 或 `boss`（非 super_admin）的成员在任一模式下加载导航
- **THEN** 不可见平台用户管理入口

### Requirement: 岗位模式的底栏
岗位模式下，手机底栏 SHALL 在默认落地为 `/sales/home` 时使用销售布局，否则使用通用布局；平台角色 `sales` SHALL NOT 单独决定布局。

#### Scenario: 销售岗位用销售底栏
- **WHEN** 岗位模式下平台角色为 `user`、只持 `sales_rep` 岗位的成员打开手机端
- **THEN** 底栏为销售布局
