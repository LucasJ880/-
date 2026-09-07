# QINGYAN_MENGXIN_FDE_V1_P0_5_TRADE_OUTBOUND_SYNC

- Date: 2026-09-06
- Base: PR #203 head `4765b3e5` (= `origin/main` `a69f7c61` + #203; #203 is approved for merge with activation hold and was not yet merged when this branch was cut, so the branch is stacked on #203 and re-targets `main` once #203 lands)
- Branch: `feature/mengxin-fde-trade-outbound-sync`
- Scope: make Trade Inbox outbound replies visible to the Revenue Spine and invalidate obsolete FDE reply drafts. No Trade Inbox redesign, no PendingAction for Trade sends, no second interaction system, no schema change.

## 1. Audited outbound flow (PART 1, read-only)

### 1.1 Canonical Trade Inbox reply path (#204)

```
/trade/inbox (client)  submit(mode)
  → POST /api/trade/inbox/[prospectId]/reply         src/app/api/trade/inbox/[prospectId]/reply/route.ts
      auth:      requireRole(request, ["trade","admin"])         (session cookie qy_session → getCurrentUser, user.status active)
      org:       resolveTradeOrgId(request, user, { bodyOrgId })  (Security-1: activeOrgId + active membership; explicit orgId cross-checked)
      prospect:  loadTradeProspectForOrg(prospectId, orgId)       (TradeProspect where { id, orgId } → 404 otherwise)
      mode=send: sendEmail({ to: prospect.contactEmail, subject, body })   src/lib/trade/email.ts (Resend; RESEND_API_KEY required; 502 on failure)
      mode=mark_sent: no external send (human sent outside the system)
      write:     createMessage({ prospectId, direction:"outbound", channel:"email", subject, content, aiDraft:true })   src/lib/trade/service.ts → db.tradeMessage.create
      prospect:  updateProspect(prospectId, { stage: stageAtLeastContacted(stage), lastContactAt: now, nextFollowUpAt: now+3d })
      response:  { ok, mode, messageId, nextFollowUpAt }
```

The Trade Inbox has a second human-declared outbound: "标记已处理" (`markHandled`) → `PATCH /api/trade/prospects/[id]` (lastContactAt/nextFollowUpAt) + `POST /api/trade/prospects/[id]/messages` with `direction:"outbound"`, `channel: thread.channel`, content "已在系统外回复买家（收件箱标记）" (#201). Same auth/org/prospect gates; writes `TradeMessage` outbound; `updateProspect({ lastContactAt })`.

Other `TradeMessage` outbound writers (not the Inbox, listed for completeness): `POST /api/trade/prospects/[id]/send` (outreach 开发信 send / mark_sent via Resend, `channel:"email"`), `sendChannelMessage()` in `src/lib/trade/channel-service.ts` (WhatsApp / WeChat / WeCom outbound through `POST /api/trade/channels/[channel]/send`). The Revenue Spine executor (`sales.send_inquiry_reply`) does **not** write `TradeMessage`.

### 1.2 Link between the lanes

`TradeProspect.convertedToSalesOpportunityId` / `convertedToSalesCustomerId` are written by (a) `ingestWebsiteInquiry` (#203 spine back-fill for every website inquiry) and (b) the manual `convert-to-sales` route / `sales-conversion.ts`. `SalesOpportunity.sourceTradeProspectId` is the reverse pointer. The reply route already holds the full prospect row (`loadTradeProspectForOrg` includes the column), so the opportunity id is available at the point of send with no extra query.

### 1.3 Canonical Revenue-side primitives

- `logRevenueInteraction()` (`src/lib/revenue-spine/interactions.ts`): creates `CustomerInteraction`, and for `direction:"outbound"` sets `SalesOpportunity.lastOutboundAt`, increments `followUpCount`, sets `lastInteractionAt`, recomputes the next action. Accepts `occurredAt`, `emailMessageId`, `source`, `extra` (persisted in `analysisResult` JSON). It owns `lastOutboundAt`; callers must not update it directly.
- PendingAction rejection: `rejectApprovalItem("pending_action", id, ctx)` in `src/lib/approval/port.ts` → executor `rejectPendingAction` (B2 CAS pending→rejected, audit) → run reconcile (no-op for #203 drafts, which carry no `agentRunId`). Permission: `canDecideTeamApproval` = super admin, or `approverUserId === ctx.userId`, or org owner / org admin / project owner / project admin. A Trade rep who is neither the draft's approver nor an org admin gets `无权操作该草稿`.
- Executor `exec-sales-inquiry-reply.ts` gates before send: org match, `INACTIVE_MEMBERSHIP`, opportunity/customer/recipient consistency, `STALE_DRAFT` when a **newer inbound** interaction exists than `replyToInteractionId`. It has **no check against newer outbound interactions** — a manual Trade reply after the draft would not stop a late approval. `PendingAction.createdAt` exists and is the trusted draft-creation time; the executor currently receives only `action.payload` and `action.id`.

### 1.4 Gap statement

With #203 as-is, the sequence "FDE draft pending → salesperson replies from the Trade Inbox → customer receives it → draft approved later → customer receives a second, stale reply" is possible: the Trade reply writes only `TradeMessage`/`TradeProspect`, the Spine's `lastOutboundAt` stays null, the draft stays pending, and the executor's stale check only looks at inbound messages. The reverse gap also exists: after an approved FDE send, the Trade Inbox still shows the thread as unreplied (no `TradeMessage` outbound), inviting a second manual reply.

## 2. Changed files

| File | Change |
|---|---|
| `src/lib/trade/outbound-sync.ts` (new) | `syncTradeOutboundToRevenueSpine()` — the only Trade→Revenue bridge; `supersedePendingInquiryReplies()`; never throws |
| `src/app/api/trade/inbox/[prospectId]/reply/route.ts` | after `createMessage` + `updateProspect`: call the bridge with `source = trade_inbox.reply` (send) / `trade_inbox.mark_sent`; captures Resend `messageId`; response gains `revenueSync` |
| `src/app/api/trade/prospects/[id]/messages/route.ts` | `direction = outbound` (Inbox "标记已处理" / manual log): call the bridge with `source = trade_prospect.manual_outbound`; response gains `revenueSync` |
| `src/app/api/trade/prospects/[id]/send/route.ts` | outreach send / mark_sent: call the bridge with `source = trade_outreach.send` / `trade_outreach.mark_sent` |
| `src/app/api/trade/channels/[channel]/send/route.ts` | WhatsApp / WeChat / WeCom send: call the bridge with `source = trade_channel.send`, channel-typed interaction |
| `src/lib/pending-actions/exec-sales-inquiry-reply.ts` | executor race gate (`STALE_DRAFT` when any outbound `CustomerInteraction` is newer than `PendingAction.createdAt`); idempotent reverse mirror `mirrorApprovedReplyToTradeTimeline()` |
| `src/lib/revenue-spine/__tests__/revenue-spine-db.isolated.test.ts` | section 13: cases A–H against the real route handlers and the approval port |
| `docs/QINGYAN_MENGXIN_FDE_V1_TRADE_OUTBOUND_SYNC.md` (new) | this report |

No Prisma schema or migration change. No Trade Inbox UI change. No new PendingAction type. Trade sends stay human-click actions (not moved into PendingAction).

## 3. Mirror semantics (Trade → Revenue)

Trigger: only after a Trade route has persisted a real human outbound `TradeMessage` (inbox reply, inbox mark, manual outbound log, outreach send, channel send). The bridge:

1. Loads the prospect **scoped by org** and requires `convertedToSalesOpportunityId`; then verifies the opportunity exists **in the same org** (a dangling or cross-org link is fail-closed: nothing is mirrored, `error = LINKED_OPPORTUNITY_MISSING`). Trade-only prospects return `linked = false` and no Revenue object is created.
2. Writes the outbound through the canonical `logRevenueInteraction()` with `direction = outbound`, `channel` (email / whatsapp / …), `type` derived from channel (`email` → `email`, wechat* → `wechat`, phone → `phone_call`, else `note`), `source` (e.g. `trade_inbox.reply`), `emailMessageId` (Resend id when sent through the system), `createdById = actor`, and `analysisResult` evidence `{ source, tradeProspectId, tradeMessageId, emailMessageId, mode }`. `SalesOpportunity.lastOutboundAt`, `followUpCount`, `lastInteractionAt` and the next action are set by `logRevenueInteraction` itself — the bridge never touches opportunity columns.
3. Supersedes pending FDE drafts (§4).
4. Writes `AuditLog` `revenue_spine.trade_outbound.mirrored`; on any failure `revenue_spine.trade_outbound.mirror_failed` (+ console error) and returns `{ error }` — the Trade reply is already persisted and is **never rolled back**.

Reverse mirror (Revenue → Trade), added so the Inbox stops showing an FDE-answered thread as "待回复": after a successful approved send, the executor writes one outbound `TradeMessage` (`aiDraft = true`, subject/body + marker line `[青砚审批发送 · ref <interactionId>]`) on the prospect whose `convertedToSalesOpportunityId` is the opportunity, and updates `lastContactAt` / `nextFollowUpAt (+3d)` / `stageAtLeastContacted`, i.e. the same prospect bookkeeping the Inbox reply route performs. It is written directly via `createMessage`, not through a Trade route, so it can never re-enter the Trade→Revenue bridge (no loop).

## 4. PendingAction supersession

After a mirrored outbound, every `PendingAction` with `type = sales.send_inquiry_reply`, `status = pending`, unexpired, and `payload.opportunityId = <opportunity>` is **system-superseded** through the internal primitive `supersedePendingAction()` (`src/lib/pending-actions/supersede.ts`, P0.5.1 — see §14): B2-style CAS `pending → failed`, machine-readable `failureReason`, no `decidedById` / `decidedAt`, audit `APPROVAL_SYSTEM_SUPERSEDED` carrying the real trigger actor. The stored reason:

```text
SUPERSEDED_BY_MANUAL_REPLY tradeMessageId=<TradeMessage.id> outboundInteractionId=<CustomerInteraction.id> triggeredBy=<real Trade actor> terminationMode=system_superseded
```

Failures are collected into `supersedeFailures`, logged (`revenue_spine.trade_outbound.supersede_failed`) and returned; they never fail the Trade reply. (The first P0.5 iteration rejected through the human approval port and, on a permission failure, retried as the draft's designated approver; that fallback fabricated a decision actor and was removed in P0.5.1.)

## 5. Executor race gate (defense in depth)

`exec-sales-inquiry-reply` now refuses when a `CustomerInteraction` with `direction = outbound` exists for the opportunity with `createdAt > PendingAction.createdAt` (the draft row's own server-side creation time, looked up by `pendingActionId`; no client timestamp). Result: `{ ok: false, errorCode: "STALE_DRAFT" }`, no send, and the port marks the draft failed. This covers the ordering `draft T1 → manual reply T2 → late approval T3` even when the supersede step is delayed or fails, and also the executor's pre-existing `STALE_DRAFT` for newer inbound messages, `INACTIVE_MEMBERSHIP`, org/customer/recipient consistency, and B2 duplicate execution.

## 6. Idempotency and loop safety

- Trade→Revenue: idempotency key is `tradeMessageId` stored in `CustomerInteraction.analysisResult`; a second call for the same message returns `replay = true` and the existing interaction (supersession still runs, itself idempotent through B2).
- Revenue→Trade: idempotency key is the interaction id inside the marker line; a duplicate approval (B2 `duplicate`) does not execute the send and cannot create a second `TradeMessage`.
- The Revenue executor never calls the Trade→Revenue bridge (it logs its interaction directly); the reverse mirror writes `TradeMessage` without calling any Trade route. Hence no `executor → TradeMessage → mirror → interaction` chain is possible.

## 7. Authorization

Unchanged gates, now exercised by tests: `requireRole(["trade","admin"])` + `resolveTradeOrgId` (active membership, explicit org cross-check) + `loadTradeProspectForOrg` (org-scoped prospect) on every Trade route; the bridge re-scopes the prospect and the opportunity by `orgId`; the actor recorded on the mirrored interaction is the server-session user; the executor keeps `INACTIVE_MEMBERSHIP`, cross-org refusal and server-derived principal semantics from #203.

## 8. Tests (PART 6)

Section 13 of `src/lib/revenue-spine/__tests__/revenue-spine-db.isolated.test.ts` drives the **real route handlers** (`POST /api/trade/inbox/[prospectId]/reply`, `POST /api/trade/prospects/[id]/messages`) with a signed `qy_session` cookie (`createSession`, `JWT_SECRET` set in the test process) and the canonical approval port; the Revenue sender is injected so no email leaves the test.

| Case | What is proven |
|---|---|
| A — manual reply supersedes FDE draft | website inquiry → FDE draft pending → Inbox reply (`mark_sent`) → 200; `TradeMessage(outbound)=1`, `CustomerInteraction(outbound)=1` with `source=trade_inbox.mark_sent`, `tradeMessageId`, `tradeProspectId`, actor; `lastOutboundAt` set, `followUpCount=1`, next action `follow_up`; old draft `failed` with `SUPERSEDED_BY_MANUAL_REPLY tradeMessageId=… outboundInteractionId=… triggeredBy=<actor> terminationMode=system_superseded`, `decidedById = null`; audit `APPROVAL_SYSTEM_SUPERSEDED`; zero Revenue sends; replaying the same `tradeMessageId` returns `replay=true` without a second interaction |
| B — late approval cannot double-send | port approve of the superseded draft → `ok=false, status=failed, duplicate=true`, no send; direct executor call → `ALREADY_FAILED`, no send |
| C — race defense | new draft (T1) → outbound interaction logged directly (T2, supersede step absent) → port approve (T3) → executor refuses `STALE_DRAFT`, no send |
| D — Trade-only prospect | prospect without `convertedToSalesOpportunityId`: reply route 200, `TradeMessage(outbound)=1`, `revenueSync.linked=false`, no `SalesCustomer`/`CustomerInteraction` created |
| E — multiple customer messages | new genuine website message after the manual reply → inbound logged, `CUSTOMER_REPLIED`, new FDE run, new current draft pending (the earlier stale draft is `failed`), opportunity not suppressed |
| F — authorization | other-org member with explicit `orgId` → 403; inactive membership → 403; own-org member replying to another org's prospect → 404 and no `TradeMessage` written |
| G — reverse mirror | approving the current draft → exactly one send, one outbound `TradeMessage` with the `[青砚审批发送 · ref …]` marker, prospect `stage`/`lastContactAt`/`nextFollowUpAt` updated; duplicate approval → no second send, no second `TradeMessage` |
| H — Inbox "标记已处理" | `POST /api/trade/prospects/[id]/messages` (`direction=outbound`, channel whatsapp) → mirrored (`linked=true`) and the pending draft system-superseded (`failed`) |
| I — non-approver Trade rep (P0.5.1) | draft approver = `TRADE`; a second active, non-admin rep `TRADE2` replies through the real route → 200, outbound interaction `createdById = TRADE2`, draft `failed` with `triggeredBy=TRADE2`, **`decidedById = null` (never `TRADE`)**, audit `APPROVAL_SYSTEM_SUPERSEDED` with `userId = TRADE2`, `triggeredByUserId = TRADE2`; the approver's late approval is refused; no send |
| J — actor is the approver (P0.5.1) | Case A actor `TRADE` is also the draft approver: the same system path runs, `decidedById = null`, `decidedAt = null` — no branch back into a human "reject" |
| K — forged principal impossible (P0.5.1) | request body carrying `approverUserId`, `decidedById`, `actor`, `actorUserId`, `triggeredByUserId`, `userId`, `systemActor` = another user is ignored: interaction `createdById`, audit `userId`/`triggeredByUserId` = the session user; no audit row exists for the forged id; the primitive's input type has no `decidedById` field at all |
| L — race remains blocked | = Case C: draft T1 → outbound T2 with supersession absent → approval T3 → executor `STALE_DRAFT`, 0 second sends |

Sections 1–12 of the same file (from #203) re-ran unchanged: intake/dedupe, FDE, approval via port, customer reply, transitions/outcomes, attribution, cockpit, website idempotency A–D, executor `STALE_DRAFT` (inbound), `INACTIVE_MEMBERSHIP`, API-boundary 403s, supervisor cancel.

## 9. Isolated DB evidence (PART 7)

- Branch `preview-mengxin-fde-v1-outbound-sync-202609061044` (`br-mute-snow-anq31njm`), child of production `br-green-boat-ann7k5yf` in project `polished-thunder-16018212`. `prisma migrate status` listed only `20260906120000_mengxin_fde_revenue_spine` (from #203) as pending; `prisma migrate deploy` applied it; status "up to date".
- Final run: **105 / 105** (`Revenue Spine DB e2e 结果: 105 通过, 0 失败`; section 13 = 21 assertions). Two earlier runs on the same branch were invalid for environmental reasons and are recorded for honesty: one esbuild transform error in the test file (duplicate identifier, fixed) and one Prisma `P2024` pool timeout caused by running `tsc` concurrently with the suite (rerun alone → green).
- Branch deleted after the evidence was captured; the connection-string file was removed. Never executed: `prisma db push`, production `migrate deploy`, production seed, manual DDL.

## 10. Migration status

No schema or migration change in this PR. The only pending migration on a production snapshot remains #203's `20260906120000_mengxin_fde_revenue_spine`, unchanged (sha256 `037871de…46d7`, still registered in `expected-migrations.ts`, `check-release-safety.test.ts`, `verify-migration-history.ts`).

## 11. CI

PR #205 `feature/mengxin-fde-trade-outbound-sync` → base `feature/mengxin-fde-revenue-spine` (#203 head `4765b3e5`; #203 was still open at the time, so #205 is stacked and is to be re-based onto `main` after #203 merges). Code HEAD `3dfdad5c0333afc56e8e19e332ed68bbb618189d`.

| WORKFLOW | HEAD | STATUS | CONCLUSION | RUN URL/ID |
|---|---|---|---|---|
| CI · validate-lint-typecheck-test-build | `3dfdad5c` | completed | success | https://github.com/LucasJ880/-/actions/runs/34063560515 (job 101568291778) |
| Vercel – qingyan-staging (preview deploy) | `3dfdad5c` | completed | pass / SUCCESS | https://vercel.com/lucas-9039s-projects/qingyan-staging/AXqZkfF8i9gnMMRPi5ViAcyEicNH |
| Vercel – - (production project; ignored build step) | `3dfdad5c` | completed | pass / SUCCESS | https://vercel.com/lucas-9039s-projects/-/5VVgk118gCr8fsZbbNS9645TjqxY |
| Vercel Preview Comments | `3dfdad5c` | completed | pass / SUCCESS | https://vercel.com/github |

GitHub API after the run: `mergeable = true`, `mergeable_state = clean`, `draft = true`. The commit adding this report is docs-only; its run is reported in the closing message.

## 12. Unresolved P1 items (unchanged from #203 §13, not addressed here by instruction)

1. Two analyses per website inquiry (`TradeInquiryAnalysis` + Spine FDE). Not consolidated.
2. Notification fan-out (Trade member + Spine owner + approval) for one inquiry. Not consolidated.
3. Inbound messages logged manually through `POST /api/trade/prospects/[id]/messages` (`direction=inbound`) are not mirrored into the Spine (this PR mirrors outbound only; website re-submissions already reach the Spine through the webhook).
4. `/revenue` remains in the trade sidebar's "更多" partition.

## 13. Status

Acceptance condition (PART 8) verified on a real database through the real route handlers and the approval port: after a manual Trade Inbox reply, the older FDE `PendingAction` is superseded, a late approval is refused, and even with the supersede step absent the executor refuses on its own; the customer receives one reply. The symmetric case (approved FDE send, then a manual reply prompted by an "unreplied" inbox) is closed by the reverse mirror.

```text
MENGXIN_FDE_V1_TRADE_OUTBOUND_SYNC = PASS
```

Not done by instruction: V2, Trade Inbox redesign, consolidation of the two analysis systems, notification fan-out, navigation changes, ERP scope, production deploy / migration / seed. #205 is not merged; #203 is not merged.

## 14. Trusted Supersession Principal Closure (P0.5.1)

### Audit of the substrate

- `rejectPendingAction()` (executor) persists `status=rejected, decidedAt=now, decidedById=ctx.userId` — the schema documents `decidedAt` as the approve/reject time, and every writer of `decidedById` in the repo is a human decision path (executor approve/reject, capabilities approval decision, quote-signature route). Two legacy system paths already misuse it (`pending-link` run cancellation writes `input.userId || createdById`; batch prepare compensation writes the creator) — pre-existing, not changed here.
- The canonical **system** termination convention is expiry: `approval/port.expireOverdueApprovals()` and the executor's expiry branch write `status=failed` + `failureReason` with **no** `decidedById`/`decidedAt`, using a per-row CAS on `status=pending`. No supersede primitive existed; nothing else terminates a draft on "newer evidence".
- Terminal statuses are `executed | failed | rejected` (`terminal.ts`); B2 duplicate codes `EXECUTION_IN_PROGRESS | ALREADY_EXECUTED | ALREADY_REJECTED | ALREADY_FAILED` give deterministic results to late approvals of any terminal row.

### Old (incorrect) semantic

P0.5's `supersedePendingInquiryReplies()` called `rejectApprovalItem()` as the Trade actor and, when that actor lacked approval permission, retried as `approverUserId ?? createdById`. The substrate then recorded `decidedById = <designated approver>` — a person who performed no action. The FDE's newer-inbound supersession had the same defect through the run principal (`principalUserId`).

### New semantic — system supersession

`src/lib/pending-actions/supersede.ts` (owner directory, internal server primitive, not an endpoint):

- `supersedePendingAction({ pendingActionId, orgId, expectedType, reasonCode, triggeredByUserId, auditActorUserId, evidence })`.
- Org-scoped lookup (cross-org → `NOT_FOUND`, no leak); `expectedType` enforced (`TYPE_MISMATCH`); run-linked drafts refused (`RUN_LINKED`, the run lifecycle owns them); `status` must be `pending`, otherwise deterministic duplicate results (`ALREADY_SUPERSEDED` / `ALREADY_REJECTED` / `ALREADY_FAILED` as `ok=true, duplicate=true`; `ALREADY_EXECUTED` and `EXECUTION_IN_PROGRESS` as `ok=false`).
- CAS: `updateMany where { id, orgId, type, status: "pending" } → { status: "failed", failureReason }`; count≠1 → re-read → duplicate mapping. No external side effect.
- `decidedById` and `decidedAt` are **never written** (schema keeps them `null`, no schema change).
- `failureReason` is machine-readable: `<REASON_CODE> [tradeMessageId=…] [outboundInteractionId=…] [inboundInteractionId=…] [agentRunId=…] triggeredBy=<userId|none> terminationMode=system_superseded`.
- Audit `APPROVAL_SYSTEM_SUPERSEDED` (`afterData`: `terminationMode=system_superseded`, `reasonCode`, `triggeredByUserId`, `decidedById=null`, evidence ids, `auditActorSemantics`). `AuditLog.userId` is a non-null FK: for a Trade outbound it is the real actor; for the FDE's newer-inbound case there is no human actor, so the run principal carries the audit row and `auditActorSemantics = run_principal_not_actor` states that explicitly, with `triggeredByUserId = null`.

Call sites: `trade/outbound-sync.ts` (`SUPERSEDED_BY_MANUAL_REPLY`, `triggeredByUserId = real Trade actor`) and `revenue-spine/fde/inbound-sales.ts` (`SUPERSEDED_BY_NEWER_INBOUND`, `triggeredByUserId = null`, evidence = inbound interaction + run). The reject-as-actor / retry-as-approver code is gone; `rejectApprovalItem` is no longer imported by either module. Normal human approval rules are untouched (the port and executor are unchanged).

### Defense in depth retained

The executor's outbound-after-draft `STALE_DRAFT` gate is unchanged (Case C/L), so a failed or skipped supersession still cannot produce a second customer send.

### Evidence

- DB e2e on isolated branch `preview-mengxin-fde-v1-p051-202609070708` (`br-flat-field-an2zih34`, production snapshot child; only #203's migration pending → deployed): **116 / 116** (`Revenue Spine DB e2e 结果: 116 通过, 0 失败`; all 105 prior assertions kept green, 11 added for Cases I/J/K and the `decidedById` / audit checks). One earlier run on the same branch reported 3 failures that were a test-side JSON parsing error on `AuditLog.afterData` (persisted as a string); the dumped values already showed the correct semantics; the parser was fixed and the suite rerun alone. Branch deleted after the evidence was captured; connection-string file removed. No `db push`, no production migrate/seed, no manual DDL.
- Static: `tsc` clean (main tree and the test file through an extending tsconfig), runtime-architecture guard 9/9, B2 approval-CAS static 18/18, requestApproval facade 18/18, B1 tenant-context static 20/20, eslint clean on touched files.
- CI (head `21b8c85b`):

| WORKFLOW | STATUS | CONCLUSION | RUN URL/ID |
|---|---|---|---|
| CI · validate-lint-typecheck-test-build | completed | success | https://github.com/LucasJ880/-/actions/runs/34068114142 (job 101580376914) |
| Vercel – qingyan-staging (preview deploy) | completed | pass / SUCCESS | https://vercel.com/lucas-9039s-projects/qingyan-staging/3kQ4Rs3Fv8ZC9TgmN8SBftTgJreL |
| Vercel – - (production project; ignored build step) | completed | pass / SUCCESS | https://vercel.com/lucas-9039s-projects/-/FR77N3LX2PWJvybJTrCepFUZjov3 |
| Vercel Preview Comments | completed | pass / SUCCESS | https://vercel.com/github |

The commit adding this section is docs-only; its run is reported in the closing message.

### Final HEAD / base / mergeability (PART 8)

```text
PR205_HEAD (code)         = 21b8c85bae61621ec96368a3aea3d74ec5f0855b
PR205_BASE                = feature/mengxin-fde-revenue-spine @ 4765b3e5 (PR #203 head)
PR203 state               = OPEN, not merged at the time of this closure
origin/main               = a69f7c6191a2eaf634ac2388297b72ad52bf80d7 (unchanged; #203's base)
POST_RETARGET_MAIN_SHA    = n/a — retarget to main deferred until #203 merges (base then collapses cleanly: #205 contains exactly #203's history + the P0.5/P0.5.1 commits, no force push needed)
MERGEABLE                 = true
MERGEABLE_STATE           = clean
DRAFT                     = true (not merged)
```

```text
MENGXIN_FDE_V1_TRADE_OUTBOUND_SYNC = PASS
TRUSTED_SUPERSESSION_PRINCIPAL = PASS
```
