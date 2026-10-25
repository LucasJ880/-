/**
 * Revenue Spine — 首响 SLA 指标（PRD §7 / M1 退出条件「SLA 指标可看」）
 *
 * 口径（按组织、按窗口，默认近 30 天，以询盘进来的时刻落窗）：
 *   - 询盘 = 新询盘的 FDE 行动（SalesAction.actionType = inbound_inquiry，每个新商机一条；同一商机多条取最早）
 *   - 首次回复 = 询盘之后最早的：已执行的询盘回复草稿（PendingAction sales.send_inquiry_reply, executedAt）/
 *     第一条外发互动（CustomerInteraction outbound）/ 关联外贸线索的第一条外发消息（TradeMessage outbound）
 *   - 首响时长：设了工作时间（policy.salesSla.businessHours）按工作时间计，否则按自然时间；给中位数与 P90（只算已回复的）
 *   - 24 小时内回复率：自然时间 24 小时（买家视角）；分母只算已满 24 小时、且不是「关闭未回复」的询盘
 *   - 未回复 = 至今没有回复、行动仍开放；关闭未回复（不合格 / 被人工关闭）单列，不算进 24 小时分母
 *   - 入驻测试询盘（utm_source = qingyan_onboarding_test / 测试买家标记 / 测试关闭原因）一律排除
 *   - 展会速记卡（source = trade_show）单独一组：批量夜间录入，与买家主动来询不可比
 *   - 护栏拦截 = 草稿因护栏（价格 / MOQ / 交期等承诺）没进审批中心：首封看 SalesAction.inputContext.guardrailBlockedAt
 *     （旧数据退回读该次 FDE 的 AgentRunEvent），跟进草稿看 AuditLog（no-reply-followup 写入）
 *
 * computeSlaMetrics 是纯函数（可单测）；loadSlaMetrics 负责查询，所有查询都按 orgId 限定。
 */

import { db } from "@/lib/db";
import { slaMinutesBetween, type BusinessCalendar } from "./business-days";
import { FDE_EMPLOYEE_KEY } from "./fde/actions";
import { INQUIRY_REPLY_ACTION_TYPE } from "./fde/inbound-sales";
import { FOLLOW_UP_GUARDRAIL_AUDIT_ACTION } from "./fde/no-reply-followup";
import { loadRevenueSpinePolicy, type RevenueSpinePolicy } from "./policy";

/** 与入驻向导（organizations/onboarding-rules）的测试询盘标记保持一致 */
export const ONBOARDING_TEST_UTM_SOURCE = "qingyan_onboarding_test";
export const ONBOARDING_TEST_TAG = "qingyan_onboarding_test";
export const ONBOARDING_TEST_CLOSE_REASON = "onboarding test";

export const INBOUND_INQUIRY_ACTION_TYPE = "inbound_inquiry";
export const TRADE_SHOW_SOURCE = "trade_show";
export const DEFAULT_SLA_WINDOW_DAYS = 30;
export const MAX_SLA_WINDOW_DAYS = 180;
/** 回复时刻早于询盘时刻这么多以内也算（DB 时钟与应用时钟的偏差） */
export const RESPONSE_CLOCK_TOLERANCE_MS = 60_000;
const WITHIN_MS = 24 * 3_600_000;
const DAY_MS = 86_400_000;
const OPEN_ACTION_STATUSES = ["open", "in_progress"];
const MAX_ROWS = 5000;

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null);

function splitTags(tags: string | null | undefined): string[] {
  return (tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** 入驻向导的端到端测试询盘（不进指标、不触发分级提醒） */
export function isOnboardingTestInquiry(m: { utmSource?: string | null; customerTags?: string | null; lostReason?: string | null }): boolean {
  return (
    (m.utmSource ?? "").trim().toLowerCase() === ONBOARDING_TEST_UTM_SOURCE ||
    splitTags(m.customerTags).includes(ONBOARDING_TEST_TAG) ||
    (m.lostReason ?? "").trim() === ONBOARDING_TEST_CLOSE_REASON
  );
}

/** SalesAction.inputContext.meta.utm.source（网站询盘写 source；其它渠道可能写 utm_source） */
export function utmSourceOf(inputContext: unknown): string | null {
  const utm = rec(rec(rec(inputContext)?.meta)?.utm);
  const v = utm?.source ?? utm?.utm_source;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export interface SlaMetricRow {
  actionId: string;
  opportunityId: string;
  /** 询盘进来的时刻（FDE 行动创建时刻） */
  inboundAt: Date;
  /** SalesOpportunity.source（trade_show = 展会速记卡） */
  source: string | null;
  /** SalesAction.status */
  actionStatus: string;
  utmSource: string | null;
  customerTags: string | null;
  lostReason: string | null;
  /** 该商机已执行的询盘回复草稿的执行时刻 */
  executedReplyAts: Date[];
  /** 该商机外发互动的时刻 */
  outboundInteractionAts: Date[];
  /** 关联外贸线索外发消息的时刻 */
  outboundTradeMessageAts: Date[];
  /** 首封草稿曾被护栏拦下 */
  guardrailBlocked: boolean;
}

export interface SlaMetricsBucket {
  received: number;
  answered: number;
  /** 至今没回复、行动仍开放 */
  unanswered: number;
  /** 没回复但行动已关闭（不合格 / 人工关闭） */
  closedWithoutReply: number;
  medianFirstResponseMinutes: number | null;
  p90FirstResponseMinutes: number | null;
  /** 已满 24 小时、且不是「关闭未回复」的询盘数（24 小时回复率的分母） */
  within24hEligible: number;
  answeredWithin24h: number;
  /** 0..1；分母为 0 时为 null */
  answeredWithin24hRate: number | null;
}

export interface SlaMetrics {
  windowDays: number;
  from: Date;
  to: Date;
  /** 首响时长口径：business = 按工作时间，wall_clock = 按自然时间 */
  basis: "business" | "wall_clock";
  businessHours: BusinessCalendar | null;
  /** 买家主动来询（不含展会速记卡、不含测试） */
  inquiries: SlaMetricsBucket;
  /** 展会速记卡 */
  tradeShow: SlaMetricsBucket;
  excludedTests: number;
  guardrail: { total: number; firstReply: number; followUp: number };
}

/** 询盘之后最早的回复时刻（三种来源取最早；早于询盘超过容差的不算） */
export function firstResponseAt(row: Pick<SlaMetricRow, "inboundAt" | "executedReplyAts" | "outboundInteractionAts" | "outboundTradeMessageAts">): Date | null {
  const floor = row.inboundAt.getTime() - RESPONSE_CLOCK_TOLERANCE_MS;
  let best: number | null = null;
  for (const d of [...row.executedReplyAts, ...row.outboundInteractionAts, ...row.outboundTradeMessageAts]) {
    const t = d.getTime();
    if (t >= floor && (best === null || t < best)) best = t;
  }
  return best === null ? null : new Date(best);
}

/** 中位数（偶数个取中间两个的平均） */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 百分位（最近秩法：排序后第 ceil(p·n) 个） */
export function percentileNearestRank(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1));
  return s[idx];
}

const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

function emptyBucket(): SlaMetricsBucket {
  return {
    received: 0,
    answered: 0,
    unanswered: 0,
    closedWithoutReply: 0,
    medianFirstResponseMinutes: null,
    p90FirstResponseMinutes: null,
    within24hEligible: 0,
    answeredWithin24h: 0,
    answeredWithin24hRate: null,
  };
}

function bucketOf(rows: SlaMetricRow[], calendar: BusinessCalendar | null, now: Date): SlaMetricsBucket {
  const b = emptyBucket();
  const minutes: number[] = [];
  for (const r of rows) {
    b.received++;
    const first = firstResponseAt(r);
    const closed = !OPEN_ACTION_STATUSES.includes(r.actionStatus);
    if (first) {
      b.answered++;
      const at = first.getTime() < r.inboundAt.getTime() ? r.inboundAt : first;
      minutes.push(slaMinutesBetween(r.inboundAt, at, calendar));
    } else if (closed) {
      b.closedWithoutReply++;
    } else {
      b.unanswered++;
    }
    const mature = r.inboundAt.getTime() + WITHIN_MS <= now.getTime();
    if (mature && (first || !closed)) {
      b.within24hEligible++;
      if (first && first.getTime() - r.inboundAt.getTime() <= WITHIN_MS) b.answeredWithin24h++;
    }
  }
  b.medianFirstResponseMinutes = round1(median(minutes));
  b.p90FirstResponseMinutes = round1(percentileNearestRank(minutes, 0.9));
  b.answeredWithin24hRate = b.within24hEligible ? Math.round((b.answeredWithin24h / b.within24hEligible) * 1000) / 1000 : null;
  return b;
}

export function clampWindowDays(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_SLA_WINDOW_DAYS;
  return Math.min(MAX_SLA_WINDOW_DAYS, Math.max(1, Math.round(n)));
}

/** 纯函数：按口径汇总（rows 可以多给，窗口外的会被排除） */
export function computeSlaMetrics(
  rows: SlaMetricRow[],
  opts: { calendar: BusinessCalendar | null; now: Date; windowDays?: number; followUpGuardrailBlocks?: number },
): SlaMetrics {
  const windowDays = clampWindowDays(opts.windowDays ?? DEFAULT_SLA_WINDOW_DAYS);
  const to = opts.now;
  const from = new Date(to.getTime() - windowDays * DAY_MS);
  const inWindow = rows.filter((r) => r.inboundAt.getTime() >= from.getTime() && r.inboundAt.getTime() <= to.getTime());

  // 同一商机只算一次（最早的那条询盘）
  const byOpp = new Map<string, SlaMetricRow>();
  for (const r of [...inWindow].sort((a, b) => a.inboundAt.getTime() - b.inboundAt.getTime())) {
    if (!byOpp.has(r.opportunityId)) byOpp.set(r.opportunityId, r);
  }
  const unique = [...byOpp.values()];
  const tests = unique.filter((r) => isOnboardingTestInquiry(r));
  const real = unique.filter((r) => !isOnboardingTestInquiry(r));
  const booth = real.filter((r) => r.source === TRADE_SHOW_SOURCE);
  const inquiries = real.filter((r) => r.source !== TRADE_SHOW_SOURCE);
  const firstReply = real.filter((r) => r.guardrailBlocked).length;
  const followUp = Math.max(0, Math.round(opts.followUpGuardrailBlocks ?? 0));

  return {
    windowDays,
    from,
    to,
    basis: opts.calendar ? "business" : "wall_clock",
    businessHours: opts.calendar,
    inquiries: bucketOf(inquiries, opts.calendar, to),
    tradeShow: bucketOf(booth, opts.calendar, to),
    excludedTests: tests.length,
    guardrail: { total: firstReply + followUp, firstReply, followUp },
  };
}

function pushTo(map: Map<string, Date[]>, key: string, at: Date) {
  const list = map.get(key);
  if (list) list.push(at);
  else map.set(key, [at]);
}

function eventShowsGuardrailBlock(payload: unknown): boolean {
  const p = rec(payload);
  if (!p) return false;
  if (p.decision === "guardrail_blocked") return true;
  return p.decision === "draft" && Array.isArray(p.guardrailViolations) && p.guardrailViolations.length > 0;
}

/**
 * 查询 + 汇总。所有查询按 orgId 限定；外贸消息只查本组织、且链接到窗口内商机的线索。
 */
export async function loadSlaMetrics(
  orgId: string,
  opts?: { now?: Date; windowDays?: number; policy?: RevenueSpinePolicy },
): Promise<SlaMetrics> {
  const now = opts?.now ?? new Date();
  const windowDays = clampWindowDays(opts?.windowDays ?? DEFAULT_SLA_WINDOW_DAYS);
  const from = new Date(now.getTime() - windowDays * DAY_MS);
  const responseFloor = new Date(from.getTime() - RESPONSE_CLOCK_TOLERANCE_MS);
  const policy = opts?.policy ?? (await loadRevenueSpinePolicy(orgId));
  const calendar = policy.salesSla.businessHours ?? null;

  const actions = await db.salesAction.findMany({
    where: {
      orgId,
      employeeKey: FDE_EMPLOYEE_KEY,
      actionType: INBOUND_INQUIRY_ACTION_TYPE,
      opportunityId: { not: null },
      createdAt: { gte: from, lte: now },
    },
    select: {
      id: true,
      createdAt: true,
      status: true,
      opportunityId: true,
      agentRunId: true,
      inputContext: true,
      opportunity: { select: { id: true, orgId: true, source: true, lostReason: true, customer: { select: { tags: true } } } },
    },
    orderBy: { createdAt: "asc" },
    take: MAX_ROWS,
  });
  // 关联商机必须属于本组织（防御性：SalesAction 与商机理论上同组织）
  const scoped = actions.filter((a) => a.opportunityId && a.opportunity && a.opportunity.orgId === orgId);
  const oppIds = [...new Set(scoped.map((a) => a.opportunityId as string))];

  const executed = new Map<string, Date[]>();
  const interactions = new Map<string, Date[]>();
  const tradeMessages = new Map<string, Date[]>();
  let followUpGuardrailBlocks = 0;
  const eventBlocked = new Set<string>();

  if (oppIds.length) {
    const [replies, outbound, prospects, auditCount] = await Promise.all([
      db.pendingAction.findMany({
        where: { orgId, type: INQUIRY_REPLY_ACTION_TYPE, status: "executed", executedAt: { gte: responseFloor } },
        select: { payload: true, executedAt: true },
        take: MAX_ROWS,
      }),
      db.customerInteraction.findMany({
        where: { orgId, opportunityId: { in: oppIds }, direction: "outbound", createdAt: { gte: responseFloor } },
        select: { opportunityId: true, createdAt: true },
        take: MAX_ROWS * 4,
      }),
      db.tradeProspect.findMany({
        where: { orgId, convertedToSalesOpportunityId: { in: oppIds } },
        select: { id: true, convertedToSalesOpportunityId: true },
      }),
      db.auditLog.count({ where: { orgId, action: FOLLOW_UP_GUARDRAIL_AUDIT_ACTION, createdAt: { gte: from, lte: now } } }),
    ]);
    const oppSet = new Set(oppIds);
    for (const r of replies) {
      const oid = rec(r.payload)?.opportunityId;
      if (typeof oid === "string" && oppSet.has(oid) && r.executedAt) pushTo(executed, oid, r.executedAt);
    }
    for (const i of outbound) if (i.opportunityId) pushTo(interactions, i.opportunityId, i.createdAt);
    const oppByProspect = new Map(prospects.map((p) => [p.id, p.convertedToSalesOpportunityId as string]));
    if (oppByProspect.size) {
      const msgs = await db.tradeMessage.findMany({
        where: { prospectId: { in: [...oppByProspect.keys()] }, direction: "outbound", createdAt: { gte: responseFloor } },
        select: { prospectId: true, createdAt: true },
        take: MAX_ROWS * 4,
      });
      for (const m of msgs) {
        const oid = oppByProspect.get(m.prospectId);
        if (oid) pushTo(tradeMessages, oid, m.createdAt);
      }
    }
    followUpGuardrailBlocks = auditCount;

    // 护栏标记之前的旧数据：读该次 FDE 的事件
    const legacyRunIds = scoped
      .filter((a) => a.agentRunId && rec(a.inputContext)?.draftStatus === undefined && rec(a.inputContext)?.guardrailBlockedAt === undefined)
      .map((a) => a.agentRunId as string);
    if (legacyRunIds.length) {
      const events = await db.agentRunEvent.findMany({
        where: { orgId, runId: { in: legacyRunIds }, eventType: "agent.output" },
        select: { runId: true, payload: true },
        take: MAX_ROWS * 4,
      });
      for (const e of events) if (eventShowsGuardrailBlock(e.payload)) eventBlocked.add(e.runId);
    }
  }

  const rows: SlaMetricRow[] = scoped.map((a) => {
    const oid = a.opportunityId as string;
    const ctx = rec(a.inputContext);
    return {
      actionId: a.id,
      opportunityId: oid,
      inboundAt: a.createdAt,
      source: a.opportunity?.source ?? (typeof ctx?.source === "string" ? ctx.source : null),
      actionStatus: a.status,
      utmSource: utmSourceOf(a.inputContext),
      customerTags: a.opportunity?.customer?.tags ?? null,
      lostReason: a.opportunity?.lostReason ?? null,
      executedReplyAts: executed.get(oid) ?? [],
      outboundInteractionAts: interactions.get(oid) ?? [],
      outboundTradeMessageAts: tradeMessages.get(oid) ?? [],
      guardrailBlocked: typeof ctx?.guardrailBlockedAt === "string" || (!!a.agentRunId && eventBlocked.has(a.agentRunId)),
    };
  });

  return computeSlaMetrics(rows, { calendar, now, windowDays, followUpGuardrailBlocks });
}
