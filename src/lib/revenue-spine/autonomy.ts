/**
 * Revenue Spine — 内部自治（B-5，openspec change fde-internal-autonomy）
 *
 * 外部动作永远走审批；内部动作按 policy 查表自动做。本模块只做一件事：
 * policy.autonomy.autoStale 开启时，把"超过 followUp.staleAfterDays 天无互动、买家未来信、没有在途审批"的开放商机
 * 经 transitionOpportunity（source = system）转为 stale，审计带 policy 键名，并按负责人汇总发站内通知。
 * 不建审批、不起草、不发送；由既有 /api/cron/revenue-spine 调用，不新增定时任务。
 *
 * 判定是纯函数；查询条件是导出的构造函数；执行器依赖可注入。
 */

import { isStale } from "./next-action";
import { OPEN_STAGES, OpportunityStage, isOpenStage } from "./opportunity-stage";
import type { RevenueSpinePolicy } from "./policy";
import type { TransitionInput, TransitionResult } from "./transition";

const DAY_MS = 86_400_000;

export const AUTO_STALE_POLICY_KEY = "autonomy.autoStale";
/** FDE 按"不做类目 → 婉拒"判不合格时，流转审计里的 policy 键名 */
export const DECLINE_POLICY_KEY = "businessProfile.excludedCategoryAction";
/** 每个组织每轮最多流转的商机数（剩余下一轮继续） */
export const AUTO_STALE_BATCH = 200;
/** 在途审批：待审批 + 已批准未执行 */
export const IN_FLIGHT_APPROVAL_STATUSES = ["pending", "approved"] as const;
/** 每个组织读取在途审批的上限（在途审批通常很少） */
export const IN_FLIGHT_SCAN_LIMIT = 2000;
/** 用户通知偏好里既有的类型 */
export const AUTO_STALE_NOTIFY_TYPE = "followup";
const NOTIFY_TITLE_SAMPLES = 3;
const NOTIFY_ID_LIMIT = 50;

export function staleCutoff(policy: RevenueSpinePolicy, now: Date): Date {
  return new Date(now.getTime() - policy.followUp.staleAfterDays * DAY_MS);
}

// ── 查询条件（纯函数） ────────────────────────────────────

/** 候选：开放阶段、客户未归档、最后互动（无则创建时间）早于 cutoff、买家最后来信为空或早于 cutoff */
export function autoStaleCandidateWhere(orgId: string, cutoff: Date) {
  return {
    orgId,
    stage: { in: [...OPEN_STAGES] },
    customer: { archivedAt: null },
    AND: [
      { OR: [{ lastInteractionAt: { lt: cutoff } }, { lastInteractionAt: null, createdAt: { lt: cutoff } }] },
      { OR: [{ lastCustomerReplyAt: null }, { lastCustomerReplyAt: { lt: cutoff } }] },
    ],
  };
}

export function inFlightApprovalWhere(orgId: string) {
  return { orgId, status: { in: [...IN_FLIGHT_APPROVAL_STATUSES] } };
}

/** 审批载荷里的商机 id（payload.opportunityId 或 payload.metadata.opportunityId；与工作量面板同一取法） */
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
  lastInteractionAt: Date | null;
  lastCustomerReplyAt: Date | null;
  assignedToId: string | null;
  createdById: string;
}

export type AutoStaleSkipReason = "disabled" | "not_open" | "recent_interaction" | "recent_buyer_reply" | "in_flight_approval";

export type AutoStaleDecision = { stale: true } | { stale: false; reason: AutoStaleSkipReason };

export function decideAutoStale(
  opp: Pick<AutoStaleCandidate, "id" | "stage" | "createdAt" | "lastInteractionAt" | "lastCustomerReplyAt">,
  ctx: { policy: RevenueSpinePolicy; now: Date; inFlight: ReadonlySet<string> },
): AutoStaleDecision {
  if (!ctx.policy.autonomy.autoStale) return { stale: false, reason: "disabled" };
  if (!isOpenStage(opp.stage)) return { stale: false, reason: "not_open" };
  if (!isStale(opp, ctx.policy, ctx.now)) return { stale: false, reason: "recent_interaction" };
  const cutoff = staleCutoff(ctx.policy, ctx.now);
  if (opp.lastCustomerReplyAt && opp.lastCustomerReplyAt.getTime() >= cutoff.getTime()) return { stale: false, reason: "recent_buyer_reply" };
  if (ctx.inFlight.has(opp.id)) return { stale: false, reason: "in_flight_approval" };
  return { stale: true };
}

export function autoStaleReason(policy: RevenueSpinePolicy): string {
  return `超过 ${policy.followUp.staleAfterDays} 天无互动、无在途审批、买家未来信（自动搁置）`;
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

/** 一个负责人一轮一条：只有一个商机时关联到该商机（点击进商机详情） */
export function buildAutoStaleNotification(
  orgId: string,
  opps: ReadonlyArray<Pick<AutoStaleCandidate, "id" | "title">>,
  ctx: { policy: RevenueSpinePolicy; now: Date },
): AutoStaleNotification {
  const titles = opps.slice(0, NOTIFY_TITLE_SAMPLES).map((o) => o.title);
  const more = opps.length > NOTIFY_TITLE_SAMPLES ? ` 等 ${opps.length} 个` : "";
  return {
    type: AUTO_STALE_NOTIFY_TYPE,
    title: `已自动搁置 ${opps.length} 个长期无互动商机`,
    summary: `${titles.join("；")}${more}。超过 ${ctx.policy.followUp.staleAfterDays} 天无互动、买家未来信、无在途审批；需要时可在商机详情激活。`.slice(0, 280),
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
  /** 按 (lastInteractionAt ?? createdAt) 升序，最多 limit 行 */
  findCandidates(orgId: string, cutoff: Date, limit: number): Promise<AutoStaleCandidate[]>;
  /** 本组织在途审批涉及的商机 id */
  inFlightOpportunityIds(orgId: string): Promise<string[]>;
  transition(input: TransitionInput): Promise<TransitionResult>;
  /** 返回新建条数 */
  notify(userIds: string[], notification: AutoStaleNotification): Promise<number>;
}

export interface AutoStaleResult {
  enabled: boolean;
  candidates: number;
  staled: number;
  failed: number;
  skipped: Partial<Record<AutoStaleSkipReason, number>>;
  notified: number;
  notifyFailed: number;
  /** 候选超过上限或维护预算用完，剩余下一轮继续 */
  truncated: boolean;
}

export async function runAutoStale(
  orgId: string,
  ctx: { policy: RevenueSpinePolicy; now: Date; shouldStop?: () => boolean },
  deps: AutoStaleDeps = defaultAutoStaleDeps(),
): Promise<AutoStaleResult> {
  const out: AutoStaleResult = { enabled: ctx.policy.autonomy.autoStale, candidates: 0, staled: 0, failed: 0, skipped: {}, notified: 0, notifyFailed: 0, truncated: false };
  if (!out.enabled) return out;

  const cutoff = staleCutoff(ctx.policy, ctx.now);
  const rows = await deps.findCandidates(orgId, cutoff, AUTO_STALE_BATCH + 1);
  out.truncated = rows.length > AUTO_STALE_BATCH;
  const candidates = rows.slice(0, AUTO_STALE_BATCH);
  out.candidates = candidates.length;
  if (candidates.length === 0) return out;

  const inFlight = new Set(await deps.inFlightOpportunityIds(orgId));
  const reason = autoStaleReason(ctx.policy);
  const staled: AutoStaleCandidate[] = [];
  for (const opp of candidates) {
    if (ctx.shouldStop?.()) {
      out.truncated = true;
      break;
    }
    const decision = decideAutoStale(opp, { policy: ctx.policy, now: ctx.now, inFlight });
    if (!decision.stale) {
      out.skipped[decision.reason] = (out.skipped[decision.reason] ?? 0) + 1;
      continue;
    }
    try {
      const r = await deps.transition({
        orgId,
        opportunityId: opp.id,
        to: OpportunityStage.STALE,
        actorUserId: null,
        source: "system",
        reason,
        policyKey: AUTO_STALE_POLICY_KEY,
        policy: ctx.policy,
        now: ctx.now,
      });
      if (r.ok) staled.push(opp);
      else out.failed += 1;
    } catch {
      out.failed += 1;
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

export function defaultAutoStaleDeps(): AutoStaleDeps {
  return {
    findCandidates: async (orgId, cutoff, limit) => {
      const { db } = await import("@/lib/db");
      return db.salesOpportunity.findMany({
        where: autoStaleCandidateWhere(orgId, cutoff),
        select: {
          id: true,
          title: true,
          stage: true,
          createdAt: true,
          lastInteractionAt: true,
          lastCustomerReplyAt: true,
          assignedToId: true,
          createdById: true,
        },
        orderBy: [{ lastInteractionAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }, { id: "asc" }],
        take: limit,
      });
    },

    inFlightOpportunityIds: async (orgId) => {
      const { db } = await import("@/lib/db");
      const rows = await db.pendingAction.findMany({
        where: inFlightApprovalWhere(orgId),
        select: { payload: true },
        take: IN_FLIGHT_SCAN_LIMIT,
      });
      return rows.map((r) => opportunityIdOfApprovalPayload(r.payload)).filter((id): id is string => id !== null);
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
