## ADDED Requirements

### Requirement: 目标毛利只给有财务查看权的人
报价表助手 SHALL 用与「我方成本只给有财务查看权的人」相同的财务查看权判定决定谁能看目标毛利。没有财务查看权的人读取与保存成功时，返回的 `inputs.targetMarginPct` SHALL 为 `null`（不论库里存了什么、填没填），与 `inputs.ourCostCad` 共用 `costHidden: true` 一个标记；情景表 SHALL 按没有成本、没有目标毛利计算；响应的任何字段 SHALL NOT 含已保存的目标毛利，也 SHALL NOT 含由它算出的成本加成率。读取与不碰目标毛利的保存 SHALL NOT 改变库里的目标毛利。有财务查看权的人读取与保存的返回 SHALL 与改动前逐字节相同。

#### Scenario: 复现数据下没有财务查看权的人读取
- **WHEN** 房间存着对手价 100,000、我方成本 87,654.32、目标毛利 23.7、报价引擎镜像的我方报价 114,881.15（项目 `ourBidPrice` 同值）；只读成员、项目编辑者、没有财务键的 `org_admin`、只在分配范围持 `project.finance.read` 的投标同事分别读报价表助手
- **THEN** 都是 `inputs.targetMarginPct` 与 `inputs.ourCostCad` 为 `null`、带 `costHidden`，响应 JSON 里搜不到 `23.7` 与 `87654.32`（`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/target-margin-finance-db.isolated.test.ts`）

#### Scenario: 有财务查看权的人读取
- **WHEN** 同一项目的负责人、持组织范围 `project.finance.read` 的成员、平台超级管理员分别读取
- **THEN** 三人的 `inputs.targetMarginPct` 都是 23.7、结果逐字节相同，没有 `costHidden`（`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/target-margin-finance-db.isolated.test.ts`）

#### Scenario: 不泄露填没填
- **WHEN** 没有财务查看权：评分模型与对手价都有，成本与目标毛利都填了；或两项都没填；或只填了目标毛利
- **THEN** 三种情况的读取结果逐字节相同，情景与「成本、目标毛利都为 null」直接计算的结果相同，入参没被改；有财务查看权时结果与直接计算相同（`npx tsx src/lib/tender-pricing/__tests__/target-margin-finance-view.test.ts`）

#### Scenario: 由我方报价与目标毛利反推成本不再成立
- **WHEN** 复现数据下只读成员依次读调查室、项目列表、报价表助手与项目详情
- **THEN** 项目列表与项目详情照旧带 `ourBidPrice` 114,881.15，但四个响应里都没有目标毛利，整组响应里搜不到 `23.7` 与 `87654.32`（`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/target-margin-finance-db.isolated.test.ts`）

## MODIFIED Requirements

### Requirement: 保存只改人工输入
报价表助手以 `action: "save"` 保存时，系统 SHALL 只更新 `pricingInputs` 里的 `competitorPriceCad`、`ourCostCad`、`targetMarginPct`：请求里带了的项取请求的值（非负数字或 null），没带的项沿用原值。`pricingInputs` 里原有的其它键（报价引擎写的 `ourPriceCad`、`ourPrice`、`ourPriceCurrency`、`ourPriceSource`、`ourPriceStatus`、`ourPriceSupersededSource`，包括值为 null 的）SHALL 原样保留；`summaryJson` 里 `pricingInputs` 以外的键 SHALL NOT 受影响。原来没有 `pricingInputs` 时 SHALL 只写这三项。只存人工评分模型、不带 `inputs` 时，`pricingInputs` 的内容 SHALL 不变。没有财务查看权的人带我方成本、成本来源或目标毛利保存按「没有财务查看权的人改不了成本」。

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
保存成功时系统 SHALL 返回 `{ ok: true, inputs, model }`，其中 `inputs` SHALL 只含三项人工输入、不含报价引擎镜像的键；GET 返回的 `inputs` 同样只含这三项；没有财务查看权时的 `ourCostCad`、`targetMarginPct`、`costHidden` 与 403 见「我方成本只给有财务查看权的人」「目标毛利只给有财务查看权的人」「没有财务查看权的人改不了成本」。目标毛利不小于 100 时 SHALL 返回 400，项目没有投标调查室时 SHALL 返回 409，没有写权限时 SHALL 被拒绝；这几种情况 SHALL NOT 写库。

#### Scenario: 返回形状
- **WHEN** 已有权威报价镜像时保存
- **THEN** 返回的 `inputs` 只有 `competitorPriceCad`、`ourCostCad`、`targetMarginPct`；GET 的 `inputs` 也没有 `ourPriceCad`（`pricing-helper-save-db.isolated.test.ts`）

#### Scenario: 拒绝的保存不写库
- **WHEN** 目标毛利填 100；或只读成员保存；或项目没有投标调查室
- **THEN** 分别得到 400、403、409，房间的 `summaryJson` 与请求前相同（`pricing-helper-save-db.isolated.test.ts`）

### Requirement: 没有财务查看权的人改不了成本
没有财务查看权的人保存时，请求的 `inputs` 里有 `ourCostCad` 或 `targetMarginPct` 这个键（不论值），或请求带了 `ourCostSource` 这个键，系统 SHALL 返回 403「没有保存：需要财务查看权才能修改我方成本和目标毛利。请刷新页面，重新填写后再保存。」且 SHALL NOT 写库；判定顺序 SHALL 是项目没有投标调查室 409、再财务 403、再目标毛利不小于 100 的 400。不碰这三个键的保存 SHALL 照常，已保存的成本、来源与目标毛利 SHALL 原样保留，返回的 `inputs.ourCostCad` 与 `inputs.targetMarginPct` SHALL 为 `null` 并带 `costHidden: true`、SHALL NOT 带 `ourCostSource`。重新推导评分模型 SHALL NOT 做财务判定。`inputs` 不是对象时 SHALL 当作没带。

#### Scenario: 没有财务查看权的编辑者保存
- **WHEN** 能编辑项目、没有财务键的成员保存时带了 `ourCostCad`；又带了 `ourCostSource: null`；又带了 `targetMarginPct`（数字与 `null` 各一次）；再只带对手价
- **THEN** 前四次 403 与那句话、房间的 `summaryJson` 不变；最后一次成功，成本、来源与目标毛利保留，返回的 `inputs.ourCostCad` 与 `inputs.targetMarginPct` 为 `null`、没有 `ourCostSource`（`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/target-margin-finance-db.isolated.test.ts`；`npx tsx src/lib/tender-pricing/__tests__/target-margin-finance-view.test.ts`）

#### Scenario: 上线前打开的旧卡片
- **WHEN** 没有财务查看权的编辑者用上线前打开的卡片保存（旧卡片每次都带目标毛利）
- **THEN** 403，那句话叫他刷新页面，库不变；刷新后的卡片保存只带对手价，成功（`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/target-margin-finance-db.isolated.test.ts`）

#### Scenario: 判定顺序
- **WHEN** 没有投标调查室时编辑者带目标毛利保存；编辑者带目标毛利 100；能编辑项目、持组织范围 `project.finance.read` 的成员带目标毛利 100
- **THEN** 依次 409、403、400（`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/target-margin-finance-db.isolated.test.ts`；重新推导在财务判定之前返回：`npx tsx src/lib/tender-pricing/__tests__/finance-view.test.ts` 源码断言）

### Requirement: 卡片上没有财务查看权时的显示
读取结果带 `costHidden` 时，卡片 SHALL 以「需要财务查看权才能看我方成本。」代替「我方成本」输入框、以「需要财务查看权才能看目标毛利。」代替目标毛利输入框，SHALL NOT 显示毛利一栏与成本加成提示，保存请求 SHALL NOT 带 `ourCostCad` 与 `targetMarginPct`；有情景结果时 SHALL 在情景表上方写假设说明里那一句加「只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。」，假设说明列表里 SHALL NOT 重复那一句。保存被拒（403）时 SHALL 用醒目的错误样式写出那句话、并保留表单里刚填的值。

#### Scenario: 卡片
- **WHEN** 读取结果带 `costHidden`，人改了对手价后保存被拒
- **THEN** 卡上没有成本与目标毛利输入框、没有毛利一栏与成本加成提示，也没有「目标毛利只用于按成本算的底价情景；你这里改了，情景表不会变。」；保存请求不带 `ourCostCad` 与 `targetMarginPct`；被拒后红字写那句话、对手价仍是刚填的（`npx tsx src/lib/tender-pricing/__tests__/target-margin-finance-view.test.ts` 源码断言）

#### Scenario: 有财务查看权时卡片照旧
- **WHEN** 读取结果不带 `costHidden`
- **THEN** 成本与目标毛利输入框、毛利一栏、开关开着时的「目标毛利率 %（按售价）」与成本加成提示都与改动前相同（`npx tsx src/lib/tender-pricing/__tests__/compare-cost-source.test.tsx`；`npx tsx src/lib/tender-pricing/__tests__/target-margin-finance-view.test.ts` 源码断言）

### Requirement: 没有财务查看权时不带出的内容
对没有财务查看权的人，报价表助手的读取与保存返回 SHALL NOT 含已保存的我方成本、已保存的目标毛利、比价矩阵算出的落地价及其逐项金额、已记成本来源里的落地价、「矩阵变了」的提示，也 SHALL NOT 含能由价格与目标毛利反推成本的情景、成本加成率或其它数字。

#### Scenario: 响应里搜不到成本数字
- **WHEN** 开关开着、比价矩阵有选定（落地价是一个少见的数）、已保存成本带来源、目标毛利是一个少见的数；没有财务键的项目编辑者读取一次、只带对手价保存一次
- **THEN** 两次响应的 JSON 里都没有 `compareCost`、`ourCostSource`，也搜不到成本、落地价与目标毛利的数字（`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/pricing-helper-finance-db.isolated.test.ts`；`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/target-margin-finance-db.isolated.test.ts`）

### Requirement: 调查室 JSON 不带出我方成本
`GET /api/projects` 返回的每个项目的 `intelligenceRoom.summaryJson`、`GET /api/projects/{项目}/bid-intelligence` 返回的 `room.summaryJson`，对任何人 SHALL NOT 含 `pricingInputs`（报价表助手存的对手价、我方成本、目标毛利、成本来源与报价引擎镜像的我方报价都在里面），也 SHALL NOT 含投标策略备忘 `bidStrategyMemo`（它由含成本与毛利的情景写成）；`summaryJson` 的其它内容 SHALL 原样返回；SHALL NOT 改库。报价表助手的输入只经报价表助手接口按财务查看权给出；投标策略备忘在其它地方的显示不在本条范围。

#### Scenario: 两个接口
- **WHEN** 房间里存着成本、目标毛利 23.7、成本来源、投标策略备忘、报价引擎镜像的我方报价、评分模型与 `majorBlockers`；只读成员与项目负责人各读一次项目列表与调查室
- **THEN** 四次的 `summaryJson` 都没有 `pricingInputs` 与 `bidStrategyMemo`，`pricingModel`、`majorBlockers` 等其它键还在；库里的 `summaryJson` 不变（`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/target-margin-finance-db.isolated.test.ts`）

#### Scenario: 裁剪是纯的
- **WHEN** 房间 JSON 有 `pricingInputs` 与备忘；或两者都没有；或不是对象、是 `null`
- **THEN** 第一种返回去掉这两个键的副本、入参不变；后两种原样返回同一个值（`npx tsx src/lib/tender-pricing/__tests__/target-margin-finance-view.test.ts`）
