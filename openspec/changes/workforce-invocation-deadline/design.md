# Design：数字员工的一次调用守住整次调用的截止时间

## Context

动机见 proposal.md「Why」。来源：FIX-12 报告 §7 第 1 条（其「另记」已把不带超时的调用更正为四处）、#540 合并前的第二轮独立审计、本 change 草稿的逐条代码核对（2026-11-22）、Evan 2026-11-22「t8 的模型调用纳入 FIX-15 的整次调用截止时间（synthesis.ts 现在不带超时）」。下面的行号都按 main `2ef4f9c8`（已含 FIX-12）核对过；FIX-13（#546）只在 `scripts/test-all.sh`、`scripts/test-ci-unit.sh` 各加注册行、TASKFLOW 加一行，不碰本 change 改的源文件。

### 现在的调用链

1. 路由：`src/app/api/cron/agent-runs/route.ts:38–42` 从请求开始算 `executionBudget = { deadlineAt: 开始 + 240 秒, tickBudgetMs: 240 秒 }`；`:56–58` 定时触发先跑没有上限的 `processQueuedAgentRuns(2)`，链式自触发的调用跳过它；`:59` 把预算交给 `processQueuedWorkforceJobs(2, …)`；`:67–77` 只在 `yieldedContinuations > 0` 时安排自触发。
2. 队列循环：`src/lib/workforce-runtime/processor.ts:763–781` 一次查出候选（`createdAt` 升序，最多 limit 个），`:785–791` 逐个调用 `processWorkforceJobSlice`，认领前不看截止。任务尝试次数只在认领时 +1（`src/lib/agent-runtime/lease.ts:79–81`）。
3. 时间片：`processor.ts:317` 记 `processingStartedAt`（认领、清扫回收、身份校验之后），`:472–474` 每轮前只判断「本任务已用时 > 45 秒」（`:50`）。首个时间片的规划在轮次循环之前（`:323–373`），不受轮次门约束；规划失败在 `:407` 抛错，由 `:643–660` 走任务级重试（上限 5 次，`:48`；退避 15 / 60 / 180 / 600 秒，`:53`）。
4. 每一轮：`processor.ts:500–509` → `src/lib/agent-runtime-v2/process.ts:176–237` → 数字员工一律走批路径（`src/lib/agent-runtime-v2/executor.ts:316–331`）→ `executeClaimedWorkforceStep`（`:1494`）。工具调用带预算（`:1595`）；**综合调用 `:1569–1577` 不带预算**；`ExecuteSynthesisTaskInput`（`src/lib/workforce-runtime/synthesis.ts:183–193`）没有这个字段，结果类型（`:82–88`）没有 continuation，`executor.ts:643` 的注释写明「不给它开让出能力」。
5. 让出：批路径 `executor.ts:1613–1650` 把步骤放回 ready、尝试次数回滚到认领前（`row.attemptCount − 1`）；`processor.ts:520–523` 记 `sawYield` 并结束轮次；`:621–642` 交还队列（任务尝试次数置 0、2 秒后可再认领），事件 payload 带 `yielded`。
6. 核验：`process.ts:220–225`、`:259–264` 调 `verifyRuntimeV2Run` 不带预算；`src/lib/agent-runtime-v2/verifier.ts:316–325` 全部完成标准都是 tool_result 且带 evidenceStepIds 时不调模型；`:229–263` 模型复核只在确定性结论为 PASS 时发生，出任何错都退回确定性结论。
7. 四处不带超时的模型调用：规划 `planner.ts:326`、核验 `verifier.ts:231`、综合 `synthesis.ts:239`、风险分析旧分支 `src/lib/tender-workforce/tools.ts:871`。`createCompletion` 不传 `timeoutMs` 时不设计时器（`src/lib/ai/client.ts:191–194`）；openai 6.32.0 默认每次 10 分钟、重试 2 次（`node_modules/openai/client.js:138、148`），对 300 秒等于没有上限。
8. 被强制结束两次就失败：步骤尝试上限 2（`src/lib/agent-runtime-v2/flags.ts:74`、`persist.ts:70`）；步骤认领时 +1（`executor.ts:1273–1283`）；下一次认领时的回收（`processor.ts:241–277`）把用尽的步骤记为 `stale_running_exhausted`。

### 现行一键分析路径上谁会调模型

- 一键分析用服务端固定的 9 步确定性计划（`src/lib/tender-workforce/deterministic-plan.ts`）。计划在入队前就写好（`src/lib/workforce-runtime/job.ts:68–69、271–283`），所以 `processor.ts:323` 跳过规划；三条完成标准都是 tool_result 且带 evidenceStepIds（`deterministic-plan.ts:239–260`），所以核验不调模型；t5 风险分析走投影分支（`tools.ts:750–797`）。**四处里只有 t8 综合汇总（`deterministic-plan.ts:184–208`）在现行路径上调模型**，所以它是本 change 的首要场景。
- 规划、模型复核、风险旧分支只出现在 LLM 规划的任务上（确定性计划开关关着的招标任务、销售等其它域）。
- 「生产开着确定性计划」是推断：2026-11-20 出事的「第 3 步」是 canonical V2 切片（FIX-12 报告 §1），而 `tender_analyze_package_v2` 只在确定性计划的工具集里（`tools.ts:110–119`；LLM 规划可见的工具集 `:87–95` 不含它）。开关的生产值本身没有核对。

### t8 在生产上「未成功」的原因还没查

2026-11-22 生产上 t8「未成功」的具体原因要靠生产 SQL 查，由别的 change 交给人去跑。本 change 不依赖它：无论原因是什么，本 change 只改变「模型请求超过整次调用的时间」这一类——超时、截止让出、开工门槛。如果原因是模型返回 400、输出不合格或配额，本 change 之后结果不变（按既有失败规则），那部分的降级、受阻显示与「从失败的这一步继续」归 FIX-20。

## Goals / Non-Goals

**Goals:**
- 一次带预算的调用里，t8 综合汇总的模型请求不越过「截止 − 15 秒」，被截止中止时不消耗尝试次数、下一次调用接着做。
- 规划、风险旧分支、核验三处同样带上不越过截止的超时；可用时间不够时不发注定被中止的请求。
- t+160 秒（240 − 80）之后不再认领新任务，t+180 秒（240 − 60）之后不再开新一轮。
- 被截止截断的工作不算失败，但同一步被截断的累计次数有上限，不会无限空转。

**Non-Goals（不动的模块 / 文件）:**
- `src/lib/ai/client.ts`、`src/lib/ai/retry.ts`：不改（`createCompletion` 的计时方式、签名与 SDK 重试等待不变）。
- `src/lib/tender-auto-analysis/**`、`src/lib/tender-understanding/**`、`src/lib/ai/model-policy/tender.ts`（FIX-12 的范围）：不改；`v2-cursor.ts` 的门槛（`V2_PHASE_MIN_MS`、`PHASE_SAFETY_MS`、`HARD_MIN_PHASE_MS`）只被引用为依据，不改数值。
- `src/lib/workforce-runtime/constants.ts` 的 `AGENT_RUNS_INVOCATION_BUDGET_MS`、`WORKFORCE_CONTINUATION_MAX_DEPTH`；`processor.ts` 的 `WORKFORCE_SLICE_BUDGET_MS`、`WORKFORCE_MAX_ROUNDS_PER_SLICE`、`WORKFORCE_LEASE_MS`、`WORKFORCE_MAX_ATTEMPTS`、`CONTINUATION_DELAY_MS`：数值不改。
- `src/lib/agent-runtime/lease.ts`（认领、续租、防栅栏）、`processor.ts` 的清扫（`stale_running_exhausted`）与候选查询：不改。
- `processor.ts` 的 `kickQueuedWorkforceJobSlice` 预算起点、`src/lib/agent-runtime/queue.ts`（`processQueuedAgentRuns`）、`src/lib/tender-intel/orchestrate.ts`（t9 外部情报）、`src/lib/tender-workforce/v2-persist-workforce.ts`（落库事务）：不改。
- `executor.ts` 的单步路径（`:596` 起，只有不带预算的旧 runtime_v2 走）：不改。
- 新文件不放进 `src/lib/agent-runtime-v2/`（冻结区），`agent-runtime-v2` 不新增对 `workforce-runtime` 的引用（见 D1）。
- `vercel.json`、`prisma/**`、`src/lib/runtime-architecture/runtime-architecture-baseline.json`：不改。

## Decisions

### D1 门槛与超时的算术放在一处纯函数，在 `agent-runtime-v2/flags.ts`

`flags.ts` 里新增常量（安全余量 15 秒、认领门槛 80 秒、开轮门槛 60 秒、退化门槛 10 秒、四类调用的上限与开工门槛）和两个纯函数：一个回答「剩余时间够不够做某件事」（含退化规则），一个回答「这次模型请求发不发、超时多少、是不是截止在起作用」。四处调用点与处理器都只用它们。

- 依据：`agent-runtime-v2` 是冻结区，新文件要过基线评审（`src/lib/runtime-architecture/runtime-architecture-baseline.json` 的 `frozenAreaFiles`）；`agent-runtime-v2 → workforce-runtime` 的引用只许减不许增（`src/lib/runtime-architecture/guards.ts:138、259–271`）。`flags.ts` 没有任何引用，规划、核验、处理器已经引用它（`planner.ts:3`、`verifier.ts:8`、`processor.ts:21`）；综合（`workforce-runtime → agent-runtime-v2`）与风险工具（`tender-workforce → agent-runtime-v2`）新增引用不在禁止方向里。它也是 `getRuntimeV2Limits` 所在的地方，这些门槛属于同一类运行时限额。
- 否决：新建 `src/lib/workforce-runtime/invocation-budget.ts`。规划、核验、`process.ts` 引用它会新增被禁止方向的边，`bash scripts/test-runtime-architecture.sh` 失败。
- 否决：各调用点各自算。四处口径会漂移，纯函数单测也测不到。

### D2 t8 综合汇总：带超时，被截止中止就交还队列（首要场景）

- 可用时间 = 截止 − 15 秒 − 现在。可用时间不足 60 秒：不发请求，返回 continuation（理由 `INVOCATION_DEADLINE`，阶段 `deadline_skip`）。否则超时 = min(180 秒, 可用时间)；开工时记下「可用时间 < 180 秒」（截止在起作用）。
- 请求以中止结束且开工时截止在起作用：返回 continuation（理由 `INVOCATION_DEADLINE`，阶段 `deadline_cut`），不返回错误。批路径既有的让出分支（`executor.ts:1613–1650`）把步骤放回 ready、尝试次数不变；处理器按既有的「有让出」交还队列、自触发。下一次调用从这一步重新发请求。
- 180 秒上限在起作用时被中止、模型返回错误、输出不合格：照旧返回 `SYNTHESIS_MODEL_FAILED` / `SYNTHESIS_INVALID_OUTPUT`（`synthesis.ts:248–282`），按既有失败规则计次。
- 判定「被中止」只看错误的类型（SDK 的 `APIUserAbortError` 实例，注入口抛出的名为 `AbortError` 的错误），不解析错误文案；判定「截止在起作用」在开工时就定下，不在中止时再量剩余时间（避免上限与可用时间相近时误判）。
- 数值依据：唯一的实测是 T1B 端到端（15 页文件、旧模型）综合 19.7 秒（`docs/QINGYAN_TENDER_T1B_WORKFORCE_INTEGRATION_REPORT.md:202–204`）。180 秒约为它的 9 倍，60 秒约 3 倍。生产耗时没有：综合调用现在不记调用日志类别（见 D8），上线后按类别复核（见 G3）。
- 结果类型加可选 continuation（与工具的 `ToolContinuation` 同一个类型）；`adapters.ts` 的理由多一个取值 `INVOCATION_DEADLINE`，原有 `TIME_BUDGET_YIELD` 字样保留（`t5-p11-resumability.test.ts:65–68` 的断言不变）。
- 否决：只靠认领 / 开轮门槛，不给综合加超时。门槛只保证开工时有 60 秒以上，综合本身没有上限。
- 否决：被截止中止时按既有失败计次。步骤尝试上限是 2，两次截止就以 `synthesis_failed` 失败——正是要避免的结果。
- 否决：给综合做像 t3 那样的分段检查点。综合是一次模型调用，没有能保存的中间结果。

### D3 规划：被截止中止时走处理器里的正常交还队列

- 处理器在 `processor.ts:363` 把预算传给规划；上限 90 秒，可用时间不足 40 秒不发。没有发出或被截止中止时，规划返回带「截止」标记的失败；处理器不在 `:407` 抛错，改走 `:621–642` 那段既有的交还队列（任务尝试次数置 0、2 秒后可再认领、不写计划），事件 payload 加 `invocationDeadline: true`。其它失败照旧走 `:643–660` 的任务级重试。
- 数值依据：T1B 规划 20.1 秒（同一报告 `:201`）。
- 后果：这类任务没有计划也没有步骤，任务列表按既有规则显示为「排队中」（`src/lib/workforce-runtime/read-model/projection.ts:99–104` 投影为 QUEUED，`src/app/(main)/workforce/presentation.ts:39` 显示为「排队中」），与尚未开始的任务相同。
- 否决：按既有失败走任务级重试。每次截止都累计任务尝试次数（上限 5）并退避 15 秒起。
- 否决：不给规划加超时。认领门槛只保证开工时有 80 秒，规划本身没有上限。

### D4 风险分析旧分支：直接用 `ctx.executionBudget`

- `tools.ts:799` 之后的旧分支从 `ctx.executionBudget` 取预算（工具上下文已经带着，`executor.ts:1595`），上限 180 秒，可用时间不足 60 秒不发；没发出或被截止中止时返回 continuation（同 D2，`ok` 为 true，与 t3 让出 `tools.ts:1348–1363` 同形）。投影分支（`:750–797`）不调模型，不变。
- 数值依据：T1B 风险分析 12.1 秒。
- 否决：删掉旧分支。确定性计划开关关上时（回滚路径）仍要用，不在本次范围。

### D5 核验：保持既有的确定性回退，不新增让出信号

- `process.ts` 两处核验调用传预算；需要模型复核时上限 60 秒，可用时间不足 20 秒不发。没有发出或被中止时，走既有的退回确定性结论（`verifier.ts:261–262`），任务照常收尾。
- 后果：一个 LLM 规划的任务若最后一步结束时剩余不足 35 秒，这次不做模型复核，按确定性结论完成。现行一键分析不受影响（不调模型复核）。
- 否决：新增让出信号（核验 → `process.ts` → 处理器交还队列，下一次重新核验）。核验在调模型之前已经写了 `verifying` 状态与「正在验证」事件（`verifier.ts:293–304`），要撤回；三层都要加新的返回值。模型复核只能把确定性 PASS 改差、不能改好（`:209–220`），而复核出错退回确定性结论本来就是既有规则，截止只是又一种出错。新增信号还会让同一次核验多跑一次模型，方向与第 7 条相反。
- 否决：不给核验加超时。同 D3。

### D6 被截止截断的累计次数（按 G1 推荐写；GATE 改了就改这一节与规格）

- 步骤：批路径在 `if (batchContinuation)` 之前，从认领后的行 `row.evidenceJson.continuation.deadlineCuts` 读出已有次数。理由为 `INVOCATION_DEADLINE`、阶段为 `deadline_cut` 时：已有不足 3 次就 +1 写回 `evidenceJson.continuation`，走让出；已有 3 次就不走让出，改成失败（错误以 `INVOCATION_DEADLINE_REPEATED` 开头），进既有失败分支计一次尝试。`deadline_skip`（没发出）不计。
- 规划：次数记在任务的 `metadata.plannerDeadlineCuts`（既有 JSON 位，经既有的 `mergeAgentRunMetadata`）；满 3 次后再被截止就走既有任务级重试。
- 与既有源码断言共存：计数放在 `if (batchContinuation)` 之前，块内回滚尝试次数、不写 completedAt 的写法与位置不变（`t5-p11-resumability.test.ts:73–112` 的 600 / 900 字符窗口）；执行器里不出现 `ok: false, continuation` 字样（`:69–71`）。
- 否决：把次数并进既有的步骤尝试次数（G1 的 C）。步骤尝试上限是 2，两次截止就失败。
- 否决：给步骤或任务加一个专门的计数字段。违反硬纪律第 1 条；既有的 `evidenceJson` / `metadata` 已经够用。
- 其余选项与后果见「留给 GATE」G1。

### D7 认领门槛 80 秒、开轮门槛 60 秒，预算不足时退为 10 秒

- 认领：`processor.ts:785–791` 的循环里，每次调用 `processWorkforceJobSlice` 之前判断；不足 80 秒就停止循环，这个任务和其后的都不认领，计 `skippedForBudget`；不写任何状态或事件。
- 开轮：`processor.ts:474` 既有的 45 秒判断旁边加一条；不足 60 秒就结束时间片，走 `:621–642` 的交还队列（任务尝试次数置 0），事件 payload 加 `invocationDeadline: true`，时间片结果标 `deadlineRequeued`。
- 80 秒与 FIX-12 的窗口开批门槛对齐（`src/lib/tender-auto-analysis/v2-cursor.ts:217`），并高于开轮门槛：认领到第 0 轮之间还有身份校验、清扫回收、事件写入，刚过门槛的认领不会在第 0 轮前就被打回。80 − 15 = 65 秒也够 t8 的 60 秒开工门槛。
- 退化：预算本身小于门槛时门槛退为 10 秒，与 FIX-12 的阶段门槛同一做法（`v2-cursor.ts:229–251` 的 `HARD_MIN_PHASE_MS`、`canStartPhase`），预算很小的测试或脚本不会永远不认领。四类调用的开工门槛同样退化（预算 − 15 秒小于开工门槛时用 10 秒）。
- 即时推进（`kickQueuedWorkforceJobSlice`，`processor.ts:688–697`）只推进一个任务，不经认领循环；它带预算，所以开轮门槛与四类调用的超时对它同样生效。
- 否决：沿用旧管线的 45 秒（`src/lib/tender-auto-analysis/worker.ts:1019`）。低于窗口开批的 80 秒，招标任务认领后会立刻让出（FIX-12 报告 §7「另记」已记）。
- 否决：认领与开轮同为 60 秒。刚过门槛的认领可能在第 0 轮前就被打回，白占一次认领与一组事件。
- 否决：把 `sliceBudgetMs` 改成按整次调用算。会改变不带预算的调用方（同步入口、脚本）。

### D8 报告、接续与调用日志类别（接续按 G2 推荐写）

- `processQueuedWorkforceJobs` 多返回 `skippedForBudget`（未认领）与 `deadlineContinuations`（开轮门槛结束的时间片、规划被截止或没发出）。路由的响应已整体带出 `workforce` 对象（`route.ts:80`）；自动化运行记录元数据加 `workforceSkippedForBudget`、`workforceDeadlineContinuations`。既有的 `workforceYieldedContinuations` 只计让出（含综合、风险的截止 continuation），不混入。
- 自触发：`shouldFireContinuationTrigger` 多一个可选输入（两类剩余工作之和），它与 `yieldedContinuations` 任一大于 0 即满足第 1 层；其余四层（每次调用至多一次、深度上限 25、开关、child 鉴权）不变；`self-trigger.ts:19–26` 的注释改写第 1 层的含义。OBS-P1 的既有断言不变（`obs-p1-latency-self-trigger.test.ts:205–257`，处理器里 `sawYield` 那一行与交还队列那段 data 原样保留）。
- 调用日志类别：综合 `workforce-synthesis`（与 `src/lib/ai/model-policy/benchmark-fixtures.ts:339` 同名）、核验 `runtime-v2-verifier`、风险旧分支 `tender-risk-legacy`；规划已有 `planner`（`planner.ts:334`）。只进调用日志的 workflow 字段，不进提示词。
- 否决：等下一次定时触发（每 2 分钟，`vercel.json:68–69`）。能用，但两个项目连着重跑时第二个会多等最多 2 分钟。
- 否决：新增「延后」状态或调度。违反硬纪律第 3 条。
- 否决：不加调用日志类别。上线后分不出综合的耗时，D2–D5 的上限没法复核。

### D9 测试：纯函数与源码断言进 CI，认领与尝试次数用隔离库

- CI 单测 `invocation-deadline.test.ts`（不连库）：
  - 纯函数：门槛与退化，四类调用的发不发、超时与「截止在起作用」，数值与规格场景一一对应。
  - 直接调用综合：用注入口记下收到的超时、按需抛出 `AbortError`。
  - 源码断言：认领门槛在循环里、`processWorkforceJobSlice` 之前；开轮门槛在轮次循环开头；处理器把预算传给规划；`process.ts` 两处核验传预算；批路径把预算传给综合；风险旧分支用 `ctx.executionBudget`；核验的 catch 仍退回确定性结论；路由把两个计数写进元数据、交给自触发判定。
- 隔离库测试 `invocation-deadline-db.isolated.test.ts`（只进全量），沿用 `src/lib/workforce-runtime/__tests__/helpers.ts` 与 `p0-execution-alignment.test.ts` 的夹具做法：
  - 认领门槛与开轮门槛；
  - t8 被截止后交还、下一次接着做完；
  - 累计满 3 次后按失败计次；
  - 规划被截止后交还。
  - 风险分析旧分支要整套招标夹具，不进这个测试：它与 t8 共用批路径的让出分支（隔离库里由 t8 覆盖），自己的那一段由 CI 单测的纯函数与源码断言覆盖。
- 不注入时钟：用 `executionBudget.deadlineAt = Date.now() + N` 造出临近截止。处理器与认领都直接用 `Date.now()` / `new Date()`，注入时钟要改的地方太多。
- 注入口：
  - 综合（`synthesis.ts:160–181`）与风险（`tools.ts:466–489`）的注入口参数加 `timeoutMs`，既有注入口不读它就行（`p0-execution-alignment`、`t1b-integration` 不变）。
  - 规划、核验各加一个仅 `NODE_ENV=test` 生效的注入口（仿 `synthesis.ts:170–181`）。
  - 注入口拿不到 signal：`createCompletion` 自己建 AbortController（`client.ts:191–194`），`client.ts` 不改；注入口用「抛出名为 `AbortError` 的错误」模拟被计时器中止。
- 否决：全部用隔离库。CI 不起数据库（`.github/workflows/ci.yml:26–30` 只给占位连接串），注册进 CI 子集会失败。
- 否决：注入时钟。见上。

## 与八条硬纪律的关系

1. 零 schema：遵守——不加模型、字段、迁移；截断次数记在既有 JSON 位（步骤 `evidenceJson`、任务 `metadata`）。
2. 出站先审批：不涉及（没有对外发送）。
3. 禁止第三套队列：遵守——只在既有的 workforce runtime 里加判断，复用既有的交还队列、让出与链式自触发；不新增队列、调度、租约、worker 注册。自触发第 1 层的含义变了（见 G2），仍是同一个触发器、同一个深度上限与开关。
4. 脱敏：不涉及——不新增面向 Muse 的输出；时间预算本身不写进计划、步骤输出、交接、事件负载或任务元数据（沿用 `t5-p11-resumability.test.ts:353–360` 的纪律）。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守——不新增调用点；门槛是固定常量；开工门槛让注定被中止的请求不再发出。被截止中止的综合、规划、风险请求会在下一次调用里重发（今天被平台强制结束后的重跑同样会重发），次数受 D6 的上限约束；核验被截止时不重发（D5）。
8. 测试注册：两个新测试在同一个 task 里注册（CI 单测进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`，隔离库测试只进 `scripts/test-all.sh`），`bash scripts/check-test-registry.sh` 通过。

## 验证方式

- `npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts`：覆盖规格全部场景中不需要数据库的部分；先在改动前的代码上运行，看到失败（纯函数不存在、综合请求不带超时），输出贴进报告。
- 隔离库上 `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline-db.isolated.test.ts`：认领、开轮、t8 截止交还与接续、累计上限、规划截止。
- 既有测试通过数不变：
  - CI 子集里的 `obs-p1-latency-self-trigger.test.ts`；
  - `src/lib/tender-workforce/__tests__/t5-p11-resumability.test.ts`；
  - 隔离库上的 `phase2a-*.test.ts`、`p0-execution-alignment.test.ts`、`phase2b2-final-gate.test.ts`、`src/lib/tender-workforce/__tests__/t1b-integration.test.ts`。
  - 这些 DB 测试在没有 DATABASE_URL 时会直接跳过，要在隔离库上跑才算数。
- 门禁：
  - `npm run typecheck`、`npm run lint:baseline`；
  - `bash scripts/test-runtime-architecture.sh`（冻结区与引用方向）、`bash scripts/check-test-registry.sh`；
  - 按 CI 的环境变量跑 `bash scripts/test-ci-unit.sh`；
  - `npm test`（对照既有失败清单）；
  - `openspec validate workforce-invocation-deadline --strict`；
  - `git diff origin/main -- prisma/ vercel.json` 为空。

## Risks / Trade-offs

- [上限只依据一次 T1B 测量] → 生产更慢时，满预算下综合 180 秒仍不返回会按失败计次。与今天相比，失败更早出现，不再挂到 300 秒被强杀。上线后按 D8 的调用日志类别复核，见 G3。
- [被中止的请求照样计费] → 被截止中止的请求已经产生的输出照常计费，下一次重发再计一次；开工门槛与 D6 的上限限制了次数。
- [排队头阻塞] → 候选按 `createdAt` 升序（`processor.ts:778`）。较老的任务每次都用满 160 秒以上时，第二个任务在这些调用里一直排第二、不被认领。它不会永远卡住：老任务持租期间，重叠的定时触发拿不到老任务，会先认领它；自触发的子调用若在老任务 2 秒的回队延迟内启动，也会先拿到它。但第二个任务的开始可能晚几分钟。
- [没发出的请求不计次数] → 一个任务若每次都在剩余 80 秒左右被认领、下一步恰好是综合，每次都可能因门槛不发而让出、不前进。条件是它每次都排第二、而第一个任务每次都恰好用掉约 160 秒，概率低。上线后看 `tool.yielded` 里同一步连续 `deadline_skip` 的次数。
- [核验在晚到时跳过模型复核] → D5 的后果，只影响 LLM 规划的任务。
- [生产上 t8 失败的原因可能不是超时] → 本 change 之后 t8 仍可能因 400 / 输出不合格失败；降级与「从失败的这一步继续」归 FIX-20。
- [其它仍可能越过 300 秒的路径] → 见 proposal「Out of scope」（PERSIST、SDK 等待、t9 外部情报等），本次不保证。

## Migration Plan

无数据迁移、无开关，合并部署即生效；回滚 = 回退本 PR。

上线后观察：
- `/api/cron/agent-runs` 不再出现 300 秒的 504；
- 一次调用里 t+160 秒之后没有新的 `job.claimed`，t+180 秒之后没有新的 `job.lease_renewed`（每轮开头一条）；
- t8 被截止时有理由为 `INVOCATION_DEADLINE` 的 `tool.yielded`，下一次调用接着做完；
- 调用日志里 `workforce-synthesis` 的耗时分布，用来复核 180 / 60 秒。

FIX-12 报告 §6 让「两个项目一个一个地重新分析」，本 change 上线后不再需要，在 FIX-15 报告里写明。

## 留给 GATE

### G1 同一步被截止截断的次数上限

- **A（推荐）**：同一步被截止中止累计满 3 次后，再被截止就按既有失败规则计一次尝试；次数记在步骤 `evidenceJson.continuation`，规划记在任务 `metadata`；零 schema。
  - 后果：模型一直慢时，一步最多被截断 3 次，之后约 2 次尝试内以 `synthesis_failed` 结束，不会无限空转。3 与 FIX-12 窗口的 3 次上限是同一个数（Lucas 已同意那条）。
- **B**：不设上限，只记日志。
  - 后果：模型持续慢、任务又总在后半段开工时，这一步无限让出、每次都发一次注定被中止的请求，费用没有上限，用户看到的是一直「进行中」。
- **C**：每次截止都按失败计次（与 FIX-12 窗口相同）。
  - 后果：步骤尝试上限是 2，两次截止就失败，正是本 change 要避免的结果。
- 推荐 A：既不让截止吃掉仅有的 2 次尝试，又给空转封了顶。

### G2 自触发防风暴第 1 层的含义改变

- **A（推荐）**：接受。第 1 层从「本批有让出」变成「本批有让出，或有因时间不足留下的工作（未认领 / 因截止交还）」。
  - 后果：每一环子调用仍要真实用掉至少 160 秒（认领门槛）或 180 秒（开轮门槛）才会再触发；深度上限 25、开关、每次至多一次不变，不会形成风暴。`self-trigger.ts` 的注释与 OBS-P1 的说明同步改。
- **B**：不接受。删掉规格「留下工作时沿用链式自触发」一条与对应场景、D8 第二点。
  - 后果：留下的任务等下一次定时触发（最多 2 分钟）。
- 推荐 A：自触发已在生产上配置并验证（TASKFLOW CHAIN-0 第 1 项），多一个条件就能省掉这 2 分钟，且每一环都被真实耗时限速。

### G3 四类调用的上限与开工门槛取值

- 本稿取值（上限 / 开工最少）：综合 180 / 60 秒、风险旧分支 180 / 60 秒、规划 90 / 40 秒、核验 60 / 20 秒。
- **A（推荐）**：按本稿合并；上线一周后按 D8 新加的调用日志类别复核耗时分布，要调就另开小 change。
- **B**：先查生产日志再定。
  - 后果：综合调用现在不记类别，查不到；这期间 t8 继续不带超时。
- 推荐 A：现在没有任何生产耗时可依，等数据就要把 t8 不带超时的状态继续留在生产上。
