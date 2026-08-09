# Qingyan Workforce Runtime — Observability + Job Timeline + Operator Reporting 设计

- 日期：2026-08-09
- 分支：`feature/workforce-runtime-phase2`（与 Phase 2A 实施并行；本文基于写作时 worktree 中已存在的 2A 代码 + main 基线审计）
- 性质：**READ-ONLY 设计产物**。本轮未实现任何 UI / dashboard / notification，未修改 AgentRun schema，未建新 Event 表，未改 Runtime V2，未实现 Phase 2D。
- 上游依据（冻结决策，不偏离）：
  - `docs/QINGYAN_WORKFORCE_PHASE2_ARCHITECTURE_AUDIT.md`（下称"审计报告"）：Job = root AgentRun、Task = AgentRunStep、状态词汇表零迁移、禁止第六套状态机；
  - `docs/QINGYAN_WORKFORCE_PHASE2A_REPORT.md`（下称"2A 报告"）：`job.created/queued/claimed/lease_renewed/resumed/waiting_human/completed/failed` 事件清单、lease/fencing/processor、审批人 ≠ 执行主体；
  - `docs/QINGYAN_WORKFORCE_PHASE2B_HANDOFF_PARALLEL_DESIGN.md`（下称"2B 设计"）：HandoffEnvelope、Proactive Reporting 事件表（§11）、worker registry、`aggregateJobResult` 读模型。
- 核心产品问题：用户必须随时知道——**青砚在做什么、完成多少、谁在做、为什么停了、是否需要我、失败会不会继续、花了多少资源、最终交付什么**。用户面只该看到 Running / Needs You / Completed / Failed，而不是 AgentRun JSON / logs / 状态码。

一句话结论：**观测性所需的事实源 100% 已存在**（AgentRunEvent 带 `visibleToUser` 列、run/step 状态词汇表、PendingAction、AiUsageLedger、traceId correlation），缺的是三层薄投影——**可见性矩阵校准（V2 事件默认全 true 是错的）、JobStatusProjection 读模型、NeedsYou 聚合**——全部零迁移可落地。`OBSERVABILITY_SCHEMA_CHANGE = NONE`。

---

## 1. 设计不变量（先立规矩）

1. **单一事件源**：所有 timeline（用户层 + 内部层）都从 `AgentRunEvent` 投影，**不建第二事件表、不维护两套 event store**。分层 = 同一序列上的 filter + projection。
2. **投影不写库**：JobStatusProjection / NeedsYouItem / Operator Home 全部是 read model（API contract），每次请求从五个现有模型（AgentRun / AgentRunStep / AgentRunVerification / AgentRunEvent / PendingAction）推导，不落任何"投影快照表"。
3. **Progress 确定性**：进度来自 DB 计数，**永远不让 LLM 报百分比**。
4. **UI allowed actions ≠ authorization**：NeedsYouItem 里的 actions 只是渲染提示；执行仍走服务端 PendingAction 执行时重授权（payloadHash + fail-closed + tool policy 现查，Phase 1.1 封板，见 `src/lib/pending-actions/executor.ts` L164–258，2B 设计 §9 已引用）。
5. **不暴露内部词汇**：模型名、runId 格式、错误码、lease、fence、attempts 等一律不出现在用户面文案；Admin/Operator 层可见。

---

## 2. Existing Signals Audit（现有信号审计）

### 2.1 事件层：AgentRunEvent

Schema（`prisma/schema.prisma` L4738–4752）：`runId + sequence`（`@@unique([runId, sequence])`，同 run 内严格有序）、`eventType`（String，自由词汇）、`title`、`payload Json`、**`visibleToUser Boolean @default(true)`**、`createdAt`；索引 `[orgId, runId]`。

**关键发现 1：可见性开关已存在，但默认值方向是错的。**

- `appendAgentRunEvent`（`src/lib/agent-runtime/run.ts`）与 V2 的 `emitRuntimeV2Event`（`src/lib/agent-runtime-v2/events.ts` L19：`visibleToUser: input.visibleToUser ?? true`）都默认 `true`；
- V2 executor 发出的 `step.started` / `tool.started` / `tool.completed` / `tool.failed`（executor.ts L281–294、L344、L432）**全部未传 visibleToUser → 全部落 true**——工具级内部细节今天默认对用户可见；
- 与之相反，**Phase 2A 的 job.* 事件已做了正确的显式区分**（这是本设计可直接沿用的先例）：

| 事件 | 写入点 | 当前 visibleToUser |
|---|---|---|
| `job.created` / `job.queued`（初次） | `workforce-runtime/job.ts` L151–166 | true |
| `job.claimed` | `processor.ts` L171–182 | **false** |
| `job.lease_renewed` | `processor.ts` L329–340 | **false** |
| `job.queued`（continuation / retry 回队） | `processor.ts` L119–126、L456–463 | **false** |
| `job.waiting_human` | `processor.ts` L204–213、L278–287、L417–429 | true |
| `job.resumed` | `agent-runtime-v2/process.ts` L441–451 | true |
| `job.completed` / `job.failed` | `processor.ts` L363–399、L519–527 | true |

**关键发现 2：事件 payload 已带 correlation。** 2A processor 的每条 job.* 事件 payload 都带 `correlation`（`runtimeContextToTelemetry(runtime)` 输出：orgId/actor/owner/jobId/rootRunId/traceId 等）——内部 timeline 与审计所需的关联字段无需补写。

### 2.2 全量事件写入点盘点（rg `agentRunEvent.create|appendAgentRunEvent`）

| 来源 | 事件（现有词汇） | 性质判定 |
|---|---|---|
| v1 conversation（`agent-runtime/run.ts`、`process.ts`、`context.ts`、`ack.ts`、`dispatch.ts`） | `run.started`、`ack.sent`、`context.loading/loaded`、`planning.started/completed`、`tool.started/completed`、`response.started/completed`、`run.completed/failed/cancelled`、`grader.started/completed`、`skill.started/completed` | 多数是内部执行细节；`run.completed/failed` 可转 user timeline |
| v1 background（`queue.ts`） | `background.queued/started/completed` | 内部（队列机制） |
| Runtime V2（executor/process/verifier 经 `events.ts`） | `plan.started/created`、`step.ready/started/completed`、`tool.started/completed/failed`、`approval.required/resolved`、`verification.started/passed/repair_required/needs_human`、`repair.started/completed`、`run.needs_human` | `plan.created`、`step.completed`（聚合后）、`approval.required/resolved`、`verification.passed`、`run.needs_human` 可转 user timeline；其余内部 |
| Supervisor（`agent-supervisor/persist.ts`、`run-worker.ts`） | `supervisor.plan_created/step_started/observation_created/replan_started/approval_rejected/resumed/completed/state/mode_selected/context_built` | 内部（supervisorState JSON 镜像）；`replan_started` 是 §14 的现成语义先例 |
| Workforce 2A（`workforce-runtime/job.ts`、`processor.ts`） | `job.created/queued/claimed/lease_renewed/resumed/waiting_human/completed/failed` | **user timeline 的主干**（可见性已校准，见 2.1） |
| Assistant（`assistant/dispatch.ts`、`reconcile-run.ts`、`retry-run.ts`） | `run.reconciled`、`run.retry_requested/retry_started`、场景事件 | retry 事件是 §13 的信号源 |

### 2.3 状态层

| 模型/字段 | 词汇表 | 观测价值 |
|---|---|---|
| `AgentRun.status`（v1，`agent-runtime/types.ts` L1–9） | queued / acknowledged / planning / running / awaiting_approval / completed / failed / cancelled | user status 映射输入 |
| `AgentRun.status`（v2，`agent-runtime-v2/schemas.ts` L75–87） | queued / planning / planned / executing / awaiting_approval / verifying / repairing / completed / partially_executed / needs_human / failed / cancelled | **workforce_job 的权威词汇表**（runtimeVersion="v2"） |
| `AgentRunStep.status`（schemas.ts L89–98） | pending / ready / running / awaiting_approval / completed / partially_executed / failed / blocked / skipped | Progress 计数与 currentTask 的事实源 |
| `AgentRunVerification` | verdict ∈ PASS / REPAIR / NEEDS_HUMAN / BLOCKED + summary + criteria + repairInstructions | "最终交付是否可信"的用户可见依据（`verificationLabel` 已被 `run-status.ts` L302–309 消费） |
| `PendingAction` | status ∈ pending / approved / rejected / executed / failed；`type/title/preview/approverUserId/requiredRole/expiresAt/agentRunId/resultRef/payloadHash` | **NeedsYouItem 的主要事实源**（title/preview 天然是人话） |
| `AgentRun.attempts / nextAttemptAt / leaseExpiresAt / errorCode / errorMessage` | — | retry 可见性（§13）与 failure 投影（§15）输入 |
| `AgentRun.metadata` | jobId / rootRunId / owner / initiatedByUserId / goal / threadId / channel（2A 落库实证，Case A/B/C） | JobStatusProjection 的身份字段 |

### 2.4 Correlation / 遥测 / 配额

- **traceId**：`AgentRun.traceId` 列 + `@@index([orgId, traceId])`；`AIRuntimeContext`（`src/lib/ai/runtime-context.ts` L45–80）含 actor/agent/owner/jobId/taskId/run 树/**业务实体（projectId/customerId/vendorId/tenderId/orderId）**/traceId；`runtimeFromRunMetadata`（2A）可从 DB 行还原。
- **`recordAiCall`**（`src/lib/ai/monitor.ts` L28–107）：接受 traceId/runId/rootRunId/jobId/taskId/agentId correlation，结构化日志 + 经 `bridgeMonitorAiCallToLedger` 写 **`AiUsageLedger`**（schema L6531–6575：runId/parentRunId/traceId/provider/model/tokens/`costAmount`/durationMs，索引 `[runId]`/`[traceId]`）——**Job 级成本聚合的现成事实源**（§16）。
- **配额**：`CapabilityQuotaReservation`（L6602–6622：metric/amount/status=RESERVED|COMMITTED|RELEASED/runId/traceId）+ `CapabilityQuotaPolicy` + `getGovernanceUsage`/`getQuotaCurrentUsage`（`capabilities/governance/usage-*.ts`）——Admin 层"预留 vs 实际"可直接投影。
- **鉴权拒绝**：executor 的 `canInvokeTool` 拒绝路径（executor.ts L232–259）把 step 标 failed + run 转 needs_human + 发 `run.needs_human` 事件；governance `audit.ts` 写 AuditLog（含 action 字段）。**没有独立的 `scope.denied` eventType**——安全拒绝今天以 needs_human + errorCode 呈现（§3 归类时补语义）。

### 2.5 现成投影先例（直接抄的模式）

| 先例 | 文件 | 对本设计的意义 |
|---|---|---|
| `AssistantRunStatusDto`（七态 DTO + `mapAgentRunToAssistantStatus` + visibleToUser 过滤 + currentStep 推导） | `src/lib/assistant/run-status.ts`、`run-status-types.ts` | **用户层 status 投影已被生产验证**——JobStatusProjection 是它的 Job 版泛化，不是新发明 |
| agent-trace 页（全事件 + visibleToUser=false 标记） | `src/app/(main)/agent-trace/page.tsx` | 内部 timeline 的现成消费者（Phase 3A-1 trace read model） |
| `aggregateJobResult` 读模型提案 | 2B 设计 §11 | Completed Job 的交付物摘要来源 |

### 2.6 审计结论

| 问题 | 答案 |
|---|---|
| 哪些已存在且可直接转 user timeline？ | `job.*` 全套（可见性已校准）、`plan.created`、`approval.required/resolved`、`verification.passed`、`run.needs_human`、`step.completed`（须聚合，见 §10） |
| 哪些只是内部 debug？ | `job.claimed/lease_renewed`、`step.started/ready`、`tool.*`、`context.*`、`background.*`、`supervisor.state/context_built/mode_selected`、`grader.*`、`response.delta` |
| 缺什么？ | ① V2 事件可见性默认全 true（泄漏内部细节）；② 无 `job.progress` / `job.replanned` / `job.retrying` 这三类用户语义事件的 writer；③ 用户面标题是工程话术（"Workforce Job 已认领"），缺文案层；④ needs_human（非审批）没有结构化 reason 载体（只有 errorMessage + 事件 payload） |

---

## 3. Internal vs User Event Model（事件四分类）

分类是**属性**不是新表：每个 eventType 在代码中静态归入一类（常量表 `EVENT_CLASS: Record<string, EventClass>`），投影时按类过滤。一个事件可以同时属于 USER_VISIBLE 与 AUDIT（审计始终保留全量）。

| 类别 | 定义 | 消费者 |
|---|---|---|
| `INTERNAL_EVENT` | 执行机制细节，用户不需要也看不懂 | 内部 timeline、debug、agent-trace |
| `USER_VISIBLE_EVENT` | 可直接或聚合后转译为人话的进展 | user timeline、proactive reporting |
| `AUDIT_EVENT` | 问责必需：谁在何时以何身份做了什么决定 | 合规导出、事后追查（全量事件天然都是审计层，本类标记"审计上必须永久保留"的子集） |
| `SECURITY_EVENT` | 鉴权拒绝、越权尝试、身份失效 | 安全审查 + Admin 告警；对用户折叠为"需要人工处理" |

逐一归类（现有事件全量）：

| 事件 | 分类 | 备注 |
|---|---|---|
| `job.created` | USER_VISIBLE + AUDIT | Job 起点 |
| `job.queued`（初次） | USER_VISIBLE | "已排队" |
| `job.queued`（continuation/retry，payload.retry/continuation=true） | INTERNAL | 同名事件按 payload 分流——2A 已用 visibleToUser=false 实现 |
| `job.claimed` | INTERNAL + AUDIT | worker 认领留痕 |
| `job.lease_renewed` | INTERNAL | 高频，见 §26 保留策略 |
| `job.resumed` | USER_VISIBLE + AUDIT | payload 含执行主体/审批人（2A Case H），审计必留 |
| `job.waiting_human` | USER_VISIBLE + AUDIT | NEEDS_YOU 触发器 |
| `job.completed` / `job.failed` | USER_VISIBLE + AUDIT | 终态 |
| `plan.started` | INTERNAL | |
| `plan.created` | USER_VISIBLE | "已定计划：N 步"（转译后） |
| `step.ready` / `step.started` | INTERNAL | |
| `step.completed` | USER_VISIBLE（**可聚合**） | 单条不推送；进度聚合规则见 §10 |
| `tool.started` / `tool.completed` | INTERNAL | 今天默认 true 是缺陷，须校准 |
| `tool.failed` | INTERNAL（首个）→ 触发 §13 retry 可见性规则 | |
| `approval.required` | USER_VISIBLE + AUDIT | NEEDS_YOU |
| `approval.resolved` / `approval.executed/rejected/failed/expired` | USER_VISIBLE + AUDIT | 决定留痕 |
| `verification.started` | INTERNAL | |
| `verification.passed` | USER_VISIBLE | "结果已核验" |
| `verification.repair_required` / `repair.started/completed` | INTERNAL（对用户折叠进 §14 replan 文案） | |
| `verification.needs_human` / `run.needs_human` | USER_VISIBLE + AUDIT | |
| `run.needs_human`（errorCode ∈ 鉴权/身份类：org_forbidden、pending_forbidden、principal 失效） | **SECURITY + AUDIT**（用户面折叠为 NEEDS_YOU"需要人工处理"） | 现状无独立 scope.denied 事件，以 errorCode 判别；未来 tool 鉴权拒绝建议补发 `security.tool_denied`（INTERNAL 命名空间，非新表） |
| `run.started/completed/failed/cancelled/reconciled` | v1 线：终态类 USER_VISIBLE，其余 INTERNAL | workforce_job 以 job.* 为准 |
| `run.retry_requested/retry_started` | INTERNAL + AUDIT | §13 输入 |
| `background.*`、`context.*`、`ack.sent`、`response.*`、`grader.*`、`skill.*` | INTERNAL | |
| `supervisor.*` | INTERNAL + AUDIT（`supervisor.replan_started` 语义并入 §14） | |
| 配额 hard-limit 熔断（governance quota-notify，urgent 通知已存在） | SECURITY/AUDIT + 触发 BLOCKED 用户事件 | 复用 Phase 3A-4 通知，不重建 |

**校准动作（实施期，2 处代码）**：`emitRuntimeV2Event` 默认改为按 `EVENT_CLASS` 查表决定 visibleToUser（未知类型 fail-closed 为 false）；存量事件不回填（读侧同样按表过滤，DB 里的历史 true 不产生影响——用户 timeline 以分类表为准，`visibleToUser` 列退化为写侧提示 + 兼容 v1 消费者）。

---

## 4. JobStatusProjection（read model / API contract，非新表）

```text
JobStatusProjection {
  jobId:            string          // AgentRun.id（= rootRunId = metadata.jobId，2A Case A 实证）
  title:            string          // metadata.goal（截断 ~80 字符）；planJson.objective 存在时优先（更规整）
  goal:             string          // metadata.goal 全文
  status:           UserJobStatus   // §5 映射函数 mapToUserJobStatus(run.status, pendingActions, steps)
  progress: {                       // §6
    completedTasks: number          // count(steps WHERE status ∈ {completed, skipped, partially_executed})
    totalTasks:     number          // count(steps)；planJson 未产出时为 null（显示"正在规划"）
    failedTasks:    number          // count(steps WHERE status = failed)
    display:        string          // "4/7"；规划前为 null
  }
  owner: {                          // Human Owner
    userId:         string          // metadata.owner.id（2A 落库）；兜底 metadata.initiatedByUserId
    displayName:    string          // JOIN User
  }
  currentTasks:     CurrentTask[]   // §7：running/awaiting_approval 步骤数组（未来并行天然容纳）
  currentWorker:    WorkerView[]    // §8：currentTasks 对应的 displayRole；2B 落 inputJson.worker 前恒为默认"青砚数字员工"
  startedAt:        string|null     // AgentRun.startedAt（2A §12 保证不被 claim 重置，即 Job 真实年龄）
  lastActivityAt:   string          // AgentRun.updatedAt（每次状态/租约写入都会推进；比 max(event.createdAt) 便宜且不需新索引）
  needsHuman:       boolean         // status ∈ {NEEDS_YOU}
  needsHumanReason: string|null     // 优先级：最新 open PendingAction.title → 最新 job.waiting_human 事件 title/payload.clarification → run.errorMessage（人话化，§15）
  retrying:         boolean         // §13：run.status=queued ∧ nextAttemptAt>now ∧ attempts>0 ∧ errorCode≠null
  latestMessage:    string|null     // 最新 USER_VISIBLE 事件的转译文案（§11 文案层输出）
  businessRefs:     BusinessRef[]   // §17
  traceId:          string|null     // AgentRun.traceId（Admin/debug 深链；普通用户 UI 不渲染）
}
```

字段来源全部是现有列/JSON 键，无一需要迁移。查询成本：单 Job 详情 = 1×AgentRun + 1×steps 聚合 + 1×PendingAction（`@@index([agentRunId, status])` 已有）+ 1×最新可见事件；列表页只取 AgentRun + steps 计数（可用 groupBy 一次算完一页的 progress）。

---

## 5. 用户层状态词汇（internal → user 完整映射）

用户面七值：`QUEUED / WORKING / NEEDS_YOU / COMPLETED / PARTIAL / FAILED / CANCELLED`。

| internal `AgentRun.status`（v2 词汇表 + v1 兼容） | user status | 用户文案基调 |
|---|---|---|
| `queued`（nextAttemptAt 为 null 或 ≤now，attempts=0） | QUEUED | "排队中，即将开始" |
| `queued`（attempts>0 ∧ errorCode≠null，= retry 回队） | WORKING（`retrying=true`） | "正在重试"（§13 阈值内则完全静默呈现 WORKING） |
| `queued`（continuation 回队，attempts=0 ∧ 有已完成步骤） | WORKING | slice 间隙对用户不可见——**continuation 不是"排队"** |
| `acknowledged`（v1） | QUEUED | |
| `planning` / `planned` | WORKING | "正在拆解任务" |
| `executing` / `running`（v1） | WORKING | "正在执行：{currentTask}" |
| `verifying` | WORKING | "正在核验结果" |
| `repairing` | WORKING | "正在修正" |
| `awaiting_approval` | **NEEDS_YOU** | "等你审批：{PendingAction.title}" |
| `needs_human` | **NEEDS_YOU** | "{needsHumanReason}" |
| `completed` | COMPLETED | |
| `partially_executed` | **PARTIAL** | "部分完成，未完成项：…"（§15） |
| `failed` | FAILED | |
| `cancelled` | CANCELLED | |

规则说明：

1. **QUEUED 只给"从未开始"的 Job**。continuation/retry 回队在 DB 里同为 `queued`，靠 `attempts + errorCode + 已完成步骤数` 三个现有字段区分——用户看到的是连续的 WORKING，不是反复横跳的"排队→运行→排队"。
2. 映射是纯函数 `mapToUserJobStatus(run, openPendingCount, stepAgg)`，与 `mapAgentRunToAssistantStatus`（run-status-types.ts）同模式，放 `src/lib/workforce-observability/`（实施期），供 API 与 badge 复用，**不落库**。
3. supervisor 的 `waiting_for_approval`、assistant DTO 的 `waiting_for_confirmation` 等历史表述不进入本映射——workforce_job 只走 v2 词汇表（审计报告 §9 结论），其他 runType 不在 Job Center 范围。

---

## 6. Progress 计算（deterministic）

**V1 公式**：`completedTasks = count(AgentRunStep WHERE status ∈ {completed, skipped, partially_executed})`，`totalTasks = count(AgentRunStep)`（= 当前 plan 的全部步骤，`persistPlanAndSteps` 一次性建齐）。显示 **"4/7 Tasks"**。

**为什么 "4/7" 优先于百分比**：

1. 百分比暗示均匀耗时——实际 step 耗时方差极大（读 CRM 3 秒 vs 分析步骤 60 秒），57% 是伪精确；
2. 任务计数是用户可核对的事实（点开能看到 7 项清单，第 5 项正在跑），百分比不可核对；
3. replan/动态加步骤时计数的分母变化是"可解释的"（见下），百分比回退是"不可解释的"。

**Replan 后避免 80%→35% 困惑**：

- 展示层永远显示 `X/Y Tasks`，replan 后 Y 变大 = "任务变多了"，配合 §14 的 `job.replanned` 用户事件（"根据初步结果调整了计划，新增 N 项"）——数字变化有叙事兜底；
- **completedTasks 单调不减**：replan 只新增/重置 failed 步骤（verifier REPAIR 语义），completed 步骤不重置（2A Case F 实证 completedAt 不变）——分子不会倒退，只有分母增长；
- 禁止在 replan 瞬间把进度条动画回退：客户端拿到的是 `{completed, total, replanned: true}`，如何渲染是 2D 的事，contract 层保证语义清晰。

**边界情况**：

| 情形 | 处理 |
|---|---|
| planning 阶段（无 steps） | progress = null，显示"正在拆解任务"，不显示 0/0 |
| weighted tasks | **V1 不做**。等权计数偏差在 5–8 步的 plan 里可接受；若未来实证需要，权重来自 planJson 静态声明（planner 产出），仍是确定性数据，不是 LLM 运行时报数 |
| approval wait | 不计入分子（awaiting_approval ∉ 完成集合）；进度条停在 N/M + status=NEEDS_YOU——"停着"正是正确信号 |
| verification | verifying 不加步骤数；用户看到 "7/7 + 正在核验结果"，核验通过才 COMPLETED——防止"100% 但还没完成"的错觉，verification 是完成的一部分而非额外任务 |
| 动态新增 task（repair 重置） | 重置 failed → ready 不改变计数（同一 step 行）；repair 新增步骤走 replan 语义（分母 +N + 事件解释） |
| skipped | 计入分子（黄金场景 `s8_gmail_drafts` 未执行但 Job 完成，2A §9）；PARTIAL 判定看 partially_executed/failed，不看 skipped |

---

## 7. Current Task

**Contract 是数组**（未来 2B 并行时多个 running task 天然容纳，API 不需 breaking change）：

```text
CurrentTask {
  taskId:    string        // AgentRunStep.stepKey（用户面稳定标识；DB id 不外泄）
  title:     string        // AgentRunStep.title（planner 产出，已是中文短语）
  status:    "running" | "awaiting_approval"
  worker:    WorkerView    // §8
  startedAt: string | null
}
```

**Selection 规则**（优先级从高到低，全部来自 `AgentRunStep.status`，`@@index([runId, status])` 已覆盖查询）：

1. `status = "running"` 的全部步骤（当前 parallelism=1 时至多 1 个；>1 时数组自然多元素）；
2. 无 running 时，`awaiting_approval` 的步骤（"卡在哪一步等你"比空数组有信息量）；
3. 都没有且 run 活跃（planning/verifying/repairing/queued-continuation）：数组为空，UI 显示 run 级阶段文案（"正在拆解任务"/"正在核验结果"）——**不伪造 currentTask**；
4. 排序：startedAt 升序（最早开始的排前）。

不选 `ready`（还没人做，"即将进行"可另列 nextTasks，V1 不做）；不选 `failed`（属于 §13/§15 的呈现域）。

---

## 8. Worker 可见性

**双层身份**：

| 层 | 字段 | 来源 | 示例 |
|---|---|---|---|
| internal `workerId` | `AgentRunStep.inputJson.worker.id`（2B 设计 §5 Option A） | worker registry key | `tender` |
| user `displayRole` | `WORKER_REGISTRY[id].displayName`（`agent-supervisor/worker-registry.ts` L33–76，**已存在**："销售数字员工/投标数字员工/营销数字员工/数据分析数字员工"） | registry 配置 | "投标数字员工"（产品文案可演进为"技术分析"等职能名，改 registry 一处即可） |

```text
WorkerView { workerId: string /* Admin 层才返回 */, displayRole: string }
```

规则：

1. **不暴露模型名**（GPT-5/Claude/Qwen）：模型是实现细节且随 ProviderRouter 回退动态变化，暴露 = 把供应商波动变成用户困惑 + 把青砚品牌降格为"模型转发器"。模型信息只存在于 AiUsageLedger（Admin 成本视图按 provider/model 聚合，§16）与内部 timeline。
2. 2B 落 `inputJson.worker` 之前（现状 v2 executor 无 worker 概念），`displayRole` 恒为 `"青砚数字员工"`——契约先行，字段有兜底值，UI 不用等 2B。
3. 普通用户 API 响应**不含 workerId**（防止内部枚举泄漏成产品语义）；Admin/Operator 详情返回双字段。

---

## 9. NeedsYouItem Contract（最重要）

```text
NeedsYouItem {
  id:            string             // 审批类 = PendingAction.id；非审批类 = "nh:{jobId}"（同一 needs_human 状态只产生一项）
  jobId:         string
  jobTitle:      string             // JobStatusProjection.title（列表页免二次查询）
  taskId:        string | null      // 审批类：经 AgentRunStep.pendingActionId 反查 stepKey；非审批类多为 run 级 → null
  type:          "APPROVAL"         // PendingAction pending（审批一个具体动作）
               | "QUESTION"         //  needs_human + clarification（planner 澄清，processor.ts L278–287 payload.clarification）
               | "AUTH"             //  needs_human + errorCode ∈ {org_forbidden, pending_forbidden, user_unbound}（身份/授权失效）
               | "REVIEW"           //  verification.needs_human（结果需要人过目）
               | "BLOCKED"          //  其他 needs_human（依赖死锁、repair 预算耗尽等）
  title:         string             // APPROVAL: PendingAction.title（已是人话）；其他：job.waiting_human 事件 title
  reason:        string             // APPROVAL: PendingAction.preview；QUESTION: clarification 全文；其他：人话化 errorMessage（§15 error projection）
  requestedAt:   string             // PendingAction.createdAt / 进入 needs_human 的事件时间
  urgency:       "high" | "normal"  // 派生：PendingAction.expiresAt - now < 4h → high；type=AUTH → high；其余 normal。不落库、不让 LLM 判
  expiresAt:     string | null      // PendingAction.expiresAt（过期即失效，approval-timeout cron 语义）
  businessImpact: {                 // 全部确定性派生，不写自由文本
    jobProgress:  string            // "4/7"
    blockedTasks: number            // 依赖此步骤的未完成下游数（dependsOnJson 反查）
    refs:         BusinessRef[]     // §17（"这单批不批影响哪个客户/项目"）
  }
  allowedActions: Action[]          // 渲染提示，见下
}

Action = "APPROVE" | "REJECT" | "ANSWER" | "AUTHENTICATE" | "REVIEW" | "RESOLVE_CONFLICT"
```

type → allowedActions 映射：`APPROVAL → [APPROVE, REJECT]`；`QUESTION → [ANSWER]`；`AUTH → [AUTHENTICATE]`；`REVIEW → [REVIEW]`；`BLOCKED → [RESOLVE_CONFLICT]`（V1 落地为"标记处理/取消 Job"，冲突细分随 2B resourceKey 演进）。

**安全边界（引用封板结论，不重建）**：`allowedActions` 是**纯 UI 渲染提示**，不是授权。用户点击 APPROVE 后，执行仍完整走服务端链路：审批权检查（approverUserId/requiredRole，Phase 3A-3 RBAC）→ `ApprovalDecisionIdempotency` 防重 → **PendingAction 执行时重授权**（payloadHash 校验 + tool policy 现查 + fail-closed，`src/lib/pending-actions/executor.ts` L164–258，Phase 1.1 封板；2B 设计 §9 同一引用）→ workforce_job 回 durable 队列以原发起人身份续跑（2A Case H）。前端拿到 allowedActions ≠ 服务端会放行；服务端拒绝时 API 返回标准 403/409，不产生第二套授权判断。

**QUESTION 的 ANSWER 通道现状**：V1 中 clarification 的回答通道 = 用户在原 thread 回复/编辑 goal 后重建 Job；"回答直接注入原 Job 并 requeue"是 2C（cron 唤醒 + resume 统一入口）之后的增量。contract 先定，避免 UI 返工。

---

## 10. Proactive Reporting（主动事件 + 抑制/聚合规则，只设计）

主动事件清单（全部由现有/微增事件驱动，投递面——thread 消息/微信推送——属 2D，本节只定"什么值得说 + 说的频率"）：

| 时刻 | 触发事件 | 现状 |
|---|---|---|
| Job Started | `job.created` | 已有 |
| Important Progress | `job.progress`（payload `{completed, total, milestone}`）| **微增 writer**：executor 在 step 终态持久化后顺手计数（2B 设计 §11 已列）；"important" 判定见聚合规则 |
| Needs You | `job.waiting_human` / `approval.required` | 已有 |
| Retrying after failure | `job.retrying`（payload `{reason, attempt}`）| **微增**：仅当越过用户可见阈值（§13）才发；静默重试不产生此事件 |
| Replanned | `job.replanned` | **微增**（§14） |
| Blocked | `job.waiting_human`（type=BLOCKED 语义）+ 配额熔断复用 quota-notify | 已有 |
| Completed | `job.completed`（payload 增聚合摘要，2B `aggregateJobResult`） | 已有，payload 增强 |

**Suppression / Aggregation 规则**（规则引擎是确定性代码，不是 LLM）：

1. **窗口聚合**：同一 Job 的 `step.completed` 在 10 秒窗口内 ≥2 条 → 聚合为一条 `job.progress`（"完成了 5 项资料读取，进度 5/7"）；窗口实现按"事件生成时机"节流（executor 只在 round 末尾发一条 progress），不需要延迟队列。
2. **里程碑门槛**：`job.progress` 只在跨越里程碑时对外推送——首个 step 完成、每 +25% 进度带、进入 verifying。中间粒度只进 timeline 不推送。
3. **NEEDS_YOU 永不抑制、永不聚合**（每一条都要人），但同一 PendingAction 的重复提醒受 escalation 间隔控制（复用 approval-timeout 的 expiresAt 语义，V1 不做多级提醒）。
4. **失败降噪**：`tool.failed` 不推送；只有越过 §13 阈值的 `job.retrying` 和终态 `job.failed` 推送。
5. **每 Job 推送预算**：单 Job 单日主动推送上限（建议 10 条，env 可调）；超限只保留 NEEDS_YOU + 终态——防止长 Job 变成骚扰源。
6. 同一用户多 Job 并发时的跨 Job digest（"3 个 Job 有进展"）：**2D 范围**，本轮只保证事件粒度支持按 owner 聚合（owner 已在 metadata + payload.correlation）。

---

## 11–12. 双层 Timeline（同源 AgentRunEvent，projection/filter 输出）

**同一事实源，两个投影，零第二存储**：

```text
GET timeline?view=user      → WHERE 按 EVENT_CLASS ∈ USER_VISIBLE 过滤 → 文案层转译 → 合并聚合
GET timeline?view=internal  → 全量事件（Admin/Operator 权限）→ 原始 eventType + payload
```

### 用户 timeline（人话）

条目 = `{ at, kind, text, refs? }`。文案层是**纯函数字典**：`renderUserEvent(eventType, payload, title) → string | null`（返回 null = 该条在聚合中被吞并）。示例输出（对应规格中 10:02–10:25 模式）：

```text
10:02  青砚开始处理「整理需要跟进的销售客户」        ← job.created
10:02  已拆解为 7 项任务                            ← plan.created
10:05  完成 3 项资料读取（进度 3/7）                 ← job.progress（聚合 3 条 step.completed）
10:11  正在分析优先顺序                              ← step.started 不可见；由 currentTask 轮询呈现，timeline 不逐条记录
10:14  需要你审批：给王总发送跟进邮件（等你处理）      ← approval.required
10:20  你已批准，继续执行                            ← approval.resolved + job.resumed
10:24  结果已核验通过                                ← verification.passed
10:25  完成：已整理 8 位客户的优先级与建议            ← job.completed（payload 摘要）
```

### 内部 timeline（Operator/Admin）

全量序列：claim / lease_renewed / retry 回队 / worker 指派（2B 事件）/ tool.started/completed/failed / approval.required + **执行时重授权结果**（pending-actions 执行留痕）/ verification 各态 / quota reservation（经 runId 关联 CapabilityQuotaReservation 侧查，不复制进事件）/ fencing 丢失（`lost_lease` 结果目前只在 processor 返回值——**建议实施期补一条 `job.lease_lost` INTERNAL 事件**，是内部 timeline 唯一缺口）。agent-trace 页已是该投影的消费者雏形。

**排序**：同 run 内 `sequence` 严格有序（`@@unique([runId, sequence])`）；未来跨 run（child run）合并用 `createdAt + runId` 二级排序，traceId 关联。

---

## 13. Retry 可见性

**两级阈值（确定性规则）**：

| 级别 | 条件 | 用户面表现 |
|---|---|---|
| **silent retry** | step 级：`attemptCount ≤ maxAttempts`（=2）内的首次重试；run 级：首次 retry 回队且 backoff ≤ 60s（RETRY_BACKOFF_MS 前两档） | **完全静默**：status 保持 WORKING，timeline 无条目（`job.queued(retry)` 本就 INTERNAL）。首次 502 用户永远不知道 |
| **user-visible retry** | 触发其一：① run attempts ≥ 2（连续两次 slice 失败）；② backoff 进入 ≥180s 档（明显影响完成时间）；③ 同一 step 的第二次重试且该 step 在关键路径上 | 发 `job.retrying`（USER_VISIBLE）：文案模式"正在重试{目标系统}连接，可能需要多几分钟"；status 仍是 WORKING + `retrying=true` 徽标，**不是 FAILED** |

信号源全部现有：`AgentRun.attempts / nextAttemptAt / errorCode`、`AgentRunStep.attemptCount`、backoff 档位（processor.ts RETRY_BACKOFF_MS）。"{目标系统}"来自 errorCode/preferredTool 的映射字典（如 gmail_* → "邮件服务"，供应商 API → "供应商系统"），不让 LLM 生成。attempts 耗尽 → §15 failure 投影接手（`job.failed` payload.exhausted=true 已存在）。

---

## 14. Replan 可见性

**`job.replanned` 事件（新 eventType 字符串，非新表）payload——原因必填**：

```text
{
  reason:        "verifier_repair" | "approval_rejected" | "assumption_invalid" | "tool_unavailable",
  reasonDetail:  string,            // 确定性来源：repairInstructions 首条 / 拒绝的 PendingAction.title / observer 结论——不是 LLM 自由发挥
  tasksBefore:   number,
  tasksAfter:    number,
  addedTaskKeys: string[],
  resetTaskKeys: string[],          // verifier REPAIR 重置的 failed steps
  planVersion:   number             // 递增计数，落 metadata.planVersion
}
```

Writer 挂接点（实施期）：v2 线 = verifier REPAIR 分支（verifier.ts 重置 failed steps 处）+ 2C 的 repairInstructions 消费点；supervisor 线已有 `supervisor.replan_started` 语义先例，收敛为同一 payload 形状。

**用户可见文案模式**（配合 §6 分母变化）：

- `verifier_repair` → "核验发现 {N} 项结果需要修正，已调整计划继续处理"
- `approval_rejected` → "你拒绝了「{title}」，青砚已调整方案绕开该步骤"
- `assumption_invalid` → "根据初步结果调整了计划，新增 {N} 项任务"
- `tool_unavailable` → "部分能力暂不可用，已改用替代方案"

---

## 15. Failure 投影

**四类失败（全部映射现有状态，不新增状态值）**：

| 投影类别 | internal 判定 | user status | 用户文案基调 |
|---|---|---|---|
| `TASK_FAILED_RECOVERABLE` | step failed ∧（attemptCount < maxAttempts ∨ repair 预算未耗尽） | WORKING（+§13 retry 徽标） | 不单独报；体现在 retrying/replanned |
| `TASK_FAILED_BLOCKING` | step failed ∧ 有未完成下游依赖 ∧ 重试/repair 预算耗尽 → run needs_human（executor DAG 死锁检测 / verifier NEEDS_HUMAN） | NEEDS_YOU | "「{task title}」多次尝试未成功，需要你决定：重试 / 跳过 / 取消" |
| `JOB_FAILED` | run failed（attempts 耗尽 / 不可恢复错误 / exhausted 收敛） | FAILED | "任务未能完成：{人话原因}。已完成的 {N} 项结果已保留" |
| `PARTIAL_COMPLETION` | run partially_executed（verifier 判定 failed steps 不在关键路径，2B 设计 §12 规则） | PARTIAL | "已完成 {N}/{M} 项，未完成：{清单}" |

**人类可读 error projection（字典，内部 errorCode 保留原样存 DB/内部 timeline）**：

| errorCode（`AgentErrorCode`） | 用户文案 |
|---|---|
| `external_timeout` | "外部系统响应超时" |
| `model_failed` / `model_parse_failed` | "AI 分析过程出错" |
| `tool_failed` | "执行「{tool 显示名}」时出错" |
| `org_forbidden` / `pending_forbidden` / `user_unbound` | "权限或账号状态发生变化，需要确认"（同时打 SECURITY 标） |
| `duplicate_message` / `db_error` / `unknown` | "系统内部问题"（+ traceId 供反馈引用） |

`errorMessage` 原文（常含堆栈/英文）**永不直出用户面**；用户面 = 字典文案 + 可选的安全摘要。Admin 层可见原文。

---

## 16. Cost / Usage 分层

| 受众 | 可见内容 | 数据源（全部现有，不建 billing） |
|---|---|---|
| 普通用户 | **不展示 token/成本**。只见 Duration（completedAt − startedAt；2A 保证 startedAt 是真实年龄） | AgentRun 列 |
| Admin / Owner | Estimated AI Cost：`SUM(AiUsageLedger.costAmount) WHERE runId ∈ run树`；Tool Calls：`count(step 终态)` + PendingAction 执行数；Duration + slices（`job.claimed` 计数）；预留 vs 实际：CapabilityQuotaReservation（runId 索引） | `AiUsageLedger`（`@@index([runId])`）、`CapabilityQuotaReservation`、AgentRunEvent |
| 平台 | 现有 governance usage-summary / quota dashboards，不动 | `getGovernanceUsage` 等 |

两个实施期注意点（不改 schema）：① Job 级成本聚合需按 run 树收集 runId 集合（`AiUsageLedger` 有 runId/parentRunId 但无 rootRunId 列）——V1 无 child run（2B §7 决策 Model A），`WHERE runId = jobId` 即全量，child run 启用后再按树查询；② 需验证 workforce 执行路径的每次 LLM 调用都把 runId 传进 `recordAiCall`（审计报告 §8 指出生产 correlation 不全，2A 已补 owner 链路，planner/verifier 调用点归因待实施期确认——列入 §27 gaps）。

---

## 17. businessRefs（Job 不做孤岛）

```text
BusinessRef { type: "project"|"customer"|"opportunity"|"tender"|"supplier"|"quote"|"order",
              id: string, label: string /* 显示名，投影时 JOIN */ }
```

来源优先级（全部现有载体）：

1. **AIRuntimeContext 业务实体字段**（runtime-context.ts L64–69：`projectId/customerId/vendorId(=supplier)/tenderId/orderId`，2A 已落 `AgentRun.metadata` 并可经 `runtimeFromRunMetadata` 还原）——Job 创建时声明的归属；
2. **PendingAction payload 的目标资源**（执行落点：opportunity/quote 等细粒度实体在审批动作 payload 与 `resultRef` 中）；
3. **2B 的 `resourceRefs`**（`inputJson.resources` / `outputJson.handoff.resourceRefs`，词汇表 `{entity}:{id}` 与本 contract 同构）——执行期触碰的实体，落地后自动并入。

投影规则：三源去重合并（type+id 唯一），label 批量 JOIN 各业务表；用户点击跳转对应详情页。V1 至少保证来源 1 可用（`createWorkforceJob` 已接受 projectId，workspaceId 同理）；opportunity/quote 级引用随 2B resourceRefs 落地自动增强，**contract 不变**。

---

## 18–19. Job Center / Operator Home 数据 projection 要求

### §18 Job Center 过滤与索引

| 视图 | 查询条件（全部现有列） | 索引评估 |
|---|---|---|
| Running | `runType='workforce_job' ∧ status ∈ {queued, planning, planned, executing, verifying, repairing, running}` | 走 `@@index([orgId, status])` 后过滤 runType。**`runType` 无索引**——MVP 量级（org 内活跃 run 数百）可接受；Job 量产后建议补 `@@index([orgId, runType, status, updatedAt])`（一次可加性迁移，非本轮） |
| Needs You | `status ∈ {awaiting_approval, needs_human}` 同上；条目级来自 PendingAction `@@index([orgId, status, createdAt])` + `[approverUserId, status, createdAt]`（**已有，READY**） | READY |
| Completed / Failed | `status ∈ {completed, partially_executed}` / `failed`，`ORDER BY completedAt DESC` | `[orgId, status]` 可用 |
| My Jobs | `metadata->>'ownerId' = :userId`（2A 落库） | **JSON 路径无索引**——V1 叠加 `sessionId → AgentSession.userId` JOIN（有 `[orgId, sessionId]`）近似；准确 owner 过滤量产后随 runType 索引一起评估（或 metadata GIN） |
| Project Jobs | `projectId`（metadata）→ 同上 JSON 限制；PendingAction 有 `[projectId, status, createdAt]` 可近似 needs-you-by-project | PARTIAL |
| Sales / Tender Jobs | V1 = 按 businessRefs 类型客户端过滤（页内）；服务端分类过滤依赖 2B resourceRefs 或 intent 约定 | PARTIAL |
| Recent | `ORDER BY updatedAt DESC LIMIT n` | READY |

### §19 Operator Home 前三类数据 contract

```text
OperatorHome {
  runningJobs:  JobStatusProjection[]   // §4 完整形状，含 currentTasks + progress
  needsYou:     NeedsYouItem[]          // §9，按 urgency DESC, requestedAt ASC
  recentlyCompleted: Array<{
    jobId, title, status: "COMPLETED"|"PARTIAL",
    completedAt, durationMs,
    deliverable: string,                // job.completed payload 摘要（2B aggregateJobResult）
    businessRefs: BusinessRef[]
  }>                                    // 最近 7 天，LIMIT 10
}
```

Suggested Next Actions 非本轮重点（依赖建议引擎，2D+）。三块可由 §24 的三个 API 组合，也可提供一个 `GET /api/workforce/home` 聚合端点减少往返（实施期决定，contract 同上）。

---

## 20–22. 三个 Golden Scenario

### §20 Scenario A — Sales（对照 2A §9 真实事件链）

Job："帮我检查最近需要跟进的销售客户，整理优先顺序和下一步建议。" 计划：3 read tasks（pipeline/opportunities/communications）→ synthesis（prioritize）→ 行动草稿（needs approval）→ resume → completed。

**Internal events（全量，2A 实证链 + 2B/本设计微增标注 △）**：

```text
job.created → job.queued → job.claimed → plan.started → plan.created
→ [round] job.lease_renewed → step.started(s1) → tool.started → tool.completed → step.completed(s1)
→ job.lease_renewed → step.started(s2) → … → step.completed(s2)
→ job.lease_renewed → step.started(s3) → … → step.completed(s3)  → △job.progress{3,7}
→ job.lease_renewed → step.started(s5_prioritize) → grader.* → step.completed(s5)
→ step.started(s6_drafts) → approval.required(×N) → job.waiting_human → [park, lease 清空]
→ [UserB 批准] approval.resolved → job.resumed{principal=UserA, approver=UserB} → job.queued(internal)
→ job.claimed → job.lease_renewed → step.completed(s6) → verification.started → verification.passed
→ job.completed{summary}
```

**User timeline（同源投影后）**：

```text
09:00 青砚开始处理「检查需要跟进的销售客户」
09:00 已拆解为 7 项任务
09:02 完成 3 项资料读取（进度 3/7）
09:04 已完成优先级分析（进度 4/7）
09:05 需要你审批：更新 2 位客户的跟进计划、创建 3 个日程（等你处理）
09:30 已批准，继续执行
09:31 结果已核验通过
09:31 完成：已整理 3 位客户的优先顺序与下一步建议
```

**Operator summary（列表卡片）**：`{ status: COMPLETED, progress: "7/7", duration: 31min, needsYou 历史: 1 次审批（UserB 处理）, deliverable: "3 位客户优先级 + 5 项行动建议", refs: [customer×3] }`。

### §21 Scenario B — Tender（用户体验描述）

7 任务计划（2B §14.2）。用户体验时序：

1. **4/7 Tasks**：A/B/C（读取）+ D（技术应答）完成后卡片显示 "4/7"，currentTask="报价方案"；
2. **Needs You**：E（modify_quote）触发审批 → status 翻 NEEDS_YOU，NeedsYouItem = `{type: APPROVAL, title: "调整投标报价", reason: preview, businessImpact: {jobProgress: "4/7", blockedTasks: 2(F,G), refs: [tender, quote]}}`；
3. **Replanned**：用户拒绝报价方案 → `job.replanned{reason: approval_rejected, tasksAfter: 8}` → 用户看到 "你拒绝了「调整投标报价」，青砚已调整方案" + 进度变 "4/8"（分母变化有解释，§6/§14）；
4. **Final verification**：8/8 后显示"正在核验结果"（不显示 100% 完成）；
5. **Complete**：`job.completed` → "完成：投标应答包已备好（合规检查通过，2 项标注需人工复核）"，refs 可点跳 Tender 详情。

### §22 Scenario C — Failure Recovery（lease reclaim）

内部事实（2A Case F 实证路径）：Worker A 执行中 crash → lease 过期 → cron 中 Worker B `claimRunLease` 成功 → `job.claimed`（第二条，INTERNAL）→ 从既有 step state 续跑（completed 步骤逐字节不动）→ 继续至完成。

**用户看到什么**：

- **完全 silent 的情况**（默认）：单次 crash-reclaim 且 `attempts < 2` 且恢复间隔 < backoff 一档（≤60s）——用户全程只见 WORKING，timeline 无任何条目。**crash 恢复是 runtime 的本职，不是用户的心智负担**；
- **可见的情况**：reclaim 伴随 attempts ≥ 2（说明连续失败非偶发）或恢复间隔 ≥ 180s——发 `job.retrying` 投影为一条："处理中遇到短暂问题，已自动恢复并继续"。status 全程 WORKING，**绝不闪 FAILED**；
- attempts 耗尽才落 FAILED（§15），文案明确"已完成的 N 项结果已保留"。

---

## 23. Event Contract（最小 user-facing 类别 → 现有事件映射）

**不建第二事件系统**：user-facing 类别是 `AgentRunEvent.eventType` 上的映射函数 `toUserEventCategory(eventType, payload) → Category | null`，null = 不进用户 timeline。

| Category | 映射的现有事件（△=微增 eventType 字符串，同表同 writer 管道） |
|---|---|
| `JOB_STARTED` | `job.created`（+`plan.created` 作为"已定计划"子条目） |
| `PROGRESS` | `step.completed`（聚合）/ △`job.progress` |
| `NEEDS_YOU` | `job.waiting_human`、`approval.required`、`verification.needs_human`、`run.needs_human` |
| `RESUMED` | `job.resumed`、`approval.resolved` |
| `REPLANNED` | △`job.replanned`（supervisor 线并轨 `supervisor.replan_started`） |
| `BLOCKED` | `job.waiting_human{type=BLOCKED}` + 配额熔断通知联动 |
| `COMPLETED` | `job.completed`（status=completed） |
| `PARTIAL` | `job.completed{status=partially_executed}`（同一 writer，payload 区分） |
| `FAILED` | `job.failed` |
| `CANCELLED` | `run.cancelled`（workforce 线建议补发 △`job.cancelled` 对齐命名，非必需） |

微增事件共 3 个必需（`job.progress` / `job.retrying` / `job.replanned`）+ 2 个建议（`job.cancelled` / `job.lease_lost`(INTERNAL)），全部是 String eventType 追加 + 既有 `appendAgentRunEvent` 管道，零 schema 变更。

---

## 24. API 设计（contract only，不实现）

鉴权前提：全部端点要求 org membership；`view=internal` / cost 字段要求 Admin/Owner；Job 可见范围 V1 = owner 本人 + org admin（与 PendingAction 审批范围一致）。

```text
GET /api/workforce/jobs?status=running|needs_you|completed|failed|all&scope=mine|org&projectId=&cursor=&limit=20
→ 200 {
    jobs: JobStatusProjectionLite[],   // §4 减去 currentTasks 详情与 businessRefs label JOIN（列表页轻量化：
                                       // jobId,title,status,progress.display,owner.displayName,lastActivityAt,
                                       // needsHuman,needsHumanReason,retrying,latestMessage）
    nextCursor: string | null
  }

GET /api/workforce/jobs/:id
→ 200 {
    job: JobStatusProjection,          // §4 全量
    tasks: Array<{ taskId, title, status, worker: WorkerView, startedAt, completedAt,
                   attemptCount /* Admin only */ }>,       // 全部 steps（Job 详情的任务清单）
    verification: { verdict, summary } | null,             // 最新 AgentRunVerification
    cost?: { estimatedAiCost, currency, toolCalls, durationMs, slices }   // Admin/Owner only（§16）
  }
→ 404（非本 org / 无权限，不区分二者）

GET /api/workforce/jobs/:id/timeline?view=user|internal&cursor=&limit=50
→ 200 {
    view: "user",
    entries: Array<{ at, category: UserEventCategory, text, refs?: BusinessRef[] }>   // §11 文案层输出
  }
| 200 {
    view: "internal",                  // Admin/Operator only；普通用户请求 internal → 403
    entries: Array<{ at, sequence, eventType, title, payload, visibleToUser }>
  }

GET /api/workforce/needs-you?scope=mine|org&cursor=&limit=20
→ 200 { items: NeedsYouItem[] /* §9，urgency DESC, requestedAt ASC */, nextCursor }
   // 聚合两源：PendingAction(pending ∧ agentRun.runType=workforce_job) ∪ AgentRun(needs_human)
   // 审批执行动作不在此 API——继续走既有 /api/approvals 决定端点（含幂等 + 重授权），本 API 只读
```

---

## 25. Schema 决定

```text
OBSERVABILITY_SCHEMA_CHANGE = NONE
```

逐项论证（五模型投影覆盖全部需求）：

| 需求 | 承载 | 为什么不需要迁移 |
|---|---|---|
| 事件分层 | `visibleToUser` 列已存在 + 代码侧 EVENT_CLASS 常量表 | 分类是静态属性，落库=双写漂移 |
| 3 个新事件 | eventType 是 String | 追加词汇 = 代码改动 |
| JobStatusProjection / NeedsYou / OperatorHome | 每请求推导 | 无投影快照表；量级（org 内活跃 Job 数十）无需物化 |
| progress | steps 计数 | `[runId, status]` 索引已有 |
| retry/replan 可见性 | attempts/nextAttemptAt/errorCode/attemptCount + planVersion 入 metadata | 全部现有列/JSON |
| cost | AiUsageLedger + QuotaReservation | 已有 runId 索引 |
| 文案层 | 纯函数字典 | — |

已识别但**明确推迟**的可加性索引（触发条件 = Job 量产后的实测慢查询，非本轮）：`AgentRun @@index([orgId, runType, status, updatedAt])`；owner 精确过滤的 metadata GIN 或 ownerId 列。记录在案，不作为 2D 前置。

---

## 26. Retention / 事件量

| 事件类 | 量级估算（单 Job） | 策略 |
|---|---|---|
| `job.lease_renewed` | 每 round 一条：长 Job 数十至上百条（最大噪音源） | **仅 INTERNAL**；保留 30 天后可物理清理（或压缩为每 slice 首尾两条——实施期二选一，倾向"写侧降频：每 slice 只记首次续租 + payload.rounds 计数"，改一处 processor 代码） |
| `job.claimed` / `job.queued(continuation)` | 每 slice 各一条：十数条 | INTERNAL，保留 90 天（crash 归因需要） |
| `tool.* / step.started / context.*` | 每 step 2–4 条 | INTERNAL，保留 90 天 |
| `job.created/resumed/waiting_human/completed/failed`、`approval.*`、`verification.*`、`job.replanned` | 个位数条 | **AUDIT 级，永久保留**（问责链） |
| `step.completed` | = task 数 | 永久（进度重建依据） |

原则：Phase 2D 前**不做复杂日志基础设施**（无 ClickHouse/OpenSearch/事件总线）；清理 = 一个 cron 的 `deleteMany(eventType IN … AND createdAt < …)`，且仅在事件表体积成为实测问题后启用。AgentRunEvent 随 run cascade 删除的现有语义不变。

---

## 27. Operator UX 数据就绪度（若 Phase 2D 开始做 UI）

```text
OPERATOR_DATA_READINESS = PARTIAL
```

| 视图 | 就绪 | 缺口（全部 backend，按依赖排序） |
|---|---|---|
| **Running** | 状态/steps/事件全有；QUEUED-vs-continuation 判别字段齐 | ① 无 `/api/workforce/jobs` 读 API 与 `mapToUserJobStatus` 投影函数；② `job.progress` writer 缺（否则列表页每 Job 现算 steps 聚合——可接受但费查询）；③ 用户面文案层（renderUserEvent 字典）不存在——现有 title 是工程话术 |
| **Needs You** | 审批类：PendingAction 字段/索引 READY | ④ 非审批 needs_human 缺结构化 reason（散在 errorMessage/事件 payload，需 §9 投影函数收敛）；NeedsYou 聚合 API 缺 |
| **Completed** | 终态/verification/duration READY | ⑤ deliverable 摘要依赖 2B `aggregateJobResult`（buildFinalReport 硬编码 s5_prioritize，非黄金计划报告残缺——2B 设计 §11 已立项）；cost 归因需验证 recordAiCall 的 runId 全覆盖 |

---

## Risk Register

| 风险 | 证据 | 对策 |
|---|---|---|
| 内部细节泄漏进用户面 | `emitRuntimeV2Event` 默认 visibleToUser=true（events.ts L19），tool.* 全可见 | EVENT_CLASS 表 + 读侧按表过滤（不信任存量列值）；未知 eventType fail-closed 为 INTERNAL |
| 状态闪烁（WORKING↔QUEUED / 闪 FAILED） | continuation/retry 回队与初始 queued 同状态值 | §5 三字段判别规则；retry 阈值内不改 user status |
| replan 后进度倒退困惑 | verifier REPAIR 重置 failed steps；replan 加步骤 | 分子单调不减 + 计数展示 + job.replanned 叙事（§6/§14） |
| NeedsYou 的 allowedActions 被误当授权 | UI 提示与服务端检查是两层 | Contract 文档级声明 + 执行端点不消费 allowedActions（§9，引用 Phase 1.1 封板） |
| 事件表膨胀 | lease_renewed 每 round 一条 | §26 写侧降频 + INTERNAL 保留期；2D 前不建日志设施 |
| 投影查询放大（列表页 N+1） | progress/needsYou 逐 Job 算 | 列表页 groupBy 批量聚合 + Lite 投影；量产后按 §25 补索引 |
| 跨用户信息泄漏 | Job Center 是新读面 | 复用 run-status.ts 的 owner 校验模式（initiatedByUserId + session 双验）；needs-you 按审批范围过滤（approverUserId/requiredRole） |
| 文案幻觉 | latestMessage/reason 若走 LLM 会不可控 | 全部文案来自确定性字典 + payload 插值；LLM 只出现在既有 report/summary 生成处（其输出标记为"AI 摘要"） |
| 双 driver 事件乱序 | user resume 与 cron 并发 | sequence 唯一约束已保证同 run 有序；投影按 sequence 排序，与 2A fencing 正交 |

---

## Implementation Slices（不在本轮实施，供排期）

| 片 | 内容 | 依赖 | 验收 |
|---|---|---|---|
| **OBS-1 事件分类与可见性校准** | EVENT_CLASS 常量表 + `emitRuntimeV2Event` 默认值查表 + 3 个微增事件 writer（progress/retrying/replanned）+ lease_renewed 写侧降频 | 2A 封板 | 黄金场景重跑：user 过滤后事件序列 == §20 预期；tool.* 不再进用户集 |
| **OBS-2 投影函数库** | `src/lib/workforce-observability/`：mapToUserJobStatus / buildJobStatusProjection / buildNeedsYouItems / renderUserEvent 字典 / error projection 字典（全部纯函数 + 契约测试） | OBS-1 | §5 映射表全覆盖测试；needs_human 四型 reason 正确 |
| **OBS-3 四个读 API** | §24 contract 落地（jobs / jobs/:id / timeline / needs-you）+ 权限（owner/admin/internal view） | OBS-2 | 越权 403/404；分页；Scenario A/B/C 三脚本对照输出 |
| **OBS-4 Cost 归因验证 + Admin 字段** | 验证 workforce 路径 recordAiCall 的 runId 覆盖；jobs/:id 的 cost 块 | OBS-3、2B-4 | 黄金场景 ledger SUM 与 slice 数对得上 |
| **OBS-5 Proactive 推送接线** | §10 规则引擎接现有通知面（thread/微信） | 2D 启动 | 抑制/聚合规则契约测试 |

OBS-1/2 可与 2B 并行；OBS-3 是 2D UI 的硬前置；OBS-5 属 2D。

---

*本文档为只读设计产物：未实现 UI/dashboard/notification，未修改 Prisma schema，未建新 Event 表，未改 Runtime V2 执行内核。等待评审后按 Implementation Slices 排期。*
