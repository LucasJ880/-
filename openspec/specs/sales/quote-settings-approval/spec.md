# sales/quote-settings-approval Specification

## Purpose
销售设置审批：折扣表、费用、税率、品类成本率与解锁码的修改必须由另一位持设置权的人批准后才生效；平台管理员可直接生效但留自批痕迹。

## Requirements

### Requirement: 设置修改需持设置权
`PUT /api/sales/quote-settings/discounts` SHALL 要求操作者持有 `sales.settings.manage`（或为平台 super_admin）；否则返回 403。企业成员角色 org_owner / org_admin 本身 SHALL NOT 构成该权限。

#### Scenario: 无设置权
- **WHEN** 持 `sales_rep` 岗位的人 PUT 修改折扣表
- **THEN** 返回 403

### Requirement: 非平台管理员的修改进入审批
持 `sales.settings.manage` 的非 super_admin 操作者 PUT 时，系统 SHALL NOT 立即落库，SHALL 创建一条类型为 `sales.update_quote_settings` 的待审批动作，响应 `202 { pending: true, approvalId }`；payload SHALL 只包含校验后的数值 diff、品类成本率与解锁码的哈希，SHALL NOT 包含解锁码明文。相同内容重复提交 SHALL 返回同一 approvalId（幂等）。

#### Scenario: 老板修改折扣表
- **WHEN** 持 `owner` 岗位的 Bob PUT `{ zebra: 0.4 }`
- **THEN** 响应 202，折扣表未变，存在一条待审批动作，审批中心可见

#### Scenario: 解锁码不落明文
- **WHEN** Bob PUT `{ depositOverrideCode: "1234" }`
- **THEN** 待审批动作 payload 不含 `1234`，只含哈希

#### Scenario: 重复提交幂等
- **WHEN** Bob 连续两次 PUT 相同内容
- **THEN** 两次返回同一 approvalId，只有一条待审批动作

### Requirement: 批准后执行并校验批准人
待审批动作被批准时，系统 SHALL 校验批准人持有 `sales.settings.manage` 且不是提交人（super_admin 除外）；通过后 SHALL 把 payload 应用到企业设置、版本号加一、写审计（动作 `quote_settings_updated`，含提交人与批准人）；不通过 SHALL 拒绝执行并说明原因。

#### Scenario: 另一位老板批准
- **WHEN** Bill 批准 Bob 提交的折扣表修改
- **THEN** 折扣表更新，版本加一，审计含 `requestedById=Bob`、`approvedById=Bill`

#### Scenario: 提交人自批被拒
- **WHEN** Bob 批准自己提交的修改
- **THEN** 执行被拒绝，错误说明不能批准自己提交的设置修改

### Requirement: 平台管理员直接生效
平台 super_admin PUT 时，系统 SHALL 直接落库并返回 200 与最新设置，审计 SHALL 记 `selfApproved: true` 与 `actorKind: platform_admin`。

#### Scenario: Lucas 直接改
- **WHEN** super_admin PUT `{ roller: 0.4 }`
- **THEN** 响应 200，折扣表立即更新，审计含 `selfApproved: true`

### Requirement: 界面提示
驾驶舱折扣卡片与快速报价内的折扣保存收到 202 时 SHALL 显示"已提交审批，等待另一位老板批准"，SHALL NOT 把本地草稿当作已生效。

#### Scenario: 卡片提示
- **WHEN** 老板在卡片保存并收到 202
- **THEN** 卡片显示已提交审批提示，显示值仍为当前生效值

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

### Requirement: 无绳设置同样走审批
`PUT /api/sales/quote-settings/discounts` 的 `cordlessDiscount`（0 到 1）、`cordlessFloorZebra`、`cordlessFloorRoller`（0 到 10000）SHALL 与其它设置项同样校验、同样进入 `sales.update_quote_settings` 待审批动作的数值 diff、同样由批准人校验后才写入企业设置 JSON 的 `pricing.cordless` 子键；写入 SHALL 只更新该子键，SHALL NOT 覆盖 `pricing.discounts` 与企业设置 JSON 的其它键。平台 super_admin 直接生效的规则不变。

#### Scenario: 老板改无绳折扣
- **WHEN** 持 `owner` 岗位的 Bob PUT `{ cordlessDiscount: 0.25, cordlessFloorZebra: 169 }`
- **THEN** 响应 202，待审批动作 diff 含 `cordlessDiscount=0.25`、`cordlessFloorZebra=169`，企业设置 JSON 未变；另一位老板批准后 `pricing.cordless.discount` 为 0.25、`pricing.cordless.floors.Zebra` 为 169，`pricing.discounts` 与 `sunnyWarranty` 原样；`quote-settings-db.isolated.test.ts` 覆盖

#### Scenario: 非法值拒绝
- **WHEN** PUT `{ cordlessFloorRoller: -1 }` 或 `{ cordlessDiscount: 1.2 }`
- **THEN** 返回 400，不创建待审批动作
