/**
 * Revenue Spine — Daily Revenue Actions（PART 8，Today's Revenue Actions）
 *
 * Today's Revenue Actions：Hot Leads / Need Reply / Quote Follow-up / Sample Follow-up / Stale / Reorder(placeholder) / Approvals
 * 纯查询 + 纯函数分桶；cron 与 API 共用。
 */

import { db } from "@/lib/db";
import { INQUIRY_REPLY_ACTION_TYPE } from "./fde/inbound-sales";
import { isStale } from "./next-action";
import { OPEN_STAGES, PRE_QUOTE_STAGES } from "./opportunity-stage";
import { loadRevenueSpinePolicy, type RevenueSpinePolicy } from "./policy";

export interface QueueOpportunity {
  id: string;
  title: string;
  stage: string;
  customerId: string;
  customerName: string;
  customerEmail: string | null;
  score: number | null;
  scoreGrade: string | null;
  estimatedValue: number | null;
  market: string | null;
  buyerType: string | null;
  assignedToId: string | null;
  createdAt: Date;
  updatedAt: Date;
  stageChangedAt: Date | null;
  lastInteractionAt: Date | null;
  lastCustomerReplyAt: Date | null;
  lastOutboundAt: Date | null;
  nextFollowupAt: Date | null;
  nextActionType: string | null;
  nextActionReason: string | null;
  followUpCount: number;
  fdeInfluenced: boolean;
  fdeSourced: boolean;
}

export interface RevenueQueue {
  generatedAt: string;
  hotLeads: QueueOpportunity[];
  needReply: QueueOpportunity[];
  quoteFollowUp: QueueOpportunity[];
  sampleFollowUp: QueueOpportunity[];
  followUpsDue: QueueOpportunity[];
  stale: QueueOpportunity[];
  /** V1 placeholder：历史成交客户、窗口期内无开放商机 */
  reorder: Array<{ customerId: string; customerName: string; lastWonAt: Date; lastWonValue: number | null }>;
  approvalsRequired: number;
  counts: Record<string, number>;
}

const SELECT = {
  id: true,
  title: true,
  stage: true,
  customerId: true,
  customer: { select: { name: true, email: true } },
  score: true,
  scoreGrade: true,
  estimatedValue: true,
  market: true,
  buyerType: true,
  assignedToId: true,
  createdAt: true,
  updatedAt: true,
  stageChangedAt: true,
  lastInteractionAt: true,
  lastCustomerReplyAt: true,
  lastOutboundAt: true,
  nextFollowupAt: true,
  nextActionType: true,
  nextActionReason: true,
  followUpCount: true,
  fdeInfluenced: true,
  fdeSourced: true,
} as const;

type Row = {
  id: string; title: string; stage: string; customerId: string; customer: { name: string; email: string | null };
  score: number | null; scoreGrade: string | null; estimatedValue: number | null; market: string | null; buyerType: string | null;
  assignedToId: string | null; createdAt: Date; updatedAt: Date; stageChangedAt: Date | null; lastInteractionAt: Date | null;
  lastCustomerReplyAt: Date | null; lastOutboundAt: Date | null; nextFollowupAt: Date | null; nextActionType: string | null;
  nextActionReason: string | null; followUpCount: number; fdeInfluenced: boolean; fdeSourced: boolean;
};

function toQueue(r: Row): QueueOpportunity {
  return {
    id: r.id,
    title: r.title,
    stage: r.stage,
    customerId: r.customerId,
    customerName: r.customer.name,
    customerEmail: r.customer.email,
    score: r.score,
    scoreGrade: r.scoreGrade,
    estimatedValue: r.estimatedValue,
    market: r.market,
    buyerType: r.buyerType,
    assignedToId: r.assignedToId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    stageChangedAt: r.stageChangedAt,
    lastInteractionAt: r.lastInteractionAt,
    lastCustomerReplyAt: r.lastCustomerReplyAt,
    lastOutboundAt: r.lastOutboundAt,
    nextFollowupAt: r.nextFollowupAt,
    nextActionType: r.nextActionType,
    nextActionReason: r.nextActionReason,
    followUpCount: r.followUpCount,
    fdeInfluenced: r.fdeInfluenced,
    fdeSourced: r.fdeSourced,
  };
}

/** 纯函数分桶（可单测） */
export function bucketOpportunities(rows: QueueOpportunity[], policy: RevenueSpinePolicy, now: Date) {
  const customerWaiting = (o: QueueOpportunity) =>
    !!o.lastCustomerReplyAt && (!o.lastOutboundAt || o.lastCustomerReplyAt.getTime() > o.lastOutboundAt.getTime());
  const due = (o: QueueOpportunity) => !!o.nextFollowupAt && o.nextFollowupAt.getTime() <= now.getTime();
  const hotLeads = rows.filter(
    (o) => (o.scoreGrade === "HOT" || o.scoreGrade === "HIGH") && (PRE_QUOTE_STAGES as readonly string[]).includes(o.stage) && !o.lastOutboundAt,
  );
  const needReply = rows.filter((o) => customerWaiting(o) && !hotLeads.includes(o));
  const quoteFollowUp = rows.filter((o) => (o.stage === "quoted" || o.stage === "follow_up") && due(o) && !customerWaiting(o));
  const sampleFollowUp = rows.filter((o) => o.stage === "sample" && due(o) && !customerWaiting(o));
  const stale = rows.filter((o) => o.stage === "stale" || isStale({ stage: o.stage, lastInteractionAt: o.lastInteractionAt, createdAt: o.createdAt }, policy, now));
  const followUpsDue = rows.filter((o) => due(o));
  const byScore = (a: QueueOpportunity, b: QueueOpportunity) => (b.score ?? 0) - (a.score ?? 0) || a.createdAt.getTime() - b.createdAt.getTime();
  const byDue = (a: QueueOpportunity, b: QueueOpportunity) => (a.nextFollowupAt?.getTime() ?? 0) - (b.nextFollowupAt?.getTime() ?? 0);
  return {
    hotLeads: hotLeads.sort(byScore),
    needReply: needReply.sort((a, b) => (a.lastCustomerReplyAt?.getTime() ?? 0) - (b.lastCustomerReplyAt?.getTime() ?? 0)),
    quoteFollowUp: quoteFollowUp.sort(byDue),
    sampleFollowUp: sampleFollowUp.sort(byDue),
    followUpsDue: followUpsDue.sort(byDue),
    stale: stale.sort((a, b) => (a.lastInteractionAt?.getTime() ?? a.createdAt.getTime()) - (b.lastInteractionAt?.getTime() ?? b.createdAt.getTime())),
  };
}

export async function buildRevenueQueue(orgId: string, opts?: { policy?: RevenueSpinePolicy; now?: Date; limit?: number }): Promise<RevenueQueue> {
  const now = opts?.now ?? new Date();
  const policy = opts?.policy ?? (await loadRevenueSpinePolicy(orgId));
  const limit = opts?.limit ?? 50;
  const rows = await db.salesOpportunity.findMany({
    where: { orgId, stage: { in: [...OPEN_STAGES, "stale"] }, customer: { archivedAt: null } },
    select: SELECT,
    orderBy: { updatedAt: "desc" },
    take: 1000,
  });
  const queue = bucketOpportunities(rows.map(toQueue), policy, now);

  const [approvalsRequired, wonCustomers] = await Promise.all([
    db.pendingAction.count({ where: { orgId, type: INQUIRY_REPLY_ACTION_TYPE, status: "pending", expiresAt: { gt: now } } }),
    db.salesOpportunity.findMany({
      where: { orgId, stage: "won", wonAt: { lte: new Date(now.getTime() - policy.followUp.reorderWindowDays * 86_400_000) } },
      select: { customerId: true, wonAt: true, estimatedValue: true, customer: { select: { name: true, archivedAt: true } } },
      orderBy: { wonAt: "desc" },
      take: 200,
    }),
  ]);
  const openCustomerIds = new Set(rows.map((r) => r.customerId));
  const reorderSeen = new Set<string>();
  const reorder: RevenueQueue["reorder"] = [];
  for (const w of wonCustomers) {
    if (w.customer.archivedAt || openCustomerIds.has(w.customerId) || reorderSeen.has(w.customerId) || !w.wonAt) continue;
    reorderSeen.add(w.customerId);
    reorder.push({ customerId: w.customerId, customerName: w.customer.name, lastWonAt: w.wonAt, lastWonValue: w.estimatedValue });
  }

  const clip = <T,>(a: T[]) => a.slice(0, limit);
  return {
    generatedAt: now.toISOString(),
    hotLeads: clip(queue.hotLeads),
    needReply: clip(queue.needReply),
    quoteFollowUp: clip(queue.quoteFollowUp),
    sampleFollowUp: clip(queue.sampleFollowUp),
    followUpsDue: clip(queue.followUpsDue),
    stale: clip(queue.stale),
    reorder: clip(reorder),
    approvalsRequired,
    counts: {
      hotLeads: queue.hotLeads.length,
      needReply: queue.needReply.length,
      quoteFollowUp: queue.quoteFollowUp.length,
      sampleFollowUp: queue.sampleFollowUp.length,
      followUpsDue: queue.followUpsDue.length,
      stale: queue.stale.length,
      reorder: reorder.length,
      approvalsRequired,
    },
  };
}
