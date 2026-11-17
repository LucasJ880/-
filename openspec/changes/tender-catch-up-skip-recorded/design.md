# Design：带了发生时间或预期状态的推进不补招投标状态

## Context

`advanceProjectStage` 的输入里，`occurredAt`（阶段发生时间）与 `expected`（写入时的预期项目状态 / 招投标状态）只有「写入阶段时间」的调用方会带，目前就是 FLOW-H4a 的「记录提交」。它把「不是无需操作的成功」当作「提交时间已写入」。补状态的返回不满足这个前提。

## Decisions

### D1 在补状态函数开头、事务之前返回

在 `catchUpLaggingTenderStatus` 的「需要人确认、项目进行中」两项检查之后，加一行：带了 `occurredAt` 或 `expected` 就返回 `null`（不补）。调用处照原来走「无需重复推进」。这就是 `373f0579` 的原样代码，逐字移植。

- 否决：在「记录提交」那边处理。补状态是推进入口的副作用，调用方无从拦。

## 与八条硬纪律的关系

- 零 schema、零模型调用、不加队列、不加开关；只会少改状态、少发回调。

## 验证方式

- `npx tsx src/lib/tender/__tests__/stage-status-catch-up.test.ts`：18 项通过。
- `stage-status-catch-up-db.isolated.test.ts`（本地隔离库）：33 项通过；删掉这一行检查后失败 2 项（状态被改成「供应商报价」、多发 2 次回调）。

## Risks / Trade-offs

- 将来别的调用方也带 `occurredAt` 却想要补状态：会不补。目前只有「记录提交」带这两个参数；要改时在 spec 里改这一条。
