/**
 * QYANE_RUNTIME_CONVERGENCE_T3_5 — R1 architecture guards.
 *
 * Pure functions: compute the architecture surface census of a RepoScan and
 * diff it against the checked-in baseline
 * (src/lib/runtime-architecture/runtime-architecture-baseline.json).
 *
 * Contract:
 * - Baselines are shrink-only. A file/edge/literal DISAPPEARING never fails
 *   (regenerate at leisure); a NEW one fails until the baseline is updated
 *   in the same PR — which makes the addition an explicit, reviewed
 *   architecture decision.
 * - Every rule is deterministic over file text; no network, no DB, no env.
 *
 * Regenerate baseline: npx tsx scripts/runtime-architecture-baseline.ts --generate
 */

import {
  baseNameNoExt,
  basenameHasToken,
  extractImportSpecifiers,
  resolveTopLibModule,
  type RepoScan,
} from "./scan";
import { FROZEN_CENSUS_AREAS } from "./manifest";

export interface RuntimeArchitectureBaseline {
  version: 1;
  /** area key -> sorted rel paths of non-test .ts files in guarded dirs */
  frozenAreaFiles: Record<string, string[]>;
  /** files with direct PendingAction/ApprovalRequest writes or creation-helper imports */
  approvalCreationFiles: string[];
  agentRunCreateFiles: string[];
  agentRunUpdateFiles: string[];
  agentRunEventWriteFiles: string[];
  agentRunStepWriteFiles: string[];
  agentTaskWriteFiles: string[];
  /** prisma model names matching the architectural-name pattern */
  prismaArchitecturalModels: string[];
  plannerSurfaceFiles: string[];
  engineSurfaceFiles: string[];
  toolRegistrySurfaceFiles: string[];
  /** eventType literals outside the AgentRunEventType union that are tolerated */
  eventTypeLiteralExceptions: string[];
  /** frozen target key -> importer files */
  frozenModuleImporters: Record<string, string[]>;
  /** "<from>-><to>" -> sorted "file => specifier" entries */
  importEdges: Record<string, string[]>;
}

export interface Violation {
  rule: string;
  file?: string;
  message: string;
}

// ── Census configuration (deterministic token/regex tables) ────────────────

const APPROVAL_WRITE_RE =
  /\.(pendingAction|approvalRequest)\s*\.\s*(create|createMany|upsert|update|updateMany|delete|deleteMany)\s*\(/;
/** Creation helpers that only the canonical boundary may re-export for new code. */
const APPROVAL_HELPER_SPECIFIERS = [
  "@/lib/pending-actions/drafts",
  "pending-actions/drafts",
  "@/lib/agent/approval",
];
/** Files allowed to touch approval storage without appearing in the baseline: the canonical owners. */
const APPROVAL_OWNER_PREFIXES = [
  "src/lib/pending-actions/",
  "src/lib/approval/",
  "src/lib/agent/approval.ts",
];

const AGENT_RUN_CREATE_RE = /\.agentRun\s*\.\s*(create|createMany)\s*\(/;
const AGENT_RUN_UPDATE_RE = /\.agentRun\s*\.\s*(update|updateMany|upsert)\s*\(/;
const AGENT_RUN_EVENT_WRITE_RE = /\.agentRunEvent\s*\.\s*(create|createMany|update|updateMany|delete|deleteMany)\s*\(/;
const AGENT_RUN_STEP_WRITE_RE = /\.(agentRunStep|agentRunVerification)\s*\.\s*(create|createMany|update|updateMany|upsert)\s*\(/;
const AGENT_TASK_WRITE_RE = /\.(agentTask|agentTaskStep)\s*\.\s*(create|createMany|update|updateMany|upsert)\s*\(/;

const PRISMA_ARCHITECTURAL_NAME_RE =
  /(Run|Step|Task|Approval|Pending|Event|Tool|Skill|Lease|Queue|Job|Worker|Plan|Memory|Ledger)/;

const PLANNER_TOKENS = [
  "planner",
  "replanner",
  "plan",
  "orchestrator",
] as const;
const PLANNER_BASENAMES = [
  "plan-compile",
  "server-plan",
  "deterministic-plan",
  "flow-runner",
] as const;

const ENGINE_TOKENS = [
  "engine",
  "executor",
  "processor",
  "dispatcher",
  "dispatch",
  "queue",
  "lease",
  "scheduler",
] as const;

const TOOL_REGISTRY_RE =
  /TOOL_(CATALOG|HANDLERS|DESCRIPTORS|POLICY|ALLOWLIST)S?\b|\bToolRegistry\b|registry\.register\s*\(|WORKER_REGISTRY\b/;

const EVENT_TYPE_LITERAL_RE = /eventType:\s*["'`]([a-z0-9_.-]+)["'`]/g;
const EVENT_EMITTER_DIRS = [
  "src/lib/agent-runtime/",
  "src/lib/agent-runtime-v2/",
  "src/lib/workforce-runtime/",
  "src/lib/agent-supervisor/",
  "src/lib/assistant/",
  "src/lib/mention-gateway/",
  "src/lib/messaging/",
  "src/lib/autopilot/",
  "src/lib/agent-core/",
];

/** Frozen import targets: NEW importer files are rejected. */
const FROZEN_IMPORT_TARGETS: Record<string, RegExp> = {
  "agent-supervisor": /(^|\/)agent-supervisor(\/|$)/,
  "agent-legacy": /@\/lib\/agent\/|(^|[^-\w])\.\.\/agent\//,
  "agent-tasks-legacy": /(^|\/)agent-tasks(\/|$)/,
  "lib-runtime-deprecated": /@\/lib\/runtime\//,
  "flow-runner": /skills\/flow-runner/,
  "pending-actions-drafts-helper": /pending-actions\/drafts/,
};

/**
 * Forbidden-direction import pairs (from top-level src/lib module -> to
 * module). Existing edges are baselined shrink-only; NEW pairs fail.
 */
const FORBIDDEN_IMPORT_DIRECTIONS: ReadonlyArray<{ from: string; to: string }> = [
  { from: "agent-runtime-v2", to: "workforce-runtime" }, // the R0 inversion — must not grow (R2-C3 shrinks it)
  { from: "agent-runtime-v2", to: "agent-core" },
  { from: "agent-runtime-v2", to: "agent-supervisor" },
  { from: "agent-runtime-v2", to: "autopilot" },
  { from: "agent-runtime", to: "agent-runtime-v2" },
  { from: "agent-runtime", to: "workforce-runtime" },
  { from: "agent-runtime", to: "agent-supervisor" },
  { from: "agent-runtime", to: "autopilot" },
  { from: "agent-core", to: "agent-runtime-v2" },
  { from: "agent-core", to: "workforce-runtime" },
  { from: "agent-core", to: "agent-supervisor" },
  { from: "agent-core", to: "autopilot" },
  { from: "autopilot", to: "agent-core" },
  { from: "autopilot", to: "agent-runtime" },
  { from: "autopilot", to: "agent-runtime-v2" },
  { from: "autopilot", to: "workforce-runtime" },
  { from: "autopilot", to: "agent-supervisor" },
  { from: "autopilot", to: "assistant" },
  { from: "autopilot", to: "messaging" },
  { from: "autopilot", to: "mention-gateway" },
  { from: "workforce-runtime", to: "agent-core" },
  { from: "workforce-runtime", to: "agent-supervisor" },
  { from: "workforce-runtime", to: "agent" },
  { from: "workforce-runtime", to: "runtime" },
  { from: "corporate-memory", to: "agent-core" },
  { from: "corporate-memory", to: "agent-runtime" },
  { from: "corporate-memory", to: "agent-runtime-v2" },
  { from: "corporate-memory", to: "workforce-runtime" },
  { from: "corporate-memory", to: "autopilot" },
  { from: "project-ledger", to: "agent-core" },
  { from: "project-ledger", to: "agent-runtime" },
  { from: "project-ledger", to: "agent-runtime-v2" },
  { from: "project-ledger", to: "workforce-runtime" },
  { from: "project-ledger", to: "autopilot" },
];

// ── Census computation (pure) ──────────────────────────────────────────────

function filesMatching(scan: RepoScan, re: RegExp, opts?: { under?: string[] }): string[] {
  const out: string[] = [];
  for (const [rel, text] of scan.files) {
    if (rel === "prisma/schema.prisma") continue;
    if (opts?.under && !opts.under.some((p) => rel.startsWith(p))) continue;
    if (re.test(text)) out.push(rel);
  }
  return out.sort();
}

export function computeBaseline(scan: RepoScan): RuntimeArchitectureBaseline {
  const frozenAreaFiles: Record<string, string[]> = {};
  for (const [area, dirs] of Object.entries(FROZEN_CENSUS_AREAS)) {
    const files: string[] = [];
    for (const rel of scan.files.keys()) {
      if (dirs.some((d) => rel.startsWith(`${d}/`) || rel === d)) files.push(rel);
    }
    frozenAreaFiles[area] = files.sort();
  }

  const approvalCreation = new Set<string>();
  for (const [rel, text] of scan.files) {
    if (rel === "prisma/schema.prisma") continue;
    if (APPROVAL_OWNER_PREFIXES.some((p) => rel.startsWith(p) || rel === p)) continue;
    if (APPROVAL_WRITE_RE.test(text)) approvalCreation.add(rel);
    const specifiers = extractImportSpecifiers(text);
    if (
      specifiers.some((s) =>
        APPROVAL_HELPER_SPECIFIERS.some((h) => s === h || s.endsWith(h)),
      )
    ) {
      approvalCreation.add(rel);
    }
  }

  const prismaText = scan.files.get("prisma/schema.prisma") ?? "";
  const prismaArchitecturalModels: string[] = [];
  for (const m of prismaText.matchAll(/^model\s+(\w+)\s*\{/gm)) {
    if (PRISMA_ARCHITECTURAL_NAME_RE.test(m[1])) prismaArchitecturalModels.push(m[1]);
  }
  prismaArchitecturalModels.sort();

  const plannerSurfaceFiles: string[] = [];
  const engineSurfaceFiles: string[] = [];
  for (const rel of scan.files.keys()) {
    if (!rel.startsWith("src/lib/")) continue;
    const base = baseNameNoExt(rel);
    if (
      PLANNER_TOKENS.some((t) => basenameHasToken(base, t)) ||
      (PLANNER_BASENAMES as readonly string[]).includes(base)
    ) {
      plannerSurfaceFiles.push(rel);
    }
    if (ENGINE_TOKENS.some((t) => basenameHasToken(base, t))) {
      engineSurfaceFiles.push(rel);
    }
  }
  plannerSurfaceFiles.sort();
  engineSurfaceFiles.sort();

  const eventTypeLiterals = new Set<string>();
  for (const [rel, text] of scan.files) {
    if (!EVENT_EMITTER_DIRS.some((d) => rel.startsWith(d))) continue;
    for (const m of text.matchAll(EVENT_TYPE_LITERAL_RE)) eventTypeLiterals.add(m[1]);
  }
  const union = parseAgentRunEventTypeUnion(scan);
  const eventTypeLiteralExceptions = [...eventTypeLiterals]
    .filter((l) => !union.has(l))
    .sort();

  const frozenModuleImporters: Record<string, string[]> = {};
  for (const [key, re] of Object.entries(FROZEN_IMPORT_TARGETS)) {
    const importers = new Set<string>();
    for (const [rel, text] of scan.files) {
      if (rel === "prisma/schema.prisma") continue;
      // A frozen module importing itself / its own area is not a violation.
      if (isInsideFrozenTarget(key, rel)) continue;
      const specifiers = extractImportSpecifiers(text);
      if (specifiers.some((s) => re.test(s))) importers.add(rel);
    }
    frozenModuleImporters[key] = [...importers].sort();
  }

  const importEdges: Record<string, string[]> = {};
  for (const { from, to } of FORBIDDEN_IMPORT_DIRECTIONS) {
    const key = `${from}->${to}`;
    const entries = new Set<string>();
    for (const [rel, text] of scan.files) {
      if (!rel.startsWith(`src/lib/${from}/`)) continue;
      for (const spec of extractImportSpecifiers(text)) {
        if (resolveTopLibModule(spec, rel) === to) {
          entries.add(`${rel} => ${spec}`);
        }
      }
    }
    importEdges[key] = [...entries].sort();
  }

  return {
    version: 1,
    frozenAreaFiles,
    approvalCreationFiles: [...approvalCreation].sort(),
    agentRunCreateFiles: filesMatching(scan, AGENT_RUN_CREATE_RE),
    agentRunUpdateFiles: filesMatching(scan, AGENT_RUN_UPDATE_RE),
    agentRunEventWriteFiles: filesMatching(scan, AGENT_RUN_EVENT_WRITE_RE),
    agentRunStepWriteFiles: filesMatching(scan, AGENT_RUN_STEP_WRITE_RE),
    agentTaskWriteFiles: filesMatching(scan, AGENT_TASK_WRITE_RE),
    prismaArchitecturalModels,
    plannerSurfaceFiles,
    engineSurfaceFiles,
    toolRegistrySurfaceFiles: filesMatching(scan, TOOL_REGISTRY_RE, {
      under: ["src/lib/"],
    }),
    eventTypeLiteralExceptions,
    frozenModuleImporters,
    importEdges,
  };
}

function isInsideFrozenTarget(key: string, rel: string): boolean {
  switch (key) {
    case "agent-supervisor":
      return rel.startsWith("src/lib/agent-supervisor/") || rel.startsWith("src/app/api/agent-supervisor/");
    case "agent-legacy":
      return rel.startsWith("src/lib/agent/") || rel.startsWith("src/app/api/agent/");
    case "agent-tasks-legacy":
      return rel.startsWith("src/lib/agent-tasks/") || rel.startsWith("src/app/api/agent/");
    case "lib-runtime-deprecated":
      return rel.startsWith("src/lib/runtime/");
    case "flow-runner":
      return rel === "src/lib/agent-core/skills/flow-runner.ts";
    case "pending-actions-drafts-helper":
      return (
        rel.startsWith("src/lib/pending-actions/") ||
        rel.startsWith("src/lib/approval/")
      );
    default:
      return false;
  }
}

/** Parse the AgentRunEventType union literals from agent-runtime/types.ts source. */
export function parseAgentRunEventTypeUnion(scan: RepoScan): Set<string> {
  const text = scan.files.get("src/lib/agent-runtime/types.ts") ?? "";
  const start = text.indexOf("export type AgentRunEventType");
  if (start < 0) return new Set();
  const end = text.indexOf(";", start);
  const block = text.slice(start, end < 0 ? undefined : end);
  const out = new Set<string>();
  for (const m of block.matchAll(/"([a-z0-9_.-]+)"/g)) out.add(m[1]);
  return out;
}

/** Parse a string-literal union type block from a TS source by type name. */
export function parseUnionLiterals(text: string, typeName: string): string[] {
  const start = text.indexOf(`export type ${typeName}`);
  if (start < 0) return [];
  const end = text.indexOf(";", start);
  const block = text.slice(start, end < 0 ? undefined : end);
  return [...block.matchAll(/"([A-Za-z0-9_.-]+)"/g)].map((m) => m[1]);
}

// ── Diff (current census vs stored baseline) ───────────────────────────────

function diffNew(
  rule: string,
  current: string[],
  stored: string[] | undefined,
  message: (entry: string) => string,
): Violation[] {
  const known = new Set(stored ?? []);
  return current
    .filter((c) => !known.has(c))
    .map((entry) => ({ rule, file: entry.split(" => ")[0], message: message(entry) }));
}

export function checkAgainstBaseline(
  current: RuntimeArchitectureBaseline,
  stored: RuntimeArchitectureBaseline,
): Violation[] {
  const v: Violation[] = [];

  for (const [area, files] of Object.entries(current.frozenAreaFiles)) {
    v.push(
      ...diffNew(
        "FROZEN_AREA_NEW_FILE",
        files,
        stored.frozenAreaFiles[area],
        (f) =>
          `FROZEN_AREA_NEW_FILE [${area}]: ${f} — this area is frozen/baseline-gated (see runtime-architecture/manifest.ts). New architecture files require an explicit baseline update in the same PR.`,
      ),
    );
  }

  v.push(
    ...diffNew(
      "NEW_APPROVAL_BYPASS_FORBIDDEN",
      current.approvalCreationFiles,
      stored.approvalCreationFiles,
      (f) =>
        `NEW_APPROVAL_BYPASS_FORBIDDEN: ${f} writes approval storage or imports a legacy creation helper.\nUse canonical ApprovalPort creation boundary (requestApproval in @/lib/approval/port).`,
    ),
    ...diffNew(
      "NEW_RUN_MODEL_WRITER_FORBIDDEN",
      current.agentRunCreateFiles,
      stored.agentRunCreateFiles,
      (f) => `NEW_RUN_MODEL_WRITER_FORBIDDEN: ${f} creates AgentRun rows directly. Use agent-runtime createAgentRun (substrate).`,
    ),
    ...diffNew(
      "NEW_RUN_STATUS_WRITER_FORBIDDEN",
      current.agentRunUpdateFiles,
      stored.agentRunUpdateFiles,
      (f) => `NEW_RUN_STATUS_WRITER_FORBIDDEN: ${f} updates AgentRun directly. Status writes converge in R2-C1; new writers are frozen — use the substrate helpers.`,
    ),
    ...diffNew(
      "NEW_EVENT_WRITER_FORBIDDEN",
      current.agentRunEventWriteFiles,
      stored.agentRunEventWriteFiles,
      (f) => `NEW_EVENT_WRITER_FORBIDDEN: ${f} writes AgentRunEvent directly. appendAgentRunEvent[InTx] (agent-runtime/run.ts) is the only event writer.`,
    ),
    ...diffNew(
      "NEW_STEP_MODEL_WRITER_FORBIDDEN",
      current.agentRunStepWriteFiles,
      stored.agentRunStepWriteFiles,
      (f) => `NEW_STEP_MODEL_WRITER_FORBIDDEN: ${f} writes AgentRunStep/AgentRunVerification directly. agent-runtime-v2 owns the step model.`,
    ),
    ...diffNew(
      "NEW_LEGACY_TASK_WRITER_FORBIDDEN",
      current.agentTaskWriteFiles,
      stored.agentTaskWriteFiles,
      (f) => `NEW_LEGACY_TASK_WRITER_FORBIDDEN: ${f} writes the frozen AgentTask/AgentTaskStep legacy models. New work uses AgentRun/AgentRunStep (agent-runtime-v2).`,
    ),
    ...diffNew(
      "NEW_RUNTIME_PERSISTENCE_MODEL_FORBIDDEN",
      current.prismaArchitecturalModels,
      stored.prismaArchitecturalModels,
      (m) => `NEW_RUNTIME_PERSISTENCE_MODEL_FORBIDDEN: prisma model "${m}" matches the frozen architectural-name pattern (Run/Step/Task/Approval/Event/Tool/...). New runtime persistence models are frozen until R2; update the baseline only with an architecture review.`,
    ),
    ...diffNew(
      "NEW_PLANNER_SURFACE_FORBIDDEN",
      current.plannerSurfaceFiles,
      stored.plannerSurfaceFiles,
      (f) => `NEW_PLANNER_SURFACE_FORBIDDEN: ${f} looks like a new planner/orchestrator surface. New planner ENGINES are frozen; new plan SOURCES must go through the existing PlannerOutput/ServerAuthoredPlanV1 compile chain.`,
    ),
    ...diffNew(
      "NEW_ENGINE_SURFACE_FORBIDDEN",
      current.engineSurfaceFiles,
      stored.engineSurfaceFiles,
      (f) => `NEW_ENGINE_SURFACE_FORBIDDEN: ${f} looks like a new engine/executor/queue/lease surface. The runtime substrate and agent-runtime-v2 are the only places these live; update the baseline only with an architecture review.`,
    ),
    ...diffNew(
      "NEW_TOOL_REGISTRY_SURFACE_FORBIDDEN",
      current.toolRegistrySurfaceFiles,
      stored.toolRegistrySurfaceFiles,
      (f) => `NEW_TOOL_REGISTRY_SURFACE_FORBIDDEN: ${f} declares tool registry/catalog surface. No new general-purpose tool registries: register descriptors+handlers into the existing catalogs (tender-workforce pattern) or the canonical descriptor contract (runtime-architecture/tool-descriptor.ts).`,
    ),
    ...diffNew(
      "NEW_RUNTIME_EVENT_TYPE_FORBIDDEN",
      current.eventTypeLiteralExceptions,
      stored.eventTypeLiteralExceptions,
      (l) => `NEW_RUNTIME_EVENT_TYPE_FORBIDDEN: eventType literal "${l}" is not in the AgentRunEventType union. Register it in agent-runtime/types.ts AND autopilot/map-events.ts in the same PR (no unregistered runtime event vocabularies).`,
    ),
  );

  for (const [key, importers] of Object.entries(current.frozenModuleImporters)) {
    v.push(
      ...diffNew(
        "NEW_FROZEN_MODULE_IMPORTER_FORBIDDEN",
        importers,
        stored.frozenModuleImporters[key],
        (f) =>
          `NEW_FROZEN_MODULE_IMPORTER_FORBIDDEN [${key}]: ${f} newly imports a frozen surface. Use the canonical replacement recorded in runtime-architecture/manifest.ts${key === "pending-actions-drafts-helper" ? " (for approvals: approval/port requestApproval)" : ""}.`,
      ),
    );
  }

  for (const [key, edges] of Object.entries(current.importEdges)) {
    v.push(
      ...diffNew(
        "FORBIDDEN_IMPORT_DIRECTION_GROWTH",
        edges,
        stored.importEdges[key],
        (e) =>
          `FORBIDDEN_IMPORT_DIRECTION_GROWTH [${key}]: ${e}. This dependency direction is architecturally forbidden (R0 layering rules); the existing baselined edges are the documented inversion and may only shrink (R2-C3).`,
      ),
    );
  }

  return v;
}
