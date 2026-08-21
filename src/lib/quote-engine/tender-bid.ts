/**
 * Tender "Our Bid" · 单一报价事实源（Quote Operations Phase 2 P0-C）
 *  - Approved（或已 awarded）的引擎报价 = Tender 我方报价的权威来源；draft / review 永不成为正式 Our Bid。
 *  - 多报价（Supply+Install / Alternate / Standing Offer…）→ 显式「选为我方报价」指针 Project.bidQuoteId；
 *    首个 approved 且无指针时自动选中（审计标注 auto）。
 *  - Sync 规则：被选报价 superseded → 自动跟随同谱系最新 approved/awarded 版本；没有 → QUOTE_REVISION_PENDING（绝不静默保留旧数）。
 *  - 写穿：Project.ourBidPrice / currency（既有复盘/基准/价差读模型继续可用，但权威在报价），BidIntelligenceRoom.pricingInputs.ourPriceCad（投标草稿消费）。
 *  - 不自动提交任何外部门户。
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { computeForQuote, getQuote, QuoteEngineError, QUOTE_AUDIT_TARGET, type QuoteRecord } from "./service";

export const TENDER_BID_AUDIT_ACTIONS = {
  QUOTE_SELECTED_AS_TENDER_BID: "quote_selected_as_tender_bid",
  TENDER_BID_POINTER_SYNCED: "tender_bid_pointer_synced",
  TENDER_BID_CLEARED: "tender_bid_cleared",
} as const;

export type TenderBidStatus = "AUTHORITATIVE" | "QUOTE_REVISION_PENDING" | "NONE";
export type TenderBidQuoteSummary = {
  id: string; quoteNumber: string | null; name: string | null; quoteType: string; status: string; version: number; currency: string;
  sellingPrice: number | null;
  /** 内部数字（仅 canViewInternal 才返回） */
  estimatedCost: number | null; grossProfit: number | null; grossMarginPct: number | null; markupPct: number | null; pricingMethod: string; pricingRate: number | null;
  approvedAt: Date | null; awardedAt: Date | null;
};
export type TenderBidResolution = {
  status: TenderBidStatus;
  selectedQuoteId: string | null;
  /** 权威报价（AUTHORITATIVE 时）；REVISION_PENDING 时为被 superseded 的那份（仅供展示「旧版」） */
  quote: TenderBidQuoteSummary | null;
  followedRevision: boolean;
  /** REVISION_PENDING：谱系中最新未批准版本 */
  pendingRevision: { id: string; version: number; status: string } | null;
  candidates: Array<{ id: string; quoteNumber: string | null; name: string | null; version: number; status: string; sellingPrice: number | null; currency: string }>;
  reason: string;
};

const BID_ELIGIBLE = ["approved", "awarded"] as const;
function isBidEligible(status: string): boolean {
  return (BID_ELIGIBLE as readonly string[]).includes(status);
}

function summarize(q: QuoteRecord, internal: boolean): TenderBidQuoteSummary {
  const computed = computeForQuote(q);
  const calc = computed.calc.ok ? computed.calc : null;
  const snap = (q.summaryJson as { sellingPrice?: number; estimatedCost?: number; grossProfit?: number; grossMarginPct?: number; markupPct?: number } | null) ?? null;
  const sellingPrice = calc?.sellingPrice ?? snap?.sellingPrice ?? null;
  return {
    id: q.id, quoteNumber: q.quoteNumber, name: q.name ?? q.title, quoteType: q.quoteType, status: q.status, version: q.version, currency: q.currency, sellingPrice,
    estimatedCost: internal ? (calc?.estimatedCost ?? snap?.estimatedCost ?? null) : null,
    grossProfit: internal ? (calc?.grossProfit ?? snap?.grossProfit ?? null) : null,
    grossMarginPct: internal ? (calc?.grossMarginPct ?? snap?.grossMarginPct ?? null) : null,
    markupPct: internal ? (calc?.markupPct ?? snap?.markupPct ?? null) : null,
    pricingMethod: q.pricingMethod, pricingRate: internal && q.pricingRate != null ? Number(q.pricingRate) : null,
    approvedAt: q.approvedAt, awardedAt: q.awardedAt,
  };
}

async function lineageRootOf(quoteId: string, projectId: string): Promise<string> {
  let cur = quoteId;
  for (let i = 0; i < 100; i++) {
    const row = await db.projectQuote.findFirst({ where: { id: cur, projectId }, select: { sourceQuoteId: true } });
    if (!row?.sourceQuoteId) return cur;
    cur = row.sourceQuoteId;
  }
  return cur;
}
async function lineageIdsOf(rootId: string, projectId: string): Promise<string[]> {
  const ids = [rootId];
  let frontier = [rootId];
  for (let i = 0; i < 100 && frontier.length > 0; i++) {
    const rows = await db.projectQuote.findMany({ where: { projectId, sourceQuoteId: { in: frontier } }, select: { id: true } });
    frontier = rows.map((r) => r.id).filter((id) => !ids.includes(id));
    ids.push(...frontier);
  }
  return ids;
}

/** 同谱系最新 approved/awarded 版本（按 version 降序） */
async function latestEligibleInLineage(quoteId: string, projectId: string): Promise<QuoteRecord | null> {
  const root = await lineageRootOf(quoteId, projectId);
  const ids = await lineageIdsOf(root, projectId);
  const row = await db.projectQuote.findFirst({ where: { id: { in: ids }, projectId, status: { in: [...BID_ELIGIBLE] } }, orderBy: { version: "desc" }, select: { id: true } });
  return row ? getQuote(row.id, projectId) : null;
}

async function writeThrough(projectId: string, q: QuoteRecord): Promise<void> {
  const computed = computeForQuote(q);
  const selling = computed.calc.ok ? computed.calc.sellingPrice : ((q.summaryJson as { sellingPrice?: number } | null)?.sellingPrice ?? null);
  if (selling == null) return;
  await db.project.update({ where: { id: projectId }, data: { ourBidPrice: selling, currency: q.currency } }).catch(() => undefined);
  // 投标草稿 pricingInputs.ourPriceCad（CAD 报价才写；best-effort）
  if (q.currency === "CAD") {
    const room = await db.bidIntelligenceRoom.findFirst({ where: { projectId }, select: { id: true, summaryJson: true } }).catch(() => null);
    if (room) {
      const sj = ((room.summaryJson as Record<string, unknown>) ?? {}) as Record<string, unknown>;
      const pi = ((sj.pricingInputs as Record<string, unknown>) ?? {}) as Record<string, unknown>;
      await db.bidIntelligenceRoom.update({ where: { id: room.id }, data: { summaryJson: JSON.parse(JSON.stringify({ ...sj, pricingInputs: { ...pi, ourPriceCad: selling, ourPriceSource: `quote:${q.id}:v${q.version}` } })) as Prisma.InputJsonValue } }).catch(() => undefined);
    }
  }
}

export async function selectQuoteAsTenderBid(input: { projectId: string; quoteId: string; orgId: string; userId: string; reason?: string | null; auto?: boolean }): Promise<TenderBidResolution> {
  const q = await getQuote(input.quoteId, input.projectId);
  if (q.orgId !== input.orgId) throw new QuoteEngineError("QUOTE_NOT_FOUND", "报价不存在", 404);
  if (!isBidEligible(q.status)) throw new QuoteEngineError("NOT_APPROVED", `只有 approved/awarded 的报价可以成为我方报价（当前 ${q.status}）`, 409);
  const before = await db.project.findUnique({ where: { id: input.projectId }, select: { bidQuoteId: true, ourBidPrice: true } });
  await db.project.update({ where: { id: input.projectId }, data: { bidQuoteId: q.id } });
  await writeThrough(input.projectId, q);
  await logAudit({ userId: input.userId, orgId: input.orgId, projectId: input.projectId, action: TENDER_BID_AUDIT_ACTIONS.QUOTE_SELECTED_AS_TENDER_BID, targetType: QUOTE_AUDIT_TARGET, targetId: q.id, beforeData: { bidQuoteId: before?.bidQuoteId ?? null, ourBidPrice: before?.ourBidPrice ?? null }, afterData: { bidQuoteId: q.id, version: q.version, status: q.status, auto: input.auto === true, reason: input.reason ?? null } }).catch(() => undefined);
  return resolveTenderBid({ projectId: input.projectId, orgId: input.orgId, internal: true });
}

/**
 * 报价状态变化后的指针同步（approve / supersede / award / cancel / revise 后调用；best-effort，绝不阻塞主流程）：
 *  - 无指针且恰有一份 approved/awarded → 自动选中
 *  - 指针指向 superseded/cancelled → 跟随同谱系最新 approved/awarded；没有则保持（解析时显示 QUOTE_REVISION_PENDING）
 *  - 指针指向 approved/awarded → 刷新写穿值（修订重批后价格变化）
 */
export async function syncTenderBidPointer(input: { projectId: string; orgId: string; userId: string }): Promise<void> {
  try {
    const project = await db.project.findUnique({ where: { id: input.projectId }, select: { bidQuoteId: true } });
    if (!project) return;
    if (!project.bidQuoteId) {
      const eligible = await db.projectQuote.findMany({ where: { projectId: input.projectId, orgId: input.orgId, quoteType: { not: "CUSTOM" }, status: { in: [...BID_ELIGIBLE] } }, select: { id: true } });
      if (eligible.length === 1) await selectQuoteAsTenderBid({ projectId: input.projectId, quoteId: eligible[0]!.id, orgId: input.orgId, userId: input.userId, auto: true, reason: "first approved quote" });
      return;
    }
    const sel = await db.projectQuote.findFirst({ where: { id: project.bidQuoteId, projectId: input.projectId }, select: { id: true, status: true } });
    if (!sel) return;
    if (isBidEligible(sel.status)) {
      await writeThrough(input.projectId, await getQuote(sel.id, input.projectId));
      return;
    }
    const next = await latestEligibleInLineage(sel.id, input.projectId);
    if (next && next.id !== sel.id) {
      await db.project.update({ where: { id: input.projectId }, data: { bidQuoteId: next.id } });
      await writeThrough(input.projectId, next);
      await logAudit({ userId: input.userId, orgId: input.orgId, projectId: input.projectId, action: TENDER_BID_AUDIT_ACTIONS.TENDER_BID_POINTER_SYNCED, targetType: QUOTE_AUDIT_TARGET, targetId: next.id, beforeData: { bidQuoteId: sel.id, status: sel.status }, afterData: { bidQuoteId: next.id, version: next.version, status: next.status } }).catch(() => undefined);
    }
  } catch {
    /* best-effort */
  }
}

export async function resolveTenderBid(input: { projectId: string; orgId: string; internal: boolean }): Promise<TenderBidResolution> {
  const project = await db.project.findFirst({ where: { id: input.projectId, orgId: input.orgId }, select: { bidQuoteId: true } });
  if (!project) throw new QuoteEngineError("PROJECT_NOT_FOUND", "项目不存在", 404);
  const candidateRows = await db.projectQuote.findMany({ where: { projectId: input.projectId, orgId: input.orgId, quoteType: { not: "CUSTOM" }, status: { in: [...BID_ELIGIBLE] } }, orderBy: [{ approvedAt: "desc" }], select: { id: true, quoteNumber: true, name: true, title: true, version: true, status: true, currency: true, summaryJson: true } });
  const candidates = candidateRows.map((r) => ({ id: r.id, quoteNumber: r.quoteNumber, name: r.name ?? r.title, version: r.version, status: r.status, sellingPrice: (r.summaryJson as { sellingPrice?: number } | null)?.sellingPrice ?? null, currency: r.currency }));
  if (!project.bidQuoteId) {
    return { status: "NONE", selectedQuoteId: null, quote: null, followedRevision: false, pendingRevision: null, candidates, reason: candidates.length > 0 ? "尚未选择我方报价（有已批准报价可选）" : "尚无已批准的报价" };
  }
  const sel = await db.projectQuote.findFirst({ where: { id: project.bidQuoteId, projectId: input.projectId }, select: { id: true } });
  if (!sel) return { status: "NONE", selectedQuoteId: project.bidQuoteId, quote: null, followedRevision: false, pendingRevision: null, candidates, reason: "所选报价已不存在" };
  const selected = await getQuote(sel.id, input.projectId);
  if (isBidEligible(selected.status)) {
    return { status: "AUTHORITATIVE", selectedQuoteId: selected.id, quote: summarize(selected, input.internal), followedRevision: false, pendingRevision: null, candidates, reason: `Approved Quote V${selected.version}` };
  }
  if (selected.status === "cancelled") {
    return { status: "NONE", selectedQuoteId: selected.id, quote: null, followedRevision: false, pendingRevision: null, candidates, reason: "所选报价已取消，请重新选择" };
  }
  // superseded：跟随同谱系最新 approved/awarded
  const next = await latestEligibleInLineage(selected.id, input.projectId);
  if (next) {
    return { status: "AUTHORITATIVE", selectedQuoteId: selected.id, quote: summarize(next, input.internal), followedRevision: true, pendingRevision: null, candidates, reason: `已跟随修订版本 Approved Quote V${next.version}` };
  }
  const root = await lineageRootOf(selected.id, input.projectId);
  const ids = await lineageIdsOf(root, input.projectId);
  const pending = await db.projectQuote.findFirst({ where: { id: { in: ids }, projectId: input.projectId, status: { in: ["draft", "review"] } }, orderBy: { version: "desc" }, select: { id: true, version: true, status: true } });
  return { status: "QUOTE_REVISION_PENDING", selectedQuoteId: selected.id, quote: summarize(selected, input.internal), followedRevision: false, pendingRevision: pending, candidates, reason: `我方报价 V${selected.version} 已被修订，新版本尚未批准` };
}
