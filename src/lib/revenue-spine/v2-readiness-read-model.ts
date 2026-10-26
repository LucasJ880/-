/**
 * Revenue Spine — FDE V2 启动条件就绪度读模型（B-6，openspec change fde-v2-readiness）
 *
 * 只读：第一张事实提案、近 30 天事实提案、写入审计、近 30 天草稿快照、历史报价条数、policy →
 * 交给纯函数 computeV2Readiness（v2-readiness.ts）。依赖可注入；查询条件全部由本文件导出的纯函数构造，都带服务端解析出的 orgId。
 * 提案载荷与快照正文只在这里解析出字段 / 待确认项，不进入响应。
 */

import { pendingActionOutcome } from "@/lib/cockpit/workload";
import type { RevenueSpinePolicy } from "./policy";
import {
  V2_APPLIED_AUDIT_LIMIT,
  V2_PROPOSAL_LIMIT,
  V2_READINESS_WINDOW_DAYS,
  V2_SNAPSHOT_LIMIT,
  computeV2Readiness,
  type ProposalBucket,
  type V2ReadinessReport,
} from "./v2-readiness";

const DAY_MS = 86_400_000;

/** 与 src/lib/pending-actions/approver-roles.ts FACT_PROPOSAL_ACTION_TYPE 一致（测试对照） */
export const V2_FACT_PROPOSAL_TYPE = "revenue_spine.propose_commercial_fact";
/** 与 src/lib/revenue-spine/fact-proposals.ts FACT_APPLIED_AUDIT_ACTION 一致 */
export const V2_FACT_APPLIED_AUDIT_ACTION = "revenue_spine.commercial_fact.applied";
/** 与 src/lib/revenue-spine/fde/draft-feedback.ts DRAFT_SNAPSHOT_AUDIT_ACTION 一致 */
export const V2_DRAFT_SNAPSHOT_AUDIT_ACTION = "revenue_spine.inquiry_reply.draft_snapshot";

// ── 查询条件（纯函数） ────────────────────────────────────

export function anyProposalWhere(orgId: string) {
  return { orgId, type: V2_FACT_PROPOSAL_TYPE };
}

export function windowProposalWhere(orgId: string, since: Date) {
  return { orgId, type: V2_FACT_PROPOSAL_TYPE, createdAt: { gte: since } };
}

export function appliedAuditWhere(orgId: string) {
  return { orgId, action: V2_FACT_APPLIED_AUDIT_ACTION };
}

export function snapshotAuditWhere(orgId: string, since: Date) {
  return { orgId, action: V2_DRAFT_SNAPSHOT_AUDIT_ACTION, targetType: "pending_action", createdAt: { gte: since } };
}

export function quoteCountWhere(orgId: string) {
  return { orgId };
}

// ── 解析（纯函数） ────────────────────────────────────────

const recOf = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** AuditLog.afterData 是 JSON 字符串；解析失败 → null */
function parseJsonText(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return recOf(JSON.parse(value));
  } catch {
    return null;
  }
}

/** 提案载荷里的字段名（只取 field，不读提议值与证据） */
export function proposalFieldOfPayload(payload: unknown): string | null {
  const f = recOf(payload)?.field;
  return typeof f === "string" ? f : null;
}

/** 写入审计 afterData → 字段名 */
export function appliedFieldOf(afterData: string | null | undefined): string | null {
  const f = parseJsonText(afterData)?.field;
  return typeof f === "string" ? f : null;
}

/**
 * 提案终态 → 计数桶，与 A-4 工作量面板同一口径（cockpit/workload.ts pendingActionOutcome）：
 * - 已过期 = 超时任务清理过的（failed + "已过期"），或还没被清理、已过有效期的待审批；
 * - 已批准 = 执行完成（含值未变、未发布新版本的）；认领中、执行失败、取消、作废记其他。
 */
export function proposalBucketOf(
  row: { status: string; expiresAt: Date; failureReason: string | null; decidedById: string | null },
  now: Date,
): ProposalBucket {
  const { outcome, executionFailed } = pendingActionOutcome({ status: row.status, failureReason: row.failureReason, decidedById: row.decidedById });
  if (outcome === "pending") return row.expiresAt.getTime() <= now.getTime() ? "expired" : "pending";
  if (outcome === "expired") return "expired";
  if (outcome === "rejected") return "rejected";
  if (outcome === "approved" && !executionFailed && row.status === "executed") return "applied";
  return "other";
}

/** 同一审批只留一份快照（并发重跑同一封来信可能给同一审批写两份）：按 targetId 去重，保留最新的（输入已按时间倒序） */
export function dedupeSnapshots<T extends { targetId: string | null }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (r.targetId) {
      if (seen.has(r.targetId)) continue;
      seen.add(r.targetId);
    }
    out.push(r);
  }
  return out;
}

/** 快照 afterData → 跟进序号与待确认项；版本不符或缺字段 → null（不计入） */
export function snapshotSummaryOf(afterData: string | null | undefined): { followUpStep: number | null; pendingInternalConfirmation: string[] } | null {
  const v = parseJsonText(afterData);
  if (!v || v.version !== 1 || !Array.isArray(v.pendingInternalConfirmation)) return null;
  const step = v.followUpStep;
  if (step !== null && typeof step !== "number") return null;
  return { followUpStep: step, pendingInternalConfirmation: v.pendingInternalConfirmation.filter((p): p is string => typeof p === "string") };
}

// ── 依赖 ──────────────────────────────────────────────────

export interface V2KnowledgeStatus {
  moq: boolean;
  productionLeadTime: boolean;
  certification: boolean;
  costBasis: boolean;
  samplePolicy: boolean;
}

export interface V2ReadinessDeps {
  now(): Date;
  firstProposalAt(orgId: string): Promise<Date | null>;
  windowProposals(
    orgId: string,
    since: Date,
    limit: number,
  ): Promise<Array<{ status: string; expiresAt: Date; failureReason: string | null; decidedById: string | null; payload: unknown }>>;
  appliedAudits(orgId: string, limit: number): Promise<Array<{ afterData: string | null }>>;
  snapshots(orgId: string, since: Date, limit: number): Promise<Array<{ targetId: string | null; afterData: string | null }>>;
  historicalQuoteCount(orgId: string): Promise<number>;
  loadPolicy(orgId: string): Promise<RevenueSpinePolicy>;
  /** 与草稿同一口径：factory-knowledge.ts 的 getMOQ / getLeadTime / getCertification / getCostBasis / getSamplePolicy */
  knowledgeStatus(policy: RevenueSpinePolicy): Promise<V2KnowledgeStatus>;
}

// ── 入口 ──────────────────────────────────────────────────

export async function getV2Readiness(orgId: string, deps: V2ReadinessDeps = defaultV2ReadinessDeps()): Promise<V2ReadinessReport> {
  const now = deps.now();
  const since = new Date(now.getTime() - V2_READINESS_WINDOW_DAYS * DAY_MS);
  const [firstProposalAt, proposals, applied, snapshots, historicalQuotes, policy] = await Promise.all([
    deps.firstProposalAt(orgId),
    deps.windowProposals(orgId, since, V2_PROPOSAL_LIMIT + 1),
    deps.appliedAudits(orgId, V2_APPLIED_AUDIT_LIMIT + 1),
    deps.snapshots(orgId, since, V2_SNAPSHOT_LIMIT + 1),
    deps.historicalQuoteCount(orgId),
    deps.loadPolicy(orgId),
  ]);
  const knowledge = await deps.knowledgeStatus(policy);
  return computeV2Readiness({
    now,
    firstProposalAt,
    proposals: proposals.slice(0, V2_PROPOSAL_LIMIT).map((p) => ({ bucket: proposalBucketOf(p, now), field: proposalFieldOfPayload(p.payload) })),
    proposalsTruncated: proposals.length > V2_PROPOSAL_LIMIT,
    appliedFields: applied.slice(0, V2_APPLIED_AUDIT_LIMIT).map((a) => appliedFieldOf(a.afterData)),
    appliedTruncated: applied.length > V2_APPLIED_AUDIT_LIMIT,
    snapshots: dedupeSnapshots(snapshots.slice(0, V2_SNAPSHOT_LIMIT))
      .map((s) => snapshotSummaryOf(s.afterData))
      .filter((s): s is NonNullable<typeof s> => s !== null),
    snapshotsTruncated: snapshots.length > V2_SNAPSHOT_LIMIT,
    knowledge,
    minimumMarginConfigured: policy.businessProfile.minimumMargin !== null,
    historicalQuotes,
    productCategories: policy.businessProfile.productCategories.length,
  });
}

export function defaultV2ReadinessDeps(): V2ReadinessDeps {
  return {
    now: () => new Date(),

    firstProposalAt: async (orgId) => {
      const { db } = await import("@/lib/db");
      const row = await db.pendingAction.findFirst({ where: anyProposalWhere(orgId), orderBy: { createdAt: "asc" }, select: { createdAt: true } });
      return row?.createdAt ?? null;
    },

    windowProposals: async (orgId, since, limit) => {
      const { db } = await import("@/lib/db");
      return db.pendingAction.findMany({
        where: windowProposalWhere(orgId, since),
        select: { status: true, expiresAt: true, failureReason: true, decidedById: true, payload: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      });
    },

    appliedAudits: async (orgId, limit) => {
      const { db } = await import("@/lib/db");
      return db.auditLog.findMany({
        where: appliedAuditWhere(orgId),
        select: { afterData: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      });
    },

    snapshots: async (orgId, since, limit) => {
      const { db } = await import("@/lib/db");
      return db.auditLog.findMany({
        where: snapshotAuditWhere(orgId, since),
        select: { targetId: true, afterData: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      });
    },

    historicalQuoteCount: async (orgId) => {
      const { db } = await import("@/lib/db");
      const [trade, sales] = await Promise.all([db.tradeQuote.count({ where: quoteCountWhere(orgId) }), db.salesQuote.count({ where: quoteCountWhere(orgId) })]);
      return trade + sales;
    },

    loadPolicy: async (orgId) => (await import("./policy")).loadRevenueSpinePolicy(orgId),

    knowledgeStatus: async (policy) => {
      const fk = await import("./factory-knowledge");
      return {
        moq: fk.getMOQ(null, policy).status === "available",
        productionLeadTime: fk.getLeadTime(null, policy).status === "available",
        certification: fk.getCertification().status === "available",
        costBasis: fk.getCostBasis(null).status === "available",
        samplePolicy: fk.getSamplePolicy(policy).status === "available",
      };
    },
  };
}
