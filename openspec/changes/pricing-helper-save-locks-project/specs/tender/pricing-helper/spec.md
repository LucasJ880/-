# Spec Delta

## Purpose
规定报价表助手保存人工输入、推导评分模型时怎样写 `BidIntelligenceRoom.summaryJson`：只改自己的键，并与报价引擎写入我方报价镜像互相串行，谁后提交谁就基于对方已提交的结果改写，不把读到的旧值写回。

## ADDED Requirements

### Requirement: 保存与报价引擎串行
报价表助手以 `action: "save"` 保存时，系统 SHALL 与报价引擎对同一项目写入 `pricingInputs` 镜像（选为我方报价、报价状态迁移后的指针同步、清空、改价待定）互相串行：报价引擎的写入尚未提交时，保存 SHALL 等它提交后再读取房间并合并，合并规则与「保存只改人工输入」相同。保存完成后，`pricingInputs` SHALL 同时含有本次保存的人工输入与报价引擎最后一次提交的镜像值；保存 SHALL NOT 把它开始前读到的旧镜像值写回。

#### Scenario: 报价同步进行中保存三项输入
- **WHEN** 报价引擎正在把一份新的 CAD 报价镜像进 `pricingInputs`（已写未提交），此时在报价表卡片上保存三项新输入，随后报价引擎提交
- **THEN** 保存返回 200，`pricingInputs` 的三项人工输入是新值，`ourPriceCad` / `ourPrice` / `ourPriceSource` / `ourPriceStatus` 是报价引擎这次提交的新值，不是保存前的旧值（`npx tsx src/lib/tender-pricing/__tests__/pricing-helper-lock-db.isolated.test.ts`）

#### Scenario: 改价待定进行中保存
- **WHEN** 报价引擎正在把镜像改成改价待定（已写未提交），此时保存目标毛利，随后报价引擎提交
- **THEN** `ourPriceStatus = QUOTE_REVISION_PENDING`、`ourPriceSupersededSource` 指向被替代的报价、`ourPriceCad` 为 null，目标毛利是新值（`pricing-helper-lock-db.isolated.test.ts`）

#### Scenario: 拒绝的保存照旧不写库
- **WHEN** 报价引擎正在写镜像时提交一个目标毛利为 100 的保存，随后报价引擎提交
- **THEN** 保存返回 400，房间内容等于报价引擎提交后的内容（`pricing-helper-lock-db.isolated.test.ts`）

### Requirement: 推导与报价引擎串行
报价表助手以 `action: "derive"` 推导评分模型时，系统 SHALL 在模型调用结束之后、写入之前与报价引擎串行并重新读取房间，只改写 `pricingDerivedAt` 与（允许时）`pricingModel` 两个键；`pricingInputs` 与 `summaryJson` 里其它键 SHALL 保持写入那一刻的已提交值。是否保留人工评分模型 SHALL 按重新读取到的 `pricingModel` 判断：那时已是人工模型则不覆盖，返回 `keptHumanOverride: true` 与该人工模型。等待报价引擎提交期间系统 SHALL NOT 调用模型。

#### Scenario: 报价同步进行中推导
- **WHEN** 推导已读过房间，报价引擎此时正在镜像一份新报价（已写未提交），随后报价引擎提交
- **THEN** 推导返回 200，`pricingDerivedAt` 已更新，`pricingInputs` 里的人工输入保留、镜像是报价引擎这次提交的新值（`pricing-helper-lock-db.isolated.test.ts`）

#### Scenario: 推导期间有人存了人工模型
- **WHEN** 推导已读过房间（当时没有人工模型），另一个持有项目行锁的写入正在把人工评分模型写进房间（已写未提交），随后它提交
- **THEN** 推导返回 `keptHumanOverride: true`，返回的 `model` 与房间里的 `pricingModel` 都是那份人工模型（`pricing-helper-lock-db.isolated.test.ts`）

### Requirement: 串行不改变对外行为
保存与推导的请求体、返回形状与状态码 SHALL 与改动前相同：保存返回 `{ ok, inputs, model }`，推导返回 `{ ok, via, model, keptHumanOverride }`；目标毛利不小于 100 或价格权重越界返回 400，没有写权限被拒绝，没有已完成分析的推导返回 404，项目没有投标调查室返回 409，60 秒内重复推导返回 429，这些情况 SHALL NOT 写库。两种返回都 SHALL NOT 含报价引擎镜像的键（`ourPriceCad`、`ourPrice`、`ourPriceCurrency`、`ourPriceSource`、`ourPriceStatus`、`ourPriceSupersededSource`）。

#### Scenario: 等锁后的返回形状
- **WHEN** 报价引擎写镜像期间发起的保存在报价引擎提交后完成
- **THEN** 返回的 `inputs` 只有 `competitorPriceCad`、`ourCostCad`、`targetMarginPct`（`pricing-helper-lock-db.isolated.test.ts`）

#### Scenario: 既有行为不变
- **WHEN** 没有并发写入时依次保存、只改一项、只存模型、清空一项、只读成员保存、目标毛利填 100、没有投标调查室
- **THEN** 结果与 FIX-8 的约定相同（`npx tsx src/lib/tender-pricing/__tests__/pricing-helper-save-db.isolated.test.ts` 全部通过）

#### Scenario: 推导的拒绝路径不写库
- **WHEN** 60 秒内第二次推导；或没有已完成分析时推导
- **THEN** 分别返回 429、404，房间的 `summaryJson` 与请求前相同（`pricing-helper-lock-db.isolated.test.ts`）
