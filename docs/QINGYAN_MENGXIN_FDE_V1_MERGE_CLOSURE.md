# QINGYAN_MENGXIN_FDE_V1_PR203_MERGE_CLOSURE

- Date: 2026-09-06
- PR: #203 `feature/mengxin-fde-revenue-spine` → `main` (Draft, not merged)
- Scope: merge closure only. No production access, no `db push`, no production migrate/seed, no V2 work.

## 1. Pre-sync HEAD

```text
PR203_PRE_SYNC_HEAD = 2bd187f46cd5e8fbbd980f9edde395d6050ff579
WORKTREE_CLEAN      = true (git status: 0 entries before any change)
```

## 2. main SHA

```text
CURRENT_MAIN_SHA (at task start)      = 956d5c73c5470579ae67d82fdb9afc3ee6bd97f6   (#198 merged, #199, #201)
CURRENT_MAIN_SHA (moved during task)  = a69f7c6191a2eaf634ac2388297b72ad52bf80d7   (+#202 询盘自动分析, +#204 询盘 AI 设计段)
MERGE_BASE (initial)                  = 32e853bf00141352bf93f16b9b9f6eb7ecb6412c   (the #198 commit)
```

Commits unique to main at the first sync: `956d5c73` (#201 merge), `007a9dd2` (Trade Inbox + two-tier trade sidebar + unknown-sender leads), `45b6b78e` (#199 merge), `5713a010` (#198 merge), `d0d353e4` (NA home-textile knowledge pack). Unique to the PR: `2bd187f4` (Revenue Spine V1). Second sync added `a69f7c61`/`bf5a1389` (#204) and `a8671d07`/`76643566`/`bb9cad91` (#202).

Two synchronizations were required because main advanced (#202, #204) while the first sync was being validated; GitHub does not run `pull_request` workflows for an unmergeable PR, which is why no CI run appeared for the first pushed head.

## 3. Conflict files

Sync 1 (`origin/main` @956d5c73): `src/lib/trade/website-inquiry.ts`, `src/lib/navigation/registry.ts`, `src/app/(main)/notifications/page.tsx`.
Sync 2 (`origin/main` @a69f7c61): `scripts/check-release-safety.test.ts`, `src/lib/release/expected-migrations.ts`.

Auto-merged but reviewed: `prisma/schema.prisma` (+`TradeInquiryAnalysis`, disjoint from the Spine models), `src/lib/trade/website-inquiry.ts` (sync 2: #202's `scheduleInquiryAnalysis` inserted before the notification block; the Spine hook stays after it), `src/lib/i18n/*`, `scripts/test-ci-unit.sh`, `vercel.json`, `src/lib/automation/registry.ts`, `src/lib/trade/channel-service.ts`, `src/lib/trade/inbox-service.ts`.

## 4. Semantic resolutions (no `--ours` / `--theirs`)

| FILE | MAIN INTENT | PR203 INTENT | RESOLUTION |
|---|---|---|---|
| `src/lib/trade/website-inquiry.ts` | #201 exported `ensureInquiryCampaign(orgId, name)` for channel leads and extracted `notifyInquiryMembers()` (reused by WhatsApp/WeChat unknown-sender leads); #202 schedules async `TradeInquiryAnalysis` after the message write | append Revenue Spine intake + FDE after the Trade writes, back-fill `TradeProspect.convertedToSales*`, return `spine`/`fde` in the result | Rebuilt from main's version: main's refactor and #202's analysis hook kept verbatim; Spine block appended after `notifyInquiryMembers`; **added 24h replay idempotency** (same prospect + same rendered content → `replay: true`, no new objects, no Spine call); `opts.runFde/now` added |
| `src/lib/navigation/registry.ts` | #201 re-sorted lucide imports and added `biz-inbox` (20.5), `biz-trade-quotes` (21.5), `biz-trade-chat` (21.6), `biz-channels` (26) | add `TrendingUp` import and `biz-revenue` (/revenue, order 26) | main's import order and all four Trade entries kept; `TrendingUp` inserted alphabetically; `biz-revenue` appended after `biz-channels` with `displayOrder: 27`. `/revenue` lands in the trade "更多" partition (TRADE_PRIMARY_KEYS untouched, #201's trade-layout test unchanged) |
| `src/app/(main)/notifications/page.tsx` | #201 added `trade_prospect` → `/trade/prospects/[id]` deep link | add `revenue_opportunity` → `/revenue/[id]` deep link | both `else if` branches kept, Trade first |
| `src/lib/release/expected-migrations.ts` | #202/#204 registered `20260905160000_add_trade_inquiry_analysis`, `20260906090000_add_inquiry_design_fields` | register `20260906120000_mengxin_fde_revenue_spine` | all three in lexical order |
| `scripts/check-release-safety.test.ts` | same two names + description suffix `TradeInquiryAnalysis + InquiryDesignFields` | same one name + `MengxinFdeRevenueSpine` | all three names in order; description `… + TradeInquiryAnalysis + InquiryDesignFields + MengxinFdeRevenueSpine` |

Canonical architecture after resolution (unchanged from the brief): one website webhook → Trade lane (TradeProspect / TradeMessage / Trade Inbox / TradeInquiryAnalysis / notifications) **and** Revenue Spine (SalesCustomer / SalesOpportunity / CustomerInteraction / SalesRfq / SalesRfqEvidence / SalesOpportunityAssessment / SalesAction / AgentRun / PendingAction / BusinessOutcome). No second webhook, no second CRM, no free-string opportunity writes (only `transitionOpportunity`).

### Fixes made during closure (all inside #203's own code)

1. **Website replay idempotency (Trade layer)** — `ingestWebsiteInquiry`: identical rendered content for the same prospect within 24h returns the existing message with `replay: true`; webhook response carries `replay`.
2. **Intake replay idempotency (Spine layer)** — `intakeInquiry`: identical rendered content for the same customer within 24h returns the existing interaction/opportunity (`replay: true`), creating no customer/opportunity/interaction/action.
3. **Stale-draft supersession** — when a newer inbound message produces a new reply draft, older pending `sales.send_inquiry_reply` drafts for the same opportunity are rejected through `approval/port.rejectApprovalItem` (best-effort).
4. **`STALE_DRAFT` executor gate** — `exec-sales-inquiry-reply` refuses to send a draft whose `replyToInteractionId` is no longer the latest inbound interaction.
5. **`INACTIVE_MEMBERSHIP` executor gate** — the approver must hold an active membership in the org (platform admins excepted) at the send boundary, not only at the HTTP boundary.
6. **Supervisor cancellation gate** — the FDE checks `isAgentRunCancelled` before the approval step; a cancelled run produces no draft.
7. **FDE drafts decoupled from `PendingAction.agentRunId`** — see §7 for the probe evidence; run traceability kept in `payload.metadata.agentRunId`, `SalesAction.agentRunId`, and the `approval.required` run event.

## 5. Trade regression results (#198 / #201 / #202 / #204)

| Check | Evidence |
|---|---|
| Webhook authentication, honeypot, UTM/source metadata | `src/app/api/trade/webhook/website/route.ts` unchanged except two response fields (`replay`, `opportunityId/spine`); `website-inquiry.test.ts` 8/8 (normalize / honeypot / UTM / company fallback / message rendering) |
| TradeProspect intake + TradeMessage timeline | DB e2e Case A: 1 prospect, 1 inbound message, stage `replied`, `convertedToSalesOpportunityId` back-filled; Case C: 2 messages on 1 prospect |
| Trade Inbox | `inbox-service.test.ts` 7/7; `trade-layout.test.ts` 5/5 (two-tier sidebar; primary keys unchanged) |
| Unknown-sender handling (#201) | `channel-service.ts` auto-merged untouched; `inquiry-rules` 8/8, `inquiry-design-rules` 8/8, `inquiry-sla` 5/5 (#202/#204) |
| Notification behaviour | main's `notifyInquiryMembers` path preserved verbatim (idempotent `sourceKey`); Spine adds its own owner notification (`revenue_opportunity`) |
| Existing Trade navigation | `navigation-ia` 51/51, `nav-active-matcher` 21/21, `navigation-workspace` 30/30, `trade-layout` 5/5 |

Additive guarantee: the Spine runs after the Trade writes and is wrapped; a Spine failure returns `spine.code = SPINE_FAILED` with the Trade lead already persisted and notified.

## 6. Revenue Spine results

DB e2e (`revenue-spine-db.isolated.test.ts`) on an isolated Neon branch (production snapshot child) after the final sync: **84 / 84 (run 5 on `br-bitter-glade-antk9l7j`; earlier runs on the two previous branches: 79/79 after sync 1, 79/79 after sync 2)**. Chain covered: website inquiry → SalesCustomer → SalesOpportunity → RFQ + evidence (quantity 3000 traced to the source interaction, confidence ≥ 0.85) → research (hotel_supplier, Canada) → qualification (`needs_info`) → score HIGH (≥ 70) → missing information (`size, material, destinationCity, requiredDeliveryDate`) → reply draft (no MOQ / price / lead time / certification / payment terms; "confirm these internally") → PendingAction → human approval through `approval/port` (real UI path) → send executor boundary (injected sender) → follow-up (`follow_up` next action, `followUpCount` 1) → customer reply (`CUSTOMER_REPLIED`, `reply_customer`) → FDE re-run → `rfq_ready` → quoting/quoted (`QUOTE_SENT`) → sample (`SAMPLE_REQUESTED`) → negotiation (`NEGOTIATION_STARTED`) → won (`DEAL_WON`, `REVENUE_RECORDED` 25 500) → attribution (`fdeInfluencedRevenue` 25 500, gross profit `null`) → cockpit and queue. Lost path: `DEAL_LOST` with `fdeSourced`/`fdeInfluenced` retained.

Website idempotency (PART 4), all on the real webhook service (`ingestWebsiteInquiry`):

| Case | Result |
|---|---|
| A brand-new inquiry | 1 TradeProspect · 1 inbound TradeMessage · 1 SalesCustomer · 1 SalesOpportunity · 1 CustomerInteraction · 1 SalesRfq · 1 FDE AgentRun · 1 pending draft |
| B exact replay | `replay = true`, all counts unchanged (Trade and Spine layers each idempotent) |
| C same buyer, new message | +1 TradeMessage, +1 CustomerInteraction, same customer/opportunity, RFQ merged (quantity kept, size/destination added), +1 FDE run, old draft superseded (1 pending, 1 rejected); stale draft refused by executor (`STALE_DRAFT`) |
| D second employee, same company | account and open opportunity reused (domain match); Trade side keeps a distinct prospect per contact; interaction keeps the second contact's evidence; primary contact not overwritten |

## 7. Authorization / side-effect results

| Gate | Evidence |
|---|---|
| Tenant isolation | all Spine queries `orgId`-scoped; e2e: ORG2 cockpit sees 0 of ORG's data; cross-org transition → `NOT_FOUND`; cross-org approve → denied |
| Inactive membership denied | API boundary: `resolveTradeOrgId` returns 403 for an inactive member (e2e §12); send boundary: `INACTIVE_MEMBERSHIP` refusal in the executor (e2e §5) |
| Cross-org access denied | `resolveTradeOrgId` 403 for a member of another org requesting this org (e2e §12) |
| Trusted principal server-derived | FDE principal = `SalesOpportunity.assignedToId ?? Organization.ownerId` from the DB; API principal from `requireRole` session; body `orgId` is only cross-checked |
| FDE never sends | the FDE's only side-effect precursor is `requestApproval`; sending exists solely in `exec-sales-inquiry-reply` behind `executePendingAction` |
| AI Draft → PendingAction → Human Approval → executor | e2e §5 via `approveApprovalItem`; B2 CAS blocks the second approval (`duplicate: true`, direct executor call `ALREADY_EXECUTED`) |
| Reject does not send | e2e §5 (`sent.length === 0` after reject) |
| Duplicate approval cannot double-send | e2e §5 (`sent.length === 1`) |
| Supervisor cancellation effective | e2e §12: run cancelled mid-pipeline → status `cancelled`, no draft created |
| Corporate Memory access policy | no `corporate-memory` import in `src/lib/revenue-spine` or the executor (grep = 0) |

Probe evidence behind fix 7 (run on the isolated branch, `approval/port` on drafts linked to an FDE run): `rejectApprovalItem` 12.5 s → `reconcile failed: Transaction not found` (Prisma interactive-transaction timeout inside `reconcileAssistantRunFromPendingActions`), run left inconsistent; `approveApprovalItem` on a completed run rewrote it to `awaiting_approval`; unlinked drafts decide in ≈2–3 s with `run: null`. Inside the FDE's supersede loop the same reconcile blocked the pipeline. The reconcile machinery derives an assistant conversation run's status from its PendingActions; an FDE run is a terminal deterministic pipeline, so FDE drafts are no longer linked to `AgentRun` (`source.runId` omitted). No pg lock waits were observed during the probe (`pg_stat_activity` samples empty), consistent with a remote-latency transaction timeout rather than a deadlock.

## 8. Migration safety evidence

- `20260906120000_mengxin_fde_revenue_spine` unchanged since #203: additive only (nullable/defaulted columns, 3 new tables, indexes, FKs); sha256 `037871de5f2ec3ff068daade6b25d7b8105bbe9eace48924fd47a7138dd246d7` (`verify-migration-history.ts` IMMUTABLE).
- Registered in `src/lib/release/expected-migrations.ts`, `scripts/check-release-safety.test.ts` (27/27), `scripts/verify-migration-history.ts` (76/76), `release/__tests__/drift.test.ts` (27/27).
- Isolated Neon branches (project `polished-thunder-16018212`, children of production `br-green-boat-ann7k5yf`): `preview-mengxin-fde-v1-closure-202609060845` (`br-mute-feather-antg0gnn`), `preview-mengxin-fde-v1-closure2-202609060935` (`br-long-field-anyanhio`), `preview-mengxin-fde-v1-closure3-202609060952` (`br-bitter-glade-antk9l7j`). On each, `prisma migrate status` listed **only** the #203 migration as pending (main's `20260905160000` and `20260906090000` were already applied in production), `prisma migrate deploy` applied it, `migrate status` reported up to date. All three branches deleted after evidence capture; connection-string files removed.
- Never executed: `prisma db push`, manual DDL, production `migrate deploy`, production seed.

## 9. Local test results (final tree)

| Suite | Result |
|---|---|
| `tsc --noEmit` | clean |
| `npm run lint` + `npm run lint:baseline` | 41 errors / 136 warnings = repo baseline (53/111 at baseline commit); **PASS**, no new fingerprint; 0 problems in files touched by #203 |
| `scripts/test-runtime-architecture.sh` | manifest 59, risk 61, descriptor 19, run-status 134, negative 25, facade 18, conformance 9 — all pass |
| `check-release-safety` / `verify-migration-history` / `drift` | 27 / 76 / 27 |
| Spine pure suites (`opportunity-stage`, `rfq-extract`, `scoring-draft`) | 9 / 11 / 16 |
| #198 `website-inquiry` | 8 |
| #201 `inbox-service`, `trade-layout` | 7, 5 |
| #202/#204 `inquiry-rules`, `inquiry-design-rules`, `inquiry-sla` | 8, 8, 5 |
| navigation (`navigation-ia`, `nav-active-matcher`, `navigation-workspace`) | 51, 21, 30 |
| DB e2e (isolated Neon, real Prisma) | 84 / 84 (run 5 on `br-bitter-glade-antk9l7j`; earlier runs on the two previous branches: 79/79 after sync 1, 79/79 after sync 2) |

## 10. GitHub CI results

Workflow `CI` (`.github/workflows/ci.yml`, `on: pull_request` + push to main; `release-drift.yml` is schedule/dispatch only and not PR-triggered). Runs are listed for every head pushed during closure; the first pushed head (`ff9f764b`) produced no run because GitHub does not run `pull_request` workflows while the PR is unmergeable (main had advanced to `a69f7c61`).

| WORKFLOW | HEAD | STATUS | CONCLUSION | RUN URL/ID |
|---|---|---|---|---|
| CI · validate-lint-typecheck-test-build | `04009512` (sync 2) | completed | success | https://github.com/LucasJ880/-/actions/runs/34004903994 (job 101410203399) |
| CI · validate-lint-typecheck-test-build | `111e91b7` (code HEAD) | completed | success | https://github.com/LucasJ880/-/actions/runs/34005716542 (job 101412386765) |
| Vercel – qingyan-staging (preview deploy) | `111e91b7` | completed | pass / SUCCESS | https://vercel.com/lucas-9039s-projects/qingyan-staging/9DUmuZgwHYxdQCis94UMeC1RrceU |
| Vercel – - (production project; ignored build step) | `111e91b7` | completed | pass / SUCCESS ("Canceled by Ignored Build Step") | https://vercel.com/lucas-9039s-projects/-/5ep3MKvLMm8x5PCjujPK3tBeqLBv |
| Vercel Preview Comments | `111e91b7` | completed | pass / SUCCESS | https://vercel.com/github |

`gh pr checks 203` after run 34005716542: all four checks `pass`. The commit adding this report is docs-only; its CI run is reported in the closing chat message (it cannot be recorded here before it exists). No workflow was weakened, no test removed.

## 11. Post-sync HEAD

```text
PR203_POST_SYNC_HEAD (code)   = 111e91b7748778df79c17a9c26ca3ec987a703f7
  ├─ a6270e26  merge: origin/main (#198 merged + #201) — 3 conflicts resolved
  ├─ ff9f764b  fix: replay idempotency + draft supersession + STALE_DRAFT + FDE drafts decoupled from run reconcile
  ├─ 04009512  merge: origin/main (#202 + #204) — 2 registry conflicts resolved
  └─ 111e91b7  fix: INACTIVE_MEMBERSHIP executor gate + supervisor-cancel gate + boundary DB tests
origin/main a69f7c61 is an ancestor of HEAD (verified with git merge-base --is-ancestor after each push).
The commit that adds this report is docs-only and follows 111e91b7; its SHA is recorded in §10.
```

## 12. PR mergeability

```text
GET /repos/LucasJ880/-/pulls/203 (after push of 111e91b7):
  mergeable       = true
  mergeable_state = unstable → clean (after CI run 34005716542 completed: mergeable=true, mergeable_state=clean)
  rebaseable      = false      (merge commits in branch history; irrelevant for a merge-commit PR)
  head            = 111e91b7748778df79c17a9c26ca3ec987a703f7
  base            = a69f7c6191a2eaf634ac2388297b72ad52bf80d7
Draft status kept (lane workflow: Draft PR → gate → STOP). Not merged.
```

## 13. Unresolved issues (not blockers; recorded for final review)

1. **Two analyses per website inquiry.** #202's `TradeInquiryAnalysis` (LLM extraction, reply draft, quote suggestion, sample advice; shown in the Trade Inbox) and the Spine's FDE (evidenced RFQ, explainable score, approval-gated draft) both run on the same message. Complementary by decision, but doubled LLM cost and two reply drafts for the same inquiry. P1: let the Trade Inbox consume the Spine RFQ/draft, or feed `TradeInquiryAnalysis.extracted` into the Spine as an evidence source.
2. **Trade Inbox reply is not mirrored into the Spine.** `POST /api/trade/inbox/[prospectId]/reply` sends via Resend on a human click (no PendingAction, Trade-lane design) and writes an outbound `TradeMessage`; the Spine's `lastOutboundAt`/next action and its pending FDE draft do not learn of it. P1: mirror Trade outbound messages into `logRevenueInteraction` and supersede the FDE draft.
3. **Notification fan-out.** One inquiry can produce a Trade member notification, a Spine owner notification, and an approval notification for the same person. P1 consolidation.
4. `/revenue` sits in the trade sidebar's "更多" partition (kept #201's primary list intact). UX decision for the owner.
5. Pre-existing, observed during the probe: `requestApproval` with `source.stepKey`/`toolName` omitted stores `undefined` metadata fields, which makes `computePayloadHash` mismatch on approve (`PAYLOAD_HASH_MISMATCH`). #203 always passes both; not changed here.

## 14. Status

```text
MENGXIN_FDE_V1_MERGE_CLOSURE = READY_FOR_FINAL_REVIEW
```

Not done by design (hard stop): PR #203 not merged; no production deploy, migration, or seed; V2 not started; no change to Trade Intelligence, the runtime architecture, or ERP scope.

Recommended sequence after final review: merge #203 → `safe-migrate-deploy` for `20260906120000_mengxin_fde_revenue_spine` → `scripts/seed-revenue-spine-policy.ts --org-code mengxin-home-textile --write` → confirm website channel secret + email provider → submit the acceptance inquiry through the Mengxin website form → `PRODUCTION_VALIDATED`.
