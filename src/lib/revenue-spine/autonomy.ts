/**
 * Revenue Spine — 内部自治（B-5，openspec change fde-internal-autonomy）
 *
 * 外部动作永远走审批；内部动作按 policy 查表自动做。本模块只做一件事：
 * policy.autonomy.autoStale 开启时，把"超过 followUp.staleAfterDays 天没有任何活动、买家未来信也不在等我们回复、
 * 没有在途审批"的开放商机经 transitionOpportunity（source = system）转为 stale，审计带 policy 键名，按负责人汇总站内通知。
 * 不建审批、不起草、不发送；由既有 /api/cron/revenue-spine 调用，不新增定时任务。
 *
 * 只处理 Revenue Spine 维护的商机（stageChangedAt 非空：intake 建单与每次 transition 都会写）。
 * Sunny 窗饰车道的商机也用 quoted / negotiation 等阶段名，但从不写 stageChangedAt / lastInteractionAt，不在候选里。
 *
 * 判定是纯函数；查询条件是导出的构造函数；执行器依赖可注入。
 */

import { OPEN_STAGES, OpportunityStage, isOpenStage } from "./opportunity-stage";
import type { RevenueSpinePolicy } from "./policy";
import type { TransitionInput, TransitionResult } from "./transition";

const DAY_MS = 86_400_000;

export const AUTO_STALE_POLICY_KEY = "autonomy.autoStale";
/** FDE 按"不做类目 → 婉拒"判不合格时，流转审计里的 policy 键名 */
export const DECLINE_POLICY_KEY = "businessProfile.excludedCategoryAction";
/** 每个组织每轮最多流转的商机数（剩余下一轮继续） */
export const AUTO_STALE_BATCH = 200;
/** 每个组织每轮最多读取的候选数（被跳过的不占流转名额，读多一些避免最老的一批卡住后面的） */
export const AUTO_STALE_SCAN = 500;
/** 在途审批：待审批 + 已批准未执行 */
export const IN_FLIGHT_APPROVAL_STATUSES = ["pending", "approved"] as const;
/** 每个组织读取在途审批的上限；读满即本轮不搁置（fail closed） */
export const IN_FLIGHT_SCAN_LIMIT = 2000;
/** 用户通知偏好里既有的类型 */
export const AUTO_STALE_NOTIFY_TYPE = "followup";
/** 自动搁置的最低天数：不低于 14 天，也不早于最后一次无回复跟进之后 7 天 */
export const AUTO_STALE_MIN_DAYS = 14;
export const AUTO_STALE_FOLLOW_UP_GAP_DAYS = 7;
const NOTIFY_TITLE_SAMPLES = 3;
const NOTIFY_ID_LIMIT = 50;

/** 开关生效所需的最低 staleAfterDays（阈值过低时视为关闭，避免误把刚进来的询盘或跟进中的商机搁置） */
export function autoStaleMinDays(policy: RevenueSpinePolicy): number {
  const lastFollowUp = Math.max(0, ...policy.followUp.noReplyFollowUpDays);
  return Math.max(AUTO_STALE_MIN_DAYS, lastFollowUp + AUTO_STALE_FOLLOW_UP_GAP_DAYS);
}

export type AutoStaleDisabledReason = "off" | "threshold_too_low";

/** 开关是否生效：null = 生效 */
export function autoStaleDisabledReason(policy: RevenueSpinePolicy): AutoStaleDisabledReason | null {
  if (!policy.autonomy.autoStale) return "off";
  const days = policy.followUp.staleAfterDays;
  if (!Number.isFinite(days) || days < autoStaleMinDays(policy)) return "threshold_too_low";
  return null;
}

export function staleCutoff(policy: RevenueSpinePolicy, now: Date): Date {
  return new Date(now.getTime() - policy.followUp.staleAfterDays * DAY_MS);
}

// ── 查询条件（纯函数） ────────────────────────────────────

/**
 * 候选：Revenue Spine 维护（stageChangedAt 非空）、开放阶段、客户未归档；
 * 阶段变更、最后互动、创建时间都早于 cutoff；买家最后来信为空或早于 cutoff。
 * 最新互动记录（CustomerInteraction）另查，由 decideAutoStale 复核。
 */
export function autoStaleCandidateWhere(orgId: string, cutoff: Date) {
  return {
    orgId,
    stage: { in: [...OPEN_STAGES] },
    customer: { archivedAt: null },
    stageChangedAt: { not: null, lt: cutoff },
    createdAt: { lt: cutoff },
    AND: [
      { OR: [{ lastInteractionAt: null }, { lastInteractionAt: { lt: cutoff } }] },
      { OR: [{ lastCustomerReplyAt: null }, { lastCustomerReplyAt: { lt: cutoff } }] },
    ],
  };
}

export function inFlightApprovalWhere(orgId: string) {
  return { orgId, status: { in: [...IN_FLIGHT_APPROVAL_STATUSES] } };
}

export function latestInteractionWhere(orgId: string, opportunityIds: string[]) {
  return { orgId, opportunityId: { in: opportunityIds } };
}

export function quoteOpportunityWhere(orgId: string, quoteIds: string[]) {
  return { orgId, id: { in: quoteIds }, opportunityId: { not: null } };
}

const OPPORTUNITY_TARGETS: ReadonlySet<string> = new Set(["OPPORTUNITY", "SALES_OPPORTUNITY", "REVENUE_OPPORTUNITY"]);
const QUOTE_TARGETS: ReadonlySet<string> = new Set(["QUOTE", "SALES_QUOTE"]);

/**
 * 审批载荷里指向的商机与报价：
 * - opportunityId / metadata.opportunityId（FDE 询盘回复与跟进草稿；与工作量面板同一取法）；
 * - quoteId / metadata.quoteId（报价让利审批等，报价再映射到商机）；
 * - targetType + targetId、resourceType + resourceId（载荷或 metadata 里；Grader 内部备注等）。
 */
export function approvalRefsOfPayload(payload: unknown): { opportunityIds: string[]; quoteIds: string[] } {
  const rec = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const opportunityIds = new Set<string>();
  const quoteIds = new Set<string>();
  const p = rec(payload);
  for (const bag of [p, rec(p?.metadata)]) {
    if (!bag) continue;
    const opp = str(bag.opportunityId);
    if (opp) opportunityIds.add(opp);
    const quote = str(bag.quoteId);
    if (quote) quoteIds.add(quote);
    for (const [typeKey, idKey] of [
      ["targetType", "targetId"],
      ["resourceType", "resourceId"],
    ] as const) {
      const type = str(bag[typeKey])?.toUpperCase();
      const id = str(bag[idKey]);
      if (!type || !id) continue;
      if (OPPORTUNITY_TARGETS.has(type)) opportunityIds.add(id);
      if (QUOTE_TARGETS.has(type)) quoteIds.add(id);
    }
  }
  return { opportunityIds: [...opportunityIds], quoteIds: [...quoteIds] };
}

/** 只取 opportunityId（兼容旧调用；与工作量面板 opportunityIdOfPayload 同口径） */
export function opportunityIdOfApprovalPayload(payload: unknown): string | null {
  const rec = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
  const p = rec(payload);
  const id = p?.opportunityId ?? rec(p?.metadata)?.opportunityId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

// ── 判定（纯函数） ────────────────────────────────────────

export interface AutoStaleCandidate {
  id: string;
  title: string;
  stage: string;
  createdAt: Date;
  stageChangedAt: Date | null;
  lastInteractionAt: Date | null;
  lastCustomerReplyAt: Date | null;
  lastOutboundAt: Date | null;
  assignedToId: string | null;
  createdById: string;
}

export type AutoStaleSkipReason =
  | "disabled"
  | "not_open"
  | "not_revenue_spine"
  | "recent_activity"
  | "recent_buyer_reply"
  | "awaiting_our_reply"
  | "in_flight_approval"
  | "gone";

export type AutoStaleDecision = { stale: true; lastActivityAt: Date } | { stale: false; reason: AutoStaleSkipReason };

/** 最后活动时间：最后互动、阶段变更、最新互动记录三者取最晚；都没有时取创建时间 */
export function lastActivityAt(
  opp: Pick<AutoStaleCandidate, "createdAt" | "stageChangedAt" | "lastInteractionAt">,
  latestInteractionAt: Date | null,
): Date {
  const times = [opp.lastInteractionAt, opp.stageChangedAt, latestInteractionAt].filter((d): d is Date => d instanceof Date);
  return times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : opp.createdAt;
}

export function decideAutoStale(
  opp: Omit<AutoStaleCandidate, "title" | "assignedToId" | "createdById">,
  ctx: { policy: RevenueSpinePolicy; now: Date; inFlight: ReadonlySet<string>; latestInteractionAt?: Date | null },
): AutoStaleDecision {
  if (autoStaleDisabledReason(ctx.policy)) return { stale: false, reason: "disabled" };
  if (!isOpenStage(opp.stage)) return { stale: false, reason: "not_open" };
  if (!opp.stageChangedAt) return { stale: false, reason: "not_revenue_spine" };
  const cutoff = staleCutoff(ctx.policy, ctx.now).getTime();
  const activity = lastActivityAt(opp, ctx.latestInteractionAt ?? null);
  if (activity.getTime() >= cutoff) return { stale: false, reason: "recent_activity" };
  const reply = opp.lastCustomerReplyAt;
  if (reply && reply.getTime() >= cutoff) return { stale: false, reason: "recent_buyer_reply" };
  // 买家来信后我们还没回（含从未回复的首封询盘）：该回复或关闭，不自动搁置
  if (reply && (!opp.lastOutboundAt || reply.getTime() > opp.lastOutboundAt.getTime())) return { stale: false, reason: "awaiting_our_reply" };
  if (ctx.inFlight.has(opp.id)) return { stale: false, reason: "in_flight_approval" };
  return { stale: true, lastActivityAt: activity };
}

export function autoStaleReason(policy: RevenueSpinePolicy): string {
  return `超过 ${policy.followUp.staleAfterDays} 天无活动、无在途审批、买家未来信（自动搁置）`;
}

/** 商机标题可能是"产品 — 邮箱 / 电话"（intake 没有公司名与姓名时）：通知里遮盖邮箱与电话 */
export function maskContactInTitle(title: string): string {
  return title
    .replace(/[^\s@<>()"'，,;；]+@[^\s@<>()"'，,;；]+\.[A-Za-z]{2,}/g, "[邮箱]")
    // 至少 8 位数字才算电话（数量区间如 500-1000 不算）
    .replace(/\+?\d[\d\s().\-]{5,}\d/g, (m) => ((m.match(/\d/g) ?? []).length >= 8 ? "[电话]" : m));
}

export interface AutoStaleNotification {
  type: string;
  title: string;
  summary: string;
  orgId: string;
  entityType?: string;
  entityId?: string;
  priority: string;
  metadata: Record<string, unknown>;
  sourceKeyPrefix: string;
}

/** 一个负责人一轮一条：只有一个商机时关联到该商机（通知中心点击进商机详情） */
export function buildAutoStaleNotification(
  orgId: string,
  opps: ReadonlyArray<Pick<AutoStaleCandidate, "id" | "title">>,
  ctx: { policy: RevenueSpinePolicy; now: Date },
): AutoStaleNotification {
  const titles = opps.slice(0, NOTIFY_TITLE_SAMPLES).map((o) => maskContactInTitle(o.title));
  const more = opps.length > NOTIFY_TITLE_SAMPLES ? ` 等 ${opps.length} 个` : "";
  return {
    type: AUTO_STALE_NOTIFY_TYPE,
    title: `已自动搁置 ${opps.length} 个长期无互动商机`,
    summary: `${titles.join("；")}${more}。超过 ${ctx.policy.followUp.staleAfterDays} 天无活动、买家未来信、无在途审批；需要时可在商机详情激活。`.slice(0, 280),
    orgId,
    ...(opps.length === 1 ? { entityType: "revenue_opportunity", entityId: opps[0].id } : {}),
    priority: "medium",
    metadata: {
      policyKey: AUTO_STALE_POLICY_KEY,
      count: opps.length,
      opportunityIds: opps.slice(0, NOTIFY_ID_LIMIT).map((o) => o.id),
    },
    sourceKeyPrefix: `revenue-auto-stale:${orgId}:${ctx.now.toISOString()}`,
  };
}

// ── 执行器 ────────────────────────────────────────────────

export interface AutoStaleDeps {
  /** 按 stageChangedAt 升序，最多 limit 行 */
  findCandidates(orgId: string, cutoff: Date, limit: number): Promise<AutoStaleCandidate[]>;
  /** 每个商机最新一条互动记录的时间（含不经 Revenue Spine 写入的互动） */
  latestInteractionAt(orgId: string, opportunityIds: string[]): Promise<Map<string, Date>>;
  /** 在途审批涉及的商机 id；读满上限时 truncated = true */
  inFlightOpportunityIds(orgId: string): Promise<{ ids: string[]; truncated: boolean }>;
  /** 流转前重读一次（并发：循环期间刚到的来信或流转） */
  reload(orgId: string, opportunityId: string): Promise<AutoStaleCandidate | null>;
  transition(input: TransitionInput): Promise<TransitionResult>;
  /** 返回新建条数 */
  notify(userIds: string[], notification: AutoStaleNotification): Promise<number>;
}

export interface AutoStaleResult {
  enabled: boolean;
  disabledReason: AutoStaleDisabledReason | "in_flight_scan_truncated" | null;
  candidates: number;
  staled: number;
  failed: number;
  skipped: Partial<Record<AutoStaleSkipReason, number>>;
  notified: number;
  notifyFailed: number;
  /** 流转数达到上限或维护预算用完，剩余下一轮继续 */
  truncated: boolean;
}

export async function runAutoStale(
  orgId: string,
  ctx: { policy: RevenueSpinePolicy; now: Date; shouldStop?: () => boolean },
  deps: AutoStaleDeps = defaultAutoStaleDeps(),
): Promise<AutoStaleResult> {
  const disabledReason = autoStaleDisabledReason(ctx.policy);
  const out: AutoStaleResult = {
    enabled: disabledReason === null,
    disabledReason,
    candidates: 0,
    staled: 0,
    failed: 0,
    skipped: {},
    notified: 0,
    notifyFailed: 0,
    truncated: false,
  };
  if (disabledReason) return out;

  const cutoff = staleCutoff(ctx.policy, ctx.now);
  const candidates = await deps.findCandidates(orgId, cutoff, AUTO_STALE_SCAN);
  out.candidates = candidates.length;
  if (candidates.length === 0) return out;

  const inFlight = await deps.inFlightOpportunityIds(orgId);
  if (inFlight.truncated) {
    // 在途审批读不全就判断不了"有没有人在处理"：本轮不搁置
    out.enabled = false;
    out.disabledReason = "in_flight_scan_truncated";
    return out;
  }
  const inFlightSet = new Set(inFlight.ids);
  const latest = await deps.latestInteractionAt(orgId, candidates.map((c) => c.id));
  const reason = autoStaleReason(ctx.policy);
  const skip = (r: AutoStaleSkipReason) => {
    out.skipped[r] = (out.skipped[r] ?? 0) + 1;
  };
  const staled: AutoStaleCandidate[] = [];
  for (const candidate of candidates) {
    if (staled.length + out.failed >= AUTO_STALE_BATCH || ctx.shouldStop?.()) {
      out.truncated = true;
      break;
    }
    const dctx = { policy: ctx.policy, now: ctx.now, inFlight: inFlightSet, latestInteractionAt: latest.get(candidate.id) ?? null };
    const first = decideAutoStale(candidate, dctx);
    if (!first.stale) {
      skip(first.reason);
      continue;
    }
    try {
      const fresh = await deps.reload(orgId, candidate.id);
      if (!fresh) {
        skip("gone");
        continue;
      }
      const again = decideAutoStale(fresh, dctx);
      if (!again.stale) {
        skip(again.reason);
        continue;
      }
      const r = await deps.transition({
        orgId,
        opportunityId: fresh.id,
        to: OpportunityStage.STALE,
        actorUserId: null,
        source: "system",
        reason,
        policyKey: AUTO_STALE_POLICY_KEY,
        policy: ctx.policy,
        now: ctx.now,
      });
      if (r.ok) staled.push(fresh);
      else out.failed += 1;
    } catch {
      // transitionOpportunity 先写阶段、后重算下一步：后半段抛错时阶段其实已经变了，照样通知负责人
      const after = await deps.reload(orgId, candidate.id).catch(() => null);
      if (after?.stage === OpportunityStage.STALE) staled.push(after);
      else out.failed += 1;
    }
  }
  out.staled = staled.length;

  // 按负责人（无负责人记创建人）汇总通知；通知失败不回滚流转
  const byOwner = new Map<string, AutoStaleCandidate[]>();
  for (const o of staled) {
    const owner = o.assignedToId ?? o.createdById;
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), o]);
  }
  for (const [owner, opps] of byOwner) {
    try {
      out.notified += await deps.notify([owner], buildAutoStaleNotification(orgId, opps, ctx));
    } catch {
      out.notifyFailed += 1;
    }
  }
  return out;
}

const CANDIDATE_SELECT = {
  id: true,
  title: true,
  stage: true,
  createdAt: true,
  stageChangedAt: true,
  lastInteractionAt: true,
  lastCustomerReplyAt: true,
  lastOutboundAt: true,
  assignedToId: true,
  createdById: true,
} as const;

export function defaultAutoStaleDeps(): AutoStaleDeps {
  return {
    findCandidates: async (orgId, cutoff, limit) => {
      const { db } = await import("@/lib/db");
      return db.salesOpportunity.findMany({
        where: autoStaleCandidateWhere(orgId, cutoff),
        select: CANDIDATE_SELECT,
        orderBy: [{ stageChangedAt: "asc" }, { id: "asc" }],
        take: limit,
      });
    },

    latestInteractionAt: async (orgId, opportunityIds) => {
      const { db } = await import("@/lib/db");
      const groups = await db.customerInteraction.groupBy({
        by: ["opportunityId"],
        where: latestInteractionWhere(orgId, opportunityIds),
        _max: { createdAt: true },
      });
      const out = new Map<string, Date>();
      for (const g of groups) if (g.opportunityId && g._max.createdAt) out.set(g.opportunityId, g._max.createdAt);
      return out;
    },

    inFlightOpportunityIds: async (orgId) => {
      const { db } = await import("@/lib/db");
      const rows = await db.pendingAction.findMany({
        where: inFlightApprovalWhere(orgId),
        select: { payload: true },
        orderBy: { createdAt: "desc" },
        take: IN_FLIGHT_SCAN_LIMIT + 1,
      });
      if (rows.length > IN_FLIGHT_SCAN_LIMIT) return { ids: [], truncated: true };
      const opportunityIds = new Set<string>();
      const quoteIds = new Set<string>();
      for (const r of rows) {
        const refs = approvalRefsOfPayload(r.payload);
        refs.opportunityIds.forEach((id) => opportunityIds.add(id));
        refs.quoteIds.forEach((id) => quoteIds.add(id));
      }
      if (quoteIds.size) {
        const quotes = await db.salesQuote.findMany({ where: quoteOpportunityWhere(orgId, [...quoteIds]), select: { opportunityId: true } });
        for (const q of quotes) if (q.opportunityId) opportunityIds.add(q.opportunityId);
      }
      return { ids: [...opportunityIds], truncated: false };
    },

    reload: async (orgId, opportunityId) => {
      const { db } = await import("@/lib/db");
      return db.salesOpportunity.findFirst({ where: { id: opportunityId, orgId, customer: { archivedAt: null } }, select: CANDIDATE_SELECT });
    },

    transition: async (input) => {
      const { transitionOpportunity } = await import("./transition");
      return transitionOpportunity(input);
    },

    notify: async (userIds, notification) => {
      const { createNotificationsForUsers } = await import("@/lib/notifications/create");
      return createNotificationsForUsers(userIds, notification);
    },
  };
}

// ── dogfood 开启计划（scripts/seed-revenue-autonomy.ts） ────

/** 现有 policy 覆盖 → 开启 autoStale 后的覆盖；已开启返回 null（不重复发布）。其余字段原样保留 */
export function planAutonomyEnable(current: unknown): Record<string, unknown> | null {
  const cur = current && typeof current === "object" && !Array.isArray(current) ? (current as Record<string, unknown>) : {};
  const autonomy = cur.autonomy && typeof cur.autonomy === "object" && !Array.isArray(cur.autonomy) ? (cur.autonomy as Record<string, unknown>) : {};
  if (autonomy.autoStale === true) return null;
  return { ...cur, autonomy: { ...autonomy, autoStale: true } };
}
