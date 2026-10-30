# Spec Delta

## ADDED Requirements

### Requirement: 数字员工禁区键登记
权限目录 SHALL 把以下键的允许主体类型限定为只有 `HUMAN`：所有以 `.approve` 结尾的键、所有 `sales.quote.discount.*`、`sales.quote.pricing_close`、`sales.settings.manage`、`organization.settings.manage`、`authorization.policy.manage`、所有 `identity.*`、`install.task.assign`、`orders.cancel`、`inventory.manage`、`operations.manage`。其余键 SHALL 同时允许 `HUMAN` 与 `DIGITAL_EMPLOYEE`。

#### Scenario: 禁区键只允许人类
- **WHEN** 读取 `sales.quote.discount.over_limit.approve`、`identity.member.read`、`operations.manage`、`orders.cancel` 的定义
- **THEN** 允许的主体类型都只有 `HUMAN`

#### Scenario: 业务读写键开放给数字员工
- **WHEN** 读取 `sales.customer.read`、`sales.quote.create`、`operations.content.draft` 的定义
- **THEN** 允许的主体类型包含 `DIGITAL_EMPLOYEE`
