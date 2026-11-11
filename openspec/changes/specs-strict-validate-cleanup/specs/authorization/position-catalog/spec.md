# Spec Delta

## MODIFIED Requirements

### Requirement: 新增权限键登记
权限目录 SHALL 包含以下键，且每个键 SHALL 有中文标签、风险等级与支持的数据范围：`sales.quote.pricing_close`、`sales.quote.discount.over_limit.submit`、`sales.quote.discount.over_limit.approve`、`sales.settings.manage`、`sales.order.create`、`orders.fulfillment.update`、`orders.fulfillment.update.vinyl`、`orders.fulfillment.update.drapery`、`orders.fulfillment.update.shades`、`orders.fulfillment.read`、`orders.cancel`、`inventory.manage`、`inventory.read`、`accounting.read`、`identity.position.manage`。各键允许的主体类型见「数字员工禁区键登记」。

#### Scenario: 权限键可识别
- **WHEN** 以上任一键用于授权判定
- **THEN** 判定结果不是 `UNKNOWN_PERMISSION`

#### Scenario: 岗位管理键不开放给数字员工
- **WHEN** 读取 `identity.position.manage` 的定义
- **THEN** 允许的主体类型只有 `HUMAN`
