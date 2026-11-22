# Proposal：数字员工的一次调用守住整次调用的截止时间（FIX-15）

TASKFLOW：FIX-15（「Phase F（续）— 情报串联」表；2026-11-22）。合并顺序 FIX-17 → FIX-21 → FIX-19 → …，FIX-15 排在 FIX-19 之后：FIX-19 合并后把 main 合入本分支再开工，TASKFLOW 的行接在表里已有的最后一行之后。

## Why

FIX-12（#540，已合并）只给招标分析切片里的模型请求加了截止；同一次 `/api/cron/agent-runs` 调用里，认领下一个任务、开始下一轮，以及数字员工路径上四处不带超时的模型调用（四处里现行一键分析只走到第 8 步 t8 综合汇总）都不看整次调用的截止时间，仍可能被平台 300 秒强制结束。被强制结束两次，这一步就判失败（步骤尝试上限 2），用户看到的是「长时间没有进展」。

2026-11-22「12-3 Indoor Canadian Flag」那次 t8 失败不是这个原因：Vercel 日志 16:40:31（多伦多）起的模型请求全部是 OpenAI 429「no credits remaining」，t8 在其后失败。这一类（模型账户余额不足导致的模型请求失败）归 FIX-20，本 change 不修它，之后同类失败的结果不变（见 design「Context」）。

## What Changes

- 限定 t8 综合汇总的模型请求（本次的首要改动，Evan 2026-11-22 要求）：带时间预算时，超时取「整次调用剩余 − 15 秒」与 180 秒中较小的一个；这个可用时间不足 60 秒就不发请求；请求被截止中止或没有发出时，这一步回到待执行、不消耗尝试次数、任务交还队列，下一次调用从这一步继续。
- 限定规划（上限 90 秒、可用时间不足 40 秒不发）与风险分析旧分支（上限 180 秒、不足 60 秒不发）的模型请求，规则同上；规划被截止中止或没有发出时，任务交还队列、任务尝试次数置 0、不写计划。
- 限定核验的模型复核（上限 60 秒、不足 20 秒不发）：没有发出或被截止中止时，沿用既有的「退回确定性核验结论」。
- 让四类请求的开工门槛在时间预算本身不够时退为 10 秒（预算 − 15 秒小于开工门槛时），与认领、开轮门槛同一做法。
- 四类调用的上限与开工门槛（G3 已定 A，Lucas 2026-11-22，有前提）：合并前跑 `docs/acceptance/fix-15/prod-check.sql` B 段，把 t8、风险旧分支、规划的生产耗时分布写进报告，按写死的规则确认 180 / 60 秒（规划 90 / 40 秒）；要调就在合并前调、写明依据（规则见 design Migration Plan「合并前」）。
- 记下同一步（以及同一个任务的规划）被截止中止的累计次数，中间任何一次让出都原样保留已有次数；满 3 次之后再被截止中止就按既有失败规则处理（G1 已定 A，Lucas 2026-11-22）。
- 检查认领前的剩余时间：不足 80 秒不认领，任务原样留在队列里（不改状态、不计尝试次数）；预算本身小于 80 秒时门槛退为 10 秒。
- 检查每一轮开始前的剩余时间：不足 60 秒就结束本时间片，按既有的交还队列处理（任务尝试次数置 0）；预算本身小于 60 秒时门槛退为 10 秒。
- 报告「因时间不足未认领」与「因截止交还队列」的任务数（cron 响应与自动化运行记录元数据），并在有这两类剩余工作时安排既有的链式自触发（G2 已定 A：接受，Lucas 2026-11-22）。
- 新增两个测试：纯函数与源码断言的单测（进 CI 子集）、认领与尝试次数的隔离库测试（只进全量），都以 t8 综合被截止为主例。

## Capabilities

### New Capabilities

- `agents/workforce-invocation-budget`：数字员工队列在一次带时间预算的调用里怎样使用时间——什么时候不再认领、不再开新一轮，四类模型调用的超时与开工门槛，被截止中止后怎样交还队列、累计次数怎样记，以及怎样报告与接续。

### Modified Capabilities

（无。`tender/analysis-slice-budget` 由 FIX-12 新增，本次不改它的要求。）

## Impact

- 代码：
  - `src/lib/agent-runtime-v2/flags.ts`：新增门槛常量与四个纯函数（剩余时间够不够；单次模型请求发不发、超时多少、截止是否起作用；一次请求是不是被中止；累计截断次数怎样记），新增对 `openai` 包的一处错误类型引用。
  - `src/lib/workforce-runtime/synthesis.ts`：综合接收时间预算、带超时；被截止中止或没有发出时返回 continuation；结果类型加 continuation；测试注入口参数加 `timeoutMs`。
  - `src/lib/agent-runtime-v2/executor.ts`：批路径（数字员工唯一走的路径）把预算传给综合；任何一次让出写步骤 `evidenceJson.continuation` 时都带上累计截断次数，满次数后转入既有失败分支。
  - `src/lib/agent-runtime-v2/adapters.ts`：continuation 的理由多一个取值 `INVOCATION_DEADLINE`。
  - `src/lib/workforce-runtime/processor.ts`：认领门槛、开轮门槛、把预算传给规划、规划被截止后交还队列（累计次数随同一次带防栅栏的交还写入）、返回两个计数。
  - `src/lib/agent-runtime-v2/planner.ts`、`verifier.ts`、`process.ts`：规划与核验接收预算并带超时；`process.ts` 的两处核验调用传预算。
  - `src/lib/tender-workforce/tools.ts`：风险分析旧分支用 `ctx.executionBudget`。
  - `src/app/api/cron/agent-runs/route.ts`、`src/lib/workforce-runtime/self-trigger.ts`：报告两个计数；自触发条件加上这两类剩余工作。
- 用户能看到的：两个项目可以同时发起一键分析，实际仍按先后一个一个跑；第二个最坏要等第一个整个跑完（design Risks「排队头阻塞」）。
- 受影响的 Muse 意图：无（不碰 muse-bridge）。
- 测试：新增 `src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts`（注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`，两处都带 `NODE_ENV=test` 前缀）、`src/lib/workforce-runtime/__tests__/invocation-deadline-db.isolated.test.ts`（只注册进 `scripts/test-all.sh`）。
- 无 schema、无新依赖、无新事件类型、无新调用点；**没有开关，合并即在生产生效**。不带时间预算的调用方（脚本、同步入口、审批后的恢复）行为不变。
- 调用次数与今天比：
  - 少调：开工门槛让注定被中止的请求不再发出；核验被截止时不重发。
  - 多调：被截止中止的综合、规划、风险请求在下一次调用里重发。其中今天本来会在 t+225 到 t+300 秒之间返回成功的那部分，今天只调一次，本 change 之后要调两次；超过 300 秒的那部分今天也会被平台强杀后重跑。同一步最多被截断 3 次（G1）。
  - 由成功变失败：开工时剩余 195 秒以上、耗时 180 到约 285 秒的综合与风险旧分支请求，今天能在 300 秒内返回成功，本 change 之后按失败计次（两次就失败）；开工时剩余 105 秒以上、耗时 90 秒以上的规划同理，改走任务级重试（G3）。这里的 180 / 90 秒以合并前按 B 段确认后的值为准。

## Out of scope

- 2026-11-22「12-3」那次 t8 失败（模型账户余额不足，OpenAI 429「no credits remaining」）：归 FIX-20（失败降级、失败通知写那一步自己的原因），本 change 不修它。生产事件层面的确认用 `docs/acceptance/fix-15/prod-check.sql` A 段，结果写进 FIX-15 报告。
- t8 综合失败后的降级、受阻显示与「从失败的这一步继续」——FIX-20。
- 降级结果怎样告诉用户——FIX-16 `tender-analysis-incomplete-notes`。
- 调用日志里给综合、核验、风险旧分支标类别：需求外，G4 已定 C（Lucas 2026-11-22）：另开小 change，与 FIX-12 报告 §7「另记」的 `retryCount` 口径一起做，编号待定。
- 以下仍可能越过 300 秒，不在本次的保证之内，另开 change，编号待定（每一条在 TASKFLOW 各登记一行，见 tasks 3.2）：
  - PERSIST 切片（中文化只留 5 秒余量，其后落库事务 10 + 120 秒）；写检查点的事务超时（同样 10 + 120 秒，`src/lib/tender-workforce/v2-persist-workforce.ts` 的 `WORKFORCE_V2_TX_OPTIONS`）。
  - OpenAI SDK 按 `retry-after` 等待时没有上限、不看中止信号；费用预检（`src/lib/ai/client.ts:173–186`）在本方计时器（`:191`）之前，它的耗时不算进超时。这两项都在 `client.ts` 这一层，本 change 不改 `client.ts`，并到同一个 change 里处理。
  - 旧自动分析管线（`src/lib/tender-auto-analysis/worker.ts`）：FINALIZE 没有时限；认领下一个分析的门槛还是 45 秒（`MIN_RUN_SLICE_MS`，`worker.ts:51`、`:1019`），没与窗口开批的 80 秒对齐（FIX-12 报告 §7「另记」点名的一项）。这两项并到同一个 change；FIX-18「招标分析只留一个入口」若下线旧管线入口，这两项随之不再需要。
  - `kickQueuedWorkforceJobSlice` 的预算起点；`processQueuedAgentRuns` 没有上限。
  - 收尾步骤 t9 的外部情报（`runExternalIntelForProject` 内部多次 60–150 秒的固定超时调用，没有总时限，60 秒开轮门槛挡不住）。
  - 不调模型的长工具：t2 第一次解析大文件（`src/lib/tender-workforce/tools.ts:557` 的 `parseDocumentPagesAndStore`）没有时限，60 秒开轮门槛同样挡不住。
- 不改 `AGENT_RUNS_INVOCATION_BUDGET_MS`（240 秒）、`WORKFORCE_SLICE_BUDGET_MS`（45 秒）、`WORKFORCE_MAX_ROUNDS_PER_SLICE`（6）、`vercel.json`、租约与队列结构；不新增任何队列、调度、租约。
- 不改 `src/lib/ai/client.ts`：`createCompletion` 的计时方式与签名不变。
