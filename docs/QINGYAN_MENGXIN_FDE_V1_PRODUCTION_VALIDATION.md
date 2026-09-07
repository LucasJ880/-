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
