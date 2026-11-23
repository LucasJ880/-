# tender/pricing-helper Specification

## Purpose
规定报价表助手保存人工输入时怎样写 `BidIntelligenceRoom.summaryJson.pricingInputs`：只改竞品价、我方成本、目标毛利三项，同一对象里报价引擎镜像的权威报价原样保留。计算结果是假设驱动的情景，不调模型、不对外发送。

## Requirements

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

### Requirement: 写入与报价同步串行
报价表助手保存（`action: "save"`）与重新推导（`action: "derive"`）写 `BidIntelligenceRoom.summaryJson` 时，系统 SHALL 在一个事务里先取得报价引擎写镜像时使用的同一把项目行锁，再读取库里最新的 `summaryJson`，只在它上面改自己的键（保存：三项人工输入与可选的人工评分模型；推导：推导时间与非人工的模型），并在同一事务里写回。报价同步正在进行（已持锁、未提交）时，保存与推导 SHALL 等它提交之后再读，结果里 SHALL 同时有同步写的我方报价与这次写入的值。推导的模型调用 SHALL NOT 在持锁期间进行。是否保留人工评分模型 SHALL 按锁住之后读到的值判断。校验失败的保存 SHALL NOT 写库。

#### Scenario: 保存时报价同步未提交
- **WHEN** 报价同步在项目行锁下把新报价写进 `pricingInputs`、尚未提交，这期间保存三项新输入，然后同步提交
- **THEN** 保存在同步提交之后才返回；`pricingInputs` 的 `ourPriceCad` / `ourPriceSource` 是同步写的新报价，三项人工输入是这次保存的值，`summaryJson` 的其它键不变（`npx tsx src/lib/tender-pricing/__tests__/pricing-helper-lock-db.isolated.test.ts`）

#### Scenario: 只改一项或只存模型时报价同步未提交
- **WHEN** 同样的交错下只保存目标毛利，或只保存人工评分模型
- **THEN** 没带的输入沿用库里的值，模型照常写入，镜像是同步写的新报价（`pricing-helper-lock-db.isolated.test.ts`）

#### Scenario: 推导时报价同步未提交
- **WHEN** 同样的交错下重新推导
- **THEN** 推导时间写入，镜像是同步写的新报价，人工输入不变（`pricing-helper-lock-db.isolated.test.ts`）

#### Scenario: 拒绝的保存
- **WHEN** 同样的交错下保存目标毛利 100
- **THEN** 返回 400，库里只有同步写的变化（`pricing-helper-lock-db.isolated.test.ts`）

#### Scenario: 已有人工模型时推导
- **WHEN** 房间里已有人工评分模型，重新推导
- **THEN** 人工模型保留，返回 `keptHumanOverride: true`；60 秒内再推导返回 429（`pricing-helper-lock-db.isolated.test.ts`）

### Requirement: 我方成本只给有财务查看权的人
报价表助手 SHALL 按与成本核算相同的财务查看权判定：平台超级管理员、持组织范围 `project.finance.manage` 或 `project.finance.read` 的人、项目负责人；项目没有组织或判定出错时 SHALL 只认负责人与平台超级管理员。没有财务查看权的人读取时：`inputs.ourCostCad` SHALL 为 `null` 并带 `costHidden: true`；开关开着时 SHALL 只带 `compareCostHidden: true`、不带成本建议，也 SHALL NOT 去取比价建议；情景表 SHALL 按没有成本计算；有情景结果时假设说明 SHALL 不含「未填我方成本」那句、SHALL 写「需要财务查看权才能看我方成本；毛利一栏和「成本 + 目标毛利」「成本价」两种情景也不显示。」。有财务查看权的人 SHALL 与以前相同。

#### Scenario: 没有财务查看权的人读取
- **WHEN** 已保存对手价 100,000、成本 91,234.56、目标毛利 15%，开关开着、比价矩阵有选定；只读成员、项目编辑者、`org_admin`、只在分配范围持 `project.finance.read` 的投标同事分别读取
- **THEN** 都是 `inputs.ourCostCad` 为 `null`、`costHidden`、`compareCostHidden`，没有 `compareCost`，情景里没有毛利、没有成本底价情景，假设说明有那一句（`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/pricing-helper-finance-db.isolated.test.ts`；`npx tsx src/lib/tender-pricing/__tests__/finance-view.test.ts`）

#### Scenario: 有财务查看权的人读取
- **WHEN** 项目负责人、持组织范围 `project.finance.read` 的成员、平台超级管理员分别读取
- **THEN** 三人的结果逐字节相同，带成本、带比价矩阵的落地价建议，没有 `costHidden`（`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/pricing-helper-finance-db.isolated.test.ts`）

#### Scenario: 判定出错与项目没有组织
- **WHEN** 财务判定抛错；或项目没有组织
- **THEN** 项目负责人与平台超级管理员仍看得到，其余人看不到；没有组织时不调用判定（`npx tsx src/lib/tender-pricing/__tests__/finance-view.test.ts`）

### Requirement: 没有财务查看权的人改不了成本
没有财务查看权的人保存时，请求的 `inputs` 里有 `ourCostCad` 这个键（不论值）或请求带了 `ourCostSource` 这个键，系统 SHALL 返回 403「没有保存：需要财务查看权才能修改我方成本。请刷新页面，重新填写后再保存。」且 SHALL NOT 写库；判定顺序 SHALL 是项目没有投标调查室 409、再财务 403、再目标毛利不小于 100 的 400。不碰成本的保存 SHALL 照常，已保存的成本与来源 SHALL 原样保留，返回的 `inputs.ourCostCad` SHALL 为 `null` 并带 `costHidden: true`、SHALL NOT 带 `ourCostSource`。重新推导评分模型 SHALL NOT 做财务判定。`inputs` 不是对象时 SHALL 当作没带。

#### Scenario: 没有财务查看权的编辑者保存
- **WHEN** 能编辑项目、没有财务键的成员保存时带了 `ourCostCad`；又带了 `ourCostSource: null`；再只带对手价
- **THEN** 前两次 403 与那句话、房间的 `summaryJson` 不变；第三次成功，成本与来源保留，返回的 `inputs.ourCostCad` 为 `null`、没有 `ourCostSource`（`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/pricing-helper-finance-db.isolated.test.ts`；`npx tsx src/lib/tender-pricing/__tests__/finance-view.test.ts`）

#### Scenario: 判定顺序
- **WHEN** 没有投标调查室时带成本保存；编辑者带成本且目标毛利 100；编辑者不带成本、目标毛利 100
- **THEN** 依次 409、403、400（`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/pricing-helper-finance-db.isolated.test.ts`；重新推导在财务判定之前返回：`npx tsx src/lib/tender-pricing/__tests__/finance-view.test.ts` 源码断言）

### Requirement: 卡片上没有财务查看权时的显示
读取结果带 `costHidden` 时，卡片 SHALL 以「需要财务查看权才能看我方成本。」代替「我方成本」输入框，SHALL NOT 显示毛利一栏，保存请求 SHALL NOT 带 `ourCostCad`；有情景结果时 SHALL 在情景表上方写假设说明里那一句加「只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。」，假设说明列表里 SHALL NOT 重复那一句；目标毛利下面 SHALL 写「目标毛利只用于按成本算的底价情景；你这里改了，情景表不会变。」；目标毛利的写法与成本加成提示照旧。保存被拒（403）时 SHALL 用醒目的错误样式写出那句话、并保留表单里刚填的值。

#### Scenario: 卡片
- **WHEN** 读取结果带 `costHidden`，人改了对手价后保存被拒
- **THEN** 卡上是上面几句话、没有成本输入框与毛利一栏，保存请求不带 `ourCostCad`，被拒后红字写那句话、对手价仍是刚填的（`npx tsx src/lib/tender-pricing/__tests__/finance-view.test.ts` 源码断言；目标毛利写法：`npx tsx src/lib/tender-pricing/__tests__/compare-cost-source.test.tsx`）

### Requirement: 没有财务查看权时不带出的内容
对没有财务查看权的人，报价表助手的读取与保存返回 SHALL NOT 含已保存的我方成本、比价矩阵算出的落地价及其逐项金额、已记成本来源里的落地价、「矩阵变了」的提示，也 SHALL NOT 含能由价格与目标毛利反推成本的情景。

#### Scenario: 响应里搜不到成本数字
- **WHEN** 开关开着、比价矩阵有选定（落地价是一个少见的数）、已保存成本带来源；没有财务键的项目编辑者读取一次、只带对手价保存一次
- **THEN** 两次响应的 JSON 里都没有 `compareCost`、`ourCostSource`，也搜不到成本与落地价的数字（`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/pricing-helper-finance-db.isolated.test.ts`）

### Requirement: 调查室 JSON 不带出我方成本
`GET /api/projects` 返回的每个项目的 `intelligenceRoom.summaryJson`、`GET /api/projects/{项目}/bid-intelligence` 返回的 `room.summaryJson`，对任何人 SHALL NOT 含 `pricingInputs.ourCostCad`、`pricingInputs.ourCostSource`，也 SHALL NOT 含投标策略备忘 `bidStrategyMemo`（它由含成本与毛利的情景写成）；`summaryJson` 的其它内容 SHALL 原样返回；SHALL NOT 改库。投标策略备忘在其它地方的显示不在本条范围。

#### Scenario: 两个接口
- **WHEN** 房间里存着成本与来源、投标策略备忘、报价引擎镜像的我方报价；只读成员与项目负责人读项目列表，项目负责人读调查室
- **THEN** 三次的 `summaryJson` 都没有成本、来源与投标策略备忘，`ourPriceCad`、`majorBlockers` 等其它键还在；库里的 `summaryJson` 不变（`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/pricing-helper-finance-db.isolated.test.ts`；`npx tsx src/lib/tender-pricing/__tests__/finance-view.test.ts`）
