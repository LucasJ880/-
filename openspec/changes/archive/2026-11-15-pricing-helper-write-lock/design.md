# Design：报价表助手的写入与报价同步串行（FIX-9）

## Context

- 报价引擎写 `pricingInputs` 镜像的入口（`selectQuoteAsTenderBid`、`syncTenderBidPointerTx` 及取消 / 改价路径）都在事务里先 `lockProject`（`SELECT "id" FROM "Project" WHERE "id" = $1 FOR UPDATE`），再读房间、展开、写回。它们之间因此串行。
- 报价表助手（`src/app/api/projects/[id]/pricing-helper/route.ts`）的保存与推导不拿这把锁：路由开头读一次房间，算好整块，再 `update`。FIX-8 之后保存会展开原 `pricingInputs`，但展开的是**开头读到的**那份。
- 交错（本机隔离库强制复现）：同步拿锁、写房间、未提交 → 保存读房间（读到旧的已提交值）→ 保存的 `update` 等房间行锁 → 同步提交 → 保存写入旧报价。推导同理，且它的读在模型调用之前。
- 反过来（保存先写、同步后到）不会丢：同步拿锁之后才读房间，读到的是保存已提交的值；但如果同步在保存读之后、写之前读，就会把保存的输入冲掉——只有两边拿同一把锁才两头都安全。

## Goals / Non-Goals

**Goals**

- 报价表助手与报价引擎对 `summaryJson` 的读改写互斥，谁也不盖掉谁。
- 锁里不调模型，持锁时间只有一读一写。

**Non-Goals（具体到文件）**

- 不改报价引擎的写入（`src/lib/quote-engine/tender-bid.ts` 只加 `export`）。
- 不改 `summaryJson` 的其它写入方。
- 不改 GET。

## Decisions

### D1 复用报价引擎的项目行锁

导出 `lockProject`，路由在事务里先调它。用同一把锁才能与报价引擎互斥；房间行本身由 `update` 隐式加锁，但报价引擎在锁房间行之前就已经读了房间，单锁房间行挡不住「同步读旧值 → 等锁 → 写回旧输入」。

- 否决：锁房间行（`SELECT … FROM "BidIntelligenceRoom" … FOR UPDATE`）。报价引擎读房间时不锁它，仍会丢保存的输入。
- 否决：乐观并发（比较 `updatedAt` 再重试）。要改报价引擎一起比较，且重试逻辑比加锁复杂。
- 不涉及 FIX-4 的守卫：那条只禁止对 `Organization` 行取 `FOR UPDATE`。

### D2 锁住之后重读，再在最新值上算

保存的整块计算抽成纯函数 `buildSave(sj, body)`，在事务里对重读到的 `summaryJson` 调用；校验失败（400）时不写。推导的「已有人工模型就不覆盖」也在重读值上判断。房间在两次读之间被删时返回 409（与没有房间时相同）。

### D3 模型调用留在锁外

推导先在锁外拿到模型结果，再进事务只写推导时间与模型。持锁期间不做任何网络调用，不会因为模型慢而卡住报价同步。

### D4 FLOW-H2 的成本来源照原样，取数在锁外

FLOW-H2（#476）在保存里加了成本来源：请求带来源声明时取一次比价建议（`loadCompareCostSuggestionSafe`），交给 `nextCostSource` 核对。比价建议是读别的表，与房间无关，所以在锁外取；`nextCostSource` 用到的「上次的成本 / 来源」改为在锁住后重读的 `pricingInputs` 上取。原条件「有声明且本次成本不为空才用建议」保持不变（锁外按「有声明」取，锁里成本为空时不交给它）。`ourCostSource` 与三项人工输入一起写进 `pricingInputs`。

## Risks / Trade-offs

- 保存 / 推导会等正在进行的报价同步（毫秒级）；报价同步也会等它们（一读一写）。
- 同一项目的保存与同步不再并行。量级是人工点击，可忽略。

## Migration Plan

无数据迁移。
