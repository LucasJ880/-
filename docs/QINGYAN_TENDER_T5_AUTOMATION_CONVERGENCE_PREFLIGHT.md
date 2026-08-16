# 青砚 Tender T5 — Automation Convergence Preflight

日期：2026-08-14 ｜ 基线：main @ `48200b98807c4dd7ed0a293ad65d6e6ac33fcfcb` ｜ 性质：真实代码审计（非文档转述）

T5 目标 = Automation + Learning Loop。本文档是**实施前收敛预检**：硬依赖矩阵、第二队列债务、
deterministic plan 状态、收敛矩阵、事件→作业映射、记忆学习门。**本轮零 T5 实施。**

---

## 1. 硬依赖矩阵

| 依赖 | 状态 | 证据 |
|---|---|---|
| WORKFORCE_RUNTIME_PRODUCTION_READY | **PASS** | durable queue + lease：`src/lib/workforce-runtime/processor.ts:143/581`（`WORKFORCE_LEASE_MS=3min`、`claimRunLease` 原子抢占、`createRunFence` fenced 写、backoff 阶梯、无 `while(true)`）；生产 cron `*/2` 复用 `/api/cron/agent-runs`（`vercel.json:59-62` → `processQueuedWorkforceJobs(2)`）。注意：默认并行度 1（`parallel.ts:34`），吞吐 2 jobs/2min |
| DETERMINISTIC_PLAN_INJECTION | **BLOCKED_PENDING_RUNTIME_DESIGN_GATE** | 见 §3 |
| TASK_CONTRACT_STABLE | **PARTIAL** | `workforce-task/v1` zod 冻结（`task-contract.ts:25/47`，`z.literal` + `.strip()` + fail-closed reader `:233`）；但 `resources`（并行安全冲突检测的关键字段）在 v1 内追加未 bump 版本（`:65-67`）→ 旧 reader 静默 strip，是隐性降级而非干净版本门 |
| WORKER_REGISTRY_STABLE | **PASS** | 静态有界注册表 3 workers（`workers.ts:40`），零 authz 字段，unknown workerKey/taskKind 整计划拒绝（`task-contract.ts:147-161`） |
| HANDOFF_STABLE | **PASS** | `workforce-handoff/v1` 版本化+32KB 封顶+`.strip()` 白名单（`handoff.ts:26/104`）；下游只读声明的 `dependsOn` 上游（`:555`）；authz 字段禁入（`:52/76`）；golden fixture 锁定 |
| APPROVAL_SCOPE_POLICY_INTEGRATED | **PARTIAL** | 拦截+PendingAction+单一 resume 入口真实存在（`executor.ts:605/1449`、`resume.ts:85`、过期≠拒绝 `port.ts:526`）；但 `canInvokeTool` 输入被硬编码（`executor.ts:436-441/1065-1070`：`domain:"sales"` 字面量、无 toolPolicy、`modulesJson:undefined`→org/workspace/module 三层策略失活）；resume 时 scope/approval freshness 重查显式未实现（`resume.ts:17-18`）；tender 工具全部 `requiresApproval:false`（`tender-workforce/tools.ts`）→ 审批门在唯一生产调用方上零覆盖 |
| T2_DATA_READY | **PARTIAL** | 台账/归档基础已 merge（PR #102）；EXPENSE_SUBMIT 三权解耦在 Draft PR #104 未 merge（dark）→ T5 财务相关自动化事件源不齐 |
| T3_DATA_READY | **PASS**（作为地基）| Buyer/MemoryClaim/Evidence 已 merge（PR #103 @ f9549ab），写门 CONSERVATIVE_ADMIN_ONLY + AI_AUTO_MEMORY_WRITE 拒绝（`claim-service.ts:117-135`）；语义检索 DESIGN_ONLY；**零外部消费者**（本轮 T4 是第一个只读近邻） |
| T4_DATA_READY | **PASS（2026-08-14 生产激活）** | PR #107 merged @ 399a769；生产 migration 已应用（drift 取证 → resolve → deploy），`T4_AWARD_INTELLIGENCE_SCHEMA_READY=1`；生产烟测通过（真实 CanadaBuys 检索 → 人工确认 → AwardRecord HUMAN_CONFIRMED + provenance + 组织页可见）。own-project backfill 仍仅 dry-run；数据量从零积累 |

## 2. 第二队列债务（TENDER_SECOND_QUEUE_DEBT = YES）

`tender-auto-analysis` 是独立于 workforce runtime 的完整第二套编排：
自有表（`TenderAnalysisRun`）、自有 lease（`worker.ts:33` `LEASE_MS=90s`、CAS 抢占 `:222-234`）、
自有 cron（`vercel.json:63-66` → `/api/cron/tender-auto-analysis`）。
7 状态（PENDING→EXTRACTING→ANALYZING→REVIEW_REQUIRED→APPROVED + FAILED/SUPERSEDED，`constants.ts:14`）
× 10 步（`constants.ts:445` WORKER_STEPS）。**它同时是历史收敛债与最有价值的参照物**：
它就是一条手写的 deterministic pipeline——workforce 路径想用 LLM planner 重建的 DAG，这里已经以代码存在。

**禁令（永久）**：不再创建 TenderQueue / TenderWorkerRuntime / TenderJobEngine / TenderPipelineExecutor /
TenderScheduler / TenderBackgroundRuntime，任何第三套 scheduler/queue/lease/approval/worker registry。

## 3. Deterministic Plan Injection — BLOCKED + 接口提案

**现状**：`createWorkforceJob()` 只收 `goal: string`（`job.ts:35/98`）；`sanitizeExtraMetadata`（`:62`）
限 ≤16 键标量、≤500 字符——DAG 无法通过。唯一 plan 生产者 = `processor.ts:278 if (!run.planJson)`
→ `planAgentRuntimeV2` → `persistPlanAndSteps`（全库仅两个调用点）。
T1B 的 `buildTenderAnalysisGoal()`（`trigger-service.ts:89`）把 8 节点 DAG 写成中文散文 prompt 交给 LLM
——DAG 是「被期望的」，不是「被注入的」。唯一 hardcoded 例外 `buildSalesFollowupGoldenPlan`
（`planner.ts:84/229`）由 goal 正则触发，不是可参数化 seam。

**提案（须 Runtime 设计门批准后实施，本轮不动 runtime）**：

```
CreateWorkforceJobInput 增加可选字段：
  plan?: ServerAuthoredPlanV1   // { contractVersion: "workforce-plan/v1", tasks: WorkforceTaskSpecV1[] }

createWorkforceJob 内：
  if (input.plan) {
    validated = applyWorkforceTaskSpecs(input.plan)   // 复用现有 LLM 计划同一验证器（task-contract.ts:106）
    persistPlanAndSteps(run, validated, { source: "server_authored" })
  }
处理侧零改动：processor.ts:278 的 `if (!run.planJson)` 守卫天然跳过 planner。
```

要点：与 LLM 计划**同一验证路径**（worker/taskKind/依赖闭包/resources 全部照常拒绝非法计划）、
`source` 标记可观测、不绕过 approval/handoff/lease 任何一层。
Tender adapter 随后仅是把 `WORKER_STEPS` 翻译成 `WorkforceTaskSpecV1[]` 的纯函数。

## 4. tender-auto-analysis 收敛矩阵

| CURRENT_STAGE | CURRENT_SERVICE | 域价值 | 需队列语义? | TARGET_WORKFORCE_TASK | 处置 | PARITY 要求 | 回滚路径 |
|---|---|---|---|---|---|---|---|
| package ready gate | `package-ready.ts` | 高 | 否 | 前置校验节点 | **KEEP_AS_DOMAIN_SERVICE** | 覆盖率/排除口径逐字节一致 | 纯函数，无 |
| enqueue（幂等） | `enqueue.ts`（advisory lock + 幂等键） | 高 | 是 | `createWorkforceJob` 替代 | WRAP_AS_ADAPTER（后期） | 幂等键语义保持；replay 不产生双 run | flag 切回旧 cron |
| parse/ENSURE_PAGES | worker step | 中 | 否 | `tender_worker.parse` task | KEEP_AS_DOMAIN_SERVICE（task 内调用） | 页级产物 schema 不变 | 同上 |
| EXTRACT_FACTS（V2 grounding） | `tender-understanding/*` + `v2-persist.ts` fence | **极高** | 否 | `tender_worker.extract` task | **KEEP_AS_DOMAIN_SERVICE（绝不重写）** | 证据 verbatim+页码验证纪律 100% | 引擎独立于编排，无需回滚 |
| analyst synthesis（两遍） | `tender-analyst/*` | 极高 | 否 | `synthesis_worker` task | KEEP_AS_DOMAIN_SERVICE | PASS A/B + 硬校验规则不降级 | 同上 |
| risk/clarification | worker steps | 高 | 否 | task 节点 | KEEP_AS_DOMAIN_SERVICE | RFI 生成语义不变 | 同上 |
| external intelligence（M1/M2/M2.5） | `tender-intel/*` FINALIZE hook | 高 | 否（best-effort） | `award.search` task（人工门后接 T4） | KEEP_AS_DOMAIN_SERVICE | 自动提取→多线→交叉验证→人工确认管线契约不变 | flag TENDER_EXTERNAL_INTEL_ENABLED |
| reply resolution | `reply-resolution.ts` | 中 | 否 | task 节点 | KEEP_AS_DOMAIN_SERVICE | 证据硬验证不降级 | 同上 |
| finalize/review gate | worker FINALIZE + REVIEW_REQUIRED | 高 | 是 | run 终态 + Needs You | WRAP_AS_ADAPTER（后期） | 人工 review 门永不跳过 | flag 切回 |
| queue/lease/cron 本体 | `worker.ts` 编排层 | 低（纯编排） | — | workforce runtime | **RETIRE（最终）** | 全 stage parity 后才退役 | 双跑期 flag 二选一 |

**原则**：Workforce controls orchestration + Tender services perform domain work。V2 Grounding Engine 永不删除。

## 5. 事件 → 作业映射（设计冻结，本轮不激活）

| 事件 | canonical 事件源 | 幂等键 | 目标 job | 审批/人工门 | 重试 | 防重 |
|---|---|---|---|---|---|---|
| tender.created | Project.create(workDomain=tender)（DB 事实，非 UI 回调） | `tender:{projectId}:analysis:{docsFingerprint}` | package prep → analysis → intelligence | 分析结果 REVIEW_REQUIRED 人工门（现状保持） | runtime backoff 阶梯 | 幂等键 + at-most-one active job（`trigger-service.ts:35/77` 已有语义） |
| tender.submitted | tenderStatus→submitted 转移 | `tender:{projectId}:award-watch` | award watch（公开来源周期查询） | 发现变化→Needs You，人工确认才落 AwardRecord | 低频（日/周级），失败静默重试 | 幂等键唯一 active watch |
| award.found | award-watch 人工确认（AwardRecord 落地事件） | `award:{awardRecordId}:outcome-review` | outcome review（对比我方出价/复盘） | 复盘结论人工签收 | 一次性 job | awardRecordId 唯一 |
| tender.closed | tenderStatus→won/lost 转移 | `tender:{projectId}:memory-consolidation` | memory consolidation（见 §6） | **强制**：candidate→human/admin confirm→MemoryClaim | 一次性 job，可重跑（幂等 claim 观察） | supersede 链防重复 claim |

**禁止**：单独 `/api/cron/tender-award-watch`——award watch 必须是 workforce job（否则形成第三套自动化 runtime）。

## 6. 记忆学习门（Memory Consolidation Gate）

现阶段禁止：AI → MemoryClaim(ACTIVE) 直写。T3 双 gate 已在代码层强制
（actorType ai/agent → `AI_AUTO_MEMORY_WRITE_DISABLED`，`claim-service.ts:117-135`；本轮 T4 award service
同纪律 `AWARD_AI_WRITE_DISABLED`）。

冻结的正确链路：
```
Tender closed → synthesis(AI) → Memory candidate/proposal（非 MemoryClaim 行）
  → evidence 挂载 → human/admin 确认（复用 PendingAction，不建第二套 approval）
  → corporate-memory service（createMemoryClaim, actor=user）→ MemoryClaim(ACTIVE)
```
注意：MemoryClaim 无 `PROPOSED` 状态（`types.ts:91-97`，刻意 deferred）——candidate 载体须在 T5 设计门
定夺（PendingAction.payload 承载 vs 新增 proposal 表），**不得**擅自给 MemoryClaim 加状态。

## 7. T5 实施顺序建议（下轮起点）

1. **Runtime 设计门**：批准 §3 plan-injection 接口（runtime owner 视角评审）
2. task-contract v1→v1.1 版本纪律修复（`resources` 显式版本化）
3. approval 策略输入修复（`canInvokeTool` 真实 domain/policy 注入）+ resume freshness 三道门
4. Tender deterministic plan adapter（`WORKER_STEPS` → `WorkforceTaskSpecV1[]` 纯函数）+ 双跑 parity
5. award watch job（§5 第二行）+ memory consolidation candidate 载体设计
6. 旧队列退役（全 parity 后，flag 双跑期收尾）
