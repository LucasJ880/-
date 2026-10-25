/**
 * Revenue Spine — 新询盘首响 SLA 分级提醒（PRD F3.4–F3.7）
 *
 * 对象：开放的新询盘 FDE 行动（SalesAction.actionType = inbound_inquiry，status open / in_progress，商机在开放阶段），
 * 且询盘之后还没有任何回复（与 sla-metrics 同一首次回复口径：已执行的询盘回复草稿 / 外发互动 / 关联外贸线索的外发消息）。
 *
 * 三档（policy.salesSla；某档为 null 即该档关闭，三档全 null = 本组织不启用，完全走 inquiry-sla 旧提醒）：
 *   unclaimed      T + unclaimedAlertMinutes   → 负责人（商机负责人；已不在组织则组织所有者）站内 + 微信，按实际情况说明草稿状态；
 *                  行动已被人认领（status = in_progress）则跳过这一档，升级与第三档照常（认领不等于回复）
 *   escalation     T + ownerEscalationMinutes  → 管理层（managementOf）站内 + 微信
 *   overdue_draft  T + overdueDraftHours       → 管理层：仍未回复，回复草稿是否在审批中心等待（或没有草稿的原因）
 * 设了工作时间（businessHours）按工作时间计，否则按自然时间。只提醒——绝不自动给买家发任何邮件。
 * 微信经 pushNotification（cron / serverless 里唯一能真正发出的通道），静默时段由推送服务跳过；正文不含买家邮箱 / 电话。
 *
 * 幂等：每档每条行动一个 sourceKey（inquiry-sla:v2:<tier>:<orgId>:<actionId>，第一位收件人用它占位，其余收件人再加 :<userId>），
 * 先占位再推送，每档只发一次（负责人中途变了也不重发）。错过超过 24 小时的档位不补发（刚启用时不给积压的老询盘补提醒）。
 * 展会速记卡（trade_show）不进分级：一晚录入几十张，由展会小结统一告知。入驻测试询盘不提醒。
 *
 * 与旧提醒的分工（同一条询盘只有一个提醒来源）：
 *   - 启用分级的组织：分级对象范围内的新询盘（不论此刻是否还开放 / 已回复 / 已关闭）归分级负责一辈子，
 *     inquiry-sla 旧的线程提醒（5 分钟 / 24 小时）跳过它关联的外贸线索里「这次询盘」那条进线
 *     （线程最后一次进线不晚于询盘行动创建 + 容差），以及仍被分级跟踪的商机的线索；
 *     电话回复后人工记录外发、行动被完成 / 忽略、商机离开开放阶段之后，旧提醒也不会再为这条询盘补发。
 *     其它线程（没进 Revenue Spine 的渠道消息、询盘之后客户再来信等）旧提醒照常
 *   - cron/revenue-spine 本来就不为 reply_inquiry 发提醒；reply_customer 需要已有外发，而有外发的询盘不在分级对象里，天然不重叠
 *   - 未启用分级的组织：旧行为逐位不变
 */

import { db } from "@/lib/db";
import { resolveAppOrigin } from "@/lib/agent-runtime/workbench-link";
import { managementOf } from "@/lib/trade/booth-summary";
import { addSlaMinutes } from "./business-days";
import { FDE_EMPLOYEE_KEY } from "./fde/actions";
import { INQUIRY_REPLY_ACTION_TYPE } from "./fde/inbound-sales";
import { OPEN_STAGES } from "./opportunity-stage";
import { buyerLine, pushOutcomeOf, safeBuyerName, type BuyerLine, type PushFn } from "./owner-brief";
import { loadRevenueSpinePolicy, slaTiersEnabled, type RevenueSpinePolicy, type SalesSlaPolicy } from "./policy";
import {
  INBOUND_INQUIRY_ACTION_TYPE,
  RESPONSE_CLOCK_TOLERANCE_MS,
  TRADE_SHOW_SOURCE,
  isOnboardingTestInquiry,
  loadExecutedInquiryReplyTimes,
  utmSourceOf,
} from "./sla-metrics";

export const SLA_TIER_SOURCE_PREFIX = "inquiry-sla:v2";
export const SLA_TIERS = ["unclaimed", "escalation", "overdue_draft"] as const;
export type SlaTier = (typeof SLA_TIERS)[number];
/** 档位到期后超过这么久还没发（cron 停摆 / 刚启用分级时的积压），不再补发 */
export const SLA_TIER_MAX_LATE_MS = 24 * 3_600_000;
/** 只看近 30 天的询盘（overdueDraftHours 上限 7 天，按工作时间折算也远在窗口内） */
export const SLA_TIER_SCAN_DAYS = 30;
const MAX_ACTIONS_PER_ORG = 500;
const MINUTE = 60_000;
const DAY = 86_400_000;
const OPEN_ACTION_STATUSES = ["open", "in_progress"];

export const SLA_TIER_LABELS: Record<SlaTier, string> = {
  unclaimed: "未回复提醒（负责人）",
  escalation: "升级（管理层）",
  overdue_draft: "超时 + 草稿状态（管理层）",
};

type SlaTierPolicy = Pick<SalesSlaPolicy, "unclaimedAlertMinutes" | "ownerEscalationMinutes" | "overdueDraftHours" | "businessHours">;

export function slaTierSourceKey(tier: SlaTier, orgId: string, actionId: string): string {
  return `${SLA_TIER_SOURCE_PREFIX}:${tier}:${orgId}:${actionId}`;
}

/** 已配置的档位（分钟） */
export function slaTierThresholds(sla: SlaTierPolicy): Array<{ tier: SlaTier; minutes: number }> {
  const out: Array<{ tier: SlaTier; minutes: number }> = [];
  if (sla.unclaimedAlertMinutes != null) out.push({ tier: "unclaimed", minutes: sla.unclaimedAlertMinutes });
  if (sla.ownerEscalationMinutes != null) out.push({ tier: "escalation", minutes: sla.ownerEscalationMinutes });
  if (sla.overdueDraftHours != null) out.push({ tier: "overdue_draft", minutes: Math.round(sla.overdueDraftHours * 60) });
  return out;
}

export interface SlaTierDue {
  tier: SlaTier;
  minutes: number;
  dueAt: Date;
}

/**
 * 纯函数：这条询盘此刻该发哪些档。已回复 → 不发；未到期 → 不发；错过超过 SLA_TIER_MAX_LATE_MS → 不补发；
 * 已被人认领（claimed）→ 不发「未认领」那一档。每档是否已发过由调用方用 sourceKey 判断（这里不记状态）。
 */
export function decideSlaTiers(input: { inboundAt: Date; responded: boolean; claimed?: boolean }, sla: SlaTierPolicy, now: Date): SlaTierDue[] {
  if (input.responded) return [];
  const out: SlaTierDue[] = [];
  for (const t of slaTierThresholds(sla)) {
    if (t.tier === "unclaimed" && input.claimed) continue;
    const dueAt = addSlaMinutes(input.inboundAt, t.minutes, sla.businessHours ?? null);
    const late = now.getTime() - dueAt.getTime();
    if (late >= 0 && late <= SLA_TIER_MAX_LATE_MS) out.push({ tier: t.tier, minutes: t.minutes, dueAt });
  }
  return out;
}

/** 询盘之后是否已有任何回复（三种来源任一，早于询盘超过容差的不算） */
export function hasResponseSince(inboundAt: Date, responses: Array<Date | null | undefined>): boolean {
  const floor = inboundAt.getTime() - RESPONSE_CLOCK_TOLERANCE_MS;
  return responses.some((d) => !!d && d.getTime() >= floor);
}

export function formatThreshold(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
}

function formatWait(minutes: number): string {
  if (minutes < 60) return `${Math.max(0, Math.floor(minutes))} 分钟`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} 小时`;
  return `${Math.floor(minutes / 1440)} 天`;
}

export interface DraftState {
  /** 待审批、未过期的询盘回复草稿的创建时刻；没有为 null */
  pendingDraftCreatedAt: Date | null;
  /** SalesAction.inputContext.fdeStatus */
  fdeStatus: string | null;
  /** SalesAction.inputContext.draftStatus（FDE 写入） */
  draftStatus: string | null;
}

/** 纯函数：第三档里「草稿在哪 / 为什么没有草稿」那一句 */
export function describeDraftState(s: DraftState, now: Date): { hasDraft: boolean; text: string } {
  if (s.pendingDraftCreatedAt) {
    return { hasDraft: true, text: `回复草稿已在审批中心等待批准（已等 ${formatWait((now.getTime() - s.pendingDraftCreatedAt.getTime()) / MINUTE)}）。` };
  }
  if (s.fdeStatus === "failed" || s.fdeStatus === "run_blocked") return { hasDraft: false, text: "没有回复草稿：AI 起草失败，需要人工直接回复。" };
  if (s.fdeStatus !== "completed") return { hasDraft: false, text: "没有回复草稿：AI 还没完成起草。" };
  switch (s.draftStatus) {
    case "out_of_range":
      return { hasDraft: false, text: "没有回复草稿：询盘产品属于企业不做的类目，需人工判断婉拒或转介。" };
    case "guardrail_blocked":
      return { hasDraft: false, text: "没有回复草稿：AI 草稿触发护栏（价格 / MOQ / 交期等承诺），未进审批中心，需人工撰写。" };
    case "no_email":
      return { hasDraft: false, text: "没有回复草稿：买家没有留邮箱，请用电话或 WhatsApp 联系。" };
    case "cancelled":
      return { hasDraft: false, text: "没有回复草稿：AI 起草被取消。" };
    case "approval_failed":
      return { hasDraft: false, text: "没有回复草稿：创建审批草稿失败，需要人工直接回复。" };
    case "created":
    case "reused":
      return { hasDraft: false, text: "回复草稿已被拒绝或已过期，审批中心里没有待批准的草稿。" };
    default:
      return { hasDraft: false, text: "审批中心里没有待批准的回复草稿。" };
  }
}

export interface SlaTierMessageInput {
  tier: SlaTier;
  minutes: number;
  basis: "business" | "wall_clock";
  buyer: BuyerLine;
  ownerName?: string | null;
  draft?: { hasDraft: boolean; text: string } | null;
  link: string;
}

/** 纯函数：站内通知 / 微信正文（不含买家邮箱、电话；不提供直接批准，回青砚看完草稿再批） */
export function formatSlaTierMessage(i: SlaTierMessageInput): { title: string; text: string } {
  const t = `${formatThreshold(i.minutes)}${i.basis === "business" ? "（工作时间）" : ""}`;
  const name = safeBuyerName(i.buyer.customerName);
  const lines = [buyerLine(i.buyer)];
  let title: string;
  if (i.tier === "unclaimed") {
    title = `询盘 ${t} 未回复：${name}`;
    // 草稿状态按实际情况说（没有草稿时不能让人去审批中心白找）
    if (i.draft?.hasDraft) lines.push(`请尽快处理：${i.draft.text}需人工批准后才会发给买家。`);
    else if (i.draft) lines.push(`请尽快处理。${i.draft.text}`);
    else lines.push("请尽快回复买家（如有回复草稿，需在审批中心人工批准后才会发出）。");
  } else if (i.tier === "escalation") {
    title = `询盘超 ${t} 无人回复（已升级）：${name}`;
    lines.push(`负责人：${(i.ownerName ?? "").trim() || "未指定"}。请安排人跟进。`);
  } else {
    title = `询盘超 ${t} 仍未回复：${name}`;
    lines.push(i.draft?.text ?? "审批中心里没有待批准的回复草稿。");
    lines.push("系统不会自动给买家发邮件。");
  }
  lines.push(`打开处理：${i.link}`);
  return { title: title.slice(0, 120), text: lines.join("\n") };
}

// ── 查询 + 发送 ───────────────────────────────────────────────

export interface TrackedInquiry {
  actionId: string;
  opportunityId: string;
  inboundAt: Date;
  /** 行动已被人认领（SalesAction.status = in_progress） */
  claimed: boolean;
  ownerUserId: string | null;
  buyer: BuyerLine;
  fdeStatus: string | null;
  draftStatus: string | null;
}

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/** 分级对象范围：不是展会速记卡、不是入驻测试询盘（与状态 / 阶段 / 是否已回复无关） */
function isTierEligibleInquiry(a: {
  inputContext: unknown;
  opportunity: { source: string | null; lostReason: string | null; customer: { tags: string | null } };
}): boolean {
  const o = a.opportunity;
  const source = o.source ?? strOrNull(rec(a.inputContext)?.source);
  if (source === TRADE_SHOW_SOURCE) return false;
  return !isOnboardingTestInquiry({ utmSource: utmSourceOf(a.inputContext), customerTags: o.customer.tags, lostReason: o.lostReason });
}

/**
 * 本组织被分级跟踪的询盘：开放的新询盘行动、商机开放、客户未归档、不是展会速记卡 / 测试询盘、询盘之后还没有回复。
 * 所有查询按 orgId 限定。
 */
export async function loadTrackedInquiries(orgId: string, now: Date): Promise<TrackedInquiry[]> {
  const since = new Date(now.getTime() - SLA_TIER_SCAN_DAYS * DAY);
  const actions = await db.salesAction.findMany({
    where: {
      orgId,
      employeeKey: FDE_EMPLOYEE_KEY,
      actionType: INBOUND_INQUIRY_ACTION_TYPE,
      status: { in: OPEN_ACTION_STATUSES },
      opportunityId: { not: null },
      createdAt: { gte: since, lte: now },
    },
    select: {
      id: true,
      createdAt: true,
      status: true,
      inputContext: true,
      assignedToId: true,
      opportunityId: true,
      opportunity: {
        select: {
          id: true,
          orgId: true,
          stage: true,
          source: true,
          lostReason: true,
          assignedToId: true,
          lastOutboundAt: true,
          score: true,
          scoreGrade: true,
          market: true,
          sourceTradeProspectId: true,
          customer: { select: { name: true, country: true, tags: true, archivedAt: true } },
        },
      },
    },
    // 最新的优先：超过上限时截掉的是最老的（它们的档位早已过了补发期限）
    orderBy: { createdAt: "desc" },
    take: MAX_ACTIONS_PER_ORG,
  });

  const candidates = actions.filter((a) => {
    const o = a.opportunity;
    if (!o || o.orgId !== orgId || !a.opportunityId) return false;
    if (!(OPEN_STAGES as readonly string[]).includes(o.stage)) return false;
    if (o.customer.archivedAt) return false;
    return isTierEligibleInquiry({ inputContext: a.inputContext, opportunity: o });
  });
  if (!candidates.length) return [];

  const oppIds = [...new Set(candidates.map((a) => a.opportunityId as string))];
  const earliest = new Date(Math.min(...candidates.map((a) => a.createdAt.getTime())) - RESPONSE_CLOCK_TOLERANCE_MS);
  const sourceProspectIds = candidates.map((a) => a.opportunity?.sourceTradeProspectId).filter((v): v is string => !!v);
  const [executedByOpp, prospects] = await Promise.all([
    loadExecutedInquiryReplyTimes(orgId, oppIds, earliest),
    db.tradeProspect.findMany({
      where: { orgId, OR: [{ convertedToSalesOpportunityId: { in: oppIds } }, ...(sourceProspectIds.length ? [{ id: { in: sourceProspectIds } }] : [])] },
      select: { id: true, convertedToSalesOpportunityId: true },
    }),
  ]);
  // 线索 → 商机：线索回填的链接，或商机记着的来源线索
  const oppsByProspect = new Map<string, Set<string>>();
  const link = (prospectId: string, oppId: string) => oppsByProspect.set(prospectId, new Set([...(oppsByProspect.get(prospectId) ?? []), oppId]));
  for (const p of prospects) if (p.convertedToSalesOpportunityId && oppIds.includes(p.convertedToSalesOpportunityId)) link(p.id, p.convertedToSalesOpportunityId);
  const prospectIdSet = new Set(prospects.map((p) => p.id));
  for (const a of candidates) {
    const sp = a.opportunity?.sourceTradeProspectId;
    if (sp && prospectIdSet.has(sp)) link(sp, a.opportunityId as string);
  }
  const lastTradeOutbound = new Map<string, Date>();
  if (oppsByProspect.size) {
    const rows = await db.tradeMessage.groupBy({
      by: ["prospectId"],
      where: { prospectId: { in: [...oppsByProspect.keys()] }, direction: "outbound", createdAt: { gte: earliest } },
      _max: { createdAt: true },
    });
    for (const r of rows) {
      const at = r._max.createdAt;
      if (!at) continue;
      for (const oid of oppsByProspect.get(r.prospectId) ?? []) {
        const cur = lastTradeOutbound.get(oid);
        if (!cur || at.getTime() > cur.getTime()) lastTradeOutbound.set(oid, at);
      }
    }
  }

  const out: TrackedInquiry[] = [];
  for (const a of candidates) {
    const o = a.opportunity!;
    const oid = a.opportunityId as string;
    const responded = hasResponseSince(a.createdAt, [o.lastOutboundAt, lastTradeOutbound.get(oid), ...(executedByOpp.get(oid) ?? [])]);
    if (responded) continue;
    const ctx = rec(a.inputContext);
    out.push({
      actionId: a.id,
      opportunityId: oid,
      inboundAt: a.createdAt,
      claimed: a.status === "in_progress",
      ownerUserId: o.assignedToId ?? a.assignedToId ?? null,
      buyer: { scoreGrade: o.scoreGrade, score: o.score, market: o.market ?? o.customer.country ?? null, source: o.source, customerName: o.customer.name },
      fdeStatus: strOrNull(ctx?.fdeStatus),
      draftStatus: strOrNull(ctx?.draftStatus),
    });
  }
  return out;
}

/**
 * 启用分级的组织里，给定商机中归分级负责的新询盘：商机 id → 新询盘行动的创建时刻。
 * 不论行动现在是否还开放、是否已回复、商机是否还在开放阶段（inquiry-sla 旧提醒据此跳过「这次询盘」的进线，
 * 回复 / 关闭之后也不会再为它补发旧提醒）。展会速记卡与入驻测试询盘不算（它们本就不进分级，旧提醒照常）。按 orgId 限定。
 */
export async function loadTierOwnedInquiryTimes(orgId: string, opportunityIds: readonly string[], since: Date): Promise<Map<string, Date[]>> {
  const out = new Map<string, Date[]>();
  const ids = [...new Set(opportunityIds)];
  if (!ids.length) return out;
  const actions = await db.salesAction.findMany({
    where: { orgId, employeeKey: FDE_EMPLOYEE_KEY, actionType: INBOUND_INQUIRY_ACTION_TYPE, opportunityId: { in: ids }, createdAt: { gte: since } },
    select: {
      createdAt: true,
      opportunityId: true,
      inputContext: true,
      opportunity: { select: { orgId: true, source: true, lostReason: true, customer: { select: { tags: true } } } },
    },
    take: MAX_ACTIONS_PER_ORG * 4,
  });
  for (const a of actions) {
    if (!a.opportunityId || !a.opportunity || a.opportunity.orgId !== orgId) continue;
    if (!isTierEligibleInquiry({ inputContext: a.inputContext, opportunity: a.opportunity })) continue;
    out.set(a.opportunityId, [...(out.get(a.opportunityId) ?? []), a.createdAt]);
  }
  return out;
}

export interface SlaTierOrgResult {
  orgId: string;
  enabled: boolean;
  tracked: number;
  /** 被分级跟踪（开放、未回复）的商机：inquiry-sla 旧提醒跳过与它们关联的外贸线索 */
  trackedOpportunityIds: string[];
  fired: Record<SlaTier, number>;
  /** 新写入的站内通知数 */
  notifications: number;
  /** 微信实际送达条数（没绑微信 / 静默时段 / 通道失败不算） */
  wechatDelivered: number;
}

const defaultPush: PushFn = async (userId, title, text) => {
  const { pushNotification } = await import("@/lib/messaging/push-service");
  return pushNotification(userId, title, text);
};

function isUniqueViolation(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { code?: unknown }).code === "P2002";
}

/** 一个组织跑一遍分级（未启用 → 只返回 enabled=false，不查询、不发送） */
export async function runSlaTiersForOrg(
  orgId: string,
  opts?: { now?: Date; policy?: RevenueSpinePolicy; push?: PushFn; origin?: string },
): Promise<SlaTierOrgResult> {
  const now = opts?.now ?? new Date();
  const policy = opts?.policy ?? (await loadRevenueSpinePolicy(orgId));
  const sla = policy.salesSla;
  const result: SlaTierOrgResult = {
    orgId,
    enabled: slaTiersEnabled(sla),
    tracked: 0,
    trackedOpportunityIds: [],
    fired: { unclaimed: 0, escalation: 0, overdue_draft: 0 },
    notifications: 0,
    wechatDelivered: 0,
  };
  if (!result.enabled) return result;

  const tracked = await loadTrackedInquiries(orgId, now);
  result.tracked = tracked.length;
  result.trackedOpportunityIds = [...new Set(tracked.map((t) => t.opportunityId))];
  if (!tracked.length) return result;

  const basis = sla.businessHours ? "business" : "wall_clock";
  const origin = (opts?.origin ?? resolveAppOrigin()).replace(/\/+$/, "");
  const push = opts?.push ?? defaultPush;

  // 收件人：按需加载一次
  let members: Set<string> | null = null;
  let orgOwner: string | null | undefined;
  let management: string[] | null = null;
  const activeMembers = async () =>
    (members ??= new Set((await db.organizationMember.findMany({ where: { orgId, status: "active" }, select: { userId: true } })).map((m) => m.userId)));
  const ownerOfOrg = async () => {
    if (orgOwner === undefined) orgOwner = (await db.organization.findUnique({ where: { id: orgId }, select: { ownerId: true } }))?.ownerId ?? null;
    return orgOwner;
  };
  const recipientsFor = async (tier: SlaTier, t: TrackedInquiry): Promise<string[]> => {
    if (tier === "unclaimed") {
      const active = await activeMembers();
      const owner = t.ownerUserId && active.has(t.ownerUserId) ? t.ownerUserId : await ownerOfOrg();
      return owner ? [owner] : [];
    }
    management ??= await managementOf(orgId);
    if (management.length) return [...new Set(management)];
    const owner = await ownerOfOrg();
    return owner ? [owner] : [];
  };

  for (const t of tracked) {
    const due = decideSlaTiers({ inboundAt: t.inboundAt, responded: false, claimed: t.claimed }, sla, now);
    for (const d of due) {
      const base = slaTierSourceKey(d.tier, orgId, t.actionId);
      const already = await db.notification.findUnique({ where: { sourceKey: base }, select: { id: true } });
      if (already) continue;
      const recipients = await recipientsFor(d.tier, t);
      if (!recipients.length) continue;

      let ownerName: string | null = null;
      if (d.tier === "escalation" && t.ownerUserId) {
        ownerName = (await db.user.findUnique({ where: { id: t.ownerUserId }, select: { name: true } }))?.name ?? null;
      }
      // 第一档与第三档都按实际草稿状态说明（第一档到期时 FDE 可能还没跑完、失败、或买家没留邮箱）
      let draft: { hasDraft: boolean; text: string } | null = null;
      if (d.tier === "unclaimed" || d.tier === "overdue_draft") {
        const pending = await db.pendingAction.findFirst({
          where: { orgId, type: INQUIRY_REPLY_ACTION_TYPE, status: "pending", expiresAt: { gt: now }, payload: { path: ["opportunityId"], equals: t.opportunityId } },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        });
        draft = describeDraftState({ pendingDraftCreatedAt: pending?.createdAt ?? null, fdeStatus: t.fdeStatus, draftStatus: t.draftStatus }, now);
      }
      const link = d.tier === "overdue_draft" && draft?.hasDraft ? `${origin}/revenue/today#approvals` : `${origin}/revenue/${t.opportunityId}`;
      const { title, text } = formatSlaTierMessage({ tier: d.tier, minutes: d.minutes, basis, buyer: t.buyer, ownerName, draft, link });

      let claimed = false;
      for (let i = 0; i < recipients.length; i++) {
        const userId = recipients[i];
        try {
          await db.notification.create({
            data: {
              userId,
              orgId,
              type: "followup",
              category: "followup",
              title,
              summary: text,
              entityType: "revenue_opportunity",
              entityId: t.opportunityId,
              priority: d.tier === "unclaimed" ? "high" : "urgent",
              status: "unread",
              // 第一位收件人的行用不带 userId 的键占位：并发的另一次 cron 撞唯一键即放弃，这一档只发一次
              sourceKey: i === 0 ? base : `${base}:${userId}`,
              metadata: JSON.stringify({
                opportunityId: t.opportunityId,
                salesActionId: t.actionId,
                sla: d.tier,
                thresholdMinutes: d.minutes,
                basis,
                dueAt: d.dueAt.toISOString(),
                hasDraft: draft?.hasDraft ?? null,
              }),
            },
            select: { id: true },
          });
        } catch (e) {
          if (isUniqueViolation(e)) {
            if (i === 0) break;
            continue;
          }
          throw e;
        }
        if (i === 0) claimed = true;
        result.notifications++;
        const r = await push(userId, title, text).catch((e) => {
          console.warn("[sla-tiers] 微信推送失败：", e instanceof Error ? e.message : e);
          return null;
        });
        if (pushOutcomeOf(r) === "delivered") result.wechatDelivered++;
      }
      if (claimed) result.fired[d.tier]++;
    }
  }
  return result;
}

/**
 * 近 30 天有新询盘行动的组织（不论行动状态）；是否启用分级由各组织策略决定。
 * 不只看开放行动：启用分级的组织即使询盘都已回复 / 关闭，也要进 trackedByOrg，旧提醒才知道这些询盘归分级、不再补发。
 */
export async function listSlaTierCandidateOrgIds(now: Date): Promise<string[]> {
  const rows = await db.salesAction.groupBy({
    by: ["orgId"],
    where: {
      employeeKey: FDE_EMPLOYEE_KEY,
      actionType: INBOUND_INQUIRY_ACTION_TYPE,
      createdAt: { gte: new Date(now.getTime() - SLA_TIER_SCAN_DAYS * DAY) },
    },
  });
  return rows.map((r) => r.orgId);
}

export interface RevenueSlaTierOutcome {
  orgsScanned: number;
  orgsEnabled: number;
  tracked: number;
  fired: Record<SlaTier, number>;
  notifications: number;
  wechatDelivered: number;
  failedOrgs: number;
  /**
   * 启用分级（且本轮没失败）的组织 → 此刻被跟踪的商机（可能为空集）。
   * inquiry-sla 旧提醒只对这些组织做跳过判断：跟踪中的商机 + 归分级负责的询盘进线（loadTierOwnedInquiryTimes）
   */
  trackedByOrg: Map<string, Set<string>>;
}

/** cron 入口：逐个组织跑分级；一个组织失败不影响其它组织（失败组织不进 trackedByOrg → 旧提醒照常兜底） */
export async function runRevenueSlaTiers(opts?: { now?: Date; push?: PushFn; origin?: string }): Promise<RevenueSlaTierOutcome> {
  const now = opts?.now ?? new Date();
  const outcome: RevenueSlaTierOutcome = {
    orgsScanned: 0,
    orgsEnabled: 0,
    tracked: 0,
    fired: { unclaimed: 0, escalation: 0, overdue_draft: 0 },
    notifications: 0,
    wechatDelivered: 0,
    failedOrgs: 0,
    trackedByOrg: new Map(),
  };
  const orgIds = await listSlaTierCandidateOrgIds(now);
  outcome.orgsScanned = orgIds.length;
  for (const orgId of orgIds) {
    try {
      const r = await runSlaTiersForOrg(orgId, { now, push: opts?.push, origin: opts?.origin });
      if (!r.enabled) continue;
      outcome.orgsEnabled++;
      outcome.tracked += r.tracked;
      outcome.notifications += r.notifications;
      outcome.wechatDelivered += r.wechatDelivered;
      for (const tier of SLA_TIERS) outcome.fired[tier] += r.fired[tier];
      outcome.trackedByOrg.set(orgId, new Set(r.trackedOpportunityIds));
    } catch (err) {
      outcome.failedOrgs++;
      console.error(`[sla-tiers] org ${orgId} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return outcome;
}
