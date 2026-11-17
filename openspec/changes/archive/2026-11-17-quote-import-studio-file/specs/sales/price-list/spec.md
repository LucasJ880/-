# Spec Delta

## ADDED Requirements

### Requirement: 详细订单行可带定价面料
详细订单的 Shades 行 SHALL 可以带一个可选的定价面料。带有且它是该产品价表里的面料档时，该行的预览、报价 PDF 与保存 SHALL 以它为准取定价面料，不再由 SKU 后缀推断；Roller 行 SHALL 以它的基础面料加生效罩型取定价面料。销售在该行手动更换 SKU 或产品时 SHALL 清除它。没有带、或它不是该产品的面料档时，行为 SHALL 与没有这个字段时完全相同。该字段 SHALL 只存在表单数据里，SHALL NOT 新增数据库字段。

#### Scenario: 无后缀 SKU 按遮光档计价
- **WHEN** Zebra 行 SKU `SSB01`、定价面料 `Blackout`、48" × 60"
- **THEN** 预览与保存都按 Blackout 表计价；去掉定价面料后按 SKU 推断为 Light Filtering；`npx tsx src/lib/blinds/__tests__/order-form-pricing-parity.test.ts` 覆盖

#### Scenario: Roller 仍随罩型
- **WHEN** Roller 行定价面料 `Blackout w Cassette`、SKU `CABO-WHITE-BO`、55" × 72"，行上 Valance 由 Cassette 改为 None
- **THEN** 金额由 271.88 变为 221.88

#### Scenario: 换 SKU 清除
- **WHEN** 销售在带定价面料的行上手动换了一个 SKU
- **THEN** 该行不再带定价面料，按新 SKU 推断

#### Scenario: 没有该字段的行不变
- **WHEN** 运行同一测试里不带定价面料的全部既有用例
- **THEN** 结果与本 change 之前相同

### Requirement: 详细订单行可带行级折扣
详细订单的 Shades 行、Drapes 行的布帘部分与纱帘部分 SHALL 各可以带一个可选的行级折扣（0 到 1）。带有时该行的预览、报价 PDF 与保存 SHALL 用它代替该产品的企业默认折扣，保存时随行提交为行级折扣；表单上 SHALL 显示该折扣并可清除，清除后回到企业默认折扣。详细订单 SHALL NOT 提供手工录入行级折扣的输入。没有带时行为 SHALL 与没有这个字段时完全相同。该字段 SHALL 只存在表单数据里。

#### Scenario: 行折扣 15%
- **WHEN** Zebra 行 `Light Filtering` 40" × 50"、行级折扣 15%，企业 Zebra 折扣 45%
- **THEN** 预览与保存金额都是 234.72；清除后为 151.88；`npx tsx src/lib/blinds/__tests__/order-form-pricing-parity.test.ts` 覆盖

#### Scenario: 预览等于保存
- **WHEN** 对带行级折扣的 Shades 行、布帘行、纱帘行分别取页面预览金额与「行构造 → 套企业默认折扣 → 引擎」的金额
- **THEN** 每一行两个金额之差 ≤ 0.01

#### Scenario: 无绳行
- **WHEN** Zebra 行 Cordless 开且带行级折扣 20%
- **THEN** 该行按行级折扣 20% 计价，不再套企业无绳折扣（与引擎既有的「行级覆盖优先」一致）

### Requirement: SKU 下拉显示目录外的当前值
详细订单 Shades 行的 SKU 下拉在该行当前 SKU 不在该产品的 SKU 目录里时，SHALL 把当前值作为一个带「目录外」标记的选项显示并选中，SHALL NOT 显示成未选择。当前值在目录里或为空时下拉 SHALL 与之前相同。

#### Scenario: 目录外的 SKU
- **WHEN** Cordless Cellular 行的 SKU 为 `B01-38-BO100`（不在目录里）
- **THEN** 下拉选中一个文字含 `B01-38-BO100` 与「目录外」的选项

#### Scenario: 目录内的 SKU
- **WHEN** Roller 行的 SKU 为 `CABO-WHITE-BO`
- **THEN** 下拉里没有「目录外」选项；`npx tsx src/lib/blinds/__tests__/order-form-pricing-parity.test.ts` 的选项构造用例覆盖
