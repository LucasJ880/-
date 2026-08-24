# QYANE_RUNTIME_CONVERGENCE_T3_5 — R1 Boundary Freeze & Safety Rails

- **Status**: R1 implementation (R1-A boundary freeze + R1-B canonical entry-point rails). No production behavior change; no schema/migration change; B1–B5 bugfixes intentionally NOT included (separate lane).
- **R1_BASE_MAIN_SHA**: `912c28b41c4aa1edc2cdcb4d5ed2e4ff66444e09` (origin/main, merge of PR #155)
- **R1_BRANCH**: `architecture/qyane-runtime-convergence-r1-boundary-freeze`
- **R0 reference**: branch `architecture/qyane-runtime-convergence-t3-5` @ `400d909f` (audit base `29e4b217`); the four R0 docs are the evidence base for every baseline below.

## 1. Main drift since R0

7 commits between `29e4b217` (R0 base) and `912c28b4`: all PR #155 (Quote Engine Phase 2.1) — `src/lib/quote-engine/import/*`, `quotation-html.ts`, one UI component, e2e scripts, `scripts/test-all.sh`, one docs file. **Runtime-relevant drift: NONE** (zero changes under agent-*, workforce-runtime, autopilot, approval, pending-actions, tenancy, corporate-memory, project-ledger, prisma). The B3 defect file (`quote-engine/service.ts`) was not touched by the drift.

## 2. What R1 adds

| Piece | Location |
|---|---|
| Runtime ownership manifest (governance metadata, 12 areas: current role / target role / freeze status / newFeaturesAllowed / canonicalReplacement / allowedChanges) | `src/lib/runtime-architecture/manifest.ts` |
| Canonical risk vocabulary + fail-closed normalization + `REQUIRES_APPROVAL_CONTRACT` rail | `src/lib/runtime-architecture/risk.ts` |
| Canonical tool descriptor contract + pure bridges from every existing catalog shape | `src/lib/runtime-architecture/tool-descriptor.ts` |
| AgentRun status inventory (19 statuses incl. 5 phantom) + PROPOSED R2 transition matrix (DESIGN ONLY) | `src/lib/runtime-architecture/run-status-inventory.ts` |
| Deterministic repo scanner + pure guard checkers (13 rules) | `src/lib/runtime-architecture/scan.ts`, `guards.ts` |
| Checked-in architecture baseline (explicit allowlists; shrink-only) | `src/lib/runtime-architecture/runtime-architecture-baseline.json` |
| Baseline generator/checker (`--generate` regenerates; regeneration diff is review material) | `scripts/runtime-architecture-baseline.ts` |
| Guard test suite (7 files, incl. 25 negative tests proving each guard rejects an invalid new surface) | `src/lib/runtime-architecture/__tests__/`, `src/lib/approval/__tests__/request-facade.test.ts` |
| Canonical approval **creation** facade for NEW code: `requestApproval()` (delegates to existing `createDraftBatch`; PendingAction only; ApprovalRequest creation stays frozen with the AgentTask stack) | `src/lib/approval/request.ts`, re-exported from `src/lib/approval/port.ts` |
| Suite wiring: `npm run test:runtime-architecture`; runs inside `scripts/test-ci-unit.sh` (CI) and `scripts/test-all.sh` | `package.json`, `scripts/test-runtime-architecture.sh` |
| Development rules for the convergence window (T4 domain-only policy) | `docs/QINGYAN_RUNTIME_CONVERGENCE_T3_5_R1_DEVELOPMENT_RULES.md` |

Enforcement model: **shrink-only baselines**. Every guarded census (files, writers, import edges, event literals, prisma models) is snapshotted in the baseline JSON. Anything disappearing never fails; anything NEW fails CI until the baseline is updated in the same PR — which turns every new architectural surface into an explicit, reviewable decision. The baseline file lives next to the guards and is itself review material (never regenerate-and-commit blindly).

## 3. Canonical boundaries (decided)

```text
CANONICAL_LLM_TOOL_LOOP           = agent-core runAgent/runAgentStream (src/lib/agent-core/engine.ts)
CANONICAL_RUNTIME_SUBSTRATE       = agent-runtime (run.ts / lease.ts / session.ts / observe.ts / trace.ts / pending-link.ts)
CANONICAL_DURABLE_ORCHESTRATOR    = agent-runtime-v2 (sole AgentRunStep/AgentRunVerification writer)
CANONICAL_WORKFORCE_LAYER         = workforce-runtime (scheduler above Runtime V2)
CANONICAL_EVALUATION_LAYER        = autopilot (evaluation/evidence/judge/recovery-POLICY; never an executor)
CANONICAL_APPROVAL_BOUNDARY       = approval/port.ts — decisions (existing) + requestApproval creation facade (R1, new-code-only)
CANONICAL_TOOL_DESCRIPTOR_BOUNDARY= runtime-architecture/tool-descriptor.ts (CanonicalToolDescriptor + canonical risk vocabulary; ONE metadata shape now, ONE physical registry later in R2-C4)
```

## 4. Frozen areas and allowed changes

Per `manifest.ts` (statuses `frozen`; allowed changes everywhere: bugfix / security fix / compatibility fix / migration instrumentation / deprecation marker — never new planner, executor path, approval semantics, persistence model, tool catalog, or business feature):

| Area | Paths | Enforcement |
|---|---|---|
| agent-supervisor | `src/lib/agent-supervisor/**`, `src/app/api/agent-supervisor/**` | dir file census + importer freeze + import-direction guards |
| AgentTask legacy (incl. flow-runner + deprecated lib/runtime) | `src/lib/agent/**`, `src/lib/agent-tasks/**`, `src/lib/agent-core/skills/flow-runner.ts`, `src/lib/runtime/**`, `src/app/api/agent/tasks/**` | dir file censuses + importer freezes (`agent-legacy`, `agent-tasks-legacy`, `lib-runtime-deprecated`, `flow-runner`) + `NEW_LEGACY_TASK_WRITER_FORBIDDEN` |
| agent-runtime legacy orchestrator group (process/plan/queue/context/dispatch/ack/deterministic/session-memory/workbench-link) | inside `src/lib/agent-runtime/` | whole-dir census (any new file = baseline update) + writer guards; intra-file feature expansion is review policy (development rules doc) |
| DB-backed ToolRegistry builtin surface | `conversation/adapter.ts` builtins (echo/calculator/kb_lookup), Prisma `ToolRegistry`/`AgentToolBinding` | prisma model guard (no new Tool* models) + registry-surface census + development rules; intra-file expansion is review policy |

`agent-runtime` and `agent-runtime-v2` directories are additionally census-gated even though they are canonical/substrate: a new file there is by definition new runtime surface and must be an intentional baseline update (R2 will add e.g. `event-contract.ts` exactly this way).

## 5. Guards (CI/static) — the 13 rules

All implemented in `guards.ts`, executed by `repo-conformance.test.ts`, each with ≥1 negative test in `guards-negative.test.ts`:

1. `FROZEN_AREA_NEW_FILE` — new non-test file in a censused area.
2. `NEW_APPROVAL_BYPASS_FORBIDDEN` — new file with direct `pendingAction`/`approvalRequest` writes (create/update/upsert/delete) or importing the legacy creation helpers (`pending-actions/drafts`, `agent/approval`); message says: *Use canonical ApprovalPort creation boundary.* Canonical owners (`pending-actions/`, `approval/`, `agent/approval.ts`) exempt.
3. `NEW_RUN_MODEL_WRITER_FORBIDDEN` — new direct `agentRun.create` writer (baseline: run.ts, workforce job.ts).
4. `NEW_RUN_STATUS_WRITER_FORBIDDEN` — new direct `agentRun.update` writer (16 baselined; converge in R2-C1).
5. `NEW_EVENT_WRITER_FORBIDDEN` — new `agentRunEvent` writer (baseline: exactly `agent-runtime/run.ts`).
6. `NEW_STEP_MODEL_WRITER_FORBIDDEN` — new `agentRunStep`/`agentRunVerification` writer (6 baselined: v2 + workforce).
7. `NEW_LEGACY_TASK_WRITER_FORBIDDEN` — new `agentTask`/`agentTaskStep` writer (6 baselined).
8. `NEW_RUNTIME_PERSISTENCE_MODEL_FORBIDDEN` — new Prisma model whose name matches the architectural pattern (Run/Step/Task/Approval/Pending/Event/Tool/Skill/Lease/Queue/Job/Worker/Plan/Memory/Ledger); 52 baselined.
9. `NEW_PLANNER_SURFACE_FORBIDDEN` — new file whose basename matches planner/replanner/plan/orchestrator/plan-compile/server-plan/deterministic-plan/flow-runner (14 baselined).
10. `NEW_ENGINE_SURFACE_FORBIDDEN` — new file whose basename matches engine/executor/processor/dispatcher/dispatch/queue/lease/scheduler (19 baselined).
11. `NEW_TOOL_REGISTRY_SURFACE_FORBIDDEN` — new file declaring registry/catalog identifiers (`*TOOL_CATALOG/HANDLERS/DESCRIPTORS/POLICY/ALLOWLIST*`, `ToolRegistry`, `registry.register(`, `*WORKER_REGISTRY`); 39 baselined — all 9 R0 catalogs are visible in the baseline.
12. `NEW_RUNTIME_EVENT_TYPE_FORBIDDEN` — `eventType:` literal in emitter modules outside the `AgentRunEventType` union (exceptions baselined: exactly the 9 `supervisor.*` literals — the known erasure; NOT hidden).
13. `NEW_FROZEN_MODULE_IMPORTER_FORBIDDEN` + `FORBIDDEN_IMPORT_DIRECTION_GROWTH` — consumer-side freeze of supervisor/legacy/flow-runner/drafts-helper, and the architecture dependency guard (below).

Manifest validity, risk-mapping monotonicity (never downgrades, unknown → `restricted`), tool-descriptor bridging over the real catalogs (parsed from source; 93+13 entries normalize losslessly), status-inventory conformance (both unions covered; new status literal fails until inventoried), and facade mapping are covered by the remaining test files. Suite entry: `npm run test:runtime-architecture` (also inside `test:ci` and `test-all.sh`).

## 6. Architecture dependency guard & documented inversion

Forbidden-direction growth (all currently at ZERO except where noted; existing edges baselined shrink-only):

```text
agent-runtime-v2 → workforce-runtime   14 edges  ← THE R0 INVERSION (documented; must not grow; shrinks in R2-C3)
agent-runtime-v2 → agent-core|supervisor|autopilot        0
agent-runtime    → agent-runtime-v2|workforce|supervisor  0 除 supervisor 1 edge (process.ts dynamic import — legacy branch)
agent-runtime    → autopilot            2 edges (run.ts outbox-in-tx + observe.ts sanitize — known R0 thin spots, R2 targets)
agent-core       → v2|workforce|supervisor|autopilot      0
autopilot        → agent-core|v2|workforce|supervisor|messaging|mention-gateway  0
autopilot        → agent-runtime        2 edges (types + run helpers, read/append substrate)
autopilot        → assistant            2 edges (reconcile-human → reconcile-run / retry-idempotency — the R0 "dormant status-mutating path", visible)
workforce-runtime→ agent-core|supervisor|agent|runtime    0
corporate-memory / project-ledger → any runtime module    0  (planes independent — now guarded)
```

R1 does NOT refactor the inversion (No-Scope). It documents it, freezes it shrink-only, and R2-C3 (policy descent: `execution-policy`/`execution-descriptor`/`work-domain` move out of workforce-runtime) is the migration boundary that empties the 14-edge list.

## 7. Approval creation boundary (R1-B §6/§7)

- `requestApproval()` (`src/lib/approval/request.ts`, exported via `approval/port.ts`) is the ONLY approval-creation entry for NEW code. It carries orgId, principal, actionType, canonical+original risk, source run/step/tool, business context (projectId/workspaceId), approver routing, expiry, and a REQUIRED stable idempotency key; it delegates to the existing `createDraftBatch` (storage/audit/AgentRun-linkage semantics unchanged), never executes side effects, and always stamps `payload.metadata.requiresApproval=true`.
- Decision: the facade creates **PendingAction only**. `ApprovalRequest` creation remains frozen inside the legacy AgentTask stack (`agent/approval.ts` ← flow-runner) — new code must not integrate with a frozen surface, so a canonical creation path for it would be self-contradictory. Tables are NOT merged; no existing semantics changed.
- Guard: `NEW_APPROVAL_BYPASS_FORBIDDEN` (§5.2) with the mandated message. R1 migrates NO existing call sites (that is R2-C6).

## 8. Tool descriptor contract & canonical risk (R1-B §8/§9)

- `CanonicalToolDescriptor` = one metadata shape (`name/domain/risk/description/requiresApproval/capabilities/sourceRegistry/originalRisk/failClosedRisk`); bridges exist for agent-core `TOOL_POLICY` entries, Runtime V2 / tender descriptors, legacy skills, and unrated DB tools. **No physical registry is consolidated in R1**; bridges are pure and import no runtime module (tests parse the catalogs from source text so nothing heavy loads).
- Canonical risk vocabulary: `read | low_write | sensitive_write | high_impact | restricted` with fail-closed normalization: unknown vocabulary/value → `restricted` + `requiresApproval=true`; V2 `LOW` without `readOnly` → `low_write` (never `read`); legacy low/medium/high floors at `low_write` (untrusted vocabulary never grants read-level trust); `requiresApproval=true` floors canonical at `sensitive_write` and is never dropped; original metadata preserved verbatim. **No production authorization behavior changes in R1** — this is contract + metadata; adoption is R2.
- `REQUIRES_APPROVAL_CONTRACT` (risk.ts): *requiresApproval=true MUST never be interpreted as direct-execution permission* — draft-or-refuse are the only legal outcomes. The known open violation (V2 executor ignores `canInvokeTool().requiresApproval`, R0 finding) is named in the contract text and tracked in the SEPARATE R2-C3/B-lane; R1 adds the rail and the invariant tests only, no silent fix.

## 9. Run status inventory & transition matrix (§11/§12)

`run-status-inventory.ts` captures all 14 declared statuses (8 legacy ∪ 12 V2, overlapping) + 5 phantom reader-only values (`claimed`, `succeeded`, `timed_out`, `partial`, `waiting_for_approval`) with writers, owner, classification, and migration owner (R2-C1). The conformance test parses both unions from source — a NEW status literal fails CI until inventoried. `PROPOSED_R2_TRANSITIONS` is the R2 design matrix (terminal states unleavable; `partially_executed` retired; `failed` resurrect only via explicit retry) — explicitly DESIGN ONLY, and a test asserts the substrate does not import it (nothing enforced in production in R1).

## 10. Runtime event vocabulary freeze (§13)

Inventory: the `AgentRunEventType` union (71 literals) is the contract; emitters scanned across agent-runtime / v2 / workforce / supervisor / assistant / mention-gateway / messaging / autopilot / agent-core. The only out-of-union literals are the 9 `supervisor.*` strings (erased to `planning.completed` by `agent-supervisor/persist.ts` — known R0 violation, baselined visibly). New literals fail CI with instructions to register in `types.ts` + `autopilot/map-events.ts` in the same PR. New event **tables** are blocked by the Prisma model guard. Project Ledger events, Corporate Memory, and AuditLog remain separate planes — nothing merges them (their import independence is now guarded too). Full normalization (envelope/schemaVersion) is R2-C2, not R1.

## 11. Existing violations baseline (temporarily allowlisted — NOT hidden)

| Violation (R0 evidence) | Baseline location | Fix owner |
|---|---|---|
| Quote PUT writes PendingAction `executed/failed` directly (`api/sales/quotes/[quoteId]/route.ts`) | approvalCreationFiles | R2-C6 (+ B-lane adjacent) |
| Capabilities `cancel` direct updateMany (`capabilities/approvals/decision.ts`) | approvalCreationFiles | R2-C6 |
| Bulk reject on run cancel (`agent-runtime/pending-link.ts`) | approvalCreationFiles | R2-C6 |
| Quote-promotion raw upsert (`request-promotion-approval/route.ts`) | approvalCreationFiles | R2-C6 |
| 9 legacy creation-helper importers (approval-gate, sales-drafts, skills bridge, V2 adapters, scenarios ×2, ai-grader, marketing ×2) | approvalCreationFiles + frozenModuleImporters.pending-actions-drafts-helper | R2-C6 migration to requestApproval |
| `supervisor.*` event-type erasure (9 literals) | eventTypeLiteralExceptions | R2-C2 |
| runtime⇄workforce inversion (14 import edges) | importEdges[agent-runtime-v2->workforce-runtime] | R2-C3 |
| Substrate→autopilot transactional outbox + sanitize edges (2) | importEdges[agent-runtime->autopilot] | R2-C2 decision |
| Autopilot dormant status-mutating path (reconcile-human → assistant reconcile) | importEdges[autopilot->assistant] | R2 (delete or observe-only) |
| 16 direct `agentRun.update` writer files | agentRunUpdateFiles | R2-C1 |
| 6 AgentTask writers; legacy queue/process files | agentTaskWriteFiles / frozenAreaFiles | R6 |
| B1–B5 production defects (tenant-less runAgent; approve CAS; quote-engine dead ledger producer; bid-draft memory read bypass; supervisor cancel endpoint) | referenced only — code untouched in R1 | **B1–B5 bugfix lane (separate PRs)** |

## 12. Intentionally deferred

- To **B1–B5 lane**: all five production defects above (R1 adds rails/documentation only).
- To **R2**: status machine + terminal contract (C1), event envelope + supervisor un-erasure (C2), policy descent + V2 `requiresApproval` honoring + workspace inputs (C3), catalog fold into one physical registry (C4), V2 slimming (C5), approval port widening + bypass migration (C6), queue consolidation (C7).
- To **R3/R4**: external worker contract/adapter, Codex PoC (nothing started — verified: no Codex/MCP/adapter code in this change).
- To **R6**: any deletion (supervisor, AgentTask stack, lib/runtime, legacy queue) — evidence-gated.

## 13. Validation summary

See the R1 report for full logs: `npm run test:runtime-architecture` (7 files, 325 assertions incl. 25 negative guard tests) PASS; `npx tsc --noEmit` PASS; `npm run test:ci` PASS (full CI unit subset with the new suite wired in); `npm run lint:baseline` PASS — verified on the exact R1 change set in a clean checkout (errors=41 / fingerprints=21, identical to clean origin/main → zero new lint findings). Note: running the whole-repo lint gate inside a working tree that carries local `.next` build artifacts (~400MB) OOMs Node locally on this machine regardless of branch — environmental, pre-existing, and not triggered in CI (fresh checkout). No prisma/, no migration, no production env, no feature-flag value changes (`git diff` proof in the R1 report).
