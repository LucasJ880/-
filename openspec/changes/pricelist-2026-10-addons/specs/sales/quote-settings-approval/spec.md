## ADDED Requirements

### Requirement: 附加项目企业价同样走审批
`PUT /api/sales/quote-settings/discounts` 的 `addonPrices`（附加项目键到单价的对象，只含要改的键）SHALL 逐键校验：键 SHALL 在附加项目目录内，单价 SHALL 为 0 到 10000 的数字，否则返回 400 且不创建待审批动作。合法修改 SHALL 与其它设置项同样进入 `sales.update_quote_settings` 待审批动作的数值 diff（每键一项，形如 `addonPrice.motor=160`），同样由批准人校验后才写入企业设置 JSON 的 `pricing.addons` 子键；写入 SHALL 只更新提交的键，SHALL NOT 覆盖 `pricing.discounts`、`pricing.cordless` 与企业设置 JSON 的其它键。折扣接口 GET SHALL 返回全部 36 项的当前企业价。平台 super_admin 直接生效的规则不变。

#### Scenario: 老板改电机价
- **WHEN** 持 `owner` 岗位的 Bob PUT `{ addonPrices: { motor: 160 } }`
- **THEN** 响应 202，待审批动作 diff 含 `addonPrice.motor=160`，企业设置 JSON 未变；另一位老板批准后 `pricing.addons.motor` 为 160，`pricing.cordless` 与 `sunnyWarranty` 原样，GET 返回 `addonPrices.motor` 为 160、`addonPrices.hub` 为 240；`quote-settings-db.isolated.test.ts` 覆盖

#### Scenario: 非法键或值拒绝
- **WHEN** PUT `{ addonPrices: { not_a_key: 10 } }` 或 `{ addonPrices: { hub: -1 } }`
- **THEN** 返回 400，不创建待审批动作；`cost-rates.test.ts` 覆盖校验函数

#### Scenario: 审批描述
- **WHEN** 待审批动作 diff 为 `{ "addonPrice.downtown_fee": 180 }`
- **THEN** 审批中心描述含 `addonPrice.downtown_fee=180`；`quote-settings-approval.test.ts` 覆盖
