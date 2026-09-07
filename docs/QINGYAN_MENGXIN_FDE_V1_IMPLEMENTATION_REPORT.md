# QINGYAN × MENGXIN FDE 1.0 — Revenue Spine + Inbound Sales FDE Implementation Report

- Date: 2026-09-06
- Branch: `feature/mengxin-fde-revenue-spine` (base `origin/main` @ `3426db50`, merged `feature/website-inquiry-webhook` PR #198 @ `32e853bf`)
- Audit (PART 0): `docs/QINGYAN_MENGXIN_FDE_REVENUE_AUDIT.md`
- Scope: PART 1–16 of the brief. No production writes; migration applied and tested on an isolated Neon branch only.

---

## 1. Architecture before

```
Website form → POST /api/trade/webhook/website (PR #198, Draft) → TradeCampaign "网站询盘" → TradeProspect → TradeMessage → notification
                                                                         ↓
                                                              (manual) convert-to-sales → SalesCustomer / SalesOpportunity
SalesOpportunity.stage = free string (Sunny window-covering values hard-coded in 6+ modules)
No RFQ model · no inbound digital employee · no explainable score · no next-action engine · no outcome linkage · no attribution · no OEM cockpit
```

## 2. Architecture after

```
Website form ─► /api/trade/webhook/website ─► ingestWebsiteInquiry (Trade lane unchanged)
                                                   └─► intakeInquiry()  ── canonical, source-agnostic ──────────────────────────────┐
Manual / email / trade-show ─► POST /api/revenue/inquiries ─────────────────────────────────────────────────────────────────────────┤
                                                                                                                                     ▼
   normalize → 4-level dedupe → SalesCustomer (create/link) → SalesOpportunity (new_inquiry | attach) → CustomerInteraction (UTM/page)
   → SalesAction (employeeKey=inbound_sales_fde, SLA due) → runInboundSalesFde()
        AgentRun fde_inbound_sales: research → RFQ extract (+SalesRfqEvidence) → factory knowledge → score (SalesOpportunityAssessment)
        → qualify (enriching → needs_info | qualified | rfq_ready | disqualified) → missing info → grounded reply draft (guardrails)
        → requestApproval(sales.send_inquiry_reply)  [never sends]  → next action → notify owner
   Human approves (assistant inbox / /revenue/[id]) → executor exec-sales-inquiry-reply → Gmail | Resend | fail-closed
        → CustomerInteraction(outbound) → lastOutboundAt/followUpCount → SalesAction executed → next action (follow_up)
   Customer replies (webhook re-submit / logged) → CUSTOMER_REPLIED → reply_customer → FDE re-run (RFQ merge, new draft)
   Stage transitions (transitionOpportunity only) → BusinessOutcome (RFQ_RECEIVED / QUOTE_SENT / SAMPLE_REQUESTED / NEGOTIATION_STARTED / DEAL_WON / DEAL_LOST / REVENUE_RECORDED)
   Cron /api/cron/revenue-spine (15 min): queued FDE sweep · next-action recompute · due follow-up SalesActions + notifications
   /revenue cockpit + /revenue/[id] detail (trade / sales / boss / manager / admin; org-scoped)
```

## 3. Files changed

New — library `src/lib/revenue-spine/`:
`opportunity-stage.ts`, `normalize.ts`, `business-days.ts`, `lexicon.ts`, `policy.ts`, `research.ts`, `scoring.ts`, `factory-knowledge.ts`, `reply-draft.ts`, `next-action.ts`, `outcomes.ts`, `attribution.ts`, `transition.ts`, `interactions.ts`, `customer-match.ts`, `inquiry-intake.ts`, `daily-actions.ts`, `cockpit.ts`, `access.ts`, `index.ts`, `rfq/{types,heuristic-extractor,llm-extractor,extract,missing-info,persist}.ts`, `fde/{actions,inbound-sales}.ts`, `__tests__/{opportunity-stage,rfq-extract,scoring-draft}.test.ts`, `__tests__/revenue-spine-db.isolated.test.ts`

New — approval executor: `src/lib/pending-actions/exec-sales-inquiry-reply.ts`

New — API: `src/app/api/revenue/{cockpit,queue,inquiries,policy}/route.ts`, `src/app/api/revenue/opportunities/route.ts`, `src/app/api/revenue/opportunities/[id]/{route,transition/route,interactions/route,run-fde/route}.ts`, `src/app/api/cron/revenue-spine/route.ts`

New — UI: `src/app/(main)/revenue/page.tsx`, `src/app/(main)/revenue/[id]/page.tsx`

New — ops: `prisma/migrations/20260906120000_mengxin_fde_revenue_spine/migration.sql`, `scripts/seed-revenue-spine-policy.ts`, `docs/QINGYAN_MENGXIN_FDE_REVENUE_AUDIT.md`, this report

Modified: `prisma/schema.prisma`, `src/lib/pending-actions/{types,executor}.ts`, `src/lib/trade/website-inquiry.ts` (+ spine hook), `src/app/api/trade/webhook/website/route.ts` (response + maxDuration), `src/lib/navigation/registry.ts`, `src/lib/permissions-client.ts`, `src/lib/tenancy/modules.ts`, `src/lib/i18n/{messages,en,zh}.ts`, `src/lib/api-fetch.ts`, `src/lib/automation/registry.ts`, `src/app/(main)/notifications/page.tsx`, `vercel.json`, `scripts/{test-ci-unit.sh,test-all.sh,check-release-safety.test.ts,verify-migration-history.ts}`, `src/lib/release/expected-migrations.ts`

## 4. Schema changes (all additive, nullable or defaulted)

| Model | Added |
|---|---|
| `SalesCustomer` | `contactName`, `website`, `country`, `emailDomain`, `normalizedName`; indexes `(orgId,emailDomain)`, `(orgId,normalizedName)` |
| `SalesOpportunity` | `stageChangedAt`, `nextActionType`, `nextActionReason`, `lastInteractionAt`, `lastCustomerReplyAt`, `lastOutboundAt`, `followUpCount`, `score`, `scoreGrade`, `scoredAt`, `buyerType`, `market`, `fdeSourced`, `fdeInfluenced`, `firstFdeActionId`, `lastFdeActionId`; relations `rfq`, `assessments`; indexes `(orgId,stage)`, `(orgId,nextFollowupAt)`. `nextFollowupAt` (existing) is the `nextActionAt`; `assignedToId` (existing) is the `ownerId`. |
| `SalesAction` | `employeeKey`, `actionType`, `inputContext`, `recommendedAction`, `approvalRequired`, `pendingActionId`, `agentRunId`, `interactionId`, `approvedById`, `executedAt`, `resultJson`; 3 indexes |
| `BusinessOutcome` | `salesActionId` + index (Action → Outcome) |
| new `SalesRfq` | 1:1 per opportunity, all 21 RFQ fields, `missingFields`, `status`, `language`, `extractionMethod`, `version`, `agentRunId` |
| new `SalesRfqEvidence` | `field`, `value`, `confidence`, `sourceInteractionId`, `sourceKind`, `evidenceText`, `extractedBy` |
| new `SalesOpportunityAssessment` | versioned score snapshot: `score`, `grade`, `priority`, `dimensionsJson`, `reasoning`, `missingInformation`, `recommendedNextAction`, `policyVersion`, `agentRunId` |

No new CRM/lead/opportunity tables. Model names avoid the runtime-architecture architectural-name guard.

## 5. Migration

- `20260906120000_mengxin_fde_revenue_spine` — generated with `prisma migrate diff` (origin/main schema → new schema), header-annotated, purely additive.
- Registered in `src/lib/release/expected-migrations.ts`, `scripts/check-release-safety.test.ts`, `scripts/verify-migration-history.ts` (sha256 `037871de…46d7`).
- Discipline followed: isolated Neon branch `preview-mengxin-fde-v1-202609060748` (child of production snapshot, project `polished-thunder-16018212`) → `prisma migrate status` (only this migration pending) → `prisma migrate deploy` (applied cleanly) → integration tests (65/65) → branch deleted after the run. No `db push`, no production connection, no destructive statement.

## 6. Inquiry flow

`intakeInquiry()` (`inquiry-intake.ts`): normalize email/company/phone → `matchCustomer()` (email → company domain → normalized company name → phone; free-mail domains never match by domain) → create or link `SalesCustomer` (dedupe keys back-filled, contact name kept) → if the customer already has an open pre-quote opportunity the message is attached to it (no parallel opportunity), otherwise a new `SalesOpportunity` (`stage=new_inquiry`, `source`, `market`, `fdeSourced`, `sourceTradeProspectId`) → `CustomerInteraction` (inbound, channel `website`, `rawMessages` with page/UTM/contact) → `SalesAction` (`inbound_inquiry` / `inbound_followup_message`, SLA due from policy) → next action → audit → notification. Owner = assigned rep → org `trade`/`sales` member → org owner. Invalid email / no contact / empty message are rejected with codes.

The website webhook keeps the Trade-lane writes (PR #198) and back-fills `TradeProspect.convertedToSales*` with the canonical customer/opportunity ids.

## 7. Opportunity state machine

`opportunity-stage.ts`: 15 canonical stages (`new_inquiry … won`, `lost`, `nurture`, `stale`, `disqualified`), `ALLOWED_TRANSITIONS`, `canTransition/assertTransition`, `LEGACY_STAGE_MAP` (Sunny values project to the family for reporting). `transitionOpportunity()` is the only writer: validates, sets `stageChangedAt/wonAt/lostAt/lostReason`, records stage-implied outcomes, audits, recomputes the next action. Sunny opportunities are refused by the engine (`LEGACY_STAGE`) and untouched.

## 8. RFQ model

`SalesRfq` + `SalesRfqEvidence`. Extraction = deterministic heuristic (`heuristic-extractor.ts`: quantity/unit, product → category via configurable keyword map, material, composition/GSM, size, color, logo/customization, packaging, certification, sample, target price/currency, country/city, Incoterm, delivery date incl. relative, buyer type, application, language zh/en/mixed) + optional LLM (`llm-extractor.ts`, JSON with per-field evidence; evidence not found in source → confidence capped 0.4) merged in `extract.ts` (LLM only wins when grounded and more confident). Every persisted field has evidence rows with `sourceInteractionId`. Re-extraction merges: new values overwrite, missing values keep history, version increments.

## 9. FDE workflow

`fde/inbound-sales.ts` `runInboundSalesFde()`: one `AgentRun` (`runType=fde_inbound_sales`, session channel `fde`) with typed events: `run.started` → `tool.started/completed` (research, extract) → `retrieval.*` (factory knowledge) → `agent.output` (score, qualify, missing info, draft, next action) → `approval.required` → `run.completed/failed`. Auto-executed: research, extraction, classification, scoring, missing-info, draft, next action, notifications. Never executed by the FDE: sending. Scoring (`scoring.ts`) = Product Fit 25 / Commercial 20 / Buyer Quality 20 / Intent 15 / Completeness 10 / Strategic 10 with per-dimension reasons; grades HOT ≥90 / HIGH ≥70 / MEDIUM ≥50 / LOW from policy. Missing-info engine (`rfq/missing-info.ts`) orders feasibility → costing → lead time and caps questions per reply. Reply draft (`reply-draft.ts`) is template-grounded (facts from RFQ, "needs internal confirmation" for MOQ / pricing / lead time / certification / samples), optional LLM tone polish, then `checkDraftGuardrails` (MOQ numbers, prices, lead-time days, certification claims, payment terms, discounts) — violations fall back to the template.

## 10. Approval flow

`requestApproval()` (canonical R1 facade) creates a `PendingAction` of new type `sales.send_inquiry_reply` (risk `l3_strong` → `high_impact`, approver = opportunity owner, TTL 72h, idempotency `revenue-spine:reply:<opp>:<interaction>:v<n>`; an open draft for the same inbound message is reused, a rejected one allows a fresh draft). Execution only via `pending-actions/executor.ts` → `exec-sales-inquiry-reply.ts`: org check, opportunity/customer/recipient consistency, sender = approver's Gmail (compose scope) → org Resend → `NO_EMAIL_PROVIDER` fail-closed; B2 CAS prevents duplicate sends. Approve/reject from the assistant inbox or `/revenue/[id]` (POST `/api/ai/pending-actions/[id]` with `decision`). Cancelling the run rejects the draft through the existing pending-link mechanism.

## 11. BusinessOutcome integration

`outcomes.ts`: vocabulary `CUSTOMER_REPLIED, RFQ_RECEIVED, QUOTE_CREATED, QUOTE_SENT, SAMPLE_REQUESTED, SAMPLE_SENT, NEGOTIATION_STARTED, DEAL_WON, DEAL_LOST, REVENUE_RECORDED, GROSS_PROFIT_RECORDED`; `entityType=sales_opportunity`; idempotent by `sourceId`; `salesActionId` link; sourceType `business_record` (system/FDE) or `user_confirmed` (human transition, manually verified). `CUSTOMER_REPLIED` is recorded by `logRevenueInteraction` when an inbound follows an outbound. `QUOTE_CREATED` / `SAMPLE_SENT` / `GROSS_PROFIT_RECORDED` are defined but not yet produced (V2 quote engine / shipment tracking / cost basis).

## 12. Revenue attribution

`attribution.ts`: `fdeSourced` (set at intake for AI-discovered sources), `fdeInfluenced` + `firstFdeActionId/lastFdeActionId` (set when an FDE action touches the opportunity). Metrics: `FDE_SOURCED_PIPELINE`, `FDE_INFLUENCED_PIPELINE`, `FDE_INFLUENCED_REVENUE` (won, estimatedValue), `fdeInfluencedGrossProfit = null` (interface defined, no cost data).

## 13. Dashboard

`/revenue` (`cockpit.ts` + `daily-actions.ts`): Qualified Pipeline, Quotes Outstanding, Hot Leads, Follow-ups Due, Samples in Progress, Expected Revenue (stage win probability from policy), Won Revenue (all-time + month), FDE Sourced / Influenced Pipeline, FDE Influenced Revenue, Gross Profit (structured unavailable); Today's Actions counts (Hot Leads / Need Reply / Quote Follow-up / Sample Follow-up / Approval Required / Stale) and queues (Reorder = placeholder data interface over won customers outside the reorder window). `/revenue/[id]`: customer, next action, allowed transitions, RFQ + evidence, score dimensions, draft approvals (approve/reject), interactions (log customer reply → CUSTOMER_REPLIED + FDE re-run), FDE actions, outcomes, agent-run event timeline. Navigation item "收入驾驶舱" (modules `trade|sales`, roles trade/sales/boss/manager/admin).

## 14. Tests

| Suite | Result |
|---|---|
| `revenue-spine/__tests__/opportunity-stage.test.ts` (transitions, invalid, won/lost/nurture, legacy map) | 9/9 |
| `revenue-spine/__tests__/rfq-extract.test.ts` (complete / partial / zh / en / mixed, evidence grounding, LLM parse + merge) | 11/11 |
| `revenue-spine/__tests__/scoring-draft.test.ts` (research, scoring, Mengxin profile, disqualification, policy config, draft + guardrails zh/en, factory knowledge, next action, business days, dedupe keys, queue buckets, role matrix) | 16/16 |
| `revenue-spine/__tests__/revenue-spine-db.isolated.test.ts` (new / existing / duplicate / same-domain / invalid-email inquiry; FDE research → RFQ → score → draft → approval; reject → no send; cross-org approve denied; owner approve → single send; duplicate approve blocked; customer reply → CUSTOMER_REPLIED → re-run → rfq_ready; invalid transition; quoted/sample/negotiation/won/lost outcomes; won/lost attribution; attribution metrics; queue; cockpit; cross-org isolation; audit trail) | 65/65 on isolated Neon branch |
| `trade/__tests__/website-inquiry.test.ts` (PR #198) | 8/8 |
| `scripts/test-runtime-architecture.sh` (R1 guards) | all pass (9/9 conformance) |
| `navigation/__tests__/navigation-ia.test.ts` | 51/51 |
| `scripts/check-release-safety.test.ts` / `scripts/verify-migration-history.ts` / `release/__tests__/drift.test.ts` | 27 / 74 / 27 |
| `tsc --noEmit` | clean |
| `eslint` on touched files | 0 errors, 0 warnings |

Suites registered in `scripts/test-ci-unit.sh` and `scripts/test-all.sh` (DB suite self-skips without an isolated database).

## 15. Security review

- Tenant isolation: every query is `orgId`-scoped; API org resolution reuses Security-1 `resolveTradeOrgId` (active membership; platform admins must pass an explicit org); `apiFetch` auto-appends the selected org for `/api/revenue/*`. Cross-org read/transition/approve covered by tests.
- Trusted principal: FDE runs under the opportunity owner (or org owner) — never a synthetic user; audit rows and outcomes carry a real `userId` with `source=fde` in the payload.
- Canonical authorization: role gate `trade/sales/boss/manager/admin` (`access.ts`); policy edits limited to `boss`/admin. Finding from the audit (P0-14): platform `trade` users have no `sales.*` permission bindings, so the spine exposes its own membership-gated ORG-scope API instead of reusing `/api/sales/*` (documented, no bypass of `authorize()` for the Sunny lane).
- Tool approval: the only external side effect (email send) goes through `requestApproval` → `PendingAction` → executor; no direct `pendingAction` writes; runtime-architecture guard green.
- Supervisor cancellation: drafts carry `agentRunId`; existing cancel → reject linkage applies.
- Corporate memory access policy: not touched (no memory reads).
- Website webhook: unchanged PR #198 secret + honeypot; the spine runs after the Trade write and is wrapped so a spine failure never loses the lead (`spine.code=SPINE_FAILED` in the response).
- Non-production side effects: Resend path calls `assertSideEffectOrThrow("email")`; Gmail path inherits `sendGmail` fail-closed; test sender injection is process-local.

## 16. Remaining P1

1. Account / Contact separation (`SalesContact`); V1 keeps one `SalesCustomer` per company with `contactName` and per-interaction contact snapshots.
2. Collapse `TradeProspect.stage` for website leads into the canonical opportunity (currently linked both ways; `/trade/prospects` still shows the trade stage).
3. `PATCH /api/sales/opportunities/[id]` still accepts arbitrary Sunny stages (Sunny lane intentionally untouched).
4. Inbound email ingestion (Gmail/IMAP → `logRevenueInteraction`) — replies are logged manually or via website re-submission in V1.
5. `DAILY_AGENT_RUNS` org quota (default tier) caps FDE runs per day; raise the quota policy for `runType=fde_inbound_sales` before high inquiry volume.
6. UTM / referrer as first-class columns for marketing attribution reports (stored in `rawMessages`/`analysisResult` JSON now).
7. Factory knowledge data sources (MOQ / lead time / certification / sample policy) — interface returns `unavailable`.
8. Stale opportunities are surfaced, not auto-transitioned; decide whether cron should move them to `stale`.

## 17. Remaining P2

1. Reorder prediction (placeholder list only).
2. LLM entity research (company enrichment) beyond deterministic classification.
3. Agent learning from `BusinessOutcome` (practice miner not fed by the spine).
4. Sunny lane migration onto the canonical stage family.
5. Holiday calendar for business-day SLA.

## 18. Recommended next phase

Proceed to **QINGYAN_MENGXIN_FDE_V2_QUOTATION_ENGINEER**: RFQ (complete, evidenced) → Factory Knowledge (`getMOQ/getLeadTime/getCertification/getSamplePolicy/getCostBasis` backed by real data) → Historical Quote → Cost → Margin (`minimumMargin` in business profile) → Recommended Price → Quote Draft (TradeQuote/SalesQuote) → Approval (`sales.send_quote` via `requestApproval`) → `QUOTE_CREATED/QUOTE_SENT` outcomes → `GROSS_PROFIT_RECORDED`.

Activation checklist for production (not done here): merge PR #198 or this branch (carries it), run `safe-migrate-deploy` for `20260906120000_mengxin_fde_revenue_spine`, `npx tsx scripts/seed-revenue-spine-policy.ts --org-code mengxin-home-textile --write`, confirm the website channel secret, confirm an email provider (Gmail OAuth for the approver or `RESEND_API_KEY` + `RESEND_FROM_EMAIL`), then submit the acceptance inquiry through the website form.

```text
MENGXIN_FDE_V1_STATUS = PASS
```
