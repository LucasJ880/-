# Qingyan Workforce Runtime — Phase 2B Design：Structured Handoff + Parallel Task Execution

- 日期：2026-08-09
- 分支：`feature/workforce-runtime-phase2`（与 Phase 2A 实施并行；本文档基于 main 基线代码审计，2A 新增文件截至写作时尚未出现在 worktree）
- 性质：**READ-ONLY 设计产物**。本轮未实现任何代码、未修改 Prisma、未新增表、未触碰 Phase 2A 文件。
- 上游依据：`docs/QINGYAN_WORKFORCE_PHASE2_ARCHITECTURE_AUDIT.md`（下称"审计报告"），已冻结决策不偏离：Job = root AgentRun、Task = AgentRunStep、Agent = Worker、AgentRunVerification = Checkpoint、PendingAction = Human Intervention；禁止 WorkforceJob/WorkforceTask 表与第二套 queue/approval/RBAC/Runtime。
- 核心问题：**当一个 Job 被拆成多个 Task 后，青砚如何安全地让多个 Worker 执行这些 Task，并将结果结构化传递给后续 Task / Job Owner？**

目标架构（Multi Task ≠ Multi Agent）：

```text
Job（root AgentRun, runType="workforce_job"）
 └─ Qingyan Job Owner（编排身份，不直接执行业务 Tool）
     ├─ Task A（AgentRunStep）→ Worker A ─┐
     ├─ Task B（AgentRunStep）→ Worker B ─┤ 受控并行
     │                                    ▼
     ├─ Result Aggregation（显式 Task）
     │        │ Structured Handoff（outputJson 信封，refs not copies）
     │        ▼
     ├─ Task C（AgentRunStep）→ Worker C
     │        ▼
     ├─ Verify（AgentRunVerification）
     └─ Job Complete → Owner 收报告
```

不变边界：Job-first、Task-first、Controlled Worker Assignment、Structured Result、Controlled Handoff。**不做**几十个 Agent 自由聊天、不做 agent 花名册、不做无限委托。

---

## 1. Executive Decision

```text
AgentRunStep = Workforce Task?          →  PARTIAL（结构 YES，三处执行语义缺口，全部零迁移可补）
Parallel execution readiness?           →  UNSAFE（今天开 parallelism>1 会双跑；补 CAS 认领+幂等短路后可控开放）
Structured Handoff readiness?           →  PARTIAL（运输管道 READY：priorEvidence；协议 MISSING：无信封/无来源/无质量标记）
```

一句话：**并行与 Handoff 的"管道"都已存在（DAG 推进、outputJson 接力、PendingAction 幂等），缺的是三个薄层——step 级认领、Handoff 信封、并行策略分类器——全部可以零 Prisma 迁移落地。**

---

## 2. Existing Architecture（真实文件路径 + 调用链）

### 2.1 Task 执行链（Runtime V2，Phase 2A 泛化的宿主）

```text
startAgentRuntimeV2Run                src/lib/agent-runtime-v2/process.ts L55
 → createAgentRun(runType="runtime_v2")   src/lib/agent-runtime/run.ts
 → planAgentRuntimeV2（planJson）          src/lib/agent-runtime-v2/planner.ts L206
 → persistPlanAndSteps（AgentRunStep DAG） src/lib/agent-runtime-v2/persist.ts L16
 → processAgentRuntimeV2Run（round loop）  process.ts L159
     → executeRuntimeV2Round               executor.ts L39
         → refreshReadySteps（DAG 推进）    persist.ts L81
         → canInvokeTool 重鉴权            executor.ts L167
         → executeRuntimeV2Tool            adapters.ts L98
         → outputJson/evidenceJson 持久化   executor.ts L331
     → verifyRuntimeV2Run                  verifier.ts L178
 → 审批：resumeRuntimeV2AfterApproval      process.ts L238（经 src/lib/approval/port.ts）
```

### 2.2 Worker 执行链（Supervisor，Worker 概念的现存唯一实现）

```text
runSupervisor → runPlanLoop            src/lib/agent-supervisor/engine.ts L109
 → executeWorkerStep                    src/lib/agent-supervisor/workers/run-worker.ts L23
     → isSkillAllowedForWorker（白名单）  src/lib/agent-supervisor/worker-registry.ts L93
     → runSkill                          src/lib/agent-core/skills/runtime.ts L143
         → runAgent(runtime: actor=AGENT, owner=USER)  runtime.ts L276–283
 → observeStepResult → replan/complete   observer.ts / replanner.ts
状态载体：AgentRun.supervisorState JSON（不落 AgentRunStep）
```

### 2.3 共享安全底座（2B 全部复用，不重建）

- 审批与写副作用：`src/lib/pending-actions/executor.ts` —— payloadHash 校验（L164–192）、执行时重授权 fail-closed（L195–258）、`@@unique([orgId, idempotencyKey])`（schema L2075）
- 行锁串行化模式：`src/lib/tender-auto-analysis/enqueue-package.ts` L399–415（Project 行 FOR UPDATE）、`src/lib/capabilities/governance/policy.ts` L59–62（Organization 行锁）
- CAS claim 模板：`src/lib/agent-runtime/queue.ts` L80–104（updateMany 条件认领 + lease + attempts++）
- 运行时身份契约：`src/lib/ai/runtime-context.ts`（actor/agent/owner/jobId/taskId/run 树；`deriveChildRunContext` L142–162 READY 未接线）
- 配额：`src/lib/capabilities/governance/types.ts` L1–7（`MAX_CONCURRENT_RUNS` / `DAILY_AGENT_RUNS` / `SINGLE_RUN_ESTIMATED_COST` 等指标已存在）

### 2.4 必答审计问题

**Q1：AgentRunStep 是否足够承担 Workforce Task？→ PARTIAL（结构 YES，执行语义三缺口）**

全字段审计（`prisma/schema.prisma` L4681–4716）：

| 字段 | Workforce Task 语义 | 判定 |
|---|---|---|
| `stepKey` + `@@unique([runId, stepKey])` | Task 稳定标识 | READY |
| `status`（pending/ready/running/awaiting_approval/completed/partially_executed/failed/blocked/skipped，schemas.ts L89–98） | Task 生命周期词汇表完整 | READY |
| `dependsOnJson` | DAG 依赖（见 Q2） | READY |
| `preferredTool` | Tool 绑定 | READY |
| `executionMode`（read/write/analysis/approval） | 并行策略输入 1 | READY |
| `riskLevel`（LOW/MEDIUM/HIGH/CRITICAL） | 并行策略输入 2 | READY |
| `requiresApproval` + `pendingActionId` | 人工干预挂接点 | READY |
| `attemptCount/maxAttempts` | Task 级重试预算（executor.ts L266–278 真实生效） | READY |
| `inputJson/outputJson/evidenceJson` | Task 输入 / 结构化产物 / 证据 | READY（Handoff 信封的承载地） |
| `idempotencyKey` + `@@unique([orgId, idempotencyKey])` | 幂等键 | **PARTIAL：只写不读**（executor.ts L226 写入，全文件无 findFirst 查重） |
| Worker 身份 | 无任何列/字段 | **MISSING（零迁移补 inputJson.worker）** |
| 资源冲突声明 | 无 | **MISSING（零迁移补 inputJson.resources）** |

**Q2：dependsOnJson 是否真正执行 DAG dependency？→ YES，真实 enforcement。**

- `persist.ts` L71–79 `dependenciesSatisfied`：deps 全部 ∈ {completed, skipped, partially_executed} 才返回 true；
- `persist.ts` L81–106 `refreshReadySteps`：只有依赖满足的 pending step 被翻为 ready；
- `persist.ts` L47：创建时无依赖 step 直接 ready、有依赖 step 为 pending；
- executor 每轮先调 `refreshReadySteps`（executor.ts L95）再取 ready 集合。
- 结论：**A、B 都 completed 后 C 才 ready** 在代码上成立。旁证：executor.ts L124–135 还有依赖死锁检测（无 ready 且有 pending → needs_human "步骤依赖无法推进"）。

**并行能力审计：同一 Job 三个 ready Task，现在能否安全由三个 Worker 并行执行？→ UNSAFE，四个原因：**

| 环节 | 现状 | 证据 |
|---|---|---|
| parallelism flag | `AGENT_RUNTIME_V2_PARALLELISM` 默认 1，可配 | flags.ts L76 |
| ready-step selection | `ready.slice(0, limits.parallelism)` 切了 batch，**但随后只执行 `ready[0]`** —— flag>1 也不会并行 | executor.ts L107–109 vs L150 |
| step claim / running transition | `db.agentRunStep.update` 直接置 running，**无 status="ready" 条件的 CAS**；两个并发 driver（2A cron 续跑 + 用户触发 resume）会对同一 step 双跑 | executor.ts L221–228 |
| tool execution | 读工具直查 DB；写工具只 createDraft（副作用被 PendingAction 层拦住） | adapters.ts 全文件 |
| idempotency | step 键只写不读；**真正防重在 PendingAction 唯一键**（稳定业务键 `{runId}:{stepKey}:{actionType}:{targetId}`，不含 attempt） | executor.ts L214–228；adapters.ts L308/375/448；schema L2075 |
| retry | 失败回 ready 重跑（L266–278），重跑读/分析工具=重复成本，重跑写工具=靠 PendingAction 唯一键报 unique violation 而非优雅短路 | executor.ts L266–278 |
| verification | verifier 是 run 级串行闸门，与 step 并行无冲突；但 BLOCKED/REPAIR 判定读全量 steps，天然容忍并行完成顺序 | verifier.ts L11–134 |

结论：**UNSAFE**。不是架构性缺陷，而是三个执行语义缺口：无 step 级 CAS 认领、幂等只写不读、batch 未真正并发执行。补齐即可受控开放（§3.4）。

---

## 3. Parallel Task Policy（四类）

### 3.1 分类定义与判定规则

policy 是**派生值**（纯函数 `classifyTaskPolicy(step)`），不落库、不加列——落库会造成与 executionMode/riskLevel 的双写漂移。判定顺序（先命中先生效）：

| Policy | 判定规则 | 典型例子 |
|---|---|---|
| **REQUIRES_APPROVAL** | `requiresApproval=true` ∨ `executionMode ∈ {write, approval}` ∨ preferredTool 属外发/承诺类目录 | send_email、submit_tender、publish_content、modify_quote、create_external_commitment、spend_budget——即使互相无冲突也必须 Task → PendingAction → WAITING_FOR_HUMAN → Approval → Resume（现有链路：executor.ts L289–328 step 转 awaiting_approval → `markAgentRunAwaitingApproval` → `resumeRuntimeV2AfterApproval`） |
| **EXCLUSIVE_RESOURCE** | 声明了 `resourceKey` 且与"运行中 ∪ 待审批"步骤的 resourceKey 相交 | 两个 Task 都要改 Opportunity #123：无 dependsOn 关系，但绝不能同时执行（防 lost update——现有写路径如 `execSalesUpdateFollowup`（pending-actions/executor.ts L834–873）是 findUnique→update 的 last-write-wins，无乐观锁） |
| **SAFE_PARALLEL** | `executionMode ∈ {read, analysis}` ∧ `riskLevel ∈ {LOW, MEDIUM}` ∧ `requiresApproval=false` ∧ resourceKey 无交集 | 读 CRM 客户、读 Project、读 Tender requirements、读 Supplier、公开 research——只读无副作用，随便并行 |
| **SEQUENTIAL** | **默认 fail-safe**：以上都不确定、`riskLevel ∈ {HIGH, CRITICAL}`、工具未在目录中标注、或 DAG 已表达先后（Extract→Analyze→Generate） | 依赖链靠 `dependsOnJson` 天然串行，policy 不需要重复表达 |

`resourceKey` 概念（只设计，不实现 distributed lock）：格式 `{entity}:{id}`，词汇表见 §10.1。承载于 `inputJson.resources: string[]`（零迁移），由 planner 在产计划时声明、adapters 在已知目标实体时补充。**漏声明的后果被 fail-safe 吸收**：未声明资源键的写步骤本来就落入 REQUIRES_APPROVAL（写必审批是全栈不变量），最坏情况是用户看到两份冲突草稿，而非数据损坏。

### 3.2 并行上限（不定死数字，给约束模型）

建议 **`WORKFORCE_JOB_MAX_PARALLEL_TASKS` env，默认 1（=现状），推荐运行区间 2–3，硬上限 4**。评估依据：

| 约束 | 证据 | 含义 |
|---|---|---|
| Serverless 时长 | v2 `timeoutMs` 默认 180s（flags.ts L75）；2A 引入 per-slice timeout | 并行减少轮次总时长，是正收益；但单轮 `Promise.allSettled` 的最慢者决定轮时长，batch 过大反而挤爆 slice |
| LLM 成本/速率 | 分析步骤每个都是 Grader 调用（adapters L160–213）；`SINGLE_RUN_ESTIMATED_COST`、`MONTHLY_AI_COST` 配额已存在（governance/types.ts） | 并行 = 成本尖峰前移，配额预检要按 batch 估算而非单步 |
| DB 连接 | 每步多次 Prisma 查询；Vercel serverless 连接池有限 | batch ≤ 4 时可忽略，是"不要无限并行"的理由之一 |
| 外部 API rate limit | Gmail/Google Calendar 等（adapters gmail_create_draft） | 外发类本来就是 REQUIRES_APPROVAL 串行，天然不受并行影响 |
| Tool 副作用 | 写全走 PendingAction，读无副作用 | 并行只对 read/analysis 开放，副作用面为零 |
| Org 配额 | `MAX_CONCURRENT_RUNS`/`DAILY_AGENT_RUNS` 是 run 级指标 | Model A（§8）下并行 task 不多吃 run 配额——这也是不为每个 task 建 child run 的理由之一 |

未来并行度必须同时受四层约束：**Org quota（governance 已有）→ Job budget（planJson constraints，§7）→ Tool risk（policy 分类）→ Resource conflicts（resourceKey）**。任一层收缩即降级到串行，永远合法。

### 3.3 调度语义（round loop 改造设计）

```text
每轮（executeRuntimeV2Round 改造后）：
1. refreshReadySteps（不变）
2. ready 集合逐个 classifyTaskPolicy
3. 组 batch：
   a. 队首为 REQUIRES_APPROVAL / SEQUENTIAL → batch = [队首]（退化为今天的行为）
   b. 否则收集 SAFE_PARALLEL，逐个对比 resourceKey：
      冲突对象 = 本 batch 已选步骤 ∪ 本 run 内 status ∈ {running, awaiting_approval} 步骤
      （awaiting_approval 也占用资源键：审批窗口内不得并行产生同资源第二份草稿）
      收满 min(maxParallelTasks, 无冲突数) 为止
   c. EXCLUSIVE_RESOURCE 仅当其全部资源键无占用时，单独成 batch
4. 逐个 CAS 认领（§3.4 T2），认领失败者丢弃（另一 driver 已拿走）
5. Promise.allSettled 并发执行，逐个持久化（现有单步持久化代码不变）
6. 任一步骤 awaiting_approval → run 转 awaiting_approval（现行为不变）
```

### 3.4 前置改造（并行安全底座，全部零迁移）

- **T1 幂等短路**：执行前 `findFirst({orgId, idempotencyKey: buildStepOperationKey(...)})`，命中已完成记录 → 复用 outputJson 直接标 completed（审计报告 §4 既定要求，读工具也获得防重放）。
- **T2 step 级 CAS 认领**：`updateMany({ where: { id: step.id, status: "ready" }, data: { status: "running", attemptCount: { increment: 1 }, ... } })`，count=0 即让出。照抄 queue.ts L80–104 的 run 级模板降到 step 粒度，无需新列。
- **T3 batch 并发执行**：对认领成功集合 `Promise.allSettled`。

回滚保证：`maxParallelTasks=1` 时调度语义与今天逐字节一致；只在 `runType="workforce_job"` ∧ flag>1 时启用批量分支。

---

## 4. Worker Model（Job Owner ≠ Worker ≠ Tool）

三层身份，映射到 Phase 1.1 契约（runtime-context.ts）：

| 概念 | 定义 | 例（Prepare Tender Submission） | 承载 |
|---|---|---|---|
| **Job Owner** | 对 Job 负责的**编排身份**：计划、指派、监控、收 handoff、触发验证、汇报；**不直接执行业务 Tool** | Qingyan Operator | root run 的 `agent: { id: "qingyan-operator" }`；Human Owner 另存 `owner: { type: "USER", id }`（2A 落 metadata） |
| **Worker** | 执行某个 Task 的**受控数字员工身份**，白名单约束能用哪些 skill/domain | `tender_technical_worker`（对应现有 registry 的 `tender`） | Task 上 `inputJson.worker`（§5）；执行时注入 `actor: { type: "AGENT", id, userId }` |
| **Tool** | Worker 完成 Task 所调用的具体能力，每次调用独立鉴权 | document_search、requirement_extract | `preferredTool` 列 + tool-catalog / requiredTools |

**不默认 Worker=Agent**：现有代码已经证明 Worker 是"身份 + 白名单 + 预算"的轻量概念，不是独立进程/独立 Agent——`WORKER_REGISTRY`（worker-registry.ts L33–76）里 worker 只是配置对象，执行仍走统一的 `runSkill`/`runAgent`。Job Owner 与 Worker 的分离在 Supervisor 线已成立：engine.ts 的 runPlanLoop 从不直接调业务工具，只通过 `executeWorkerStep` 派发（engine.ts L181–188）。

**Job Owner 职责清单**（映射到现有资产，2B 不新建 Owner 引擎）：

| 职责 | 现有实现 |
|---|---|
| Plan | planner.ts（v2）/ planner.ts（supervisor） |
| Task assignment | 2B 新增：plan step 的 worker 字段（§5） |
| Monitor | AgentRunEvent 流 + observer.ts |
| Replan | replanner.ts（预算 maxReplans） |
| Resolve conflicts | §3.3 调度器（Owner 逻辑的一部分） |
| Receive handoffs | §11 聚合读模型 |
| Trigger verification | process.ts L214–220（ready_for_verification → verifyRuntimeV2Run） |
| Request human intervention | needs_human / awaiting_approval 既有转移 |
| Final report | buildFinalReport → §11 泛化 |

---

## 5. Worker Identity Storage Recommendation

四个 Option 对比（基于现有 schema、查询需求、审计需求、未来 handoff/reassignment）：

| Option | 方案 | 优点 | 缺点 | 判定 |
|---|---|---|---|---|
| **A：inputJson/metadata（零迁移）** | `AgentRunStep.inputJson.worker = { id, kind: "registry", skillSlug? }`；事件 payload 带 worker（run-worker.ts L79–91 已这样做） | 零迁移；与 supervisorState.worker、runSkill actor 注入天然衔接；reassignment = 改 inputJson + 事件记录 | JSON 内字段不可索引，"按 worker 过滤"要全扫 | **推荐（2B V1）** |
| B：`AgentRunStep.workerId` 新列 | 可空列 + `@@index([orgId, workerId])` | 可索引查询；审计直观 | 迁移成本；当前**没有任何生产查询按 worker 过滤**——为不存在的查询加列违反"能避则避"（审计报告 §13） | 演进项，触发条件：按 worker 过滤的高频产品查询真实出现，从 inputJson 回填 |
| C：独立 Task Assignment 表 | WorkerAssignment(taskId, workerId, assignedAt, ...) | 完整 assignment 历史、支持多次 reassignment 审计 | 第六套状态机风险；与"禁止 WorkforceTask 表"精神冲突；reassignment 历史 AgentRunEvent 已可承载（append-only 事件天然是历史） | 拒绝 |
| D：复用其他现有模型 | 如 SkillExecution.userId / supervisorState | SkillExecution 只记录技能维度，无 Task 关联索引；supervisorState 是 run 级 JSON blob，V2 线不存在 | 语义错位 | 拒绝 |

**推荐：Option A**，配三个接线点：(1) planner `PlanStepSchema` 增加可选 `worker` 字段，Zod 白名单 fail-closed（非法 worker 清空，与 `sanitizePlannerOutput` 对非法 tool 的处理同模式，planner.ts L42–47）；(2) `persistPlanAndSteps` 写入 `inputJson.worker`；(3) 执行层从 step 读 worker → `isSkillAllowedForWorker` 校验 → 注入 runSkill 的 `runtime.actor/agent`（runtime.ts L276–283 已是正确样板）。Worker reassignment（replan 改派）= 更新 inputJson.worker + 追加 `task.reassigned` 事件，无需表。

### 5.1 Worker Registry 审计（worker-registry.ts 能否成为 Workforce Worker Registry？）

**能，作为起点直接复用，缺四项元数据（按需补配置对象字段，不重新实现）：**

| 维度 | 现状 | 判定 |
|---|---|---|
| Worker ID | `WorkerId` enum（sales/tender/marketing/analytics，types.ts L20–26） | 已存在 |
| role/displayName/description | `WorkerConfig`（worker-registry.ts L9–16） | 已存在 |
| allowed skills | `allowedSkills` 白名单 + `isSkillAllowedForWorker`（L93–98） | 已存在，真实 enforcement（run-worker.ts L35–44） |
| allowed domains | `allowedDomains` | 已存在（但 run-worker 未 enforcement，仅 skill 白名单生效——2B 可顺手校验） |
| 预算 | `maxSkillCallsPerRun` | 已存在 |
| allowed **tools** | **缺失**：Worker→skill→requiredTools 是间接约束（skills/runtime.ts L244–261），Worker 直接调 tool 无白名单 | 2B 需要时补 `allowedTools?: string[]`；V1 中 v2 线工具目录本身就是全局白名单（tool-catalog.ts），非阻塞 |
| capability scope | **缺失**（scope 由 scopeGuard/canInvokeTool 每次执行判定，不在 registry） | 正确缺失——scope 属于执行时鉴权（§9），不该进 registry |
| risk ceiling | **缺失** | 补 `maxRiskLevel?: "LOW"|"MEDIUM"|"HIGH"`，调度器据此拒派 CRITICAL task |
| model preference | **run 用途级存在**（model-resolve.ts：planner/observer/summary/repair 四个 env），**worker 级缺失** | 补 `modelPreference?: string`，缺省走 ProviderRouter 现有回退 |

---

## 6. Structured Handoff Contract（最小 Contract）

### 6.1 先回答：现有字段已能表达多少？

| 候选字段 | 现有承载 | 判定 |
|---|---|---|
| jobId | rootRunId（2A metadata 契约） | 已有 |
| fromTaskId / toTaskId | stepKey / 下游 dependsOnJson 反查 | 已有（隐式） |
| inputs | `asEvidenceMap` 把上游 outputJson 按 stepKey 注入 priorEvidence（executor.ts L24–34、L245） | 已有（裸数据接力） |
| outputs | `outputJson`（分析工具已是结构化 `{grader, result, evidenceQuality}`，adapters L60–95） | 已有 |
| evidence | `evidenceJson` + verifier 的 `evidenceReferencesJson` | 已有 |
| 依赖表达 | `dependsOnJson` 真实 enforcement | 已有 |
| fromWorker / toWorker | 无 | **缺（§5 补）** |
| objective / constraints / status / decisionContext / resourceRefs | 无 | **缺（信封补）** |

结论：**缺的不是运输，是信封**——"谁产的、给谁、什么目标、什么质量、约束是什么、证据在哪"。因此 Handoff = 在既有 `outputJson` 上加一个 `handoff` 子键，搭 priorEvidence 既有管道，**运输层零改动**，老消费者（buildFinalReport、workbench、adapters 硬编码读 `s5_prioritize`）不受影响。

### 6.2 HandoffEnvelope v1 schema（落 `src/lib/workforce/handoff-contract.ts`，纯类型+纯函数）

原则：**Handoff Reference > Copy Everything**。只传 refs 与目标，不复制 conversation、memory、tool logs、prompt。minimal / structured / auditable / scoped。

```text
AgentRunStep.outputJson = {
  ...业务数据（现状不变）,
  handoff: {
    handoffVersion: 1,                       // 版本字段，消费端按版本解析，未知版本 fail-closed
    handoffId:  "hof:{jobId}:{fromTaskId}",  // 确定性生成：重试同 step 覆盖同 id，天然幂等
    jobId:      rootRunId,
    fromTaskId: stepKey,
    toTaskId:   string | null,               // planner 回填；null = 广播给全部 dependsOn 下游
    fromWorker: inputJson.worker?.id ?? "runtime",
    toWorker:   string | null,
    objective:  string,                      // 下一步要达成什么（来自 plan step 的 expectedOutput）
    inputRefs:  string[],                    // 本步消费的上游 stepKey（= dependsOnJson 显式化）
    outputRefs: string[],                    // 产物定位符："outputJson.result.prioritized"
    evidenceRefs: string[],                  // "step:{stepKey}" / "pendingAction:{id}" / "skillExecution:{id}" / "file:{fileId}"
    resourceRefs: string[],                  // 触碰的业务资源键（与 §10.1 同词汇表）
    constraints: { budget?, deadline?, riskCeiling? } | null,
    decisionContext: string | null,          // ≤500 字符的决策要点摘要（不是 conversation 转储）
    status:     "ok" | "partial" | "blocked",// 映射既有 evidenceQuality：FULL→ok；PARTIAL/degraded→partial；失败→blocked
    createdAt:  ISO string
  }
}
```

示例（Tender 场景，**仅为设计说明，非实现**）：

```json
{
  "handoffVersion": 1,
  "handoffId": "hof:run_abc123:t1_requirements",
  "jobId": "run_abc123",
  "fromTaskId": "t1_requirements",
  "toTaskId": "t4_technical_response",
  "fromWorker": "tender",
  "toWorker": "tender",
  "objective": "基于强制要求清单撰写技术应答，覆盖全部 mandatory 项",
  "inputRefs": [],
  "outputRefs": ["outputJson.result.mandatoryRequirements", "outputJson.result.scoringCriteria"],
  "evidenceRefs": ["step:t1_requirements", "skillExecution:se_789", "file:doc_456"],
  "resourceRefs": ["tender:td_001", "project:pj_002"],
  "constraints": { "deadline": "2026-08-20T00:00:00Z", "riskCeiling": "MEDIUM" },
  "decisionContext": "37 项强制要求中 3 项存疑（资质年限口径），已标注 needsClarification",
  "status": "ok",
  "createdAt": "2026-08-09T20:00:00Z"
}
```

### 6.3 校验规则与时机

- **写时**（executor 持久化 step 完成前）：Zod safeParse；失败**不阻断 step 完成**，handoff 置 `{status:"blocked", error}` 并发 `handoff.invalid` 事件——契约损坏是可观测降级，不是执行失败。
- **读时**（下游 step 消费 priorEvidence 时）：上游 `status="blocked"` → 按依赖失败处理（等价 adapters L222–226 `MISSING_GRADER_EVIDENCE` 的显式拒绝模式）；`status="partial"` → 允许执行但产物必须继承 partial（verifier L100–113 已保证 PARTIAL 不算完整完成）。
- **版本**：`handoffVersion !== 1` → 拒绝按信封消费，退回读裸 outputJson。

### 6.4 Handoff 需要状态机吗？→ 不需要（V1）

CREATED/READY/ACCEPTED/CONSUMED/FAILED/CANCELLED 逐项映射：CREATED/READY = 上游 step completed（DAG 语义）；ACCEPTED/CONSUMED = 下游 step running/completed（`refreshReadySteps` + step status 已表达）；FAILED = `handoff.status="blocked"`；CANCELLED = run cancelled 级联。**Task dependency + output/evidence 已覆盖全部转移**，独立状态机会造成 step status 与 handoff status 双源漂移。唯一补充：消费事实用 `handoff.consumed` AgentRunEvent 记录（审计可见），不引入状态列。

### 6.5 §29 检查：是否需要 WorkforceHandoff 表？→ 不需要（V1），触发条件明确

逐项判断：

- **durability**：outputJson 随 AgentRunStep 持久化，run 树 cascade 删除语义正确 → 不需要表；
- **queryability**：V1 查询模式只有"按 run 聚合"（§11 读模型）和"按 step 溯源"，`@@index([runId, status])` 已覆盖 → 不需要表；
- **integrity**：handoffId 确定性生成 + 写读两段校验 + `@@unique([runId, stepKey])` → 不需要表；
- **many-to-many handoff history**：V1 的 handoff 是 1:N 广播（一个上游 → 多个 dependsOn 下游），由 DAG 表达；真正 M:N（跨 Job handoff、handoff 转发链）不在 2B 边界内。

**建表触发条件**（满足其一再议）：跨 run/跨 Job 的 handoff 查询成为产品需求；handoff 数量级脱离 step 数量级（一 step 多 handoff）；需要对 handoff 单独做保留策略/合规审计导出。

---

## 7. Child Run Decision

```text
USE_CHILD_RUN_FOR_EVERY_TASK = NO
```

Model A（一个 Job = 一个 AgentRun，Task = Step，Worker 同 run 内执行）vs Model B（每个 Worker = child AgentRun）：

| 维度 | Model A（推荐默认） | Model B（每 Task 一个 child run） |
|---|---|---|
| traceability | rootRunId 单树，AgentRunEvent 线性序列（`@@unique([runId, sequence])`） | `deriveChildRunContext` READY（runtime-context.ts L142–162）但**生产零调用**；跨 run 事件序列要客户端合并 |
| lease | 一个 run 一个 lease（2A 泛化），无孤儿 | 每个 child 独立 claim/续租/超时收敛，孤儿 child 需要新 cron 语义——凭空引入审计报告 §5 全部 lease gap 的 N 倍复制 |
| retry | step 级 attemptCount 已生效（executor L266–278） | run 级 attempts 与 step 级 attempts 双层叠加，重试语义歧义 |
| parallelism | §3 调度器在单 run 内控制 batch，资源键对比只查本 run steps | 跨 run 资源冲突需要全局查询，冲突控制复杂度升维 |
| cost accounting | `MAX_CONCURRENT_RUNS`/`DAILY_AGENT_RUNS` 按 run 计——N 个 task 只吃 1 个 run 配额 | 每 task 吃一个 run 配额，5-task Job 直接逼近熔断 |
| approval | PendingAction.agentRunId=父 runId，resume 单入口（process.ts L238） | 审批 resume 要跨 run 树 reconcile，2C 要治理的竞态翻倍 |
| runtime identity | worker 身份在 step + runSkill actor 注入（Supervisor 已验证：run-worker.ts 把父 runId 直接传给 runSkill 的 agentRunId） | child run 有独立 metadata 身份，更"干净"但为此付出上述全部成本 |
| failure isolation | step failed 不传染兄弟 step（DAG 只阻塞下游） | run 级隔离更强，但 2B 的 worker 都是白名单 skill，无需进程级隔离 |
| complexity | 复用全部现有机制 | 新增跨 run 编排层 |

**什么时候才真正需要 child run**（同时满足其一 + 独立 flag，2B 最后一片可无限期推迟）：

1. Task 预期执行时长超过父 run 的 per-slice timeout，需要**独立 lease/checkpoint 生命周期**（真正的 delegated long-running work）；
2. Task 的写动作需要**独立审批边界**（如跨 workspace 的委托）；
3. Task 需要独立取消而不影响 Job（父 run cancel 级联 vs 子 run 单独 cancel）。

派生时强制：`deriveChildRunContext` 接线 + **maxDelegationDepth=1**（§8）+ 预算继承（child 的成本记入父 Job 预算）。

### 7.1 Delegation Depth（只设计保护）

- `maxDelegationDepth` 常量（V1=1）：创建 child run 前计算深度 = 沿 `parentRunId` 上溯至 rootRunId 的跳数（`readRootRunIdFromUnknown` + parentRunId 列已支持，schema L4643–4644），≥ 上限即拒绝并 needs_human；
- 不变量：child 的 `rootRunId`/`jobId` 恒等于父的（`deriveChildRunContext` L156 已实现该继承）；`parentRunId` = 直接父；任何 child 不得自立为新 Job；
- 事件：`delegation.created` / `delegation.rejected(depth_exceeded)` 落 AgentRunEvent。

---

## 8. Scope Inheritance（防 privilege escalation）

不变量：**Child Worker Scope ≤ Parent Job Scope，Handoff 与 Worker 永远不是权限提升机制。**

| 维度 | 继承规则 | 现有 enforcement |
|---|---|---|
| org | 恒等继承，不可变 | 全部查询带 orgId；executor 每轮重查 membership（executor.ts L82–93） |
| workspace | 子集继承：Task ⊆ Job 的 workspaceId | scopeGuard（runSkill L284 注入） |
| project / business entity | Task 只能触碰 Job 声明的实体集（runtime-context 的 projectId/customerId/tenderId...）；handoff 的 resourceRefs 必须 ⊆ 父 Job 实体集，越界 → 拒绝消费 + needs_human | 2B 新增校验点（消费端读 handoff 时） |
| capability / tool | Worker 白名单 ∩ org 启用技能 ∩ tool policy；三层现有校验不放宽（run-worker.ts L35–77 白名单+成员+技能启用；executor.ts L167–184 canInvokeTool） | 已有 |
| approval | 审批人身份由 PendingAction 的 approverUserId/requiredRole 决定，与 worker 无关；worker 不能自批 | 已有（pending-actions 层） |

**禁止样例**：Task A（scope=Project A）产 handoff → Worker B 借该 handoff 读整个 org 的数据。防线：handoff 只含 refs（§9），Worker B 解引用任何 ref 时都走自己当下的 scopeGuard/canInvokeTool——引用不等于授权。

---

## 9. Authorization Re-Evaluated（Handoff 不携带权限）

规则：**Handoff 只能传 context references + objective；永远不能传 `authorized=true` / `role=admin` / `approvalPassed=true` / `canWrite=true` 之类字段作为可信执行依据。** HandoffEnvelope schema（§6.2）**没有任何权限语义字段**——这是契约设计而非约定。

每次 Tool execution 重新鉴权，四层全部已存在：

1. membership 现查：executor.ts L82–93（每轮）+ run-worker.ts L47–62（每 worker step）；
2. tool 鉴权：canInvokeTool（executor.ts L167–184，权限变化 → step failed + run needs_human，**不是静默跳过**）；
3. scopeGuard：runSkill L284 注入，fail-closed；
4. 审批执行时重授权：pending-actions/executor.ts L195–258（tool policy 现查 + fail-closed + payloadHash 防篡改）——即使 handoff 声称"上游已批准"，写动作落地时仍以 PendingAction 当刻状态为准。

Phase 1.1 已把 principal 逻辑固化：审批人 ≠ 执行主体（`resolveRuntimeV2Principal`，process.ts L258–286——发起人身份失效则 needs_human，不借用审批人身份继续跑）。2B 沿用，零新建授权路径。

---

## 10. Conflict Model

### 10.1 Resource Conflict Key（只设计）

词汇表：`customer:{id}`、`opportunity:{id}`、`quote:{id}`、`project:{id}`、`tender:{id}`、`email-thread:{id}`（可扩展，格式恒为 `{entity}:{id}`）。承载：`inputJson.resources`（声明）+ `outputJson.handoff.resourceRefs`（事后审计）。生成者：planner（计划期已知实体）+ adapters（执行期解析出目标实体时补写）。

### 10.2 Read/Write 矩阵

| 组合 | 策略 | 依据 |
|---|---|---|
| Read / Read | **ALLOW PARALLEL** | 无副作用（adapters 读工具直查 DB） |
| Read / Write（同资源） | 默认允许并行（read 拿到的快照可能陈旧——由 verifier 的证据时效检查兜底）；若 read 结果直接驱动该 write，planner 应表达为 dependsOn，从而天然串行 | DAG 优先于锁 |
| Write / Write（同资源） | **SERIALIZE**：resourceKey 相交 → 不同 batch；且 awaiting_approval 的写步骤持续占用资源键（防审批窗口内产生第二份冲突草稿） | §3.3 调度器 |
| External side effect（邮件/外发/承诺/花钱） | **默认 approval + idempotency + exclusive resource** 三件套：REQUIRES_APPROVAL 分类 + PendingAction 稳定幂等键 + resourceKey 排他 | 全部现有机制组合 |

### 10.3 与行锁/审批线的分工（三层防线）

- **计划/调度层**（2B 新增）：resourceKey 排他——防止冲突动作并行**产生**；
- **审批层**（已封板）：写全过 PendingAction，人审是最终串行点，`@@unique([orgId, idempotencyKey])` 防重复执行；
- **执行层**（按需点状）：具体 executor case 需要 read-modify-write 一致性时用业务行 FOR UPDATE（模式：enqueue-package.ts L399–403 / policy.ts L59–62）。**不实现 distributed lock 服务**——三层组合已覆盖 2B 场景，全局锁服务是第二套 Runtime 的开端。

跨 Job 互斥（两个 Job 同时操作 Opportunity #123）：V1 不做全局资源锁，依赖审批层汇聚 + 2D Job 视图可见性；若有实证需求，抄"父行锁 + 事务内查活跃 run"模式（enqueue-package.ts L399–415）。

---

## 11. Result Aggregation

**谁聚合？比较四个候选：**

| 候选 | 评估 |
|---|---|
| Job Owner（编排身份在 runtime 里顺手聚合） | 聚合逻辑藏进调度器，不可测、不可重跑、不产生证据 |
| **dedicated synthesis Task（显式 Task）** | **推荐**。聚合本身是一个有输入（上游 handoffs）、有输出（综合结论）、有证据、可重试、可验证的工作单元——它就该是 AgentRunStep。**现有代码已这样做**：黄金计划的 `s5_prioritize` 正是显式聚合步骤（dependsOn s3+s4，消费 priorEvidence，产结构化 prioritized 列表，adapters.ts L215–283）。用户直觉正确，且有代码先例 |
| Verifier | 职责是判定"是否完成"，不是生产综合产物；让 verifier 聚合会混淆裁判与运动员 |
| Supervisor summarize | `buildValidatedFinalSummary` 是**面向人的最终汇报**，消费聚合结果而非替代聚合 |

**推荐分工**：结构性聚合 = 显式 SYNTHESIS Task（SAFE_PARALLEL 上游 → 聚合 step，DAG 表达）；**Job 级最终报告** = 读模型 `aggregateJobResult(runId)`：遍历 steps 的 `outputJson.handoff` 按拓扑序输出 `{taskId, worker, status, objective, outputRefs, evidenceRefs}[]` + 最后一次 AgentRunVerification verdict/summary，替换 `buildFinalReport` 的硬编码 stepKey（process.ts L436 只认 `s5_prioritize`，非黄金场景报告残缺）。聚合是**推导值**，不写第二份状态，事实源仍是三表（AgentRun/AgentRunStep/AgentRunVerification）。

**Proactive Reporting（事件模型，复用 AgentRunEvent，不建 Notification Runtime）**：

| 时刻 | 事件 | 现状 |
|---|---|---|
| Job started | `plan.created`（visibleToUser） | 已有 |
| 进度（3/5 tasks completed） | `step.completed` 已逐个发；补一个带 `{completed, total}` payload 的 `job.progress`（每 step 完成时由 executor 顺手计算） | 微增 |
| Waiting for approval | `approval.required` | 已有 |
| Task failed and replanning | `tool.failed` + `verification.repair_required` | 已有 |
| Completed | `run.completed`（payload 增加聚合摘要） | 已有，payload 增强 |

投递面（thread 消息 / 微信推送 / 三列视图）属 2D；2B 只保证事件与读模型齐全。

---

## 12. Failure Model（retry / fallback / replan / needs human）

四种动作、适用条件、现有机制映射：

| 动作 | 适用条件 | 现有机制 |
|---|---|---|
| **RETRY_SAME_WORKER** | 临时性失败：API 超时、rate limit、模型瞬时错误 | step attemptCount < maxAttempts → 回 ready（executor.ts L266–278）；`classifySkillFailure` 已区分 timeout/rate_limit（skills/runtime.ts L35–49）；2B 的 T1 幂等短路保证重试无重复副作用 |
| **FALLBACK_WORKER** | worker 不可用 / 模型特定失败 / 可降级错误 | 工具内降级已存在：`runGraderWithGuardedFallback`（adapters L53–96，degradable → fallback 产 partial 证据）；**换 worker 统一走 replan 重指派 worker 字段，不建第二套"换人"机制** |
| **REPLAN** | 输入假设失效 / 上游结果变化 / tool 不可用 / 审批被拒后需调整路线 | supervisor `replanSupervisor`（预算 maxReplans；审批拒绝后 replan 的完整闭环见 engine.ts L617–695）；v2 线的轻量等价物 = verifier REPAIR 重置 failed steps（verifier L289–298，2C 增强为消费 repairInstructions） |
| **NEEDS_HUMAN** | 权限问题 / 业务歧义 / 审批被拒且不可绕行 / 不可逆风险 / 预算耗尽 | run needs_human 的既有触发点：membership 失效（executor L82–93）、鉴权失败（L185–211）、DAG 死锁（L124–135）、reconcile 不安全（process.ts L358–375）、repair 预算耗尽（verifier L312–318）、principal 失效（process.ts L263–286） |

决策树：

```text
Task 失败
├─ 错误可分类为临时（timeout/rate_limit/瞬时 5xx）？
│    └─ attempt < maxAttempts → RETRY_SAME_WORKER（幂等短路保护）
├─ 错误可降级（classifyGraderError.degradable）？
│    └─ FALLBACK（同 worker 工具内降级）→ handoff.status="partial"，verifier 拒绝当完整完成
├─ 属于假设失效/上游变化/工具不可用/审批被拒？
│    └─ replan 预算未耗尽 → REPLAN（可重指派 worker）
│    └─ 预算耗尽 → NEEDS_HUMAN
└─ 权限/歧义/不可逆风险 → 直接 NEEDS_HUMAN（fail-closed，不重试不换人）
```

**Partial Completion**：Task A/B completed + C failed ≠ Job failed。映射现有状态（**不新增状态值**，与审计报告 §9 一致）：

| 逻辑 Job 结果 | 现有 AgentRun.status |
|---|---|
| COMPLETED | `completed` |
| PARTIALLY_COMPLETED | `partially_executed`（v2 词汇表已有，schemas.ts L84；reconcile 已产生该值，process.ts L320/L388） |
| BLOCKED | `awaiting_approval`（等审批）/ `needs_human`（等非审批输入） |
| FAILED | `failed`（仅当无任何有效产物或不可恢复） |

判定规则（verifier 增强，非新状态机）：存在 completed steps 且 failed steps 不在关键路径（无下游依赖它的未完成必要步骤）→ `partially_executed` + 报告明示未完成项；关键路径断裂 → needs_human 而非 failed（人可决定 replan 或放弃）。

---

## 13. Verification Model（Task / Job）

**结论：Both，但不对等——Task 级 = 轻量确定性 checkpoint（不落新表），Job 级 = AgentRunVerification（现有表，不新增 verifier 表）。**

```text
task result（outputJson + handoff.status）
  → optional task checkpoint（确定性规则，执行层内联：
      · handoff schema 校验（§6.3 写时）
      · evidenceQuality 传播（FULL/PARTIAL/NONE，adapters 已产出）
      · 结果为空/越界资源 refs → step 级 blocked
      不调模型、不写 AgentRunVerification、不加表）
  → job-level verification（现有 verifyRuntimeV2Run：
      确定性检查 → 模型复核 → AgentRunVerification 落库（attempt 递增）
      PASS/REPAIR/NEEDS_HUMAN/BLOCKED 四 verdict 驱动 run 终态）
```

依据：AgentRunVerification 有 `@@unique([runId, attempt])`（schema L4733）——它天然是 **run 级**记录；把它改成 step 级要么加列迁移、要么 attempt 语义崩坏。而 Task 级检查全部是确定性规则（schema/quality/scope），不需要持久化 verdict——step 的 status/errorCode/handoff.status 就是其结果。verifier 已做的"PARTIAL 证据不算完成"（L100–113）与"写操作未决即 BLOCKED"（L36–47）说明 Job 级验证已经在消费 Task 级质量信号，2B 只是把信号从隐式（evidenceQuality 散落）变成显式（handoff.status）。

---

## 14. Golden Scenarios

### 14.1 Scenario 1 — Sales Follow-up Job

"帮我整理最近需要跟进的客户，分析优先顺序，并给我下一步行动建议。"

| Task | Worker | Policy | 依赖 | 对应现有资产 |
|---|---|---|---|---|
| A 读 Customer | sales | SAFE_PARALLEL | — | `sales_get_pipeline`（adapters L103） |
| B 读 Opportunity | sales | SAFE_PARALLEL | — | `sales_list_opportunities`（L136） |
| C 读 recent communications | sales | SAFE_PARALLEL | — | interactions 查询（L149–153 已内嵌，可独立成步） |
| D 优先级分析（SYNTHESIS 显式聚合 Task） | sales | SEQUENTIAL（DAG） | A,B,C | `sales_prioritize_followups`（L215–283，priorEvidence 消费的现成样板） |
| E 生成 follow-up plan（含草稿） | sales | REQUIRES_APPROVAL | D | `grader_create_followup_task`/`sales_update_followup`/`gmail_create_draft`（全走 createDraft） |
| Verification | — | — | 全部 | verifyRuntimeV2Run |
| Report | Job Owner | — | — | aggregateJobResult → thread |

设计验证：A/B/C 同批并行（今天串行 3 轮 → 1 轮，parallelism 的真实收益点）；D 是显式聚合 Task（§11 结论的落地）；E 的三个草稿动作资源键分别为 `customer:{id}`/`opportunity:{id}`，互不相交可同批准备草稿，但全部 REQUIRES_APPROVAL → awaiting_approval → 人审 → resume（现有闭环 process.ts L238）。A/B/C 的 handoff：`status=ok, outputRefs=["outputJson.opportunities"], resourceRefs=["customer:*只读不占键"]`——读步骤不占用排他资源键。

### 14.2 Scenario 2 — Tender Job（Prepare Tender Submission）

| Task | Policy | 依赖 | 分析 |
|---|---|---|---|
| A Requirements extraction | SAFE_PARALLEL | — | 读 tender 文档 + 抽取（现有 skill：`tender-mandatory-compliance-matrix` 属 tender worker 白名单，worker-registry L48–59） |
| B Document indexing | SAFE_PARALLEL | — | 读+索引，无写业务对象 |
| C Supplier & pricing context | SAFE_PARALLEL | — | 读 Supplier/历史报价 |
| D Technical Response | SEQUENTIAL | A, B | 消费 A 的强制要求清单 handoff（§6.2 示例即此）；分析类，产物是文档草稿数据 |
| E Pricing | EXCLUSIVE_RESOURCE + REQUIRES_APPROVAL | C, D | 资源键 `quote:{id}`/`tender:{id}`；改报价 = modify_quote，必审批 |
| F Compliance check | SEQUENTIAL | D, E | 分析类（`tender-disqualification-check`） |
| G Final Verification | — | 全部 | Job 级 verifier |
| （若含 submit_tender） | REQUIRES_APPROVAL + EXCLUSIVE `tender:{id}` | F | 外部承诺，永远过 PendingAction（审计报告 §11 "No autonomous external commitments"） |

并行判定：A/B/C 同批；D 等 A+B；E 与 F 因 DAG 串行；E 是全场唯一 EXCLUSIVE_RESOURCE + 审批双重管控点。若两个 Tender Job 同时改同一 Quote：调度层不跨 run 互斥（§10.3），由审批层人审汇聚兜底——这正是"写全过 PendingAction"作为最终防线的价值。

### 14.3 OpenMax / HxA 参考（只取模式）

只学习：ownership 单点问责（Job Owner 恒定）、task handoff 结构化（对应 §6 信封）、status reporting（对应 §11 事件）、structured coordination（plan→dispatch→observe→review→report，与 runPlanLoop 同构）。**禁止引入**：SDK、外部 Runtime 接入、group chat、free-form agent messaging、auto-hiring——与审计报告 §15"不 clone 常驻进程模型"一致。

---

## 15. Schema Proposal

```text
PHASE_2B_SCHEMA_CHANGE = NONE
```

逐项论证为什么现有 JSON 字段足够：

| 需求 | 承载 | 为什么不需要列/表 |
|---|---|---|
| worker 身份 | `inputJson.worker` | 无生产查询按 worker 过滤（query 不成立）；审计经 AgentRunEvent payload（audit 已覆盖）；integrity 由 Zod 白名单 fail-closed 保证 |
| handoff 信封 | `outputJson.handoff` | §6.5 四条判据（durability/queryability/integrity/M:N）全部否定建表 |
| 资源键 | `inputJson.resources` | 冲突对比只发生在单 run 的 ready/running 集合内（每轮全量加载，executor L97 已如此），无索引需求 |
| 执行策略 | 派生纯函数 | 落库 = 双写漂移源 |
| 幂等短路 | 既有 `@@unique([orgId, idempotencyKey])` | 只缺读路径代码，不缺约束 |
| step CAS 认领 | 既有 status 列 + updateMany | 不缺列 |
| Partial completion | 既有 `partially_executed` 状态值 | 不加状态 |
| Task/Job 验证 | 既有 AgentRunVerification（run 级）+ step 内联检查 | 不加 verifier 表 |

未来最小列集（**不在 2B 做**，各附触发条件）：`AgentRunStep.workerId`（触发 = 按 worker 过滤的高频产品查询）；`AgentRunStep.leaseExpiresAt`（触发 = 单 step 时长超 run lease 的实测证据）；`WorkforceHandoff` 表（触发 = §6.5 三条件之一）。"结构更漂亮"不构成迁移理由。

---

## 16. Phase 2B Implementation Slices（小批量、独立验收、可回滚）

| 片 | 内容 | 验收标准 | 回滚 |
|---|---|---|---|
| **2B-1 Parallel Task Policy + Worker Assignment** | `classifyTaskPolicy` 纯函数 + planner PlanStepSchema 加可选 worker（白名单 fail-closed）+ persist 落 `inputJson.worker/resources` + 事件带 worker | 契约测试：四类分类正确、非法 worker 被清洗、默认 fail-safe SEQUENTIAL；flag=1 时全量行为零 diff | 字段可选、函数未被调度消费即无副作用 |
| **2B-2 Structured Handoff** | `src/lib/workforce/handoff-contract.ts`（Zod schema + build/parse/validate 纯函数）+ executor 完成持久化时写 `outputJson.handoff` + 读时校验 | 黄金计划跑完每个 completed step 有合法 v1 信封；partial/blocked 传播正确；老消费者（buildFinalReport/workbench）零回归 | 信封是附加子键，摘除写入点即回滚 |
| **2B-3 Conflict / Resource Control + 并行执行** | T1 幂等短路 + T2 step CAS 认领 + T3 batch 执行 + §3.3 调度语义（resourceKey 排他）；默认 parallelism=1，workforce_job + flag>1 才启用 | 并发双 driver 同 run 测试无双跑；s-A/B/C 类只读步骤同批并行；写步骤/资源冲突步骤不同批；重试不产重复 PendingAction | env 回 1 = 恢复现状 |
| **2B-4 Result Aggregation + Job Owner Reporting** | `aggregateJobResult` 读模型替换 buildFinalReport 硬编码 + `job.progress` 事件 + run.completed payload 聚合摘要 | 非黄金计划也产完整 Job 报告；黄金场景输出不回归；事件序列含进度 | 保留旧 buildFinalReport 为 fallback |
| **2B-5（可选，独立 flag）child run 派生** | deriveChildRunContext 接线，仅 §7 三条件场景；maxDelegationDepth=1 + 预算继承 | child metadata 含完整 owner/job 树；depth=2 被拒 | flag 关闭 |

依赖：2B-3 的 CAS 是并行的硬前置；2B-1/2B-2 互相独立可并行开发；2B-4 依赖 2B-2；2B-5 可无限期推迟。均不依赖 2C/2D。

**Phase 2B V1 边界**（明确不做）：Agent hierarchy / department tree / hiring / social graph / chat rooms / infinite delegation / unlimited parallelism / 跨 Job 全局资源锁 / Handoff 状态机 / WorkforceHandoff 表 / 第三个 Task 模型。V1 = One Job Owner + Multiple Tasks + Controlled Workers + Limited Parallel Execution + Structured Outputs + Structured Handoff + Result Aggregation + Controlled Failure/Replan，仅此而已。

---

## 17. Risk Register

| 风险 | 现状证据 | 2B 对策 |
|---|---|---|
| duplicate task execution | 置 running 非 CAS（executor L221）；双 driver 场景真实存在（2A cron + 用户 resume） | T2 step CAS 认领 + T1 幂等短路 |
| write-write race | executor cases last-write-wins（如 execSalesUpdateFollowup L858–861） | resourceKey 排他（含 awaiting 窗口）+ 写全过 PendingAction 唯一幂等键 + 点状行锁模式备用 |
| cross-scope handoff | 无消费端 scope 校验 | handoff 只传 refs；resourceRefs ⊆ 父 Job 实体集校验；解引用走当刻 scopeGuard（§8/§9） |
| privilege escalation | — | 信封 schema 无权限字段（契约级禁止）；四层执行时重鉴权已封板 |
| stale upstream result | priorEvidence 是完成时快照 | handoff.createdAt + verifier 证据时效检查；关键 read→write 用 dependsOn 表达 |
| double external side effect | 重试重跑写步骤 | PendingAction 稳定幂等键（不含 attempt）已防；T1 让重试优雅短路而非 unique violation |
| parallel quota spike | 并行 = 成本尖峰前移 | batch 前按 SINGLE_RUN_ESTIMATED_COST 预检；maxParallelTasks 硬上限；Model A 下不多吃 run 配额 |
| worker failure | skill 失败已分类（timeout/permission/rate_limit/model_error） | §12 决策树；降级产 partial 证据，verifier 拒绝误判完成 |
| handoff context explosion | 若复制全部上下文，token 与存储双爆炸 | Reference > Copy 原则；decisionContext ≤500 字符；outputRefs 定位而非内联 |
| infinite replan | — | 既有预算全保留：step maxAttempts=2、run maxToolCalls=12、maxRepairs=2、maxReplans、run attempts≤3 |
| delegation recursion | deriveChildRunContext 未接线（风险未激活） | 默认不建 child run；接线时 maxDelegationDepth=1 + rootRunId/jobId 恒定继承 |

---

## 18. Final Recommendation

```text
PHASE_2B_DESIGN_READY = YES
```

无 BLOCKER。两项非阻塞对齐项：(1) 2A 交付的 lease 泛化与 `runtimeFromRunMetadata` 最终签名（2B-3/2B-5 的消费接口，实施时对齐即可）；(2) repairInstructions 指令驱动修复属 2C，2B 失败模型按现状"硬重置"设计，不提前实现。

**Phase 2A 封板后，Phase 2B 第一刀实现：2B-1（Policy 分类器 + Worker Assignment）与 2B-2（Handoff 信封）并行开发** —— 两者都是纯增量（可选字段 + 附加子键 + 纯函数），零迁移、零行为变更、独立契约测试，为 2B-3 的并行调度铺平数据面。并行执行本身（2B-3）必须等 2A 的 lease/claim 泛化封板后再动，因为 step CAS 认领与 run 级 lease 的交互语义需要以 2A 的最终实现为准。

---

*本文档为 Phase 2B 只读设计产物：未实现 parallel execution / Structured Handoff，未改 AgentRunStep schema，未建 WorkforceTask/WorkforceHandoff/Worker 表，未实现 delegation / child AgentRun / Phase 2C / UI。等待评审后按 §16 切片实施。*
