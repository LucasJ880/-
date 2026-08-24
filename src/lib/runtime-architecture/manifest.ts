/**
 * QYANE_RUNTIME_CONVERGENCE_T3_5 — R1 Runtime Architecture Manifest
 *
 * Governance metadata ONLY — nothing here is runtime behavior.
 * This file encodes the R0/R1 architecture decisions (see
 * docs/QINGYAN_RUNTIME_CONVERGENCE_T3_5_TARGET_ARCHITECTURE.md and
 * docs/QINGYAN_RUNTIME_CONVERGENCE_T3_5_R1_BOUNDARY_FREEZE.md) in a
 * machine-readable form consumed by the runtime-architecture guard tests
 * (npm run test:runtime-architecture) and by documentation.
 *
 * Changing an entry here is an ARCHITECTURE DECISION and must be reviewed
 * as such (it changes what CI allows), never a drive-by edit.
 */

export type RuntimeArchitectureStatus =
  | "canonical"
  | "substrate"
  | "higher_level"
  | "legacy_active"
  | "frozen";

export type RuntimeArchitectureArea =
  | "agent-core"
  | "agent-runtime"
  | "agent-runtime-v2"
  | "workforce-runtime"
  | "autopilot"
  | "agent-supervisor"
  | "agent-task-legacy"
  | "approval"
  | "tool-policy"
  | "runtime-events"
  | "corporate-memory"
  | "project-ledger";

/** Change classes allowed inside a frozen / legacy_active area. */
export type AllowedFrozenChange =
  | "bugfix"
  | "security_fix"
  | "compatibility_fix"
  | "migration_instrumentation"
  | "deprecation_marker";

export interface RuntimeArchitectureEntry {
  area: RuntimeArchitectureArea;
  /** Repo paths (dir prefixes or files) this entry governs. */
  paths: string[];
  /** What the area actually is today (R0 audited). */
  currentRole: string;
  /** What the area must become (T3.5 target). */
  targetRole: string;
  status: RuntimeArchitectureStatus;
  newFeaturesAllowed: boolean;
  /**
   * Where NEW work must go instead, when this area is frozen/legacy.
   * Required for status "frozen" | "legacy_active".
   */
  canonicalReplacement?: string;
  /** Only meaningful for frozen/legacy areas. */
  allowedChanges?: AllowedFrozenChange[];
  notes?: string;
}

export const RUNTIME_ARCHITECTURE_MANIFEST: readonly RuntimeArchitectureEntry[] = [
  {
    area: "agent-core",
    paths: ["src/lib/agent-core"],
    currentRole:
      "Only LLM function-calling loop (runAgent/runAgentStream) + most complete tool policy chain (registry → guards → canInvokeTool → approval-gate → quota) + skills runtime; also hosts the frozen legacy flow-runner (see agent-task-legacy).",
    targetRole:
      "Canonical LLM/tool execution loop with ONE exposure/execution policy pair; stream folded into one loop (R2).",
    status: "canonical",
    newFeaturesAllowed: true,
    notes:
      "NARROW_ONLY: no new planners/orchestrators/catalogs inside; skills/flow-runner.ts belongs to the frozen agent-task-legacy surface.",
  },
  {
    area: "agent-runtime",
    paths: ["src/lib/agent-runtime"],
    currentRole:
      "Runtime substrate (run.ts Run+Event lock protocol, lease.ts fencing, session, observe, trace, pending-link) PLUS the legacy WeChat/WeCom conversation orchestrator (process/plan/queue/context/dispatch/ack/deterministic/session-memory/workbench-link).",
    targetRole:
      "Substrate only: Session / Run / Queue / Lease / Fence / shared persistence primitives with ONE status machine and ONE event envelope (R2-C1/C2). Legacy orchestrator group frozen in place until migrated.",
    status: "substrate",
    newFeaturesAllowed: true,
    canonicalReplacement:
      "For conversation orchestration: agent-runtime-v2 (durable) / assistant dispatch (web); the legacy group accepts bugfixes only.",
    allowedChanges: [
      "bugfix",
      "security_fix",
      "compatibility_fix",
      "migration_instrumentation",
      "deprecation_marker",
    ],
    notes:
      "File additions to this directory are baseline-gated (guarded dir census): substrate additions (e.g. R2 event-contract.ts) are expected but must be intentional.",
  },
  {
    area: "agent-runtime-v2",
    paths: ["src/lib/agent-runtime-v2"],
    currentRole:
      "Sole step-graph orchestrator (only writer of AgentRunStep / AgentRunVerification); durable only when driven by workforce-runtime; carries workforce batch code and sales business logic; imports execution policy from workforce-runtime (KNOWN INVERSION).",
    targetRole:
      "Sole canonical durable step-graph orchestrator: Plan / Step / Execute / Verify / Resume. Workforce mechanics move up, execution policy moves down (R2-C3/C5).",
    status: "canonical",
    newFeaturesAllowed: true,
    notes:
      "NARROW_ONLY. The agent-runtime-v2 → workforce-runtime import edge set is frozen shrink-only (see importEdges baseline); new inverse imports fail CI.",
  },
  {
    area: "workforce-runtime",
    paths: ["src/lib/workforce-runtime"],
    currentRole:
      "Durable scheduler/lifecycle above Runtime V2 (claim lease → drive V2 one round → yield/park/resume). Currently also owns the general execution-policy resolver used by ALL V2 runs (KNOWN INVERSION, moves down in R2-C3).",
    targetRole:
      "Scheduler / worker execution layer above Runtime V2 only: queue policy, worker identity, retry/backoff, heartbeat, handoff/parallel coordination, budgets, read model.",
    status: "higher_level",
    newFeaturesAllowed: true,
    notes: "NARROW_ONLY; must never execute tools/models directly.",
  },
  {
    area: "autopilot",
    paths: ["src/lib/autopilot"],
    currentRole:
      "Evaluation / evidence / judge / recovery-policy layer. Verified in R0: does not start/resume/retry runs, writes no PendingAction/AgentRunStep.",
    targetRole:
      "Evaluation layer only. Any future recovery proposes read/search/verify actions that execute THROUGH runtime/workforce under normal policy + approval. NOT an executor runtime.",
    status: "higher_level",
    newFeaturesAllowed: true,
    notes:
      "Forbidden import directions guarded (autopilot must not import execution engines). Canonical-table writes (human signals) are a documented thin spot to be moved behind a substrate API in R2.",
  },
  {
    area: "agent-supervisor",
    paths: ["src/lib/agent-supervisor", "src/app/api/agent-supervisor"],
    currentRole:
      "Dormant parallel orchestrator (flag default OFF, no UI callers); duplicates V2 planner/validator/approval-resume in a weaker, non-durable form (state = AgentRun.supervisorState blob).",
    targetRole: "Frozen legacy-active compatibility surface until DB evidence permits retirement (R6).",
    status: "frozen",
    newFeaturesAllowed: false,
    canonicalReplacement: "agent-runtime-v2",
    allowedChanges: [
      "bugfix",
      "security_fix",
      "compatibility_fix",
      "migration_instrumentation",
      "deprecation_marker",
    ],
  },
  {
    area: "agent-task-legacy",
    paths: [
      "src/lib/agent",
      "src/lib/agent-tasks",
      "src/lib/agent-core/skills/flow-runner.ts",
      "src/lib/runtime",
      "src/app/api/agent/tasks",
    ],
    currentRole:
      "Legacy second orchestrator: AgentTask/AgentTaskStep/ApprovalRequest models executed by flow-runner via static skills (no runAgent, no ToolRegistry, no canInvokeTool); unflagged, cron-scheduled (/api/cron/inspect); src/lib/runtime is the deprecated 4th runtime (0 importers).",
    targetRole:
      "Frozen legacy-active compatibility surface; flows migrate onto AgentRun-based execution in R6, then the stack retires.",
    status: "frozen",
    newFeaturesAllowed: false,
    canonicalReplacement: "agent-runtime-v2 (+ approval/port for approvals)",
    allowedChanges: [
      "bugfix",
      "security_fix",
      "compatibility_fix",
      "migration_instrumentation",
      "deprecation_marker",
    ],
  },
  {
    area: "approval",
    paths: ["src/lib/approval", "src/lib/pending-actions"],
    currentRole:
      "ApprovalPort unifies decision/expiry over PendingAction + ApprovalRequest; creation is fragmented across 11 sites; 6 resume mechanisms; 5 lifecycle bypasses (all baselined).",
    targetRole:
      "Canonical logical approval boundary for NEW development: requestApproval (creation, R1) + decide + expire + (R2) canDecide hook, decision idempotency, resume registry. Storage models stay separate.",
    status: "canonical",
    newFeaturesAllowed: true,
    notes:
      "NEW code must create approvals via approval/port requestApproval; direct table writes and creation-helper imports outside the baseline fail CI (NEW_APPROVAL_BYPASS_FORBIDDEN).",
  },
  {
    area: "tool-policy",
    paths: [
      "src/lib/agent-core/tool-registry.ts",
      "src/lib/agent-core/tools/_policy.ts",
      "src/lib/tenancy/tool-auth.ts",
      "src/lib/agent-runtime-v2/tool-catalog.ts",
      "src/lib/runtime-architecture/risk.ts",
      "src/lib/runtime-architecture/tool-descriptor.ts",
    ],
    currentRole:
      "9 catalogs/allowlists, 4 execution boundaries, 6 risk vocabularies (R0). canInvokeTool is the only shared primitive.",
    targetRole:
      "ONE canonical descriptor metadata shape (CanonicalToolDescriptor) + ONE canonical risk vocabulary now (R1, metadata-only); ONE physical exposure/execution pair later (R2-C3/C4). No new general-purpose tool registries.",
    status: "canonical",
    newFeaturesAllowed: true,
    notes:
      "New domain tools register descriptors+handlers into EXISTING catalogs (tender-workforce pattern). A 10th general-purpose registry fails CI (NEW_TOOL_REGISTRY_SURFACE_FORBIDDEN). DB-backed ToolRegistry builtin surface (conversation adapter echo/calculator/kb_lookup) is frozen: no new builtins, no risk columns.",
  },
  {
    area: "runtime-events",
    paths: ["src/lib/agent-runtime/types.ts", "src/lib/agent-runtime/run.ts"],
    currentRole:
      "One physical writer (appendAgentRunEvent[InTx]) + one typed union (AgentRunEventType) + enforced autopilot mapping; supervisor erases 9 supervisor.* types to planning.completed (baselined exception); no payload envelope yet.",
    targetRole:
      "ONE normalized runtime event contract (registry + envelope) in R2-C2 — WITHOUT new tables. Project Ledger events / Corporate Memory / AuditLog remain separate planes and are never merged into runtime events.",
    status: "substrate",
    newFeaturesAllowed: true,
    notes:
      "New eventType literals must be added to the AgentRunEventType union AND autopilot/map-events.ts in the same PR; unregistered literals fail CI (NEW_RUNTIME_EVENT_TYPE_FORBIDDEN). Entirely new general-purpose runtime event schemas/tables are frozen.",
  },
  {
    area: "corporate-memory",
    paths: ["src/lib/corporate-memory"],
    currentRole:
      "Enterprise knowledge plane: canonical guarded write path (AI actor writes hard-rejected, audited in-tx), accessClass-gated retrieval.",
    targetRole:
      "Unchanged plane. Runtime/workforce/autopilot never write it; reads go through the canonical retrieval/access gate.",
    status: "canonical",
    newFeaturesAllowed: true,
    notes:
      "db.memoryClaim/db.buyer writes outside src/lib/corporate-memory fail CI. Known read bypass (tender-bid-draft/gather.ts) is B4 in the bugfix lane, baselined and NOT hidden.",
  },
  {
    area: "project-ledger",
    paths: ["src/lib/project-ledger"],
    currentRole:
      "Authoritative business fact/event ledger: append-only ProjectEvent with deterministic keys, must-throw semantics, flag-gated producers.",
    targetRole:
      "Unchanged plane. New producers only via appendProjectEvent; agent runtime never writes it.",
    status: "canonical",
    newFeaturesAllowed: true,
    notes:
      "appendProjectEvent callers are baseline-gated. Known defective producer (quote-engine/service.ts appendLedgerEvent — silently dead) is B3 in the bugfix lane, baselined and NOT hidden.",
  },
] as const;

export function getManifestEntry(
  area: RuntimeArchitectureArea,
): RuntimeArchitectureEntry | undefined {
  return RUNTIME_ARCHITECTURE_MANIFEST.find((e) => e.area === area);
}

/** Areas whose directories are subject to the guarded-dir file census. */
export const FROZEN_CENSUS_AREAS: Record<string, string[]> = {
  "agent-supervisor": ["src/lib/agent-supervisor"],
  "agent-legacy": ["src/lib/agent"],
  "agent-tasks-legacy": ["src/lib/agent-tasks"],
  "lib-runtime-deprecated": ["src/lib/runtime"],
  // Substrate + sole orchestrator: additions are legitimate but must be
  // intentional (baseline update), because a new file here is by definition
  // new runtime surface.
  "agent-runtime": ["src/lib/agent-runtime"],
  "agent-runtime-v2": ["src/lib/agent-runtime-v2"],
};
