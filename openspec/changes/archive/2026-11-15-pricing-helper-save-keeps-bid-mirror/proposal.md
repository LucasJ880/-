# Proposal：报价表助手保存不再冲掉报价引擎镜像的我方报价

TASKFLOW：FIX-8（Phase F 续）
来源：Lucas 2026-11-15 任务（报价表助手 save 整块替换 `pricingInputs`）。

## Why

`POST /api/projects/{id}/pricing-helper` 的 `action: "save"` 只拼出三项人工输入（竞品价、我方成本、目标毛利），然后把 `BidIntelligenceRoom.summaryJson.pricingInputs` 整块换成它。可报价引擎（`src/lib/quote-engine/tender-bid.ts` 的 `writeBidMirrorsTx` / `clearRoomPriceMirrorsTx`）把权威报价也镜像在同一个对象里：`ourPriceCad`、`ourPrice`、`ourPriceCurrency`、`ourPriceSource`、`ourPriceStatus`、`ourPriceSupersededSource`。投标草稿（`src/lib/tender-bid-draft/gather.ts`）从这里读「我方报价」。

结果：报价表卡片上每点一次保存，镜像的我方报价就悄悄没了，直到下一次报价同步；这期间投标草稿里看不到我方报价，「改价待定」的状态也一并丢掉。

## What Changes

- 保存时先展开原来的 `pricingInputs`，再只覆盖三项人工输入（以后加的人工字段如 `ourCostSource` 同理，只要它在 `inputs` 里）；报价引擎写的键原样保留。
- 返回形状不变：`{ ok, inputs, model }`，`inputs` 仍只有三项人工输入；GET 不变。
- 新增隔离库测试：用报价引擎本身的写穿函数镜像报价，再调真实路由保存，断言镜像键还在、三项输入已更新；在改动之前的代码上失败。

## 受影响的 Muse 意图

无。不改 `src/lib/muse-bridge/` 下任何文件。

## Out of scope

- 保存与报价同步之间的并发：保存路径仍是「读整块、写整块」，不加锁（与 `derive` 分支、改动前相同）；报价同步恰好落在读与写之间时仍可能被旧值盖住。要不要让保存也锁项目行，另开 change。
- `derive` 分支：它本来就展开整个 `summaryJson` 且不碰 `pricingInputs`，不改。
- 报价引擎、投标草稿的读取：不改。
- schema 变更、模型调用、对外动作、新开关：没有。**没有开关，合并即生效。**

## Capabilities

### New Capabilities

- `tender/pricing-helper`：报价表助手保存人工输入时只改自己的三项，不动同一对象里报价引擎镜像的权威报价。

### Modified Capabilities

无。
