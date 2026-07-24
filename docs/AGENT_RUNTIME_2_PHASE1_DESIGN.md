# Agent Runtime 2.0 — Phase AR2-1 Design

**Branch:** `feature/agent-runtime-2-phase1`  
**Base:** `agent/digital-employees-phase1-activation` (PR #19, Draft, not yet merged into `main`)  
**Date:** 2026-07-24  

## 1. Goal

Deliver a durable Agent Runtime that can:

**Understand goal → Plan → Call tools → Pause for approval → Resume → Verify → Repair → Deliver**

Phase 1 ships one production-grade golden scenario (sales follow-up triage) to prove the runtime is generic, not a hard-coded service.

## 2. Audit summary (what exists)

| System | Path | Reuse? |
|--------|------|--------|
| AgentRun / AgentRunEvent / AgentSession | `prisma` + `src/lib/agent-runtime` | **Yes** — primary run identity |
| Queue claim / lease / retry | `agent-runtime/queue.ts` + cron | **Yes** — drive `processAgentRuntimeV2Run` |
| PendingAction + ApprovalPort | `pending-actions/*`, `approval/port.ts` | **Yes** — all writes |
| Pause / resume / reconcile | `pending-link.ts`, `assistant/reconcile-*` | **Yes** — extend for V2 steps |
| ToolRegistry + canInvokeTool | `agent-core/tool-registry.ts`, `tenancy/tool-auth.ts` | **Yes** — only tool path |
| Capability Quota + AI Usage Ledger | `capabilities/governance/*`, `usage/record.ts` | **Yes** |
| Supervisor plan JSON | `agent-supervisor/*` | **Do not force-enable**; V2 is independent flag |
| AgentTask / AgentTaskStep | Old orchestration | **Do not reuse** as V2 steps (no FK to AgentRun) |
| Graders | `ai-grader/*` | Wrap as analysis tools/skills |
| Digital employee flags | `digital-employees/activation.ts` | Parallel; do not nest V2 under them |
| Assistant Workbench UI | `assistant-task-card`, run-status | Extend for plan/steps/verifier |

### Gaps requiring new structure

1. **No first-class step table** — only Event stream + `supervisorState` JSON. Cannot safely resume after serverless restart with dependency graph.
2. **No verification / repair protocol** on AgentRun.
3. **No independent `AGENT_RUNTIME_V2_*` routing** — must not force Supervisor on.

## 3. Reuse vs add

### Reuse

- `AgentRun` as the durable run root (`orgId` + `id`)
- `AgentRunEvent` for timeline / audit events
- Queue worker pattern to call `processAgentRuntimeV2Run(runId)` between steps
- PendingAction for all business writes
- ToolRegistry.execute for every tool call
- Quota reserve / settle + usage ledger for planner / tools / verifier model calls

### Add (minimal)

| Addition | Why |
|----------|-----|
| `AgentRun.planJson` | Persist planner output without overloading `supervisorState` |
| `AgentRun.runtimeVersion` | Distinguish v1 vs v2 runs (`"v2"`) |
| Extended `AgentRun.status` strings | `planned`, `executing`, `verifying`, `repairing`, `partially_executed`, `needs_human` |
| `AgentRunStep` | Durable task graph with dependsOn, attempts, evidence |
| `AgentRunVerification` | Verifier verdict history + repair loop count |
| `src/lib/agent-runtime-v2/*` | Planner, executor, verifier, flags, schemas, golden workflow |
| Feature flags `AGENT_RUNTIME_V2_*` | Independent gray rollout |

### Why not only existing structures

- `supervisorState.plan` is Supervisor-specific and lacks DB-level step status / idempotency.
- `AgentTaskStep` is a parallel legacy stack without `AgentRun` FK.
- Events alone cannot enforce `dependsOn` or step-level `attemptCount` uniqueness.

## 4. Status machines

### AgentRun (V2)

```text
queued → planning → planned → executing
  ↔ awaiting_approval
  → verifying ↔ repairing (≤ maxRepairs)
  → completed | partially_executed | needs_human | failed | cancelled
```

Legacy statuses (`running`, `acknowledged`) remain valid for v1 runs.

### AgentRunStep

```text
pending → ready → running
  → awaiting_approval → completed | failed | blocked | skipped
```

## 5. Schemas (Zod)

Defined in `src/lib/agent-runtime-v2/schemas.ts`:

- **PlannerOutput** — objective, assumptions, missingInformation, completionCriteria, steps (max 8)
- **StepRecord** — runtime step fields
- **VerifierOutput** — `PASS | REPAIR | NEEDS_HUMAN | BLOCKED`

Planner must only reference tools from the provided ToolRegistry descriptors.

## 6. Approval pause / resume

```text
Executor detects write / requiresApproval
→ create PendingAction (agentRunId set, stepKey in payload metadata)
→ Step = awaiting_approval, Run = awaiting_approval
→ emit approval.required
→ user confirms via existing ApprovalPort
→ PendingAction executor runs (idempotent)
→ reconcileV2AfterPendingAction
→ Step completed / failed / skipped
→ enqueue next processAgentRuntimeV2Run(runId)
```

Rules: no business write before confirm; reject = no write; re-check `canInvokeTool` after approval; permission change → `needs_human`.

## 7. Idempotency

- Run create: reuse by `(orgId, userMessageId)` when present
- Step tool call: `idempotencyKey = ar2:${runId}:${stepKey}:${attempt}`
- PendingAction: existing decision idempotency table
- Step unique: `@@unique([runId, stepKey])`
- Verification unique sequence: `@@unique([runId, attempt])`

## 8. Limits (env-overridable)

| Env | Default |
|-----|---------|
| `AGENT_RUNTIME_V2_MAX_STEPS` | 8 |
| `AGENT_RUNTIME_V2_MAX_TOOL_CALLS` | 12 |
| `AGENT_RUNTIME_V2_MAX_REPAIRS` | 2 |
| `AGENT_RUNTIME_V2_MAX_ATTEMPTS_PER_STEP` | 2 |
| `AGENT_RUNTIME_V2_TIMEOUT_MS` | 180000 |
| `AGENT_RUNTIME_V2_PARALLELISM` | 1 |

## 9. Tenant isolation

- Every query: `where: { id, orgId }`
- Tools: `canInvokeTool` + membership required (platform admin alone insufficient)
- Verifier rejects cross-org evidence
- Preview allowlist: Sunny org + Lucas user only

## 10. Quota & cost

- Planner / verifier model calls → `recordAiUsage` with purpose `ar2_planner` / `ar2_verifier`
- Tool high-risk → existing `DAILY_HIGH_RISK_TOOL_CALLS` reservation
- Run creation → existing `DAILY_AGENT_RUNS` path when creating AgentRun

## 11. Feature flags

```env
AGENT_RUNTIME_V2_ENABLED=0
AGENT_RUNTIME_V2_ORG_ALLOWLIST=
AGENT_RUNTIME_V2_USER_ALLOWLIST=
AGENT_RUNTIME_V2_ROLE_ALLOWLIST=
# limits...
```

Order: master → org → user → role → else legacy.  
Preview: ENABLED=1, ORG=Sunny, USER=Lucas. **No Production changes in this PR.**

## 12. Phase 1 scope

**In:** Planner, durable steps, executor, PA pause/resume, verifier + ≤2 repairs, sales follow-up golden flow, workbench display, flags, tests.

**Out (later phases):** Quote/Project full migration, parallel research agents, Obsidian memory, outcome monitor, employee learning, browser/sandbox, multi-agent chat, mass parallelism.

## 13. Golden scenario

User: 「帮我把最近的销售跟进处理一下。」

Must go through Planner → tools (pipeline, interactions, quotes, graders) → prioritize ≤3 customers → PendingActions (tasks / followup dates / Gmail drafts) → await approval → resume → verify DB artifacts → completion report. Not a single hard-coded service function.

## 14. Conflict note (PR #19)

PR #19 is **not merged** into `main`. This work is stacked on `agent/digital-employees-phase1-activation`. After #19 merges: rebase onto `main`, retarget Draft PR base to `main`, re-run full tests.

## 15. Migration & rollback (Preview Gate)

- Forward migrations only. **Do not edit** already-applied migration files (checksum drift).
- Shared Neon used by this repo's local/`DATABASE_URL` is the **shared non-Production** project (`ep-super-field-antfibsl*`). Confirm host before any deploy. **Never** treat it as safe to reset.
- Rollback policy:
  1. Prefer a **forward-fix** migration that undoes the change safely.
  2. **Forbidden** on shared or Production DB: manually deleting rows from `_prisma_migrations`.
  3. `prisma migrate reset` / wipe is allowed **only** on disposable isolated databases.
- Read-only verification: `npx tsx scripts/verify-agent-runtime-v2-migration.ts`

## 16. Preview Gate P0 invariants

1. Resume execution principal = `metadata.initiatedByUserId` (never approval actor).
2. Multi-PendingAction reconcile requires `found.length === expected.length`; no `anyExecuted → completed`.
3. Business idempotency: `ar2:{runId}:{stepKey}:{actionType}:{targetId}` via `PendingAction.idempotencyKey`.
4. Grader fallback only for MODEL_TIMEOUT / PROVIDER_UNAVAILABLE / FEATURE_NOT_CONFIGURED; PARTIAL evidence cannot PASS verification.
5. Prioritization must consume `s3_followup_analysis` + `s4_quote_risk` with explainable scores.
