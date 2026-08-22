/**
 * Tender "Our Bid" · 单一报价事实源（Quote Operations Phase 2 P0-C；Final Review B2 修复）
 *  - Approved/awarded 引擎报价 = Tender 我方报价的权威来源；draft / review 永不成为 Our Bid。
 *  - 显式指针 Project.bidQuoteId；首个 approved 且无指针时自动选中；被选报价 superseded → 跟随同谱系最新 approved/awarded，
 *    没有 → QUOTE_REVISION_PENDING（绝不静默保留旧数）。
 *  - **不变量（B2）**：bidQuoteId + ourBidPrice + currency + BidIntelligenceRoom.pricingInputs 在**同一事务**写入（项目行 FOR UPDATE 串行化）；
 *    任何镜像写失败 → 整个事务回滚并抛错（绝不 swallow）；状态迁移（approve/revise/supersede/award/cancel）在调用方事务内同步指针，
 *    同步失败 = 迁移回滚 + `tender_bid_sync_failed` 审计 + TENDER_BID_SYNC_FAILED。
 *  - **非权威态不得宣称有效报价（B2-CANCEL）**：被选报价 cancelled 且无可替代版本 → 同事务 clearBidMirrorsTx（bidQuoteId/ourBidPrice = null，
 *    currency 不动，房间 ourPrice* 全清）；superseded 待批（QUOTE_REVISION_PENDING）→ bidQuoteId 保留为可追溯的 superseded 来源，
 *    但 ourBidPrice 与房间 ourPrice* 全清并标 ourPriceStatus=QUOTE_REVISION_PENDING（legacy 读者不可能把旧价当成当前 Our Bid）。
 *  - resolveTenderBid 报告 mirrorStale：AUTHORITATIVE 时 = 镜像价≠权威价；非权威态 = 仍有价格在宣传（绝不假装已同步）。
 *  - 不自动提交任何外部门户。
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { computeForQuote, QuoteEngineError, QUOTE_AUDIT_TARGET, type QuoteRecord } from "./service";

export const TENDER_BID_AUDIT_ACTIONS = {
  QUOTE_SELECTED_AS_TENDER_BID: "quote_selected_as_tender_bid",
  TENDER_BID_POINTER_SYNCED: "tender_bid_pointer_synced",
  TENDER_BID_MIRRORS_CLEARED: "tender_bid_mirrors_cleared",
  TENDER_BID_SYNC_FAILED: "tender_bid_sync_failed",
} as const;

type Tx = Prisma.TransactionClient;
const BID_ELIGIBLE = ["approved", "awarded"] as const;
const isBidEligible = (status: string): boolean => (BID_ELIGIBLE as readonly string[]).includes(status);

/** 指针/镜像同步失败（调用方回滚迁移并审计） */
export class TenderBidSyncError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "TenderBidSyncError";
  }
}

export type MirrorArgs = { projectId: string; quoteId: string; version: number; sellingPrice: number; currency: string };
export type TenderBidDeps = { mirror?: (tx: Tx, args: MirrorArgs) => Promise<{ roomMirrored: boolean }> };

export type TenderBidStatus = "AUTHORITATIVE" | "QUOTE_REVISION_PENDING" | "NONE";
export type TenderBidQuoteSummary = {
  id: string; quoteNumber: string | null; name: string | null; quoteType: string; status: string; version: number; currency: string;
  sellingPrice: number | null;
  estimatedCost: number | null; grossProfit: number | null; grossMarginPct: number | null; markupPct: number | null; pricingMethod: string; pricingRate: number | null;
  approvedAt: Date | null; awardedAt: Date | null;
};
export type TenderBidResolution = {
  status: TenderBidStatus;
  selectedQuoteId: string | null;
  quote: TenderBidQuoteSummary | null;
  followedRevision: boolean;
  pendingRevision: { id: string; version: number; status: string } | null;
  candidates: Array<{ id: string; quoteNumber: string | null; name: string | null; version: number; status: string; sellingPrice: number | null; currency: string }>;
  /** 兼容镜像（Project.ourBidPrice/currency）与权威报价不一致 → 显式暴露（不假装已同步） */
  mirrorStale: boolean;
  mirror: { ourBidPrice: number | null; currency: string | null };
  reason: string;
};

const QUOTE_INCLUDE = { costLines: { orderBy: { sortOrder: "asc" as const } }, pricingTiers: { orderBy: { sortOrder: "asc" as const } }, lineItems: { orderBy: { sortOrder: "asc" as const } } };

async function loadQuoteTx(tx: Tx, quoteId: string, projectId: string): Promise<QuoteRecord> {
  const q = await tx.projectQuote.findFirst({ where: { id: quoteId, projectId }, include: QUOTE_INCLUDE });
  if (!q) throw new QuoteEngineError("QUOTE_NOT_FOUND", "报价不存在", 404);
  return q;
}

/** 权威售价：计算无效的报价不能成为我方报价（fail-closed，不用快照猜） */
export function sellingPriceOf(q: QuoteRecord): number {
  const computed = computeForQuote(q);
  if (!computed.calc.ok) throw new QuoteEngineError("QUOTE_INVALID", "报价计算无效，不能作为我方报价", 409, computed.calc.errors);
  return computed.calc.sellingPrice;
}

function summarize(q: QuoteRecord, internal: boolean): TenderBidQuoteSummary {
  const computed = computeForQuote(q);
  const calc = computed.calc.ok ? computed.calc : null;
  const snap = (q.summaryJson as { sellingPrice?: number; estimatedCost?: number; grossProfit?: number; grossMarginPct?: number; markupPct?: number } | null) ?? null;
  return {
    id: q.id, quoteNumber: q.quoteNumber, name: q.name ?? q.title, quoteType: q.quoteType, status: q.status, version: q.version, currency: q.currency,
    sellingPrice: calc?.sellingPrice ?? snap?.sellingPrice ?? null,
    estimatedCost: internal ? (calc?.estimatedCost ?? snap?.estimatedCost ?? null) : null,
    grossProfit: internal ? (calc?.grossProfit ?? snap?.grossProfit ?? null) : null,
    grossMarginPct: internal ? (calc?.grossMarginPct ?? snap?.grossMarginPct ?? null) : null,
    markupPct: internal ? (calc?.markupPct ?? snap?.markupPct ?? null) : null,
    pricingMethod: q.pricingMethod, pricingRate: internal && q.pricingRate != null ? Number(q.pricingRate) : null,
    approvedAt: q.approvedAt, awardedAt: q.awardedAt,
  };
}

async function lineageRootOf(client: Tx | typeof db, quoteId: string, projectId: string): Promise<string> {
  let cur = quoteId;
  for (let i = 0; i < 100; i++) {
    const row = await client.projectQuote.findFirst({ where: { id: cur, projectId }, select: { sourceQuoteId: true } });
    if (!row?.sourceQuoteId) return cur;
    cur = row.sourceQuoteId;
  }
  return cur;
}
async function lineageIdsOf(client: Tx | typeof db, rootId: string, projectId: string): Promise<string[]> {
  const ids = [rootId];
  let frontier = [rootId];
  for (let i = 0; i < 100 && frontier.length > 0; i++) {
    const rows = await client.projectQuote.findMany({ where: { projectId, sourceQuoteId: { in: frontier } }, select: { id: true } });
    frontier = rows.map((r) => r.id).filter((id) => !ids.includes(id));
    ids.push(...frontier);
  }
  return ids;
}
/** 同谱系最新 approved/awarded 版本 id（按 version 降序） */
async function latestEligibleInLineage(client: Tx | typeof db, quoteId: string, projectId: string): Promise<string | null> {
  const root = await lineageRootOf(client, quoteId, projectId);
  const ids = await lineageIdsOf(client, root, projectId);
  const row = await client.projectQuote.findFirst({ where: { id: { in: ids }, projectId, status: { in: [...BID_ELIGIBLE] } }, orderBy: { version: "desc" }, select: { id: true } });
  return row?.id ?? null;
}

async function lockProject(tx: Tx, projectId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
}

/**
 * 镜像写穿（同事务）：Project.bidQuoteId + ourBidPrice + currency（单条 UPDATE = 原子）
 * + BidIntelligenceRoom.pricingInputs（存在房间时同事务更新；非 CAD 报价写 ourPriceCad=null 并标明币种，绝不伪装成 CAD）。
 * 任何失败直接抛错 → 调用方事务回滚。
 */
export async function writeBidMirrorsTx(tx: Tx, args: MirrorArgs): Promise<{ roomMirrored: boolean }> {
  await tx.project.update({ where: { id: args.projectId }, data: { bidQuoteId: args.quoteId, ourBidPrice: args.sellingPrice, currency: args.currency } });
  const room = await tx.bidIntelligenceRoom.findUnique({ where: { projectId: args.projectId }, select: { id: true, summaryJson: true } });
  if (!room) return { roomMirrored: false };
  const sj = ((room.summaryJson as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const pi = ((sj.pricingInputs as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const pricingInputs = { ...pi, ourPriceCad: args.currency === "CAD" ? args.sellingPrice : null, ourPrice: args.sellingPrice, ourPriceCurrency: args.currency, ourPriceSource: `quote:${args.quoteId}:v${args.version}`, ourPriceStatus: "AUTHORITATIVE", ourPriceSupersededSource: undefined };
  await tx.bidIntelligenceRoom.update({ where: { id: room.id }, data: { summaryJson: JSON.parse(JSON.stringify({ ...sj, pricingInputs })) as Prisma.InputJsonValue } });
  return { roomMirrored: true };
}

/** 房间价格镜像清空（保留 competitorPriceCad 等无关键）；存在房间时返回 true */
async function clearRoomPriceMirrorsTx(tx: Tx, projectId: string, status: "NONE" | "QUOTE_REVISION_PENDING", supersededSource: string | null): Promise<boolean> {
  const room = await tx.bidIntelligenceRoom.findUnique({ where: { projectId }, select: { id: true, summaryJson: true } });
  if (!room) return false;
  const sj = ((room.summaryJson as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const pi = ((sj.pricingInputs as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const pricingInputs = { ...pi, ourPriceCad: null, ourPrice: null, ourPriceCurrency: null, ourPriceSource: null, ourPriceStatus: status, ourPriceSupersededSource: supersededSource ?? undefined };
  await tx.bidIntelligenceRoom.update({ where: { id: room.id }, data: { summaryJson: JSON.parse(JSON.stringify({ ...sj, pricingInputs })) as Prisma.InputJsonValue } });
  return true;
}

/**
 * 原子清空（B2-CANCEL）：无权威报价时兼容字段不得宣称有效报价。
 * Project.bidQuoteId / ourBidPrice = null（**currency 不动**：它同时是项目基准币种）；房间 ourPrice* 全清。必须在取消/同步的同一事务内调用。
 */
export async function clearBidMirrorsTx(tx: Tx, args: { projectId: string }): Promise<{ roomMirrored: boolean }> {
  await tx.project.update({ where: { id: args.projectId }, data: { bidQuoteId: null, ourBidPrice: null } });
  const roomMirrored = await clearRoomPriceMirrorsTx(tx, args.projectId, "NONE", null);
  return { roomMirrored };
}

/**
 * 修订待批（QUOTE_REVISION_PENDING）镜像语义：bidQuoteId 保留 = 可追溯的 superseded 来源；
 * 但 ourBidPrice 与房间 ourPrice* 全清 + ourPriceStatus=QUOTE_REVISION_PENDING（旧价绝不被当成当前批准的 Our Bid）。
 */
export async function writePendingMirrorsTx(tx: Tx, args: { projectId: string; supersededQuoteId: string; version: number }): Promise<{ roomMirrored: boolean }> {
  await tx.project.update({ where: { id: args.projectId }, data: { bidQuoteId: args.supersededQuoteId, ourBidPrice: null } });
  const roomMirrored = await clearRoomPriceMirrorsTx(tx, args.projectId, "QUOTE_REVISION_PENDING", `quote:${args.supersededQuoteId}:v${args.version}`);
  return { roomMirrored };
}

export type SyncAction = "none" | "auto_selected" | "followed_revision" | "refreshed" | "cleared" | "pending_cleared";
export type SyncResult = { action: SyncAction; quoteId: string | null; version: number | null; previousQuoteId: string | null; roomMirrored: boolean };

/**
 * 指针同步（**必须在调用方事务内**，项目行 FOR UPDATE 串行化）：
 *  - 无指针且恰有一份 approved/awarded → 自动选中
 *  - 指针指向 approved/awarded → 刷新镜像（重批/award 后价格以当前计算为准）
 *  - 指针指向 superseded/cancelled → 跟随同谱系最新 approved/awarded；没有：
 *      cancelled / 指针悬空 → clearBidMirrorsTx（NONE：指针与全部价格镜像清空）
 *      superseded → writePendingMirrorsTx（QUOTE_REVISION_PENDING：指针保留可追溯，价格镜像清空）
 * 任何失败抛 TenderBidSyncError → 调用方回滚状态迁移并审计；绝不 swallow。
 */
export async function syncTenderBidPointerTx(tx: Tx, input: { projectId: string; orgId: string; userId: string; deps?: TenderBidDeps }): Promise<SyncResult> {
  try {
    await lockProject(tx, input.projectId);
    const project = await tx.project.findFirst({ where: { id: input.projectId, orgId: input.orgId }, select: { bidQuoteId: true } });
    if (!project) throw new QuoteEngineError("PROJECT_NOT_FOUND", "项目不存在", 404);
    const mirror = input.deps?.mirror ?? writeBidMirrorsTx;
    const apply = async (quoteId: string): Promise<{ version: number; roomMirrored: boolean }> => {
      const q = await loadQuoteTx(tx, quoteId, input.projectId);
      const { roomMirrored } = await mirror(tx, { projectId: input.projectId, quoteId: q.id, version: q.version, sellingPrice: sellingPriceOf(q), currency: q.currency });
      return { version: q.version, roomMirrored };
    };
    if (!project.bidQuoteId) {
      const eligible = await tx.projectQuote.findMany({ where: { projectId: input.projectId, orgId: input.orgId, quoteType: { not: "CUSTOM" }, status: { in: [...BID_ELIGIBLE] } }, select: { id: true } });
      if (eligible.length !== 1) return { action: "none", quoteId: null, version: null, previousQuoteId: null, roomMirrored: false };
      const r = await apply(eligible[0]!.id);
      return { action: "auto_selected", quoteId: eligible[0]!.id, version: r.version, previousQuoteId: null, roomMirrored: r.roomMirrored };
    }
    const sel = await tx.projectQuote.findFirst({ where: { id: project.bidQuoteId, projectId: input.projectId }, select: { id: true, status: true, version: true } });
    if (!sel) {
      const r = await clearBidMirrorsTx(tx, { projectId: input.projectId });
      return { action: "cleared", quoteId: null, version: null, previousQuoteId: project.bidQuoteId, roomMirrored: r.roomMirrored };
    }
    if (isBidEligible(sel.status)) {
      const r = await apply(sel.id);
      return { action: "refreshed", quoteId: sel.id, version: r.version, previousQuoteId: sel.id, roomMirrored: r.roomMirrored };
    }
    const next = await latestEligibleInLineage(tx, sel.id, input.projectId);
    if (next && next !== sel.id) {
      const r = await apply(next);
      return { action: "followed_revision", quoteId: next, version: r.version, previousQuoteId: sel.id, roomMirrored: r.roomMirrored };
    }
    if (sel.status === "superseded") {
      const r = await writePendingMirrorsTx(tx, { projectId: input.projectId, supersededQuoteId: sel.id, version: sel.version });
      return { action: "pending_cleared", quoteId: sel.id, version: sel.version, previousQuoteId: sel.id, roomMirrored: r.roomMirrored };
    }
    // cancelled（或其它非权威态）且无可替代版本 → 非权威：兼容字段不得宣称有效报价
    const r = await clearBidMirrorsTx(tx, { projectId: input.projectId });
    return { action: "cleared", quoteId: null, version: null, previousQuoteId: sel.id, roomMirrored: r.roomMirrored };
  } catch (e) {
    throw new TenderBidSyncError(e instanceof Error ? e.message : String(e), e);
  }
}

/** 同步成功后的审计（调用方在事务提交后调用；审计绝不阻塞业务） */
export async function auditSyncResult(input: { projectId: string; orgId: string; userId: string; trigger: string; result: SyncResult }): Promise<void> {
  const { result } = input;
  if (result.action === "none" || result.action === "refreshed") return;
  const action = result.action === "auto_selected" ? TENDER_BID_AUDIT_ACTIONS.QUOTE_SELECTED_AS_TENDER_BID : result.action === "followed_revision" ? TENDER_BID_AUDIT_ACTIONS.TENDER_BID_POINTER_SYNCED : TENDER_BID_AUDIT_ACTIONS.TENDER_BID_MIRRORS_CLEARED;
  await logAudit({
    userId: input.userId, orgId: input.orgId, projectId: input.projectId,
    action,
    targetType: QUOTE_AUDIT_TARGET, targetId: result.quoteId ?? result.previousQuoteId ?? "",
    beforeData: { bidQuoteId: result.previousQuoteId }, afterData: { bidQuoteId: result.quoteId, version: result.version, syncAction: result.action, auto: true, trigger: input.trigger, roomMirrored: result.roomMirrored },
  }).catch(() => undefined);
}

/** 同步失败审计（事务已回滚；可观测、不吞） */
export async function auditSyncFailure(input: { projectId: string; orgId: string; userId: string; trigger: string; quoteId: string; error: unknown }): Promise<void> {
  await logAudit({ userId: input.userId, orgId: input.orgId, projectId: input.projectId, action: TENDER_BID_AUDIT_ACTIONS.TENDER_BID_SYNC_FAILED, targetType: QUOTE_AUDIT_TARGET, targetId: input.quoteId, afterData: { trigger: input.trigger, rolledBack: true, message: input.error instanceof Error ? input.error.message.slice(0, 300) : String(input.error).slice(0, 300) } }).catch(() => undefined);
}

/** 手动选为我方报价：同一事务写指针 + 全部兼容镜像（项目行锁串行化并发选择）；失败整体回滚并抛错 */
export async function selectQuoteAsTenderBid(input: { projectId: string; quoteId: string; orgId: string; userId: string; reason?: string | null; deps?: TenderBidDeps }): Promise<TenderBidResolution> {
  const mirror = input.deps?.mirror ?? writeBidMirrorsTx;
  let before: { bidQuoteId: string | null; ourBidPrice: number | null } | null = null;
  let selected: { version: number; sellingPrice: number; currency: string; status: string; roomMirrored: boolean };
  try {
    selected = await db.$transaction(async (tx) => {
      await lockProject(tx, input.projectId);
      const project = await tx.project.findFirst({ where: { id: input.projectId, orgId: input.orgId }, select: { bidQuoteId: true, ourBidPrice: true } });
      if (!project) throw new QuoteEngineError("PROJECT_NOT_FOUND", "项目不存在", 404);
      before = project;
      const q = await loadQuoteTx(tx, input.quoteId, input.projectId);
      if (q.orgId !== input.orgId) throw new QuoteEngineError("QUOTE_NOT_FOUND", "报价不存在", 404);
      if (!isBidEligible(q.status)) throw new QuoteEngineError("NOT_APPROVED", `只有 approved/awarded 的报价可以成为我方报价（当前 ${q.status}）`, 409);
      const sellingPrice = sellingPriceOf(q);
      const { roomMirrored } = await mirror(tx, { projectId: input.projectId, quoteId: q.id, version: q.version, sellingPrice, currency: q.currency });
      return { version: q.version, sellingPrice, currency: q.currency, status: q.status, roomMirrored };
    });
  } catch (e) {
    if (!(e instanceof QuoteEngineError)) {
      await auditSyncFailure({ projectId: input.projectId, orgId: input.orgId, userId: input.userId, trigger: "manual_select", quoteId: input.quoteId, error: e });
      throw new QuoteEngineError("TENDER_BID_SYNC_FAILED", `选择我方报价失败，已整体回滚（镜像写入失败：${e instanceof Error ? e.message.slice(0, 160) : "unknown"}）`, 500);
    }
    throw e;
  }
  await logAudit({ userId: input.userId, orgId: input.orgId, projectId: input.projectId, action: TENDER_BID_AUDIT_ACTIONS.QUOTE_SELECTED_AS_TENDER_BID, targetType: QUOTE_AUDIT_TARGET, targetId: input.quoteId, beforeData: before ?? undefined, afterData: { bidQuoteId: input.quoteId, version: selected.version, status: selected.status, sellingPrice: selected.sellingPrice, currency: selected.currency, roomMirrored: selected.roomMirrored, auto: false, reason: input.reason ?? null } }).catch(() => undefined);
  return resolveTenderBid({ projectId: input.projectId, orgId: input.orgId, internal: true });
}

export async function resolveTenderBid(input: { projectId: string; orgId: string; internal: boolean }): Promise<TenderBidResolution> {
  const project = await db.project.findFirst({ where: { id: input.projectId, orgId: input.orgId }, select: { bidQuoteId: true, ourBidPrice: true, currency: true } });
  if (!project) throw new QuoteEngineError("PROJECT_NOT_FOUND", "项目不存在", 404);
  const mirror = { ourBidPrice: project.ourBidPrice, currency: project.currency };
  // 引擎已在用（存在任何引擎报价）时，非权威态仍宣传价格 = 镜像过期；纯 legacy 项目（无引擎报价）的手填 ourBidPrice 不在本规则内
  const engineQuoteCount = await db.projectQuote.count({ where: { projectId: input.projectId, orgId: input.orgId, quoteType: { not: "CUSTOM" } } });
  const advertisingWithoutAuthority = engineQuoteCount > 0 && project.ourBidPrice != null;
  const candidateRows = await db.projectQuote.findMany({ where: { projectId: input.projectId, orgId: input.orgId, quoteType: { not: "CUSTOM" }, status: { in: [...BID_ELIGIBLE] } }, orderBy: [{ approvedAt: "desc" }], select: { id: true, quoteNumber: true, name: true, title: true, version: true, status: true, currency: true, summaryJson: true } });
  const candidates = candidateRows.map((r) => ({ id: r.id, quoteNumber: r.quoteNumber, name: r.name ?? r.title, version: r.version, status: r.status, sellingPrice: (r.summaryJson as { sellingPrice?: number } | null)?.sellingPrice ?? null, currency: r.currency }));
  const none = (selectedQuoteId: string | null, reason: string): TenderBidResolution => ({ status: "NONE", selectedQuoteId, quote: null, followedRevision: false, pendingRevision: null, candidates, mirrorStale: advertisingWithoutAuthority, mirror, reason: advertisingWithoutAuthority ? `${reason}（兼容镜像仍有价格，需清理）` : reason });
  if (!project.bidQuoteId) return none(null, candidates.length > 0 ? "尚未选择我方报价（有已批准报价可选）" : "尚无已批准的报价");
  const selected = await db.projectQuote.findFirst({ where: { id: project.bidQuoteId, projectId: input.projectId }, include: QUOTE_INCLUDE });
  if (!selected) return none(project.bidQuoteId, "所选报价已不存在");
  const authoritative = (q: QuoteRecord, followedRevision: boolean, reason: string): TenderBidResolution => {
    const summary = summarize(q, input.internal);
    const stale = summary.sellingPrice != null && (project.ourBidPrice == null || Math.abs(project.ourBidPrice - summary.sellingPrice) > 0.005 || project.currency !== q.currency);
    return { status: "AUTHORITATIVE", selectedQuoteId: project.bidQuoteId, quote: summary, followedRevision, pendingRevision: null, candidates, mirrorStale: stale, mirror, reason: stale ? `${reason}（兼容镜像与权威报价不一致，需重新同步）` : reason };
  };
  if (isBidEligible(selected.status)) return authoritative(selected, false, `Approved Quote V${selected.version}`);
  if (selected.status === "cancelled") return none(selected.id, "所选报价已取消，请重新选择");
  const nextId = await latestEligibleInLineage(db, selected.id, input.projectId);
  if (nextId) {
    const next = await db.projectQuote.findFirst({ where: { id: nextId, projectId: input.projectId }, include: QUOTE_INCLUDE });
    if (next) return authoritative(next, true, `已跟随修订版本 Approved Quote V${next.version}`);
  }
  const root = await lineageRootOf(db, selected.id, input.projectId);
  const ids = await lineageIdsOf(db, root, input.projectId);
  const pending = await db.projectQuote.findFirst({ where: { id: { in: ids }, projectId: input.projectId, status: { in: ["draft", "review"] } }, orderBy: { version: "desc" }, select: { id: true, version: true, status: true } });
  return { status: "QUOTE_REVISION_PENDING", selectedQuoteId: selected.id, quote: summarize(selected, input.internal), followedRevision: false, pendingRevision: pending, candidates, mirrorStale: project.ourBidPrice != null, mirror, reason: `我方报价 V${selected.version} 已被修订，新版本尚未批准${project.ourBidPrice != null ? "（兼容镜像仍有价格，需清理）" : ""}` };
}
