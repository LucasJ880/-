# Spec Delta

## Purpose

作废工艺单是设计稿定义的敏感操作：由老板提交、另一位老板批准后才生效，平台管理员可直批并留自批痕迹。

## ADDED Requirements

### Requirement: 作废须审批
把工艺单转为 `cancelled` SHALL 要求提交者持 `orders.cancel`；提交 SHALL 创建一条待审批动作（类型 `orders.cancel_blinds_order`，内容含工艺单编号、当前状态、原因）并返回 202 与审批编号，工艺单状态 SHALL 保持不变。不持 `orders.cancel` 的人 SHALL 收到 403。

#### Scenario: 老板提交作废
- **WHEN** 持 `orders.cancel` 的 Bob 对状态 `confirmed` 的工艺单提交作废，原因"客户取消"
- **THEN** 返回 202，响应含 `pending: true` 与审批编号；工艺单仍为 `confirmed`

#### Scenario: 出单人作废
- **WHEN** 只持出单岗位的小叶提交作废
- **THEN** 返回 403

### Requirement: 审批人规则
该待审批动作 SHALL 只能由持 `orders.cancel` 且不是提交者本人的人批准；批准后系统 SHALL 把工艺单置为 `cancelled`，记录取消时间、原因与状态日志（操作人 = 提交者，备注含批准人）。提交者批准自己的提交 SHALL 被拒绝。平台管理员 SHALL 可直接作废，审计记录 SHALL 标记为自批。

#### Scenario: 另一老板批准
- **WHEN** Bill 批准 Bob 提交的作废
- **THEN** 工艺单为 `cancelled`，状态日志一条 `confirmed → cancelled`，审计含提交人与批准人

#### Scenario: 自批被拒
- **WHEN** Bob 批准自己提交的作废
- **THEN** 批准被拒绝，工艺单状态不变

#### Scenario: 平台管理员直批
- **WHEN** 平台管理员对工艺单提交作废
- **THEN** 工艺单立即为 `cancelled`，审计记录含 `selfApproved: true`

### Requirement: 幂等与状态校验
对已是 `cancelled` 或 `completed` 的工艺单提交作废 SHALL 返回 409；同一工艺单存在未决的作废审批时再次提交 SHALL 返回同一审批编号而不是新建。该类型的微信确认策略 SHALL 为仅网页审阅。

#### Scenario: 重复提交
- **WHEN** 同一工艺单已有未决作废审批时再次提交
- **THEN** 返回 202 且审批编号与首次相同
