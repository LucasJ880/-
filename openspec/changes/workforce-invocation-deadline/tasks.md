# Tasks：数字员工的一次调用守住整次调用的截止时间（FIX-15）

## 0. 开工前提（不是任务，不打勾）

- 合并顺序 FIX-17 → FIX-21 → FIX-19 → …，FIX-15 排在 FIX-19 之后。FIX-19 合并后，先把 main 合入本分支再开工；合入后按新的 main 重新核对 design 引用的行号，有出入只改行号，结论不变。
- 开工时记下 `grep -c "| 待定 |" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 的数 M，3.2 的 verify 要用。
- 3.1 里的生产只读查询（`docs/acceptance/fix-15/prod-check.sql`）可以开工时就交人去跑，最迟在合并前；结果可能要改上限常量，早拿到早定。

## 1. 测试先行

- [ ] 1.1 新增两个测试并在同一步注册（注册行都带 `NODE_ENV=test` 前缀）：
  - `src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts`：不连库，以 t8 综合被截止为主例。包括：
    - 纯函数：门槛与退化；四类调用的发不发 / 超时 / 截止是否起作用；「被中止」的两种形态为真，连接超时、429 限流与余额不足为假；累计次数「截断 2 次 → 没发出 1 次 → 再截断」得 3。
    - 直接调用综合：含注入口抛 429 余额不足时综合返回错误、不返回 continuation。
    - 源码断言。
    - 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - `src/lib/workforce-runtime/__tests__/invocation-deadline-db.isolated.test.ts`：隔离库，包括认领与开轮门槛、t8 截止交还与接续、累计次数跨让出保留与上限、规划截止；只注册进 `scripts/test-all.sh`。

  verify：`bash scripts/check-test-registry.sh` 输出 OK；改动前的代码上运行 `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts` 失败（纯函数不存在、综合请求不带超时），输出贴进报告。

## 2. 实现

- [ ] 2.1 在 `src/lib/agent-runtime-v2/flags.ts` 加门槛常量与四个纯函数：剩余时间够不够；单次模型请求发不发、超时多少、截止是否起作用（含开工门槛退为 10 秒）；一次请求是不是被中止（SDK 中止错误的实例、名为 `AbortError` 的错误都算，不看文案）；累计截断次数写回多少、要不要转为失败。四类调用的上限先按 180 / 180 / 90 / 60 秒写，最终取值以 3.1 合并前确认的为准。verify：CI 单测「门槛与超时」「被中止」「累计次数」三组通过；`npm run typecheck` 退出码 0。
- [ ] 2.2 t8 综合（首要）：
  - `synthesis.ts`：接收预算、带超时、被截止中止或没发出时返回 continuation（`ok` 为 true）；结果类型加 continuation；注入口参数加 `timeoutMs`。
  - `adapters.ts`：理由加 `INVOCATION_DEADLINE`。
  - `executor.ts`：批路径把预算传给综合；在 `if (batchContinuation)` 之前用累计函数算次数，满 3 次转入既有失败分支（G1 已定 A）；让出分支写 `evidenceJson.continuation` 时一律带上 `deadlineCuts`。

  verify：CI 单测「综合」组与隔离库「t8」「累计次数」组通过；`t5-p11-resumability.test.ts`、隔离库上的 `p0-execution-alignment.test.ts` 与 `phase2b2-final-gate.test.ts` 通过数不变。
- [ ] 2.3 规划、风险旧分支、核验：
  - `processor.ts`：把预算传给规划；规划被截止中止或没发出时跳过轮次循环、走既有交还队列，事件 payload 加 `invocationDeadline: true`，`metadata.plannerDeadlineCuts` 写进同一次带防栅栏的交还写入。
  - `planner.ts`：带超时，加仅测试用的注入口。
  - `tools.ts`：风险旧分支用 `ctx.executionBudget`，被截止中止或没发出时返回 continuation。
  - `verifier.ts` 与 `process.ts`：两处核验调用传预算，复核带超时、时间不够不发、出错仍退回确定性结论；加仅测试用的注入口。
  - 不给三处 `createCompletion` 加 `workflow` 值（G4 已定 C，另开小 change，见 3.2 登记第 11 条）。

  verify：CI 单测「规划 / 风险 / 核验」组与隔离库「规划」组通过；隔离库上的 `t1b-integration.test.ts` 通过数不变；`npm run typecheck` 退出码 0。
- [ ] 2.4 `processor.ts`：
  - 认领前的 80 秒门槛（不足就停止循环，计 `skippedForBudget`，不写状态与事件）。
  - 每轮前的 60 秒门槛（结束时间片，走既有交还队列，事件 payload 加 `invocationDeadline: true`）。
  - 返回 `skippedForBudget` 与 `deadlineContinuations`。

  verify：隔离库「认领 / 开轮」组通过；隔离库上 `phase2a-*.test.ts` 通过数不变；`obs-p1-latency-self-trigger.test.ts` 通过数不变。
- [ ] 2.5 路由与自触发（G2 已定 A）：
  - `api/cron/agent-runs/route.ts`：两个计数进元数据，交给自触发判定。
  - `self-trigger.ts`：判定多一个可选输入，改写注释里第 1 层的含义。

  verify：CI 单测「自触发」组通过；`obs-p1-latency-self-trigger.test.ts` 通过数不变。

## 3. 验收

- [ ] 3.1 全部门禁，与合并前的上限确认（G3 已定 A 的前提，不做完不合并）。
  - 门禁 verify：
    - `npm test` 与既有失败清单对照，无新增失败；
    - CI 环境变量下 `bash scripts/test-ci-unit.sh` 末行 `CI unit subset PASS`；
    - `npm run lint:baseline` PASS；`bash scripts/test-runtime-architecture.sh` PASS（不新增冻结区文件、不新增被禁止方向的引用）；
    - `openspec validate workforce-invocation-deadline --strict` valid；
    - `git diff origin/main -- prisma/ vercel.json` 为空。
  - 合并前必做：把 `docs/acceptance/fix-15/prod-check.sql`（不改它）交给有生产库只读权限的人跑，A、B 两段结果原样贴回，写进报告。然后按下面写死的规则确认上限（design Migration Plan「合并前」）：
    - t8 综合：B1 里 `kind = t8_synthesis`、`outcome = completed` 那一行的 `max_s`（已成功的最长一次）≤ 150 秒 → 维持 180 / 60；超过 → 上限调到「`max_s` + 30 秒」，不超过 225 秒。
    - 风险旧分支：同一条规则，看 B1 里 `kind = t5_legacy_or_unknown`、`outcome = completed` 那一行；没有这一行就维持 180 / 60，报告写明「没有数据」。
    - 规划：B3 各域 `max_s` 中最大的那个 ≤ 75 秒 → 维持 90 / 40；超过 → 上限调到「这个值 + 30 秒」，不超过 225 秒。B3 是上界（从第一次认领算起，含重试等待）；超过 75 秒时先另写一条只读 SELECT 看那个 Job 的 `job.claimed` → `plan.created`，确认是一次规划的耗时再定，SELECT 原文写进报告。
    - 「已成功的最长一次」只取 B1 / B3，不取 B2：B2 不把下一次 `tool.started` 当作结束，被强制结束的那次会和下一次尝试的结束事件配成一对。
    - 要调时：改 `flags.ts` 常量；同步改规格里写这个数的要求与场景，以及 design D2–D4、Risks、proposal「调用次数与今天比」里由上限推出的数；重跑 1.1 的 CI 单测与 `openspec validate workforce-invocation-deadline --strict`。
  - 合并前 verify：
    - 报告「上限确认」一节有 B1–B4 的原样结果、按规则算出的结论（维持，或调到多少秒）与依据；
    - `flags.ts` 里综合、风险旧分支、规划的上限常量与这个结论一致；
    - 调过时，规格里写这个上限的要求与场景都已改成新值，报告列出改了哪几处。
- [ ] 3.2 写 `docs/QINGYAN_FIX-15_REPORT.md`，并更新 TASKFLOW 状态列。
  - 报告写：
    - 改前 / 改后测试输出；
    - 四类调用上限与开工门槛的依据：`prod-check.sql` B 段原样结果、按写死规则得出的结论（3.1）；
    - `prod-check.sql` A 段结果：「12-3」那次 t8 的失败原因。预期是 OpenAI 429 模型账户余额不足（Vercel 日志 2026-11-22 16:40:31 多伦多起），归 FIX-20，本 change 不修它；与预期不同时照实更正；
    - 与今天比多调、少调、由成功变失败的三种情形（数字按 3.1 确认后的上限写）；
    - G1–G4 的拍板结果：G1 A、G2 A、G3 A（合并前按 B 段确认）、G4 C；
    - 没有开关，合并即在生产生效；
    - 上线后两个项目可以同时发起，实际仍按先后一个一个跑（替代 FIX-12 报告 §6 的「一个一个地重新分析」，照这句写）；
    - 合并后要人做的事：
      - 只读查询：上线一周后，由有生产库只读权限的人再跑一次 `prod-check.sql` B 段，对照合并前的结果复核四类上限；
      - 要重新分析的项目名单从哪来：本 change 不重跑已经失败的分析。名单是 A1 里的「12-3」，加上 B1 里 `t8_synthesis` 有 `no_end_event` 时、B2 里 `step_key = t8_synthesis`、`end_type` 为空的 `runId` 所属的项目中当前分析仍是失败的那些（由 `runId` 查项目名的只读 SELECT 原文附在报告里）。「12-3」要先确认 OpenAI 账户余额已补上，否则重新分析会以同样的原因失败；
      - 谁来点：Lucas 在项目页「AI 数字员工 · 投标分析」卡片上点「重新分析」；几个项目可以同时点，实际仍按先后一个一个跑；
    - 上线后观察什么；多维审查结论。
  - TASKFLOW：在「Phase F（续）— 情报串联」表新增 FIX-15 一行，状态 `[~]`，接在表里已有的最后一行之后（开工时至少已有 FIX-17、FIX-21、FIX-19）。同时登记 12 条后续任务，各一行，编号写「待定」，状态 `[ ]`：
    1. PERSIST 切片可能越过 300 秒：中文化的超时只比剩余时间少 5 秒（`src/lib/tender-auto-analysis/v2-resumable.ts` 的 `translateAnalysisZh` 调用），其后落库事务最长 10 + 120 秒（`src/lib/tender-workforce/v2-persist-workforce.ts` 的 `WORKFORCE_V2_TX_OPTIONS`）。
    2. 写检查点的事务可能越过 300 秒：`saveWorkforceV2Cursor`（`v2-persist-workforce.ts`）同样用 10 + 120 秒的事务参数，不看整次调用的截止。
    3. OpenAI SDK 按 `retry-after` 等待时没有上限、不看中止信号（`src/lib/ai/client.ts` 这一层）；与第 4 条并到同一个 change。
    4. 费用预检（`src/lib/ai/client.ts:173–186`）在本方计时器（`:191`）之前，它的耗时不算进超时；与第 3 条并到同一个 change。
    5. 旧自动分析管线的 FINALIZE 没有时限（`src/lib/tender-auto-analysis/worker.ts`）；与第 6 条并到同一个 change，FIX-18 若下线旧管线入口就不再需要。
    6. 旧自动分析管线认领下一个分析的门槛还是 45 秒（`MIN_RUN_SLICE_MS`，`worker.ts:51`、`:1019`），没与窗口开批的 80 秒对齐；与第 5 条并到同一个 change。
    7. 即时推进 `kickQueuedWorkforceJobSlice`（`src/lib/workforce-runtime/processor.ts`）的预算从被调用时刻起算，不是从请求开始。
    8. 定时触发先跑的 `processQueuedAgentRuns`（`src/lib/agent-runtime/queue.ts`，`src/app/api/cron/agent-runs/route.ts` 调用）自身没有上限，实测约 48 秒。
    9. 收尾步骤 t9 的外部情报（`src/lib/tender-intel/orchestrate.ts` 的 `runExternalIntelForProject`）内部多次 60–150 秒的固定超时调用，没有总时限，60 秒开轮门槛挡不住。
    10. t2 第一次解析大文件（`src/lib/tender-workforce/tools.ts` 里调用的 `parseDocumentPagesAndStore`）没有时限，60 秒开轮门槛挡不住。
    11. 调用日志里给综合、核验、风险旧分支的 `createCompletion` 标类别（G4 已定 C），与 FIX-12 报告 §7「另记」的 `ai.call` `retryCount` 口径一起做。
    12. 四类调用上限的上线后复核：FIX-15 上线一周后再跑 `docs/acceptance/fix-15/prod-check.sql` B 段，对照合并前的结果，要调就开小 change（G3）。
  - 已有归属、不另登记（报告里列出）：「12-3」那次余额不足的失败降级与失败通知写那一步自己的原因、t8 失败后的受阻显示与「从失败的这一步继续」→ FIX-20；降级结果怎样告诉用户 → FIX-16。
  - 某条在开工时 TASKFLOW 已有一行的（别的 change 先登记了），不重复登记，报告写明是哪一行。

  verify：报告存在；`grep -n "^| FIX-15 |" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 恰好一行；`grep -c "| 待定 |" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 不少于 M + 12（M 见「0. 开工前提」；不重复登记的条数从 12 里减掉）。

## Workflow follow-up

- 开 PR 前按 `openspec/config.yaml`「多维审查」并行派子 agent，各审一个维度：正确性与回归、安全 / 隐私与硬纪律、规格—代码—测试一致性、使用流畅与文案，另加时序、运行时架构守卫。逐条核实后再修，重跑测试；PR 正文写「多维审查」一节。
- 合并后 `/opsx:archive workforce-invocation-deadline --yes`（独立小 PR）。
