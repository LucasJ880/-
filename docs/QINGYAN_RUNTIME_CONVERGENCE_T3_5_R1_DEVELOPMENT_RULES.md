# QYANE_RUNTIME_CONVERGENCE_T3_5 — R1 Development Rules (convergence window)

- **Audience**: every lane/task brief started while T3.5 convergence (R1→R2) is in progress. These rules are the T4 domain-only guardrail decided in R0 and frozen in R1. CI enforces the machine-checkable half (`npm run test:runtime-architecture`); the rest is review policy.
- **Authority**: `src/lib/runtime-architecture/manifest.ts` (machine-readable), `docs/QINGYAN_RUNTIME_CONVERGENCE_T3_5_R1_BOUNDARY_FREEZE.md` (rules), R0 target doc (rationale).

## 1. Allowed during convergence (T4 domain work — YES)

Business-domain work that rides EXISTING runtime contracts:

- Tender / Quote / Finance / Procurement / CRM / Project / Supplier business logic
- Domain UI, domain calculations, domain read models
- Domain memory consumers (reads via `corporate-memory` retrieval/access gate only)
- Ledger producers via `appendProjectEvent` (flag-gated, deterministic event keys)
- New domain TOOLS: descriptors + handlers registered into the existing catalogs (the `tender-workforce/tools.ts` pattern) with risk declared; describable by `CanonicalToolDescriptor`
- New plan SOURCES as data through the existing `PlannerOutput` / `ServerAuthoredPlanV1` compile chain (the deterministic-plan pattern)
- New approvals via `requestApproval()` from `@/lib/approval/port` — with orgId, principal, canonical risk, source run/step, and a stable idempotency key

## 2. Blocked until R2 (fails CI or review)

- new orchestrator, new runtime, new executor path
- new planner architecture (planner ENGINES; plan sources-as-data stay allowed)
- new generic Agent state machine; new AgentRun status strings (inventory-gated)
- new approval mechanism; any direct `pendingAction`/`approvalRequest` write; any new import of `pending-actions/drafts` or `agent/approval`
- new Run/Step persistence models (Prisma architectural-name guard)
- new tool registry/catalog surface (register into existing ones instead)
- new runtime event vocabulary outside `AgentRunEventType` + autopilot map (same-PR rule)
- new worker protocol / external worker adapter (R3 designs it; R4 implements)
- new imports of frozen surfaces: `agent-supervisor`, `lib/agent`, `agent-tasks`, `flow-runner`, `lib/runtime`
- growth of the forbidden import directions (esp. `agent-runtime-v2 → workforce-runtime`; `autopilot → any execution module`)

## 3. Frozen modules — allowed change classes only

`agent-supervisor`, legacy `lib/agent` + `agent-tasks` + `flow-runner` + `api/agent/tasks`, `lib/runtime`, the agent-runtime legacy orchestrator group, and the DB ToolRegistry builtin surface accept ONLY: bugfix / security fix / compatibility fix / migration instrumentation / deprecation markers. No new planner, executor path, approval semantics, persistence model, tool catalog, or business feature. Production paths must keep working — freezing is not breaking.

## 4. When CI blocks you

The guard prints the rule and the canonical alternative. If the addition is genuinely intended architecture (rare during R1/R2): update `src/lib/runtime-architecture/runtime-architecture-baseline.json` **in the same PR**, explain the decision in the PR description, and treat the baseline diff as the review artifact. Regeneration: `npx tsx scripts/runtime-architecture-baseline.ts --generate` (review the JSON diff; never commit it blindly). Shrinking (deleting surfaces) never fails — regenerate at leisure.

## 5. Bugfix lane (separate from all of the above)

B1 tenant fields on message-channel `runAgent` · B2 approval CAS/duplicate-decision race · B3 quote-engine ledger producer · B4 bid-draft memory access-gate bypass · B5 supervisor cancel-endpoint gating. These are security/correctness fixes allowed in frozen areas, shipped as their own PRs — never smuggled into feature or convergence PRs.
