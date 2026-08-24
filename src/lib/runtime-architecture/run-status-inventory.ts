/**
 * QYANE_RUNTIME_CONVERGENCE_T3_5 — R1 AgentRun status inventory (§11)
 * + proposed R2 transition matrix (§12, DESIGN ONLY).
 *
 * R0 found ≥15 live status strings written by 5 modules onto the free-form
 * AgentRun.status column, with no transition matrix. R1 does NOT refactor
 * transitions and does NOT alter DB values — this file is the canonical
 * inventory consumed by the guard test, which fails when either declared
 * vocabulary (legacy union or Runtime V2 union) gains a value that is not
 * inventoried here. Adding a status is an architecture decision.
 */

export type RunStatusClassification =
  | "legacy" // declared only in agent-runtime/types.ts AgentRunStatus
  | "canonical_v2" // declared only in agent-runtime-v2/schemas.ts RuntimeV2RunStatus
  | "shared" // declared in both unions
  | "phantom_reader_only"; // read somewhere, written nowhere (R0)

export interface RunStatusInventoryEntry {
  status: string;
  classification: RunStatusClassification;
  /** Modules that WRITE this value today (R0 audit, file-level evidence in the R0 docs). */
  writers: string[];
  /** Who owns the semantic today. */
  ownerModule: string;
  /** Where the convergence work lands. */
  migrationOwner: "R2-C1";
  notes?: string;
}

export const RUN_STATUS_INVENTORY: readonly RunStatusInventoryEntry[] = [
  { status: "queued", classification: "shared", writers: ["agent-runtime(run.ts create/queue)", "workforce-runtime(processor/job/resume)"], ownerModule: "agent-runtime", migrationOwner: "R2-C1" },
  { status: "acknowledged", classification: "legacy", writers: ["agent-runtime(ack.ts)"], ownerModule: "agent-runtime(legacy WeChat)", migrationOwner: "R2-C1", notes: "Candidate for retirement in R2 vocabulary unification." },
  { status: "planning", classification: "shared", writers: ["agent-runtime(process.ts)", "agent-runtime-v2(process.ts)", "agent-supervisor(engine.ts)", "assistant(dispatch.ts)"], ownerModule: "split", migrationOwner: "R2-C1" },
  { status: "planned", classification: "canonical_v2", writers: ["agent-runtime-v2(persist.ts)"], ownerModule: "agent-runtime-v2", migrationOwner: "R2-C1" },
  { status: "running", classification: "legacy", writers: ["agent-runtime(lease.ts claim, process.ts)", "messaging(gateway.ts)", "agent-supervisor(engine.ts)", "assistant(dispatch.ts)"], ownerModule: "agent-runtime", migrationOwner: "R2-C1", notes: "Declared only in the legacy union, yet claimRunLease writes it onto workforce_job (v2) runs too — vocabulary unification target R2-C1." },
  { status: "executing", classification: "canonical_v2", writers: ["agent-runtime-v2(executor/verifier/process)"], ownerModule: "agent-runtime-v2", migrationOwner: "R2-C1" },
  { status: "verifying", classification: "canonical_v2", writers: ["agent-runtime-v2(verifier.ts)"], ownerModule: "agent-runtime-v2", migrationOwner: "R2-C1" },
  { status: "repairing", classification: "canonical_v2", writers: ["agent-runtime-v2(verifier.ts, transient — overwritten in the same call)"], ownerModule: "agent-runtime-v2", migrationOwner: "R2-C1", notes: "Never durable today." },
  { status: "awaiting_approval", classification: "shared", writers: ["agent-runtime(pending-link.ts)", "agent-runtime-v2(executor/verifier/process)", "agent-supervisor(engine/persist)", "assistant(dispatch/reconcile-run)"], ownerModule: "split", migrationOwner: "R2-C1" },
  { status: "needs_human", classification: "canonical_v2", writers: ["agent-runtime-v2(executor/verifier/process)", "workforce-runtime(processor/resume)"], ownerModule: "agent-runtime-v2 + workforce-runtime", migrationOwner: "R2-C1" },
  { status: "partially_executed", classification: "canonical_v2", writers: ["agent-runtime-v2(process.ts — immediately overwritten; never durable)"], ownerModule: "agent-runtime-v2", migrationOwner: "R2-C1", notes: "R2 design: retire (fold into needs_human)." },
  { status: "completed", classification: "shared", writers: ["agent-runtime(run.ts completeAgentRun)", "agent-runtime-v2(verifier.ts direct)", "assistant(reconcile-run.ts direct)"], ownerModule: "agent-runtime (terminal contract)", migrationOwner: "R2-C1", notes: "Direct terminal writes outside run.ts skip the run_terminal outbox notice — unify in R2-C1." },
  { status: "failed", classification: "shared", writers: ["agent-runtime(run.ts failAgentRun, queue.ts sweep — no event)", "agent-runtime-v2(executor/verifier)", "workforce-runtime(processor/job/resume)", "assistant(dispatch/reconcile-run)"], ownerModule: "agent-runtime (terminal contract)", migrationOwner: "R2-C1" },
  { status: "cancelled", classification: "shared", writers: ["agent-runtime(run.ts cancelAgentRun)", "api/agent-supervisor/runs/[id] (via cancelAgentRun)"], ownerModule: "agent-runtime", migrationOwner: "R2-C1" },
  // Phantom values: readers exist, no writer found (R0). Kept visible so the
  // readers get cleaned up (or writers declared) in R2-C1.
  { status: "claimed", classification: "phantom_reader_only", writers: [], ownerModule: "capabilities/governance readers", migrationOwner: "R2-C1" },
  { status: "succeeded", classification: "phantom_reader_only", writers: [], ownerModule: "capabilities/runs/list.ts reader", migrationOwner: "R2-C1" },
  { status: "timed_out", classification: "phantom_reader_only", writers: [], ownerModule: "capabilities/runs/list.ts reader", migrationOwner: "R2-C1" },
  { status: "partial", classification: "phantom_reader_only", writers: [], ownerModule: "capabilities/runs/list.ts reader", migrationOwner: "R2-C1" },
  { status: "waiting_for_approval", classification: "phantom_reader_only", writers: [], ownerModule: "assistant/run-status-types.ts reader (actually a SupervisorState value, not an AgentRun.status)", migrationOwner: "R2-C1" },
] as const;

export const RUN_STATUS_INVENTORY_VALUES: readonly string[] =
  RUN_STATUS_INVENTORY.map((e) => e.status);

/**
 * §12 — PROPOSED R2 transition matrix. DESIGN ONLY:
 * NOT enforced anywhere in R1; production transitions are unchanged.
 * "Current reality" is the writers table above (effectively unconstrained —
 * the only guards today are: updateAgentRunStatus refusing to leave
 * cancelled|completed, the fenced workforce writes, and terminal-helper
 * idempotency). The matrix below is the R2-C1 target for the unified
 * transitionAgentRun() helper.
 */
export const PROPOSED_R2_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  queued: ["planning", "running", "executing", "cancelled", "failed"],
  acknowledged: ["planning", "running", "cancelled"], // retire with legacy lane
  planning: ["planned", "running", "executing", "awaiting_approval", "needs_human", "failed", "cancelled"],
  planned: ["executing", "cancelled", "failed"],
  running: ["completed", "failed", "cancelled", "awaiting_approval", "queued"],
  executing: ["awaiting_approval", "verifying", "needs_human", "failed", "cancelled", "queued"], // queued = yield/continuation requeue
  verifying: ["completed", "repairing", "awaiting_approval", "needs_human", "failed"],
  repairing: ["executing"],
  awaiting_approval: ["executing", "running", "needs_human", "completed", "failed", "cancelled"],
  needs_human: ["queued", "cancelled", "failed"],
  completed: [], // terminal
  failed: [], // terminal; explicit retry re-enters via a NEW run or an explicit retry helper, never a silent resurrect
  cancelled: [], // terminal
  // partially_executed intentionally absent: R2 design retires it.
};
