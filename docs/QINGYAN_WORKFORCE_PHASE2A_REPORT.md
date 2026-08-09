# Qingyan Workforce Runtime — Phase 2A Report: Job Lifecycle Foundation

- 日期：2026-08-09
- 分支：`feature/workforce-runtime-phase2`（基于 main `ad715350` + 审计提交 `e281fe3`）
- 数据库测试环境：隔离 Neon 分支 `preview-workforce-phase2a`（测试完成后删除；**全程未触碰生产 DB**）

---

## 1. Architecture

### 1.1 Job/Task Representation（§2–4，冻结等式）

| Workforce 概念 | 落地表示 | 说明 |
|---|---|---|
| Job | root `AgentRun`（`runType="workforce_job"`，`runtimeVersion="v2"`） | 无新表、无迁移；`jobId = rootRunId = runId = run.id` |
| Task | `AgentRunStep` | 冻结复用，未改 schema |
| Agent | Worker（cron slice 进程） | 通过 lease 认领 |
| Checkpoint/Verifier | `AgentRunVerification` | 复用 V2 verifier |
| Human Intervention | `PendingAction` | 复用现有 approval 通道 |

创建入口是唯一薄 wrapper `createWorkforceJob()`（`src/lib/workforce-runtime/job.ts`）：
- 强制走 `createAgentRun()`（复用 quota governance / trace / AgentSession），**禁止直接 `db.agentRun.create()`**；
- 注入 `actor={type:"USER",id:userId,userId}`、`owner={type:"USER",id:userId}`；
- 创建后原子回写 `metadata.jobId = metadata.rootRunId = run.id`，并写 `initiatedByUserId` 锚点；
- 受 feature flag 守卫（见 §7 Production Entry），普通助手行为不变。

### 1.2 Lease Design（§8–11）

新增通用原语 `src/lib/agent-runtime/lease.ts`（`background_conversation` 行为不变，`claimAgentRun` 内部改由该原语驱动）：

- **`claimRunLease()`** — 原子 conditional `updateMany`：
  - 条件：`runType ∈ allowedRunTypes` ∧ `attempts < maxAttempts` ∧ (`queued` ∧ `nextAttemptAt ≤ now`) ∨ (`running类` ∧ `leaseExpiresAt ≤ now`)；
  - 成功写：`status=running, attempts+1, leaseExpiresAt=now+lease, nextAttemptAt=null`；
  - 并发双 claim 由 DB 原子性保证至多一个成功（Case D 实证）。
- **`renewRunLease()`** — 以当前持有的 `leaseExpiresAt` 精确值做乐观锁条件续租；旧 token 续租必然失败。
- **`fencedRunUpdate()`** — 完成/状态写入时以 `leaseExpiresAt` 精确匹配为 fence 条件；stale worker（其 token 已被新 claim 覆盖）写入 0 行。

**Fencing 结论：无需 schema 变更。** `AgentRun` 没有 `leaseOwner` 列，但 `claim` 与 `renew` 都严格单调推进 `leaseExpiresAt`（新值 = now + leaseMs > 旧值），因此 `leaseExpiresAt` 精确值本身即幺正 fencing token：A 过期 → B claim（token 变化）→ A 迟到用旧 token 做 conditional update → 0 行命中 → 写入被拒。Case E 中"旧 token 续租失败"即该机制的直接证明。**不触发 `LEASE_FENCING_REQUIRES_SCHEMA`。**

### 1.3 Resume Design（§13–14, §17–18, §12）

Durable processor `processQueuedWorkforceJobs()`（`src/lib/workforce-runtime/processor.ts`），接入现有 cron `/api/cron/agent-runs`：

```
find eligible → claimRunLease → runtimeFromRunMetadata 恢复身份
→ 重新校验 execution principal（当前 membership，非 metadata 快照）
→ bounded V2 rounds（每轮前 renewRunLease；有 slice 时间预算与轮数上限，禁止 while(true)）
→ 终态分派：
   still runnable   → queued + nextAttemptAt（交还队列）
   waiting human    → awaiting_approval / needs_human + job.waiting_human 事件
   complete         → completed + job.completed
   retryable error  → queued + backoff（attempts 递增）
   exhausted        → failed + job.failed
```

审批恢复：`resumeRuntimeV2AfterApproval` 对 `workforce_job` 不 inline 续跑，而是 reconcile 审批步骤后**重新入队**（`status=queued, nextAttemptAt=now`）并写 `job.resumed` 事件——下一个 slice 由 processor 以**原发起人**身份恢复执行。审批人只记录在 `approvalActorUserId` / 步骤留痕，绝不成为 execution principal（Case H 实证）。

Timeout 语义（§12）：`executor.ts` 中对 `runType=workforce_job` 跳过 `Date.now()-run.startedAt>timeoutMs` 全局判定；改为 processor 内 per-slice 时间预算（本次调用内 `processingStartedAt`）。`Job.startedAt` 不被 claim 重置，保留 Job 真实年龄。非 workforce 的 `runtime_v2` 旧语义不变（Case I 对照组实证）。

### 1.4 Runtime Context Restoration（§5）

新增唯一 helper `runtimeFromRunMetadata()`（`src/lib/ai/runtime-context.ts`）：从 `AgentRun` row + metadata 恢复 `AIRuntimeContext`，覆盖 orgId / workspaceId / actor / agent / owner / jobId / taskId / runId / parentRunId / rootRunId / projectId / customerId / vendorId / tenderId / orderId / threadId / sessionId / channel / traceId / source；`runId/orgId/sessionId/traceId/parentRunId` 以 DB 列优先于 metadata。

**边界（代码内 JSDoc 明示）：metadata 仅为 identity/correlation，不是授权快照。** resume 后 processor 重新走 current membership / capability / scope / tool policy / approval（复用 V2 principal 校验路径），不从 metadata 信任旧角色/权限/审批决定。

---

## 2. Files Changed（完整列表）

**新增：**

| 文件 | 内容 |
|---|---|
| `src/lib/workforce-runtime/constants.ts` | `WORKFORCE_JOB_RUN_TYPE` / 活跃状态常量（零依赖） |
| `src/lib/workforce-runtime/flags.ts` | `WORKFORCE_RUNTIME_ENABLED` + org/user/role allowlist（§25） |
| `src/lib/workforce-runtime/job.ts` | `createWorkforceJob()` 薄 wrapper（§3–4） |
| `src/lib/workforce-runtime/processor.ts` | `processWorkforceJobSlice` / `processQueuedWorkforceJobs`（§13） |
| `src/lib/workforce-runtime/index.ts` | barrel |
| `src/lib/agent-runtime/lease.ts` | `claimRunLease` / `renewRunLease` / `fencedRunUpdate`（§8–11） |
| `src/lib/workforce-runtime/__tests__/helpers.ts` | 测试守卫（NODE_ENV=test + 隔离 DB）与 fixture |
| `src/lib/workforce-runtime/__tests__/phase2a-job-identity.test.ts` | Case A/B/C |
| `src/lib/workforce-runtime/__tests__/phase2a-lease.test.ts` | Case D/E/F/G/J |
| `src/lib/workforce-runtime/__tests__/phase2a-approval-resume.test.ts` | Case H |
| `src/lib/workforce-runtime/__tests__/phase2a-timeout.test.ts` | Case I |
| `scripts/e2e-workforce-golden.ts` | §26 Golden Scenario 端到端脚本 |
| `docs/QINGYAN_WORKFORCE_PHASE2A_REPORT.md` | 本报告 |

**修改：**

| 文件 | 内容 |
|---|---|
| `src/lib/agent-runtime/queue.ts` | §6 Critical Fix：`enqueueBackgroundAgentRun` metadata merge；`claimAgentRun` 改由 lease 原语驱动（行为不变） |
| `src/lib/agent-runtime/run.ts` | §7：`mergeAgentRunMetadata` helper；`updateAgentRunStatus` 的 metadata patch 改为合并 |
| `src/lib/agent-runtime/types.ts` | §19：新增 `job.*` 生命周期事件类型 |
| `src/lib/ai/runtime-context.ts` | §5：`runtimeFromRunMetadata()` |
| `src/lib/agent-runtime-v2/executor.ts` | §12：workforce_job 跳过 startedAt 全局 timeout |
| `src/lib/agent-runtime-v2/process.ts` | §17–18：审批后 workforce_job 重新入队 + `job.resumed` |
| `src/app/api/cron/agent-runs/route.ts` | §13：cron 分流接入 `processQueuedWorkforceJobs` |
| `scripts/test-all.sh` | 注册 Phase 2A 四个测试套件 |
| `.env.example` | `WORKFORCE_RUNTIME_ENABLED` 及 allowlist 变量（默认关闭） |

未动：Prisma schema、AgentRunStep、AgentTask（LEGACY 冻结）、Planner/Executor/Verifier 内核、approval/RBAC/Tool Runtime。

---

## 3. Metadata Preservation（§6–7）

**Was AgentRun.metadata overwrite fixed? — YES**

- 原缺陷：`enqueueBackgroundAgentRun()` 以 background payload **整体替换** metadata，摧毁 actor/owner/jobId/rootRunId/traceId。
- 修复：保守合并 `{...existing, ...payload}`（不改 shape，旧 reader `isBackgroundPayload` 向后兼容，Case C2 断言仍成立）。
- 同类写点 `updateAgentRunStatus(patch.metadata)` 也改为合并（最小 helper `mergeAgentRunMetadata`，未顺手重构 legacy caller）。

**Queue 前后 correlation 对照（Case C，DB reload 实证，隔离 Neon 分支）：**

| 字段 | enqueue/claim→requeue 前 | 之后（DB reload） |
|---|---|---|
| `ownerId` / `ownerType` | UserA / USER | ✅ 不变 |
| `jobId` | run.id | ✅ 不变 |
| `rootRunId` | run.id | ✅ 不变 |
| `traceId` | tr_… | ✅ 不变 |
| `actorUserId` | UserA | ✅ 不变 |
| background payload 字段 | — | ✅ 合并在位 |

测试输出：`C1: claim→requeue 后 owner/jobId/rootRunId/traceId 全部仍在`、`C2: enqueue 后 actor/owner/jobId/rootRunId/traceId 全部仍在（§6 修复验证）`、`C2: 旧 reader isBackgroundPayload 仍成立`。

---

## 4. Identity（§3–5, Case A/B DB readback 实证）

Case A/B 共 20 项断言全过（25 项含 C）：

- `runType=workforce_job`、`runtimeVersion=v2`、初始 `status=queued`；
- `runId = rootRunId = jobId = run.id`（DB readback）；
- `actor={type:USER,id:UserA}`、`owner={type:USER,id:UserA}`、`traceId`（列+metadata 一致）、`initiatedByUserId` 全部落库；
- `job.created` / `job.queued` 事件写入 `AgentRunEvent`，correlation 含 jobId/rootRunId/owner/traceId；
- DB reload → `runtimeFromRunMetadata` → orgId/actor/owner/jobId/runId/parentRunId/rootRunId/traceId/channel/sessionId 与创建时逐字段一致（sessionId 以 DB 列为准）。

---

## 5. Lease（§8–11, Case D/E/F 测试结果）

15 项断言全过（含 G/J）：

| 场景 | 结果 |
|---|---|
| D 并发 claim：`Promise.all` 双 worker 同时 claim | ✅ 恰好一个成功（DB 原子 updateMany） |
| E 续租：持有者 renew | ✅ 成功且 T2 > T1（token 严格单调） |
| E 租约有效期内第二 worker claim | ✅ 失败（无法抢占） |
| E 旧 token 续租（fencing） | ✅ 失败（`leaseExpiresAt` 精确匹配 0 行） |
| F 模拟 crash（running + lease 过期）→ 新 worker claim | ✅ 成功，并从既有 step state 续跑（s2 继续而非重跑整 Job） |

Lease renewal（§10 Critical Fix）：processor 在**每个 V2 round 前**调用 `renewRunLease()`，Golden Scenario 事件流中可见多次 `job.lease_renewed`；slice 时间预算严格小于 lease 时长，双保险。

---

## 6. Timeout（§12, Case I）

**问：Durable Job 是否仍用 `run.startedAt` 作为单次执行 timeout？——答：NO。**

- Job `startedAt` 被人为回拨超过旧全局 timeout 后，workforce_job 不 failed、无 `external_timeout` 标记，下一步骤正常执行；
- `Job.startedAt` 未被 claim 重置（保留真实年龄，未新增 SLA）；
- per-slice 预算仍有效：零预算 slice → 交还队列（queued）且不执行新 round；
- 对照组：非 workforce 的 `runtime_v2` run 旧 `startedAt` 超时语义不变（回归保护断言通过）。

Case I 共 6 项断言全过。

---

## 7. Approval Resume（§17–18, Case H）

**Approver ≠ execution principal — 已实证。** Case H 共 12 项断言全过：

- owner=UserA 创建 Job → 执行至 `awaiting_approval`（PendingAction 草稿）；
- UserB（admin）批准 → `approvalActorUserId=UserB` 被记录；
- `initiatedByUserId` / `ownerId` 仍=UserA（审批人未篡位）；jobId/traceId 完整不变；
- workforce_job 审批后**回 durable 队列**而非 inline 以审批人身份续跑；`job.resumed` 事件记录"执行主体=UserA / 审批人=UserB"；
- resume 后 execution principal=UserA，且重新校验当前 membership（非 metadata 快照信任）；
- Job 以发起人身份续跑至 completed，owner/jobId/traceId 全程未漂移。

---

## 8. Duplicate Execution（§20–21, Case F/G）

**completed step 在 reclaim 后未重跑 — 已实证。**

- 首个 slice：plan + `s1_pipeline` 完成（attemptCount=1，completedAt 记录）；
- 人为使 lease 过期（模拟 crash）→ 新 worker reclaim 成功；
- 断言：`s1_pipeline` 的 `attemptCount` 与 `completedAt` **逐字节不变**（未被重置/重跑）；
- 续跑从下一 ready step `s2_opportunities` 推进（尊重 `AgentRunStep.status`/`operationKey`），非从头重跑整个 Job；
- Retry 上界（Case J）：重复 retryable failure → attempts 达 `maxAttempts` → `failed`，之后单个/批量 claim 均不再拾取，`job.failed` 事件写入。

---

## 9. Golden Scenario（§26）

隔离 Neon 分支 + 真实 LLM（key 仅取自模型 API 配置，未取生产 DATABASE_URL）。任务："帮我检查最近需要跟进的销售客户，整理优先顺序和下一步建议。"（种子：3 客户 + 3 逾期商机，客户**无 email** 保证零外发）。

结果 **PASS**：

- 完整生命周期事件链：`job.created → job.queued → job.claimed → job.lease_renewed(×N) → job.waiting_human → job.resumed → job.claimed → … → job.completed`；
- 审批两轮（calendar.create_event ×3、sales.update_followup ×2）均由 UserB(admin) 批准，Job 始终以 UserA 身份执行；
- 7/8 步骤 completed，`s8_gmail_drafts` 因客户无 email 未真实执行（**零外发**断言通过）；
- Verification `verdict=PASS`；Final Report 产出客户优先级评分与建议；
- 终局断言全过：终态 completed / 身份不漂移 / 审批人已记录且≠执行主体 / 生命周期事件齐全 / 零外发。

---

## 10. Regression（§23，全部在隔离 Neon 分支 / 本地）

| 套件 | 结果 |
|---|---|
| Runtime 1.1 `runtime-context.test.ts` | ✅ 28/28 |
| Runtime 1.1 `phase1-1-context-propagation.test.ts` | ✅ 24/24 |
| AR2 `durable-state.test.ts` | ✅ 11/11 |
| AR2 `golden-flow.test.ts` | ✅ 14/14 |
| AR2 `verifier-security.test.ts` | ✅ 15/15 |
| AR2 `planner.test.ts` | ✅ 17/17 |
| AR2 `preview-gate-p0.test.ts` | ✅ 30/30 |
| pre-execute-guard | ✅ 33/33 |
| agent-scope | ✅ 24/24 |
| Phase3A-3 Approvals RBAC / Smoke | ✅ 34/34 + 28/28 |
| Phase3A-4 Governance | ✅ 13/13 |
| Inline Approval Model | ✅ 13/13 |
| PA-Run Integration | ✅ 10/10 |
| 技能/营销 PendingAction 桥 | ✅ 20/20 + 13/13 |
| Supervisor approval-resume / summary-pending | ✅ 10/10 + 3/3 |
| 产品内容审批策略 | ✅ 5/5 |
| **Phase 2A Case A–J** | ✅ 25 + 15 + 6 + 12 = **58/58** |
| `npx tsc --noEmit` | ✅ 0 错误 |
| `npx eslint`（全部改动文件） | ✅ 0 错误 |
| `npm run build` | ✅ 成功 |

`background_conversation` 行为不变（`claimAgentRun` 语义等价重构 + durable-state/golden-flow 回归通过）。

---

## 11. Migration

**NO DATABASE MIGRATION。** Lease fencing 用 `leaseExpiresAt` 严格单调 + 精确匹配条件更新在现有 schema 上安全实现，未触发 `LEASE_FENCING_REQUIRES_SCHEMA`。

---

## 12. Production Entry（§25）

- `WORKFORCE_RUNTIME_ENABLED`（默认关闭）+ `WORKFORCE_RUNTIME_ALLOWED_ORG_IDS` / `..._USER_IDS` / `..._ROLES` allowlist；
- flag 开启但**零 allowlist 配置时视为关闭**（fail-closed）；
- 不自动路由用户任务到 workforce_job，普通助手行为不变。

---

## PHASE_2A_STATUS = READY_FOR_REVIEW

无 blocker。Non-scope（§27）项目均未实现。Phase 2B 未启动。

---

# Final Durable Semantics Micro-Fix（2026-08-09，评审后追加）

评审判定总体架构通过，要求修复两个 BLOCKER。均已修复并实证，无迁移。

## BLOCKER 1 — Fencing 覆盖真正的 Runtime V2 state writes

新增可选 `RunFence`（`src/lib/agent-runtime/lease.ts`）：
- `fence.guard(write)`：同一 DB 事务内先对 AgentRun 行做 `WHERE id AND leaseExpiresAt = token` 的条件 no-op 更新（取得行锁 + 断言 token），再执行实际写入；token 已被新 worker 覆盖 → `LostLeaseError`，写入不发生。与并发 claim 之间由 Postgres 行锁串行化，**不存在 check 通过但写入落在新 worker 之后的窗口**。
- `fence.check()`：长 await 后的轻量先行探测（最终写入仍必须走 guard）。
- `fenceGuardedWrite(fence?, write)`：fence 未传时直接写库——**legacy runtime_v2 行为完全不变**；workforce_job 由 processor 强制传入。

覆盖点（全部经防栅栏，fence 丢失即返回/抛出 `LOST_LEASE` 且零写入）：
- `executeRuntimeV2Round`：`executeRuntimeV2Tool`（潜在长 await）返回后先 `fence.check()`，随后 step 完成/失败/awaiting、run executing/needs_human/awaiting_approval、approval transition（fenced 等价 `markAgentRunAwaitingApproval`）等全部写入走 guard；新增返回值 `{status:"lost_lease"}`。
- `verifyRuntimeV2Run`：model call（LLM 长 await）后 `fence.check()`；AgentRunVerification 落库、completed/awaiting_approval/repairing/needs_human 全部终态转换、repair 的步骤重置均走 guard。
- `refreshReadySteps`：pending→ready 提升同样 fenced（stale worker 对 AgentRunStep **零写入**）。
- `processAgentRuntimeV2Run`：fence 透传 + `LostLeaseError` → `lost_lease`。
- processor：planner 后以原子续租作 fence 断言再 persist（persist 自持事务，不嵌套 guard 避免行锁死锁）；completion/failure/waiting/continuation 的 `fencedRunUpdate` 全部检查结果，失败即 `lostLease` 返回且跳过事件写入。
- **BLOCKER 1.6 已修**：missing-goal 分支改为单次 fenced 终态写入并检查结果——fence 丢失直接 LOST_LEASE，**不再调用 unfenced `failAgentRun`**（processor 已不引用 failAgentRun）。

### Test K — Stale Worker After Long Tool（17/17 通过）

确定性 race：A claim（T1，极短租约模拟长 tool await 中过期）→ B reclaim（T2）→ A "tool 返回"：
- A 无法 complete step / fail step（`fence.guard` → LOST_LEASE）；
- A 无法 set run completed / failed（`fencedRunUpdate` 0 rows）；
- A 无法续租；A 带 stale fence 走完整 V2 round → `lost_lease` 且 run/step 状态、token 全部未被覆盖（对 AgentRunStep 零写入）；
- B 用 T2 正常续租、正常执行 fenced V2 round（s2 completed、attemptCount=1）、正常交还队列。

**STALE_WORKER_WRITE_BLOCKED = YES**

## BLOCKER 2 — attempts = consecutive retry/crash/recovery budget

语义修正（零迁移）：取得有效进展的转换在同一 fenced 写入中 `attempts: 0`：
- 正常 continuation requeue（时间片/轮次用尽交还队列）；
- waiting human park（awaiting_approval / needs_human / clarification / principal 失效）；
- 审批恢复重新入队（`resumeRuntimeV2AfterApproval`）。

继续累计（不重置）：crash reclaim（claim 时 attempts+1，未到进展点即无重置）、catch 路径的 retryable execution failure、重复 worker timeout/crash。耗尽语义不变：连续失败达 `WORKFORCE_MAX_ATTEMPTS` → failed 且不再被 claim。

### Test L — More Than Max Normal Slices（9/9 通过）

- 合法 Job 以 maxRounds=0 连续推进 8 个正常 continuation slice（> maxAttempts=5）：全部成功交还队列、每次 attempts 归零、不 failed、仍可被 claim、真实步骤照常推进；
- 连续 retryable failure：attempts 严格递增 1→5 → failed → 不再被 claim、批量消费不再拾取。

**NORMAL_CONTINUATION_DOES_NOT_EXHAUST_RETRY_BUDGET = YES**

## OPTIONAL P1 — Feature Flag 结论

**`WORKFORCE_FLAG_IS_CREATION_GATE_ONLY`**：`WORKFORCE_RUNTIME_ENABLED=false` 只挡 `createWorkforceJob` 入口；cron 的 `processQueuedWorkforceJobs` 无条件消费已 queued 的 workforce_job。若需 global kill switch，最小改动是在 `processQueuedWorkforceJobs` 开头检查 `isWorkforceRuntimeEnabledWithEnv`（约 3 行）；未经确认不实施。

## Final 回归（隔离 Neon 分支 `preview-workforce-phase2a-final`，用后删除）

- Case A–J 重跑：58/58；Case K：17/17；Case L：9/9 → **A–L 合计 84/84**
- Runtime 1.1（28+24）、AR2 五套（11+14+15+17+30）、approvals/guard/governance 全套、background_conversation（durable-state/golden-flow 覆盖）全部通过
- `tsc --noEmit` 0 错、`eslint` 0 错、`npm run build` 成功
- **NO DATABASE MIGRATION**（fencing 仍基于 leaseExpiresAt token + 行锁事务，无 schema 变更）

## PHASE_2A_STATUS（Final）= READY_FOR_MERGE（保持 Draft，等待人工评审）
