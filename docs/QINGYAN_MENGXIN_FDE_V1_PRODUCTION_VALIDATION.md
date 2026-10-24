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
PR207_FINAL_HEAD            = 5a40a229679fc1a172c85e20f775acda9bbc793f  (last code commit; this
                              report is committed on top of it, so the branch tip is a later
                              docs-only commit — see the PR for the current tip)
PR207_CI                    = PASS (run 34208833151: validate-lint-typecheck-test-build + both Vercel previews green on 5a40a229)

MENGXIN_FDE_V1 = PRODUCTION_BLOCKED
```

`SITE_DEPLOYMENT_PREFLIGHT` is `NEEDS_SERVER_ACCESS`, not `PASS`: everything checkable without the server passes and the package is ready, but the server's current version has not been compared, the site is only reachable by password SSH, and no deployment has happened.

The first three passing does not change the overall state. `MENGXIN_FDE_V1` stays `PRODUCTION_BLOCKED` until the site is actually deployed and a real form submission is accepted end to end. Still outstanding and unchanged from round 2: the site delta is not deployed, the receipt migration is not applied, #207 is not merged, and the real-form acceptance (PART 七) and the human approval and Trade Inbox steps (PART 八) have not run.

Open P1 items recorded, not fixed this round: the Trade-lane inquiry analysis and design LLM calls have no `isAIConfigured()` guard; `scripts/seed-revenue-spine-policy.ts` does not call `assertProductionOperationAllowed()`; the FDE's default owner (first active trade member) has no email provider connected; `RUNTIME_P1_TRUSTED_DECISION_ACTOR_CLEANUP` from round 1.

#207 stays unmerged pending explicit release authorization. #206 stays open until its report content is confirmed preserved here and #207 is merged.

---

# Round 4 — PR #207 release gate closure (2026-09-08)

Scope: close the one known DB-suite failure, freeze the release candidate, prepare the production migration checklist, prepare the site deployment. No production write, no merge, no deployment, no real email.

## R4-1. Review baseline (PART 1)

Re-read from the remote; all three match the values given in the brief.

| Item | Expected | Actual (remote) |
|---|---|---|
| PR #207 head | `90314efc3c7ad33a4ff406e45b67ed872efb48f8` | same |
| main | `5933ff7a0b17b343982cbe836ffb4931122e2e69` | same |
| migration | `20260908120000_website_inquiry_receipt` | present, sha256 `4cc862a8589206f256d680cc930607d4e7f813aeb1fb6f936cfd7e2b6b3f06fb` |

PR state: open, draft, MERGEABLE. No divergence, so the round-3 verification results still apply to this head.

## R4-2. Closing the one known DB failure (PART 2)

The round-3 record (151 pass / 1 fail) and its redacted diagnostics are kept above and unchanged.

### Confirmed facts

1. **Effective timeout.** `src/lib/db.ts` constructs `new PrismaClient()` with no options, so interactive transactions use the Prisma defaults: **`timeout` 5000 ms**, `maxWait` 2000 ms. Nothing in the repo overrides them.
2. **Transaction entry points on the FDE path, with measured durations** (instrumented `db.$transaction`, isolated branch, from this machine, 5 scenario repetitions):

| Transaction | Site | n | p50 | max |
|---|---|---|---|---|
| `completeAgentRun` | `src/lib/agent-runtime/run.ts:447` | 10 | **3484 ms** | **3824 ms** |
| `createDraftBatch` (approval creation) | `src/lib/pending-actions/drafts.ts:183` | 5 | 1719 ms | 2852 ms |
| `createAgentRun` | `src/lib/agent-runtime/run.ts:171` | 10 | 2015 ms | 2641 ms |
| `upsertRfq` | `src/lib/revenue-spine/rfq/persist.ts:54` | 10 | 2031 ms | 2433 ms |
| `appendAgentRunEvent` | `src/lib/agent-runtime/run.ts:639` | 130 | 1468 ms | 2204 ms |

   165 transactions in total, **0 failed**, **0 reached 5000 ms**. The slowest (`completeAgentRun`, which holds `SELECT … FOR UPDATE` plus the terminal event write) already consumes about 70 % of the 5 s budget at p50.
3. **Connection.** The isolated branch endpoint carries no `-pooler` (Neon direct). Measured round-trip for `SELECT 1` from this machine: min 256 ms, p50 257 ms, p90 287 ms, **max 3060 ms** — one spike of three seconds on a single trivial query.
4. **What actually failed in round 3.** The `AgentRun` row for the re-run carries `status = failed` and `errorMessage = "Transaction API error: Transaction not found…"`. The draft id returned by the re-run was the **same** id the first run created, so the assertion failed on `ok === false`, not on draft identity.
5. **Normal path now verified.** The targeted probe ran the exact section-4 scenario 5 times: first run ok, re-run ok, same draft id, 5/5. In the full suite below the original assertion — unchanged, still requiring `ok === true` — passes.

### Inferences, explicitly not proven

- **That a latency spike pushed `completeAgentRun` past 5000 ms** is the most probable mechanism. It is supported by (2) and (3): p50 already at 3.5 s of a 5 s budget, and an observed 3060 ms spike on a single query. It is not directly proven, because the failing run happened before the instrumentation existed.
- **That a timeout, rather than the quota above, caused the specific round-3 section-4 failure** remains the reading of the evidence there (that run's `AgentRun` carries a transaction error, not a quota error), but the two failure modes look similar from the outside, and only the quota one has since been reproduced deterministically.
- **That production is not exposed to the transaction timeout** rests on the app and database both being in us-east-1, where per-round-trip latency is single-digit milliseconds rather than ~256 ms, leaving roughly two orders of magnitude of headroom. I cannot measure production from here, so this stays an inference. If it ever does occur in production, the failure path below is what governs the outcome.

### The real cause of the recurring "no pending draft" failures — a platform quota, not latency

The instrumentation added this round finally caught it, and it is **not** environmental. Running the suite against a **local PostgreSQL** (sub-millisecond latency, where no timeout is possible) reproduced the failure immediately and deterministically, with the FDE returning:

```text
errorCode: "QUOTA"   error: "配额限制：配额 hard limit，拒绝执行"   fdeState.status: "run_blocked"
```

The mechanism, read from the code:

- `createAgentRun` reserves one unit of `MAX_CONCURRENT_RUNS` before creating a run (`agent-runtime/run.ts`).
- The platform default hard limit for that metric is **10** (`capabilities/governance/defaults.ts`), and usage is counted as *runs in `running`/`claimed`/`queued`* **plus** *reservations still `RESERVED` and not yet expired* (`usage-counters.ts`).
- The concurrency reservation is deliberately kept `RESERVED` "until the run reaches a terminal state", but **no terminal path ever releases it**: `releaseReservation`/`commitReservation` appear only on `createAgentRun`'s failure paths (and the daily metric's commit). The slot is freed only when the reservation's **5-minute TTL** expires.
- Organization policies cannot lift this: `resolveEffectiveQuota` combines platform and org limits with `tighter()`, so an org policy can only lower a limit, never raise it.

That produces exactly the behaviour observed all along: **an organization can begin at most 10 agent runs per 5-minute window, no matter how quickly they finish.** Against Neon each FDE took 40–90 s, so ten runs usually spanned more than five minutes and the slots expired in time — the failure appeared only when a burst happened to fit inside the window, which is why it looked random and why I mis-attributed it to latency in round 3. Locally the same suite runs twenty times faster, so it hit the cap immediately and repeatably.

**Production consequence (worth acting on separately).** The Mengxin organization is subject to the same cap. Eleven or more website inquiries — or FDE re-runs — starting inside one five-minute window will have the eleventh onward refused with `QUOTA`, and the FDE records `run_blocked`. The mitigating factor is that this round's recovery layer treats `run_blocked` as re-runnable, so the site's follow-up re-sends the same event after the backoff and the work completes once slots free up; nothing is lost and nothing is double-sent. It is still a real capacity limit and a missing release path, recorded as a P1 below rather than changed here, since the agent-runtime quota substrate is outside this PR's scope.

**Effect on the suite.** The fixture organizations now release their own `MAX_CONCURRENT_RUNS` reservations immediately before each FDE-triggering call. That is the test-side equivalent of "five minutes passed": the suite is strictly sequential and never actually runs two agent runs at once, so no real concurrency limit is being bypassed, no limit is altered, and no assertion is weakened.

### A second, distinct environment failure mode

While producing the final verification run, a different failure appeared in section 13: Prisma **P2024, "Timed out fetching a new connection from the connection pool"** (pool timeout 10 s, connection limit 13), raised from `loadRevenueSpinePolicy`. This is not the transaction timeout above — it is pool exhaustion, and it has the same underlying driver: at ~256 ms per round trip every query holds its connection roughly a hundred times longer than in-region, so a suite that fans out queries saturates a 13-connection pool.

It was fixed **in the test environment only**, by adding `connection_limit=20&pool_timeout=30&connect_timeout=20` to the isolated `DATABASE_URL`. No product code, no client configuration and no assertion was changed; the product still runs on Prisma defaults.

### Where this suite actually runs

Worth stating plainly, because it changes what CI green means: `scripts/test-ci-unit.sh` does invoke this suite, but the suite **skips itself** unless `DATABASE_URL`, `NODE_ENV=test` and `DATABASE_ENVIRONMENT=isolated` are all present, and CI provisions no isolated database. So the GitHub check does not exercise it — the local isolated-branch run reported below is the only place these 160 assertions actually execute, which is also why its environment sensitivity had to be dealt with rather than waved through.

### Correction to round 3

Round 3 stated that the pooled endpoint survived long runs better than the direct one, and that the direct endpoint "dropped immediately on wake". That comparison was **invalid**: `neonctl` returned a single connection URI for the branch, so both env files resolved to the *same* (direct) endpoint. The immediate drop was a transient compute-wake failure on that one endpoint, not a pooled-versus-direct difference. The separate round-3 finding about unguarded Trade-lane LLM calls stands — pointing `OPENAI_BASE_URL` at a closed port cut the suite from 40+ minutes to a few minutes.

### Failure path, independently verified (new section 16)

Fault injection replaces nothing that should be genuinely verified: every Prisma write and the whole approval state machine run for real, and only one named `db.$transaction` call is forced to throw the same "Transaction not found" shape.

- **16A, failure before the draft exists** (injected into the RFQ persist transaction, `rfq/persist.ts:54`): the Revenue Spine is still established; **no approval is created**, nothing is sent, the `AgentRun` is `failed` with the reason recorded, `SalesAction.fdeStatus = failed`, and the receipt stays `linked` rather than being marked complete. Re-sending the same event then re-runs the FDE and produces **exactly one** pending approval, the receipt turns `complete`, and still nothing is sent. No business object is duplicated across failure and recovery.
- **16B, failure after the draft exists** (injected into `completeAgentRun` — the very transaction observed failing in round 3): nothing is sent, **exactly one valid pending approval** remains, no one is recorded as a decision maker, and the run is `failed`. Re-sending either completes (one valid pending approval, receipt `complete`) or stops in an explicitly non-terminal state for a human; both are asserted as acceptable, nothing in between.
- **16C, failure in the run-event write**: the FDE still completes, the run is `completed`, there is exactly one pending approval and nothing is sent.

Getting 16A to fail *usefully* required finding out which transactions are actually fatal, which is itself a result worth recording: `appendAgentRunEvent` wraps its transaction in `try/catch` and returns `null` on error, so **run-event logging is best-effort by design and a failure there cannot break or duplicate the approval flow** (16C pins that behaviour down). The fatal pre-draft transaction is the RFQ persist, whose error propagates to the FDE's own catch. Two earlier attempts injected into the event write and were silently absorbed — the injection was corrected rather than the assertions relaxed.

## R4-3. Full verification (PART 3)

All of it run after the closure above, nothing running concurrently.

| Check | Result |
|---|---|
| Isolated DB suite | **161 passed, 0 failed** — reproduced three consecutive times |
| Typecheck (repo-wide `tsc --noEmit`) | pass |
| Lint (changed files) | 0 errors, 0 warnings |
| Runtime architecture guard (R1) | `runtime-architecture baseline: clean` |
| Release safety (`check-release-safety.test.ts`) | 27 passed, 0 failed |
| Migration history (`verify-migration-history.ts`) | 77 passed, 0 failed |
| `website-inquiry` unit tests | 10 passed |

The assertion count moved from 152 (151 + 1 failing) to **161** because this round adds section 16 (eight assertions) and one more inside it; no assertion was removed, relaxed or skipped, and the previously failing one — `重跑 FDE：审批草稿幂等复用`, still requiring `ok === true` — passes as written.

**Where it ran, and why.** Two isolated environments were used, and the difference between them is what produced the diagnosis:

- an isolated Neon branch (`gate-20260908`, created from production, migrations applied including the new one) — deleted after use; no `prod-pre-*` backup branch was touched;
- a **local PostgreSQL 17 instance with pgvector**, created for this round in the scratchpad with the full migration history applied.

The local instance is what made the suite trustworthy: from this machine the Neon branch answers a trivial `SELECT 1` in ~256 ms (with an observed 3060 ms spike), so a 30-minute run kept dying in a different place each time — a transaction timeout, then pool exhaustion, then the quota cap. Locally the same suite finishes in about four minutes and is repeatable, which is exactly what let the quota cause be isolated instead of guessed at. The local cluster is a throwaway; it is stopped and removed at the end of the round.

## R4-4. Production migration release checklist (PART 4) — prepared, not executed

| Item | Value / finding |
|---|---|
| Release candidate | PR #207 head `90314efc3c7ad33a4ff406e45b67ed872efb48f8` |
| Migration file | `prisma/migrations/20260908120000_website_inquiry_receipt/migration.sql` |
| SHA256 (recomputed on the candidate) | `4cc862a8589206f256d680cc930607d4e7f813aeb1fb6f936cfd7e2b6b3f06fb` |
| Statements | `CREATE TABLE "WebsiteInquiryReceipt"` + 1 unique index + 4 indexes. Zero `ALTER` / `DROP` / `UPDATE` / `DELETE`, no foreign keys, no change to any existing table, column or row. |
| Production target identification | `prisma migrate status` (read-only) reports `PostgreSQL "neondb" schema "public" at ep-super-field-antfibsl.c-6.us-east-1.aws.neon.tech`. The datasource is `url = env("DATABASE_URL")`, `directUrl = env("DIRECT_URL")`, and **Prisma migrate uses `directUrl`**, i.e. the non-pooled endpoint, while the running app uses the pooled one. `safe-migrate-deploy` additionally prints the masked host and requires `ALLOW_DATABASE_MIGRATION=true` plus `CONFIRM_PRODUCTION_MIGRATION=I_UNDERSTAND_PRODUCTION_MIGRATION`. |
| Pending migrations | **Exactly one: `20260908120000_website_inquiry_receipt`.** Last common migration `20260906120000_mengxin_fde_revenue_spine`. `safe-migrate-deploy` runs *all* pending migrations, so if a second pending entry ever appears, stop and re-review instead of applying. |
| Migration history / drift | The "not found locally" list is the known archived pre-greenfield history, covered by `verify-migration-history.ts`. One extra entry deserves attention and is **not mine**: `20260829200000_add_vinyl_work_order` is applied in production but is in neither `EXPECTED_ACTIVE_MIGRATIONS` nor `ARCHIVED_MIGRATIONS` on this branch (it exists only as an untracked directory in the working tree of the vinyl lane). `prisma migrate deploy` will not touch it because it is already applied, and the predeploy gate classifies it as "unexpected" and passes — but the vinyl lane should register it. |
| Pre-migration backup | Take a Neon branch from production immediately before applying, following the existing convention: `prod-pre-website-inquiry-receipt-migration-<YYYYMMDD>`. Do **not** delete the earlier `prod-pre-*` branches. Not created in this round, because a snapshot is only meaningful taken immediately before the change. |
| Old app compatibility with the new table | Safe by construction and by inspection: the table is new, standalone, has no foreign keys into existing tables, and no code in the currently deployed build (`5933ff7a`) references it. The deployed Prisma client simply does not know it exists. |
| Migration applied but deployment fails | The old application keeps running unaffected, and it can still be **re-deployed**: `scripts/predeploy-migration-gate.ts` blocks only on *missing* migrations; extra applied migrations are logged as "unexpected" and explicitly allowed ("回滚部署时属正常，放行"). So the safe order is: back up → apply migration → merge → deploy; and if the deploy fails, roll the deployment back and leave the table in place. |

Not executed and not permitted in this round: production `db push` / `migrate dev` / `reset`, manual production DDL, production seed, automatic whole-database restore.

## R4-5. Site deployment preparation (PART 5)

The package is unchanged and re-verified on this pass: site commit `da4ff0c`, 15 files, `PREFLIGHT: OK`, package `梦馨家纺网站-bridge-delta-da4ff0c.tar.gz`, sha256 `83ec8f03de0d92d58a76b4415428df66b3604b7fb664390d387af609978c28d0`. Nothing was rebuilt.

The read-only server checks the brief asks for — deployed file versions against the local baseline, deployment directory and process manager, a separate `INQUIRY_DATA_DIR`, its permissions and non-public reachability, presence (only) of the environment variables, whether the recovery schedule is actually installed, and the backup/rollback arrangement — are all specified as commands in the site repo's `docs/QINGYAN_BRIDGE.md` (sections 服务器诊断 and 部署). **None of them were run:** the site host is reachable only by interactive password SSH, this session must not handle passwords or private keys, and the sandbox blocked the one SSH attempt made in round 2. No credential, private key or webhook secret appears anywhere in this work.

```text
SITE_DEPLOYMENT_PREFLIGHT = NEEDS_SERVER_ACCESS
```

To unblock, either run the checklist in `docs/QINGYAN_BRIDGE.md` yourself and paste the output, or grant a non-interactive key-based login for this session.

## R4-6. Status

```text
SCHEMA_DESIGN_REVIEW         = ACCEPTED
KNOWN_DB_FAILURE_CLOSURE     = PASS
NORMAL_REPLAY_PATH           = PASS
TIMEOUT_RECOVERY_PATH        = PASS
DB_SUITE                     = 161/161
PR207_FINAL_HEAD             = 93a34a1647a944921abd8d70b6e533b3aec0121d  (last code commit; this report is committed on top,
                               so the branch tip is a later docs-only commit)
PR207_FINAL_HEAD_CI          = PASS (validate-lint-typecheck-test-build + both Vercel previews green on 93a34a16)
MIGRATION_PREFLIGHT          = READY (not executed)
SITE_DEPLOYMENT_PREFLIGHT    = NEEDS_SERVER_ACCESS

PR207_RELEASE_GATE = READY_FOR_PRODUCTION_AUTHORIZATION
```

The gate covers the Qingyan side only: the code is verified, the migration checklist is prepared, and what remains is your authorization to apply the migration and merge. It does **not** mean the feature is live. `MENGXIN_FDE_V1` stays `PRODUCTION_BLOCKED`, and the outstanding items are unchanged: the site delta is not deployed (needs server access), the receipt migration is not applied, #207 is not merged, and the real-form acceptance and the human approval / Trade Inbox steps have not run.

New P1 recorded this round, not fixed here: `MAX_CONCURRENT_RUNS` reservations are never released at run terminal (only creation-failure paths release), so an organization can begin at most 10 agent runs per 5-minute TTL window and the eleventh is refused with `QUOTA`; organization policy cannot raise it. For Mengxin this caps inbound FDE throughput at ten inquiries or re-runs per five minutes. The recovery layer treats `run_blocked` as re-runnable, so work resumes once slots free rather than being lost. Earlier P1s stand: unguarded Trade-lane LLM calls, `seed-revenue-spine-policy.ts` not calling `assertProductionOperationAllowed()`, the FDE default owner having no email provider, and `RUNTIME_P1_TRUSTED_DECISION_ACTOR_CLEANUP`.

PR #207 remains unmerged. The production migration, the merge, the deployment and any real send all remain pending explicit authorization.

## R4-7. Section 16A failure diagnosis (evidence and classification)

Diagnosis only: no production code, transaction timeout, migration file or existing assertion was changed. Run against a local PostgreSQL 17 + pgvector instance with the full migration history, where latency and the concurrency quota are both removed as variables. Raw artifact preserved as `section16a-diagnosis-<stamp>.json`.

Two 16A assertions failed in the first two round-4 runs. Both have the same cause, so both are classified together.

| Failed assertion | Classification |
|---|---|
| `16A：草稿前事务失败 → 无审批、无发送；run=failed…收据=linked` | **FAULT_INJECTION_INVALID** |
| `16A：再次恢复 → FDE 重跑并只产生一份未决审批，收据转 complete，仍未发送` | **FAULT_INJECTION_INVALID** (consequence of the same invalid injection) |

### Variant 1 — the injection those runs actually used

| Field | Observed |
|---|---|
| Injected transaction caller | `<anonymous> src/lib/agent-runtime/run.ts:639:10` (the transaction inside `appendAgentRunEvent`) |
| Thrown error | `Transaction API error: Transaction not found. Transaction ID is invalid (simulated fault injection).` — injection confirmed fired |
| FDE result | `ok: true`, no error code |
| Receipt | status `complete`, `processingSince` null, all downstream ids populated |
| SalesAction | status `open`, `fdeStatus` `completed`, run and draft both linked |
| AgentRun | status `completed`, `errorCode` null, `errorMessage` null |
| PendingAction | one row, status `pending`, `failureReason` null, `decidedById` null, not expired |
| Counts | interactions 1, SalesActions 1, AgentRuns 1, valid pending approvals **1** |
| Recovery after retry | `recovered: false`, steps `[]` — nothing to recover, chain already complete |
| Duplicate externally executable action | **none** |

The injected failure was absorbed, because `appendAgentRunEvent` wraps its own transaction in `try/catch` and returns `null`: run-event logging is best-effort by design. The assertion described a *fatal* pre-draft failure, which that injection point cannot produce. The expectation was right about the scenario; the injection could not create it.

### Variants 2 and 3 — the injection now in the suite (identical runs, reproduced twice)

| Field | Observed |
|---|---|
| Injected transaction caller | `upsertRfq src/lib/revenue-spine/rfq/persist.ts:54:13` |
| Thrown error | same simulated "Transaction not found" |
| FDE result | `ok: false`, `errorCode: FDE_FAILED`, error carries the injected message |
| Receipt after failure | status **`linked`** (correctly *not* marked complete), `processingSince` null |
| SalesAction after failure | status `open`, `fdeStatus` **`failed`**, no draft linked |
| AgentRun after failure | status **`failed`**, `errorCode: unknown`, `errorMessage` preserves the transaction error |
| PendingAction after failure | **none** |
| Counts after failure | interactions 1, SalesActions 1, AgentRuns 1, valid pending approvals **0** |
| Recovery after retry | `recovered: true`, steps `["fde"]`, new run `completed`, receipt `complete` |
| Counts after recovery | interactions 1, SalesActions 1, AgentRuns 2 (the failed one is retained as real history), valid pending approvals **1** |
| Duplicate externally executable action | **none, in either phase** |

### Verdict

The system is safe under a fatal mid-FDE transaction failure: no approval is created, nothing is sent, the failure is recorded on both the run and the action, the receipt is not falsely marked complete, and a retry completes the chain leaving exactly one approvable draft. No duplicate externally executable action, no unrecoverable state and no false-complete state was observed in any variant or phase.

Accordingly only the new Section 16 expectation was corrected — by moving the injection to a transaction whose failure actually reaches the FDE (`upsertRfq`), and adding 16C to pin down that a run-event write failure is non-fatal by design. No existing production assertion was touched, and `PR207_RELEASE_GATE` is unchanged at `READY_FOR_PRODUCTION_AUTHORIZATION`.

---

# Round 5 — Main sync and release freeze (2026-09-10)

Rounds 1–4 above are unchanged, including their failure history. This round synchronised PR #207 with the current `main` and re-verified the whole candidate on top of it. Nothing was merged, migrated in production, deployed, seeded or emailed.

## R5-1. Sync with current main (PART 1)

```text
PRE_SYNC_HEAD  = 7b61a0cf4625035c07f9ee0139de120d96e3fc89
SYNC_MAIN_SHA  = 4070d6d83842427e6318ab92ad7d19f0cc76fbae
POST_SYNC_HEAD = e6b6098738adfe6420ac86e81d2c273c707ffc8a
CONFLICTS      = NONE
```

The merge base was `5933ff7a`, the old review base. `main` had advanced by 22 commits, all of them PR #190 (Supplier Intelligence M1-S2). A merge commit was used, matching the convention already present in the drifted history (#190 itself carries `efdd0785 merge: origin/main → …`). No reviewed commit was rewritten and no force push was used.

## R5-2. Drift review (PART 2)

```text
MAIN_DRIFT_SOURCE          = PR190 (Supplier Intelligence M1-S2)
DIRECT_FILE_OVERLAP        = NONE
SEMANTIC_RUNTIME_OVERLAP   = NONE
TEST_RUNNER_IMPACT         = ADDITIVE_ONLY
MIGRATION_REGISTRY_OVERLAP = NONE
```

- **Direct file overlap: none.** The two change sets are disjoint. #207 touches 10 files (schema, the one migration, the webhook route, `website-inquiry.ts`, `website-inquiry-receipts.ts`, the two test suites, both migration registries, the report). #190 touches 52, every one of them under `src/lib/supplier-intel/`, `src/lib/tender-intel/`, `src/app/api/supplier-intel/`, `docs/` or `scripts/`. The set intersection is empty.
- **Semantic runtime overlap: none.** #190 changed nothing outside those directories — in particular nothing in `agent-runtime`, `pending-actions`, `revenue-spine` or `trade`. In the other direction, nothing under `src/lib/trade/`, `src/lib/revenue-spine/`, `src/lib/pending-actions/` or `src/app/api/trade/` imports `supplier-intel` or `tender-intel`. The two lanes share the Prisma client and the approval facade, and neither changed.
- **Test runner impact: additive only.** #190 appended 13 `run_test` lines to `scripts/test-all.sh` and 14 lines to `scripts/test-ci-unit.sh`, all Supplier Intel suites; its isolated-DB suites self-skip when no isolated database is provided. #207 does not modify either runner: all three of its suites (`check-release-safety.test.ts`, `website-inquiry.test.ts`, `revenue-spine-db.isolated.test.ts`) were already registered on both sides, so no registration was lost or duplicated by the merge.
- **Migration registry overlap: none.** #190 adds no migration and does not touch `expected-migrations.ts` or `check-release-safety.test.ts`.

No semantic conflict was found, and no Supplier Intelligence file was edited.

## R5-3. Migration after sync (PART 3)

```text
MIGRATION_SHA256         = 4cc862a8589206f256d680cc930607d4e7f813aeb1fb6f936cfd7e2b6b3f06fb
MIGRATION_CHANGED_BY_SYNC = NO
```

Recomputed from the post-sync tree; byte-identical to the round-4 value. A diff of the whole #207 surface (`prisma/`, `src/lib/trade/`, `src/lib/revenue-spine/`, `src/lib/pending-actions/`, `src/lib/release/`, `src/app/api/trade/`, `check-release-safety.test.ts`) between the pre-sync and post-sync heads is empty — the merge changed none of it.

The SQL remains additive only: one `CREATE TABLE "WebsiteInquiryReceipt"`, one unique index and four ordinary indexes. No `ALTER` of an existing table, no `DROP`, no `DELETE`, no `UPDATE`, no foreign key. Compared with `origin/main`, `prisma/schema.prisma` is +54 lines and −0, adding exactly one model. `prisma/migrations/` gains exactly one directory. The migration is still registered in `EXPECTED_ACTIVE_MIGRATIONS` (`expected-migrations.ts:48`) and in `check-release-safety.test.ts:131`, and the release-safety suite passes.

## R5-4. Final database validation (PART 4)

Isolated Neon branch `final-sync-20260910` (`br-aged-hat-an4wrwlw`), created fresh from the production branch `br-green-boat-ann7k5yf`. On that clone `prisma migrate status` reported exactly one unapplied migration — `20260908120000_website_inquiry_receipt` — and `prisma migrate deploy` applied that one and nothing else. No `db push`, no `--accept-data-loss`, no manual DDL, no seed, and no production database was written to.

```text
DB_SUITE = ALL PASS  (161 通过, 0 失败, exit 0)
```

One full run of `revenue-spine-db.isolated.test.ts` against the post-main-sync tree, all 16 sections. The previously failing existing assertion is unchanged and passes; no assertion was deleted, relaxed or rewritten this round, and the transaction timeout was not touched. This also reproduces the round-4 result of 161/161 on a second, independent database engine and location — round 4's confirming run was on a local PostgreSQL 17 cluster, this one on Neon — so the count is not an artefact of one environment.

Section 16 behaved exactly as specified:

| Case | Result |
|---|---|
| 16A — fatal transaction fault at a real fatal boundary (`upsertRfq`) | FDE returns failed; `AgentRun` = `failed` with the cause preserved; `SalesAction.fdeStatus` = `failed`; receipt stays `linked`, **not** `complete`; **zero** approvals; nothing sent |
| 16A — retry | Recovers through the `fde` step; **exactly one** valid pending approval; receipt turns `complete`; still nothing sent; no business object duplicated |
| 16B — fault after the draft exists (`completeAgentRun`) | FDE reports failure honestly; exactly one valid pending approval; no one recorded as decider; no automatic send |
| 16C — `appendAgentRunEvent` write failure | Non-fatal by design: the run still completes, exactly one pending approval, nothing sent. The log line `[AgentRunEvent] append failed …` is the intended visible trace, not a failure expectation |

No diagnostics dump was needed, because there was no failing assertion to preserve.

## R5-5. Static and CI gates (PART 5)

Run after the DB suite finished, not alongside it.

| Gate | Result |
|---|---|
| `tsc --noEmit` | clean, no output |
| `npm run lint` | exit 1 — pre-existing debt, 41 errors / 137 warnings. CI marks this step `continue-on-error` by design; it is a log, not the gate |
| `npm run lint:baseline` (the real gate) | **PASS** — no new error fingerprint; 41 errors against a baseline of 53 |
| `npm run test:ci` | **PASS**, exit 0 — includes release-safety, migration-history verification, the runtime architecture guard (violations = 0, `AgentRunEvent` single physical writer intact), the approval-facade and tenant guards, and `website-inquiry` 10/10 |
| Revenue Spine DB suite in `test:ci` | skipped locally with no `DATABASE_URL`, exactly as in CI — it was run separately against the isolated branch above |

The Next.js build is left to repository CI, which runs it with the migration gate.

## R5-6. Production migration preflight (PART 7) — read-only, not executed

The target was confirmed before reading: `.env`'s `DIRECT_URL` host `ep-super-field-antfibsl…` is the endpoint of Neon branch `br-green-boat-ann7k5yf`, the `[default] production` branch — the known protected target. `prisma migrate status` was run read-only from the clean post-sync worktree (not from the main checkout, whose working tree carries unrelated uncommitted migration directories that would have polluted the pending list).

Pending migrations in production: **exactly one**.

```text
20260908120000_website_inquiry_receipt
```

The command also reports migrations present in the production `_prisma_migrations` table but absent from `prisma/migrations/`. That list was checked item by item against the registry: all of it is `ARCHIVED_MIGRATIONS` (85 entries), plus one extra — `20260829200000_add_vinyl_work_order`, applied in production but committed to neither registry nor the repository. That is the pre-existing P1 already recorded in round 4, unrelated to #207, and it does not block: `predeploy-migration-gate.ts` blocks only on `drift.missing` and treats `drift.unexpected` as a warning.

```text
MIGRATION_PREFLIGHT = READY_NOT_EXECUTED
```

Prepared, deliberately not executed, and requiring your explicit authorization:

```bash
ALLOW_DATABASE_MIGRATION=true CONFIRM_PRODUCTION_MIGRATION=I_UNDERSTAND_PRODUCTION_MIGRATION npm run db:migrate:deploy
```

`safe-migrate-deploy` applies **all** pending migrations. The check above is what makes that safe here: the pending list is exactly one, and that one is additive. Release order is unchanged — apply the migration, then merge #207, then redeploy — because the build-time gate fails a production build whose database lacks a required migration.

## R5-7. Status (PART 6, PART 8)

```text
MAIN_DRIFT_SOURCE         = PR190 (Supplier Intelligence M1-S2)
DIRECT_OVERLAP            = NONE
PRE_SYNC_HEAD             = 7b61a0cf4625035c07f9ee0139de120d96e3fc89
BASE_MAIN_SHA             = 4070d6d83842427e6318ab92ad7d19f0cc76fbae
POST_SYNC_HEAD            = e6b6098738adfe6420ac86e81d2c273c707ffc8a
MIGRATION_SHA256          = 4cc862a8589206f256d680cc930607d4e7f813aeb1fb6f936cfd7e2b6b3f06fb
MIGRATION_CHANGED_BY_SYNC = NO
DB_SUITE                  = ALL PASS (161/161)
MIGRATION_PREFLIGHT       = READY_NOT_EXECUTED
SITE_DEPLOYMENT_PREFLIGHT = NEEDS_SERVER_ACCESS

MENGXIN_FDE_V1 = PRODUCTION_BLOCKED
```

The release candidate is this commit — the merge of `4070d6d8` into the branch plus this report. `PR207_RELEASE_HEAD` and `CI_RUN_ID` are the SHA of this commit and the CI run against it; they are reported with the delivery rather than written here, since a commit cannot record its own hash. The freeze is declared only if that run is green **and** `origin/main` is still `4070d6d8` at the moment of declaration; if `main` has moved again, the drift is evaluated first and nothing is frozen.

Unchanged from earlier rounds, and not addressed by this one:

- `SITE_DEPLOYMENT_PREFLIGHT` stays `NEEDS_SERVER_ACCESS`. Everything checkable without the server passes and the delta package is ready, but the deployed version has not been compared and nothing has been deployed.
- `MENGXIN_FDE_V1` stays `PRODUCTION_BLOCKED`. Migration not applied, #207 not merged, site not deployed, real-form acceptance (PART 七) and the human approval / Trade Inbox steps (PART 八) not run.
- Open P1 items, again not fixed here because they are outside this lane: the Trade-lane inquiry analysis and design LLM calls have no `isAIConfigured()` guard; `MAX_CONCURRENT_RUNS` reservations are never released at run terminal, so an organisation can start only 10 agent runs per 5 minutes; `scripts/seed-revenue-spine-policy.ts` does not call `assertProductionOperationAllowed()`; the FDE's default owner has no email provider connected; `RUNTIME_P1_TRUSTED_DECISION_ACTOR_CLEANUP`; `20260829200000_add_vinyl_work_order` is applied in production but present in neither migration registry.

#207 remains unmerged, pending explicit release authorization. #206 stays open until #207 merges.

---

# Round 6 — Production release of PR #207 (2026-09-11)

Rounds 1–5 above are unchanged, including every blocked status they recorded. This round executed the authorized production release: the migration, the merge and the Qingyan deployment. The Mengxin website half could not be executed and is recorded below with its exact boundary. No V2 work was started.

## R6-1. Final freeze check (PART 1)

```text
origin/main at start = 4070d6d83842427e6318ab92ad7d19f0cc76fbae   ✓ as frozen
PR #207 head         = d93ce70f0537f68ddbdbfbafd5dae7e7190ba607   ✓ as frozen
PR #207 state        = OPEN, draft, not merged, MERGEABLE, CLEAN  ✓
```

One operational note before any production write: the scratch worktree used in rounds 2–5 had been partially deleted overnight by the OS temp-file cleaner, leaving a broken `.git` link. Nothing was lost — every commit was already pushed — but the tree could not be trusted, so it was discarded and a fresh worktree was checked out at `d93ce70f`. The working tree was clean and the migration SHA256 recomputed from it still read `4cc862a8…`. Every production step below was run from that clean tree, never from the main checkout, whose working directory carries unrelated uncommitted migration directories that would have been swept into `migrate deploy`.

## R6-2. Pre-migration revalidation (PART 2)

Target confirmed by comparing the `.env` `DIRECT_URL` host against Neon's own answer for the default branch — `ep-super-field-antfibsl…` is the endpoint of `br-green-boat-ann7k5yf`, `[default] production`. No credential was printed at any point.

```text
PENDING_MIGRATIONS = 20260908120000_website_inquiry_receipt   (count = 1, nothing else)
MIGRATION_SHA256   = 4cc862a8589206f256d680cc930607d4e7f813aeb1fb6f936cfd7e2b6b3f06fb
```

`20260829200000_add_vinyl_work_order` appeared, as expected, in the "present in the database but not found locally" block — already applied, not pending. Its registry inconsistency was left exactly as it was; nothing was repaired opportunistically.

## R6-3. Production snapshot (PART 3)

```text
PRE_PR207_PROD_SNAPSHOT     = prod-pre-website-inquiry-receipt-migration-20260911 (br-curly-dawn-an6hhzh0)
PRODUCTION_BRANCH           = br-green-boat-ann7k5yf ([default] production)
PRE_MIGRATION_SCHEMA_STATUS = 1 pending; "WebsiteInquiryReceipt" absent (to_regclass = null)
```

Retain this snapshot. It is a point-in-time branch for inspection and targeted recovery, not standing permission for an automatic full-database restore.

## R6-4. Migration applied (PART 4)

Applied through the protected command only, from the frozen tree, behind an inline guard that would have aborted had the pending set been anything other than that one migration:

```bash
ALLOW_DATABASE_MIGRATION=true CONFIRM_PRODUCTION_MIGRATION=I_UNDERSTAND_PRODUCTION_MIGRATION npm run db:migrate:deploy
```

`safe-migrate-deploy` recognised the target as protected (`protectedTarget=true`) and applied exactly one migration. No `db push`, no `--accept-data-loss`, no `migrate dev`, no `migrate reset`, no manual DDL.

Read-only verification afterwards:

```text
prisma migrate status → "Database schema is up to date!", exit 0, zero pending
WebsiteInquiryReceipt → 24 columns, 6 indexes (pkey + orgId/source/eventId UNIQUE + 4 ordinary), 0 rows
```

The columns and indexes match the reviewed structure exactly, including the `status` default `received`, `source` default `website`, `eventIdProvided` default true, `attempts` default 1 and `conflictCount` default 0.

```text
PR207_PRODUCTION_MIGRATION = PASS
```

## R6-5. Old build still compatible (PART 5)

Checked before merging, on the build that predated #207, now running against the migrated database:

```text
qingyan.ca /            → 307 (auth redirect, normal)
/login                  → 200
/api/revenue/cockpit    → 401
/api/trade/prospects    → 401
/api/sales/customers    → 401
/api/trade/webhook/website (no secret) → 401 {"error":"invalid secret"}
```

No schema errors, no 500s. As expected for a migration that only adds a table.

## R6-6. Merge (PART 6)

Marked ready for review, then merged with an exact head lock (`--match-head-commit d93ce70f…`) using the repository's normal merge-commit method.

```text
PR207_MERGE_SHA   = fba7a6b28f220c09dd03fd3d7c0907ca38f5f002
POST_207_MAIN_SHA = fba7a6b28f220c09dd03fd3d7c0907ca38f5f002
PR #207 merged    = true
main contains d93ce70f = YES
```

The PR was not amended after merge.

## R6-7. Qingyan production deployment (PART 7)

The Git-integration build ran from the new `main` and passed — the migration gate is satisfied because the migration was already applied.

```text
/api/health → {"status":"ok","checks":{"database":"ok","isolation":"ok",
               "runtimeEnv":"production","dbPlane":"production","deployedCommit":"fba7a6b"}}
/api/trade/webhook/website  reachable
  unauthenticated POST      → 401 {"error":"invalid secret"}
  wrong-secret POST         → 401
  receipts created by those probes → 0 (fail-closed before any write)
```

While this was being verified, PR #208 (Supplier Intelligence M1-S3-A workspace) was merged behind #207, moving `main` to `7261388a` and triggering another production deployment. That does not affect this release: `7261388a` contains `fba7a6b2` contains `d93ce70f`, and all checks above were re-run against the newer deployment with identical results (`deployedCommit: 7261388`, database ok, webhook 401).

```text
QINGYAN_PR207_PRODUCTION_DEPLOYMENT = PASS
```

The website channel secret was never printed, sent or logged.

## R6-8. Mengxin website — stopped at server access (PART 8–12)

```text
LIVE_SITE_ROOT                    = NEEDS_SERVER_ACCESS
PROCESS_MANAGER                   = NEEDS_SERVER_ACCESS
NODE_VERSION                      = NEEDS_SERVER_ACCESS
CURRENT_DEPLOYMENT_BACKUP         = NEEDS_SERVER_ACCESS
CURRENT_QINGYAN_FORWARDER_PRESENT = NEEDS_SERVER_ACCESS (undecidable from outside — see below)
QINGYAN_WEBHOOK_SECRET_PRESENT    = NEEDS_SERVER_ACCESS
OUTBOUND_HTTPS_TO_QINGYAN         = NEEDS_SERVER_ACCESS
INQUIRY_DATA_DIR                  = NEEDS_SERVER_ACCESS
RECOVERY_SCHEDULER                = NEEDS_SERVER_ACCESS
```

The deployment helpers `.deploy/scp_up.exp` and `.deploy/ssh_run.exp` take host, user and password as command-line arguments; no host or credential is stored in the repository or on this machine, and none was supplied with this authorization. Without them the read-only server checklist in `docs/QINGYAN_BRIDGE.md` cannot be run, so nothing was deployed. PART 8 is explicit that an unknown production tree must not be blindly overwritten, and that is exactly the situation.

What *was* checkable from outside, and one correction worth recording:

```text
https://mengxinhometextile.com/           → 200
https://mengxinhometextile.com/contact    → 200
https://mengxinhometextile.com/api/admin/inquiries → 401
```

That 401 initially looked like evidence that the bridge's admin routes were already live. It is not. `src/middleware.ts` and `src/lib/admin-auth.ts` already exist in the **pre-bridge** baseline (`d3afac9`) and return 401 for any `/api/admin/*` without a valid admin cookie — confirmed by `/api/admin/does-not-exist-xyz` also returning 401 while `/api/does-not-exist-xyz` returns 404, and by the live nginx config being a plain reverse proxy with no auth rule. The probe therefore says nothing either way about whether the bridge is deployed. Only the server-side checklist can answer that.

The reviewed package is verified and ready for the moment access exists:

```text
package = 梦馨家纺网站-bridge-delta-da4ff0c.tar.gz
sha256  = 83ec8f03de0d92d58a76b4415428df66b3604b7fb664390d387af609978c28d0   ✓ matches the frozen value
manifest = 15 files, all bridge files only (.env.example, .gitignore, docs/QINGYAN_BRIDGE.md,
           scripts/preflight-bridge.sh, 3 api routes, 4 lib files, middleware.ts, 3 tests)
           — no unrelated website content
```

```text
MENGXIN_WEBSITE_BRIDGE_DEPLOYMENT  = BLOCKED (NEEDS_SERVER_ACCESS)
MENGXIN_WEBSITE_RECOVERY_OPERATION = BLOCKED (NEEDS_SERVER_ACCESS)
```

PARTS 9–12 (backup, persistent data directory, server environment, deployment, recovery-operation verification) were not reached.

## R6-9. Real acceptance and human checkpoints (PART 13–16) — not reached

PART 13's stated precondition is `MENGXIN_WEBSITE_BRIDGE_DEPLOYMENT = PASS`, which does not hold, so no form was submitted. Submitting the public form now would only re-prove the round-1 failure while creating a real inquiry record. Calling the Qingyan webhook directly as a substitute is forbidden and was not done.

The prepared fixture is still valid — re-checked read-only in production, and nothing has been created since the round-2 preflight:

```text
org 梦馨家纺 (mengxin-home-textile, cmrv37moo0001sbskqeknr5km)
TradeProspect with the acceptance email    = 0
SalesCustomer with the acceptance email    = 0
SalesOpportunity for that customer         = 0
TradeMessage carrying QY-ACC-20260908-d524b362 = 0
WebsiteInquiryReceipt rows in the org      = 0
website-channel TradeMessage, last 7 days  = 0
```

So the original controlled fixture (2,000 waffle-weave hotel bathrobes, hotel project, Vancouver, embroidered logo, marker `QY-ACC-20260908-d524b362`) can be used unchanged. No production record was deleted and no dedupe rule was altered.

Human checkpoints A and B were therefore not reached; no draft was approved, and no send was performed or simulated.

## R6-10. Status (PART 17)

```text
PR207_PRODUCTION_MIGRATION          = PASS
PR207 merged                        = PASS  (fba7a6b2)
QINGYAN_PR207_PRODUCTION_DEPLOYMENT = PASS
MENGXIN_WEBSITE_BRIDGE_DEPLOYMENT   = BLOCKED (NEEDS_SERVER_ACCESS)
real browser inquiry                = NOT RUN
website → Qingyan delivery          = NOT RUN
event receipt / intake / FDE draft  = NOT RUN
Lucas human approval                = NOT REACHED
real Gmail receipt                  = NOT REACHED
Trade reverse mirror                = NOT REACHED
manual-send supersession            = NOT REACHED
MENGXIN_WEBSITE_RECOVERY_OPERATION  = BLOCKED (NEEDS_SERVER_ACCESS)

MENGXIN_FDE_V1 = PRODUCTION_BLOCKED
```

**Remaining boundary, precisely:** the Qingyan side of Mengxin FDE V1 is fully released and live — migration applied, #207 merged, production serving it, receiving endpoint reachable and fail-closed. The single thing standing between this and `PRODUCTION_VALIDATED` is that the Mengxin website bridge has not been deployed, because no authorized server access (host, user, password, or a key with rights on that VPS) has been supplied. Everything downstream of that — real form submission, delivery, receipt, intake, FDE draft, both human checkpoints — is waiting on it and on nothing else.

## R6-11. Housekeeping (PART 18 and security follow-up)

- PR #206 closed as superseded by #207. Before closing, all 171 lines of its report were verified present in this document on `main`; nothing was lost, and its Git history is intact. GitHub's auto-fix watcher had flagged merge conflicts on #206 — resolving them would have been wrong, since the PR's entire content now lives on `main` through #207.
- Security follow-up filed as issue #211, `NEON_PRODUCTION_CREDENTIAL_ROTATION` (P1): Neon's `neondb_owner` credential is project-wide, so isolated branches cloned from production share it, and it was present in local scratchpad environment files during the #207 validation. Git history exposure: none found. Scratchpad files: deleted. Rotate after the current controlled release and validation window unless operational evidence requires it sooner; update all authorized consumers atomically and verify the old credential is rejected. No password, old or new, appears in this report or that issue.
- Open P1 items carried forward unchanged: the Trade-lane inquiry analysis and design LLM calls have no `isAIConfigured()` guard; `MAX_CONCURRENT_RUNS` reservations are never released at run terminal; `scripts/seed-revenue-spine-policy.ts` does not call `assertProductionOperationAllowed()`; the FDE's default owner has no email provider connected; `RUNTIME_P1_TRUSTED_DECISION_ACTOR_CLEANUP`; `20260829200000_add_vinyl_work_order` is applied in production but in neither migration registry.

No V2 Quotation Engineer work, no new FDE functionality, no Trade analysis consolidation, no notification cleanup and no ERP work was started.
