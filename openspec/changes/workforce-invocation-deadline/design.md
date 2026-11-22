# Design：数字员工的一次调用守住整次调用的截止时间

## Context

动机见 proposal.md「Why」。来源：FIX-12 报告 §7 第 1 条（其「另记」已把不带超时的调用更正为四处）、#540 合并前的第二轮独立审计、本 change 草稿的逐条代码核对与独立审查（2026-11-22）、Evan 2026-11-22「t8 的模型调用纳入 FIX-15 的整次调用截止时间（synthesis.ts 现在不带超时）」。下面的行号都按 main `2ef4f9c8`（已含 FIX-12）核对过。FIX-13（#546，按 `/home/user/wt/fix13` HEAD `f8cc2bdb` 核对）改的源文件在 `src/lib/files/**`、`src/lib/tender-auto-analysis/**`、`src/components/**`，与本 change 改的源文件不重叠；相邻处只有 `scripts/test-all.sh`、`scripts/test-ci-unit.sh` 各加两行注册、TASKFLOW「情报串联」表在 FIX-12 后加一行。FIX-17（`project-files-access-guard`）同样只在这两份注册脚本与 TASKFLOW 相邻。FIX-21、FIX-19 的 proposal 列出的改动文件也不含本 change 要改的文件，相邻处同样只有两份注册脚本与 TASKFLOW。

开工前提：合并顺序是 FIX-17 → FIX-21 → FIX-19 → …，FIX-15 排在 FIX-19 之后。FIX-19 合并后，先把 main 合入本分支再开工；合入后按新的 main 重新核对本文引用的行号，行号有出入只改行号，结论不变。

### 现在的调用链

1. 路由：`src/app/api/cron/agent-runs/route.ts:38–42` 从请求开始算 `executionBudget = { deadlineAt: 开始 + 240 秒, tickBudgetMs: 240 秒 }`；`:56–58` 定时触发先跑没有上限的 `processQueuedAgentRuns(2)`（`:45` 注释记着它实测约 48 秒），链式自触发的调用跳过它；`:59` 把预算交给 `processQueuedWorkforceJobs(2, …)`；`:67–77` 只在 `yieldedContinuations > 0` 时安排自触发。
2. 队列循环：`src/lib/workforce-runtime/processor.ts:763–781` 一次查出候选（`createdAt` 升序，最多 limit 个），`:785–791` 逐个调用 `processWorkforceJobSlice`，认领前不看截止。任务尝试次数只在认领时 +1（`src/lib/agent-runtime/lease.ts:79–81`）。
3. 时间片：`processor.ts:213–215` 认领后读出任务行与 metadata；`:317` 记 `processingStartedAt`（认领、清扫回收、身份校验之后），`:472–474` 每轮前只判断「本任务已用时 > 45 秒」（`:50`）。首个时间片的规划在轮次循环之前（`:323–373`），不受轮次门约束；规划失败在 `:407` 抛错，由 `:643–660` 走任务级重试（上限 5 次，`:48`；退避 15 / 60 / 180 / 600 秒，`:53`）。
4. 每一轮：`processor.ts:500–509` → `src/lib/agent-runtime-v2/process.ts:176–237` → 数字员工一律走批路径（`src/lib/agent-runtime-v2/executor.ts:312–331`）→ `executeClaimedWorkforceStep`（`:1494`）。工具调用带预算（`:1595`）；**综合调用 `:1569–1577` 不带预算**；`ExecuteSynthesisTaskInput`（`src/lib/workforce-runtime/synthesis.ts:183–193`）没有这个字段，结果类型（`:82–88`）没有 continuation，`executor.ts:643` 的注释写明「不给它开让出能力」。
5. 让出：批路径 `executor.ts:1612–1658` 把步骤放回 ready、尝试次数回滚到认领前（`row.attemptCount − 1`），并把 `evidenceJson` **整块改写**为 `{ continuation: { reason, phase, ticks } }`（`:1631–1637`）；`processor.ts:520–523` 记 `sawYield` 并结束轮次；`:621–642` 交还队列（任务尝试次数置 0、2 秒后可再认领），事件 payload 带 `yielded`。失败分支（`executor.ts:1661–1689`）可重试时只写 `status` 与 `errorMessage`，不动 `evidenceJson`。
6. 核验：`process.ts:220–225`、`:259–264` 调 `verifyRuntimeV2Run` 不带预算；`src/lib/agent-runtime-v2/verifier.ts:317–323` 全部完成标准都是 tool_result 且带 evidenceStepIds 时不调模型；`:229–263` 模型复核只在确定性结论为 PASS 时发生，出任何错都退回确定性结论；确定性核验对不是 tool_result 的完成标准直接跳过（`:149`）。
7. 四处不带超时的模型调用：规划 `planner.ts:326`、核验 `verifier.ts:231`、综合 `synthesis.ts:239`、风险分析旧分支 `src/lib/tender-workforce/tools.ts:871`。`createCompletion` 不传 `timeoutMs` 时不设计时器（`src/lib/ai/client.ts:191–194`），费用预检在计时器之前（`:173–186`）；openai 6.32.0 默认每次 10 分钟、重试 2 次（`node_modules/openai/client.js:138、148`），对 300 秒等于没有上限。
8. 本方计时器到点时 SDK 抛 `APIUserAbortError`（`node_modules/openai/client.js:293–302`）；这个类没有设置 `name`（`node_modules/openai/core/error.js:72–76`），只能按类判断。已经收到响应头、正在读响应体时被中止，抛出的是名为 `AbortError` 的 DOMException，不是 SDK 的类。
9. 被强制结束两次就失败：步骤尝试上限 2（`src/lib/agent-runtime-v2/flags.ts:74`、`persist.ts:70`）；步骤认领时 +1（`executor.ts:1273–1283`）；下一次认领时的回收（`processor.ts:241–277`）把用尽的步骤记为 `stale_running_exhausted`。
10. 耗时在生产库里有：每次工具 / 综合执行都写 `tool.started`（`executor.ts:1550–1555`）与 `tool.completed`（`:1812`）/ `tool.failed`（`:1680`）/ `tool.yielded`（`:1644`），载荷里的 `toolCallId = 步骤:第几次` 能配对，事件有 `createdAt`；规划可用 `job.claimed` → `plan.created`（`persist.ts:113`），核验可用 `verification.started`（`verifier.ts:302`）→ `verification.passed` 等。合并前用 `docs/acceptance/fix-15/prod-check.sql` B 段算（B1 t8 与 t5 每次尝试按结果分组的耗时分布，t5 分「只读投影」与「旧分支调模型」；B2 最长的 20 次；B3 规划；B4 规划失败后走任务级重试的 Job 数），用法见 Migration Plan「合并前」。B3 用「第一次 `job.claimed` → 第一条步骤行写入」近似规划耗时，是上界。

### 现行一键分析路径上谁会调模型

- 一键分析用服务端固定的 9 步确定性计划（`src/lib/tender-workforce/deterministic-plan.ts`）。计划在入队前就写好（`src/lib/workforce-runtime/job.ts:68–69、271–283`），所以 `processor.ts:323` 跳过规划；三条完成标准都是 tool_result 且带 evidenceStepIds（`deterministic-plan.ts:239–260`），所以核验不调模型；t5 风险分析走投影分支（`tools.ts:750–797`）。**四处里只有 t8 综合汇总（`deterministic-plan.ts:184–208`）在现行路径上调模型**，所以它是本 change 的首要场景。同一路径上另有两处调模型、不在这四处之内：t3 的 canonical V2 分析（FIX-12 已限时）与 t9 收尾的外部情报（受开关控制，`tools.ts:1093–1100`、`:1250–1257`，见 proposal「Out of scope」）。
- 规划、模型复核、风险旧分支只出现在 LLM 规划的任务上（确定性计划开关关着的招标任务、销售等其它域）。
- 「生产开着确定性计划」是推断：2026-11-20 出事的「第 3 步」是 canonical V2 切片（FIX-12 报告 §1），而 `tender_analyze_package_v2` 只在确定性计划的工具集里（`tools.ts:110–119`；LLM 规划可见的工具集 `:87–95` 不含它）。开关的生产值本身没有核对。

### 2026-11-22 生产上 t8 失败的原因：模型账户余额不足，归 FIX-20

- 事实：2026-11-22「12-3 Indoor Canadian Flag」那次一键分析，Vercel 日志 16:40:31（多伦多）起的模型请求全部是 OpenAI 429「no credits remaining」，t8 在其后失败。
- 归属：这一类（模型账户余额不足导致的模型请求失败）归 FIX-20（失败降级、失败通知写那一步自己的原因），不归 FIX-15。本 change 只改变「模型请求超过整次调用的时间」这一类：超时、截止让出、开工门槛。429 照旧按既有失败规则计次（`synthesis.ts:248–255` 返回 `SYNTHESIS_MODEL_FAILED`，步骤错误码 `synthesis_failed`），本 change 之后这次失败的结果不变。「被中止」只按错误类型判定（D1），429 不会被当成截止中止。
- 生产事件层面的确认：用 `docs/acceptance/fix-15/prod-check.sql` A 段（A1 这次 Job、t8、t9 与分析记录；A2 t8 每次尝试的错误原文；A3 同一时段所有 `tool.failed`），结果回来写进 FIX-15 报告。预期 t8 的 `errorMessage` 以 `SYNTHESIS_MODEL_FAILED` 开头、文字里有 429 / no credits。若 A 段显示 t8 的错误码是 `stale_running_exhausted`（两次被 300 秒强制结束），报告照实更正原因：那种情形正是本 change 要防的。

## Goals / Non-Goals

**Goals:**
- 一次带预算的调用里，t8 综合汇总的模型请求不越过「截止 − 15 秒」，被截止中止时不消耗尝试次数、下一次调用接着做。
- 规划、风险旧分支、核验三处同样带上不越过截止的超时；可用时间不够时不发注定被中止的请求。
- t+160 秒（240 − 80）之后不再认领新任务，t+180 秒（240 − 60）之后不再开新一轮。
- 被截止截断的工作不算失败，但同一步被截断的累计次数有上限，中间的让出不清零，不会无限空转。

**Non-Goals（不动的模块 / 文件）:**
- `src/lib/ai/client.ts`、`src/lib/ai/retry.ts`、`src/lib/ai/monitor.ts`：不改（`createCompletion` 的计时方式、签名、费用预检位置、SDK 重试等待、调用日志字段都不变）。
- `src/lib/tender-auto-analysis/**`（含 `worker.ts` 的 45 秒认领门槛）、`src/lib/tender-understanding/**`、`src/lib/ai/model-policy/tender.ts`（FIX-12 的范围）：不改；`v2-cursor.ts` 的门槛（`V2_PHASE_MIN_MS`、`PHASE_SAFETY_MS`、`HARD_MIN_PHASE_MS`）只被引用为依据，不改数值。
- `src/lib/workforce-runtime/constants.ts` 的 `AGENT_RUNS_INVOCATION_BUDGET_MS`、`WORKFORCE_CONTINUATION_MAX_DEPTH`；`processor.ts` 的 `WORKFORCE_SLICE_BUDGET_MS`、`WORKFORCE_MAX_ROUNDS_PER_SLICE`、`WORKFORCE_LEASE_MS`、`WORKFORCE_MAX_ATTEMPTS`、`CONTINUATION_DELAY_MS`：数值不改。
- `src/lib/agent-runtime/lease.ts`（认领、续租、防栅栏）、`src/lib/agent-runtime/run.ts`（`mergeAgentRunMetadata`）、`processor.ts` 的清扫（`stale_running_exhausted`）与候选查询：不改。
- `processor.ts` 的 `kickQueuedWorkforceJobSlice` 预算起点、`src/lib/agent-runtime/queue.ts`（`processQueuedAgentRuns`）、`src/lib/tender-intel/orchestrate.ts`（t9 外部情报）、`src/lib/tender-workforce/v2-persist-workforce.ts`（落库事务）、`src/lib/tender-auto-analysis/page-parse.ts`（t2 解析）：不改。
- `executor.ts` 的单步路径（`:333` 起，其中综合调用在 `:596`；只有不带预算的旧 runtime_v2 走）：不改。
- 新文件不放进 `src/lib/agent-runtime-v2/`（冻结区），`agent-runtime-v2` 不新增对 `workforce-runtime` 的引用（见 D1）。
- `vercel.json`、`prisma/**`、`src/lib/runtime-architecture/runtime-architecture-baseline.json`：不改。

## Decisions

### D1 门槛、超时、「被中止」与累计次数的判定放在一处纯函数，在 `agent-runtime-v2/flags.ts`

`flags.ts` 里新增常量（安全余量 15 秒、认领门槛 80 秒、开轮门槛 60 秒、退化门槛 10 秒、四类调用的上限与开工门槛、截断次数上限 3）和四个纯函数：

- 剩余时间够不够做某件事（含「预算本身小于门槛时退为 10 秒」）；
- 这次模型请求发不发、超时多少、是不是截止在起作用（含开工门槛的退化：预算 − 15 秒小于开工门槛时用 10 秒）；
- 一次请求是不是被中止：错误是 SDK 的 `APIUserAbortError` 实例，或是名为 `AbortError` 的错误（读响应体时被中止的 DOMException、测试注入口抛的错误），两种形态都算，不看错误文案；
- 累计截断次数怎样记：给定已有次数与这次让出的理由、阶段，回答写回多少、要不要转为失败（见 D6）。

四处调用点、执行器与处理器都只用它们。

- 依据：`agent-runtime-v2` 是冻结区，新文件要过基线评审（`src/lib/runtime-architecture/runtime-architecture-baseline.json` 的 `frozenAreaFiles`）；`agent-runtime-v2 → workforce-runtime` 的引用只许减不许增（`src/lib/runtime-architecture/guards.ts:138、259–271`）。`flags.ts` 现在不引用 `src/lib` 下任何模块，规划、核验、执行器、处理器已经引用它（`planner.ts:3`、`verifier.ts:8`、`executor.ts:20`、`processor.ts:21`）；综合（`workforce-runtime → agent-runtime-v2`）与风险工具（`tender-workforce → agent-runtime-v2`）新增引用不在禁止方向里（`guards.ts:137–172`）。它也是 `getRuntimeV2Limits` 所在的地方，这些门槛属于同一类运行时限额。
- 新增的一处 `openai` 引用只取错误类，是第三方包，不在守卫的引用方向表里；`agent-runtime-v2/index.ts` 转出 `flags.ts`，但仓库里没有任何文件引用这个 index。
- 否决：新建 `src/lib/workforce-runtime/invocation-budget.ts`。规划、核验、`process.ts` 引用它会新增被禁止方向的边，`bash scripts/test-runtime-architecture.sh` 失败。
- 否决：各调用点各自算、各自判定「被中止」。四处口径会漂移（例如只认 SDK 的类、漏掉读响应体时的 `AbortError`），纯函数单测也测不到。
- 否决：「被中止」放进 `src/lib/ai/client.ts`。`client.ts` 是本次的 Non-Goal；它的签名与抛错方式不变时，调用方仍要自己判定。

### D2 t8 综合汇总：带超时，被截止中止就交还队列（首要场景）

- 可用时间 = 截止 − 15 秒 − 现在。可用时间不足 60 秒（预算 − 15 秒小于 60 秒时用 10 秒）：不发请求，返回 continuation（理由 `INVOCATION_DEADLINE`，阶段 `deadline_skip`）。否则超时 = min(180 秒, 可用时间)；开工时记下「可用时间 < 180 秒」（截止在起作用）。
- 请求以「被中止」结束（D1 的判定）且开工时截止在起作用：返回 continuation（理由 `INVOCATION_DEADLINE`，阶段 `deadline_cut`，`ok` 为 true，与 t3 让出 `tools.ts:1348–1363` 同形），不返回错误。批路径既有的让出分支（`executor.ts:1612–1658`）把步骤放回 ready、尝试次数不变；处理器按既有的「有让出」交还队列、自触发。下一次调用从这一步重新发请求。
- 180 秒上限在起作用时被中止、模型返回错误、输出不合格：照旧返回 `SYNTHESIS_MODEL_FAILED` / `SYNTHESIS_INVALID_OUTPUT`（`synthesis.ts:248–282`），按既有失败规则计次。
- 判定「截止在起作用」在开工时就定下，不在中止时再量剩余时间（避免上限与可用时间相近时误判）。
- 数值依据：唯一的实测是 T1B 端到端（15 页文件、旧模型）综合 19.7 秒（`docs/QINGYAN_TENDER_T1B_WORKFORCE_INTEGRATION_REPORT.md:202–204`）。180 秒约为它的 9 倍，60 秒约 3 倍。合并前用 `prod-check.sql` B 段的生产耗时按 G3 已定的规则确认（Migration Plan「合并前」）；按规则要调时，本节与 Risks 里由 180 秒推出的数（「开工时剩余 195 秒以上」「180 到约 285 秒」）一并改。上线一周后再用 B 段复核一次。
- 结果类型加可选 continuation（与工具的 `ToolContinuation` 同一个类型）；`adapters.ts` 的理由多一个取值 `INVOCATION_DEADLINE`，原有 `TIME_BUDGET_YIELD` 字样保留（`t5-p11-resumability.test.ts:65–68` 的断言不变）。
- 后果：截止在起作用要求开工时剩余不到 195 秒。开工早（剩余 195 秒以上）的 t8 模型一直不返回，被 180 秒上限按失败计次；开工晚的按截断记，不按失败记。定时触发的调用先跑 `processQueuedAgentRuns`：旧队列为空时只是两次查询（`src/lib/agent-runtime/queue.ts:288–323`）；有任务时路由注释记着实测约 48 秒（`route.ts:45`），那时首个任务的 t8 开工时剩余已不到 195 秒，模型一直不返回只会按截断记。
- 否决：只靠认领 / 开轮门槛，不给综合加超时。门槛只保证开工时有 60 秒以上，综合本身没有上限。
- 否决：被截止中止时按既有失败计次。步骤尝试上限是 2，两次截止就以 `synthesis_failed` 失败——正是要避免的结果。
- 否决：给综合做像 t3 那样的分段检查点。综合是一次模型调用，没有能保存的中间结果。

### D3 规划：被截止中止时走处理器里的正常交还队列

- 处理器在 `processor.ts:363` 把预算传给规划；上限 90 秒，可用时间不足 40 秒（预算 − 15 秒小于 40 秒时用 10 秒）不发。没有发出或被截止中止时，规划返回带「截止」标记的失败；处理器不在 `:407` 抛错，跳过轮次循环，改走 `:621–642` 那段既有的交还队列（任务尝试次数置 0、2 秒后可再认领、不写计划），事件 payload 加 `invocationDeadline: true`。其它失败照旧走 `:643–660` 的任务级重试。
- 累计次数 `plannerDeadlineCuts` 写进这同一次带防栅栏的交还写入：以 `processor.ts:213–215` 认领后读到的 metadata 为底，加上新的次数一起写回；不另调 `mergeAgentRunMetadata`（它不过防栅栏，`src/lib/agent-runtime/run.ts:269–285`）。规划被截止时任务还没有计划、步骤与审批，审批时记审批人的那处 metadata 写入（`src/lib/agent-runtime-v2/principal.ts:111–136`）不会发生；以认领后的读数为底，丢别人写入的窗口只剩这一次时间片之内。
- 数值依据：T1B 规划 20.1 秒（同一报告 `:201`）。合并前用 `prod-check.sql` B3 按 G3 已定的规则确认。
- 后果：
  - 这类任务没有计划也没有步骤，任务列表按既有规则显示为「排队中」（`src/lib/workforce-runtime/read-model/projection.ts:99–104` 投影为 QUEUED，`src/app/(main)/workforce/presentation.ts:39` 显示为「排队中」），与尚未开始的任务相同。
  - 开工时剩余 105 秒以上的规划（例如一次调用里第一个被认领的任务），耗时 90 秒以上今天能成功，本 change 之后按失败走任务级重试（G3）。
- 否决：按既有失败走任务级重试。每次截止都累计任务尝试次数（上限 5）并退避 15 秒起。
- 否决：不给规划加超时。认领门槛只保证开工时有 80 秒，规划本身没有上限。

### D4 风险分析旧分支：直接用 `ctx.executionBudget`

- `tools.ts:799` 之后的旧分支从 `ctx.executionBudget` 取预算（工具上下文已经带着，`executor.ts:1595`），上限 180 秒，可用时间不足 60 秒（预算 − 15 秒小于 60 秒时用 10 秒）不发；没发出或被截止中止时返回 continuation（同 D2，`ok` 为 true，与 t3 让出 `tools.ts:1348–1363` 同形）。投影分支（`:750–797`）不调模型，不变。
- 旧分支在模型调用之前只读库（`:799–832`），中止后重做不会重复写入。
- 数值依据：T1B 风险分析 12.1 秒。合并前用 `prod-check.sql` B1 的 `t5_legacy_or_unknown` 按 G3 已定的规则确认。
- 否决：删掉旧分支。确定性计划开关关上时（回滚路径）仍要用，不在本次范围。

### D5 核验：保持既有的确定性回退，不新增让出信号

- `process.ts` 两处核验调用传预算；需要模型复核时上限 60 秒，可用时间不足 20 秒（预算 − 15 秒小于 20 秒时用 10 秒）不发。没有发出或被中止时，走既有的退回确定性结论（`verifier.ts:261–262`），任务照常收尾。
- 后果：一个 LLM 规划的任务若最后一步结束时剩余不足 35 秒，这次不做模型复核，按确定性结论完成。确定性核验对不是 tool_result 的完成标准直接跳过（`verifier.ts:149`），所以这类任务里要模型判断的完成标准这一次没人看过。现行一键分析不受影响（不调模型复核）。
- 否决：新增让出信号（核验 → `process.ts` → 处理器交还队列，下一次重新核验）。核验在调模型之前已经写了 `verifying` 状态与「正在验证」事件（`verifier.ts:293–304`），要撤回；三层都要加新的返回值。新增信号还会让同一次核验多跑一次模型，方向与第 7 条相反。
- 否决：核验前看剩余时间，不够就先不核验、留到下一轮。做法是在 `verifier.ts:293–304` 写 `verifying` 状态与事件之前判定，直接返回；运行状态不变，处理器下一轮被 60 秒开轮门槛挡住、交还队列，下一次调用满预算再核验。它只改 `verifier.ts`、不加让出信号，模型复核照做。不选的理由：
  - 要在写 `verifying` 之前把「要不要模型复核」（`verifier.ts:317–323` 的判断）提前，改了核验的写入顺序；
  - 任务要多等一次调用才收尾（G2 已定 A：等链式自触发的下一次调用，CHAIN-0 的目标是让出到再认领 15 秒内；若选 B，最多 2 分钟），多占一次认领；
  - 复核出错就退回确定性结论是既有规则，本 change 只管时间，不改核验的语义——时间不够按同一条规则处理。
- 否决：不给核验加超时。同 D3。

### D6 被截止截断的累计次数（G1 已定 A，Lucas 2026-11-22）

- 步骤：批路径在 `if (batchContinuation)` 之前，从认领后的行 `row.evidenceJson.continuation.deadlineCuts` 读出已有次数，交给 D1 的累计函数：
  - 理由为 `INVOCATION_DEADLINE`、阶段为 `deadline_cut`：已有不足 3 次就 +1，走让出；已有 3 次就不走让出，改成失败（错误以 `INVOCATION_DEADLINE_REPEATED` 开头），进既有失败分支计一次尝试。
  - 其它任何让出（`deadline_skip`、`TIME_BUDGET_YIELD`）：次数不变。
- **所有让出写 `evidenceJson.continuation` 时都原样带上已有的 `deadlineCuts`**：让出分支会整块改写 `evidenceJson`（`executor.ts:1631–1637`），不带上就会把次数清零，「截断 → 没发出 → 截断」交替出现时上限会被反复绕过。失败分支不动 `evidenceJson`（`:1661–1689`），按失败计次之后次数仍是 3，下一次再被截止仍按失败计次。
- 规划：次数记在任务的 `metadata.plannerDeadlineCuts`（写法见 D3）；没发出不计；满 3 次后再被截止就走既有任务级重试。
- 与既有源码断言共存：计数放在 `if (batchContinuation)` 之前，块内回滚尝试次数、不写 completedAt 的写法与位置不变（`t5-p11-resumability.test.ts:73–112` 的 600 / 900 字符窗口）；`deadlineCuts` 加在 `continuation` 对象里 `ticks` 之后，在两个窗口的终点之后；执行器里不出现 `ok: false, continuation` 字样（`:69–71`）。
- 否决：把次数并进既有的步骤尝试次数（G1 的 C）。步骤尝试上限是 2，两次截止就失败。
- 否决：给步骤或任务加一个专门的计数字段。违反硬纪律第 1 条；既有的 `evidenceJson` / `metadata` 已经够用。
- 否决：只在 `deadline_cut` 时写次数、其它让出照旧整块改写。会清零，见上。
- 其余选项与后果见「留给 GATE」G1。

### D7 认领门槛 80 秒、开轮门槛 60 秒，预算不足时退为 10 秒

- 认领：`processor.ts:785–791` 的循环里，每次调用 `processWorkforceJobSlice` 之前判断；不足 80 秒就停止循环，这个任务和其后的都不认领，计 `skippedForBudget`；不写任何状态或事件。
- 开轮：`processor.ts:474` 既有的 45 秒判断旁边加一条；不足 60 秒就结束时间片，走 `:621–642` 的交还队列（任务尝试次数置 0），事件 payload 加 `invocationDeadline: true`，时间片结果标 `deadlineRequeued`。
- 80 秒与 FIX-12 的窗口开批门槛对齐（`src/lib/tender-auto-analysis/v2-cursor.ts:217`），并高于开轮门槛：认领到第 0 轮之间还有身份校验、清扫回收、事件写入，刚过门槛的认领不会在第 0 轮前就被打回。80 − 15 = 65 秒也够 t8 的 60 秒开工门槛。
- 退化：预算本身小于门槛时门槛退为 10 秒，与 FIX-12 的阶段门槛同一做法（`v2-cursor.ts:229–251` 的 `HARD_MIN_PHASE_MS`、`canStartPhase`），预算很小的测试或脚本不会永远不认领。四类调用的开工门槛同样退化（预算 − 15 秒小于开工门槛时用 10 秒），规格四条调用要求各有一个场景。
- 与 FIX-12 门槛的关系：开轮门槛 60 秒低于 t3 的窗口开批 80 秒、Analyst 第一遍 180 秒，在剩 60–80 秒时开的 t3 轮会立刻以 `TIME_BUDGET_YIELD` 让出，不发请求；与 PERSIST 的 60 秒相同，PERSIST 自身的越界见 proposal「Out of scope」。
- 即时推进（`kickQueuedWorkforceJobSlice`，`processor.ts:688–697`）只推进一个任务，不经认领循环；它带预算，所以开轮门槛与四类调用的超时对它同样生效。
- 否决：沿用旧管线的 45 秒（`src/lib/tender-auto-analysis/worker.ts:1019`）。低于窗口开批的 80 秒，招标任务认领后会立刻让出（FIX-12 报告 §7「另记」已记）。
- 否决：认领与开轮同为 60 秒。刚过门槛的认领可能在第 0 轮前就被打回，白占一次认领与一组事件。
- 否决：把 `sliceBudgetMs` 改成按整次调用算。会改变不带预算的调用方（同步入口、脚本）。

### D8 报告与接续（G2 已定 A，Lucas 2026-11-22）

- `processQueuedWorkforceJobs` 多返回 `skippedForBudget`（未认领）与 `deadlineContinuations`（开轮门槛结束的时间片、规划被截止或没发出）。路由的响应已整体带出 `workforce` 对象（`route.ts:80`）；自动化运行记录元数据加 `workforceSkippedForBudget`、`workforceDeadlineContinuations`。既有的 `workforceYieldedContinuations` 只计让出（含综合、风险的截止 continuation），不混入。
- 自触发：`shouldFireContinuationTrigger` 多一个可选输入（两类剩余工作之和），它与 `yieldedContinuations` 任一大于 0 即满足第 1 层；其余四层（每次调用至多一次、深度上限 25、开关、child 鉴权）不变；`self-trigger.ts:19–26` 的注释改写第 1 层的含义。OBS-P1 的既有断言不变（`obs-p1-latency-self-trigger.test.ts:205–257`，处理器里 `sawYield` 那一行与交还队列那段 data 原样保留）。
- 调用日志类别不在本 change 里做：G4 已定 C，另开小 change，与 FIX-12 报告 §7「另记」的 `retryCount` 口径一起做（登记见 tasks 3.2）。
- 否决：等下一次定时触发（每 2 分钟，`vercel.json:68–69`）。能用，但两个项目连着重跑时第二个会多等最多 2 分钟。
- 否决：新增「延后」状态或调度。违反硬纪律第 3 条。

### D9 测试：纯函数与源码断言进 CI，认领与尝试次数用隔离库

- CI 单测 `invocation-deadline.test.ts`（不连库；注册行带 `NODE_ENV=test` 前缀，综合注入口只在这个值下可用，`synthesis.ts:170–181`）：
  - 纯函数：门槛与退化；四类调用的发不发、超时、截止是否起作用，以及开工门槛的退化；「被中止」的两种形态（`APIUserAbortError` 实例、名为 `AbortError` 的 DOMException 与普通错误）为真，其它错误（含 SDK 自己的连接超时、429 限流与余额不足）为假；累计函数「截断 2 次 → 没发出 1 次 → 再截断」得 3、第 4 次截断转为失败。数值与规格场景一一对应。
  - 直接调用综合：用注入口记下收到的超时、按需抛出 `AbortError`；注入口抛 429 余额不足的错误时，综合返回错误、不返回 continuation。
  - 源码断言：认领门槛在循环里、`processWorkforceJobSlice` 之前；开轮门槛在轮次循环开头；处理器把预算传给规划；`process.ts` 两处核验传预算；批路径把预算传给综合；让出分支写 `evidenceJson.continuation` 时带上 `deadlineCuts`；风险旧分支用 `ctx.executionBudget`；核验的 catch 仍退回确定性结论；路由把两个计数写进元数据、交给自触发判定。
- 隔离库测试 `invocation-deadline-db.isolated.test.ts`（只进全量），沿用 `src/lib/workforce-runtime/__tests__/helpers.ts` 与 `p0-execution-alignment.test.ts` 的夹具做法：
  - 认领门槛与开轮门槛（断言只看本夹具的任务，`skippedForBudget` 与本次候选数核对）；
  - t8 被截止后交还、下一次接着做完；
  - 累计：截断 2 次 → 没发出 1 次 → 再截断，库里 `deadlineCuts` 为 3、步骤仍 ready、尝试次数不变；再截断一次按失败计次，错误以 `INVOCATION_DEADLINE_REPEATED` 开头；
  - 规划被截止后交还，`plannerDeadlineCuts` 随交还写入。
  - 风险分析旧分支要整套招标夹具，不进这个测试：它与 t8 共用批路径的让出分支（隔离库里由 t8 覆盖），自己的那一段由 CI 单测的纯函数与源码断言覆盖。
- 不注入时钟：用 `executionBudget.deadlineAt = Date.now() + N` 造出临近截止；开工时就定下「截止是否起作用」，注入口立刻抛错即可，不用真等。处理器与认领都直接用 `Date.now()` / `new Date()`，注入时钟要改的地方太多。
- 注入口：
  - 综合（`synthesis.ts:160–181`）与风险（`tools.ts:466–489`）的注入口参数加 `timeoutMs`，既有注入口不读它就行（`p0-execution-alignment`、`t1b-integration` 不变）。
  - 规划、核验各加一个仅 `NODE_ENV=test` 生效的注入口（仿 `synthesis.ts:170–181`）。
  - 注入口拿不到 signal：`createCompletion` 自己建 AbortController（`client.ts:191–194`），`client.ts` 不改；注入口用「抛出名为 `AbortError` 的错误」模拟被计时器中止。
- 否决：全部用隔离库。工作队列的夹具（`helpers.ts:15–32`）只在没有 `DATABASE_URL` 时跳过，CI 给了占位连接串（`.github/workflows/ci.yml:26–30`）却不起数据库，注册进 CI 子集会连库失败。
- 否决：注入时钟。见上。

## 与八条硬纪律的关系

1. 零 schema：遵守——不加模型、字段、迁移；截断次数记在既有 JSON 位（步骤 `evidenceJson`、任务 `metadata`），这两处已有同类写法（`evidenceJson.continuation` 由 T5-P1.1 引入，`metadata.plannerLlmCalls` 在 `processor.ts:435–442`）。
2. 出站先审批：不涉及（没有对外发送）。
3. 禁止第三套队列：遵守——只在既有的 workforce runtime 里加判断，复用既有的交还队列、让出与链式自触发；不新增队列、调度、租约、worker 注册。自触发第 1 层的含义变了（见 G2），仍是同一个触发器、同一个深度上限与开关。
4. 脱敏：不涉及——不新增面向 Muse 的输出；时间预算本身不写进计划、步骤输出、交接、事件负载或任务元数据（沿用 `t5-p11-resumability.test.ts:353–360` 的纪律）。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守——不新增调用点、不新增模型用途；门槛是固定常量。与今天比调用次数有增有减，照实列出：
   - 减：开工门槛让注定被中止的请求不再发出；核验被截止时不重发（D5）。
   - 增：被截止中止的综合、规划、风险请求在下一次调用里重发。今天本来会在 t+225 到 t+300 秒之间返回成功的请求，今天调一次，本 change 之后调两次；超过 300 秒的今天也会被强杀后重跑。重发与既有的「步骤失败后重试」同类，同一步最多被截断 3 次（D6、G1）。
8. 测试注册：两个新测试在同一个 task 里注册（CI 单测进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`，隔离库测试只进 `scripts/test-all.sh`，注册行都带 `NODE_ENV=test`），`bash scripts/check-test-registry.sh` 通过。

## 验证方式

- `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts`：覆盖规格全部场景中不需要数据库的部分；先在改动前的代码上运行，看到失败（纯函数不存在、综合请求不带超时），输出贴进报告。
- 隔离库上 `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline-db.isolated.test.ts`：认领、开轮、t8 截止交还与接续、累计次数跨让出保留与上限、规划截止。
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

- [180 秒上限把一部分今天的成功变成失败] → 只在开工时剩余 195 秒以上时起作用（调用一开始就轮到 t8 的情形，例如链式自触发的调用、旧队列为空的定时调用）：耗时 180 到约 285 秒的综合与风险旧分支请求今天能在 300 秒内返回，本 change 之后按失败计次，两次就以 `synthesis_failed` 失败；耗时 90 秒以上的规划改走任务级重试。上限现在只依据一次 T1B 测量；合并前按 G3 已定的规则用 `prod-check.sql` B 段的生产耗时确认，要调就在合并前调（Migration Plan「合并前」）。
- [被截止中止的请求多调一次] → 今天在 t+225 到 t+300 秒之间返回的请求，本 change 之后被中止、下一次重发；已经产生的输出照常计费。开工门槛与 D6 的上限限制了次数。
- [旧队列有任务时，定时触发里的 t8 多按截断记] → 路由先跑 `processQueuedAgentRuns`，有任务时实测约 48 秒，首个任务的 t8 开工时剩余不到 195 秒，模型一直慢时按截断记、不按失败记；没有链式自触发时，要先截断 3 次才开始按失败计次（G1）。旧队列为空时这一段只有两次查询，与链式调用相同。
- [排队头阻塞] → 候选按 `createdAt` 升序（`processor.ts:778`）。较老的任务每次都用满 160 秒以上时，第二个任务在这些调用里一直排第二、不被认领。最坏情况：第二个任务要等第一个任务整个跑完才开始。两个项目可以同时发起，实际仍按先后一个一个跑。
  - 补充：第二个任务可能更早被认领。老任务持租期间，重叠的定时触发拿不到老任务，会先认领它；自触发的子调用若在老任务 2 秒的回队延迟内启动，也会先拿到它。这两种情形都不保证出现。
- [没发出的请求不计次数] → 一个任务若每次都在剩余 80 秒左右被认领、下一步恰好是综合，每次都可能因门槛不发而让出、不前进。条件是它每次都排第二、而第一个任务每次都恰好用掉约 160 秒，概率低。另有一种必然出现的情形：开轮门槛 60 秒低于 t8 与风险旧分支实际需要的 75 秒（60 + 15），在剩 60–75 秒时开的这一轮必然 `deadline_skip`，不发请求、无害，下一次调用接着做。上线后看 `tool.yielded` 里同一步连续 `deadline_skip` 超过 2 次的情况，前一种情形才算异常。
- [核验在晚到时跳过模型复核] → D5 的后果，只影响 LLM 规划的任务；要模型判断的完成标准这一次没人看过。
- [2026-11-22「12-3」那次 t8 失败不是超时] → 原因是模型账户余额不足（Vercel 日志 16:40:31 多伦多起全部是 OpenAI 429「no credits remaining」，见 Context）。本 change 不修这次失败：之后同类失败（余额不足、400、输出不合格）照旧按失败计次，结果不变；失败降级、失败通知写那一步自己的原因、「从失败的这一步继续」归 FIX-20。
- [其它仍可能越过 300 秒的路径] → 见 proposal「Out of scope」（PERSIST、写检查点的事务、SDK 等待、费用预检、旧管线、即时推进的预算起点、旧队列、t9 外部情报、t2 首次解析），本次不保证；每一条在 TASKFLOW 各登记一行（tasks 3.2）。

## Migration Plan

无数据迁移；**没有开关，合并部署即在生产生效**；回滚 = 回退本 PR。

开工前：FIX-19 合并后把 main 合入本分支再开工（合并顺序 FIX-17 → FIX-21 → FIX-19 → …，FIX-15 排在 FIX-19 之后），见 Context「开工前提」。

合并前（G3 已定的前提，tasks 3.1 的必做项）：

1. 把 `docs/acceptance/fix-15/prod-check.sql` 交给有生产库只读权限的人跑（本会话没有生产库权限）。全文在 `BEGIN READ ONLY; … ROLLBACK;` 里，只有 SELECT。A、B 两段结果原样贴回，写进报告。
2. 按 B 段确认上限，规则写死：
   - t8 综合：B1 里 `kind = t8_synthesis`、`outcome = completed` 那一行的 `max_s`（已成功的最长一次）≤ 150 秒 → 维持 180 / 60；超过 → 上限调到「这个 `max_s` + 30 秒」，不超过 225 秒。
   - 风险旧分支：与 t8 同为 180 / 60，按同一条规则看 B1 里 `kind = t5_legacy_or_unknown`、`outcome = completed` 那一行；没有这一行就维持 180 / 60，报告写明「生产上没有风险旧分支的成功记录」。
   - 规划：B3 各域 `max_s` 中最大的那个 ≤ 75 秒 → 维持 90 / 40；超过 → 上限调到「这个值 + 30 秒」，不超过 225 秒。B3 是上界：从第一次认领算起，规划前被交还或重试过的 Job 还含等待时间。超过 75 秒时，先另写一条只读 SELECT 看那个 Job 的 `job.claimed` → `plan.created`（`persist.ts:113`），确认是一次规划的耗时，再按规则定；SELECT 原文写进报告。
   - 「已成功的最长一次」只取 B1 / B3，不取 B2：B2 的配对不把下一次 `tool.started` 当作结束，被强制结束的那次会和下一次尝试的结束事件配成一对，耗时跨了两次尝试。
   - 要调时：改 `flags.ts` 的常量，同步改规格里写这个数的要求与场景、本文 D2–D4 与 Risks、proposal「调用次数与今天比」里由上限推出的数，报告写明依据（B 段原样数字与按规则算出的值），然后再合并。
3. A 段：确认「12-3」那次 t8 的失败原因（预期见 Context「2026-11-22 生产上 t8 失败的原因」），写进报告；与预期不同时照实更正原因。

上线后观察：
- `/api/cron/agent-runs` 不再出现 300 秒的 504；
- 一次调用里 t+160 秒之后没有新的 `job.claimed`，t+180 秒之后没有新的 `job.lease_renewed`（每轮开头一条）；
- t8 被截止时有理由为 `INVOCATION_DEADLINE` 的 `tool.yielded`，下一次调用接着做完；
- 上线一周后再跑一次 `prod-check.sql` B 段（只读），对照合并前的结果复核四类上限（G3）；要调就另开小 change。

合并后要人做的事（报告照写，tasks 3.2）：
- 上线一周后，由有生产库只读权限的人再跑一次 `prod-check.sql` B 段。
- 本 change 不重跑已经失败的分析。要重新分析的项目名单来自 `prod-check.sql`：A1 的「12-3」，加上 B1 里 t8 有 `no_end_event` 时、B2 里 t8 `end_type` 为空的 Job 所属、当前分析仍失败的项目。「12-3」要先确认 OpenAI 账户余额已补上，否则会以同样的原因再失败。
- Lucas 在项目页「AI 数字员工 · 投标分析」卡片上点「重新分析」。

FIX-12 报告 §6 让「两个项目一个一个地重新分析」。本 change 上线后，两个项目可以同时发起，实际仍按先后一个一个跑（见 Risks「排队头阻塞」）；FIX-15 报告照这句写。

## 留给 GATE

### G1 同一步被截止截断的次数上限

**已定（Lucas 2026-11-22）：A**

- **A（推荐）**：同一步被截止中止累计满 3 次后，再被截止就按既有失败规则计一次尝试；次数记在步骤 `evidenceJson.continuation`、跨让出保留，规划记在任务 `metadata`；零 schema。
  - 后果：模型一直慢时，一步最多被截断 3 次，之后约 2 次尝试内以 `synthesis_failed` 结束，不会无限空转——同一步最多 5 次请求，被截断的那几次每次最多约 3 分钟。旧队列有任务时（实测约 48 秒，`route.ts:45`），定时触发里首个任务的 t8 开工时剩余已不到 195 秒，模型一直慢只会按截断记；没有链式自触发时，正是这个上限让它最终失败。3 与 FIX-12 窗口的 3 次上限是同一个数（Lucas 已同意那条）。
- **B**：不设上限，只记日志。
  - 后果：模型持续慢、任务又总在后半段开工时，这一步无限让出、每次都发一次注定被中止的请求，费用没有上限，用户看到的是一直「进行中」。旧队列有任务时，定时触发里每次都是这种情形（见 A），不是偶发。
- **C**：每次截止都按失败计次（与 FIX-12 窗口相同）。
  - 后果：步骤尝试上限是 2，两次截止就失败，正是本 change 要避免的结果。
- 推荐 A：既不让截止吃掉仅有的 2 次尝试，又给空转封了顶。

### G2 自触发防风暴第 1 层的含义改变

**已定（Lucas 2026-11-22）：A**

- **A（推荐）**：接受。第 1 层从「本批有让出」变成「本批有让出，或有因时间不足留下的工作（未认领 / 因截止交还）」。
  - 后果：每一环子调用仍要真实用掉至少 160 秒（认领门槛）或 180 秒（开轮门槛）才会再触发；深度上限 25、开关、每次至多一次不变，不会形成风暴。`self-trigger.ts` 的注释与 OBS-P1 的说明同步改。
- **B**：不接受。删掉规格「留下工作时沿用链式自触发」一条与对应场景、D8 第二点。
  - 后果：留下的任务等下一次定时触发（最多 2 分钟）。
- 推荐 A：自触发已在生产上配置并验证（TASKFLOW CHAIN-0 第 1 项），多一个条件就能省掉这 2 分钟，且每一环都被真实耗时限速。

### G3 四类调用的上限与开工门槛取值

**已定（Lucas 2026-11-22）：A，但有前提：合并前跑 `docs/acceptance/fix-15/prod-check.sql` B 段，把 t8（以及风险旧分支、规划）的真实耗时分布写进报告，再确认 180 / 60 秒（规划 90 / 40 秒）。确认规则写死：已成功的 t8 最长一次 ≤ 150 秒 → 维持 180 / 60；超过 → 按数据把上限调到「最长成功耗时 + 30 秒」（不超过 225 秒），写明依据后再合并；规划同理（最长成功 ≤ 75 秒维持 90 / 40）。做法见 Migration Plan「合并前」，tasks 3.1。**

- 本稿取值（上限 / 开工最少）：综合 180 / 60 秒、风险旧分支 180 / 60 秒、规划 90 / 40 秒、核验 60 / 20 秒。
- 共同的后果：上限只在开工时剩余「上限 + 15 秒」以上时起作用。综合与风险旧分支耗时 180 到约 285 秒、规划耗时 90 秒以上的请求，今天能在 300 秒内成功，本 change 之后按失败计次。
- **A（推荐）**：按本稿合并；上线一周后复核，要调就另开小 change。
  - 复核用的数据：生产库里各步骤 `tool.started` → `tool.completed` / `tool.failed` / `tool.yielded` 的时间差（Context 第 10 条），不依赖 G4。G4 选 B 或 C 之后，还能在调用日志里按类别看每一次模型请求的耗时与失败（包括被中止的那几次）。G4 选 A 时，被中止的请求在调用日志里分不出是哪一类，只能从事件里看。
- **B**：先查生产数据再定。
  - 后果：生产库里 t8 成功时的耗时现在就能从事件时间差算出来（本稿前一版写「查不到」，不对）；被平台强杀的那几次没有结束事件，只能知道「超过多少秒」。要等人跑生产只读查询（现在是 `prod-check.sql` B 段），这期间 t8 继续不带超时。
- **C**：综合与风险旧分支不设单独上限，超时只取可用时间。
  - 后果：开工早时耗时 180 到约 225 秒的请求也能保住；但模型挂住时不再按失败计次，要先吃满 G1 的 3 次截断，同一步最多 5 次请求、每次最多约 3.7 分钟。
- 推荐 A：现在只有 T1B 一次 19.7 秒的实测，180 秒是它的 9 倍，超过多半是挂住；由成功变失败只发生在开工时剩余 195 秒以上的那一次；等数据就要把 t8 不带超时的状态继续留在生产上。

### G4 调用日志里给综合、核验、风险旧分支标类别

**已定（Lucas 2026-11-22）：C**（即原推荐项；Decision、规格、tasks 都按「本 change 不做」写，登记见 tasks 3.2）

需求原文（任务书、FIX-12 报告 §7 第 1 条、Evan 2026-11-22 的追加）都没有要求；原稿把它当作 G3 复核的前置一并加进来，现在拿出来单独拍板。

- **A**：不做。
  - 后果：Vercel 调用日志里分不出这三类请求，被截止中止的那几次只有一条不带类别的 `ai.call.error`；G3 的复核只用生产库事件。
- **B**：本 change 一并加。综合、核验、风险旧分支的 `createCompletion` 各带一个 `workflow` 值（与 `planner.ts:334` 的 `planner` 同一写法），规格加回一条要求，场景改成源码断言（注入口会整个绕过 `createCompletion`，测不到日志本身）。
  - 后果：多改三处、多一条要求；与 FIX-12 报告 §7「另记」把 `ai.call` 字段口径（retryCount）定为另开小 change 的做法不一致。
- **C（推荐）**：另开小 change，与 FIX-12 §7「另记」的 retryCount 口径一起做。
  - 后果：上线后到那个 change 合并之前，调用日志里分不出这三类；复核先用生产库事件。
- 推荐 C：它不在需求里；FIX-12 报告 §7「另记」已把 `ai.call` 字段口径列为另开小 change；G3 复核要的耗时在生产库事件里已经有，不必等它。
