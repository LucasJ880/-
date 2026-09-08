# QINGYAN_MENGXIN_FDE_V1 — Production Validation (two-stage merge + activation)

- Date: 2026-09-07 (China Standard Time morning)
- Operator: Claude Code on Lucas's behalf, under the task brief `QINGYAN_MENGXIN_FDE_V1_TWO_STAGE_MERGE_AND_ACTIVATION`
- Scope: merge #203 and #205, controlled production activation (migration, policy seed, channel readiness), one real website acceptance inquiry, human approval, P0.5 real-path check. No V2 work.

## 1. Pre-merge freeze (PART 1)

```text
PRE_MERGE_MAIN_SHA = a69f7c6191a2eaf634ac2388297b72ad52bf80d7   (matched expected)
PR203_ACTUAL_HEAD  = 4765b3e5cb459579cd23f29d1bf6b00e242bfdc3   (matched expected)
PR205_ACTUAL_HEAD  = 05df9b237285224ce7ae23b3b0d413811325c8b3   (matched expected)
Both PRs: mergeable = MERGEABLE, mergeStateStatus = CLEAN, Draft
```

## 2. PR #203 merge (PART 2)

- Marked ready, merged with the repository's normal merge-commit method and a head lock (`--match-head-commit 4765b3e5…`).

```text
PR203_MERGE_SHA   = 7d7c886a90fd820eeb0e0f8d494b3e0be434ea18
POST_203_MAIN_SHA = 7d7c886a90fd820eeb0e0f8d494b3e0be434ea18
PR203 = merged (2026-09-07T02:09:54Z); origin/main contains 4765b3e5 (verified with git merge-base --is-ancestor)
```

## 3. PR #205 retarget (PART 3) and drift / CI (PART 4–5)

- `gh pr edit 205 --base main`; no rebase, no force push.

```text
PR205_BASE = main
PR205_HEAD = 05df9b237285224ce7ae23b3b0d413811325c8b3 (unchanged)
RETARGET_DIFF_COLLAPSED = YES
PR205_CHANGED_FILES (10, GitHub view = local `git diff origin/main...05df9b23`):
  docs/QINGYAN_MENGXIN_FDE_V1_TRADE_OUTBOUND_SYNC.md              +214 -0
  src/app/api/trade/channels/[channel]/send/route.ts             +14 -1
  src/app/api/trade/inbox/[prospectId]/reply/route.ts            +19 -1
  src/app/api/trade/prospects/[id]/messages/route.ts             +16 -1
  src/app/api/trade/prospects/[id]/send/route.ts                 +20 -1
  src/lib/pending-actions/exec-sales-inquiry-reply.ts            +66 -0
  src/lib/pending-actions/supersede.ts                           +156 -0
  src/lib/revenue-spine/__tests__/revenue-spine-db.isolated.test.ts +196 -5
  src/lib/revenue-spine/fde/inbound-sales.ts                     +18 -7
  src/lib/trade/outbound-sync.ts                                 +245 -0
No #203 content (no schema, no migration, no Revenue Spine bulk) remained in the diff.
Main drift between #203 merge and #205 merge: none (origin/main = 7d7c886a).
HEAD_TREE_UNCHANGED = YES; no new CI run was triggered by the base change.
LAST_VERIFIED_HEAD_CI = 34068528323 (success); all four checks remained green on the retargeted PR.
```

## 4. PR #205 merge (PART 6)

```text
PR205_MERGE_SHA   = 5933ff7a0b17b343982cbe836ffb4931122e2e69
POST_205_MAIN_SHA = 5933ff7a0b17b343982cbe836ffb4931122e2e69
PR205 = merged (2026-09-07T02:12:01Z); origin/main contains 4765b3e5 and 05df9b23
MENGXIN_FDE_V1_CODE_MERGED = PASS
```

## 5. Production migration (PART 7–8)

Read-only safety checks before applying:
- Target (masked by `safe-migrate-deploy`): host `ep-super-field-antfibsl-pooler.c-6.us-east-1.aws.neon.tech`, database `neondb`, user `neondb_owner`, `protectedTarget = true` (known production endpoint per `assert-safe-test-database` / production-operation guard).
- `prisma migrate status` (read-only): exactly one migration pending — `20260906120000_mengxin_fde_revenue_spine`; the entries "not found locally" are the archived pre-greenfield history (expected, unchanged).
- Migration file on `main` sha256 `037871de5f2ec3ff068daade6b25d7b8105bbe9eace48924fd47a7138dd246d7` = reviewed hash; registered in `expected-migrations.ts`, `check-release-safety.test.ts`, `verify-migration-history.ts`. DDL is additive only (ALTER TABLE … ADD COLUMN, CREATE TABLE ×3, CREATE INDEX, FKs; no DROP/DELETE/UPDATE).
- Pre-migration production snapshot branch created (repo precedent `prod-pre-*`): `prod-pre-mengxin-fde-revenue-spine-migration-20260907` (`br-flat-smoke-anunfurz`, parent `br-green-boat-ann7k5yf`). Not deleted; rollback point.

Apply (only through the canonical workflow): `ALLOW_DATABASE_MIGRATION=true CONFIRM_PRODUCTION_MIGRATION=I_UNDERSTAND_PRODUCTION_MIGRATION scripts/safe-migrate-deploy.ts` → `Applying migration 20260906120000_mengxin_fde_revenue_spine … All migrations have been successfully applied.` → `prisma migrate status`: `Database schema is up to date!`

```text
MIGRATION_STATUS = UP_TO_DATE
```

Never executed: `prisma db push`, manual DDL, any other migration.

## 6. Mengxin policy seed (PART 9)

- Dry run resolved the organization as `梦馨家纺 (cmrv37moo0001sbskqeknr5km)` before writing; `--write` published `revenue_spine.business_profile` v1 and `revenue_spine.policy` v1 (both `active`, created 2026-09-07T02:16Z).
- Read-back via `loadRevenueSpinePolicy()`: businessType `OEM_MANUFACTURER`; productCategories `bathrobe, blanket, towel, bedding, slipper`; primaryMarkets/strategicMarkets `Canada, United States, United Kingdom, Australia`; USD / FOB; SLA `newInquiryResponseHours 4`, `customerReplyResponseHours 8`; follow-up `3 business days after reply`, quote `3/7/14`, sample `1`, negotiation `2`, stale `21`, nurture `30`, max questions `4`; scoring weights `25/20/20/15/10/10`, grades `90/70/50`. Approval policy is structural (every customer-facing send is `PendingAction sales.send_inquiry_reply`), not a seed value.

```text
MENGXIN_POLICY_SEED = PASS
```

Note: `scripts/seed-revenue-spine-policy.ts` does not yet call `assertProductionOperationAllowed()`; the guard's VERIFY TARGET → DRY RUN → SHOW IMPACT → CONFIRM → EXECUTE sequence was followed manually (org-scoped, two rows). Wiring the script into the guard is a P1 (§11).

## 7. Deployment

- The Git-integration production build for `5933ff7a` (`opb2yaush`) failed at the build-time `predeploy-migration-gate` because it ran before the migration was applied (`BLOCKED：生产库缺少本次代码所需的迁移`) — expected behaviour, no code fault.
- After the migration: `vercel redeploy` of the same commit → `2fi3kbo10`, Ready, aliased to `https://qingyan.ca` / `https://www.qingyan.ca`. Vercel API metadata confirms `githubCommitSha = 5933ff7a`, ref `main`, message "Merge pull request #205 …". The webhook route answers on the alias (`OPTIONS → 204`, unauthenticated `POST → 401`).

## 8. Channel readiness (PART 10)

Website (production DB, read-only):
- `TradeChannel` `channel = website`, name `梦馨家纺主网站`, `status = active`, secret configured (present, not displayed), `orgId = cmrv37moo0001sbskqeknr5km` (梦馨家纺). Created 2026-09-05T23:48Z.
- Historical website messages in the org before this test: **0** — the channel had never received a submission.

Email:
- Production env (names only): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_EMAIL_REDIRECT_URI`, `GMAIL_DRAFT_ENABLED`, `OPENAI_API_KEY`, `AGENT_CORE_ENABLED`, `DIGITAL_EMPLOYEES_ENABLED`, `EMPLOYEE_AI_OUTCOME_TRACKING_ENABLED`, `CRON_SECRET`. **No `RESEND_API_KEY`.**
- `EmailProvider` for lucas@sunnyshutter.ca: Gmail, scopes include `gmail.compose` → the approved send path exists for Lucas as approver (executor: approver Gmail → Resend → fail-closed).
- Org members: Lucas (org_owner, platform admin) and cathy@hlmbedding.com (org_member, platform role `trade`, active, activeOrg = Mengxin, **no Gmail provider**). The FDE assigns new inquiries to the first active `trade` member → Cathy would be the default owner/approver; a send approved by Cathy would fail `NO_EMAIL_PROVIDER`, so approvals must be made by Lucas (org owner may decide) until Cathy connects Gmail or Resend is configured.

```text
WEBSITE_CHANNEL = READY (active, secret configured, org = Mengxin)
EMAIL_SEND_PATH = READY for approver Lucas (Gmail compose); NOT READY for Cathy
```

## 9. Real website acceptance inquiry (PART 11) — FAILED

Submission (real path, in-app browser, no internal function used):
- URL `https://www.mengxinhometextile.com/contact`; form fields Name*, Email, WhatsApp/Phone, Message*, optional details, and a `Website` honeypot (left empty).
- Values: Name `Qingyan Acceptance Test (Lucas)`, Email `lucas@sunnyshutter.ca` (team-owned test identity), Message = the acceptance text verbatim. Submitted 2026-09-07 ≈10:23 CST by clicking "Send Inquiry".
- Site response: `Thank you. Your inquiry has been recorded in test mode. Email sending will be enabled after configuration.`
- Browser network log: the form posted to **`POST https://www.mengxinhometextile.com/api/inquiry → 200`** (the site's own handler). No request to `qingyan.ca` from the browser (server-side forwarding, if any, would not be visible here).

Qingyan production state for `lucas@sunnyshutter.ca` in the Mengxin org, checked immediately and again after 2+ minutes: `TradeProspect = []`, `TradeMessage(website) = none`, `SalesCustomer = []`, `SalesOpportunity = []`; org-wide last hour: 0 new prospects, 0 trade messages, 0 `revenue_spine.*` audit rows. Production runtime log scan showed no `/api/trade/webhook/website` hits in the window.

Conclusion: the Mengxin website's `/api/inquiry` handler stores the inquiry locally ("test mode") and **does not forward it to Qingyan's webhook**. Nothing entered Qingyan, so the FDE chain (RFQ, evidence, assessment, AgentRun, PendingAction) could not run on the real path. This matches the earlier project note that the site's source is maintained outside this repository and needed a server-side fetch added by the site maintainer.

```text
REAL_WEBSITE_INTAKE = FAIL — site /api/inquiry does not forward to https://qingyan.ca/api/trade/webhook/website
```

Not substituted: no direct webhook call, no internal DB function, no manual intake was performed (the brief forbids substitutes for PART 11). No production data was created or repaired.

Exact fix required (site maintainer, server side of `/api/inquiry`, after storing locally):

```text
POST https://qingyan.ca/api/trade/webhook/website
Header: x-qingyan-webhook-secret: <secret shown on 青砚 → 外贸 → 消息通道 → 梦馨家纺主网站>   (or ?secret=… / body.secret)
Content-Type: application/json
Body: { name, email, phone, company?, country?, message, product?, page?, utm_source?, utm_medium?, utm_campaign?, utm_content?, utm_term? }
Honeypot: do not send `_hp` / `website_url` unless tripped (a non-empty value makes Qingyan silently drop the lead)
Response: { ok, prospectId, duplicate, replay, opportunityId, spine: "ok" | "replay" | "SPINE_FAILED" }
```

## 10. Steps not reached (PART 12–13)

Because nothing entered Qingyan on the real path, the following were **not exercised in production** and remain validated only by the isolated-branch DB suites (105/105 in #203 closure, 116/116 in P0.5.1): FDE AgentRun, RFQ evidence, draft grounding, human approval → single send, Trade reverse mirror, Trade outbound supersession, trusted-principal audit.

## 11. Deferred P1 (unchanged) and follow-up note

1. `TradeInquiryAnalysis` + Revenue FDE double analysis — not consolidated.
2. Notification fan-out — unchanged.
3. Manually logged inbound `TradeMessage` → Revenue Spine — not mirrored.
4. `/revenue` navigation placement — unchanged.
5. `RUNTIME_P1_TRUSTED_DECISION_ACTOR_CLEANUP` (follow-up note, not fixed): two legacy system paths still write a substitute `decidedById` — `src/lib/agent-runtime/pending-link.ts` run-cancellation (`input.userId || createdById`) and `src/lib/pending-actions/drafts.ts` batch-prepare compensation (creator). Neither is on the Mengxin FDE execution path (FDE drafts carry no `agentRunId`; batch compensation is the assistant scenario path), so no activation impact.
6. New in this task: `scripts/seed-revenue-spine-policy.ts` should call `assertProductionOperationAllowed()`; the FDE default owner is the first active `trade` member (Cathy) who has no send provider — either connect Cathy's Gmail, configure `RESEND_API_KEY`/`RESEND_FROM_EMAIL`, or set the opportunity owner explicitly before approvals.

## 12. Status

```text
#203 merged                     PASS  (7d7c886a)
#205 merged                     PASS  (5933ff7a)
production migration            PASS  (UP_TO_DATE; snapshot branch retained)
Mengxin policy seed             PASS
production deployment           PASS  (qingyan.ca ← 5933ff7a)
website channel readiness       PASS
email send path (Lucas)         PASS
real website intake             FAIL  (site does not forward to the Qingyan webhook)
FDE AgentRun / RFQ / draft      NOT REACHED
human approval / single send    NOT REACHED
Trade reverse mirror            NOT REACHED
Trade outbound supersession     NOT REACHED
trusted-principal audit         NOT REACHED

MENGXIN_FDE_V1 = PRODUCTION_BLOCKED
BLOCKER = PART 11: Mengxin website /api/inquiry does not forward submissions to https://qingyan.ca/api/trade/webhook/website (site-side integration missing); Qingyan received nothing.
```

Once the site forwards to the webhook, PART 11–13 can be re-run as specified (submit the acceptance inquiry again with the same test identity; approve as Lucas; then a controlled Trade Inbox reply on the same opportunity).

---

# Round 2 — Website bridge reliable closure (2026-09-08)

Brief: `QINGYAN_MENGXIN_WEBSITE_BRIDGE_RELIABLE_CLOSURE`. The first-round record above is kept verbatim; this section appends the second round.

## R2-1. The real website implementation (PART 一)

| Item | Finding |
|---|---|
| Source | Lucas's machine, `~/Desktop/梦馨家纺网站` (Next.js 15.5.19, App Router, `runtime = nodejs`). **No git repository existed**, no GitHub remote, not a Vercel project. I initialised a local repository so the change is reviewable: baseline commit `d3afac9` = the tree as found. |
| Deployment | `.deploy/scp_up.exp` + `.deploy/ssh_run.exp` (password SSH via `expect`; host/user/password are runtime arguments, not stored) to a VPS running nginx (`.deploy/mengxin.conf`: `proxy_pass 127.0.0.1:3000`, `proxy_read_timeout 60s`) in front of `next start`. Root directory = the project root. **Deployed commit: unknowable** (no VCS on either side); the live chunk hashes differ from the local `.next` build of 2026-07-19, so the server was built from a newer tree than that local build. |
| `/api/inquiry` (as found) | Parse JSON → honeypot (`website` field) → validate → **if no `RESEND_API_KEY`: log a warning and answer `success:true, emailSent:false`** ("recorded in test mode") → otherwise send two Resend emails. A Qingyan forwarder (`src/lib/qingyan-inquiry.ts`, dated 2026-09-06 07:36) was already wired in as a fire-and-forget sidecar. |
| Persistence | **None.** "Recorded in test mode" persisted nothing: the only trace was `console.warn`. Answer to question 1: NO, the inquiry was not saved. |
| Forwarding | Present in the local source but unfit: `AbortSignal.timeout(8000)` against a receiver that processes synchronously for up to 120 s; forwarded only name/email/phone/message/page/UTM (company, country, product, order type, quantity, target market dropped); result only logged; nothing retried. `.env.local` on the laptop got `QINGYAN_WEBHOOK_SECRET` on 2026-09-06 07:49. Answer to question 2: the failure is a combination — the code on the server is unverified (no VCS), the server's environment is unverified, and even the local code would have aborted after 8 s. Which of these applied to the 2026-09-07 submission cannot be proven without server access (see R2-7). |
| Retry / task facility | None (no queue, no cron, no DB). Answer to question 3: nothing to reuse. |
| Browser evidence | The browser only ever calls the site's own `/api/inquiry`; server-side forwarding is invisible from the browser, so the first-round conclusion "no forwarding" was correct only for its effect (nothing reached Qingyan), not as a statement about the server code. |

## R2-2. Bridge implemented on the site (PART 二–四)

Site commits (local repo): `41ee233` feat, `beaa479` docs, `dbbe437` deploy docs, `756b1b0` diagnosis checklist, `fa8d2cc` 305 s budget. Delta archive for the server: `~/Desktop/梦馨家纺网站-bridge-delta-fa8d2cc.tar.gz` (13 files).

Order of operations in `/api/inquiry` now: parse → honeypot (silently 200, **not stored, not emailed, not forwarded**) → validate → **persist `data/inquiries/<inq_…>.json` atomically** → Resend (when configured; a failure no longer hides a saved inquiry) → respond `{ success, emailSent, inquiryId }` → **after the response** (`next/server` `after`) forward the saved record to Qingyan.

- Auth: `x-qingyan-webhook-secret` from `QINGYAN_WEBHOOK_SECRET` (server env only; never `NEXT_PUBLIC_*`, never in URL/response/log). Target from `QINGYAN_WEBHOOK_URL` (server config; default production webhook). The payload is built from the persisted record through an allowlist (`eventId, name, email, phone, company, country, product, message, page, utm_*`); actor/approver/orgId cannot be forwarded structurally (test: tainted record → keys ⊆ allowlist).
- Field mapping: `product` = product interest (placeholder "General inquiry" dropped); order type / estimated quantity / target market / inquiry source / source page are appended deterministically to `message` under "— Form details —" (same record → identical text, so Qingyan's replay dedupe still matches on retry); `page` = referer URL; UTM parsed from it; `eventId` = record id.
- Honeypot: the site's hidden `website` input is never mapped to Qingyan's `website`/`buyerWebsite` (buyer site) and never sent; a tripped honeypot produces no record.
- Delivery state per record (`qingyan.status`): `pending` → `delivered` (prospectId **and** spine ok/replay **and** opportunityId) | `partial` (Trade saved, downstream missing, e.g. `SPINE_FAILED` or legacy `REPLAY` without opportunity) | `unconfirmed` (timeout / socket dropped after sending: **remote result unknown, never "not received"**) | `failed` (refused / DNS / 5xx) | `rejected` (4xx: config/payload) | `disabled` (no secret). HTTP 200 / `ok:true` alone is never treated as success. FDE state is stored from Qingyan's `fde` field (its real SalesAction record), not inferred.
- Recovery: `POST /api/admin/inquiries/resync` (admin cookie, or `INQUIRY_RESYNC_TOKEN` bearer for a cron) re-sends non-delivered records with the **identical payload and eventId** (never a modified body); automatic attempts capped at 6 with 2→60 min backoff, 3-minute grace for `pending`; `rejected`/`disabled` only with `force`. `GET /api/admin/inquiries` lists / fetches records.

Time budget:

| Segment | Budget | Basis |
|---|---|---|
| browser → `/api/inquiry` | nginx `proxy_read_timeout 60s` | site answers after persist + email, typically < 3 s |
| site → Qingyan (after response) | `QINGYAN_FORWARD_TIMEOUT_MS` = 305 000 | must exceed the receiver's own limit so a Qingyan timeout surfaces as Qingyan's error, not our abort |
| Qingyan webhook | `maxDuration = 300` (was 120) | synchronous Trade → Revenue Spine → FDE (RFQ LLM extract cap 25 s + draft polish cap 20 s); measured: see R2-4 |

## R2-3. Receiver-side minimal compatibility (Qingyan, branch `feature/website-bridge-reliable-closure`)

Only `src/lib/trade/website-inquiry.ts` and the webhook route changed (no schema, no migration, no permission change; the route's `maxDuration` goes 120 → 300 after the timing measurement in R2-4):

- `eventId` is **parsed** (`eventId`/`event_id`, 120 chars), **stored** as `sourceRef.externalId` inside `CustomerInteraction.analysisResult` (via the existing `intakeInquiry` `sourceRef`), and **used**: a retry with the same eventId replays by id even if the rendered text differs (R3 test).
- Replay detection by rendered content is now org-wide (was email-scoped), so phone-only inquiries no longer duplicate the prospect on retry (R6).
- A replay returns the **real downstream state** (prospectId, messageId, opportunityId, `spine: replay`, `fde` from the SalesAction) instead of `REPLAY` + `opportunityId: null` (R2, R7).
- Recovery on replay: Trade saved but spine missing → the same original message is intaked (never a new inquiry, `recovered: true`), prospect linked, FDE run (R4); FDE `failed` / `run_blocked` / `queued` / `running` for > 10 min (`stale_running`) → FDE re-run, pending draft reused; `running` within 10 min → not re-run (R5).
- Response gains `eventId, messageId, recovered, fde {status, agentRunId, pendingActionId}`.

## R2-4. Non-production validation (PART 五)

Site (mock Qingyan, `tests/inquiry-bridge.test.ts` 8/8, `tests/inquiry-route.test.ts` 7/7, `tsc` + `next lint` clean): normal mapping; record exists before the success response; honeypot (no record / no forward); missing secret → `disabled`, wrong secret (401) → `rejected`; slow-but-inside-budget → delivered; hang → `unconfirmed` (visitor still got success); 500 → `failed` then recovery pass → delivered with byte-identical payload; 200 + `SPINE_FAILED` → `partial` → recovery; duplicate/limit/backoff/attempt-cap rules; store unavailable → 500 and nothing forwarded.

Qingyan (isolated Neon branch `bridge-closure-20260908` = `br-frosty-mountain-anpmgspu`, deleted after the run): unit tests 10/10; DB suite: run 1 → 134/135 (the single failure was §11 Case B's pre-change expectation `REPLAY` + `opportunityId: null`, updated to the new semantics); runs 2 and 3 aborted in §13 and §6 respectively because an FDE call returned no draft — both places are outside this change, no pool-timeout or connection error was logged, and the test's cleanup had removed the run rows before the cause could be read (run 2 also overlapped with local typechecks, which the project notes warn against); diagnostics were added at both checkpoints and run 4, executed alone, passed **135/135** including all 19 new §14 assertions (R1–R7).

Measured Qingyan processing measured with the real LLM path on the isolated branch **from this laptop** (every DB round trip crosses the Pacific, so these are upper bounds; in-region production numbers come from the site record's `lastElapsedMs` during acceptance):

| run | Trade + inquiry-analysis LLM (inline in scripts; `after()` in production) + Revenue Spine intake | Inbound Sales FDE (RFQ LLM ≤25 s + draft polish ≤20 s + DB) | total | FDE outcome |
|---|---|---|---|---|
| 1 | 49.1 s | 92.0 s | 141.1 s | ok, HIGH, draft pending |
| 2 | 33.7 s | 89.0 s | 122.6 s | ok, HIGH, draft pending |

Consequence: the receiver's `maxDuration = 120` was too tight for the synchronous chain, so the webhook route cap is raised to **300 s** (Vercel Pro; other routes already use 300) and the site's forward budget default to **305 s** (budget must exceed the receiver cap so a Qingyan-side kill surfaces as Qingyan's error, not as our abort). If a run is nevertheless killed mid-FDE, the site marks the record `unconfirmed`, and the resync path replays: the receiver reports `running`, and after 10 minutes treats it as `stale_running` and re-runs the FDE (R5).

## R2-5. Acceptance sample (PART 六)

Read-only production pre-check (2026-09-08): org 梦馨家纺; identity `lucas@sunnyshutter.ca` / domain `sunnyshutter.ca` / company "Sunny Shutter" → **no** SalesCustomer, SalesOpportunity or TradeProspect; website channel `cmtp1al7w0000jv04nx3llsgz` active with secret; 0 website messages in the last 7 days; policy v1 present; Lucas's Gmail provider has `gmail.compose` (no read scope → mailbox receipt must be confirmed by the human); Cathy has no provider. Categories from the live profile: bathrobe / blanket / towel / bedding / slipper (not curtains). Sample = 2,000 waffle-weave hotel bathrobes, embroidered logo, Vancouver project, marker `QY-ACC-20260908-d524b362`.

## R2-6. Production steps

Done in this round (production, read-only or preparatory):

1. Read-only pre-check of the acceptance identity, website channel, members, email providers, policy (R2-5). No production write of any kind was made.
2. Site change built, tested and packaged: `~/Desktop/梦馨家纺网站-bridge-delta-fa8d2cc.tar.gz` (13 files) + `docs/QINGYAN_BRIDGE.md` (states, budgets, recovery, deployment steps, server diagnosis checklist).
3. Qingyan receiver change on PR #207 (Draft; CI pending at the time of writing).

Not done, and why (each needs Lucas):

| Step | Blocker |
|---|---|
| Server-side diagnosis of the 2026-09-07 failure (deployed code has forwarder? env has secret? outbound reachability? `[inquiry]` log lines) | The site server is reachable only by password SSH (`.deploy/*.exp`); this session must not enter passwords, and the auto-mode classifier also blocked the SSH attempt. Checklist is in `docs/QINGYAN_BRIDGE.md` → 服务器诊断. |
| Deploy the site delta + `QINGYAN_WEBHOOK_SECRET` (+ optional `INQUIRY_DATA_DIR`, `INQUIRY_RESYNC_TOKEN`) + `npm run build` + restart | Same server access. Steps in `docs/QINGYAN_BRIDGE.md` → 部署. |
| Merge PR #207 so the receiver returns real ids on replay and the route cap is 300 s | Production release; not merged without an explicit go-ahead (the old receiver would answer a retry with `REPLAY` + `opportunityId: null`, which the site classifies as `partial`, so the acceptance must run against the new receiver). |
| PART 七 real website submission (marker `QY-ACC-20260908-d524b362`) | Depends on the two deployments above; I will submit it from the in-app browser and trace submission → record → webhook → TradeMessage → SalesOpportunity/CustomerInteraction → RFQ/Evidence/Assessment → AgentRun → PendingAction with ids and timings. |
| PART 八 A: approve the draft as Lucas (`/revenue/<opportunityId>` → 回复草稿审批 → 批准并发送) and confirm receipt in the lucas@sunnyshutter.ca mailbox | Human approval; Lucas's Gmail token has `gmail.compose` only, so receipt must be confirmed by the human (or forwarded). |
| PART 八 B: real Gmail send by a human, then Trade Inbox → 标记已发送 (mark_sent) → verify Trade→Revenue mirror + `SUPERSEDED_BY_MANUAL_REPLY` | Human action. |

## R2-7. Status

| Item | Status | Evidence |
|---|---|---|
| WEBSITE_PERSISTENCE | BLOCKED (production) — PASS in non-production | record written before the success response; `tests/inquiry-route.test.ts` (store-unavailable → 500, nothing forwarded); not yet deployed to the site server |
| WEBSITE_TO_QINGYAN_DELIVERY | BLOCKED (production) — PASS in non-production | forwarder + classification + recovery tests (mock Qingyan); real path needs the site deployment and PR #207 |
| REVENUE_SPINE_INTAKE | NOT_TESTED (production) — PASS isolated | §11/§14 on the isolated branch |
| FDE_DRAFT | NOT_TESTED (production) — PASS isolated | §4/§11/§14 (grade HIGH on the bathrobe sample in the timing run) |
| APPROVED_GMAIL_SEND | NOT_TESTED | needs the human approval step |
| TRADE_TIMELINE_SYNC | NOT_TESTED (production) — PASS isolated | §13 A–L |
| SYSTEM_SUPERSESSION | NOT_TESTED (production) — PASS isolated | §11 Case C, §13 I–K |
| RECOVERY_PATH | NOT_TESTED (production) — PASS non-production | site: failed/partial/unconfirmed → resync → delivered with identical payload; receiver: §14 R2–R5, R7 |

```text
MENGXIN_FDE_V1 = PRODUCTION_BLOCKED
BLOCKER = website bridge built and validated but not yet on the site server (password-SSH only) and receiver PR #207 not yet merged; PART 七/八 not run
```
Not claimed: no permanent no-double-send guarantee under all concurrency (a retry arriving while the first request is still inside intake can still race; retries in this design are minutes apart); no automatic quoting, no automatic closing, no full inbound email loop.

---

# Round 3 — PR #207 recovery review closure (2026-09-08)

Review base: PR #207 at `19d53086`. Rounds 1 and 2 above are kept unchanged; this section appends what the review found and changed. Nothing was merged, deployed, migrated in production, or emailed.

## R3-1. Event identity at the earliest reliable boundary (PART 1)

**Finding (confirmed defect).** At `19d53086` the event id survived only inside `CustomerInteraction.analysisResult.sourceRef.externalId`, which is written by `intakeInquiry` — the *fourth* step of the chain. An interruption after the Trade message but before the Sales interaction therefore left no trace of the event id at all, and recovery fell back to matching the rendered message text within 24 hours. Outside that window, or when the retry carried any text difference, the same submission became a second inquiry. Two different event ids carrying identical text were also swallowed by content dedupe with no record that a second submission had ever happened.

**Change.** A receipt is now written **before any business object**: `WebsiteInquiryReceipt`, keyed `@@unique([orgId, source, eventId])`, holding the first-seen normalized payload, its business-field hash, and the ids of every downstream object as they are created (`prospectId`, `tradeMessageId`, `customerId`, `opportunityId`, `interactionId`, `salesActionId`, `agentRunId`, `pendingActionId`).

Frozen rules, all enforced in code and covered by tests:

| Rule | Behaviour |
|---|---|
| Event scope | `(orgId, source, eventId)`. `orgId` and `source` come from the authenticated channel; a form submitter cannot set either, and cannot address another organization. |
| Same event id again | Located by id, no business object created, downstream state returned from real records. |
| Same event id, conflicting business content | Original payload is kept and replayed; the conflict is counted (`conflictCount`, `lastConflictAt`) and reported as `conflict: true`. Nothing is overwritten. |
| Source page / UTM changes | Excluded from the business fingerprint: not a conflict, and never written back over existing objects. |
| Different event ids, same content | Each gets its own receipt; the later one records `duplicateOfReceiptId` and reuses the first event's business objects. Recorded, never silently swallowed. |
| No event id (legacy caller) | Server derives an identity from the business fingerprint (`eventIdProvided = false`) and keeps the previous 24-hour content-window semantics: identical content inside the window is the same event, outside it is a new one. |
| Retention | Receipts are never auto-deleted; no purge path exists. Recovery may be driven by a human long after the automatic attempts stop, so the identity has to outlive it. |
| Identity unknown | If a caller presents an event id with no receipt (deleted or beyond retention), the receiver first tries to attach to existing objects by content, and only then treats it as new — the result says which happened rather than defaulting to "brand new inquiry". |

**Single execution per event.** The receipt is claimed (`status = processing`, `processingSince`) before any write, with a conditional update so only one caller wins; a concurrent duplicate gets `busy: true` and performs no steps. A claim older than 6 minutes (longer than the 300 s route cap) is treated as an interrupted process and may be re-claimed. The unique constraint also converts a concurrent first-delivery race into the replay path rather than two inquiries.

**SCHEMA_REQUIRED.** This needs one new table. Migration `20260908120000_website_inquiry_receipt` (sha256 `4cc862a8589206f256d680cc930607d4e7f813aeb1fb6f936cfd7e2b6b3f06fb`) is **additive only**: one `CREATE TABLE` plus four indexes, no change to any existing table, column or row. It is registered in `EXPECTED_ACTIVE_MIGRATIONS` and `check-release-safety.test.ts`, and was applied and exercised on an isolated Neon branch. **It has not been applied to production.** Because the build-time migration gate blocks production builds whose database lacks a required migration, the release order is: apply the migration through `safe-migrate-deploy` (needs your authorization) → merge #207 → redeploy. Until then #207 must not be merged.

## R3-2. Filling in missing intermediate steps (PART 2)

**Finding (confirmed defect).** Recovery keyed entirely off "does a `CustomerInteraction` exist". Any state where the interaction existed but a later object did not was reported as complete and never repaired.

**Change.** `inspectChain()` verifies all seven objects independently from real records — Trade message, prospect, customer, opportunity, interaction, `SalesAction`, prospect→Sales link — and `loadFdeState()` resolves the run/approval state from `AgentRun` and `PendingAction` rather than from the previous step's existence. Gaps are then filled in canonical order through the existing services (`createProspect`, `intakeInquiry`, `createFdeAction`, `runInboundSalesFde`); each filled step is written back to the receipt and named in `recoveredSteps`, so a later interruption resumes from there. No duplicate customer, opportunity, interaction or message is ever created, and `not_run` is treated as "still to do", never as recovered.

Terminal states are respected — recovery must not resurrect a decision a human or the system already made:

| State | Recovery behaviour |
|---|---|
| Draft executed (reply sent) | `already_sent`, terminal. No re-run, no second send. |
| Draft rejected by a human | `human_rejected`, terminal. No new draft. |
| Draft superseded by a newer inbound | `superseded`, terminal. |
| `AgentRun` cancelled by the supervisor | `cancelled`, terminal. No new run. |
| Valid pending draft exists | Reused, reported as terminal for this event. No second approval is manufactured. |
| FDE `running` within 10 minutes | Left alone (no concurrent double run). |
| `failed` / `run_blocked` / `queued` / `not_run` / `stale_running` (>10 min) | Re-run. |

## R3-3. Delivery vs processing, and who owns recovery (PART 3)

**Finding (confirmed defect).** `delivered` was terminal on the site. A submission whose FDE was interrupted would be marked delivered on the first answer and then never looked at again. The 3-minute pending grace was also shorter than the forward budget, so a recovery pass could fire a second request while the first was still running.

**Change.**

- Two independent axes per record: delivery (`qingyan.status`) and processing (`qingyan.processing` ∈ unknown / incomplete / complete). Processing is complete only when the receiver itself reports `complete: true` **and** `fde.terminal: true`, from its own records. A delivered-but-incomplete record keeps being followed up on its own counter (`followUps`) and backoff. Delivery success no longer stops tracking.
- The scenario named in the brief now terminates correctly: interrupted first processing → first resync answers `opportunityId` present with `fde.status = running` (processing incomplete, tracking continues) → after 10 minutes the receiver classifies it `stale_running` → the next follow-up re-runs the FDE and reports a terminal state.
- `inFlightSince` is written before every forward and cleared afterwards, including when the forward throws; a record is not eligible while a forward is in flight, and the pending grace is raised to the in-flight timeout (6 min > 305 s budget). The 3-minute grace can no longer produce a parallel send.
- Attempt caps are visible, not silent: delivery 6, follow-up 8, then the record becomes `needs_attention` with `attentionReason`, and nothing retries it automatically. `force` is the documented way back in after a human fixes the cause.
- Receiver `busy` is classified `partial` — a known state, neither a failure nor an unknown result.
- **One recovery owner: the site.** It holds the durable record and the original payload and drives every retry. The receiver never schedules website recovery for itself; it is idempotent and completes what is missing when asked. One retry loop in the system, not two.
- Scheduling is now a required deployment step, not an optional note: the cron line is in the site's `docs/QINGYAN_BRIDGE.md`, together with the named human owner (site maintainer, currently Lucas) and the daily check `GET /api/admin/inquiries?status=needs_attention,rejected,disabled`. An API with no schedule and no owner is not a recovery path.

## R3-4. Test evidence (PART 4)

Fault injection is done on the isolated branch only; nothing was broken in production.

- **Site** (deterministic mock receiver): 22 tests — bridge 12, route 7, admin/restart 3. Includes the in-flight guard, delivered-but-incomplete follow-up to completion, both exhaustion caps flipping to `needs_attention`, busy handling, and a genuine **cross-process** restart test where a second `node` process recovers an inquiry saved by the first.
- **Receiver** (isolated Neon branch `bridge-review-20260908`, migration applied): unit 10/10; DB suite: **151 passed, 1 failed.** All 15 sections' logic passed, including every new assertion. The single failure is a pre-existing section-4 assertion (`重跑 FDE：审批草稿幂等复用`), and the diagnostics dump identified the cause rather than leaving it open: the re-run's `AgentRun` row carries `errorMessage: "Transaction API error: Transaction not found"` — a Prisma interactive transaction (default 5 s) exceeding its limit against the remote branch from this laptop. The draft id actually matched; the assertion failed on `ok`. Nothing in this PR changes transaction handling, and the FDE behaved correctly under the fault (run marked failed, reason persisted). Three separate observations came out of chasing it: LLM calls in the Trade analysis lane are unguarded (above), a cleanup error used to replace the original failure (fixed), and the pooled connection survives long runs better than the direct one (the direct endpoint dropped immediately on wake). New sections cover identity at the earliest boundary (receipt exists before any prospect/message), concurrent claim → busy with no steps executed, replay by id after the 24-hour window, conflicting content not overwriting, page/UTM-only change not a conflict, two event ids with identical content both recorded, derived identity for legacy callers, and every gap and terminal case in R3-2.
- **Diagnostics before cleanup.** The suite now writes a redacted dump (`revenue-spine-diag-<stamp>.json`) *before* the test database is torn down: failed assertions with their detail, plus opportunities, `SalesAction` states with `fdeStatus`, `AgentRun` status/error codes, `PendingAction` status/failure reasons/deciders, receipts, and interaction previews. Emails are reduced to `***@domain`, message bodies to 200 characters. This was exercised on a real failure during the review and produced the expected file.
- **The earlier two "no draft" failures.** Not dismissed as unrelated. I tested the specific way this PR could have caused them — the org-wide content replay could have made section 13's fixture collide with an earlier fixture that shares the acceptance text — and ruled it out: the rendered message includes the contact line, so two different buyers never produce identical content. What the review *did* find is the real fragility behind them: the suite runs long, every website ingest triggers a Trade-lane analysis whose LLM call is **not** guarded by `isAIConfigured()` (unlike both Revenue Spine call sites), so without a key each ingest burns a doomed request and leaves the database session idle; a pooled Neon connection was then dropped mid-suite. Two changes came out of it — the harness no longer lets a cleanup error replace the original failure (that masking is why the first occurrence was undiagnosable), and long local runs use the direct connection. The unguarded Trade-lane call is left as a reported P1, not silently changed in a lane this round was told to preserve.

## R3-5. Site deployment preflight (PART 5)

`scripts/preflight-bridge.sh` (checks only, no server contact, no publish) prints the change list with a SHA256 per file, packages the delta, and fails closed on: environment or credential files in the package, real values in `.env.example`, key-shaped literals, `data/` (real inquiries) in the package or tracked by git, `NEXT_PUBLIC_*` secret variables, the webhook secret being read anywhere but the server-side forwarder, and server-only variables appearing in client components. Two findings it raised on first run were investigated and turned out to be defects in the checks themselves, now fixed to test the real invariants.

It also prints the pre-deployment comparison steps (per-file SHA256 against the server, and whether the deployed build already contains the forwarder), the backup step, and the release/rollback procedure. **Rollback restores code only; the inquiry directory is never deleted** — those files are real customer inquiries, and after rolling back they stay on disk to be resynced once the new version is redeployed. `INQUIRY_DATA_DIR` is documented as a separate, writable location outside the deployment tree.

Preflight result on the final site commit: `PREFLIGHT: OK`.

## R3-6. Status

```text
EVENT_IDENTITY_RECOVERY     = PASS
PARTIAL_STAGE_RECOVERY      = PASS
DELIVERY_PROCESSING_RECOVERY= PASS
SITE_DEPLOYMENT_PREFLIGHT   = NEEDS_SERVER_ACCESS
PR207_FINAL_HEAD            = 442d0623df030f13956df7a9191b2d8c19ff0b74 (docs-only on top of the code head 5a40a229)
PR207_CI                    = PASS (run 34208833151: validate-lint-typecheck-test-build + both Vercel previews green on 5a40a229)

MENGXIN_FDE_V1 = PRODUCTION_BLOCKED
```

`SITE_DEPLOYMENT_PREFLIGHT` is `NEEDS_SERVER_ACCESS`, not `PASS`: everything checkable without the server passes and the package is ready, but the server's current version has not been compared, the site is only reachable by password SSH, and no deployment has happened.

The first three passing does not change the overall state. `MENGXIN_FDE_V1` stays `PRODUCTION_BLOCKED` until the site is actually deployed and a real form submission is accepted end to end. Still outstanding and unchanged from round 2: the site delta is not deployed, the receipt migration is not applied, #207 is not merged, and the real-form acceptance (PART 七) and the human approval and Trade Inbox steps (PART 八) have not run.

Open P1 items recorded, not fixed this round: the Trade-lane inquiry analysis and design LLM calls have no `isAIConfigured()` guard; `scripts/seed-revenue-spine-policy.ts` does not call `assertProductionOperationAllowed()`; the FDE's default owner (first active trade member) has no email provider connected; `RUNTIME_P1_TRUSTED_DECISION_ACTOR_CLEANUP` from round 1.

#207 stays unmerged pending explicit release authorization. #206 stays open until its report content is confirmed preserved here and #207 is merged.
