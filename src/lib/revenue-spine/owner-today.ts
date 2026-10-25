/**
 * Revenue Spine — 老板「今日询盘」视图（PRD F5）
 *
 * 四栏，手机上一屏看完今天该干什么：
 *   (a) newToday          今天（组织当地零点起，不是 UTC 零点）新建的商机
 *   (b) overdue           下一步是「回复新询盘 / 回复客户来信」且已过时限
 *   (c) approvals         待审批、未过期的询盘回复草稿（PendingAction sales.send_inquiry_reply），按 payload.opportunityId 关联商机
 *   (d) samplesQuotesDue  当地今天结束前到期的报价 / 样品跟进：Revenue Spine 下一步 + 外贸寄样单 / 报价单
 *                         （经 TradeProspect.convertedToSalesOpportunityId 映射到商机），同一商机只出一张卡
 *
 * bucketOwnerToday 是纯函数（可单测）；buildOwnerToday 负责查询，所有查询都按 orgId 限定。
 * 计数来自完整结果，列表才截断；今日新询盘有自己的查询，不依赖任何截断过的队列。
 */

import { db } from "@/lib/db";
import { getLocalTimeParts } from "@/lib/automation/local-time";
import { resolveOrgTimezone } from "@/lib/automation/registry";
import { zonedHourToUtc } from "@/lib/trade/booth-summary";
import { isSampleWaitingReply } from "@/lib/trade/sample-constants";
import { QUEUE_OPPORTUNITY_SELECT, toQueueOpportunity, type QueueOpportunity } from "./daily-actions";
import { INQUIRY_REPLY_ACTION_TYPE } from "./fde/inbound-sales";
import { OPEN_STAGES } from "./opportunity-stage";
import { loadRevenueSpinePolicy, type RevenueSpinePolicy } from "./policy";
import { opportunitySourceLabel } from "./source-labels";

/** 超时栏：只看「该回复买家」这两类下一步 */
export const OVERDUE_ACTION_TYPES = ["reply_inquiry", "reply_customer"] as const;
/** 样品与报价栏：Revenue Spine 的报价 / 样品下一步 */
export const QUOTE_SAMPLE_ACTION_TYPES = ["send_quote", "quote_follow_up", "sample_follow_up"] as const;
/** 外贸报价单：已发出 / 谈判中，且有效期在今天结束 */
const TRADE_QUOTE_ACTIVE_STATUSES = ["sent", "negotiating"];

const LIST_LIMIT = 50;
const MINUTE = 60_000;

export interface OwnerTodayCard {
  opportunityId: string;
  customerName: string;
  title: string;
  stage: string;
  score: number | null;
  scoreGrade: string | null;
  priority: string | null;
  /** 买家国家 / 市场 */
  market: string | null;
  source: string | null;
  sourceLabel: string;
  createdAt: Date;
  ageMinutes: number;
  nextActionType: string | null;
  nextFollowupAt: Date | null;
  assignedToId: string | null;
}

export interface OwnerOverdueItem extends OwnerTodayCard {
  overdueMinutes: number;
  /** 该类回复的 SLA（工作小时，来自组织策略） */
  slaHours: number;
}

export interface OwnerApprovalInput {
  id: string;
  title: string;
  /** 审批预览：风险提醒 + 将发送的邮件 + 中文对照（只供审核） */
  preview: string;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  /** 来自 payload.opportunityId */
  opportunityId: string | null;
}

export interface OwnerApprovalItem {
  pendingActionId: string;
  title: string;
  preview: string;
  createdAt: Date;
  expiresAt: Date;
  waitingMinutes: number;
  opportunity: OwnerTodayCard | null;
}

export type OwnerDueKind = "quote" | "sample";
export type OwnerDueOrigin = "revenue_spine" | "trade_sample" | "trade_quote";

/** 外贸寄样单 / 报价单（已按 orgId 查询并映射到商机） */
export interface OwnerDueInput {
  kind: OwnerDueKind;
  origin: Exclude<OwnerDueOrigin, "revenue_spine">;
  /** TradeSample.id / TradeQuote.id */
  refId: string;
  opportunityId: string | null;
  dueAt: Date;
  label: string;
  companyName: string | null;
  country: string | null;
}

export interface OwnerDueReason {
  kind: OwnerDueKind;
  origin: OwnerDueOrigin;
  refId: string;
  label: string;
  dueAt: Date;
}

export interface OwnerDueItem {
  /** opp:<id>，没有映射到商机的外贸单据为 trade_sample:<id> / trade_quote:<id> */
  key: string;
  opportunityId: string | null;
  kinds: OwnerDueKind[];
  /** 最早的到期时间 */
  dueAt: Date;
  overdue: boolean;
  reasons: OwnerDueReason[];
  opportunity: OwnerTodayCard | null;
  companyName: string | null;
  country: string | null;
  href: string;
}

export interface OwnerTodayCounts {
  newToday: number;
  overdue: number;
  approvals: number;
  samplesQuotesDue: number;
}

export interface OwnerTodayBuckets {
  newToday: OwnerTodayCard[];
  overdue: OwnerOverdueItem[];
  approvals: OwnerApprovalItem[];
  samplesQuotesDue: OwnerDueItem[];
  counts: OwnerTodayCounts;
}

export interface OwnerToday extends OwnerTodayBuckets {
  generatedAt: Date;
  /** 组织当地日期 YYYY-MM-DD */
  day: string;
  timeZone: string;
  dayStart: Date;
  dayEnd: Date;
}

const pad = (n: number) => String(n).padStart(2, "0");

function nextDate(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 组织当地的「今天」：当地零点到次日零点（夏令时切换日按实际时长） */
export function localDayBounds(now: Date, timeZone: string): { day: string; start: Date; end: Date } {
  const day = getLocalTimeParts(now, timeZone).date;
  return { day, start: zonedHourToUtc(day, 0, timeZone), end: zonedHourToUtc(nextDate(day), 0, timeZone) };
}

const minutesBetween = (later: Date, earlier: Date) => Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / MINUTE));

function toCard(o: QueueOpportunity, now: Date): OwnerTodayCard {
  return {
    opportunityId: o.id,
    customerName: o.customerName,
    title: o.title,
    stage: o.stage,
    score: o.score,
    scoreGrade: o.scoreGrade,
    priority: o.priority ?? null,
    market: o.market,
    source: o.source ?? null,
    sourceLabel: opportunitySourceLabel(o.source),
    createdAt: o.createdAt,
    ageMinutes: minutesBetween(now, o.createdAt),
    nextActionType: o.nextActionType,
    nextFollowupAt: o.nextFollowupAt,
    assignedToId: o.assignedToId,
  };
}

const isOpenStage = (stage: string) => stage === "stale" || (OPEN_STAGES as readonly string[]).includes(stage);
const byScoreThenNewest = (a: OwnerTodayCard, b: OwnerTodayCard) =>
  (b.score ?? -1) - (a.score ?? -1) || b.createdAt.getTime() - a.createdAt.getTime();

/**
 * 纯函数分栏。rows 可以多给（查询为关联审批 / 外贸单据补进来的商机），每栏按自己的条件筛。
 * dayEnd 缺省为 dayStart + 24h；buildOwnerToday 总是按组织时区传入真实的次日零点。
 */
export function bucketOwnerToday(
  rows: QueueOpportunity[],
  approvals: OwnerApprovalInput[],
  dueItems: OwnerDueInput[],
  policy: RevenueSpinePolicy,
  now: Date,
  dayStart: Date,
  dayEnd: Date = new Date(dayStart.getTime() + 24 * 3_600_000),
): OwnerTodayBuckets {
  const byId = new Map<string, QueueOpportunity>();
  for (const r of rows) if (!byId.has(r.id)) byId.set(r.id, r);
  const unique = [...byId.values()];
  const cardOf = (id: string | null) => {
    const o = id ? byId.get(id) : undefined;
    return o ? toCard(o, now) : null;
  };

  // (a) 今天新建：[当地零点, now]
  const newToday = unique
    .filter((o) => o.createdAt.getTime() >= dayStart.getTime() && o.createdAt.getTime() <= now.getTime())
    .map((o) => toCard(o, now))
    .sort(byScoreThenNewest);

  // (b) 回复超时
  const overdue = unique
    .filter(
      (o) =>
        isOpenStage(o.stage) &&
        !!o.nextActionType &&
        (OVERDUE_ACTION_TYPES as readonly string[]).includes(o.nextActionType) &&
        !!o.nextFollowupAt &&
        o.nextFollowupAt.getTime() <= now.getTime(),
    )
    .map(
      (o): OwnerOverdueItem => ({
        ...toCard(o, now),
        overdueMinutes: minutesBetween(now, o.nextFollowupAt as Date),
        slaHours: o.nextActionType === "reply_customer" ? policy.salesSla.customerReplyResponseHours : policy.salesSla.newInquiryResponseHours,
      }),
    )
    .sort((a, b) => b.overdueMinutes - a.overdueMinutes);

  // (c) 待审批：只要 pending 且未过期（查询已过滤，这里再兜一次）
  const approvalItems = approvals
    .filter((a) => a.status === "pending" && a.expiresAt.getTime() > now.getTime())
    .map(
      (a): OwnerApprovalItem => ({
        pendingActionId: a.id,
        title: a.title,
        preview: a.preview,
        createdAt: a.createdAt,
        expiresAt: a.expiresAt,
        waitingMinutes: minutesBetween(now, a.createdAt),
        opportunity: cardOf(a.opportunityId),
      }),
    )
    .sort((a, b) => (b.opportunity?.score ?? -1) - (a.opportunity?.score ?? -1) || a.createdAt.getTime() - b.createdAt.getTime());

  // (d) 样品与报价：Revenue Spine 下一步 + 外贸单据，同一商机合并
  const due = new Map<string, OwnerDueItem>();
  const add = (key: string, opportunityId: string | null, reason: OwnerDueReason, meta: { companyName: string | null; country: string | null; href: string }) => {
    const existing = due.get(key);
    if (existing) {
      if (!existing.reasons.some((r) => r.origin === reason.origin && r.refId === reason.refId)) existing.reasons.push(reason);
      if (!existing.kinds.includes(reason.kind)) existing.kinds.push(reason.kind);
      if (reason.dueAt.getTime() < existing.dueAt.getTime()) existing.dueAt = reason.dueAt;
      existing.companyName ??= meta.companyName;
      existing.country ??= meta.country;
      return;
    }
    const opportunity = cardOf(opportunityId);
    due.set(key, {
      key,
      opportunityId,
      kinds: [reason.kind],
      dueAt: reason.dueAt,
      overdue: false,
      reasons: [reason],
      opportunity,
      companyName: opportunity?.customerName ?? meta.companyName,
      country: opportunity?.market ?? meta.country,
      href: meta.href,
    });
  };
  for (const o of unique) {
    if (
      !isOpenStage(o.stage) ||
      !o.nextActionType ||
      !(QUOTE_SAMPLE_ACTION_TYPES as readonly string[]).includes(o.nextActionType) ||
      !o.nextFollowupAt ||
      o.nextFollowupAt.getTime() >= dayEnd.getTime()
    ) {
      continue;
    }
    const kind: OwnerDueKind = o.nextActionType === "sample_follow_up" ? "sample" : "quote";
    const label = o.nextActionType === "send_quote" ? "发出报价" : o.nextActionType === "quote_follow_up" ? "报价后跟进" : "样品跟进";
    add(`opp:${o.id}`, o.id, { kind, origin: "revenue_spine", refId: o.id, label, dueAt: o.nextFollowupAt }, { companyName: o.customerName, country: o.market, href: `/revenue/${o.id}` });
  }
  for (const d of dueItems) {
    if (d.dueAt.getTime() >= dayEnd.getTime()) continue;
    const mapped = d.opportunityId && byId.has(d.opportunityId) ? d.opportunityId : null;
    const key = mapped ? `opp:${mapped}` : `${d.origin}:${d.refId}`;
    const href = mapped ? `/revenue/${mapped}` : d.origin === "trade_sample" ? `/trade/samples/${d.refId}` : `/trade/quotes/${d.refId}`;
    add(key, mapped, { kind: d.kind, origin: d.origin, refId: d.refId, label: d.label, dueAt: d.dueAt }, { companyName: d.companyName, country: d.country, href });
  }
  const samplesQuotesDue = [...due.values()]
    .map((item) => ({ ...item, overdue: item.dueAt.getTime() <= now.getTime(), reasons: [...item.reasons].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime()) }))
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());

  return {
    newToday,
    overdue,
    approvals: approvalItems,
    samplesQuotesDue,
    counts: {
      newToday: newToday.length,
      overdue: overdue.length,
      approvals: approvalItems.length,
      samplesQuotesDue: samplesQuotesDue.length,
    },
  };
}

function payloadOpportunityId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const v = (payload as Record<string, unknown>).opportunityId;
  return typeof v === "string" && v ? v : null;
}

export async function loadOrgTimezone(orgId: string): Promise<string> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } });
  return resolveOrgTimezone(org?.settingsJson);
}

/**
 * 查询 + 分栏。所有查询都带 orgId；外贸单据映射到的商机若不属于本组织，按「未映射」处理。
 */
export async function buildOwnerToday(
  orgId: string,
  opts?: { now?: Date; timeZone?: string; policy?: RevenueSpinePolicy; limit?: number },
): Promise<OwnerToday> {
  const now = opts?.now ?? new Date();
  const timeZone = opts?.timeZone ?? (await loadOrgTimezone(orgId));
  const { day, start: dayStart, end: dayEnd } = localDayBounds(now, timeZone);
  const limit = opts?.limit ?? LIST_LIMIT;

  const [policy, oppRows, actionRows, sampleRows, quoteRows] = await Promise.all([
    opts?.policy ? Promise.resolve(opts.policy) : loadRevenueSpinePolicy(orgId),
    db.salesOpportunity.findMany({
      where: {
        orgId,
        customer: { archivedAt: null },
        OR: [
          { createdAt: { gte: dayStart, lte: now } },
          {
            stage: { in: [...OPEN_STAGES, "stale"] },
            nextActionType: { in: [...OVERDUE_ACTION_TYPES, ...QUOTE_SAMPLE_ACTION_TYPES] },
            nextFollowupAt: { lt: dayEnd },
          },
        ],
      },
      select: QUEUE_OPPORTUNITY_SELECT,
      orderBy: { createdAt: "desc" },
      take: 2000,
    }),
    db.pendingAction.findMany({
      where: { orgId, type: INQUIRY_REPLY_ACTION_TYPE, status: "pending", expiresAt: { gt: now } },
      select: { id: true, title: true, preview: true, status: true, createdAt: true, expiresAt: true, payload: true },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    db.tradeSample.findMany({
      where: { orgId, status: "shipped", followedUpAt: null, followUpDueAt: { lt: dayEnd } },
      select: { id: true, prospectId: true, productName: true, status: true, shippedAt: true, followedUpAt: true, followUpDueAt: true },
      orderBy: { followUpDueAt: "asc" },
      take: 500,
    }),
    db.tradeQuote.findMany({
      where: { orgId, status: { in: TRADE_QUOTE_ACTIVE_STATUSES }, expiresAt: { gte: dayStart, lt: dayEnd } },
      select: { id: true, prospectId: true, quoteNumber: true, companyName: true, country: true, expiresAt: true },
      orderBy: { expiresAt: "asc" },
      take: 500,
    }),
  ]);

  // 外贸单据 → 线索 → 商机（线索按 orgId 查）
  const prospectIds = [...new Set([...sampleRows, ...quoteRows].map((r) => r.prospectId).filter((v): v is string => !!v))];
  const prospectById = new Map<string, { id: string; companyName: string; country: string | null; convertedToSalesOpportunityId: string | null }>();
  const lastInboundByProspect = new Map<string, Date | null>();
  if (prospectIds.length) {
    const prospects = await db.tradeProspect.findMany({
      where: { orgId, id: { in: prospectIds } },
      select: { id: true, companyName: true, country: true, convertedToSalesOpportunityId: true },
    });
    for (const p of prospects) prospectById.set(p.id, p);
    // 只对本组织的线索查来信（线索 id 已按 orgId 过滤）
    const scopedIds = prospects.map((p) => p.id);
    if (scopedIds.length) {
      const inbound = await db.tradeMessage.groupBy({
        by: ["prospectId"],
        where: { prospectId: { in: scopedIds }, direction: "inbound" },
        _max: { createdAt: true },
      });
      for (const r of inbound) lastInboundByProspect.set(r.prospectId, r._max.createdAt ?? null);
    }
  }

  const dueItems: OwnerDueInput[] = [];
  for (const s of sampleRows) {
    if (!s.followUpDueAt) continue;
    const p = s.prospectId ? prospectById.get(s.prospectId) : undefined;
    // 与寄样页同一口径：寄出后买家已再来信的不算等跟进
    if (!isSampleWaitingReply({ status: s.status, shippedAt: s.shippedAt, followedUpAt: s.followedUpAt, lastInboundAt: s.prospectId ? lastInboundByProspect.get(s.prospectId) ?? null : null })) continue;
    dueItems.push({
      kind: "sample",
      origin: "trade_sample",
      refId: s.id,
      opportunityId: p?.convertedToSalesOpportunityId ?? null,
      dueAt: s.followUpDueAt,
      label: `寄样跟进：${s.productName}`.slice(0, 80),
      companyName: p?.companyName ?? null,
      country: p?.country ?? null,
    });
  }
  for (const q of quoteRows) {
    if (!q.expiresAt) continue;
    const p = q.prospectId ? prospectById.get(q.prospectId) : undefined;
    dueItems.push({
      kind: "quote",
      origin: "trade_quote",
      refId: q.id,
      opportunityId: p?.convertedToSalesOpportunityId ?? null,
      dueAt: q.expiresAt,
      label: `报价 ${q.quoteNumber} 今天到期`.slice(0, 80),
      companyName: q.companyName || p?.companyName || null,
      country: q.country ?? p?.country ?? null,
    });
  }

  const approvals: OwnerApprovalInput[] = actionRows.map((a) => ({
    id: a.id,
    title: a.title,
    preview: a.preview,
    status: a.status,
    createdAt: a.createdAt,
    expiresAt: a.expiresAt,
    opportunityId: payloadOpportunityId(a.payload),
  }));

  // 审批 / 外贸单据关联到、但不在上面结果里的商机：按 orgId 补查（跨组织的 id 查不到 → 视为未关联；
  // 归档客户与主查询同一口径排除，审批卡照常显示，只是不带商机信息）
  const have = new Set(oppRows.map((r) => r.id));
  const missing = [
    ...new Set([...approvals.map((a) => a.opportunityId), ...dueItems.map((d) => d.opportunityId)].filter((v): v is string => !!v && !have.has(v))),
  ];
  const extraRows = missing.length
    ? await db.salesOpportunity.findMany({ where: { orgId, id: { in: missing }, customer: { archivedAt: null } }, select: QUEUE_OPPORTUNITY_SELECT })
    : [];

  const rows = [...oppRows, ...extraRows].map(toQueueOpportunity);
  const buckets = bucketOwnerToday(rows, approvals, dueItems, policy, now, dayStart, dayEnd);
  const clip = <T,>(a: T[]) => a.slice(0, limit);
  return {
    generatedAt: now,
    day,
    timeZone,
    dayStart,
    dayEnd,
    newToday: clip(buckets.newToday),
    overdue: clip(buckets.overdue),
    approvals: clip(buckets.approvals),
    samplesQuotesDue: clip(buckets.samplesQuotesDue),
    counts: buckets.counts,
  };
}
