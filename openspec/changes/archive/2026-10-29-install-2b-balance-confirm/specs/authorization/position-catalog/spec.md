# Spec Delta

## ADDED Requirements

### Requirement: 尾款确认权限键
权限目录 SHALL 包含 `install.balance.confirm`（中文标签"确认收到尾款"，风险 HIGH，只支持 `ORG`）。`accounting` 与 `owner` 模板 SHALL 以 `ORG` 范围绑定它；`sales_rep`、`pricing_lead`、`ops_lead`、`ops_staff`、`bids`、`installer` 与三个出单模板 SHALL NOT 绑定它。

#### Scenario: 会计与老板可确认尾款
- **WHEN** 读取 `accounting` 与 `owner` 模板
- **THEN** 两者都包含 `install.balance.confirm`（ORG）（`authorize.test.ts`）

#### Scenario: 其他岗位不可确认
- **WHEN** 读取 `sales_rep`、`ops_lead`、`installer`、`fulfillment_shades` 模板
- **THEN** 都不包含 `install.balance.confirm`

## MODIFIED Requirements

### Requirement: 数字员工禁区键登记
权限目录 SHALL 把以下键的允许主体类型限定为只有 `HUMAN`：所有以 `.approve` 结尾的键、所有 `sales.quote.discount.*`、`sales.quote.pricing_close`、`sales.settings.manage`、`organization.settings.manage`、`authorization.policy.manage`、所有 `identity.*`、`install.task.assign`、`install.balance.confirm`、`orders.cancel`、`inventory.manage`、`operations.manage`。其余键 SHALL 同时允许 `HUMAN` 与 `DIGITAL_EMPLOYEE`。

#### Scenario: 禁区键只允许人类
- **WHEN** 读取 `sales.quote.discount.over_limit.approve`、`identity.member.read`、`operations.manage`、`orders.cancel` 的定义
- **THEN** 允许的主体类型都只有 `HUMAN`

#### Scenario: 业务读写键开放给数字员工
- **WHEN** 读取 `sales.customer.read`、`sales.quote.create`、`operations.content.draft` 的定义
- **THEN** 允许的主体类型包含 `DIGITAL_EMPLOYEE`

#### Scenario: 数字员工不能确认尾款
- **WHEN** 绑定了 `accounting` 岗位的数字员工请求 `install.balance.confirm`
- **THEN** 判定为拒绝，原因是主体类型不允许（`authorize.test.ts`）
