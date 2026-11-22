# Proposal：数字员工的一次调用守住整次调用的截止时间（FIX-15）

TASKFLOW：FIX-15（Phase F（续）表末，FIX-12 的后续，2026-11-21）

## Why

FIX-12（#540）只约束了招标分析切片内部的模型请求；同一次 `/api/cron/agent-runs` 调用里，认领下一个任务、开始下一轮、以及四处不带超时的模型调用都不看整次调用的截止时间，一个任务在 t+225 秒让出之后，下一个任务照样开工，仍可能被平台 300 秒强制结束。被强制结束两次，这一步就判失败（步骤尝试上限 2），用户看到的还是「长时间没有进展」。

## What Changes

- 在认领下一个数字员工任务之前检查整次调用的剩余时间：不足 60 秒不再认领，任务原样留在队列里（不改状态、不计尝试次数）。
- 在每一轮开始之前检查整次调用的剩余时间：不足 60 秒结束本时间片，按既有的「交还队列继续」处理（尝试次数归零，与现在轮次用尽相同）。
- 给数字员工路径上四处不带超时的模型调用（规划、核验、多任务综合、旧版风险分析）加上超时：有整次调用的截止时间时取「剩余时间 − 15 秒」与各自上限中较小的一个；没有截止时间时行为不变。
- 让被整次调用的截止时间截断的这四处调用按「交还队列继续」处理，不按失败处理、不消耗步骤的尝试次数。
- 在本次调用因时间不足而留下未认领任务时，沿用既有的链式自触发（与「有任务让出」同一条件），不等下一次定时触发。
- 新增回归测试：注入时钟与慢模型，断言第二个任务不在截止前 60 秒内被认领、轮次不在截止前 60 秒内开始、四处模型调用带上了不超过剩余时间的超时、被截断时任务回到队列且尝试次数不变。

## Capabilities

### New Capabilities

- `agents/workforce-invocation-budget`：数字员工队列在一次调用里怎样使用时间——什么时候不再认领、不再开新一轮，模型调用的超时，以及被截止时间截断时怎样交还队列。

### Modified Capabilities

（无。`tender/analysis-slice-budget` 由 FIX-12 新增，本次不改它的要求。）

## Impact

- 代码：`src/lib/workforce-runtime/processor.ts`（认领前、每轮前的检查；返回「因时间不足未认领」的数量）；`src/lib/agent-runtime-v2/planner.ts`、`src/lib/agent-runtime-v2/verifier.ts`、`src/lib/workforce-runtime/synthesis.ts`、`src/lib/tender-workforce/tools.ts`（风险分析那一处）加超时与截断后的处理；`src/lib/agent-runtime-v2/process.ts`、`executor.ts`（把既有的 `executionBudget` 传到规划与核验）；`src/app/api/cron/agent-runs/route.ts`（自触发条件加上「有未认领」）。
- 受影响的 Muse 意图：无（不碰 muse-bridge）。
- 测试：新增 `src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts`，注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
- 无 schema、无新开关、无新依赖、无新模型调用（只会少调或晚调）；合并即生效。不带 `executionBudget` 的调用方（脚本、测试、同步入口）行为不变。

## Out of scope

- PERSIST 切片：中文化只留 5 秒余量、其后落库事务最长 130 秒——另开 change（暂名 FIX-16）。
- OpenAI SDK 按 `retry-after` 等待时没有上限、不看中止信号（实测 `retry-after: 75` → 75.5 秒才返回）——FIX-16。
- 主模型用满阶段上限时备用模型时间不够、每个切片重新先试主模型；连续截止时尽早失败——FIX-16。
- 写检查点的事务超时（10 + 120 秒）、旧自动分析管线的 FINALIZE、`kickQueuedWorkforceJobSlice` 的预算起点、`processQueuedAgentRuns` 没有上限——FIX-16 逐条评估。
- 收尾步骤里的外部情报调用（`runExternalIntelForProject`）：它内部有多次模型与外部请求，本次只靠「剩余不足 60 秒不开新一轮」挡住，不改它内部。
- 降级结果怎样告诉用户——另开 change（暂名 FIX-17，「降级结果用白话说清楚」）。
- 不改 `AGENT_RUNS_INVOCATION_BUDGET_MS`（240 秒）、`vercel.json`、租约与队列结构；不新增任何队列、调度、租约。
