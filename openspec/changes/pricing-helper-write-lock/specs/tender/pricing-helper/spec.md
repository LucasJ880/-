## ADDED Requirements

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
