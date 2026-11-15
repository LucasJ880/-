# Design：报价表助手保存不再冲掉报价引擎镜像的我方报价（FIX-8）

## Context

- `BidIntelligenceRoom.summaryJson.pricingInputs` 有两个写入方：
  - 报价表助手（`src/app/api/projects/[id]/pricing-helper/route.ts`，`action: "save"`）：三项人工输入 `competitorPriceCad` / `ourCostCad` / `targetMarginPct`。
  - 报价引擎（`src/lib/quote-engine/tender-bid.ts`）：`writeBidMirrorsTx` 写 `ourPriceCad` / `ourPrice` / `ourPriceCurrency` / `ourPriceSource` / `ourPriceStatus`；`clearRoomPriceMirrorsTx`（经 `clearBidMirrorsTx` / `writePendingMirrorsTx`）把它们清成 null 并写 `ourPriceStatus`（`NONE` / `QUOTE_REVISION_PENDING`）与 `ourPriceSupersededSource`。两者都先展开原有键（`{ ...pi, … }`），不碰人工输入。
- 报价表助手的保存写的是 `{ ...sj, pricingInputs: inputs }`——整块替换，把报价引擎的键全删了。
- 读方：投标草稿 `src/lib/tender-bid-draft/gather.ts` 读 `pricingInputs.ourPriceCad`；报价表助手 GET 只读三项人工输入。

## Goals / Non-Goals

**Goals**

- 保存人工输入后，报价引擎镜像的键（含值为 null 的）原样留在 `pricingInputs` 里。
- 对外行为（请求、返回、校验、权限）与改动前相同。

**Non-Goals（具体到文件）**

- 不改 `src/lib/quote-engine/tender-bid.ts`、`src/lib/tender-bid-draft/gather.ts`。
- 不给保存路径加锁或事务（见 Risks）。
- 不改 `derive` 分支。

## Decisions

### D1 展开原对象再覆盖人工输入

`pricingInputs = { ...prevPi, ...inputs }`。`prevPi` 是原来的 `pricingInputs`，不是对象（缺失、数组、标量）时当作空对象。`inputs` 仍按原来的规则逐项算出（请求里带了就用请求的，没带就沿用原值），所以覆盖它只会改这三项。

- 否决：只白名单保留报价引擎那六个键。以后谁再往这个对象里加键（例如成本来源 `ourCostSource`），又会被删一次；展开原对象对所有写入方都成立。
- 否决：把人工输入挪到另一个键。零 schema 的前提下也能做，但要改 GET、投标草稿和既有数据，超出修复范围。

### D2 返回形状不变

返回的 `inputs` 仍是三项人工输入（算出来的 `inputs`），不是写进库的合并对象，免得前端突然收到报价引擎的字段。

## Risks / Trade-offs

- **并发**：保存仍是「读 → 改 → 写」且不锁行；报价引擎在项目行 `FOR UPDATE` 下写。报价同步恰好在保存的读与写之间提交时，保存会把镜像写回读到的旧值（改动前是删掉）。窗口是一次请求内的毫秒级，且下一次报价同步会再写正确值。消除它要让保存也在事务里锁项目行，属于另一个 change（proposal Out of scope 已列）。

## Migration Plan

无数据迁移。已经被删掉镜像的房间，在下一次报价同步（选标、改价、取消）时恢复，与改动前相同。
