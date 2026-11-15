# Proposal：报价表助手的保存与推导和报价引擎串行，不再写回旧的我方报价

TASKFLOW：FIX-9（Phase F 续，接 FIX-8）
来源：Lucas 2026-11-15 任务（FIX-8 design.md「Risks / 并发」列为另开 change 的那一条）。
前置：FIX-8（change `pricing-helper-save-keeps-bid-mirror`，分支 `claude/lucid-cray-kndw66`）。本 change 叠在它上面，归档时须在它之后。

## Why

`POST /api/projects/{id}/pricing-helper` 的 `save` 与 `derive` 都是不加锁地「读房间 → 改 → 整块写回 `summaryJson`」，而报价引擎在项目行 `FOR UPDATE` 下把我方报价镜像进同一个 `summaryJson.pricingInputs`；报价同步恰好在路由的读与写之间提交时，路由会把读到的旧镜像（价格、来源、改价待定状态）原样写回，投标草稿读到的就是已被替代的报价。`derive` 的读与写之间隔着一次模型调用（数秒），窗口比 `save` 大得多，而且同一窗口里人保存的评分模型、三项人工输入也会被它冲掉。

## What Changes

- 导出报价引擎已有的项目行锁 `lockProject`（`src/lib/quote-engine/tender-bid.ts`，`SELECT "id" FROM "Project" WHERE "id" = $1 FOR UPDATE`），不复制 SQL、不改它的锁模式。
- 把 `save` 的「读房间 → 校验 → 合并 → 写回」整段放进 `db.$transaction`：先取项目行锁，再在事务内读房间，之后的合并规则与 FIX-8 相同（展开原 `pricingInputs`，只覆盖三项人工输入）。
- 把 `derive` 的写入放进同样的事务：模型调用仍在事务外（不在持锁期间调模型），事务内先取项目行锁、重读房间，只改它自己的两个键（`pricingDerivedAt`、`pricingModel`），「人工模型不被自动推导覆盖」按事务内重读到的模型判断，返回的 `model` / `keptHumanOverride` 也按重读结果给出。
- 保持请求与返回形状、校验与状态码（400 / 403 / 404 / 409 / 429）不变；拒绝的请求照旧不写库。
- 新增隔离库测试：在一个持有项目行锁、已执行 `writeBidMirrorsTx`（或 `writePendingMirrorsTx`）但未提交的事务期间并发发起 `save` / `derive`，确认路由已被该事务挡住后再提交，断言最终 `pricingInputs` 同时有新的人工输入与新的镜像报价；在改动之前的代码上失败。
- 给 `pricing-helper.test.ts` 补一条结构守卫：两条写路径都在事务内先取项目行锁、经事务客户端写房间，路由里不再有 `db.bidIntelligenceRoom.update`。

## 受影响的 Muse 意图

无。不改 `src/lib/muse-bridge/` 下任何文件；`price_scenario` 只读同一份上下文，不写。

## Out of scope

- `BidIntelligenceRoom.summaryJson` 的其它写入方（`tender-intel/orchestrate.ts`、`tender-intel/watch.ts`、`tender-auto-analysis/project-room.ts`、`tender-analyst-memo/v2/pipeline.ts`、`projects/generate/generate-docs.ts`、`external-intel/award-history`、`tender-watch` 路由、`bid-workflow/*`、`tender-bid-workspace/store.ts`）：它们同样是整块写回、多数不锁项目行，与报价引擎之间的同类竞争本次不修，另开 change。
- 报价引擎本身：不改 `writeBidMirrorsTx` / `clearRoomPriceMirrorsTx` / `syncTenderBidPointerTx` / `selectQuoteAsTenderBid` 的行为与锁模式（`lockProject` 只加 `export`）。
- `derive` 的频控：60 秒窗口仍按事务外第一次读到的 `pricingDerivedAt` 判断（两次几乎同时的推导仍可能都调模型），不改。
- GET、投标草稿读取、`price_scenario`：不改。
- 不新增任何队列、锁表、租约或注册表；只是事务里的一次行锁，与报价引擎相同。
- schema 变更、模型调用次数、对外动作、新开关：没有。**没有开关，合并即生效。**

## Capabilities

### New Capabilities

- `tender/pricing-helper`：报价表助手的保存与推导和报价引擎写 `pricingInputs` 镜像互相串行，后提交的一方基于先提交的结果改写，不写回旧值。（能力路径与 FIX-8 相同；FIX-8 归档后本 change 的需求追加到同一份规格。）

### Modified Capabilities

无（`tender/pricing-helper` 尚未归档进 `openspec/specs/`）。

## Impact

- 代码：`src/app/api/projects/[id]/pricing-helper/route.ts`（POST 两个分支）、`src/lib/quote-engine/tender-bid.ts`（`lockProject` 加 `export`）。
- 测试：新增 `src/lib/tender-pricing/__tests__/pricing-helper-lock-db.isolated.test.ts`（注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`）；`src/lib/tender-pricing/__tests__/pricing-helper.test.ts` 加一条守卫。
- 运行时：`save` / `derive` 写入时会等报价引擎正在进行的同项目事务提交（通常毫秒级）；持锁期间不调模型、不发请求。
- 文档：TASKFLOW 加 FIX-9 一行（`[~]`）。
