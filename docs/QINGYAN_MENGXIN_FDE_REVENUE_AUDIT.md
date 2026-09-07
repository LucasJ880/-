# QINGYAN × MENGXIN FDE 1.0 — Revenue Spine Repository Audit (PART 0)

- Date: 2026-09-06
- Baseline audited: `origin/main` @ `3426db50` (PR #196) + open Draft PR #198 `feature/website-inquiry-webhook` @ `32e853bf`
- Scope: read-only audit of the inquiry → CRM → AI → outcome chain before any Revenue Spine code is written.
- Method: schema census of `prisma/schema.prisma` (266 models), route census under `src/app/api`, library census under `src/lib/{sales,trade,agent-core,agent-runtime,pending-actions,approval,employee-ai,digital-employees,secretary,proactive}`, governance census (`runtime-architecture/manifest.ts`, R1 development rules, migration registries).

---

## A. Current Flow — Website → API → Database → CRM → AI

### A.1 Where the website inquiry enters today

| Question (brief §三) | Finding |
|---|---|
| 1. Which API | `POST /api/trade/webhook/website` — **exists only in open Draft PR #198**, not on `main`. On `main` the only inbound webhooks are `/api/trade/webhook/{wechat,whatsapp}`, `/api/webhooks/firecrawl/market-intelligence`, `/api/integrations/activepieces/webhook` (marketing), `/api/messaging/wecom/callback`. There is no website inquiry endpoint on `main`. |
| 2. Which table | PR #198: `TradeCampaign` (auto-created "网站询盘") → `TradeProspect` (source=`website`, stage `new`→`replied`) → `TradeMessage` (direction=inbound, channel=website, content = rendered text block). **Nothing is written to `SalesCustomer` / `SalesOpportunity` / `CustomerInteraction`.** |
| 3. Customer created | No. Only `TradeProspect` (a lead record in the Trade lane). |
| 4. Opportunity created | No. |
| 5. Dedupe | Email exact match (case-insensitive) against `TradeProspect.contactEmail` in the same org. No domain / company-name / phone matching. |
| 6. email / phone / company / message saved | email → `contactEmail`; company → `companyName` (fallback name → email domain → placeholder); phone and message are **not stored as fields**, only embedded in the rendered `TradeMessage.content` text. |
| 7. website source / UTM / referrer | `page`, `utm_*` are captured by `normalizeInquiry` but persisted only inside the rendered `TradeMessage.content` text; no structured column, no `TradeProspect.source` beyond `"website"`. |
| 8. AI action triggered | No. No AgentRun, no research, no extraction, no scoring. |
| 9. Notification | Yes. `createNotificationsForUsers` to org members with platform role `trade/boss/manager/admin/super_admin`, type `followup`, priority high. |
| 10. SLA / follow-up | `nextFollowUpAt = now` on the TradeProspect (enters the trade "today's follow-up" list). No SLA clock, no escalation, no follow-up cadence tied to the inquiry. |

### A.2 End-to-end chain as it exists (PR #198 applied)

```
mengxinhometextile.com Contact Us form
  → fetch POST /api/trade/webhook/website  (secret via header / query / body; CORS *; honeypot)
  → normalizeInquiry()            src/lib/trade/website-inquiry.ts
  → resolveWebsiteChannelBySecret (TradeChannel.channel="website", config.secret, timingSafeEqual)
  → ingestWebsiteInquiry()
      ensureInquiryCampaign        TradeCampaign "网站询盘"
      findFirst TradeProspect by contactEmail (dedupe level 1 only)
      createProspect()             src/lib/trade/service.ts  (TradeProspect)
      tradeMessage.create          inbound text block
      tradeProspect.update         lastContactAt / nextFollowUpAt=now / stage→replied
      createNotificationsForUsers  in-app notification
  → (end)  — no SalesCustomer, no SalesOpportunity, no CustomerInteraction, no SalesAction,
             no AgentRun, no PendingAction, no BusinessOutcome
```

### A.3 Where a TradeProspect can reach the Sales CRM today

`src/lib/trade/sales-conversion.ts` + `POST /api/trade/prospects/[id]/convert-to-sales` — **manual** conversion: candidate customer matching (website domain / email domain / company name exact / contains), creates or links `SalesCustomer` + `SalesOpportunity` (`sourceTradeProspectId`), back-fills `TradeProspect.convertedToSales*`. This is the only existing bridge and it is human-triggered.

### A.4 AI / Digital-employee surfaces that touch Sales today

| Surface | What it does | Relevance |
|---|---|---|
| `src/lib/secretary/domains/sales.ts` `scanSalesDomain` | Signal scan (followup_due, quote_pending, viewed_not_signed, new_lead_stale, stale_opportunity, …) over `SalesOpportunity` using Sunny stages | Pattern for the Daily Revenue Queue; stage vocabulary is Sunny window-covering |
| `src/lib/sales/auto-action-sync.ts` + `/api/cron/sales-actions` (every 15 min) | Converts scan signals into `SalesAction` rows (source `digital_employee_auto`, `activeKey` idempotency, auto-resolve) | Reusable action queue; **must be extended, not duplicated** |
| `src/lib/digital-employees/crm-review.ts`, `activation.ts` | Rule-based CRM review; env-flag rollout (`DIGITAL_EMPLOYEES_ENABLED` + allowlists) | Rollout pattern |
| `src/lib/agent-core` tools `sales_*` (19) / `trade_*` (10) | LLM function-calling tools; RBAC in `tools/_policy.ts`; approvals via `approval-gate.ts` → PendingAction | Tool policy truth source; sales tools are `["admin","sales"]`, trade tools `["admin","trade"]` |
| `src/lib/assistant/scenarios/{customer-followup,gmail-draft}.ts` | Chat-triggered drafts → `createDraft` → PendingAction | Legacy creation helper (baselined); new code must use `approval/port.requestApproval` |
| `src/lib/employee-ai/outcome-service.ts` `createBusinessOutcome` | Canonical BusinessOutcome writer (sourceType must be verifiable; `ai_inferred` rejected) | Reuse as-is |
| `src/lib/agent-runtime/run.ts` (`createAgentRun`, `appendAgentRunEvent`, `completeAgentRun`, `failAgentRun`) | Substrate for AgentRun + typed events (`AgentRunEventType` union, inventory-gated) | Observability for the FDE run |
| `src/lib/approval/request.ts` `requestApproval` | R1 canonical approval creation facade (idempotency key, canonical risk, source linkage) | The only legal way to mint a PendingAction from new code |

---

## B. Existing Reusable Models

### B.1 Directly reusable (no or additive change)

| Model | Reuse | Additive extension needed |
|---|---|---|
| `SalesCustomer` | Account record (orgId, name, email, phone, source, tags, notes, archivedAt) | dedupe keys (`emailDomain`, `normalizedName`), `website`, `country`, `contactName` (Account/Contact split is **P1**, see C) |
| `SalesOpportunity` | Commercial spine (orgId, customerId, title, stage, source, priority, estimatedValue, nextFollowupAt, assignedToId, wonAt/lostAt/lostReason, `sourceTradeProspectId`) | canonical stage values; next-action fields; score cache; FDE attribution; `lastInteractionAt/lastCustomerReplyAt/lastOutboundAt/followUpCount/stageChangedAt` |
| `CustomerInteraction` | Inbound/outbound log (type, direction, channel, language, rawMessages JSON, summary/content, emailMessageId, analysisResult) | none required (channel `website`, type `web_form` fit existing free-text columns) |
| `SalesAction` | Action queue with `activeKey` idempotency, status machine (`action-loop.ts`), priority/dueAt, assignee, notify | FDE tracking columns: `employeeKey`, `actionType`, `inputContext`, `recommendedAction`, `approvalRequired`, `pendingActionId`, `agentRunId`, `approvedById`, `executedAt`, `resultJson` |
| `SalesQuote` | Formal quote (Sunny window-covering pricing engine). For OEM V1 only linkage/`QUOTE_SENT` outcome | none in V1 (V2 quotation engineer) |
| `TradeQuote` / `TradeQuoteItem` | Free-text OEM quote used by Mengxin trial (`/trade/quotes`) | none in V1 |
| `TradeProspect` / `TradeMessage` | Trade-lane lead + timeline (kept for the /trade workspace the Mengxin trial users live in) | none; linked via `SalesOpportunity.sourceTradeProspectId` + `convertedToSales*` |
| `PendingAction` | Approval record; executor in `pending-actions/executor.ts`; port in `approval/port.ts` | new action type `sales.send_inquiry_reply` + executor case (inside canonical approval area) |
| `BusinessOutcome` | Verified outcome ledger (entityType/entityId, actionType, outcomeType, revenueImpact, sourceType, pendingActionId) | `salesActionId` link column for Action → Outcome |
| `AgentSession` / `AgentRun` / `AgentRunEvent` | Run + typed events + trace | none (channel `fde`, runType `fde_inbound_sales`) |
| `EmployeeAiProfile` | Per-user AI profile (roleScope, preferences) | none in V1 |
| `OrgBusinessRule` (`ruleKey`, versioned `configJson`) + `tenancy/scoped-config.ts` | Org-level business configuration | new ruleKeys `revenue_spine.business_profile`, `revenue_spine.policy` (no new model) |
| `Notification` (`createNotificationsForUsers`, sourceKey idempotency) | Human alerting | none |
| `TradeChannel` (`channel="website"`, PR #198) | Website channel secret | none |

### B.2 Reusable services

- `src/lib/trade/sales-conversion.ts`: `websiteHost`, `emailDomain`, candidate matching → basis for the 4-level dedupe.
- `src/lib/trade/website-inquiry.ts` (PR #198): `normalizeInquiry`, `deriveCompanyName`, `buildInquiryMessage`, `resolveWebsiteChannelBySecret`.
- `src/lib/sales/action-loop.ts`: `buildSalesActionActiveKey`, `defaultSalesActionDueAt`, status transitions.
- `src/lib/sales/action-notify.ts`: `notifyNewSalesActions`.
- `src/lib/ai/client.ts`: `createCompletion` (org budget precheck, AgentRun model lifecycle events when `agentRunId` given).
- `src/lib/google-email.ts` (`createGmailDraft`, `sendGmail`) and `src/lib/trade/email.ts` (`sendEmail` via Resend) — the two existing email executors.
- `src/lib/employee-ai/outcome-service.ts`: `createBusinessOutcome`, `isStrongOutcomeEvidence`.
- `src/lib/automation/runner.ts`: `runTrackedAutomation` for cron.

### B.3 Not reusable as the spine (why)

- `TradeProspect.stage` (`src/lib/trade/stage.ts`) is a **lead** lifecycle (new → discovered → researched → qualified → contacted → replied → quoted → follow_up → converted). It is not the commercial lifecycle the brief requires (RFQ / sample / negotiation / won) and Principle 2 mandates `SalesOpportunity`.
- `SalesOpportunity.stage` values today are Sunny window-covering stages (`new_lead, needs_confirmed, measure_booked, quoted, negotiation, signed, producing, installing, completed, lost, on_hold`) hard-coded in `opportunity-lifecycle.ts`, `secretary/domains/sales.ts`, `proactive/sales-scanner.ts`, `digital-employees/crm-review.ts`, `/api/sales/cockpit`, `/api/cron/sales-actions`. `PATCH /api/sales/opportunities/[id]` accepts **any** string for `stage` (no validation).
- `ProjectInquiry` is the tender-side supplier RFQ (projects module) — different domain.

---

## C. Gaps

### P0 — blocks the completion criteria (§三十)

| # | Gap | Evidence |
|---|---|---|
| P0-1 | Website inquiry is not on `main`; PR #198 is an open Draft. Even with #198, the inquiry never reaches `SalesCustomer`/`SalesOpportunity`. | §A.1 |
| P0-2 | No canonical opportunity lifecycle: stage is a free string; no allowed-transition table; Sunny stages hard-coded in 6+ places. | `opportunity-lifecycle.ts`, `/api/sales/opportunities/[id]` |
| P0-3 | Customer dedupe is email-only (Trade) or manual (convert-to-sales). No automatic 4-level dedupe on inquiry. | `website-inquiry.ts`, `sales-conversion.ts` |
| P0-4 | No structured RFQ model; no extraction; no evidence/confidence linkage to the source interaction. | schema census |
| P0-5 | No inbound-sales digital employee: no research/classification/scoring/missing-info/draft pipeline; no AgentRun for an inquiry. | `digital-employees/*`, `agent-core/skills/*` |
| P0-6 | No explainable Opportunity Score / priority policy (only Trade research score 0-10 by LLM). | `trade/scoring-rules.ts` |
| P0-7 | No next-action engine fields on `SalesOpportunity` (`nextActionType/Reason`, `lastCustomerReplyAt`, `lastOutboundAt`, `followUpCount`); `nextFollowupAt` + `assignedToId` exist. | schema |
| P0-8 | Follow-up / SLA policy lives in code constants (`defaultSalesActionDueAt`, `PLATFORM_STALE_DAYS_BY_STAGE`) — not org-configurable. | `action-loop.ts`, `proactive/sales-scanner.ts` |
| P0-9 | `SalesAction` has no FDE tracking columns (employee, input context, recommended action, approval linkage, execution result). | schema |
| P0-10 | `BusinessOutcome` is not linked to `SalesAction`/opportunity lifecycle; no canonical outcome vocabulary (CUSTOMER_REPLIED … GROSS_PROFIT_RECORDED); only API-driven manual writes exist. | `outcome-service.ts`, `/api/business-outcomes` |
| P0-11 | No FDE attribution on opportunities (`fdeSourced` / `fdeInfluenced` / first/last FDE action). | schema |
| P0-12 | No revenue cockpit for the OEM spine; `/api/sales/cockpit` is Sunny-stage-bound and gated to `sales` role. | route census |
| P0-13 | Reply draft → approval → send: `grader.email_draft` creates a Gmail draft only (never sends); no "approve → send" executor; Mengxin users have no Gmail OAuth; Resend keys not configured in production (memory). | `executor.ts`, `google-email.ts`, `trade/email.ts` |
| P0-14 | Authorization: Mengxin trial users are platform role `trade`; `compatProfileKeyForMembership` grants `sales_rep` only to platform role `sales`; org_owner gets `sales.*.read` ORG only. **A `trade` user cannot read `SalesOpportunity` through `resolveSalesAuthorizedWhere`**, so the spine must expose its own membership-gated read API rather than reuse `/api/sales/*`. | `authorization/resolve-effective-permissions.ts`, `role-defaults.ts` |

### P1 — should follow soon, not in this round

| # | Gap |
|---|---|
| P1-1 | Account / Contact separation: `SalesCustomer` is a single record (name+email+phone). Two contacts at one company must share one account but stay distinguishable. V1 stores the extra contact as a `CustomerInteraction` + `contactName`; a `SalesContact` model is deferred (brief §六). |
| P1-2 | Collapse the dual lifecycle: `TradeProspect.stage` continues to exist for the /trade UI; V1 links it (`sourceTradeProspectId`, `convertedToSales*`) and makes `SalesOpportunity` canonical. Retiring the trade stage requires UI migration of `/trade/prospects`. |
| P1-3 | `PATCH /api/sales/opportunities/[id]` still accepts legacy Sunny stages without a transition table (Sunny lane untouched by design in V1). |
| P1-4 | Gross profit: no cost basis for OEM products (`getCostBasis` returns structured unavailable). |
| P1-5 | Email reply ingestion (customer replies by email) is manual in V1 (log interaction API); Gmail/IMAP inbound sync not wired. |
| P1-6 | UTM / referrer are stored structured in `CustomerInteraction.rawMessages`/`analysisResult` JSON, not as first-class columns for marketing attribution reports. |
| P1-7 | Factory knowledge (MOQ / lead time / certification / sample policy) has no data source; V1 returns `unavailable`. |
| P1-8 | `TradeChannel.config.secret` is a shared-secret-in-public-page anti-abuse token (PR #198 design); rate limiting is not present. |

### P2 — later

| # | Gap |
|---|---|
| P2-1 | Reorder-opportunity prediction (placeholder data interface only in V1). |
| P2-2 | Multi-language inquiry NLU beyond zh/en/mixed heuristics + LLM. |
| P2-3 | Agent learning loop from `BusinessOutcome` (practice miner exists for employee-ai but is not fed by the revenue spine). |
| P2-4 | Sunny lane migration onto the canonical stage family (reporting adapter only in V1). |

---

## D. Proposed Canonical Architecture (Revenue Spine V1)

### D.1 Main chain

```
Website form ──► POST /api/trade/webhook/website (PR #198, secret + honeypot)
                    │  normalizeInquiry
                    ▼
            ingestWebsiteInquiry (Trade lane, unchanged: TradeProspect/TradeMessage/notify)
                    │
                    ▼
      revenue-spine/inquiry-intake.ts  intakeInquiry()          ← canonical, source-agnostic
            1. normalize email/company/phone
            2. matchCustomer(): email exact → company domain → normalized company → phone
            3. SalesCustomer create/link (contactName kept; Account/Contact split = P1)
            4. SalesOpportunity create (stage NEW_INQUIRY, source website_inquiry,
               sourceTradeProspectId, fdeSourced=false)   — or attach inbound to open opportunity
            5. CustomerInteraction (inbound, channel website, rawMessages incl. UTM/page)
            6. SalesAction (employeeKey inbound_sales_fde, category inbound_inquiry, SLA due)
            7. AgentRun "fde_inbound_sales" → runInboundSalesFde()
                    │
                    ▼
      revenue-spine/fde/inbound-sales.ts  (deterministic pipeline, every step = AgentRunEvent)
            step research   : company/contact/country/industry/buyerType (heuristic + optional LLM)
            step extract    : SalesRfq + SalesRfqEvidence (field, value, confidence, sourceInteractionId, evidenceText)
            step qualify    : fit / MOQ / potential / urgency  → stage ENRICHING → QUALIFIED | NEEDS_INFO | DISQUALIFIED
            step score      : explainable score (policy-driven weights) → SalesOpportunityAssessment + cache on opportunity
            step missing    : missing-field engine → prioritized questions (feasibility > costing > lead time)
            step draft      : reply draft grounded on facts (no MOQ/price/lead-time promises unless in factory knowledge)
            step approval   : requestApproval(sales.send_inquiry_reply)  → PendingAction (never auto-send)
            step next-action: nextActionType/At/Reason from follow-up policy
                    │
                    ▼
      Human approves ──► pending-actions/executor: sales.send_inquiry_reply
                          → send via Gmail (user OAuth) or Resend (org) — fail-closed if neither
                          → CustomerInteraction outbound, lastOutboundAt, followUpCount+1
                          → SalesAction executed; BusinessOutcome (approval_result) linked by salesActionId
                    │
                    ▼
      Customer replies (website re-submit / logged email) ──► CUSTOMER_REPLIED outcome, lastCustomerReplyAt,
                                                             next action recomputed
      Quote / sample / negotiation / won / lost ──► canonical transitions ──► BusinessOutcome rows
                                                             (QUOTE_SENT … DEAL_WON / DEAL_LOST / REVENUE_RECORDED)
                    │
                    ▼
      Daily Revenue Queue (cron + API)  ──► Revenue Cockpit (/revenue, membership-gated)
```

### D.2 Canonical decisions

1. **Single spine**: `SalesCustomer → SalesOpportunity` is the commercial truth. `TradeProspect` is kept as the trade-lane lead view and linked both ways; it is not a second state machine for the opportunity (its stage is advisory display only). Retirement is P1-2.
2. **Stage family**: `SalesOpportunity.stage` stores canonical OEM values (`new_inquiry, enriching, needs_info, qualified, rfq_ready, quoting, quoted, follow_up, sample, negotiation, won, lost, nurture, stale, disqualified`) defined once in `src/lib/revenue-spine/opportunity-stage.ts` with an allowed-transition table. Legacy Sunny values remain valid for Sunny opportunities; a `LEGACY_STAGE_MAP` projects them onto the canonical family for reporting. A transition service refuses invalid transitions for opportunities in the canonical family; the Sunny lane is untouched in V1.
3. **No new CRM tables**: extensions are additive nullable columns on `SalesCustomer`, `SalesOpportunity`, `SalesAction`, `BusinessOutcome`; the only new models are `SalesRfq`, `SalesRfqEvidence`, `SalesOpportunityAssessment` (none match the runtime-architecture architectural-name guard).
4. **Configuration, not prompts**: business profile, scoring weights/grades, SLA and follow-up cadence live in `src/lib/revenue-spine/policy.ts` defaults overridable per org through `OrgBusinessRule` (`ruleKey = revenue_spine.*`).
5. **Approvals**: only `requestApproval()` from `@/lib/approval/request`; new PendingAction type `sales.send_inquiry_reply` with an executor case in the canonical approval area. Automatic sending is impossible by construction (executor is the only sender).
6. **Observability**: one `AgentRun` per FDE invocation (channel `fde`), typed `AgentRunEvent`s from the existing vocabulary (`run.started`, `tool.started/completed`, `model.*`, `approval.required`, `agent.output`, `run.completed/failed`), plus `SalesAction.inputContext/recommendedAction/resultJson`.
7. **Outcomes**: `revenue-spine/outcomes.ts` wraps `createBusinessOutcome` with the canonical vocabulary (entityType `sales_opportunity`), `sourceType` `business_record` / `approval_result` / `user_confirmed` only.
8. **Authorization**: the revenue APIs resolve the org via active membership (`resolveTradeOrgId`, Security-1) and gate on business platform roles (`trade, sales, boss, manager, admin`); data scope is ORG (Mengxin has 1–3 users). Cross-org access is denied by the org resolver + `orgId` on every query.
9. **Migration discipline**: one additive migration; registered in `check-release-safety.test.ts`, `verify-migration-history.ts`, `src/lib/release/expected-migrations.ts`; applied and tested on an isolated Neon branch only.

### D.3 Dependency on PR #198

The Revenue Spine branch merges `origin/feature/website-inquiry-webhook` (PR #198) so the inquiry entry point is real code, and hooks `intakeInquiry()` into `ingestWebsiteInquiry()`. If #198 merges first, the merge is a no-op; if the Revenue Spine PR merges first, it carries #198's changes.
