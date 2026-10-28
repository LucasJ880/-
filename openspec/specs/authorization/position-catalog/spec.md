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
`fulfillment_vinyl`、`fulfillment_drapery`、`fulfillment_shades` 三个模板 SHALL 以 `ORG` 范围分别绑定 `orders.fulfillment.update.vinyl`、`orders.fulfillment.update.drapery`、`orders.fulfillment.update.shades`，并都绑定 `orders.fulfillment.read`、`inventory.read`、`project.read`、`sales.quote.read`、`install.task.read`、`install.photo.read`。SHALL NOT 绑定全品类键 `orders.fulfillment.update`、`orders.cancel`、`inventory.manage`、`install.task.assign`、`sales.quote.create`、`sales.quote.update` 或任何 `sales.customer.*` 写权限。

#### Scenario: 出单模板只含自己的品类
- **WHEN** 读取 `fulfillment_vinyl` 模板
- **THEN** 包含 `orders.fulfillment.update.vinyl`（ORG）与 `orders.fulfillment.read`，不包含 `orders.fulfillment.update.drapery`、`orders.fulfillment.update.shades`、`orders.fulfillment.update`、`orders.cancel`

#### Scenario: 出单模板不含销售写权
- **WHEN** 读取三个出单模板任一
- **THEN** 不包含 `sales.quote.create` / `sales.quote.update` / `sales.customer.create` / `sales.customer.update`

### Requirement: 新增权限键登记
权限目录 SHALL 包含以下键，且每个键 SHALL 有中文标签、风险等级与支持的数据范围：`sales.quote.pricing_close`、`sales.quote.discount.over_limit.submit`、`sales.quote.discount.over_limit.approve`、`sales.settings.manage`、`sales.order.create`、`orders.fulfillment.update`、`orders.fulfillment.update.vinyl`、`orders.fulfillment.update.drapery`、`orders.fulfillment.update.shades`、`orders.fulfillment.read`、`orders.cancel`、`inventory.manage`、`inventory.read`、`accounting.read`、`identity.position.manage`。`identity.position.manage` SHALL 只允许人类主体，不允许数字员工主体。

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

### Requirement: 安装工岗位
窗饰企业岗位模板集 SHALL 包含 `installer`（安装工），绑定 `install.task.read`、`install.task.update`、`install.window.complete`，数据范围均为 ASSIGNED。该模板 SHALL NOT 绑定任何 `sales.*` 权限、`install.task.assign` 或 `install.photo.read`。

#### Scenario: 安装工模板
- **WHEN** 读取 `installer` 模板的权限绑定
- **THEN** 三个 `install.*` 键均为 ASSIGNED，无 `sales.` 前缀键，无 `install.task.assign`

### Requirement: 安装相关权限键
权限目录 SHALL 包含 `install.task.read`、`install.task.update`、`install.window.complete`（支持 ASSIGNED 与 ORG）、`install.task.assign`、`install.photo.read`（仅 ORG），每个键 SHALL 有中文标签与风险等级。

#### Scenario: 权限键可识别
- **WHEN** 以上任一键用于授权判定
- **THEN** 判定结果不是 `UNKNOWN_PERMISSION`

### Requirement: 既有岗位追加安装权
安排安装（指定安装工与时间）的权限 `install.task.assign` SHALL 只追加给 `owner`、`ops_lead`、`accounting`（ORG），三者同时追加 `install.task.read` 与 `install.photo.read`（ORG）。`fulfillment_vinyl`、`fulfillment_drapery`、`fulfillment_shades` SHALL 追加 `install.task.read` 与 `install.photo.read`（ORG），SHALL NOT 追加 `install.task.assign`。`ops_staff` 与 `sales_rep` SHALL NOT 追加任何 `install.*`。

#### Scenario: 运营与会计可安排安装
- **WHEN** 读取 `ops_lead` 与 `accounting` 模板
- **THEN** 两者都包含 `install.task.assign`（ORG）与 `install.photo.read`（ORG）

#### Scenario: 出单岗只能看不能安排
- **WHEN** 读取 `fulfillment_vinyl` 模板
- **THEN** 包含 `install.task.read`（ORG）与 `install.photo.read`（ORG），不包含 `install.task.assign`

#### Scenario: 销售不参与安装
- **WHEN** 读取 `sales_rep` 并集绑定
- **THEN** 不包含任何 `install.` 前缀键

### Requirement: 老板岗位的出单与库存权
`owner` 模板 SHALL 以 `ORG` 范围追加 `orders.fulfillment.update`（全品类）、`orders.fulfillment.read`、`orders.cancel`、`inventory.manage`、`inventory.read`；`ops_lead` SHALL 追加 `inventory.read`、`orders.fulfillment.read`；`ops_staff` SHALL 追加 `inventory.read`；`sales_rep` SHALL 追加 `inventory.read`。

#### Scenario: 老板持全品类键
- **WHEN** 读取 `owner` 模板
- **THEN** 包含 `orders.fulfillment.update`、`orders.cancel`、`inventory.manage`

#### Scenario: 运营人员只读库存
- **WHEN** 读取 `ops_staff` 模板
- **THEN** 包含 `inventory.read`，不包含 `inventory.manage`
