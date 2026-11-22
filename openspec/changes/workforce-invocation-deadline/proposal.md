# Proposal：数字员工的一次调用守住整次调用的截止时间（FIX-15）

TASKFLOW：FIX-15（「Phase F（续）— 情报串联」表，排在 FIX-12 之后；FIX-13 / FIX-17 若先合并，排在它们之后；2026-11-22）

## Why

FIX-12（#540，已合并）只给招标分析切片里的模型请求加了截止；同一次 `/api/cron/agent-runs` 调用里，认领下一个任务、开始下一轮，以及数字员工路径上四处不带超时的模型调用（现行一键分析里唯一会调模型的是第 8 步 t8 综合汇总）都不看整次调用的截止时间，仍可能被平台 300 秒强制结束。被强制结束两次，这一步就判失败（步骤尝试上限 2），用户看到的是「长时间没有进展」。

## What Changes

- 限定 t8 综合汇总的模型请求（本次的首要改动，Evan 2026-11-22 要求）：带时间预算时，超时取「整次调用剩余 − 15 秒」与 180 秒中较小的一个；这个可用时间不足 60 秒就不发请求；请求被截止中止或没有发出时，这一步回到待执行、不消耗尝试次数、任务交还队列，下一次调用从这一步继续。
- 限定规划（上限 90 秒、可用时间不足 40 秒不发）与风险分析旧分支（上限 180 秒、不足 60 秒不发）的模型请求，规则同上；规划被截止中止或没有发出时，任务交还队列、任务尝试次数置 0、不写计划。
- 限定核验的模型复核（上限 60 秒、不足 20 秒不发）：没有发出或被截止中止时，沿用既有的「退回确定性核验结论」。
- 记下同一步（以及同一个任务的规划）被截止中止的累计次数，满 3 次之后再被截止中止就按既有失败规则处理（次数上限留给 GATE，见 design「留给 GATE」G1）。
- 检查认领前的剩余时间：不足 80 秒不认领，任务原样留在队列里（不改状态、不计尝试次数）；预算本身小于 80 秒时门槛退为 10 秒。
- 检查每一轮开始前的剩余时间：不足 60 秒就结束本时间片，按既有的交还队列处理（任务尝试次数置 0）；预算本身小于 60 秒时门槛退为 10 秒。
- 报告「因时间不足未认领」与「因截止交还队列」的任务数（cron 响应与自动化运行记录元数据），并在有这两类剩余工作时安排既有的链式自触发（是否接受留给 GATE，见 G2）。
- 标出综合、核验、风险旧分支三类模型调用在调用日志里的类别（规划已有），供上线后按生产耗时复核上限。
- 新增两个测试：纯函数与源码断言的单测（进 CI 子集）、认领与尝试次数的隔离库测试（只进全量），都以 t8 综合被截止为主例。

## Capabilities

### New Capabilities

- `agents/workforce-invocation-budget`：数字员工队列在一次带时间预算的调用里怎样使用时间——什么时候不再认领、不再开新一轮，四类模型调用的超时与开工门槛，被截止中止后怎样交还队列，以及怎样报告与接续。

### Modified Capabilities

（无。`tender/analysis-slice-budget` 由 FIX-12 新增，本次不改它的要求。）

## Impact

- 代码：
  - `src/lib/agent-runtime-v2/flags.ts`：新增门槛常量与两个纯函数（剩余时间够不够、单次模型调用的超时与是否发出）。
  - `src/lib/workforce-runtime/synthesis.ts`：综合接收时间预算、带超时；被截止中止或没有发出时返回 continuation；结果类型加 continuation；调用日志类别 `workforce-synthesis`。
  - `src/lib/agent-runtime-v2/executor.ts`：批路径（数字员工唯一走的路径）把预算传给综合；截止中止的累计次数写进步骤 `evidenceJson.continuation`，满次数后转入既有失败分支。
  - `src/lib/agent-runtime-v2/adapters.ts`：continuation 的理由多一个取值 `INVOCATION_DEADLINE`。
  - `src/lib/workforce-runtime/processor.ts`：认领门槛、开轮门槛、把预算传给规划、规划被截止后交还队列、返回两个计数。
  - `src/lib/agent-runtime-v2/planner.ts`、`verifier.ts`、`process.ts`：规划与核验接收预算并带超时；`process.ts` 的两处核验调用传预算。
  - `src/lib/tender-workforce/tools.ts`：风险分析旧分支用 `ctx.executionBudget`。
  - `src/app/api/cron/agent-runs/route.ts`、`src/lib/workforce-runtime/self-trigger.ts`：报告两个计数；自触发条件加上这两类剩余工作。
- 受影响的 Muse 意图：无（不碰 muse-bridge）。
- 测试：新增 `src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts`（注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`）、`src/lib/workforce-runtime/__tests__/invocation-deadline-db.isolated.test.ts`（只注册进 `scripts/test-all.sh`）。
- 无 schema、无新开关、无新依赖、无新事件类型、无新调用点；合并即生效。不带时间预算的调用方（脚本、同步入口、审批后的恢复）行为不变。
- 调用次数：开工门槛让注定被中止的请求不再发出；被截止中止的综合、规划、风险请求会在下一次调用里重发一次（今天被平台强制结束后的重跑同样会重发）；核验被截止时不重发。

## Out of scope

- 2026-11-22 生产上 t8「未成功」的具体原因：生产 SQL 由别的 change 交给人去跑，本 change 不依赖它（理由见 design「Context」）。
- t8 综合失败后的降级、受阻显示与「从失败的这一步继续」——FIX-20。
- 降级结果怎样告诉用户——FIX-16 `tender-analysis-incomplete-notes`。
- 以下仍可能越过 300 秒，不在本次的保证之内，另开 change，编号待定：PERSIST 切片（中文化只留 5 秒余量，其后落库事务 10 + 120 秒）；OpenAI SDK 按 `retry-after` 等待时没有上限、不看中止信号；写检查点的事务超时；旧自动分析管线的 FINALIZE；`kickQueuedWorkforceJobSlice` 的预算起点；`processQueuedAgentRuns` 没有上限；收尾步骤 t9 的外部情报（`runExternalIntelForProject` 内部多次 60–150 秒的固定超时调用，没有总时限，60 秒开轮门槛挡不住）。
- 不改 `AGENT_RUNS_INVOCATION_BUDGET_MS`（240 秒）、`WORKFORCE_SLICE_BUDGET_MS`（45 秒）、`WORKFORCE_MAX_ROUNDS_PER_SLICE`（6）、`vercel.json`、租约与队列结构；不新增任何队列、调度、租约。
- 不改 `src/lib/ai/client.ts`：`createCompletion` 的计时方式与签名不变。
