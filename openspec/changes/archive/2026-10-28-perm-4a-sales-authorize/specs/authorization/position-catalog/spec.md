# Spec Delta

## ADDED Requirements

### Requirement: 签约改价审批权限键
权限目录 SHALL 包含 `sales.quote.signed_amount.approve`：中文标签"批准签约单改价"，风险等级 HIGH，只支持 `ORG` 范围，只允许人类主体。

#### Scenario: 权限键可识别
- **WHEN** `sales.quote.signed_amount.approve` 用于授权判定
- **THEN** 判定结果不是 `UNKNOWN_PERMISSION`

#### Scenario: 不开放给数字员工
- **WHEN** 读取 `sales.quote.signed_amount.approve` 的定义
- **THEN** 允许的主体类型只有 `HUMAN`

### Requirement: 老板岗位的销售改权
`owner` 模板 SHALL 以 `ORG` 范围追加 `sales.customer.update`、`sales.customer.archive`、`sales.opportunity.update`、`sales.quote.update`、`sales.quote.signed_amount.approve`。其余岗位模板 SHALL NOT 绑定 `sales.quote.signed_amount.approve` 或 `sales.customer.archive`。

#### Scenario: 老板模板含销售改权
- **WHEN** 读取 `owner` 模板的权限绑定
- **THEN** 包含上述五个键，范围均为 `ORG`

#### Scenario: 合价不持签约改价审批权
- **WHEN** 读取 `pricing_lead` 模板的权限绑定
- **THEN** 不包含 `sales.quote.signed_amount.approve` 与 `sales.customer.archive`
