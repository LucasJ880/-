# Qingyan Workforce Runtime Phase 2 — Architecture Audit Report

- 日期：2026-08-09
- 分支：`feature/workforce-runtime-phase2`（基线 = 最新 verified main `ad71535`，含 Runtime Phase 1/1.1 + Governance Hygiene Gate）
- 性质：**READ-ONLY 架构审计**。本轮未实现任何 Workforce 功能、未修改 Prisma、未新增 UI。
- 核心问题：**现有 Agent Runtime 2.0 到底已经完成了多少 Workforce Runtime？**

一句话结论：**大约 60–70% 的 Workforce 骨架已经存在**（durable job 壳、步骤 DAG、审批暂停/恢复、验证循环、租约/重试模式、运行时上下文契约），但它们分散在 **三条并行执行栈 + 五套 durable-job 模式** 中，且 **Owner/Job 语义在生产路径上没有接线**。Phase 2 的第一刀是"统一与接线"，不是"新建"。

---

## 1. Existing Architecture Map（真实文件路径）

当前不是单一执行链，而是三条并行 ACTIVE 路径（由 Feature Flag / 意图路由分流）：

```text
User
 │
 ├── Web AiThread ──► src/app/api/ai/threads/[threadId]/messages/route.ts
 │        │
 │        ├─► prepareAssistantDispatch  src/lib/assistant/dispatch.ts
 │        │      ├─ [灰度] shouldRouteToRuntimeV2 ──► Path B（Runtime V2）
 │        │      ├─ [场景] daily_brief / followup / gmail_draft
 │        │      └─ general ──► Path A（Qingyan Operator）
 │        │
 │        ├─ Path A：buildOperatorSystemPrompt
 │        │      src/lib/agent-core/prompts/operator-system.ts
 │        │      → runAgentStream(agent="qingyan-operator")
 │        │      src/lib/agent-core/engine.ts
 │        │      → tool-registry → approval-gate → PendingAction
 │        │
 │        └─ Path B：startAgentRuntimeV2Run
 │               src/lib/agent-runtime-v2/process.ts
 │               → createAgentRun(runType="runtime_v2")  src/lib/agent-runtime/run.ts
 │               → planner（写 planJson）  src/lib/agent-runtime-v2/planner.ts
 │               → persistPlanAndSteps（AgentRunStep DAG）  src/lib/agent-runtime-v2/persist.ts
 │               → executor（round loop）  src/lib/agent-runtime-v2/executor.ts
 │               → verifier（AgentRunVerification）  src/lib/agent-runtime-v2/verifier.ts
 │               → 审批 → resumeRuntimeV2AfterApproval  src/lib/approval/port.ts
 │
 └── WeChat/WeCom ──► src/lib/messaging/gateway.ts
          │
          → createAgentRun(runType="conversation") → executeConversationRun
            src/lib/agent-runtime/process.ts
          ├─ [Flag] Supervisor ──► Path C：runSupervisor
          │      src/lib/agent-supervisor/engine.ts（runPlanLoop 闭环）
          │      → executeWorkerStep → runSkill  src/lib/agent-core/skills/runtime.ts
          │      → runAgent（actor=AGENT, agent=skill.slug）
          │      → 审批 → resumeSupervisorAfterApproval  src/lib/approval/port.ts
          ├─ [复杂任务] enqueueBackgroundAgentRun ──► lease claim
          │      src/lib/agent-runtime/queue.ts + src/app/api/cron/agent-runs/route.ts
          └─ fallback：runAgent(agent="qingyan-runtime")

共享底座（全部路径复用）：
  AgentRun / AgentRunStep / AgentRunEvent / AgentRunVerification（prisma/schema.prisma L4631–4735）
  Tool Runtime + scopeGuard      src/lib/agent-core/tool-registry.ts
  Approval Gate + PendingAction  src/lib/agent-core/approval-gate.ts, src/lib/pending-actions/*
  AIRuntimeContext（Phase 1.1）  src/lib/ai/runtime-context.ts
  配额治理                        src/lib/capabilities/governance/*
```

另有独立老链 Path D（项目会话）：`src/lib/agent-core/conversation/adapter.ts`，按 DB `Conversation.agentId` 跑 `runAgent`，与上述分轨。

---

## 2. Existing Assets（逐项评级）

| 资产 | 评级 | 依据（文件路径） |
|---|---|---|
| **AgentRun** | **READY（作为 durable job 壳）** | 已有 `status/runType/traceId/parentRunId/metadata/supervisorState/planJson/runtimeVersion/attempts/leaseExpiresAt/nextAttemptAt`（schema L4631–4678）；同时承载 conversation、background、assistant_dispatch、runtime_v2 四种 runType |
| **AgentRunStep** | **READY（步骤骨架）/ PARTIAL（细节）** | DAG `dependsOnJson` 真实 enforcement（`persist.ts` dependenciesSatisfied）；`attemptCount/maxAttempts` 生效；`@@unique([orgId, idempotencyKey])` 存在但**执行前不查重**（`executor.ts` 只写不读）；无 worker 身份列 |
| **AgentRunVerification** | **PARTIAL** | verifier 写入 verdict/criteria/evidence/repairInstructions（`verifier.ts` L225–237）；repair loop 存在但**硬编码重置 failed steps，不消费 repairInstructions 文本** |
| **AgentTask**（main 上的版本） | **LEGACY** | 旧投标包线性 flow（`src/lib/agent-core/skills/flow-runner.ts` + `ApprovalRequest`）；与 AgentRunStep 概念重复、表不共享；**main 上无 lease/cancelRequestedAt 列**（那些在未合并的 orchestrator 工作分支上，见 §7 附注） |
| **supervisorState** | **PARTIAL** | Supervisor 闭环完整（plan→dispatch→observe→replan→approve，`engine.ts` runPlanLoop）；但状态在 JSON blob，不落 AgentRunStep；Web 主聊天默认不走 |
| **planJson** | **PARTIAL** | 仅 Runtime V2 写（`persistPlanAndSteps`）；Supervisor/v1 各有自己的 plan 载体（三套并存） |
| **lease（run 级）** | **PARTIAL** | v1 background：CAS claim + 3min lease + backoff `[15s,60s,180s]` + cron（`queue.ts` L80–338）；**v2 无 lease/claim/cron 续跑**；全栈**无 heartbeat/续租**（TenderAnalysisRun 有 renewLease 模式可抄） |
| **retry** | **PARTIAL** | run 级 attempts≤3 + backoff；step 级 maxAttempts=2；但 v1 background 重试**整段重跑**（副作用风险）；写副作用幂等靠 PendingAction 层 |
| **resume** | **PARTIAL** | 审批 resume：V2 + Supervisor 有真实闭环；**超时/崩溃后的自动续跑只覆盖 v1 background**；v2 停摆的 `executing` run 无人认领 |
| **PendingAction** | **READY（审批总线）/ NOT_USED（作为 job 续跑原语）** | payloadHash + 执行时重授权 + fail-closed（Phase 1.1 封板成果）；但经典助手路径审批后只收敛终态，不续跑后续步骤 |
| **child run（parentRunId/rootRunId）** | **PARTIAL** | schema + `deriveChildRunContext` + rootRunId 推导 READY（Gate A E2E 验证过）；**生产无任何子 Run 派生调用**；Supervisor worker 共用父 runId，不建 child run |
| **runtime context（Phase 1.1）** | **READY（契约）/ PARTIAL（接线）** | `AIRuntimeContext` 含 actor/agent/owner/jobId/taskId/run 树/实体/trace（`runtime-context.ts`）；投影 helper 齐全；**生产 createAgentRun 调用方无一传 runtime**，owner 仅 skill 路径设置且不落库 |

---

## 3. Job Model Decision

```text
Do we need a new WorkforceJob table?  →  NOT YET
```

理由：

1. `AgentRun` 已经具备 Job 生命周期所需的全部列：status、attempts、lease、nextAttemptAt、planJson、metadata（可承载 jobId/owner）、steps、events、verifications。V2 实践中"一个 run = 一个可暂停/恢复的 durable graph"已经成立。
2. Phase 1.1 契约在 `AIRuntimeContext` 与 `AgentRun.metadata` 中**预留了 `jobId`/`taskId`/`owner`**，尚未有任何生产 writer——先把预留字段用起来，比开新表成本低一个数量级。
3. 最小映射：**Job = root AgentRun（新增 runType="workforce_job"，字符串列无需迁移）**，`jobId = rootRunId`。子任务/子执行用 `parentRunId` 挂到同一棵 run 树上（Gate A 已验证 root 推导正确）。
4. 什么时候才需要独立 Job 表：当出现「一个 Job 跨越多个独立 run 树」「Job 级别的用户可见清单/预算/SLA 需要独立索引」时再建。现在建表会造成第六套 job 状态机。

---

## 4. Task Model Decision

```text
Should AgentRunStep become Workforce Task?  →  YES（需三处适配，无需新表）
```

`AgentRunStep` 已经是事实上的 Task：stepKey/title/status/dependsOnJson（真实 DAG）/preferredTool/executionMode/riskLevel/requiresApproval/attemptCount/maxAttempts/inputJson/outputJson/evidenceJson/pendingActionId/idempotencyKey。缺的是：

1. **Worker 身份**：无 `workerId/agentId` 列。Supervisor 的 worker 分配只活在 `supervisorState` JSON。最小做法：先写入 `inputJson.worker` 或 metadata（零迁移），验证后再考虑加列。
2. **幂等短路**：`idempotencyKey` 有唯一约束但执行前不 `findFirst` 查重（`executor.ts` 只写）。真正的防重放在 PendingAction 层——Task 化后读工具也需要短路。
3. **统一等待语义**：step 有 `awaiting_approval/blocked`，但无「等待人的非审批输入」状态（needs_human 只在 run 级）。

```text
What should happen to AgentTask?  →  冻结为 LEGACY，禁止扩展，分阶段迁出
```

- main 上的 `AgentTask` 只服务旧投标包 flow（`flow-runner.ts`、`api/agent/tasks/*`、`components/agent-tasks/*`），与 Runtime V2 明确不混用（`assistant-task-card.tsx` 注释）。
- **禁止创建第三个 Task 模型**。Workforce Task = AgentRunStep；AgentTask 保持现状直到投标包 flow 迁移到 V2 图（不属于 Phase 2 范围）。
- 附注：未合并的 orchestrator 工作分支给 AgentTask 加了 lease/cancelRequestedAt 等列——**那是另一条产品线的私有演进，不在 main 基线上**，Phase 2 不依赖它，但其 `cancelRequestedAt` + 执行安全点模式值得抄进 AgentRun。

---

## 5. Durable Execution

### 现状路径

```text
Current durable execution path（仅 v1 background_conversation）:
  enqueueBackgroundAgentRun → cron /api/cron/agent-runs → claimAgentRun(CAS updateMany)
  → executeConversationRun（整段执行）→ 失败回 queued + backoff

Lease model:   status∈{queued,running} + leaseExpiresAt(3min) + attempts++ 的原子 updateMany；
               无 heartbeat/续租 → 超过 3 分钟的执行可被二次认领（重复执行窗口）
Retry model:   run 级 MAX_ATTEMPTS=3 + backoff[15s,60s,180s]；step 级 maxAttempts=2 回 ready
Resume model:  v1=整段重跑（非断点续）；v2=轮次持久化但无人认领 stuck run；
               审批 resume 是唯一真正的"断点续跑"
Failure model: lease 过期+attempts 耗尽 → failed；v2 超时仅靠 startedAt+timeoutMs 标 failed
Idempotency:   AgentRunStep.idempotencyKey 唯一约束（写不读）；
               PendingAction.idempotencyKey + ApprovalDecisionIdempotency（真正生效层）
```

### 真实 Gaps

| Gap | 影响 |
|---|---|
| v2 / workforce run 无 lease+cron 认领 | Vercel 超时后 `executing` run 永久停摆 |
| 无 heartbeat / lease renew | 长执行被二次认领 → 重复副作用 |
| v1 重试整段重跑 | 非幂等工具重复执行风险 |
| step 幂等只写不读 | 重放防护依赖 PendingAction，读工具无保护 |
| repair loop 不消费 repairInstructions | 验证循环退化为"盲目重跑 failed steps" |

### 可直接借用的最佳存量模式（来自五套 durable-job 对比）

| 维度 | 最佳实现 | 文件 |
|---|---|---|
| Lease + 分段 checkpoint + 续租 | **TenderAnalysisRun**（workerStep 游标 + TIME_BUDGET + renewLease + Project 行 FOR UPDATE 入队） | `src/lib/tender-auto-analysis/worker.ts`, `enqueue-package.ts` |
| 标准 claim 模板 | AgentRun.queue / MarketResearchRun（同构 CAS claim） | `src/lib/agent-runtime/queue.ts`, `src/lib/market-intelligence/research-runtime.ts` |
| 状态流转审计 | **PublishJobStatusEvent**（from/to/actor 事件表） | `src/lib/operations/publish-events.ts` |
| 外部执行 + 回调幂等 | MarketingWorkflowRun（requestId 唯一 + 签名 webhook + eventId 去重） | `src/lib/marketing/workflows.ts` |
| 审批决定幂等 | ApprovalDecisionIdempotency 表 | schema |

---

## 6. Human Intervention

```text
Can a Job pause on PendingAction and resume same Task safely?  →  PARTIAL
```

| 路径 | 审批后同 run/step 续跑 | 证据 |
|---|---|---|
| Runtime V2 | **YES** | step `awaiting_approval` + `pendingActionId` → `resumeRuntimeV2AfterApproval` → reconcile step 终态 → `processAgentRuntimeV2Run` 续跑后续 ready steps（`approval/port.ts` L272–305, `agent-runtime-v2/process.ts` L237–419；golden-flow 契约测试覆盖） |
| Supervisor | **YES** | `waiting_for_approval` → `resumeSupervisorAfterApproval` → runPlanLoop 继续 |
| 经典助手 / scenario | **NO** | `reconcileAssistantRunFromPendingActions` 只把 run 收敛为 completed/awaiting，**不调度后续步骤**（`src/lib/assistant/reconcile-run.ts`） |

必须记录的三个缺口：

1. **无 cron 唤醒**：`/api/cron/agent-runs` 不处理 `awaiting_approval`；`/api/cron/approval-timeout` 只把过期 PendingAction 标 failed，**不 reconcile 关联 run** → 过期后 run/step 可能永久停在 awaiting。
2. **语义竞态**：`approveApprovalItem` 先跑 assistant-reconcile（可能标 completed）再跑 V2 resume（改回 executing）——靠执行顺序覆盖，偏脆。
3. **无统一 `WAITING_FOR_HUMAN`**：现存 `awaiting_approval` / `waiting_for_confirmation` / `needs_human` / `waiting_for_approval` 四种表述分散在 run/DTO/step/supervisorState。

审批安全本身（payloadHash、执行时重授权、fail-closed policy load、disabledTools 双命名空间）已在 Phase 1.1 封板，Workforce 直接复用，不重建。

---

## 7. Structured Handoff

```text
Existing:  PARTIAL
```

- **最接近的存量**：V2 adapters 的 `outputJson`/`evidenceJson` + `priorEvidence` —— 同一 run 内后续步骤显式消费前序 stepKey 的结构化输出（如 `s2_opportunities` → `s5_prioritize`）。这是**工具步骤接力**，不是多 worker 协议。
- Supervisor 有 artifacts/resultSummary 聚合，但下一个 worker **不会**自动吃到上一步的结构化 parsed JSON。
- 通用「Worker A → structured result → Supervisor → Worker B」协议：**MISSING**。
- `projects/handoff/*` 是业务项目交接，与此无关。

### 最小 Handoff Contract 提案（本轮不实现）

```text
HandoffPayload（承载于 AgentRunStep.outputJson，零迁移）:
  from:        { stepKey, worker }        // 谁产出
  to:          { stepKey?, worker? }      // 给谁（可由 planner 回填）
  jobId:       rootRunId
  taskId:      stepKey
  objective:   string                     // 下一步要达成什么
  inputs:      Record<string, unknown>    // 结构化输入（schema 由 worker 声明）
  outputs:     Record<string, unknown>    // 本步结构化产物
  evidence:    { refs: string[] }         // 引用 evidenceJson / 资源 ID
  constraints: { budget?, deadline?, riskCeiling? }
  status:      "ok" | "partial" | "blocked"
```

约束：Handoff 只是**数据契约**，路由/授权仍走 Supervisor/planner + scopeGuard + approval gate，不新建通信总线。

---

## 8. Owner Model

Phase 1.1 已定义三元组（`src/lib/ai/runtime-context.ts`），Workforce 映射如下：

| Workforce 概念 | Phase 1.1 字段 | 语义 |
|---|---|---|
| **Human Owner**（把工作交给青砚的人） | `owner: { type: "USER", id }` | Job 的问责人；审批路由、完成汇报的接收者；跨整棵 run 树不变 |
| **AI Job Owner**（青砚侧负责该 Job 的编排身份） | `agent: { id: "qingyan-operator" \| supervisor }`（root run 上） | 对 Job 负责的编排 agent；未来允许 `owner.type="AGENT"` 表达 agent-owned 子 job |
| **Worker**（实际执行的数字员工/skill） | `actor: { type: "AGENT", id: skill.slug }` + `agent: { id: worker }`（child run / step 上） | 每个 Task 的执行身份；on-behalf-of 语义已在 skill 路径存在 |

审计发现的接线缺口（全部是接线，不是契约缺陷）：

1. 生产入口除 skill 路径外**都不设置 owner**；
2. 生产 `createAgentRun` 调用方（gateway/dispatch/v2/supervisor）**无一传 `runtime:`** → owner/jobId/taskId 不落 `AgentRun.metadata`；
3. resume 时上下文是**重建**而非从 metadata 还原（只恢复 rootRunId/traceId/parentRunId），缺 `runtimeFromRunMetadata` 反序列化 helper；
4. `recordAiCall` / `writeAuditLog` 的 correlation 字段**不含 ownerType/ownerId**（approval-gate 的 runtimeCorrelation 反而最全）。

**决策：Job Owner 用 runtime owner 字段 + AgentRun.metadata 持久化，不建独立 Job 字段/表**（与 §3 一致）。

---

## 9. State Machine Proposal

逻辑 Job 状态 → 现有 AgentRun 状态映射（**全部映射到既有字符串值，不改 DB enum/string**）：

| Logical Job State | 现有 AgentRun status（v2 词汇表 `agent-runtime-v2/schemas.ts` L75–87） | 备注 |
|---|---|---|
| CREATED | `queued` | 已有 |
| PLANNING | `planning` / `planned` | 已有 |
| RUNNING | `executing`（v2）/ `running`（v1） | 已有 |
| WAITING_FOR_TOOL | `executing` + step `running` | 不需要独立 run 级状态 |
| WAITING_FOR_WORKER | `queued`（待 claim）或 `executing` + step `ready` | 由 lease/claim 表达，不加新状态 |
| WAITING_FOR_HUMAN | `awaiting_approval`（审批）/ `needs_human`（非审批输入） | **两个值都已存在**；需要的是统一使用规范而非新值 |
| BLOCKED | run `needs_human` + step `blocked` | step 级已有 `blocked` |
| COMPLETED | `completed` / `partially_executed` | 已有 |
| FAILED | `failed` | 已有 |
| CANCELLED | `cancelled` | 已有 |

结论：**v2 状态词汇表已覆盖全部逻辑 Job 状态，Phase 2 不需要任何 DB 状态值变更**；需要的是把 v1/assistant DTO/supervisor 的四种"等待人"表述收敛到 `awaiting_approval`/`needs_human` 两个规范值。

---

## 10. Minimal Phase 2 V1

目标闭环：用户 → "这个工作交给青砚" → Job → Owner → Tasks → Worker execution → Structured Handoff → Checkpoint → Needs Human / Resume → Completed → 青砚汇报结果。

| 环节 | already exists | requires adaptation | actually new |
|---|---|---|---|
| Job | AgentRun 壳 + run 树 + rootRunId 推导 | 新 runType="workforce_job"；生产 createAgentRun 传 runtime | — |
| Owner | AIRuntimeContext.owner 契约 + metadata 投影 | 入口注入 owner；`runtimeFromRunMetadata` 还原 helper；audit/telemetry 补 owner 字段 | — |
| Tasks | AgentRunStep DAG + attempts + 幂等键 | 执行前幂等短路；worker 身份写入 inputJson/metadata | — |
| Worker execution | Supervisor worker registry + runSkill + V2 executor | Web 主链接入编排（今日最大产品缺口）；worker→child run（deriveChildRunContext 已 READY 未接线） | — |
| Structured Handoff | V2 priorEvidence（单域） | — | HandoffPayload 契约（§7，承载于 outputJson，零迁移） |
| Checkpoint | AgentRunVerification + verifier loop；Tender workerStep 游标模式 | repair 消费 repairInstructions；长任务借用 TIME_BUDGET+renewLease 模式 | — |
| Needs Human / Resume | V2/Supervisor 审批 resume；PendingAction 安全底座 | cron 唤醒 awaiting/过期 reconcile；消除 assistant-reconcile 竞态；统一等待语义 | — |
| Completed + 汇报 | buildFinalReport / buildValidatedFinalSummary | Job 级汇报聚合到 Owner（thread + 通知） | — |
| Durable | v1 lease/claim/cron；Tender 分段续跑 | **lease 泛化到 workforce/v2 runType**（queue.ts 泛化，非新队列） | — |

"actually new" 只有一项数据契约（HandoffPayload），其余全部是既有资产的适配与接线——这验证了 audit 的前提判断。

---

## 11. Explicit Non-Scope（Phase 2 V1 明确不做）

```text
No 70 agents（不做 agent 花名册）
No agent group chat
No infinite delegation（委托必须有 depth limit / budget / approval / trace）
No auto-hiring agents
No full 5-layer Memory Runtime
No new Model Runtime（Phase 1/1.1 封板不动）
No new Tool Runtime
No RBAC replacement（scopeGuard / capability / data scope 原样复用）
No autonomous external commitments（外发/承诺永远过 PendingAction）
No Workforce UI overhaul yet（先 Running / Needs You / Completed 三列极简视图）
No 第三个 Task 模型（AgentTask 冻结，AgentRunStep 即 Task）
No 第六套 job 状态机（复用 v2 状态词汇表）
```

---

## 12. Proposed Implementation Slices（不在本轮实施）

```text
Phase 2A — Job lifecycle foundation（第一刀）
  · runType="workforce_job"（字符串，无迁移）
  · 生产 createAgentRun 全入口传 runtime（owner/jobId=rootRunId/taskId）
  · runtimeFromRunMetadata 还原 helper + resume 路径接入
  · queue.ts lease/claim 泛化到 workforce runType（复制既有 CAS 模板）
  · recordAiCall / writeAuditLog 补 ownerType/ownerId

Phase 2B — Task + worker + handoff
  · AgentRunStep 执行前幂等短路
  · worker 身份写入 step（inputJson/metadata，先零迁移）
  · worker → child run（deriveChildRunContext 接线，depth limit=1）
  · HandoffPayload 契约落 outputJson；planner 支持 to.worker

Phase 2C — Checkpoint + human pause/resume
  · cron 唤醒：awaiting_approval 过期 → reconcile → needs_human/failed
  · 消除 assistant-reconcile 与 V2 resume 的竞态（单一 resume 入口）
  · 等待语义统一为 awaiting_approval / needs_human 两值
  · repair loop 消费 repairInstructions（指令驱动修复）
  · 长任务借用 Tender 的 TIME_BUDGET + renewLease + workerStep 游标

Phase 2D — Operator Job UX
  · Operator 增加 "交给青砚" 入口（创建 workforce_job）
  · Running / Needs You / Completed 三列 Job 视图（复用 workbench 读模型）
  · Job 完成汇报回 Owner（thread + 通知）
```

每片独立可验收、可回滚；2A 不依赖 2B/2C/2D。

---

## 13. Files Likely To Change（列出，不修改）

**Existing files to adapt**

| 文件 | 用途 |
|---|---|
| `src/lib/agent-runtime/run.ts` | createAgentRun 接受并要求 runtime（生产接线） |
| `src/lib/agent-runtime/queue.ts` | lease/claim 泛化到 workforce runType |
| `src/lib/agent-runtime/process.ts` | resume 时 runtimeFromRunMetadata 还原 |
| `src/lib/ai/runtime-context.ts` | 新增 runtimeFromRunMetadata；owner 投影补全 |
| `src/lib/agent-runtime-v2/executor.ts` | 幂等短路；worker 身份；handoff 写入 |
| `src/lib/agent-runtime-v2/planner.ts` / `persist.ts` | plan 支持 worker 指派 |
| `src/lib/agent-runtime-v2/verifier.ts` | repairInstructions 指令驱动修复 |
| `src/lib/approval/port.ts` + `src/lib/assistant/reconcile-run.ts` | 单一 resume 入口，消除竞态 |
| `src/app/api/cron/agent-runs/route.ts` | 唤醒 awaiting/过期 run |
| `src/app/api/cron/approval-timeout/route.ts` | 过期 PA → reconcile 关联 run |
| `src/lib/ai/monitor.ts` / `src/lib/audit/logger.ts` | owner 关联字段 |
| `src/lib/agent-supervisor/engine.ts` | worker 结果结构化传递（若 2B 走 supervisor 线） |
| `src/lib/assistant/dispatch.ts` + operator prompt | "交给青砚" 入口（2D） |

**Possible new files**

| 文件 | 用途 |
|---|---|
| `src/lib/workforce/handoff-contract.ts` | HandoffPayload 类型 + 校验（纯类型/纯函数） |
| `src/lib/workforce/job-view.ts` | Running/Needs You/Completed 读模型（2D） |
| `src/lib/agent-runtime/__tests__/workforce-*.test.ts` | 各 slice 契约测试 |

**Possible Prisma changes（能避则避，按证据再决定）**

- 首选零迁移（runType 字符串 + metadata/inputJson 承载 owner/worker/handoff）。
- 若 2B 验证后确需索引查询 worker/job：`AgentRunStep.workerId`（可空列 + 索引）与/或 `AgentRun` 上 `jobId` 显式列。**本轮不改。**

---

## 14. Risk Register

| 风险 | 现状证据 | Phase 2 对策 |
|---|---|---|
| **duplicate execution** | lease 无 heartbeat，3min 后可二次认领；v1 重试整段重跑 | renewLease（抄 Tender）+ step 幂等短路 + 写操作只经 PendingAction |
| **stale authorization** | 已解决于审批执行层（Phase 1.1 执行时重授权 + fail-closed），但 capabilities 审批线 policy 失败为"放行到 executor" | Workforce 只走已加固的 executor 线；不新建授权路径 |
| **cross-org leakage** | scopeGuard fail-closed 已就绪；conversation/adapter 未注入 scopeGuard | workforce 入口强制 scopeGuard；child run 继承（不放宽） |
| **approval resume drift** | assistant-reconcile 先标 completed、V2 resume 再改回 executing（顺序依赖） | 2C 单一 resume 入口 |
| **infinite retries** | run attempts≤3、step≤2 已有上限；repair loop 有 maxRepairs | 保持上限；Job 级预算（quota governance 已有 MAX_CONCURRENT_RUNS/DAILY_AGENT_RUNS） |
| **infinite delegation** | 生产尚无 child run 派生（风险未激活） | 2B 接线时同步实现 depth limit=1 + 预算继承 |
| **lost checkpoints** | v2 每轮持久化，但 stuck run 无人认领 | 2A lease 泛化 + 2C cron 唤醒 |
| **orphan PendingAction** | 过期 PA 标 failed 但不 reconcile run → run 永久 awaiting | 2C 过期→reconcile→needs_human |
| **double side effects** | PendingAction idempotencyKey + ApprovalDecisionIdempotency 已防审批线；读工具/直接执行线无幂等读 | step 幂等短路（2B） |
| **serverless timeout** | v2 executing 停摆无认领；v1 有 cron | 2A lease 泛化 + TIME_BUDGET 分段模式（2C） |
| **quota exhaustion** | Governance Gate 刚封板：单一生效版本 + Owner 可治理 + hard-limit 熔断告警（urgent 通知 + UI 横幅） | Workforce run 天然被 evaluateQuota 覆盖；Job 创建时预检配额即可 |

---

## 15. 外部参考（PART H，只读研究，不引入第二套 Runtime）

| 模式 | 来源 | 对青砚的启示（映射到现有资产） |
|---|---|---|
| 调度器与 agent 进程隔离、任务存活于 DB | Zylos C5（PM2 daemon + SQLite 轮询 + idle-gating） | 青砚等价物 = Vercel cron + AgentRun 表；缺的不是新调度器，而是把 cron 覆盖到全部 runType（2A/2C） |
| 心跳/活性探测独立于 agent | Zylos Activity Monitor（30min heartbeat + 崩溃恢复） | 对应 lease renew + stale-run 检测（Tender 已有 renewLease，泛化即可） |
| 显式完成确认（ack）驱动孤儿检测 | Zylos `cli.js done` acknowledgment | 对应 step 终态写入 + cron 对超时未 ack run 的收敛（2C） |
| Job-first 编排：lead 分解→dispatch→monitor→review→report，lead 不直接碰资源 | OpenMax（Plan/Dispatch/Monitor/Review/Report 五段） | 与 Supervisor runPlanLoop 同构；差距在 Web 主链未接入 + worker 结果结构化消费（2B） |
| 投递不变量："只有真正进入运行时上下文才 ack" | OpenMax SDK inbox-ledger（dedupe→normalize→policy→deliver） | 对应 PendingAction/step 状态写入的事务边界；handoff 投递也应遵守同一不变量 |
| Agent 身份/域解析 + 人机同权限工作流 | OpenMax（AI as colleague, same permissions） | 佐证"Worker 复用现有 RBAC/scopeGuard，不建第二套授权"的原则 |

明确不做：不 clone Zylos 常驻进程模型（与 Vercel serverless 冲突）、不替换 Agent/Model/Tool Runtime、不替换 Approval/RBAC。

---

## Final Recommendation

```text
PHASE_2_IMPLEMENTATION_READY = YES
```

理由：所有硬安全底座（Tool Runtime + scopeGuard、审批执行时重授权、配额治理、run 树契约）已封板可复用；缺口全部属于"接线与统一"性质，且每一项都有仓库内已验证的模式可抄（v1 lease 模板、Tender 分段续跑、V2 审批 resume、PublishJob 状态事件）。没有需要先行独立修复的 BLOCKER。

**第一刀（Phase 2A — Job lifecycle foundation）应开发：**

1. `runType="workforce_job"` + 生产 `createAgentRun` 全入口注入 `runtime`（owner / jobId=rootRunId）；
2. `runtimeFromRunMetadata` 还原 helper + resume 路径接入（解决 resume 丢身份）；
3. `queue.ts` lease/claim 泛化到 workforce runType（复制既有 CAS 模板，含 cron 认领）；
4. audit/telemetry 补 `ownerType/ownerId`；
5. 契约测试：Job 创建 → owner 落库 → 断电（模拟超时）→ cron 认领续跑 → owner/上下文完整还原。

这一刀完成后，"用户把工作交给青砚，青砚在服务器端可靠地拥有并推进这份工作"第一次成立；Tasks/Handoff/Checkpoint（2B/2C）在其上叠加。

---

*本报告为只读审计产物。Phase 2 分支当前只包含本文档；未实现 WorkforceJob / Task 模型 / Handoff / Memory，未修改 Prisma，未新增 UI。等待审查后再决定第一批 implementation。*
