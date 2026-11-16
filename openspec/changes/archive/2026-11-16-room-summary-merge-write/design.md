# Design：分析投影与开始调查不再整块替换调查室 summaryJson（FIX-10）

## Context

- `BidIntelligenceRoom.summaryJson` 的写入方（`grep bidIntelligenceRoom.(update|upsert|create)`）：
  - 整块替换：分析投影 `project-room.ts`、开始调查 `start-intelligence.ts`（已有房间、还没有摘要时）。
  - 读整块 → 展开 → 写回：外部情报 `external-intel/award-history/route.ts`（3 处）与 `tender-intel/orchestrate.ts`（2 处，中间有外部请求）、跟标 `tender-watch/route.ts`（2 处）与 `tender-intel/watch.ts`、投标草稿 `tender-bid-draft/generate.ts`（中间有模型调用）、分析备忘 `tender-analyst-memo/v2/pipeline.ts`、投标工作区 `tender-bid-workspace/store.ts`（锁的是房间行，不是项目行）。
  - 已对齐：报价引擎 `quote-engine/tender-bid.ts`（项目行锁）、报价表助手（FIX-9）。
- 分析投影在 worker 的 `PROJECT_ROOM` 一步，每次分析（含补遗之后的新一份完整分析）都跑；GO 决定、模块投影另写，不经 `summaryJson`。
- 分析摘要（`TenderAnalysisRun.summaryJson`）只含分析内容；没有与别的功能同名的键（`externalConfirmed` 在分析代码里只被读取）。

## Goals / Non-Goals

**Goals**

- 分析投影与开始调查不再冲掉别的功能的键。
- 与报价引擎互斥：同一把项目行锁，锁住后重读。
- 重新分析之后不留上一次分析独有的旧键。

**Non-Goals**

- 不改其它写入方（FIX-11）。
- 不改分析摘要的内容、模块投影、GO 决定。
- 不补已经丢失的数据。

## Decisions

### D1 一个写入入口，只接受「改哪些键」

`patchRoomSummaryTx(tx, { projectId, roomId?, patch: (latest) => { set?, unset? }, data? })`：锁项目行 → 按 id（或项目）重读房间 → `applyRoomSummaryPatch` → 同一事务写回（`data` 里的其它列一起写）。`patch` 只能返回要设 / 要去掉的键，入口本身不提供整块替换。`patchRoomSummary` 是自带事务的版本。房间不存在返回 `null`、不写。

- 否决：各处自己写锁与重读。FIX-11 要迁 8 个文件，入口统一才好加守卫。
- 锁复用 `lockProject`（`src/lib/quote-engine/tender-bid.ts`），与 FIX-9 一致。

### D2 投影记下自己写了哪些键

投影设这次分析摘要里的键 + `projectedFromRunId` + `projectedKeys`（这次写的键名）；`unset` = 上一次 `projectedKeys` 里、这一次没有的键。这样重新分析之后不留旧分析独有的键，又不会碰别的功能的键。

- 否决：只覆盖、永不去掉。上一份分析独有的键（例如某次才有的阻断项摘要）会一直留着，读的人以为是新分析的。
- 否决：列一张「别的功能的键」白名单，投影不碰它们、其余全换。新功能加键时要记得改白名单，忘了就再丢一次。
- 改动前投影过的房间没有 `projectedKeys`：这一次只覆盖、不去掉；从下一次起按记录去掉。
- 摘要里若带了 `projectedFromRunId` / `projectedKeys`：以投影写的为准。

### D3 开始调查只设初始摘要的键

已有房间、没有摘要时，经 `patchRoomSummaryTx` 设初始摘要的键与摘要文字 / 状态，然后重读房间供后面使用。新建房间的路径不变（没有可丢的键）。锁顺序与报价引擎相同（先项目行、后房间行）。

## Risks / Trade-offs

- 投影与开始调查现在会等正在进行的报价同步（一读一写）。
- 初始摘要与分析摘要的键会与别的功能的键并存在同一个对象里，读方本来就按键取，不受影响。
- 已经被清空的房间不会自己恢复人工输入（见 proposal Out of scope）。

## Migration Plan

无数据迁移。
