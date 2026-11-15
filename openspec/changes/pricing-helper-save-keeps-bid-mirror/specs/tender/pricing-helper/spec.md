## Purpose
规定报价表助手保存人工输入时怎样写 `BidIntelligenceRoom.summaryJson.pricingInputs`：只改竞品价、我方成本、目标毛利三项，同一对象里报价引擎镜像的权威报价原样保留。计算结果是假设驱动的情景，不调模型、不对外发送。

## ADDED Requirements

### Requirement: 保存只改人工输入
报价表助手以 `action: "save"` 保存时，系统 SHALL 只更新 `pricingInputs` 里的 `competitorPriceCad`、`ourCostCad`、`targetMarginPct`：请求里带了的项取请求的值（非负数字或 null），没带的项沿用原值。`pricingInputs` 里原有的其它键（报价引擎写的 `ourPriceCad`、`ourPrice`、`ourPriceCurrency`、`ourPriceSource`、`ourPriceStatus`、`ourPriceSupersededSource`，包括值为 null 的）SHALL 原样保留；`summaryJson` 里 `pricingInputs` 以外的键 SHALL NOT 受影响。原来没有 `pricingInputs` 时 SHALL 只写这三项。只存人工评分模型、不带 `inputs` 时，`pricingInputs` 的内容 SHALL 不变。

#### Scenario: 已有权威报价镜像时整份保存
- **WHEN** 报价引擎已把一份 CAD 报价镜像进 `pricingInputs`（`ourPriceCad`、`ourPriceSource = quote:<id>:v<n>`、`ourPriceStatus = AUTHORITATIVE`），之后在报价表卡片上保存三项新输入
- **THEN** 三项输入变为新值，`ourPriceCad` / `ourPrice` / `ourPriceCurrency` / `ourPriceSource` / `ourPriceStatus` 与保存前相同（`npx tsx src/lib/tender-pricing/__tests__/pricing-helper-save-db.isolated.test.ts`）

#### Scenario: 只改一项、只存模型、清空一项
- **WHEN** 只带竞品价保存；或只带评分模型保存；或把我方成本保存为 null
- **THEN** 没带的输入沿用原值，被清空的那项为 null，镜像的我方报价都还在（`pricing-helper-save-db.isolated.test.ts`）

#### Scenario: 改价待定
- **WHEN** 报价引擎把镜像改成改价待定（`ourPriceCad = null`、`ourPriceStatus = QUOTE_REVISION_PENDING`、`ourPriceSupersededSource` 指向被替代的报价），之后保存目标毛利
- **THEN** `ourPriceStatus`、`ourPriceSupersededSource` 不变，`ourPriceCad` 这一键仍在且为 null（`pricing-helper-save-db.isolated.test.ts`）

#### Scenario: 原来没有 pricingInputs
- **WHEN** 房间里还没有 `pricingInputs`，保存三项输入
- **THEN** `pricingInputs` 恰好是这三项，不多出任何键（`pricing-helper-save-db.isolated.test.ts`）

### Requirement: 保存的对外行为
保存成功时系统 SHALL 返回 `{ ok: true, inputs, model }`，其中 `inputs` SHALL 只含三项人工输入、不含报价引擎镜像的键；GET 返回的 `inputs` 同样只含这三项。目标毛利不小于 100 时 SHALL 返回 400，项目没有投标调查室时 SHALL 返回 409，没有写权限时 SHALL 被拒绝；这几种情况 SHALL NOT 写库。

#### Scenario: 返回形状
- **WHEN** 已有权威报价镜像时保存
- **THEN** 返回的 `inputs` 只有 `competitorPriceCad`、`ourCostCad`、`targetMarginPct`；GET 的 `inputs` 也没有 `ourPriceCad`（`pricing-helper-save-db.isolated.test.ts`）

#### Scenario: 拒绝的保存不写库
- **WHEN** 目标毛利填 100；或只读成员保存；或项目没有投标调查室
- **THEN** 分别得到 400、403、409，房间的 `summaryJson` 与请求前相同（`pricing-helper-save-db.isolated.test.ts`）
