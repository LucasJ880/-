# Qingyan Workforce Runtime — Phase 2C Design：Human Pause / Checkpoint / Durable Resume

- 日期：2026-08-09
- 分支：`feature/workforce-runtime-phase2`
- 性质：**READ-ONLY 设计产物**。未实现任何代码、未修改 Prisma、未触碰 Phase 2A 文件。
- 重要限定：**Phase 2A 仍在同一 worktree 并行实施中**（processor/lease/executor/verifier 截至审计时仍有未提交改动，如 `processor.ts` 中 `holder`/`lease` 变量命名尚在整理）。本文对 2A 的所有引用均为"**截至审计时**"的实现快照；实施 2C 前需与 2A 封板版本对齐。
- 上游依据：Phase 2 审计报告、Phase 2B 设计（`QINGYAN_WORKFORCE_PHASE2B_HANDOFF_PARALLEL_DESIGN.md`）、Phase 2A 报告（`QINGYAN_WORKFORCE_PHASE2A_REPORT.md`）。冻结等式不变：Job = root AgentRun、Task = AgentRunStep、Checkpoint = AgentRunVerification + step 持久化、Human Intervention = PendingAction。

## §1 核心问题与结论速览

一个 Workforce Job 运行几分钟/几小时/几天后遇到需要人工处理的情况，如何安全暂停，并在人工动作完成后，从正确位置、正确身份、正确上下文继续？

```text
Running → Checkpoint → Needs Human →（Hours/Days）→ Human Action
→ Reauthorization → Resume → Continue Existing Task State → Completed
```

速览：

```text
暂停/恢复骨架（lease 释放、身份锚点、审批人≠执行主体、重新入队、fenced 写入）
  → 2A 截至审计时已实现并有 Case H/F/G/I 实证 —— 2C 不重建
2C 真正要补的四件事：
  1. 过期 PendingAction 不 reconcile 关联 run（run 永久卡 awaiting_approval）—— 审计已确认的缺口
  2. Stale business state：暂停期间业务对象被改，恢复后不得基于旧快照执行外发
  3. Clarification / Authentication 两类非审批等待的 resume contract（现状只能 park，无恢复入口）
  4. 统一 resume 前置门（freshness / approval 时效 / scope 重查）为单一概念流程
PHASE_2C_SCHEMA_CHANGE = NONE
PHASE_2C_DESIGN_READY = YES
```

## §2 现状调用链（截至审计时）

```text
暂停（park）：
  processWorkforceJobSlice                    src/lib/workforce-runtime/processor.ts
   → processAgentRuntimeV2Run 返回 awaiting_approval / needs_human
   → fencedRunUpdate: leaseExpiresAt=null, nextAttemptAt=null   （租约释放）
   → appendAgentRunEvent("job.waiting_human")
  principal 失效 park（processor L190–215）额外做 attempts: 0     （等待人 ≠ 消耗重试预算）

等待期间：
  WORKFORCE_ACTIVE_STATUSES（constants.ts L14–21）明确不含
  awaiting_approval / needs_human —— 等待中的 Job 不在 cron 认领范围，
  不会被 lease 回收逻辑误杀（processQueuedWorkforceJobs eligible 查询 L497–515）。

人工动作 → 恢复：
  approveApprovalItem / reject…               src/lib/approval/port.ts L183–453
   → executePendingAction（payloadHash 校验 + 执行时重授权 fail-closed）
   → reconcileAfterPendingAction（assistant 线收敛）
   → resumeSupervisorAfterApproval（supervisor 线）
   → resumeRuntimeV2AfterApproval（V2 线）      src/lib/agent-runtime-v2/process.ts L238
       → recordApprovalActor（只记录，不篡位）    principal.ts L106–130
       → resolveRuntimeV2Principal（重查发起人 user.active + membership.active）principal.ts L37–103
       → reconcilePendingActionsForStep → step 终态
       → workforce_job：不 inline 续跑，重新入队（queued + nextAttemptAt=now）+ job.resumed 事件
   → 下一个 cron slice：claimRunLease → runtimeFromRunMetadata（19 字段身份恢复）
     → 再次 resolveRuntimeV2Principal → bounded rounds 续跑

过期路径（缺口所在）：
  /api/cron/approval-timeout → expireOverdueApprovals   approval/port.ts L489–496
   → pendingAction.updateMany({status:"failed", failureReason:"已过期"})
   → **不 reconcile 关联 AgentRun / AgentRunStep** —— run 永卡 awaiting_approval
```

已知竞态（审计报告 §6 结论，代码复核仍成立）：`approveApprovalItem` 按"assistant reconcile → supervisor resume → V2 resume"顺序执行（port.ts L238–305），语义靠执行顺序保证，2C 应收敛为单一 resume 入口。

## §3 人工介入分类（不新增数据模型）

| 类型 | 承载 | 现状 |
|---|---|---|
| APPROVAL_REQUIRED | **PendingAction**（payload/payloadHash/approver/expiresAt）+ step `awaiting_approval` + run `awaiting_approval` | READY（全链路封板） |
| IRREVERSIBLE_ACTION_CONFIRMATION | 同上——不可逆确认就是审批的一个 riskLevel 更高的实例，**不另建类型** | READY（riskLevel/requiresApproval 已表达） |
| CLARIFICATION_REQUIRED | **Job state + message**：run `needs_human` + `job.waiting_human` 事件（payload 含 clarification 文本，processor L267–288 截至审计时已写）+ thread 消息 | PARTIAL（能 park，缺回答→恢复 contract，见 §12） |
| BUSINESS_DECISION_REQUIRED | 同 CLARIFICATION（问题内容不同，机制相同——"选方案 A 还是 B"就是一个 clarification） | PARTIAL |
| AUTHENTICATION_REQUIRED / OTP_REQUIRED / CAPTCHA_REQUIRED | **Job state + event**：run `needs_human` + 事件 payload `humanRequirement.type` + 外部会话引用（§11）；**不用 PendingAction**（无可审批 payload，无 approver 语义） | MISSING（DESIGN ONLY，无浏览器 worker 生产实现） |
| PERMISSION_CHANGED | **Job state**：run `needs_human` + errorCode（INITIATOR_MISSING/USER_INACTIVE/NO_MEMBERSHIP/MEMBERSHIP_INACTIVE，principal.ts L18–23；executor 鉴权失败路径 executor.ts L185–211） | READY |
| EXTERNAL_DEPENDENCY（等第三方回调/到货/回复） | **Job state + 定时重查**：run `needs_human` + 事件；若可预估恢复时间，用现有 `nextAttemptAt` 列做定时重查（§8D），不加 resumeAt | PARTIAL（列已有，语义未接） |
| CONFLICT_REQUIRES_HUMAN | **Job state**：run `needs_human`（verifier NEEDS_HUMAN verdict、reconcile 不安全路径 process.ts L358–375、2B 资源冲突升级） | READY |

统一承载原则：**有"可执行的 payload + 明确审批人"→ PendingAction；只是"需要人给信息/做动作"→ run/step 状态 + AgentRunEvent + 消息**。区分手段是事件 payload 里的 `humanRequirement: { type, detail, refs }`（零迁移，写在 `job.waiting_human` 事件与 run metadata），不为每种情况建模型。

## §4 Needs Human ≠ Failure（状态映射，先不加新状态）

| 逻辑状态 | 现有映射 | 判定 |
|---|---|---|
| RUNNING | run `running/executing/planning/planned/verifying/repairing`（= WORKFORCE_ACTIVE_STATUSES） | 够用 |
| WAITING_FOR_HUMAN（审批类） | run `awaiting_approval` + step `awaiting_approval` + PendingAction `pending` | 够用 |
| WAITING_FOR_HUMAN（非审批类） | run `needs_human` | **够用但语义过载**（见下） |
| RESUMABLE | run `queued`（审批后重新入队即是"可恢复"的物化，2A 截至审计时已实现）| 够用 |
| FAILED | run `failed` + errorCode + `job.failed` 事件 | 够用 |
| CANCELLED | run `cancelled` | 够用 |

结论：**不加新状态值**。唯一真实问题是 `needs_human` 一词三义：(a) 等人补充信息（可恢复）；(b) 权限失效（人修复后可恢复）；(c) repair 预算耗尽的准终态（verifier.ts L312–318）。区分方案（零迁移）：`metadata.humanRequirement.type`（§3 词汇）+ `job.waiting_human` 事件 payload 标注是否 resumable；终态型 needs_human 不写 humanRequirement。**FAILED/CANCELLED 与 WAITING 的硬语义区分**：等待态保留全部 checkpoint（steps/plan/lease=null）且不写 `completedAt`；失败/取消写 `completedAt` 并出认领池。

## §5 Checkpoint 定义（四级审计）

Checkpoint ≠ Memory。Checkpoint = **未来恢复执行所需的最小持久状态**。V2 是计划驱动而非对话驱动——恢复不需要 LLM conversation 上下文，只需要下面四级：

| 级别 | 承载 | 已保存的恢复信息（代码证据） |
|---|---|---|
| **Job checkpoint** | `AgentRun` 行 | `status`（在哪个阶段）、`planJson`（做什么，persist.ts L24–32）、`metadata` 19 字段 correlation（`runtimeFromRunMetadata`，2A：orgId/workspaceId/actor/agent/owner/jobId/taskId/runId/parentRunId/rootRunId/projectId/customerId/vendorId/tenderId/orderId/threadId/sessionId/channel/traceId/source，DB 列优先）、`attempts/nextAttemptAt/leaseExpiresAt`（队列位）、`startedAt`（真实年龄，claim 不重置） |
| **Task checkpoint** | `AgentRunStep` 行 | `status`（DAG 恢复点：completed 不重跑——Case F/G 实证 attemptCount/completedAt 逐字节不变）、`outputJson/evidenceJson`（下游 priorEvidence 输入 + 2B handoff 信封）、`attemptCount`（剩余重试预算）、`dependsOnJson`（refreshReadySteps 重算 ready 集合，恢复无需额外游标） |
| **Tool checkpoint** | `idempotencyKey` | step 级 operationKey（executor.ts L215–228）+ PendingAction 稳定业务键 `{runId}:{stepKey}:{actionType}:{targetId}`（adapters.ts L308/375/448）——恢复后重放的防重界碑 |
| **Human checkpoint** | `PendingAction` 行 | `payload`（要做什么）+ `payloadHash/payloadVersion/policyVersion/resourceVersion`（防篡改与时效锚点，schema L2061–2070）+ `status/decidedAt/decidedById/executedAt`（人的决定及其时间）+ `agentRunId` 反向关联；step 的 `pendingActionId` 正向关联 |
| （验证历史） | `AgentRunVerification` | verdict/criteria/evidence/repairInstructions 按 attempt append（`@@unique([runId, attempt])`）——恢复后 verifier 可见既往判定 |

审计结论：**恢复所需状态已全部落库，无需新 checkpoint 结构**。缺的不是存储，是恢复时的校验门（§9/§10）与非审批等待的恢复入口（§12/§11）。

## §6 Resume Contract（最小 Resume Context，不建 Resume 表）

| Resume Context 字段 | 现有承载 | 备注 |
|---|---|---|
| jobId | `metadata.jobId`（= rootRunId = run.id，2A Case A/B DB readback 实证） | |
| runId | `AgentRun.id` | |
| taskId（恢复点） | **不需要显式存**：`refreshReadySteps` 从 step statuses 推导 ready 集合；awaiting 步骤由 `status="awaiting_approval"` 定位 | 游标即状态 |
| checkpoint state | §5 四级 | |
| owner | `metadata.ownerType/ownerId` | |
| execution principal anchor | `metadata.initiatedByUserId`（principal.ts L27–31） | 恢复身份的唯一锚点 |
| pendingActionId(s) | `step.pendingActionId` + `evidenceJson.pendingActionIds` | |
| business object refs | `metadata.projectId/customerId/tenderId/...` + PendingAction.payload 内实体 ID | |
| last successful operationKey | `step.idempotencyKey`（completed steps） | |
| traceId | `metadata.traceId`（列+metadata 一致，Case A 实证） | |
| resume reason | `job.resumed` / `job.waiting_human` 事件 payload（append-only 审计） | 事件即记录，不加列 |

结论：**Resume Context 是一个读投影（`runtimeFromRunMetadata` + steps 查询），不是新表**。确无必要建 Resume 表：所有字段已有权威存储，建表只会制造第二事实源。

## §7 Resume Identity（硬规则）

四者关系：

```text
Human Owner        metadata.ownerType/ownerId          Job 问责人，收报告；跨 run 树不变
Execution Principal metadata.initiatedByUserId          恢复后以谁的身份执行 —— 唯一合法答案
Human Actor(approver) metadata.approvalActorUserId(+Ids) 谁点了批准/拒绝 —— 只记录，绝不成为执行身份
Runtime Actor      metadata.actorType/actorId/actorUserId 当前执行体（AGENT on-behalf-of principal）
```

硬规则（**Phase 2A Case H 已实证的现状实现，2C 原样继承**）：

1. User A 创建 Job、Admin B 审批 → 恢复后执行身份仍是 User A：`resolveRuntimeV2Principal` 只认 `initiatedByUserId`，`approvalActorUserId` 仅入参记录（principal.ts L37–103）；Case H 12 项断言含"resume 后 execution principal=UserA、owner/jobId/traceId 全程未漂移"。
2. Resume 后必须重查 **current** membership/capability/scope/tool policy/approval——已分层存在：principal 重查 user.status+membership.status（principal.ts L63–89）；每轮 executor 重查 membership + canInvokeTool（executor.ts L82–93、L167–184）；写执行时重授权 fail-closed（pending-actions/executor.ts L195–258）。
3. **禁止信任旧 metadata 中的 role/canWrite/approved=true**：2A 已在 `runtimeFromRunMetadata` JSDoc 写明"metadata 仅为 identity/correlation，不是授权快照"；2B Handoff 契约在 schema 层排除权限字段。2C 补充同一原则的第三处适用点：**resume 校验门（§17）读 metadata 只取身份锚点，一切权限现算**。
4. Ownership Transfer（设计预留，不实现）：显式动作 = 更新 `metadata.ownerId` + `initiatedByUserId` + `job.ownership_transferred` 事件（记录 from/to/by/reason）；转移后 principal 校验以新锚点执行。**没有该显式事件的任何身份漂移都是缺陷**。

## §8 Long Pause（10 分钟 / 3 小时 / 2 天 / 7 天）

六个必答：

**A. WAITING_FOR_HUMAN 时 lease 是否应释放？→ YES，且截至审计时已实现。** park 写入 `leaseExpiresAt: null, nextAttemptAt: null`（processor L192–203、L392–395）；`WORKFORCE_ACTIVE_STATUSES` 不含两个等待态（constants.ts L12 注释明示"等待人，不允许被认领续跑"），等待中的 Job 完全脱离认领循环——租约是执行期概念，不是等待期概念。

**B. attempts 是否应继续增长？→ NO，2A 正在修的语义与设计一致。** 等待不是失败：principal-park 已写 `attempts: 0`（processor L201，代码注释"waiting human 是正常 park——重置 attempts"）。设计规范化：**attempts 只计"执行尝试"**（claim 递增、执行失败保留、park 归零或至少不计入 maxAttempts 判定）；否则一个审批等待 + 几次正常 slice 续跑就会烧穿 `WORKFORCE_MAX_ATTEMPTS=5`。实施时以 2A 封板后的 attempts 语义为准对齐。

**C. Job.startedAt 保持原值？→ YES，已实现。** `resetStartedAt: false`（processor L153）；executor 对 workforce_job 跳过 startedAt 全局 timeout（2A §12）；Case I 实证"startedAt 回拨超旧 timeout 后 Job 不 failed"。startedAt = Job 真实年龄，永不用于杀执行。

**D. 是否需要 resumeAt 列？→ 不需要，先用现有 nextAttemptAt + 事件。** `nextAttemptAt` 本来就是"什么时候该再看一眼"的列（claim 条件 `nextAttemptAt ≤ now`，lease.ts L68–77）。EXTERNAL_DEPENDENCY 类等待若可预估恢复时间：park 为 `queued + nextAttemptAt=预计时间`（而非 needs_human），到点自动重查；不可预估的等待保持 needs_human + 人工/事件触发恢复。resume 时间语义全部由 `job.waiting_human`/`job.resumed` 事件 payload 记录，无需 schema。

**E. PendingAction 过期如何处理？→ 现状是缺口，2C 主修项。** 现状：`expireOverdueApprovals` 批量 `status="failed", failureReason="已过期"`（port.ts L493–496），**不碰关联 run/step**；`/api/cron/agent-runs` 不处理 awaiting_approval——run 永久卡死。设计（复用现有件，不新建）：过期处理循环改为逐 org 分组后，对含 `agentRunId` 的过期 action 调用与审批 resume 相同的 reconcile 路径（`reconcilePendingActionsForStep` 已把"expired/failed"归入安全终态判定），step → failed(errorCode=approval_expired)，run → `needs_human` + `job.waiting_human` 事件（humanRequirement.type=APPROVAL_REQUIRED, detail=expired）——**过期 ≠ 拒绝 ≠ 自动重新申请**，由人决定重发起或放弃（配合 §13 loop guard）。

**F. 暂停期间业务对象被改怎么办？→ 见 §9。**

## §9 Stale Business State（重点）

场景：Task 基于 Quote v3（$10,000）准备了发送动作 → 暂停两天 → 有人手工把 Quote 改成 v4（$12,000）→ 审批通过后 resume。**系统不得基于 v3 自动发送。**

### 现有原语审计

| 原语 | 现状 |
|---|---|
| `PendingAction.payloadHash/payloadVersion` | **已 enforce**：执行前重算比对，不匹配 → `PAYLOAD_HASH_MISMATCH` 拒绝执行（pending-actions/executor.ts L164–192）。防的是 **payload 被篡改**，不防 payload 所引用的资源变化 |
| `PendingAction.policyVersion` | 落库（drafts.ts L137 默认 "org-default-v1"），执行时重授权实际走 loadAgentToolPolicyRule 现查（比版本号更强） |
| `PendingAction.resourceVersion` | **列存在、几乎未用**：唯一生产者是报价晋升审批（`request-promotion-approval/route.ts` L128 写 `quote.updatedAt.toISOString()`）；drafts.ts 默认 null；**没有任何执行路径读该列** |
| 内容级 freshness 的黄金样板 | `execSalesApproveQuotePromotion`（pending-actions/executor.ts L763–791）：执行时**重读当前 Quote**，比对 `promotionApprovalActionId === actionId` + 金额/比例逐项相等，不符 → "报价让利内容已变化，请销售重新提交审批"。这就是 2C 要泛化的模式 |

### 设计：optimistic validation（零迁移）

1. **写侧**：所有经 `createDraft` 的写动作补传 `resourceVersion = 目标实体.updatedAt.toISOString()`（参数已存在，drafts.ts L39；多实体时取主资源，payload.metadata 可带辅资源版本）。
2. **读侧（resume/执行前校验门）**：重读目标实体 `updatedAt` 与 `resourceVersion` 比对；有条件时叠加内容级比对（quote 样板）。快照引用（如文件 hash）可用 payload 内已有 contentHash 类字段，不新增列。

### STALE_RESOURCE_RESUME_POLICY

| 判定 | 条件 | 动作 |
|---|---|---|
| **SAFE_TO_CONTINUE** | 步骤只读/分析（重新执行天然读最新数据）；或写动作 resourceVersion 匹配（资源未变） | 直接继续 |
| **REVALIDATE** | 资源已变，但该步骤产物是**可重derive的内部草稿**（分析、内部任务、跟进日期建议）| 重跑产该草稿的步骤（step 回 ready，复用 verifier REPAIR 的重置机制），基于新数据重新生成，重新走审批 |
| **REPLAN** | 资源变化使**上游假设失效**（计划里多个步骤依赖旧状态；2B handoff 的 inputRefs 可定位污染范围） | verifier REPAIR / supervisor replan 路径，重排后续计划 |
| **NEEDS_HUMAN** | 资源已变且动作是**外发/不可逆**（send_email/submit_tender/publish/spend）；或无法判定影响面 | 停下问人——fail-closed 默认值 |

Quote 例的判定：外发（发送报价邮件）+ v4≠v3 → **NEEDS_HUMAN**（告知"报价已从 $10,000 变为 $12,000，请确认后重新审批"）；若动作只是内部草稿更新 → REVALIDATE 重derive。**默认规则：分类不确定时落 NEEDS_HUMAN**，与 2B 并行策略 fail-safe 到 SEQUENTIAL 同哲学。

## §10 Approval Expiration（approval freshness 最小 V1）

问题：审批通过后 2 天才 resume，send_email/submit_tender/publish/modify_quote/spend_budget 还应执行吗？

现状：`expiresAt` 只管 **pending 阶段**（默认 +24h，drafts.ts L36–37）；approved-未-executed 没有时效概念——审批后 resume 无论隔多久都会执行。

最小 V1（不做 policy engine，两条规则）：

1. **资源新鲜度优先于时间**：执行前先走 §9 校验门——资源未变的旧审批仍然有效（决定没有过时的理由）；资源已变 → NEEDS_HUMAN 重审批。这覆盖了大多数真实风险，且报价晋升 executor 已是此模式。
2. **外发类叠加时间上限**：为 REQUIRES_APPROVAL 中的外发/不可逆子类设 `APPROVAL_FRESHNESS_MS`（env，建议默认 24h，与 pending 阶段 TTL 对称）；执行时 `now - decidedAt > freshness` → 不执行，action 置回需重审（新 PendingAction，旧的标 superseded 语义用 failureReason 表达），事件通知审批人与 owner。内部可逆动作（建任务/改跟进日期）不设时间上限，只走资源校验。

判定表（send_email 审批后 2 天 resume）：资源未变 + 超 24h → 重审（时间规则）；资源已变 → NEEDS_HUMAN（§9）；两者都通过 → 执行。

## §11 OTP / CAPTCHA / Browser Human Takeover（概念设计，不实现）

```text
Task Running（browser worker 遇认证挑战）
 → park：run needs_human + job.waiting_human 事件
     payload.humanRequirement = {
       type: "AUTHENTICATION_REQUIRED" | "OTP_REQUIRED" | "CAPTCHA_REQUIRED",
       challengeRef: "外部会话定位符（如 browser session id / 门户名）",
       businessContextRef: "tender:td_001"      // 业务对象引用，非凭据
     }
 → Human 在 worker 的实时会话中完成挑战（人机交接发生在执行环境，不经过 DB）
 → 恢复触发：追加 job.human_action_completed 事件
     payload = { challengeResolved: true, resolvedAt, resolvedBy, businessContextRef }
 → run 重新入队（queued + nextAttemptAt=now）→ processor 认领 → 同一 Task 续跑
```

持久化边界（硬规则）：

- **允许持久化**：challenge 类型、resolved 标记、时间戳、resolvedBy、业务对象引用、外部会话的**不透明定位符**；
- **禁止持久化**：OTP 码、密码、CAPTCHA 答案、session cookie/token、任何可重放凭据——不进 metadata、不进事件 payload、不进 outputJson。浏览器会话的存活是执行环境的职责（worker 进程内存/受管浏览器），DB 只记录"挑战已被人解决"这一事实。
- 若恢复时外部会话已失效：worker 报认证失败 → 再次 park（同类型 humanRequirement）——**幂等的等待循环，而非错误**。

## §12 Clarification Resume（"用方案 B"）

不重建新 Job 的最小 contract（全部现有件）：

```text
提问（已存在，截至审计时）：
  planner needsClarification → processor park：run needs_human, attempts=0,
  errorMessage=clarification 文本, job.waiting_human 事件（payload 含问题）
回答（2C 设计）：
  用户在关联 thread 回复"用方案 B"
  → resume 入口（API/操作）校验回答者 ∈ {owner, initiator}（org 内可配置放宽，默认收紧）
  → 追加事件 job.clarification_answered：
      { question: <原问题>, answer: "用方案 B", answeredBy, answeredAt, messageRef }
  → 合并进 metadata（mergeAgentRunMetadata，2A 已有 helper）：
      metadata.clarifications = [...prev, { q, a, at }]     // 追加不覆盖
      metadata.goal 不改写原文，planner 输入 = goal + clarifications 叠加
  → run 重新入队（queued + nextAttemptAt=now）
  → processor 认领 → 无 planJson 则规划（planner 收到 goal+clarifications）；
    已有 planJson 且回答改变假设 → verifier REPAIR/replan 路径处理
```

关联关系：Job=同一 runId；Question=job.waiting_human 事件；Answer=job.clarification_answered 事件 + metadata.clarifications；Task=不变（clarification 属 Job 级；Task 级歧义走同机制，事件 payload 带 stepKey）。**无新表、无新状态、无新 Job。**

## §13 Approval Rejected（REJECT 之后）

现状：拒绝 ≠ 执行已是硬语义——V2 reconcile 把拒绝步骤标 failed（"审批已拒绝，不视为已执行"）；supervisor 拒绝后依赖步骤 skipped + replan（engine.ts L617–695，replanCount 预算内）。

四个出口的适用条件：

| 出口 | 条件 |
|---|---|
| **SKIP_TASK** | 被拒动作是可选增强（如"顺手建提醒"），无下游必要步骤依赖它 → step failed/skipped，Job 继续 |
| **REPLAN** | 存在替代路径（换渠道、换措辞、降级为内部草稿）且 replan 预算未耗尽 → replan **且新计划禁止再产生被拒的同一动作**（见 loop guard） |
| **CANCEL_JOB** | 被拒动作就是 Job 核心目标（"提交投标"被拒 → Job 无意义）→ owner 确认后 cancelled |
| **NEEDS_HUMAN** | 无法判定拒绝意图（拒绝理由为空/歧义）→ 问 owner"跳过、调整还是取消？"（走 §12 clarification 机制） |

默认：有 note 的拒绝 → 按 note 语义（note 进 replan 输入）；无 note → NEEDS_HUMAN。**不自动 REPLAN 不可逆外发类的拒绝**（拒绝外发默认 = 人不想发，不是想换个说法发）。

**Rejection loop guard（禁止 拒绝→自动重申请相同审批→无限循环）**：

1. **幂等键即记忆**：被拒 PendingAction 的稳定 idempotencyKey（`{runId}:{stepKey}:{actionType}:{targetId}`）占据 `@@unique([orgId, idempotencyKey])`——同 Job 内重建同键草稿会命中已有 rejected 行（drafts.ts 同键复用语义），消费方必须把"已拒绝"视为**不得重建**，而非复用重提；
2. **replan 约束**：replan 输入携带 rejected 动作清单（reconcile 已写入 step outputJson.approvalStatuses），planner 提示词禁止重生成同 actionType+targetId 组合，除非人显式要求修改后重发（走 §14，产生**新键**）；
3. **预算封顶**：replanCount ≤ maxReplans（既有）；同一 stepKey 的审批请求次数 ≤ 2（超过 → NEEDS_HUMAN），计数从 evidenceJson.pendingActionIds 长度推导，零迁移。

## §14 Human Edit + Resume（"价格改成 $11,500 再发"）

原则：**人改的是"下一次动作的输入"，不是历史证据；LLM 永远不直接修改历史。**

```text
Human Modification（在审批卡/编辑界面改 $12,000 → $11,500）
 → 原 PendingAction 不可变（payloadHash 防篡改已在执行层 enforce，
   executor L164–192：改 payload = hash mismatch = 拒绝执行——
   所以"编辑后执行原 action"在现有安全模型下本来就不可能）
 → 正确路径：原 action → rejected（或保持 failed/expired 终态）
 → 创建新 PendingAction：新 payload（$11,500）、新 payloadHash、
   新 idempotencyKey（稳定键 + 修订后缀，如 …:{targetId}:rev2，绕开 §13 的"同键不重建"守卫——
   因为这是人显式要求的修改，不是机器自动重试）、
   payload.metadata.supersedes = 原 actionId、editedBy/editedAt
 → step：新 attempt，inputJson 合并 human edit（updated input），
   outputJson/evidenceJson 历史保持原样（append 新值，不改旧值）
 → 事件 job.human_edited：{ stepKey, supersedes, editedBy, diffSummary }
 → 正常审批流 → 执行 → resume
```

与 replan 的关系：单动作参数修改 → 上述轻路径（不触发 replan）；修改影响多步骤假设（"整体预算砍半"）→ 走 §12 clarification + replan。

## §15 Checkpoint Integrity

四原则落到三类写入（不做完整 Event Sourcing）：

| 写入类型 | 对象 | 规则 |
|---|---|---|
| **原地更新**（当前态） | AgentRun.status/attempts/lease 列；AgentRunStep.status/attemptCount | 允许更新，但 workforce_job 的生命周期写入必须 **fenced**（`fencedRunUpdate`/`createRunFence`，截至审计时 stale worker 写入 0 行）——durable 由此保证 |
| **append-only**（历史/审计） | AgentRunEvent（`@@unique([runId, sequence])`）；AgentRunVerification（`@@unique([runId, attempt])`）；metadata.clarifications / approvalActorUserIds（数组追加，principal.ts L120–125 已是此模式） | 只增不改——auditable 由此保证 |
| **immutable where necessary** | PendingAction.payload+payloadHash（创建即冻结，执行时校验）；completed step 的 outputJson/evidenceJson（修正 = 新 attempt/新 step 的新记录，不改旧值）；`job.*` 事件 payload | 篡改可检测（hash）或不可能（事件序列） |

minimal：以上没有任何新机制——fence、事件序列、verification attempt、payloadHash 全部既有；2C 只是把"哪类信息走哪类写入"定为规范，防止实现时把 clarification 答案覆盖写进 errorMessage 之类的破坏审计的捷径。

## §16 AgentRunVerification 的角色

延续 2B 结论：`@@unique([runId, attempt])` 决定它是 **run 级**记录，适合 **job-level verification**（final + repair 轮次）。2C 的三个"验证"时刻分工：

| 时刻 | 承载 | 为什么不用 AgentRunVerification |
|---|---|---|
| **pre-resume 校验门**（principal/freshness/approval 时效/scope） | processor 内确定性代码 + 失败时 `job.resume_blocked` 事件 | 这是门禁不是判定：结果是"放行/park"，无 verdict 语义；写 verification 行会污染 attempt 序列（repair 预算按 attempt 数判定，verifier.ts L271） |
| **post-resume 验证** | 恢复续跑后自然到达的下一次 `verifyRuntimeV2Run`（attempt 自然递增） | 已覆盖，无需特殊化 |
| **final verification** | 现有 verifier（确定性 + 模型双层） | 原样 |

不新增 verifier 表；不把门禁结果写进 verification。resume 失败原因的审计位置 = `job.resume_blocked` 事件 payload（blockedBy: principal/freshness/approval_expired/scope）。

## §17 统一 resumeWorkforceJob() 概念流程（只设计）

```text
resumeWorkforceJob(runId, trigger)          // trigger: approval_decided | clarification_answered
                                            //          | auth_completed | manual | scheduled(nextAttemptAt)
 1. load Job                    findUnique + runType=workforce_job 断言
 2. confirm resumable state     status ∈ {awaiting_approval, needs_human}（终态/cancelled → 拒绝并事件）
                                cancelled 断言优先级最高（防 resume-after-cancel）
 3. restore runtime identity    runtimeFromRunMetadata（19 字段；只取身份，不取权限）
 4. resolve current principal   resolveRuntimeV2Principal（user.active + membership 现查）
                                失败 → park needs_human(PERMISSION_CHANGED) + resume_blocked
 5. check human requirement     approval：关联 PendingAction 全部离开 pending（reconcile step 终态）
    resolved                    clarification：存在 job.clarification_answered
                                auth：存在 job.human_action_completed
                                未满足 → 保持等待（幂等：重复触发无害）
 6. check resource freshness    §9 STALE_RESOURCE_RESUME_POLICY（写步骤逐个判定）
                                REVALIDATE→步骤回 ready；REPLAN→repair 路径；NEEDS_HUMAN→park
 7. check scope                 目标实体仍 ∈ Job scope（org/workspace/实体集，§8 继承规则）
 8. revalidate approval         payloadHash（既有）+ §10 freshness（外发类时间上限）
 9. restore Task checkpoint     无需动作——steps 即 checkpoint；refreshReadySteps 重算 ready
10. requeue                     fenced：status=queued, nextAttemptAt=now, attempts 不惩罚
                                + job.resumed 事件（trigger/principal/approver 记录）
11. durable processor claim     claimRunLease（原子，多触发源并发安全：最多一个 claim 成功）
12. continue                    processWorkforceJobSlice bounded rounds（既有）
```

关键性质：**步骤 1–10 幂等可重入**（重复触发在 2/5 处短路或在 11 处 CAS 落败）；**duplicate resume 由 lease claim 天然去重**；步骤 3–8 是 2C 的增量（4 截至审计时已有，5 的 approval 分支已有，6/7/8 为新门）。approval 触发源收敛：`approveApprovalItem` 对 workforce_job 只做 reconcile + 调 `resumeWorkforceJob(trigger=approval_decided)`，消除 assistant-reconcile/supervisor/V2 三线顺序依赖（§2 竞态）。

## §18 Proactive Notification（事件模型，复用 AgentRunEvent）

| 事件 | 现状（截至审计时） | 2C 增量 |
|---|---|---|
| `job.waiting_human` | 已有（processor 三处写入） | payload 增加 `humanRequirement.type`：approval_required / clarification_required / authentication_required / external_dependency / permission_changed |
| `job.resumed` | 已有（审批恢复路径写入） | payload 统一为 { trigger, principalUserId, humanActorUserId } |
| `job.resume_blocked` | 无 | 新事件类型（types.ts job.* 家族追加），payload = { blockedBy, detail } |
| `job.clarification_answered` / `job.human_action_completed` / `job.human_edited` | 无 | 新事件类型（§12/§11/§14） |
| `job.progress` | 无（2B 已设计） | 归 2B |

投递面（thread 消息/微信推送/UI 三列）属 2D；2C 只保证事件序列完整、payload 结构化、visibleToUser 标记正确。**不建 Notification Runtime。**

## §19 Golden Scenario A — Sales（审批 2 小时后恢复）

"整理跟进客户并准备邮件草稿"，UserA 创建，AdminB 两小时后批准：

```text
t0    createWorkforceJob(UserA)     run: queued, metadata{owner=A, initiatedBy=A, jobId=rootRunId}
t1    cron claim                    run: running, attempts=1, lease=t1+3min      [job.claimed]
t1'   plan + s1..s5 完成            steps: completed（outputJson+handoff）        [step.completed ×5]
t2    s6 邮件草稿 → PendingAction    step s6: awaiting_approval, pendingActionId=PA1
                                    PA1: pending, payloadHash=H1, resourceVersion=customer.updatedAt
      park                          run: awaiting_approval, lease=null, nextAttemptAt=null
                                                                                [job.waiting_human(approval_required)]
t2+2h AdminB approve PA1            executePendingAction: payloadHash 校验 ✓ → 执行时重授权 ✓
                                    → Gmail 草稿创建, PA1: executed, resultRef=draftId
      resumeWorkforceJob(approval_decided):
        2 resumable ✓（awaiting_approval）
        3 runtimeFromRunMetadata → owner=A, initiatedBy=A
        4 principal: UserA active + membership active ✓（重查，非快照）
        5 PA1 离开 pending ✓ → reconcile s6: completed（approvalActorUserId=B 记录在 outputJson）
        6 freshness: s6 已执行（executed 即终态，无 stale 风险）；后续步骤只读 → SAFE_TO_CONTINUE
        7 scope: Customer/Opportunity 仍 ∈ org ✓
        8 approval freshness: decidedAt 与 executedAt 同刻，不适用
        10 requeue: queued, nextAttemptAt=now                                   [job.resumed{trigger:approval_decided, principal:A, humanActor:B}]
t2+2h' cron claim（新 lease token）   run: running                               [job.claimed]
       剩余步骤（s7/s8 或 verify）    以 UserA 身份执行（Case H 语义）
t3    verifier PASS                 run: completed, completedAt=t3              [verification.passed, run.completed, job.completed]
       owner=UserA 收最终报告（thread + run.completed payload 聚合摘要）
不变量全程成立：initiatedBy=A 未漂移；attempts 未因等待增长；startedAt=t1 未重置。
```

## §20 Golden Scenario B — Tender（等 2 天，期间 Tender 被改）

最终提交审批等了 2 天，期间 Tender 文档被同事修改：

```text
t0    技术应答/报价/合规步骤完成      steps completed；提交步骤 → PA2（submit_tender）
                                    PA2: pending, resourceVersion=tender.updatedAt@t0（=V3）
      park                          run: awaiting_approval                       [job.waiting_human]
t0+1d 同事修改 Tender 文档            tender.updatedAt → V4（Job 之外的正常业务操作）
t0+2d Approver 批准 PA2
      resumeWorkforceJob(approval_decided):
        5 PA2 已决策 ✓ —— 但执行前先过 6：
        6 freshness: submit_tender 属外发/不可逆 → 重读 tender.updatedAt=V4 ≠ resourceVersion V3
          → STALE_RESOURCE_RESUME_POLICY = NEEDS_HUMAN（不得 SAFE_TO_CONTINUE）
          → PA2 不执行（置 failed, failureReason=source_changed；不自动重建——§13 guard）
          → 受污染范围判定（2B handoff inputRefs）：技术应答/合规依赖文档内容 → 建议 REPLAN
          → run: needs_human                                                     [job.resume_blocked{blockedBy:freshness, detail:tender changed V3→V4}]
                                                                                 [job.waiting_human(business_decision_required)]
      通知 owner："投标文件在审批期间被修改，已阻止基于旧版本提交。
                  选择：基于新版本重新生成受影响步骤（REVALIDATE/REPLAN）或取消提交。"
t0+2d' owner 答复"重新生成"（§12 机制）→ 受影响步骤回 ready → 重derive → 新 PA3（新 resourceVersion=V4）
       → 重新审批 → 提交
硬结论：**批准 ≠ 无条件执行**；resume 校验门在"人已批准"之后仍可拦截 —— 这正是 §10 规则 1 的意义。
```

## §21 Golden Scenario C — Authentication（政府门户 OTP）

```text
t0    Browser Worker Task 运行中（如投标门户上传）遇 OTP 挑战
      park: run needs_human                                                      [job.waiting_human{
        humanRequirement:{ type:"OTP_REQUIRED", challengeRef:"portal-session-7",
                           businessContextRef:"tender:td_001" }}]
      持久化的：挑战类型、会话定位符（不透明）、业务引用、时间戳
      不持久化的：OTP 码、门户密码、session cookie —— 全部只活在 worker 执行环境
t0+10min Human 在 worker 实时会话中输入 OTP（人机交接发生在执行环境）
      resumeWorkforceJob(auth_completed):
        追加 [job.human_action_completed{ challengeResolved:true, resolvedAt, resolvedBy, businessContextRef }]
        5 auth resolved ✓ → 10 requeue → 11 claim
t0+11min processor 续跑**同一 Task**（step 状态未动过，仍是该 step 的当前 attempt）
      分支 a：browser session 仍有效 → 上传继续 → step completed
      分支 b：session 已失效 → worker 报认证失败 → 再次 park（同类型 humanRequirement）
              —— 幂等等待循环，不是错误，不烧 attempts（§8B）
```

## §22 Failure / Timeout Policy（四种超时，各归其位）

| 超时 | 定义 | 现状（截至审计时） | 与 human wait 的关系 |
|---|---|---|---|
| **execution timeout** | 单 slice 执行预算 | 2A 已改 per-slice：`WORKFORCE_SLICE_BUDGET_MS=45s` + `maxRounds=6`（processor L37–39）；executor 对 workforce_job 跳过 startedAt 全局判定（Case I） | **不适用于等待**：park 后没有执行在进行 |
| **lease timeout** | 认领令牌有效期（crash 恢复窗口） | `WORKFORCE_LEASE_MS=3min` + 每轮续租 + fencing | park 时 lease=null——等待态没有租约可超时；ACTIVE_STATUSES 不含等待态，不会被回收循环误杀 |
| **human wait expiration** | 人多久不响应算过期 | PendingAction.expiresAt（默认 24h）→ 过期标 failed（缺 reconcile，§8E 修）；ApprovalRequest deadlineAt 升级 + 48h 提醒（port.ts L498–519） | 唯一作用于等待态的时钟；到期动作 = reconcile → needs_human 问人，**不是杀 Job** |
| **business SLA** | "投标 3 天内必须提交"类业务约束 | 不存在，**2C 不建**（Non-scope；deadline 可作为 §6 constraints/§9 判定输入，由 planner/人处理） | — |

硬规则：**human wait 永远不被 execution timeout 杀死**——结构上已保证（等待态无租约、无 slice、不在认领池）；2C 唯一要修的是 human wait expiration 的后置动作（§8E reconcile）。不新增 SLA 系统。

## §23 输出矩阵

| Human Scenario | Existing Qingyan Primitive | Current Status | Gap | Recommendation |
|---|---|---|---|---|
| APPROVAL_REQUIRED | PendingAction + step/run awaiting_approval + resume 链 | READY | approve 入口三线顺序依赖（竞态） | **REUSE** + 收敛单一 resume 入口（§17） |
| IRREVERSIBLE_ACTION_CONFIRMATION | 同上（riskLevel=HIGH/CRITICAL + requiresApproval） | READY | 无 | REUSE |
| APPROVAL 过期 | expireOverdueApprovals | **PARTIAL** | 标 failed 不 reconcile run → 永久卡死 | **ADAPT**（2C-1：过期→reconcile→needs_human） |
| CLARIFICATION_REQUIRED | run needs_human + job.waiting_human 事件 + errorMessage | PARTIAL | 只能 park，无"回答→恢复"contract | **ADAPT**（§12：clarification_answered 事件 + metadata 追加 + requeue） |
| BUSINESS_DECISION_REQUIRED | 同 clarification | PARTIAL | 同上 | ADAPT（同一机制） |
| AUTHENTICATION / OTP / CAPTCHA | run needs_human + 外部会话 | **MISSING/PARTIAL** | 无 humanRequirement 结构、无恢复事件、无凭据持久化边界规范 | **DESIGN ONLY**（§11；实现随浏览器 worker 产品线，2C 不做） |
| PERMISSION_CHANGED | resolveRuntimeV2Principal + executor 重鉴权 + park(attempts=0) | READY（Case H） | 无 | REUSE |
| EXTERNAL_DEPENDENCY | nextAttemptAt 定时重查列 + needs_human | PARTIAL | 列在但语义未接（park 时统一置 null） | ADAPT（可预估恢复时间 → queued+nextAttemptAt） |
| CONFLICT_REQUIRES_HUMAN | verifier NEEDS_HUMAN + reconcile 不安全路径 | READY | 无 | REUSE |
| STALE RESOURCE（暂停期间资源被改） | payloadHash（enforce）/ resourceVersion（列在，1 个生产者 0 个消费者）/ 报价晋升内容级校验样板 | **PARTIAL** | 无通用 freshness 门 | **ADAPT**（2C-2：泛化 resourceVersion 写读 + §9 policy） |
| APPROVED-BUT-STALE（审批后过久执行） | 无 | MISSING | approved→executed 无时效 | DESIGN + 最小实现（§10 两条规则，归 2C-2） |
| HUMAN EDIT | payloadHash 防篡改（使"原地改"不可能） | PARTIAL | 无 supersede 流程 | ADAPT（§14：新 action + supersedes 引用，归 2C-3） |
| REJECTED → 后续 | reconcile（拒≠执行）+ supervisor replan | PARTIAL | 无 loop guard、无出口决策规则 | ADAPT（§13，归 2C-3） |

## §24 Schema Decision

```text
PHASE_2C_SCHEMA_CHANGE = NONE
```

逐项：humanRequirement → metadata + 事件 payload（AgentRunEvent.payload 是 Json，够）；resume reason/trigger → job.* 事件（append-only 已有序列保证）；clarification Q/A → 事件 + metadata 数组追加（mergeAgentRunMetadata 已有）；resource freshness → **PendingAction.resourceVersion 列已存在**（今天就有，只是没人写没人读）+ 目标实体 updatedAt；approval freshness → decidedAt 列已有 + env 常量；resumeAt → nextAttemptAt 列已有；supersedes → payload.metadata 引用；attempts 语义 → 现列语义规范（2A 已在做）；resume 门禁审计 → job.resume_blocked 事件。**AgentRun/AgentRunStep/AgentRunVerification/PendingAction/AgentRunEvent 五表无一需要变更。** 唯一"新增"是 job.* 事件类型枚举的几个成员（types.ts 字符串常量，非 schema）。

## §25 Phase 2C Implementation Slices

| 片 | 内容 | 验收标准 | 回滚 |
|---|---|---|---|
| **2C-1 Unified Human Pause/Resume Contract** | `resumeWorkforceJob()` 单一入口（§17，approval 触发源收敛，消除三线顺序竞态）；`expireOverdueApprovals` 过期→reconcile 关联 run→needs_human（§8E）；humanRequirement 结构写入 waiting_human 事件；job.resume_blocked/clarification_answered 等事件类型 | 过期 PA 的 run 不再永久卡 awaiting；重复 resume 触发幂等（claim CAS 去重）；Case H 语义回归不破 | 新入口旁路可关；过期 reconcile 是纯增量 |
| **2C-2 Resource Freshness Revalidation** | createDraft 调用方补 resourceVersion（写侧）；resume/执行前 §9 校验门 + §10 approval freshness 两规则（读侧）；STALE policy 四出口接 verifier REPAIR/park | Scenario B 契约测试：资源变更后外发被拦、REVALIDATE 步骤正确回 ready；报价晋升现有行为不回归 | 校验门 flag 化，关闭=现状 |
| **2C-3 Clarification + Reject/Replan** | §12 回答→恢复 contract；§13 四出口决策 + rejection loop guard（幂等键记忆 + replan 约束 + 次数封顶）；§14 human edit supersede 流程 | "用方案 B"后同 Job 续跑；同一审批被拒后不自动重申请；edit 产新 action 且旧证据不可变 | 各为独立增量 |
| **2C-4 Authentication / External Human Takeover** | §11 humanRequirement(auth) + human_action_completed 恢复事件 + 凭据持久化边界（DESIGN 落为契约测试骨架，无浏览器实现） | park/resume 循环幂等；事件 payload 无敏感字段（静态断言） | 纯事件层，无业务影响 |

依赖：2C-1 是 2C-2/2C-3 的入口前置；2C-4 独立；全部不依赖 2B 的并行执行（2C 与 2B 可并行实施，共享的只有 2A 的 lease/processor 底座）。

## §26 Risk Register

| 风险 | 现状证据 | 对策 |
|---|---|---|
| stale permission resume | principal 重查已有（Case H）；executor 每轮重鉴权 | 保持；resume 门第 4/7 步双检 |
| stale business data resume | resourceVersion 列 0 消费者；PA 执行不查资源版本（除报价晋升） | 2C-2 freshness 门（fail-closed 到 NEEDS_HUMAN） |
| expired approval resume | approved→executed 无时效 | §10 两规则（资源校验优先 + 外发时间上限） |
| wrong execution principal | 审批人篡位风险 | initiatedByUserId 唯一锚点 + approvalActor 只记录（已实证）；ownership transfer 必须显式事件 |
| duplicate resume | 多触发源（审批+cron+手动）并发 | resume 1–10 幂等 + claimRunLease CAS（Case D 双 claim 实证） |
| double side effect | 恢复后重放写步骤 | PendingAction 稳定幂等键（已有）+ 2B T1 幂等短路 + fenced 写入 |
| OTP/credential leakage | 事件/metadata 是明文 Json | §11 持久化边界：凭据永不落库；契约测试静态断言 payload 字段白名单 |
| infinite approval loop | 拒绝→自动重申请 | §13 三层 guard（幂等键记忆/replan 约束/次数封顶→NEEDS_HUMAN） |
| infinite clarification loop | 回答不满足→再问→再答 | clarifications 数组长度封顶（建议 3）→ 超限 NEEDS_HUMAN 转人工接管 |
| resume after cancellation | cancel 与 resume 竞态 | resume 第 2 步 cancelled 断言优先 + fenced requeue（cancelled 不在 allowedFromStatuses） |
| resume after ownership change | owner 离职/转移期间恢复 | principal 校验对 USER_INACTIVE fail-closed；transfer 未完成前锚点不变 |
| wrong checkpoint resume | 从错误 step 续跑 | 无游标设计：ready 集合由 refreshReadySteps 从 step statuses 全量重算（Case F 实证 completed 不重跑） |
| park 期间 run 被 lease 回收误杀 | — | ACTIVE_STATUSES 不含等待态（constants.ts）+ park 置 lease=null，结构性免疫 |
| attempts 被等待烧穿 | park attempts=0 已实现（BLOCKER 2） | §8B 语义规范：attempts 只计执行尝试；随 2A 封板对齐 |

## §27 Final Recommendation

```text
PHASE_2C_DESIGN_READY = YES
```

无 BLOCKER。前置对齐项（非缺口）：2A 尚未封板，processor/lease 的最终函数签名与 attempts 语义以封板版本为准；本设计所有"截至审计时"引用在实施 2C-1 前需做一次 30 分钟的 diff 复核。

**Phase 2C 第一刀（2A 封板后）：2C-1 Unified Human Pause/Resume Contract。** 理由：(1) 它修复唯一的现存生产级缺口——过期 PendingAction 导致 run 永久卡死（审计报告 §6 缺口 1，本轮代码复核确认仍在，port.ts L493–496）；(2) 它把 approval resume 的三线顺序竞态收敛为单一入口，是 2C-2/2C-3 全部校验门的挂载点；(3) 它是纯增量：不改 PendingAction 执行语义、不改 V2 内核、不改 schema，回滚 = 关闭新入口。

---

*本文档为 Phase 2C 只读设计产物：未实现 Phase 2C、未改 Runtime V2 / AgentRun schema / PendingAction / approval execution，未实现浏览器自动化与 OTP 存储，未做 Phase 2D UI。等待评审后按 §25 切片实施。*
