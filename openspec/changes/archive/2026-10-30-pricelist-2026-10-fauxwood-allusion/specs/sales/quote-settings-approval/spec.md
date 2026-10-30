# Spec Delta

## ADDED Requirements

### Requirement: 企业设置 JSON 中的折扣同样走审批
`PUT /api/sales/quote-settings/discounts` 的 `fauxwood` / `allusion` 折扣与 `costRates.fauxwood` / `costRates.allusion` SHALL 与其它折扣项同样校验（0 到 1）、同样进入 `sales.update_quote_settings` 待审批动作的数值 diff、同样由批准人校验后才写入企业设置 JSON 的 `pricing.discounts` 子键；写入 SHALL 只更新该子键，SHALL NOT 覆盖企业设置 JSON 的其它键。平台 super_admin 直接生效的规则不变。

#### Scenario: 老板改 Fauxwood 折扣
- **WHEN** 持 `owner` 岗位的 Bob PUT `{ fauxwood: 0.25 }`
- **THEN** 响应 202，待审批动作 diff 含 `fauxwood=0.25`，企业设置 JSON 未变；`npx tsx src/lib/sales/__tests__/quote-settings-approval.test.ts` 覆盖 payload 与描述文字

#### Scenario: 批准后只动 pricing 子键
- **WHEN** Bill 批准该动作，企业设置 JSON 原有 `sunnyWarranty`、`calendarWatch` 键
- **THEN** `pricing.discounts.fauxwood` 为 0.25，其余键原样保留，版本号加一

#### Scenario: 非法值拒绝
- **WHEN** PUT `{ allusion: 1.5 }`
- **THEN** 返回 400，不创建待审批动作
