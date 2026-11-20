## ADDED Requirements

### Requirement: 我方成本只给有财务查看权的人
报价表助手 SHALL 按与成本核算相同的财务查看权判定：平台超级管理员、持组织范围 `project.finance.manage` 或 `project.finance.read` 的人、项目负责人；判定出错时 SHALL 只按负责人与平台超级管理员判定。没有财务查看权的人读取时：`inputs.ourCostCad` SHALL 为 `null` 并带 `costHidden: true`；开关开着时 SHALL 只带 `compareCostHidden: true`、不带成本建议；情景表 SHALL 按没有成本计算；有情景结果时假设说明 SHALL 不含「未填我方成本」那句、SHALL 写「需要财务查看权才能看我方成本；毛利一栏与成本底价情景也不显示。」。卡片 SHALL 以「需要财务查看权才能看我方成本。」代替成本输入框，SHALL NOT 显示毛利一栏。有财务查看权的人 SHALL 与以前相同。

#### Scenario: 没有财务查看权的人读取
- **WHEN** 已保存对手价 100,000、成本 90,000、目标毛利 15%，开关开着；只读成员、项目编辑者、`org_admin`、只在分配范围持 `project.finance.read` 的投标同事分别读取
- **THEN** 都是 `inputs.ourCostCad` 为 `null`、`costHidden`、`compareCostHidden`，没有 `compareCost`，情景里没有毛利、没有成本底价情景，假设说明有那一句（`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/pricing-helper-finance-db.isolated.test.ts`；`npx tsx src/lib/tender-pricing/__tests__/finance-view.test.ts`）

#### Scenario: 有财务查看权的人读取
- **WHEN** 项目负责人、持组织范围 `project.finance.read` 的成员、平台超级管理员分别读取
- **THEN** 三人的结果相同，带成本 90,000 与 `compareCost`，没有 `costHidden`（`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/pricing-helper-finance-db.isolated.test.ts`）

#### Scenario: 卡片
- **WHEN** 读取结果带 `costHidden`
- **THEN** 卡上没有「我方成本」输入框而是那句话，情景表没有毛利一栏，保存请求不带 `ourCostCad`，目标毛利的标签与成本加成提示照旧（`npx tsx src/lib/tender-pricing/__tests__/finance-view.test.ts` 源码断言）

### Requirement: 没有财务查看权的人改不了成本
没有财务查看权的人保存时，请求的 `inputs` 里有 `ourCostCad` 这个键（不论值）或请求带了 `ourCostSource` 这个键，系统 SHALL 返回 403「需要财务查看权才能修改我方成本。」且 SHALL NOT 写库；判定顺序 SHALL 是项目没有投标调查室 409、再财务 403、再目标毛利不小于 100 的 400。不碰成本的保存 SHALL 照常，已保存的成本与来源 SHALL 原样保留，返回的 `inputs.ourCostCad` SHALL 为 `null` 并带 `costHidden: true`、SHALL NOT 带 `ourCostSource`。重新推导评分模型 SHALL NOT 做财务判定。

#### Scenario: 没有财务查看权的编辑者保存
- **WHEN** 能编辑项目、没有财务键的成员保存时带了 `ourCostCad`；又带了 `ourCostSource: null`；再只带对手价
- **THEN** 前两次 403、房间的 `summaryJson` 不变；第三次成功，成本与来源保留，返回的 `inputs.ourCostCad` 为 `null`、没有 `ourCostSource`（`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/pricing-helper-finance-db.isolated.test.ts`；`npx tsx src/lib/tender-pricing/__tests__/finance-view.test.ts`）

### Requirement: 没有财务查看权时不带出的内容
对没有财务查看权的人，报价表助手的读取与保存返回 SHALL NOT 含已保存的我方成本、比价矩阵算出的落地价及其逐项金额、已记成本来源里的落地价、「矩阵变了」的提示，也 SHALL NOT 含能由价格与目标毛利反推成本的情景。

#### Scenario: 响应里搜不到成本数字
- **WHEN** 开关开着、比价矩阵有选定、已保存成本带来源；没有财务键的项目编辑者读取一次、只带对手价保存一次
- **THEN** 两次响应的 JSON 里都没有 `compareCost`、`ourCostSource`，也搜不到成本与落地价的数字（`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/pricing-helper-finance-db.isolated.test.ts`）

### Requirement: 调查室 JSON 不带出我方成本
项目列表接口返回的每个项目的 `intelligenceRoom.summaryJson`、调查室读取接口返回的 `room.summaryJson`，对任何人 SHALL NOT 含 `pricingInputs.ourCostCad` 与 `pricingInputs.ourCostSource`；`pricingInputs` 的其它键与 `summaryJson` 的其它内容 SHALL 原样返回；SHALL NOT 改库。

#### Scenario: 两个接口
- **WHEN** 房间里存着成本与来源、报价引擎镜像的我方报价，项目负责人读项目列表与调查室
- **THEN** 两处的 `pricingInputs` 没有 `ourCostCad`、`ourCostSource`，`ourPriceCad` 等其它键还在；库里的 `summaryJson` 不变（`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/pricing-helper-finance-db.isolated.test.ts`；`npx tsx src/lib/tender-pricing/__tests__/finance-view.test.ts`）

## MODIFIED Requirements

### Requirement: 保存只改人工输入
报价表助手以 `action: "save"` 保存时，系统 SHALL 只更新 `pricingInputs` 里的 `competitorPriceCad`、`ourCostCad`、`targetMarginPct`：请求里带了的项取请求的值（非负数字或 null），没带的项沿用原值。`pricingInputs` 里原有的其它键（报价引擎写的 `ourPriceCad`、`ourPrice`、`ourPriceCurrency`、`ourPriceSource`、`ourPriceStatus`、`ourPriceSupersededSource`，包括值为 null 的）SHALL 原样保留；`summaryJson` 里 `pricingInputs` 以外的键 SHALL NOT 受影响。原来没有 `pricingInputs` 时 SHALL 只写这三项。只存人工评分模型、不带 `inputs` 时，`pricingInputs` 的内容 SHALL 不变。没有财务查看权的人带我方成本保存按「没有财务查看权的人改不了成本」。

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
保存成功时系统 SHALL 返回 `{ ok: true, inputs, model }`，其中 `inputs` SHALL 只含三项人工输入、不含报价引擎镜像的键；GET 返回的 `inputs` 同样只含这三项；没有财务查看权时的 `ourCostCad`、`costHidden` 与 403 见「我方成本只给有财务查看权的人」「没有财务查看权的人改不了成本」。目标毛利不小于 100 时 SHALL 返回 400，项目没有投标调查室时 SHALL 返回 409，没有写权限时 SHALL 被拒绝；这几种情况 SHALL NOT 写库。

#### Scenario: 返回形状
- **WHEN** 已有权威报价镜像时保存
- **THEN** 返回的 `inputs` 只有 `competitorPriceCad`、`ourCostCad`、`targetMarginPct`；GET 的 `inputs` 也没有 `ourPriceCad`（`pricing-helper-save-db.isolated.test.ts`）

#### Scenario: 拒绝的保存不写库
- **WHEN** 目标毛利填 100；或只读成员保存；或项目没有投标调查室
- **THEN** 分别得到 400、403、409，房间的 `summaryJson` 与请求前相同（`pricing-helper-save-db.isolated.test.ts`）
