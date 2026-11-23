/**
 * BIDPAGE-6「定报价只点一次」——服务（openspec change quote-one-step-confirm，design D1–D9）
 *
 * - 一次定价：草稿 → 待批准 → 已批准 + 选为我方报价，一个事务；迁移、台账用报价引擎的同一段代码
 *  （assertQuoteTransitionAllowed / applyQuoteTransitionTx），批准后照旧 syncTenderBidPointerTx；
 *   同步后指针不是这一份 → 同一事务改选（writeBidMirrorsTx，与手动选定同一个函数）。
 * - 锁的顺序：报价行 → 项目行（syncTenderBidPointerTx 里锁），与 reviseQuote（谱系根报价行 → 项目行）同向。
 * - 锁内复核：状态、修改时间、按库里现在的内容重算的税前报价 = 确认框里的数；不同就 409、什么都不写。
 * - 提交后写审计：每一步迁移一条（与 transitionQuote 同 action，加 via）→ 同步结果 → 选定（自动选中时同步已写，不重复）。
 * - 提交给负责人：草稿 → 待批准一步，提交后给项目负责人发一条站内通知（既有类型 project_update，不外发，无金额）。
 * - 新写的审计不带成本、毛利类的键（FIX-26 将来的全仓审计守卫）。
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import {
  applyQuoteTransitionTx,
  assertQuoteTransitionAllowed,
  computeForQuote,
  getQuote,
  QuoteEngineError,
  QUOTE_AUDIT_TARGET,
  reviseQuote,
  transitionAuditAction,
  type QuoteRecord,
} from "@/lib/quote-engine/service";
import {
  auditSyncFailure,
  auditSyncResult,
  lockProject,
  sellingPriceOf,
  syncTenderBidPointerTx,
  TenderBidSyncError,
  TENDER_BID_AUDIT_ACTIONS,
  writeBidMirrorsTx,
  type MirrorArgs,
  type SyncResult,
  type TenderBidResolution,
} from "@/lib/quote-engine/tender-bid";
import type { QuoteStatus } from "@/lib/quote-engine/contract";
import { deliverCollabNotification, defaultCollabDeliverDeps, type CollabDeliverDeps } from "@/lib/notifications/collab/deliver";
import { isLineModeQuote, proModeHrefOf, quoteDisplayName } from "../quote-line/contract";
import { isLumpSumQuote } from "../lump-sum/contract";
import {
  awardedOtherZh,
  cannotFromStatusZh,
  cleanNoteText,
  notifyOutcomeZh,
  QUOTE_CONFIRM_ERRORS_ZH,
  RETURN_NOTE_MAX,
  REVISE_REASON_MAX,
  reviewNotificationZh,
  unpricedZh,
  type ConfirmRequest,
  type ConfirmResult,
  type NotifyOutcome,
  type OurBidLine,
  type ReturnRequest,
  type ReturnResult,
  type ReviseRequest,
  type ReviseResult,
  type SubmitRequest,
  type SubmitResult,
} from "./contract";

type Tx = Prisma.TransactionClient;

/** 审计里写明是在标书与报价页做的 */
export const BID_PAGE_VIA = "bid_page";
const SYNC_TRIGGER = "bid_page_confirm";
const SELECT_REASON_ZH = "标书与报价页「定为我方报价」";
/** 一次定价的事务比单步迁移长（两次迁移、两条台账、同步、改选），给足时间；并发时第二个在锁上等第一个提交 */
const TX_TIMEOUT_MS = 15_000;

export type ConfirmDeps = {
  bidSync?: typeof syncTenderBidPointerTx;
  mirror?: (tx: Tx, args: MirrorArgs) => Promise<{ roomMirrored: boolean }>;
};

const QUOTE_INCLUDE = { costLines: { orderBy: { sortOrder: "asc" as const } }, pricingTiers: { orderBy: { sortOrder: "asc" as const } }, lineItems: { orderBy: { sortOrder: "asc" as const } } };

async function loadQuoteTx(tx: Tx, quoteId: string, projectId: string): Promise<QuoteRecord> {
  const q = await tx.projectQuote.findFirst({ where: { id: quoteId, projectId }, include: QUOTE_INCLUDE });
  if (!q) throw new QuoteEngineError("QUOTE_NOT_FOUND", "报价不存在", 404);
  return q;
}

async function lockQuoteRow(tx: Tx, quoteId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "ProjectQuote" WHERE "id" = ${quoteId} FOR UPDATE`;
}

/** 报价属于这个组织，并且是新页面能在页内打开的逐行或总价报价（其余在专业模式里做，spec「四个接口的守卫与门」） */
async function loadBidQuote(quoteId: string, projectId: string, orgId: string): Promise<QuoteRecord> {
  const q = await getQuote(quoteId, projectId);
  if (q.orgId !== orgId) throw new QuoteEngineError("QUOTE_NOT_FOUND", "报价不存在", 404);
  if (q.quoteType === "CUSTOM") throw new QuoteEngineError("NOT_BID_QUOTE", QUOTE_CONFIRM_ERRORS_ZH.notBidQuote, 409);
  if (!isLineModeQuote(q) && !isLumpSumQuote(q)) throw new QuoteEngineError("PRO_MODE_QUOTE", QUOTE_CONFIRM_ERRORS_ZH.proModeQuote, 409);
  return q;
}

/** 报价引擎的门 → 新页面的中文（码不变） */
function assertStepsAllowed(q: QuoteRecord, from: QuoteStatus, steps: QuoteStatus[], actionZh: string): void {
  let cur = from;
  for (const to of steps) {
    try {
      assertQuoteTransitionAllowed(q, { from: cur, to });
    } catch (e) {
      if (!(e instanceof QuoteEngineError)) throw e;
      if (e.code === "QUOTE_UNPRICED_LINES") throw new QuoteEngineError(e.code, unpricedZh(Array.isArray(e.details) ? e.details.length : 1), 409, e.details);
      if (e.code === "QUOTE_INVALID") throw new QuoteEngineError(e.code, QUOTE_CONFIRM_ERRORS_ZH.invalid, 409, e.details);
      if (e.code === "INVALID_TRANSITION") throw new QuoteEngineError(e.code, cannotFromStatusZh(q.status, actionZh), 409);
      throw e;
    }
    cur = to;
  }
}

function sameInstant(a: Date, iso: string): boolean {
  return a.toISOString() === iso;
}

/** 锁内复核：状态与修改时间都与读取时相同 */
function assertUnchanged(fresh: QuoteRecord, from: string, baseUpdatedAt: string, changedZh: string): void {
  if (fresh.status !== from || !sameInstant(fresh.updatedAt, baseUpdatedAt)) throw new QuoteEngineError("QUOTE_CHANGED", changedZh, 409);
}

async function writeStepAudits(input: { projectId: string; orgId: string; userId: string; quoteId: string; version: number; from: QuoteStatus; steps: QuoteStatus[]; note?: string | null }): Promise<void> {
  let cur = input.from;
  for (const to of input.steps) {
    await logAudit({
      userId: input.userId, orgId: input.orgId, projectId: input.projectId,
      action: transitionAuditAction(to), targetType: QUOTE_AUDIT_TARGET, targetId: input.quoteId,
      beforeData: { status: cur }, afterData: { status: to, note: input.note ?? null, version: input.version, via: BID_PAGE_VIA },
    }).catch(() => undefined);
    cur = to;
  }
}

/* ---------------------------------- 一次定价 ---------------------------------- */

const CONFIRM_STEPS: Partial<Record<QuoteStatus, QuoteStatus[]>> = { draft: ["review", "approved"], review: ["approved"], approved: [] };

export async function confirmAsOurBid(input: { projectId: string; orgId: string; userId: string; quoteId: string; request: ConfirmRequest; deps?: ConfirmDeps }): Promise<ConfirmResult> {
  const q = await loadBidQuote(input.quoteId, input.projectId, input.orgId);
  const from = q.status as QuoteStatus;
  const steps = CONFIRM_STEPS[from];
  if (!steps) throw new QuoteEngineError("INVALID_TRANSITION", cannotFromStatusZh(q.status, "定为我方报价"), 409);
  if (!sameInstant(q.updatedAt, input.request.baseUpdatedAt)) throw new QuoteEngineError("QUOTE_CHANGED", QUOTE_CONFIRM_ERRORS_ZH.changed, 409);
  assertStepsAllowed(q, from, steps, "定为我方报价");

  // 已批准且本来就是我方报价：什么都不做
  if (from === "approved") {
    const p = await db.project.findFirst({ where: { id: input.projectId, orgId: input.orgId }, select: { bidQuoteId: true } });
    if (p?.bidQuoteId === q.id) return { id: q.id, status: "approved", version: q.version, isOurBid: true, reselectedFrom: null, alreadyOurBid: true };
  }

  const now = new Date();
  const mirror = input.deps?.mirror ?? writeBidMirrorsTx;
  let outcome: { sync: SyncResult; auditSync: boolean; select: null | { before: string | null; sellingPrice: number; currency: string; roomMirrored: boolean; wroteMirrors: boolean }; reselectedFrom: { id: string; version: number } | null; already: boolean };
  try {
    outcome = await db.$transaction(async (tx) => {
      // 锁的顺序：报价行 → 项目行（台账写入要对项目行取共享锁、同步要取排他锁：先把排他锁拿到，两份报价同时定不会互锁）
      await lockQuoteRow(tx, q.id);
      await lockProject(tx, input.projectId);
      const pointerBefore = (await tx.project.findFirst({ where: { id: input.projectId, orgId: input.orgId }, select: { bidQuoteId: true } }))?.bidQuoteId ?? null;
      const fresh = await loadQuoteTx(tx, q.id, input.projectId);
      assertUnchanged(fresh, from, input.request.baseUpdatedAt, QUOTE_CONFIRM_ERRORS_ZH.changed);
      assertStepsAllowed(fresh, from, steps, "定为我方报价");
      const computed = computeForQuote(fresh);
      if (!computed.calc.ok) throw new QuoteEngineError("QUOTE_INVALID", QUOTE_CONFIRM_ERRORS_ZH.invalid, 409, computed.calc.errors);
      if (Math.abs(computed.calc.sellingPrice - input.request.expectedSellingPrice) > 0.005) throw new QuoteEngineError("QUOTE_CHANGED", QUOTE_CONFIRM_ERRORS_ZH.changed, 409);
      await assertNotAwardedOther(tx, input.projectId, input.orgId, q.id);

      let cur = from;
      for (const to of steps) {
        await applyQuoteTransitionTx(tx, { q: fresh, from: cur, to, now, userId: input.userId, orgId: input.orgId, projectId: input.projectId });
        cur = to;
      }
      // 批准后照旧同步指针（项目行在这里加锁）；只做选定时同样先同步，指针与镜像以同一套规则为准
      const sync = await (input.deps?.bidSync ?? syncTenderBidPointerTx)(tx, { projectId: input.projectId, orgId: input.orgId, userId: input.userId });
      const project = await tx.project.findFirst({ where: { id: input.projectId, orgId: input.orgId }, select: { bidQuoteId: true } });
      if (!project) throw new QuoteEngineError("PROJECT_NOT_FOUND", "项目不存在", 404);
      if (project.bidQuoteId === q.id) {
        // 同步自动选中了这一份：选定审计由同步写；跟随新版落到这一份：同步写一条跟随审计，再补一条选定审计（不再写镜像）
        if (sync.action === "auto_selected" && sync.quoteId === q.id) return { sync, auditSync: true, select: null, reselectedFrom: null, already: false };
        // 读取之后、加锁之前别人已把它选为我方报价：不再写
        if (sync.action === "refreshed" && sync.previousQuoteId === q.id) return { sync, auditSync: false, select: null, reselectedFrom: null, already: true };
        const price = sellingPriceOf(await loadQuoteTx(tx, q.id, input.projectId));
        return { sync, auditSync: true, select: { before: pointerBefore, sellingPrice: price, currency: fresh.currency, roomMirrored: sync.roomMirrored, wroteMirrors: false }, reselectedFrom: null, already: false };
      }
      // 同步后指针不是这一份 → 改选（已中标的我方报价不改选，整笔回滚）
      await assertNotAwardedOther(tx, input.projectId, input.orgId, q.id);
      // 改选：选定审计的「之前」写同步前的指针；同步的中间结果（清空 / 跟随到别的报价 / 刷新旧的）随即被覆盖，不另写审计（design D4）
      const prevId = pointerBefore;
      const prev = prevId ? await tx.projectQuote.findFirst({ where: { id: prevId, projectId: input.projectId }, select: { id: true, version: true } }) : null;
      const approvedNow = await loadQuoteTx(tx, q.id, input.projectId);
      const sellingPrice = sellingPriceOf(approvedNow);
      let roomMirrored: boolean;
      try {
        ({ roomMirrored } = await mirror(tx, { projectId: input.projectId, quoteId: q.id, version: approvedNow.version, sellingPrice, currency: approvedNow.currency }));
      } catch (e) {
        throw new TenderBidSyncError(e instanceof Error ? e.message : String(e), e);
      }
      return { sync, auditSync: false, select: { before: prevId, sellingPrice, currency: approvedNow.currency, roomMirrored, wroteMirrors: true }, reselectedFrom: prev ? { id: prev.id, version: prev.version } : null, already: false };
    }, { timeout: TX_TIMEOUT_MS });
  } catch (e) {
    if (e instanceof TenderBidSyncError) {
      await auditSyncFailure({ projectId: input.projectId, orgId: input.orgId, userId: input.userId, trigger: SYNC_TRIGGER, quoteId: q.id, error: e });
      throw new QuoteEngineError("TENDER_BID_SYNC_FAILED", QUOTE_CONFIRM_ERRORS_ZH.syncFailed, 500);
    }
    throw e;
  }

  await writeStepAudits({ projectId: input.projectId, orgId: input.orgId, userId: input.userId, quoteId: q.id, version: q.version, from, steps });
  if (outcome.auditSync) await auditSyncResult({ projectId: input.projectId, orgId: input.orgId, userId: input.userId, trigger: SYNC_TRIGGER, result: outcome.sync });
  if (outcome.select) {
    const s = outcome.select;
    await logAudit({
      userId: input.userId, orgId: input.orgId, projectId: input.projectId,
      action: TENDER_BID_AUDIT_ACTIONS.QUOTE_SELECTED_AS_TENDER_BID, targetType: QUOTE_AUDIT_TARGET, targetId: q.id,
      beforeData: { bidQuoteId: s.before },
      afterData: { bidQuoteId: q.id, version: q.version, status: "approved", sellingPrice: s.sellingPrice, currency: s.currency, roomMirrored: s.roomMirrored, auto: false, reason: SELECT_REASON_ZH, via: BID_PAGE_VIA },
    }).catch(() => undefined);
  }
  return { id: q.id, status: "approved", version: q.version, isOurBid: true, reselectedFrom: outcome.reselectedFrom, alreadyOurBid: outcome.already };
}

/** 现在的我方报价是另一份、并且已中标 → 409（design D4） */
async function assertNotAwardedOther(tx: Tx, projectId: string, orgId: string, quoteId: string): Promise<void> {
  const p = await tx.project.findFirst({ where: { id: projectId, orgId }, select: { bidQuoteId: true } });
  if (!p?.bidQuoteId || p.bidQuoteId === quoteId) return;
  const cur = await tx.projectQuote.findFirst({ where: { id: p.bidQuoteId, projectId }, select: { status: true, version: true } });
  if (cur?.status === "awarded") throw new QuoteEngineError("OUR_BID_AWARDED", awardedOtherZh(cur.version), 409);
}

/* ---------------------------------- 提交给负责人 ---------------------------------- */

export type SubmitDeps = { notify?: CollabDeliverDeps };

export async function submitForReview(input: { projectId: string; orgId: string; userId: string; quoteId: string; request: SubmitRequest; deps?: SubmitDeps }): Promise<SubmitResult> {
  const q = await loadBidQuote(input.quoteId, input.projectId, input.orgId);
  if (q.status !== "draft") throw new QuoteEngineError("INVALID_TRANSITION", cannotFromStatusZh(q.status, "提交"), 409);
  if (!sameInstant(q.updatedAt, input.request.baseUpdatedAt)) throw new QuoteEngineError("QUOTE_CHANGED", QUOTE_CONFIRM_ERRORS_ZH.changedSubmit, 409);
  assertStepsAllowed(q, "draft", ["review"], "提交");
  const now = new Date();
  await db.$transaction(async (tx) => {
    await lockQuoteRow(tx, q.id);
    const fresh = await loadQuoteTx(tx, q.id, input.projectId);
    assertUnchanged(fresh, "draft", input.request.baseUpdatedAt, QUOTE_CONFIRM_ERRORS_ZH.changedSubmit);
    assertStepsAllowed(fresh, "draft", ["review"], "提交");
    await applyQuoteTransitionTx(tx, { q: fresh, from: "draft", to: "review", now, userId: input.userId, orgId: input.orgId, projectId: input.projectId });
  }, { timeout: TX_TIMEOUT_MS });
  await writeStepAudits({ projectId: input.projectId, orgId: input.orgId, userId: input.userId, quoteId: q.id, version: q.version, from: "draft", steps: ["review"] });
  const notify = await notifyOwner({ projectId: input.projectId, orgId: input.orgId, userId: input.userId, quote: q, submittedAt: now, deps: input.deps?.notify });
  return { id: q.id, status: "review", version: q.version, notify, messageZh: notifyOutcomeZh(notify) };
}

/** 给项目负责人的站内通知（design D7）：只发负责人，过在职成员与通知设置，按这次提交时间去重；不抛错 */
export async function notifyOwner(input: { projectId: string; orgId: string; userId: string; quote: Pick<QuoteRecord, "id" | "name" | "quoteNumber" | "quoteType" | "version">; submittedAt: Date; deps?: CollabDeliverDeps }): Promise<NotifyOutcome> {
  try {
    const project = await db.project.findFirst({ where: { id: input.projectId, orgId: input.orgId }, select: { name: true, ownerId: true } });
    if (!project) return { kind: "failed" };
    if (project.ownerId === input.userId) return { kind: "self" };
    const users = await db.user.findMany({ where: { id: { in: [project.ownerId, input.userId] } }, select: { id: true, name: true } });
    const nameOf = (id: string) => users.find((u) => u.id === id)?.name?.trim() || "一位同事";
    const { title, summary } = reviewNotificationZh({ projectName: project.name, submitterName: nameOf(input.userId), quoteName: quoteDisplayName(input.quote), version: input.quote.version });
    // 负责人不是在职账号、或不是这个组织的在职成员（导入用的系统账号、离开组织的人）：没有人收到。
    // 自己先查一次（投递入口查收件人出错时也返回空，那种情况要报「没发出去」，不能说成「不是在职成员」）
    const member = await db.organizationMember.findFirst({ where: { orgId: input.orgId, userId: project.ownerId, status: "active", user: { status: "active" } }, select: { userId: true } });
    if (!member) return { kind: "no_recipient" };
    const res = await deliverCollabNotification(
      {
        type: "project_update",
        priority: "high",
        title,
        summary,
        entityType: "bid_quote",
        entityId: input.quote.id,
        eventKey: input.submittedAt.toISOString(),
        orgId: input.orgId,
        projectId: input.projectId,
        actorId: input.userId,
        recipientIds: [project.ownerId],
      },
      input.deps ?? defaultCollabDeliverDeps,
    );
    if (res.created.length > 0 || res.existing.length > 0) return { kind: "notified", ownerName: nameOf(project.ownerId) };
    if (res.gated.length > 0) return { kind: "gated" };
    return { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}

/* ---------------------------------- 退回 ---------------------------------- */

export async function returnToDraft(input: { projectId: string; orgId: string; userId: string; quoteId: string; request: ReturnRequest }): Promise<ReturnResult> {
  const q = await loadBidQuote(input.quoteId, input.projectId, input.orgId);
  if (q.status !== "review") throw new QuoteEngineError("INVALID_TRANSITION", cannotFromStatusZh(q.status, "退回"), 409);
  if (!sameInstant(q.updatedAt, input.request.baseUpdatedAt)) throw new QuoteEngineError("QUOTE_CHANGED", QUOTE_CONFIRM_ERRORS_ZH.changedReturn, 409);
  const note = cleanNoteText(input.request.note, RETURN_NOTE_MAX);
  const now = new Date();
  await db.$transaction(async (tx) => {
    await lockQuoteRow(tx, q.id);
    const fresh = await loadQuoteTx(tx, q.id, input.projectId);
    assertUnchanged(fresh, "review", input.request.baseUpdatedAt, QUOTE_CONFIRM_ERRORS_ZH.changedReturn);
    assertStepsAllowed(fresh, "review", ["draft"], "退回");
    await applyQuoteTransitionTx(tx, { q: fresh, from: "review", to: "draft", now, userId: input.userId, orgId: input.orgId, projectId: input.projectId });
  }, { timeout: TX_TIMEOUT_MS });
  await writeStepAudits({ projectId: input.projectId, orgId: input.orgId, userId: input.userId, quoteId: q.id, version: q.version, from: "review", steps: ["draft"], note });
  return { id: q.id, status: "draft", version: q.version };
}

/* ---------------------------------- 另起新版 ---------------------------------- */

export async function reviseFromBidPage(input: { projectId: string; orgId: string; userId: string; quoteId: string; request: ReviseRequest }): Promise<ReviseResult> {
  const q = await loadBidQuote(input.quoteId, input.projectId, input.orgId);
  if (q.status !== "approved") throw new QuoteEngineError("INVALID_TRANSITION", cannotFromStatusZh(q.status, "另起新版"), 409);
  const reason = cleanNoteText(input.request.reason, REVISE_REASON_MAX);
  if (!reason) throw new QuoteEngineError("REASON_REQUIRED", QUOTE_CONFIRM_ERRORS_ZH.reasonRequired, 400);
  const nq = await reviseQuote({ quoteId: q.id, projectId: input.projectId, userId: input.userId, orgId: input.orgId, reason });
  return { id: nq.id, version: nq.version, entryMode: isLineModeQuote(nq) ? "LINE" : isLumpSumQuote(nq) ? "LUMP_SUM" : null, proModeHref: proModeHrefOf(input.projectId, nq.id) };
}

/* ---------------------------------- 我方报价一行 ---------------------------------- */

/** 我方报价一行要的数（design D8）：谁、何时定的取最近一次选定 / 跟随新版的审计，没有就用批准人与批准时间 */
export async function buildOurBidLine(projectId: string, bid: TenderBidResolution): Promise<OurBidLine> {
  if (bid.status === "AUTHORITATIVE" && bid.quote) {
    const q = bid.quote;
    const [audit, row] = await Promise.all([
      db.auditLog.findFirst({
        where: { projectId, targetId: q.id, action: { in: [TENDER_BID_AUDIT_ACTIONS.QUOTE_SELECTED_AS_TENDER_BID, TENDER_BID_AUDIT_ACTIONS.TENDER_BID_POINTER_SYNCED] } },
        orderBy: { createdAt: "desc" },
        select: { userId: true, createdAt: true },
      }),
      db.projectQuote.findFirst({ where: { id: q.id, projectId }, select: { approvedById: true, approvedAt: true, engineJson: true, quoteType: true } }),
    ]);
    const whoId = audit?.userId ?? row?.approvedById ?? null;
    const when = audit?.createdAt ?? row?.approvedAt ?? null;
    const who = whoId ? await db.user.findUnique({ where: { id: whoId }, select: { name: true } }) : null;
    return {
      status: "AUTHORITATIVE",
      quoteId: q.id,
      version: q.version,
      quoteStatus: q.status,
      sellingPrice: q.sellingPrice,
      currency: q.currency,
      decidedBy: who?.name?.trim() || null,
      decidedAt: when ? when.toISOString() : null,
      entryMode: row ? (isLineModeQuote(row) ? "LINE" : isLumpSumQuote(row) ? "LUMP_SUM" : null) : null,
    };
  }
  if (bid.status === "QUOTE_REVISION_PENDING" && bid.quote) {
    return { status: "QUOTE_REVISION_PENDING", quoteId: bid.quote.id, version: bid.quote.version, pending: bid.pendingRevision };
  }
  return { status: "NONE", approvedCount: bid.candidates.length };
}
