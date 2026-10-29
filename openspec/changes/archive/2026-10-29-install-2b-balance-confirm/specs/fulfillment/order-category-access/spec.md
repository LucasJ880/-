# Spec Delta

## MODIFIED Requirements

### Requirement: 状态推进按品类
把工艺单推进到 `confirmed`、`in_production`、`ready`、`installed`、`completed`，或在 `draft` 与 `confirmed` 之间退回，SHALL 适用与修改相同的品类判定；推进到 `scheduled` SHALL 继续要求 `install.task.assign`；推进到 `cancelled` SHALL 遵循 `fulfillment/order-cancellation-approval`。例外：经尾款确认（`installation/balance-confirmation`）把 `installed` 推进到 `completed` SHALL 要求 `install.balance.confirm`，SHALL NOT 要求品类键。修改接口 SHALL NOT 把状态直接改为 `cancelled` 或 `scheduled`（返回 409 `USE_TRANSITION`）。

#### Scenario: 出单人确认本品类单
- **WHEN** 小叶把品类 `{shades}` 的工艺单从 `draft` 转 `confirmed`
- **THEN** 返回 200，状态日志记录操作人为小叶

#### Scenario: 修改接口不能绕过作废审批
- **WHEN** 持该单全部品类键的人以修改接口提交 `status: "cancelled"`
- **THEN** 返回 409 `USE_TRANSITION`，状态不变

#### Scenario: 会计确认尾款推进已完成
- **WHEN** 只持 `accounting` 岗位（无任何品类键）的会计对已安装的单确认尾款
- **THEN** 工艺单变为 `completed`，状态日志操作人为会计（`balance-db.isolated.test.ts`）
