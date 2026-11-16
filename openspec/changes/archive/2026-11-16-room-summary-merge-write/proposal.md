# Proposal：分析投影与开始调查不再整块替换调查室 summaryJson

TASKFLOW：FIX-10（Phase F 续，接 FIX-8 / FIX-9）
来源：FIX-9 交接（`docs/QINGYAN_TENDER_FLOW_HANDOFF.md` §0.5e 第 1 条「summaryJson 的其它写入方还没有拿这把锁」）的只读排查；Lucas 2026-11-16「继续按推荐的做下一项」。

## Why

`BidIntelligenceRoom.summaryJson` 是好几个功能共用的一个 JSON 位：报价表助手的人工输入与报价模型、报价引擎镜像的我方报价（`pricingInputs.ourPrice*`）、投标工作区的价格表与补遗（`bidWorkspace`）、跟标（`tenderWatch`）、外部情报等。排查发现两处写入把它**整块换掉**：

1. **分析投影**（`src/lib/tender-auto-analysis/project-room.ts`，每次分析跑完的 `PROJECT_ROOM` 一步）写的是「这次分析的摘要 + `projectedFromRunId`」，别的键全部丢掉。也就是说，**每来一份补遗、每重新分析一次，人工填的报价输入、镜像的我方报价、投标工作区里录好的价格表都会被清空**（本机隔离库复现：投影之后房间只剩 `projectName`、`projectedFromRunId`）。
2. **开始投标调查**（`src/lib/bid-workflow/start-intelligence.ts`）在房间已经存在、但还没有摘要时（投标工作区或报价表助手先建了房间），把 `summaryJson` 整块换成初始摘要，同样冲掉别的键。

两处都不拿项目行锁，与报价引擎（FIX-9 已对齐报价表助手）之间也会互相覆盖。

## What Changes

- 新增写入入口 `src/lib/tender-room/summary-json.ts`：`patchRoomSummary` / `patchRoomSummaryTx`——事务里先拿报价引擎用的同一把项目行锁（`lockProject`），再重读最新的 `summaryJson`，只设 / 只去掉调用方给出的键，其余原样保留；不提供整块替换。
- 分析投影改用它：设这次分析摘要里的键、`projectedFromRunId`，并记下这次写了哪些键（`projectedKeys`）；下一次投影只去掉「上一次投影记下的、这一次没有的」分析键。别的功能的键一概不碰。改动前投影过的房间没有记录，只覆盖、不去掉。
- 开始投标调查在已有房间、还没有摘要时改用它：只设初始摘要的键。新建房间的路径不变。
- 摘要文字、状态、模块投影、不改 GO 决定等其余行为不变。
- 新增测试：纯函数与接线（CI 里跑）；隔离库测试（重新分析、与报价同步交错、开始调查沿用已有房间），在改动之前的代码上失败。

## 受影响的 Muse 意图

无。不改 `src/lib/muse-bridge/` 下任何文件。

## Out of scope

- `summaryJson` 的其它写入方（外部情报 award-history / orchestrate、跟标 tender-watch / watch、投标草稿 generate、分析备忘 pipeline、投标工作区 store）：它们是「读整块 → 展开 → 写回」，只在并发时丢别人的键，下一个 change（FIX-11）统一改走这个入口，并加守卫测试拦住新的绕开写法。
- 已经被清空的房间不补数据：丢掉的输入要人重新填；镜像的我方报价在下一次报价同步时恢复。
- schema 变更、新的锁表 / 队列、模型调用、对外动作、新开关：没有。**没有开关，合并即生效。**

## Capabilities

### New Capabilities

- `tender/room-summary`：调查室 `summaryJson` 的写入规矩——共用的 JSON 位，谁写都锁项目行、重读、只改自己的键；分析投影与开始调查不整块替换。

### Modified Capabilities

无。
