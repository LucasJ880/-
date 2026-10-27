# authorization/position-catalog Specification

## Purpose
企业岗位目录：按行业包为企业落地一组岗位模板，每个岗位是一组"权限键 + 数据范围"，一个人可以绑多个岗位，有效权限取并集。

## Requirements

### Requirement: 窗饰企业岗位模板集
系统 SHALL 为 `industryPackId` 等于 `window_covering_services_v1` 的企业提供以下岗位模板：`owner`、`sales_rep`、`pricing_lead`、`ops_lead`、`ops_staff`、`accounting`、`bids`、`fulfillment_vinyl`、`fulfillment_drapery`、`fulfillment_shades`。每个模板 SHALL 带中文名称与说明。

#### Scenario: 窗饰企业落地模板
- **WHEN** 对 `industryPackId = window_covering_services_v1` 的企业执行岗位模板落地
- **THEN** 该企业的岗位表中存在上述 10 个 key，且重复执行不产生重复行

#### Scenario: 非窗饰企业不落地
- **WHEN** 对 `industryPackId` 不是 `window_covering_services_v1` 的企业执行岗位模板落地
- **THEN** 该企业只有原有 8 个系统模板，不出现 `pricing_lead`、`fulfillment_*` 等窗饰岗位

### Requirement: 老板岗位权限
`owner` 模板 SHALL 以 `ORG` 范围绑定：全部销售读、运营读、项目读、招投标交接预览 / 执行 / override、`accounting.read`、`audit.read`、`authorization.policy.read`、`sales.settings.manage`、`sales.quote.discount.over_limit.submit`、`sales.quote.discount.over_limit.approve`。SHALL NOT 绑定 `identity.member.manage`、`identity.role.manage`、`identity.position.manage`、`authorization.policy.manage`。

#### Scenario: 老板模板含审批与设置权
- **WHEN** 读取 `owner` 模板的权限绑定
- **THEN** 包含 `sales.quote.discount.over_limit.approve`（ORG）与 `sales.settings.manage`（ORG）

#### Scenario: 老板模板不含管理面
- **WHEN** 读取 `owner` 模板的权限绑定
- **THEN** 不包含 `identity.member.manage`、`identity.role.manage`、`identity.position.manage`、`authorization.policy.manage`

### Requirement: 销售岗位权限
`sales_rep` 模板 SHALL 以 `PRINCIPAL` 范围绑定客户 / 商机 / 报价的读、建、改，`sales.quote.send`、`sales.order.create`、`sales.analytics.read`；商机读 / 改另含 `ASSIGNED`。SHALL NOT 绑定 `sales.quote.discount.over_limit.submit` 或任何 `ORG` 范围的销售权限。

#### Scenario: 销售模板只有本人范围
- **WHEN** 读取 `sales_rep` 模板的权限绑定
- **THEN** 所有 `sales.*` 权限的数据范围只有 `PRINCIPAL` 或 `ASSIGNED`，且不包含 `sales.quote.discount.over_limit.submit`

### Requirement: 合价岗位权限
`pricing_lead` 模板 SHALL 以 `ORG` 范围绑定报价读 / 改、客户读、商机读、`sales.quote.pricing_close`、`sales.quote.discount.over_limit.submit`、`sales.quote.send`、`sales.analytics.read`。SHALL NOT 绑定 `sales.quote.discount.over_limit.approve` 与 `sales.settings.manage`。

#### Scenario: 合价模板
- **WHEN** 读取 `pricing_lead` 模板的权限绑定
- **THEN** 包含 `sales.quote.pricing_close`（ORG）与 `sales.quote.discount.over_limit.submit`（ORG），不包含 `sales.quote.discount.over_limit.approve` 与 `sales.settings.manage`

### Requirement: 运营岗位权限
`ops_lead` 模板 SHALL 以 `ORG` 范围绑定 `operations.read`、`operations.manage`、团队任务读 / 管理、执行项目读 / 管理 / 创建、`inventory.manage`、`identity.member.read`。`ops_staff` 模板沿用系统模板，SHALL NOT 绑定 `inventory.manage`。

#### Scenario: 运营主管含库存管理
- **WHEN** 读取 `ops_lead` 与 `ops_staff` 模板
- **THEN** `ops_lead` 包含 `inventory.manage`（ORG），`ops_staff` 不包含

### Requirement: 会计与招投标岗位权限
`accounting` 模板 SHALL 以 `ORG` 范围绑定 `accounting.read`、`sales.analytics.read`、`sales.quote.read`、`sales.customer.read`、`project.read`，SHALL NOT 绑定任何 `sales.*.create` / `update`。`bids` 模板 SHALL 以 `ORG` 范围绑定项目读 / 建 / 改、`bids.handoff.preview`、`bids.handoff.execute`、`operations.projects.create`。

#### Scenario: 会计只读
- **WHEN** 读取 `accounting` 模板的权限绑定
- **THEN** 包含 `accounting.read`（ORG）与 `sales.quote.read`（ORG），不包含任何以 `.create` 或 `.update` 结尾的销售权限

#### Scenario: 招投标可交接
- **WHEN** 读取 `bids` 模板的权限绑定
- **THEN** 包含 `bids.handoff.execute`（ORG），不包含 `bids.handoff.override`

### Requirement: 出单岗位权限
`fulfillment_vinyl`、`fulfillment_drapery`、`fulfillment_shades` 三个模板 SHALL 以 `ORG` 范围绑定 `orders.fulfillment.update`、`project.read`、`sales.quote.read`。SHALL NOT 绑定 `sales.quote.create`、`sales.quote.update` 或任何 `sales.customer.*` 写权限。按品类过滤的数据范围不在本能力内。

#### Scenario: 出单模板不含销售写权
- **WHEN** 读取 `fulfillment_vinyl`、`fulfillment_drapery`、`fulfillment_shades` 任一模板
- **THEN** 包含 `orders.fulfillment.update`（ORG），不包含 `sales.quote.create` / `sales.quote.update` / `sales.customer.create` / `sales.customer.update`

### Requirement: 新增权限键登记
权限目录 SHALL 包含以下键，且每个键 SHALL 有中文标签、风险等级与支持的数据范围：`sales.quote.pricing_close`、`sales.quote.discount.over_limit.submit`、`sales.quote.discount.over_limit.approve`、`sales.settings.manage`、`sales.order.create`、`orders.fulfillment.update`、`inventory.manage`、`accounting.read`、`identity.position.manage`。`identity.position.manage` SHALL 只允许人类主体，不允许数字员工主体。

#### Scenario: 权限键可识别
- **WHEN** 以上任一键用于授权判定
- **THEN** 判定结果不是 `UNKNOWN_PERMISSION`

#### Scenario: 岗位管理键不开放给数字员工
- **WHEN** 读取 `identity.position.manage` 的定义
- **THEN** 允许的主体类型只有 `HUMAN`

### Requirement: 多岗并集
当一个人绑定多个岗位时，系统 SHALL 把各岗位的权限绑定合并后作为有效权限；同一权限键出现多个数据范围时 SHALL 以最宽的范围匹配资源。

#### Scenario: 老板兼合价兼会计
- **WHEN** 某人同时绑定 `owner`、`pricing_lead`、`accounting`
- **THEN** 对 `sales.quote.read` 的判定匹配 `ORG` 范围，对 `sales.quote.discount.over_limit.approve` 的判定为允许

### Requirement: 系统模板 org_owner 不含管理面
系统岗位模板 `org_owner` SHALL NOT 绑定 `identity.member.manage`、`identity.role.manage`、`authorization.policy.manage`；成员与岗位管理只属于平台管理员。`org_owner` 其余绑定 SHALL 保持。

#### Scenario: org_owner 模板
- **WHEN** 读取系统模板 `org_owner` 的权限绑定
- **THEN** 不包含上述三个键，仍包含 `sales.customer.read`（ORG）与 `audit.read`（ORG）
