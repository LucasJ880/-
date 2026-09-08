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
