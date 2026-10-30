# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: 老板岗位的出单与库存权
`owner` 模板 SHALL 以 `ORG` 范围追加 `orders.fulfillment.update`（全品类）、`orders.fulfillment.read`、`orders.cancel`、`inventory.manage`、`inventory.read`；`ops_lead` SHALL 追加 `inventory.read`、`orders.fulfillment.read`；`ops_staff` SHALL 追加 `inventory.read`；`sales_rep` SHALL 追加 `inventory.read`。

#### Scenario: 老板持全品类键
- **WHEN** 读取 `owner` 模板
- **THEN** 包含 `orders.fulfillment.update`、`orders.cancel`、`inventory.manage`

#### Scenario: 运营人员只读库存
- **WHEN** 读取 `ops_staff` 模板
- **THEN** 包含 `inventory.read`，不包含 `inventory.manage`
