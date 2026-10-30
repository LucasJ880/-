# Spec Delta

## ADDED Requirements

### Requirement: 无绳设置同样走审批
`PUT /api/sales/quote-settings/discounts` 的 `cordlessDiscount`（0 到 1）、`cordlessFloorZebra`、`cordlessFloorRoller`（0 到 10000）SHALL 与其它设置项同样校验、同样进入 `sales.update_quote_settings` 待审批动作的数值 diff、同样由批准人校验后才写入企业设置 JSON 的 `pricing.cordless` 子键；写入 SHALL 只更新该子键，SHALL NOT 覆盖 `pricing.discounts` 与企业设置 JSON 的其它键。平台 super_admin 直接生效的规则不变。

#### Scenario: 老板改无绳折扣
- **WHEN** 持 `owner` 岗位的 Bob PUT `{ cordlessDiscount: 0.25, cordlessFloorZebra: 169 }`
- **THEN** 响应 202，待审批动作 diff 含 `cordlessDiscount=0.25`、`cordlessFloorZebra=169`，企业设置 JSON 未变；另一位老板批准后 `pricing.cordless.discount` 为 0.25、`pricing.cordless.floors.Zebra` 为 169，`pricing.discounts` 与 `sunnyWarranty` 原样；`quote-settings-db.isolated.test.ts` 覆盖

#### Scenario: 非法值拒绝
- **WHEN** PUT `{ cordlessFloorRoller: -1 }` 或 `{ cordlessDiscount: 1.2 }`
- **THEN** 返回 400，不创建待审批动作
