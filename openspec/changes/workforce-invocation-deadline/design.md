# Design：数字员工的一次调用守住整次调用的截止时间

## Context

动机见 proposal.md「Why」。来源：FIX-12 报告 §7 第 1 条与 #540 合并前的第二轮独立审计（2026-11-21，时序与正确性两个维度）。下面每一条都由本 change 的作者在 main `91d928e4` 上读代码核对过。

**核对属实的（本次要改）**

1. `processQueuedWorkforceJobs`（`src/lib/workforce-runtime/processor.ts:785–791`）的循环逐个调用 `processWorkforceJobSlice`，认领下一个任务之前不看 `executionBudget.deadlineAt`。
2. `processWorkforceJobSlice` 的轮次循环（`:472–474`）只判断 `Date.now() − processingStartedAt > sliceBudgetMs`：`sliceBudgetMs` 是 45 秒，从这个任务自己开始处理的时刻算，不是整次调用的截止时间。第二个任务若在 t+228 秒被认领，它的各轮可以一直开始到约 t+273 秒，而每一轮本身没有时限。
3. 四处模型调用不带 `timeoutMs`（`createCompletion` 没有 `timeoutMs` 时不设计时器，`src/lib/ai/client.ts:191–194`）：规划 `src/lib/agent-runtime-v2/planner.ts:326`、核验 `src/lib/agent-runtime-v2/verifier.ts:231`、多任务综合 `src/lib/workforce-runtime/synthesis.ts:239`、旧版风险分析 `src/lib/tender-workforce/tools.ts:871`。
4. `/api/cron/agent-runs`（`route.ts:38–42`）已经按 HTTP 请求开始的时刻算出 `executionBudget = { deadlineAt: 开始 + 240 秒, tickBudgetMs: 240 秒 }` 并传给 `processQueuedWorkforceJobs`；`processAgentRuntimeV2Run` 与执行器也已经带着它（`process.ts:185`、`executor.ts` 多处）。缺的只是用它。
5. 链式自触发只在「有任务让出」时安排（`route.ts` 的 `shouldFireContinuationTrigger({ yieldedContinuations, depth })`）。

**核对后划掉或改写的（FIX-12 报告 §7 的原说法）**

- ~~「不带超时调模型的步骤（如 `tender_risk_analysis`）」~~：在现行的 canonical-V2 计划上，风险分析走投影分支、不调模型（第二轮审计读 `tools.ts:749–797` 得出；本 change 作者只核对了 `:871` 这一处调用确实不带超时）。真正会在现行计划上不带超时调模型的是多任务综合、核验与规划。四处一起加超时。
- 「`processQueuedAgentRuns` 没有上限（实测约 48 秒）」：属实，但它的用时已经计在 240 秒预算之内（预算从请求开始算），只会挤占后面的时间，不会单独把调用拖过 300 秒；链式自触发的调用跳过它。不在本次改。

**核对属实、不在本次改的**（见 proposal「Out of scope」，留给 FIX-16）：PERSIST 中文化 5 秒余量与其后的落库事务；SDK `retry-after` 等待；备用模型时间不够；检查点事务超时；旧管线 FINALIZE；`kickQueuedWorkforceJobSlice`。

## Goals / Non-Goals

**Goals:**
- 一次 `/api/cron/agent-runs` 调用里，t+180 秒之后不再有新的任务被认领、不再有新的一轮开始（240 − 60）。
- 数字员工路径上没有不带时限的模型请求（带时间预算时）。
- 被截止时间截断的工作不算失败、不消耗尝试次数。

**Non-Goals（不动的模块 / 文件）:**
- `src/lib/tender-auto-analysis/**`、`src/lib/tender-understanding/**`、`src/lib/ai/model-policy/tender.ts`（FIX-12 的范围）：不改。
- `src/lib/ai/client.ts`、`src/lib/ai/retry.ts`：不改（SDK 重试等待留给 FIX-16）。
- `src/lib/workforce-runtime/constants.ts` 的 `AGENT_RUNS_INVOCATION_BUDGET_MS`、`WORKFORCE_SLICE_BUDGET_MS`、`WORKFORCE_MAX_ROUNDS_PER_SLICE`：数值不改。
- 租约、认领、清扫（`stale_running_exhausted`）与队列的结构：不改。
- `src/lib/tender-intel/orchestrate.ts`（收尾步骤的外部情报）：不改内部。
- `vercel.json`、`prisma/**`：不改。

## Decisions

### D1 认领前的门槛：60 秒

认领下一个任务之前，`deadlineAt − now < 60 秒` 就停止循环，返回未认领的数量。

- 依据：一轮里最短的有意义工作（一次规划或核验）通常十几秒到几十秒；招标分析切片的各阶段门槛最低是 30 秒（澄清），认领后还有租约、事件、上下文装载的开销。60 秒与旧自动分析管线「剩余不足 45 秒不认领第二个 run」（`worker.ts:1019`）同一量级，略保守。
- 否决：沿用 45 秒。数字员工的一轮比旧管线的一步多一次规划 / 核验的模型调用。
- 否决：不设门槛、只给模型调用加超时。任务会被认领、装载上下文、续租、写事件，然后立刻因时间不够而交还，白占一次租约与一组事件。

### D2 每轮前的门槛与认领门槛相同

轮次循环在既有的 45 秒判断之外再加「整次调用剩余不足 60 秒 → 结束时间片」，走循环之后既有的交还队列分支（尝试次数归零）。

- 否决：把 `sliceBudgetMs` 改成按整次调用计算。会改变不带 `executionBudget` 的调用方（同步入口、脚本）的行为。

### D3 模型调用的超时：min(上限, 剩余 − 15 秒)，最短 10 秒

15 秒的余量与 FIX-12 的切片安全余量一致（留给中止传播、写状态与事件）。各类调用的上限：规划 90 秒、核验 60 秒、多任务综合 180 秒、风险分析 180 秒（按各自的输出规模取；实现时以生产 `ai.call` 日志里的实际耗时复核，写进报告）。

- 否决：统一一个固定超时。规划与综合的耗时差一个量级。
- 否决：不带时间预算时也加上限。会改变同步入口与脚本的行为；本次只收敛定时调用这条路。

### D4 被截止时间截断 → 交还队列，不算失败

四处调用被本次加的计时器中止时，返回与工具让出相同的「继续」信号（执行器已有的让出路径：回滚这一步的尝试次数、任务回队）。判断依据是「中止发生时整次调用的剩余时间已不足 15 秒 + 容差」，而不是错误文案。

- 否决：按各处既有的失败处理（综合返回 `SYNTHESIS_MODEL_FAILED`、规划返回失败）。步骤尝试上限是 2，两次被截断就判失败——正是要避免的结果。
- 否决：靠 D1 / D2 的门槛就够了，不处理截断。门槛只保证开工时有 60 秒；一次 180 秒上限的综合在剩 100 秒时开工，仍会被截断。

### D5 留下未认领任务时沿用链式自触发

`processQueuedWorkforceJobs` 多返回一个「因时间不足未认领」的数量；路由把它与 `yieldedContinuations` 相加后交给既有的 `shouldFireContinuationTrigger`。

- 否决：等下一次定时触发（每 2 分钟）。能用，但部署当天连续重跑两个项目时第二个会多等最多 2 分钟；自触发已经存在，条件多加一项即可。
- 否决：新增一个「延后」状态或调度。违反硬纪律第 3 条。

## 与八条硬纪律的关系

1. 零 schema：遵守——不加模型 / 字段 / 迁移；不改检查点结构。
2. 出站先审批：不涉及（没有任何对外发送）。
3. 禁止第三套队列：遵守——只在既有的 workforce runtime 里加判断，复用既有的交还队列、让出与链式自触发；不新增队列、调度、租约、worker 注册。
4. 脱敏：不涉及（不新增任何输出内容）。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守——不新增模型调用；门槛是固定常量。
8. 测试注册：新测试同一 task 内注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`，`bash scripts/check-test-registry.sh` 通过。

## 验证方式

- `npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts`：注入时钟与慢模型（沿用各处已有的测试注入口，如 `synthesisModelOverrideForTests`、`riskModelOverrideForTests`），覆盖规格的全部场景；先在改动前的代码上跑出失败（第二个任务在 t+228 秒被认领、综合不带超时），输出贴进报告。
- 既有：`src/lib/workforce-runtime/__tests__/phase2a-*.test.ts`、`obs-p1-latency-self-trigger.test.ts`、`src/lib/tender-workforce/__tests__/t5-p11-*.test.ts` 照旧通过，通过数不变。
- `npm run typecheck`、`npm run lint:baseline`、`bash scripts/test-runtime-architecture.sh`、CI 子集、`npm test`（对照既有失败清单）、`openspec validate workforce-invocation-deadline --strict`。
- `git diff origin/main -- prisma/ vercel.json` 为空。

## Risks / Trade-offs

- [t+180 秒之后不认领，吞吐下降] → 一次调用最多少处理一个任务；有链式自触发时几秒内接上，没有时等下一次定时（≤ 2 分钟）。换来的是不被强制结束。
- [超时上限取小了，正常的综合被截断后反复交还] → 被截断不消耗尝试次数，不会判失败，但会空转；上限按生产日志复核，报告里写出依据；实现时加一条「同一步连续被截断 N 次」的日志，供观察。
- [D4 的判断误把别的中止当成截止] → 只在「本次加的计时器触发」时走交还，其它错误原样走既有分支；测试覆盖 400 的场景。
- [四处调用的测试注入口各不相同] → 规划与核验没有现成的注入口时，沿用 FIX-12 的做法加可选参数并标 `@internal`，生产调用方不传。

## Migration Plan

无数据迁移、无开关。合并部署即生效；回滚 = 回退本 PR。上线后观察：`/api/cron/agent-runs` 不再出现 300 秒 504；一次调用里 t+180 秒之后没有新的 `job.claimed` / 轮次事件。
