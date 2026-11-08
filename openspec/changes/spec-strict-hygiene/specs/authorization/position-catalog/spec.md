# Spec Delta

## REMOVED Requirements

### Requirement: 新增权限键登记
**Reason**: 原要求描述 510 字，超过 `openspec validate --strict` 的 500 字上限；它同时说了两件事（登记 15 个键、岗位管理键只允许人类主体），按"一条要求一个行为"拆成两条。
**Migration**: 原文第一句与场景「权限键可识别」原样移入「岗位体系权限键登记」；原文第二句与场景「岗位管理键不开放给数字员工」原样移入「岗位管理键只允许人类主体」。行为不变，无需任何代码或数据迁移。

## ADDED Requirements

### Requirement: 岗位体系权限键登记
权限目录 SHALL 包含以下键，且每个键 SHALL 有中文标签、风险等级与支持的数据范围：`sales.quote.pricing_close`、`sales.quote.discount.over_limit.submit`、`sales.quote.discount.over_limit.approve`、`sales.settings.manage`、`sales.order.create`、`orders.fulfillment.update`、`orders.fulfillment.update.vinyl`、`orders.fulfillment.update.drapery`、`orders.fulfillment.update.shades`、`orders.fulfillment.read`、`orders.cancel`、`inventory.manage`、`inventory.read`、`accounting.read`、`identity.position.manage`。

#### Scenario: 权限键可识别
- **WHEN** 以上任一键用于授权判定
- **THEN** 判定结果不是 `UNKNOWN_PERMISSION`

### Requirement: 岗位管理键只允许人类主体
`identity.position.manage` SHALL 只允许人类主体，不允许数字员工主体。

#### Scenario: 岗位管理键不开放给数字员工
- **WHEN** 读取 `identity.position.manage` 的定义
- **THEN** 允许的主体类型只有 `HUMAN`
