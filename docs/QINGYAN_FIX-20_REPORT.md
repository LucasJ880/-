# FIX-20 报告：综合汇总没做出来不再扣住招标分析结果，受阻时说清原因与重试

| 项 | 值 |
|---|---|
| change | `tender-job-synthesis-degrade`（新能力 `tender/analysis-synthesis-degrade` 6 条要求、`agents/workforce-step-retry-visibility` 8 条要求；改 `tender/analysis-failure-surfacing` 4 条、加 1 条「三处说同一句」） |
| TASKFLOW | FIX-20（Phase F（续）— 情报串联表，FIX-13 之后；生产实测修复，2026-11-22） |
| 来源 | Evan 2026-11-22 生产实测「12-3 Indoor Canadian Flag」一键分析：第 8 步综合汇总因 AI 账户余额不足失败，第 9 步没开始，分析停在「分析中」，16:44:29 `[tender-alert] … code=blocked_graph`，通知写「前置步骤没有完成」；Lucas 提供的同日 Vercel 生产日志：OpenAI 429「no credits remaining」（多伦多时间 16:40:31 起） |
| 拍板 | Evan 2026-11-22：「GATE 按你的推荐来」——design「留给 GATE」G1–G8 都按推荐。G1 的生产 SQL 还没跑（见 §1） |
| 分支 | `claude/zen-turing-azudvx-fix20`（已合入 main `13c7ed33`，含 FIX-12、FIX-13）；同一工作树里的 FIX-20b `tender-job-continue-from-failed` **本次没有实施** |
| 性质 | 改执行器、处理器、读模型、收尾与两处界面。零 schema、零新模型调用入口、没有新出站、运行时架构基线一行不改。**没有开关——合并即生效** |

## 0. 一句话

以前：一键分析的第 8 步「综合汇总」（只给整个 AI 任务写一段汇总，不产出任何招标分析内容，任何页面也不显示它）一失败，第 9 步就不开始，招标分析结果被扣在「分析中」，通知还写成「前置步骤没有完成」。现在：第 8 步不管因为什么执行失败，下一轮就把它记为「已跳过」，第 9 步照常把分析改为待审阅；作业页和项目卡片写明「AI 数字员工的综合汇总未生成：AI 账户余额不足，请联系平台管理员充值」。重试期间写「正在第 N 次重试」，停下时写失败那一步自己的原因。

已经停在「需要人工处理」的旧 Job（包括 11-22「12-3」那一个）不会被救回：上线后在项目里点「重新分析」，或等 FIX-20b 合并后点「从失败的这一步继续」。

术语：「降级」= 把失败的综合汇总改成「已跳过」并补上交接数据，让第 9 步照常开工；「交接数据」= 每一步完成时写给下游的结构化摘要（`workforceHandoff`）；「一轮」= 执行器推进一次（每次定时任务里最多 6 轮）；「隔离库」= 本机专门跑测试的数据库，和生产无关。

## 1. 生产事实（**生产 SQL 待跑，结果补进本节**）

已知：

- 来源一：Evan 2026-11-22 实测与 `[tender-alert]` 日志——16:27 创建 Job；t3 16:28–16:41；t4–t7 16:42 完成；第 8 步 `t8_synthesis` 失败（Evan 说是 AI 账户余额不足）；第 9 步没开始；16:44:29 `[tender-alert] … code=blocked_graph`（收尾把分析记录改成「AI 分析未完成」、发失败通知之后才会打这条日志，`analysis-run-service.ts:450-471`）。
- 来源二：Lucas 提供的同日 Vercel 生产日志，OpenAI 429 的原文是「no credits remaining」（多伦多时间 16:40:31 起）。本次把这句加进了余额不足的识别字面量（§2 第 1 条）。**这句原文以生产 prod-check A 段（`docs/acceptance/fix-15/prod-check.sql`，在 FIX-15 分支）的结果为准，结果回来若原文不同再补**（只改 `src/lib/workforce-runtime/constants.ts` 的 `MODEL_QUOTA_EXHAUSTED_LITERALS` 一处，加一条测试）。
- 改动前的代码在隔离库上复现了同一现象（§4）：第 9 步待开始、Job `needs_human` / `blocked_graph`、分析记录「AI 分析未完成」、原因「卡在第 8 步〈Workforce 执行汇总〉：前置步骤没有完成」、日志 `[tender-alert] … code=blocked_graph`。

待跑：design 附录的两条只读 SQL（G1；容器里没有生产连接）。原文照抄如下，跑完把结果贴在下面「结果」处：

时间列是不带时区的 `TIMESTAMP(3)`，存 UTC（迁移 `00000000000000_greenfield_baseline_pre_phase4/migration.sql:2872-2873`）。AgentRun 没有 projectId 列，靠 `metadata->>'projectId'` 关联项目（`trigger-service.ts:66-80`）；分析记录用 `idempotencyKey = 'tender-workforce:v1:' || jobId` 关联（`analysis-run-service.ts:57-59`）。多伦多 11 月为 UTC−5，16:27 即 21:27 UTC。

```sql
-- ① Job 状态 + t8 步骤 + t9 状态 + 分析记录
WITH job AS (
  SELECT r."id", r."orgId", r."status", r."errorCode", r."errorMessage", r."attempts",
         r."leaseExpiresAt", r."nextAttemptAt", r."createdAt", r."updatedAt"
  FROM "AgentRun" r
  JOIN "Project" p ON p."id" = r."metadata"->>'projectId' AND p."orgId" = r."orgId"
  WHERE r."runType" = 'workforce_job'
    AND r."metadata"->>'workDomain' = 'tender'
    AND p."name" ILIKE '%12-3 Indoor Canadian Flag%'
    AND r."createdAt" >= TIMESTAMP '2026-11-22 21:20:00'
    AND r."createdAt" <  TIMESTAMP '2026-11-22 21:45:00'
)
SELECT j."id" AS job_id, j."status" AS job_status, j."errorCode" AS job_error_code,
       LEFT(j."errorMessage", 300) AS job_error_message, j."attempts" AS job_attempts,
       j."leaseExpiresAt", j."nextAttemptAt", j."updatedAt" AS job_updated_at,
       s."status" AS t8_status, s."attemptCount", s."maxAttempts", s."errorCode" AS t8_error_code,
       LEFT(s."errorMessage", 500) AS t8_error_message, s."startedAt", s."completedAt",
       t9."status" AS t9_status,
       tar."id" AS analysis_run_id, tar."status" AS analysis_status, tar."errorCode" AS analysis_error_code
FROM job j
LEFT JOIN "AgentRunStep" s  ON s."runId" = j."id" AND s."stepKey" = 't8_synthesis'
LEFT JOIN "AgentRunStep" t9 ON t9."runId" = j."id" AND t9."stepKey" = 't9_finalize_analysis'
LEFT JOIN "TenderAnalysisRun" tar ON tar."idempotencyKey" = 'tender-workforce:v1:' || j."id"
ORDER BY j."createdAt";

-- ② 同一 run 里与 t8 相关的事件 + 21:41 UTC 之后的 Job 级事件
WITH job AS (
  SELECT r."id" FROM "AgentRun" r
  JOIN "Project" p ON p."id" = r."metadata"->>'projectId' AND p."orgId" = r."orgId"
  WHERE r."runType" = 'workforce_job' AND r."metadata"->>'workDomain' = 'tender'
    AND p."name" ILIKE '%12-3 Indoor Canadian Flag%'
    AND r."createdAt" >= TIMESTAMP '2026-11-22 21:20:00' AND r."createdAt" < TIMESTAMP '2026-11-22 21:45:00'
)
SELECT e."sequence", e."createdAt", e."eventType", e."title", e."visibleToUser",
       e."payload"->>'stepKey' AS step_key, e."payload"->>'attempt' AS attempt,
       e."payload"->>'errorCode' AS error_code, LEFT(e."payload"->>'error', 500) AS error_500,
       LEFT(e."payload"->>'report', 200) AS report
FROM job j JOIN "AgentRunEvent" e ON e."runId" = j."id"
WHERE (e."payload"->>'stepKey' = 't8_synthesis'
       AND e."eventType" IN ('task.claimed','step.started','tool.started','tool.failed','tool.completed','step.completed'))
   OR (e."createdAt" >= TIMESTAMP '2026-11-22 21:41:00'
       AND e."eventType" IN ('job.claimed','job.queued','job.failed','job.waiting_human','run.needs_human','job.completed'))
ORDER BY e."sequence";
```

结果：**待跑**（第 8 步的 `errorCode` / `errorMessage`、尝试次数、第 9 步状态、分析记录状态、`job.failed` 的确切时刻）。

按 design「四种结果」，结果回来后这样定：

1. 第 8 步 `errorCode = stale_running_exhausted`（两次被 300 秒强制结束）：代码不改，降级照样发生，原因会写成「长时间没有进展」；本报告的根因描述改为「被强制结束两次」，根治归 FIX-15。
2. `errorCode = synthesis_failed`：
   - `errorMessage` 是 `SYNTHESIS_MODEL_FAILED:` 加一段含 `insufficient_quota` / `exceeded your current quota` / `no credits remaining` 的英文：代码不改，已命中；
   - 别的写法（代理商中文「余额不足」、`billing_hard_limit_reached` 之类）：只在 `constants.ts` 里补字面量；
   - 是「配额限制：月 AI 费用已达 hard limit」：代码不改，命中 `org_ai_budget_exhausted`；本报告把「AI 账户余额不足」更正为「本组织本月 AI 费用已达上限」；
   - 是 `SYNTHESIS_INVALID_OUTPUT` / `SYNTHESIS_NO_UPSTREAM`：降级与显示照做，本报告写明这次不是余额问题。
3. Job 仍是 queued / running / executing：与 16:44:29 的收尾日志矛盾，另开任务查认领；本设计不变。
4. Job 是 `needs_human` / `blocked_graph`，但分析记录仍是 `AGENT_ANALYZING`：与日志矛盾，另查「[workforce] job stopped hook failed」日志；本设计不变。

按日志推断的实际结果是：Job `needs_human` / `blocked_graph`、分析记录 `AGENT_FAILED` / `blocked_graph`——正是 §4 改动前在隔离库上复现的样子。

## 2. 做了什么

1. **写入时归类错误码**（design D5、D6）：`src/lib/workforce-runtime/constants.ts`（执行器本来就引用它，仍零依赖）新增识别字面量与归类函数——错误里含 `insufficient_quota` / `exceeded your current quota` / `no credits remaining`（不分大小写）→ `model_quota_exhausted`；含「月 AI 费用已达 hard limit」→ `org_ai_budget_exhausted`；其余综合汇总 `synthesis_failed`、工具步骤 `tool_failed`。执行器批量路径的失败分支在「还会重试」与「最终失败」两种情况都写这个码，`tool.failed` 事件同码。重试次数不变（D7：余额不足照样试满 2 次）。
2. **中断回收留痕**（D8）：处理器回收前一个执行者遗留的「执行中」步骤（次数未尽）时，写 `stale_running_recovered`，并写一条不对用户显示的 `step.ready` 事件（`recoveredFrom: "stale_running"`）；次数用尽的照旧 `stale_running_exhausted`。
3. **重试那次让出保留错误码**（D8）：批量路径让出分支在认领后 `attemptCount ≥ 2` 时保留错误码，第一次执行照旧清掉。值在 `if (batchContinuation)` 之前算好，块内只写短变量名、并把这一行挪到 `completedAt: null` 之后——两者之间的字符数从 587 减到 560，`t5-p11-resumability.test.ts` 的 600 字符窗口断言不改期望。
4. **综合汇总降级**（D1–D3）：执行器每轮开头（成员资格检查之后、依赖推进之前），只对「招投标域 + 服务端确定性计划 + 原生综合汇总 + 执行失败码」的失败步骤，按执行前同一道任务校验收齐上游交接数据，条件更新为「已跳过」（仍为失败才改），产出 `{ synthesisNotGenerated: true, reasonCode, workforceHandoff }`，命中一行才写一条用户可见的 `step.completed`（标题「Workforce 执行汇总（综合汇总未生成，已跳过）」）。原错误码与错误原文保留；产出不带 `degraded`。上游交接数据收不齐或构建失败时保持失败。契约类失败码（`workforce_task_invalid`、`HANDOFF_*`、`handoff_build_failed` 等）不降级。非招投标确定性计划的 Job 一次查询都不多做。
5. **交接数据的话**：跳过的综合汇总摘要「综合汇总未生成」、警告「综合汇总未生成：〈原因白话〉」；别的跳过（审批被拒）保持原话。
6. **第 9 步**（D4）：先判 canonical V2，再查综合结果；canonical V2 模式下依赖里带「未生成」标记就照常终态化（只改状态，`summaryJson` / `summaryText` 逐字节不变），返回值不带 `jobSummary`、带 `synthesisNotGenerated: true`、摘要末尾加「；综合汇总未生成」。V1 兼容模式、以及依赖里两样都没有时照旧「输入缺失」。终态化之后的完成通知、Muse `analysis.ready`、外部情报照既有规则执行（G6 按推荐 A）。
7. **停止原因规则**（D9）：失败步骤只用它自己的错误码（查不到写「执行出错」，不回落 Job 的码）；不是失败步骤只用 Job 的码，不读该步骤上留下的码。白话表加四个码：`synthesis_failed`「综合汇总生成失败」、`model_quota_exhausted`「AI 账户余额不足，请联系平台管理员充值」、`org_ai_budget_exhausted`「本组织本月 AI 费用已达上限，请组织管理员调高月度上限」、`stale_running_recovered`「上一次执行时间过长被中断」。
8. **什么时候算停止原因**（D10）：Job 失败 / 需要人工处理，或者还在进行中（含两轮之间回到排队）而有失败步骤；已完成、部分完成、已取消、等待审批照旧不算。
9. **读模型**（D8、D11）：步骤查询只多取 `attemptCount`、`maxAttempts`；任务视图多 `retry: { attempt, maxRetries, reasonZh }`；作业视图多 `synthesisNotGenerated: { stepIndex, stepTitle, reasonZh }`（只对招投标服务端计划）。读模型、停止原因模块不读 `errorMessage`（源码断言）。
10. **收尾与通知**（D9）：原因顺序改为 具体原因码 → 招投标已知标记（余额不足排第一，识别规则取自 `constants.ts` 同一份）→ 笼统码 → 「执行出错」。写进分析记录的错误码取第一个失败步骤自己的，`[tender-alert]` 的 `code=` 与通知元数据随之改变。
11. **界面**（D11）：
    - 作业页：进度一节在「N 项受阻」旁写停止原因整句、写重试句；任务行下面写重试句；「最终结果」写「AI 数字员工的综合汇总未生成：〈原因〉。招标分析结果请到项目里审阅。」
    - 项目卡片接口加 `retrying`（序号、步骤名、第几次、最多几次、原因白话、整句）、`blockedReason`（停止原因整句）、`synthesisNotGenerated`（含卡片整句）；句子在服务端拼好，卡片组件只渲染。
    - 项目卡片（FIX-18 未合并，写在 `agent-card.tsx`）：「AI 分析中 · x/y 个任务完成」那一行后面写重试句与受阻原因；待审阅时「分析结果已就绪，请在下方审阅确认」下方写「本次 AI 数字员工的综合汇总未生成：〈原因〉。招标分析结果见下方。」不写「不影响」「可照常审阅」，不用「解读」二字。

## 3. 改了哪些文件

| 文件 | 改动 |
|---|---|
| `src/lib/workforce-runtime/constants.ts` | 错误码常量、识别字面量、归类函数、执行失败码集合（供 FIX-20b 复用）、降级判定；仍零依赖 |
| `src/lib/agent-runtime-v2/executor.ts` | 轮首降级函数 `degradeFailedNativeSynthesisSteps`；批量路径失败分支写归类后的码；让出分支保留重试的码。`agent-runtime-v2/` 下只改这一个文件，没有新文件 |
| `src/lib/workforce-runtime/processor.ts` | 回收段写 `stale_running_recovered` 与 `step.ready` 事件 |
| `src/lib/workforce-runtime/handoff.ts` | 跳过的综合汇总的摘要与警告 |
| `src/lib/tender-workforce/tools.ts` | 第 9 步：canonical V2 模式下综合结果可选 |
| `src/lib/workforce-runtime/read-model/stop-reason.ts` | 新码、取码规则、具体原因码集合、重试判定与重试句、「综合汇总未生成」说明句 |
| `src/lib/workforce-runtime/read-model/projection.ts` / `types.ts` / `service.ts` | 停止原因计算时机、任务视图 `retry`、作业视图 `synthesisNotGenerated`；步骤查询多取两列 |
| `src/lib/tender-workforce/job-failure-surfacing.ts` | 原因顺序、余额不足标记、分析记录错误码取失败步骤的 |
| `src/lib/tender-workforce/trigger-service.ts` | 卡片接口三项说明（`projectAgentCardNotes`） |
| `src/app/(main)/workforce/[id]/page.tsx` | 进度一节、任务行、最终结果 |
| `src/components/tender-analysis/agent-card.tsx` | 「AI 分析中」那一行与待审阅那一行 |
| `scripts/test-all.sh` / `scripts/test-ci-unit.sh` | 注册两个新测试（加在 FIX-13 的注册行之后） |
| 测试 | 新增 `step-failure-visibility.test.ts`、`synthesis-degrade-db.isolated.test.ts`；扩 `stop-reason.test.ts`、`job-failure-surfacing.test.ts`、`job-failure-surfacing-db.isolated.test.ts`、`operator-ux.test.ts` |
| `openspec/changes/tender-job-synthesis-degrade/` | tasks 打勾；规格增量与 design 补「no credits remaining」（§7 第 1 条） |
| `docs/acceptance/fix-20/` | 四张本地截图（§6） |

## 4. 测试：改动前 / 改动后

改动前（main `13c7ed33` 的代码 + 先写好的两个新测试）：

- `npx tsx src/lib/workforce-runtime/__tests__/step-failure-visibility.test.ts`：**18 通过，29 失败**（缺归类 / 降级 / 重试 / 说明句函数；第 8 步余额不足时视图原因是「前置步骤没有完成」；进行中有失败步骤不带停止原因；源码断言全不成立）。摘录：
  ```
  ✗ 第 8 步余额不足 → 不写「前置步骤没有完成」 {"stepIndex":8,"stepTitle":"Workforce 执行汇总","reasonZh":"前置步骤没有完成",…}
  ✗ 进行中有失败步骤 → 带停止原因
  ✗ 处理器回收：写 stale_running_recovered，尝试次数不动
  结果: 18 通过, 29 失败
  ```
- `NODE_ENV=test npx tsx src/lib/tender-workforce/__tests__/synthesis-degrade-db.isolated.test.ts`（隔离库）：**12 通过，27 失败**，复现生产现象。摘录：
  ```
  ✗ 第一次失败、还剩一次：回到待开始，尝试 1 次，错误码 model_quota_exhausted {"status":"ready","attemptCount":1,"errorCode":null}
  [tender-alert] run=… notified=2 code=blocked_graph
  ✗ 第 8 步改为已跳过，原错误码与错误原文保留 {"status":"failed","errorCode":"synthesis_failed"}
  ✗ 分析记录为待审阅 {"status":"AGENT_FAILED","errorCode":"blocked_graph","reason":"卡在第 8 步〈Workforce 执行汇总〉：前置步骤没有完成"}
  ✗ Job 已完成 {"status":"needs_human","errorCode":"blocked_graph","t9":"pending"}
  ✗ 契约损坏时原因写「执行出错」 {…"errorMessageSanitized":"卡在第 8 步〈Workforce 执行汇总〉：需要人工处理"…}
  FIX-20 synthesis degrade DB: 12 passed, 27 failed
  ```
  通过的 12 条是「不该变」的部分：第 3 步失败照旧停下、契约损坏照旧停下、第 9 步输入缺失照旧报错等。

触碰模块的已注册测试（开工前 / 结束，同一隔离库 `qy_iso_f`）：

| 测试 | 开工前 | 结束 |
|---|---|---|
| `step-failure-visibility.test.ts`（新，纯函数，进 CI 子集） | — | 92 |
| `synthesis-degrade-db.isolated.test.ts`（新，隔离库） | — | 39 |
| `read-model/__tests__/stop-reason.test.ts` | 22 | 35（既有四条 `stopReasonFromCodes` 用例补了 `stepFailed` 参数，见 §7 第 2 条） |
| `tender-workforce/__tests__/job-failure-surfacing.test.ts` | 27 | 50 |
| `job-failure-surfacing-db.isolated.test.ts` | 15 | 20 |
| `workforce/__tests__/operator-ux.test.ts` | 95 | 102 |
| `t5-p11-resumability` / `t5-seg3-v2-convergence` / `t5-seg2-v2-spine` / `t1b-pure` / `phase2b1-contracts` / `p0-alignment-pure` / `t5-plan-seam` / `obs-p1-latency-self-trigger` | 44 / 40 / 44 / 36 / 60 / 28 / 37 / 27 | 不变 |
| `projection-golden` / `list-service` / `service-read-only` | 74 / 36 / 40 | 不变 |
| 隔离库：`phase2b2-final-gate` / `phase2a-stale-worker` / `p0-execution-alignment` / `phase2b1-task-handoff` / `phase2b1-approval-handoff` / `phase2b2-parallel-claims` / `phase2b2-parallel-execution` / `phase2a-normal-slices` / `phase2a-lease` / `phase2a-timeout` / `phase2c1-pause-resume` / `t1b-integration` | 32 / 31 / 58 / 42 / 19 / 24 / 36 / 10 / 16 / 7 / 26 / 40 | 不变 |

## 5. 门禁

| 项 | 结果 |
|---|---|
| `npm test`（全量） | **主会话跑** |
| CI 环境变量下 `npm run test:ci`（`scripts/test-ci-unit.sh`；`DATABASE_URL` 指向不存在的 CI 库、`NODE_ENV=test`、不设 `DATABASE_ENVIRONMENT`，与 `.github/workflows/ci.yml` 一致） | 末行 `CI unit subset PASS`（含新的 `step-failure-visibility.test.ts` 与扩展后的 `job-failure-surfacing.test.ts`） |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` | 通过（退出码 0） |
| `npm run lint:baseline` | PASS（无新增 error 指纹；相对基线少 15 处 error）。脚本提示「无法列出相对 sourceCommit 的变更文件，跳过 PR 改动文件附加检查」，另对本次改动的 19 个 ts / tsx 文件单独跑 `npx eslint`：无输出（0 问题） |
| `bash scripts/test-runtime-architecture.sh` | `runtime-architecture guards PASS`（基线未改） |
| `bash scripts/check-test-registry.sh` | OK（已注册 684 个；历史欠账 66 条） |
| `openspec validate tender-job-synthesis-degrade --strict` | valid |
| `git diff origin/main -- prisma/ vercel.json src/lib/runtime-architecture/runtime-architecture-baseline.json src/lib/workforce-runtime/synthesis.ts src/components/tender-analysis/analysis-panel.tsx` | 空 |
| `git diff origin/main --stat -- src/lib/agent-runtime-v2/` | 只有 `executor.ts` |

注：`origin/main` 在本分支合入 `13c7ed33` 之后又合了 FIX-12、FIX-13 的归档（#545、#547，改了 TASKFLOW 与主规格）；本分支没有再合 main，上面两条 diff 对 `origin/main` 与 `13c7ed33` 结果相同。开 PR 前合一次 main，TASKFLOW 的 FIX-20 行紧挨 FIX-13 行，可能要手动解冲突。

## 6. 截图（本机隔离库的演示数据，生产构建 `next build --webpack` + `next start`）

`docs/acceptance/fix-20/`：

| 文件 | 内容 |
|---|---|
| `01-job-retrying.png` | 作业页：进度一节「第 8 步〈Workforce 执行汇总〉正在第 1 次重试（最多重试 1 次）。上一次没成功：AI 账户余额不足，请联系平台管理员充值」，第 8 步那一行下面同一句 |
| `02-job-final-result.png` | 作业页：9 / 9 完成，第 8 步「已跳过」，时间线「Workforce 执行汇总（综合汇总未生成，已跳过）」，最终结果「AI 数字员工的综合汇总未生成：AI 账户余额不足，请联系平台管理员充值。招标分析结果请到项目里审阅。」 |
| `03-project-card-review.png` | 项目「招标要求」页签的卡片：「分析结果已就绪，请在下方审阅确认」下方「本次 AI 数字员工的综合汇总未生成：AI 账户余额不足，请联系平台管理员充值。招标分析结果见下方。」 |
| `04-project-card-retrying.png` | 项目卡片「AI 分析中 · 7/9 个任务完成」那一行后面的重试句 |

拍摄说明：演示用户临时设为本组织 `org_owner`、项目成员，组织开了 `bids` 等模块（作业页对招投标作业的可读判定要这些）；演示数据拍完已从隔离库清掉。开发模式（`next dev`）在本机拍不出来：Turbopack 不接受指向工作树外的 `node_modules` 软链，webpack 开发模式的页面不水合，所以改用生产构建。拍完删掉了构建产物 `.next`：tsconfig 把 `.next/types` 算进类型检查，留着它 `npm run typecheck` 会报既有路由 `api/projects/[id]/tender-rfq/attachment/route.ts` 多导出一个常量的类型错误（与本次改动无关；删掉后 typecheck 退出码 0）。

## 7. 与四件套的出入

1. **余额不足字面量补了「no credits remaining」**（协调方转 Lucas 的生产日志）：`constants.ts` 加一条（注释写出处），纯函数测试加两条、收尾测试加一条；规格增量 `agents/workforce-step-retry-visibility`「步骤失败时按确定性规则记下错误码」第 1 条加这条字面量并加一个场景「生产日志里的余额不足原话」；design D5 字面量清单同步。`openspec validate --strict` 通过。
2. **`stopReasonFromCodes` 加了必填参数 `stepFailed`**：D9 改了取码规则（失败步骤只用自己的码、非失败步骤只用 Job 的码），函数必须知道所取的是不是失败步骤。`stop-reason.test.ts` 既有四条用例补上这个参数（用意不变：「步骤码优先」改为「失败步骤用自己的码」，「其次 Job 码」改为「不是失败步骤用 Job 的码」）。
3. **「具体原因码」集合**按规格的四种原因取码：`model_quota_exhausted`、`org_ai_budget_exhausted`、`step_attempts_exhausted` / `model_failed`（重试次数用尽）、`stale_running_exhausted` / `external_timeout`（长时间没有进展）。
4. **卡片接口的 `retrying` 与 `synthesisNotGenerated` 各多一个 `sentenceZh`**（服务端拼好的整句，固定中文 + 步骤名 + 序号），这样卡片组件不自己拼原因文字（tasks 2.5「组件不自己拼原因文字」）。作业视图只带 design 写的字段，作业页用读模型里同一个函数拼句子。
5. **重试判定的「待开始」包括 `ready` 与 `pending` 两种内部状态**（界面上两者都显示「待开始」）；实际写入的重试状态都是 `ready`。
6. 作业页「最终结果」：有 `synthesisNotGenerated` 时先写那句说明；若同时有 `finalSummary`（现在没有写入方）也照常显示在下面。
7. 隔离库测试「依赖里什么都没有」一组用直接调用第 9 步工具的方式（给定声明依赖的产出），不经处理器——处理器路径下构造不出「第 8 步既无综合结果也无标记却已终态」的状态。

## 8. 合并顺序与协调

- **FIX-15** `workforce-invocation-deadline`：两边都改批量路径的让出分支。本 change 只改块内 `errorCode` 那一个值（挪到 `completedAt: null` 之后、值在块外算好），不碰 `evidenceJson`；`if (batchContinuation)` 与 `completedAt: null` 之间的字符数从 587 减到 560，没有加。后合并的一方变基后重跑 `t5-p11-resumability.test.ts` 与 `step-failure-visibility.test.ts` 的源码断言（后者断言块内 `errorCode: yieldErrorCode`、块外 `row.attemptCount >= 2 ? row.errorCode : null`）。FIX-15 先合并时，被截止时间截断满 3 次的第 8 步以 `INVOCATION_DEADLINE_REPEATED` 失败，本 change 归为 `synthesis_failed`，照样降级。
- **FIX-18**（招标分析只留一个入口）：还没合并，所以卡片的两句写在 `agent-card.tsx`。FIX-18 后合并时，它抽 `agent-card-view.ts` 要把这两句（WORKING 时的 `retrying.sentenceZh` / `blockedReason`，待审阅时的 `synthesisNotGenerated.sentenceZh`）一并搬过去，`job-failure-surfacing.test.ts` 里本次加的三条卡片源码断言改为对纯函数做用例。这是语义迁移，不只是文本冲突。
- **FIX-20b** `tender-job-continue-from-failed`：依赖本 change（执行失败码集合 `SYNTHESIS_EXECUTION_FAILURE_CODES` 已从 `constants.ts` 导出），排在 FIX-18 之后。
- **FIX-16**：不碰 `alerts.ts` 的完成通知与分析面板；卡片那句只说「招标分析结果见下方」，与 FIX-16 的「项目解读」未完成说明不冲突。
- **FIX-13**（已合并）：注册行加在它之后。

## 9. 行为变化（评审要知道的）

- **契约损坏时原因从「需要人工处理」变成「执行出错」**（D9 末）：失败的那一步就说那一步出了错。隔离库测试「契约损坏」一组断言了这一点。
- 分析记录的 `errorCode` 现在是失败步骤自己的码（如 `model_quota_exhausted`、`tool_failed`、`HANDOFF_VERSION_UNSUPPORTED`），不再多是 `blocked_graph`；`[tender-alert]` 日志与通知元数据随之改变。通知摘要用的是那句「卡在第 N 步…」，不受影响。
- 进行中而有失败步骤的作业（任何业务域，不只招投标）作业页现在也写停止原因（D10）。
- 第 8 步最终失败到下一轮降级之间（通常同一次定时任务内），作业页与项目卡片会短暂写「卡在第 8 步〈Workforce 执行汇总〉：AI 账户余额不足…」。
- 进度仍显示「9 / 9 项任务完成」（跳过计入完成，G5 按推荐 A），靠「最终结果」与卡片那句补上。

## 10. 留给 GATE / 待生产核对

1. **G1 生产 SQL 待跑**（§1），结果按「四种结果」定根因描述与是否补字面量。
2. **「no credits remaining」的确切原文**以 FIX-15 分支 `docs/acceptance/fix-15/prod-check.sql` A 段结果为准；不同就在 `constants.ts` 补一条。
3. 生产的 `OPENAI_BASE_URL` 是否是 OpenAI 直连（代理商的余额不足原话可能不同），待核对。
4. 多维审查：**未做**。按 `openspec/config.yaml` 要在开 PR 前并行派子 agent（正确性与回归、安全 / 隐私与八条硬纪律、规格—代码—测试一致性、使用流畅与文案、运行时共用路径），结论补进本节与 PR 正文。

## 11. 没做的

- FIX-20b「从失败的这一步继续」：单独的 change，本次没有实施。
- 识别到余额不足时跳过重试（G2 按推荐 A：不跳过）。
- 作业列表卡片的「N 项受阻」不加原因（G7）；完成通知不提综合汇总（归 FIX-16）；Muse `analysis.ready` 文案不改。
- 作业页对「模型调用被限流 / 单次调用超时 / 模型调用全部失败」三种已知标记仍按笼统码显示「工具执行失败」（CHAIN-0c 既有取舍，proposal Out of scope）。
- `handoff_build_failed`（第 8 步自己的产出放不进交接数据）不降级（D3）。
- 用户时间线的重试条目（`job.retrying` 没有写入方）不新增。
- 不补救 11-22「12-3」那个 Job。
- tasks 3.1 的 `npm test` 由主会话跑，3.1 未打勾。
