/**
 * FDE 询盘回复草稿的反馈闭环（B-1，openspec change fde-feedback-loop）
 *
 * - 审批新建时写一条脱敏草稿快照审计（recordInquiryDraftSnapshotSafe）；
 * - 审批到达终态（批准 / 驳回 / 过期）时产生一条团队范围的人类反馈事件（recordInquiryReplyFeedbackSafe），
 *   只存引用与结构化 diff，不存正文；同一审批同一终态只产一条；
 * - approval-timeout 定时任务里补漏（sweepInquiryReplyFeedback）。
 * 全部尽力而为：任何异常只记日志，不影响审批结果、接口响应与 FDE 流程。
 * 结局判定复用驾驶舱工作量的同一张规则表（cockpit/workload.ts pendingActionOutcome），两边口径一致。
 */

import { pendingActionOutcome } from "@/lib/cockpit/workload";
import type { CreateFeedbackInput } from "@/lib/employee-ai/feedback-service";
import { buildDraftDiff, draftContentHash, maskBuyerPii, normalizeDraftBody, type BuyerPiiTerms } from "./draft-diff";

/** 与 fde/inbound-sales.ts INQUIRY_REPLY_ACTION_TYPE 一致（测试对照源码） */
export const INQUIRY_REPLY_TYPE = "sales.send_inquiry_reply";
/** 与 fde/actions.ts FDE_EMPLOYEE_KEY 一致：写入 HumanFeedbackEvent.skillSlug */
export const FDE_FEEDBACK_SKILL = "inbound_sales_fde";
export const FDE_FEEDBACK_TASK_TYPE = "inquiry_reply";
export const DRAFT_SNAPSHOT_AUDIT_ACTION = "revenue_spine.inquiry_reply.draft_snapshot";
const REASON_MAX = 500;

// ── 快照 ──────────────────────────────────────────────────────

export interface DraftSnapshotInput {
  orgId: string;
  /** 审计操作者：FDE 的负责人（审批的 principal） */
  actorUserId: string;
  pendingActionId: string;
  opportunityId: string;
  /** 跟进第几次；首封回复为 null */
  followUpStep: number | null;
  subject: string;
  body: string;
  language: string | null;
  buyer: BuyerPiiTerms;
  guardrailViolations: readonly string[];
  factsUsed: ReadonlyArray<{ field: string; value: string }>;
  pendingInternalConfirmation: readonly string[];
  templateOnly: boolean | null;
}

export interface DraftSnapshot {
  version: 1;
  opportunityId: string;
  followUpStep: number | null;
  language: string | null;
  /** 买家信息已替换 */
  subject: string;
  /** 买家信息已替换、归一（trim + 10k） */
  body: string;
  /** 归一后的原始正文哈希：判定是否改过不受替换影响 */
  bodyHash: string;
  guardrail: { passed: boolean; violations: string[] };
  factsUsed: Array<{ field: string; value: string }>;
  pendingInternalConfirmation: string[];
  templateOnly: boolean | null;
}

export function buildDraftSnapshot(input: DraftSnapshotInput): DraftSnapshot {
  const mask = (text: string) => maskBuyerPii(text, input.buyer);
  return {
    version: 1,
    opportunityId: input.opportunityId,
    followUpStep: input.followUpStep,
    language: input.language,
    subject: mask(input.subject).slice(0, 500),
    body: normalizeDraftBody(mask(input.body)),
    bodyHash: draftContentHash(normalizeDraftBody(input.body)),
    guardrail: { passed: input.guardrailViolations.length === 0, violations: input.guardrailViolations.slice(0, 20).map(String) },
    factsUsed: input.factsUsed.slice(0, 30).map((f) => ({ field: String(f.field), value: mask(String(f.value)).slice(0, 200) })),
    pendingInternalConfirmation: input.pendingInternalConfirmation.slice(0, 20).map((p) => mask(String(p)).slice(0, 200)),
    templateOnly: input.templateOnly,
  };
}

/** 审计里读回的快照（字段不全或版本不符视为没有快照） */
export function parseDraftSnapshot(value: unknown): DraftSnapshot | null {
  const v = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  if (!v || v.version !== 1 || typeof v.body !== "string" || typeof v.bodyHash !== "string") return null;
  return v as unknown as DraftSnapshot;
}

export interface SnapshotDeps {
  writeAudit(params: { userId: string; orgId: string; action: string; targetType: string; targetId: string; afterData: unknown }): Promise<void>;
}

export async function recordInquiryDraftSnapshot(input: DraftSnapshotInput, deps: SnapshotDeps = defaultSnapshotDeps()): Promise<void> {
  await deps.writeAudit({
    userId: input.actorUserId,
    orgId: input.orgId,
    action: DRAFT_SNAPSHOT_AUDIT_ACTION,
    targetType: "pending_action",
    targetId: input.pendingActionId,
    afterData: buildDraftSnapshot(input),
  });
}

/** 尽力而为：快照失败只记日志，不影响审批创建与 FDE 流程 */
export async function recordInquiryDraftSnapshotSafe(input: DraftSnapshotInput, deps?: SnapshotDeps): Promise<void> {
  try {
    await recordInquiryDraftSnapshot(input, deps);
  } catch (err) {
    console.error("[fde.feedback] 草稿快照写入失败", input.pendingActionId, err instanceof Error ? err.name : typeof err);
  }
}

function defaultSnapshotDeps(): SnapshotDeps {
  return {
    writeAudit: async (params) => {
      const { logAudit } = await import("@/lib/audit/logger");
      await logAudit(params);
    },
  };
}

// ── 终态映射 ──────────────────────────────────────────────────

export type FeedbackTerminal = "approved" | "rejected" | "expired";
export type FeedbackType = "approved_as_is" | "approved_edited" | "rejected" | "expired";

export const HUMAN_DECISION_BY_FEEDBACK: Record<FeedbackType, "accepted" | "edited" | "rejected" | "deferred"> = {
  approved_as_is: "accepted",
  approved_edited: "edited",
  rejected: "rejected",
  expired: "deferred",
};

/**
 * 只有三种终态产事件：批准（含批准后执行失败）、人工驳回、过期。
 * 人工取消、系统作废（新来信 / 人工已回复 / 入驻测试 / 报价变化）、批量准备失败、关联任务取消都不产。
 */
export function feedbackTerminal(row: { status: string; failureReason: string | null; decidedById: string | null }): FeedbackTerminal | null {
  if (row.status === "approved") return null; // 执行中的占位，等最终结果
  const { outcome } = pendingActionOutcome(row);
  return outcome === "approved" || outcome === "rejected" || outcome === "expired" ? outcome : null;
}

// ── 记录器 ────────────────────────────────────────────────────

export interface FeedbackActionRow {
  id: string;
  orgId: string | null;
  type: string;
  status: string;
  failureReason: string | null;
  decidedById: string | null;
  approverUserId: string | null;
  createdById: string;
  payload: unknown;
}

export interface FeedbackDeps {
  loadAction(actionId: string): Promise<FeedbackActionRow | null>;
  loadSnapshot(orgId: string, actionId: string): Promise<DraftSnapshot | null>;
  loadBuyer(orgId: string, opportunityId: string): Promise<BuyerPiiTerms | null>;
  hasFeedback(actionId: string, terminal: FeedbackTerminal): Promise<boolean>;
  createFeedback(input: CreateFeedbackInput): Promise<{ id: string }>;
}

export type RecordResult =
  | { status: "recorded"; feedbackType: FeedbackType; eventId: string }
  | { status: "skipped"; reason: "not_found" | "not_inquiry_reply" | "no_org" | "not_terminal" | "duplicate" };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const EMPTY_DIFF = (summary: string, extra: Record<string, unknown> = {}) => ({
  kind: "empty",
  changed: false,
  summary,
  sections: [],
  changedRatio: 0,
  capturedNumbers: [],
  ...extra,
});

export async function recordInquiryReplyFeedback(actionId: string, deps: FeedbackDeps = defaultFeedbackDeps()): Promise<RecordResult> {
  const row = await deps.loadAction(actionId);
  if (!row) return { status: "skipped", reason: "not_found" };
  if (row.type !== INQUIRY_REPLY_TYPE) return { status: "skipped", reason: "not_inquiry_reply" };
  if (!row.orgId) return { status: "skipped", reason: "no_org" };
  const terminal = feedbackTerminal(row);
  if (!terminal) return { status: "skipped", reason: "not_terminal" };
  if (await deps.hasFeedback(row.id, terminal)) return { status: "skipped", reason: "duplicate" };

  const payload = record(row.payload);
  const metadata = record(payload?.metadata);
  const opportunityId = str(payload?.opportunityId) ?? str(metadata?.opportunityId);
  const buyer: BuyerPiiTerms = (opportunityId ? await deps.loadBuyer(row.orgId, opportunityId) : null) ?? {};

  let feedbackType: FeedbackType = terminal === "approved" ? "approved_as_is" : terminal;
  let diffSummary: Record<string, unknown> = EMPTY_DIFF(feedbackType);
  if (terminal === "approved") {
    const snapshot = await deps.loadSnapshot(row.orgId, row.id);
    const sent = normalizeDraftBody(str(payload?.body) ?? "");
    if (!snapshot) {
      diffSummary = EMPTY_DIFF("无快照", { noSnapshot: true });
    } else if (draftContentHash(sent) !== snapshot.bodyHash) {
      // 执行正文与草稿快照不同：两边都是替换买家信息后的版本，diff 结果只含结构信息
      feedbackType = "approved_edited";
      diffSummary = { ...buildDraftDiff(snapshot.body, maskBuyerPii(sent, buyer)) };
    } else {
      diffSummary = EMPTY_DIFF("无修改");
    }
  }

  // 事件里连收件人邮箱也不留（快照才允许保留收件人邮箱）
  const reason = terminal === "rejected" && row.failureReason ? maskBuyerPii(row.failureReason, { ...buyer, recipientEmail: null }).slice(0, REASON_MAX) : null;
  const followUpStep = typeof payload?.followUpStep === "number" ? payload.followUpStep : null;
  const event = await deps.createFeedback({
    orgId: row.orgId,
    userId: row.decidedById ?? row.approverUserId ?? row.createdById,
    taskType: FDE_FEEDBACK_TASK_TYPE,
    humanDecision: HUMAN_DECISION_BY_FEEDBACK[feedbackType],
    aiOutputRef: {
      type: "pending_action",
      id: row.id,
      terminal,
      feedbackType,
      opportunityId,
      followUpStep,
      agentRunId: str(metadata?.agentRunId),
    },
    reasonCode: null,
    reasonText: reason,
    feedbackScope: "team_candidate",
    consentConfirmed: true,
    pendingActionId: row.id,
    skillSlug: FDE_FEEDBACK_SKILL,
    workerType: "fde",
    systemRecorded: true,
    diffSummary,
  });
  return { status: "recorded", feedbackType, eventId: event.id };
}

/**
 * 尽力而为：只记录询盘回复审批；已知类型不是询盘回复时不查库。任何异常只记日志，返回 null。
 */
export async function recordInquiryReplyFeedbackSafe(
  actionId: string,
  opts: { type?: string | null; deps?: FeedbackDeps } = {},
): Promise<RecordResult | null> {
  if (opts.type && opts.type !== INQUIRY_REPLY_TYPE) return { status: "skipped", reason: "not_inquiry_reply" };
  try {
    return await recordInquiryReplyFeedback(actionId, opts.deps);
  } catch (err) {
    console.error("[fde.feedback] 反馈事件记录失败", actionId, err instanceof Error ? err.name : typeof err);
    return null;
  }
}

// ── 补漏扫描（挂在既有 approval-timeout 定时任务里） ──────────

export const FEEDBACK_SWEEP_SETTLE_MS = 10 * 60_000;
export const FEEDBACK_SWEEP_LOOKBACK_DAYS = 7;
export const FEEDBACK_SWEEP_LIMIT = 200;

/** 近 7 天、终态已超过 10 分钟的询盘回复审批（避开端口与过期赢家正在写的那一刻） */
export function feedbackSweepWhere(now: Date) {
  return {
    type: INQUIRY_REPLY_TYPE,
    status: { in: ["executed", "rejected", "failed"] },
    updatedAt: {
      gte: new Date(now.getTime() - FEEDBACK_SWEEP_LOOKBACK_DAYS * 86_400_000),
      lte: new Date(now.getTime() - FEEDBACK_SWEEP_SETTLE_MS),
    },
  };
}

export function existingFeedbackWhere(actionIds: readonly string[]) {
  return { skillSlug: FDE_FEEDBACK_SKILL, pendingActionId: { in: [...actionIds] } };
}

export interface SweepDeps {
  listCandidates(now: Date, limit: number): Promise<string[]>;
  /** 已有 B-1 反馈事件的审批 id */
  withFeedback(actionIds: readonly string[]): Promise<ReadonlySet<string>>;
  record(actionId: string): Promise<RecordResult | null>;
}

export async function sweepInquiryReplyFeedback(now: Date, deps: SweepDeps = defaultSweepDeps()) {
  const candidates = await deps.listCandidates(now, FEEDBACK_SWEEP_LIMIT);
  const done = candidates.length ? await deps.withFeedback(candidates) : new Set<string>();
  let recorded = 0;
  let skipped = 0;
  for (const id of candidates) {
    if (done.has(id)) continue;
    const result = await deps.record(id);
    if (result?.status === "recorded") recorded++;
    else skipped++;
  }
  return { scanned: candidates.length, recorded, skipped };
}

// ── 默认依赖（Prisma；读 + 只经反馈服务写） ──────────────────

export function defaultFeedbackDeps(): FeedbackDeps {
  return {
    loadAction: async (actionId) => {
      const { db } = await import("@/lib/db");
      return db.pendingAction.findUnique({
        where: { id: actionId },
        select: { id: true, orgId: true, type: true, status: true, failureReason: true, decidedById: true, approverUserId: true, createdById: true, payload: true },
      });
    },
    loadSnapshot: async (orgId, actionId) => {
      const { db } = await import("@/lib/db");
      const audit = await db.auditLog.findFirst({
        where: { orgId, action: DRAFT_SNAPSHOT_AUDIT_ACTION, targetType: "pending_action", targetId: actionId },
        orderBy: { createdAt: "desc" },
        select: { afterData: true },
      });
      return parseDraftSnapshot(audit?.afterData);
    },
    loadBuyer: async (orgId, opportunityId) => {
      const { db } = await import("@/lib/db");
      const opp = await db.salesOpportunity.findFirst({
        where: { id: opportunityId, orgId },
        select: { customer: { select: { name: true, contactName: true, email: true } } },
      });
      return opp ? { companyName: opp.customer.name, contactName: opp.customer.contactName, recipientEmail: opp.customer.email } : null;
    },
    hasFeedback: async (actionId, terminal) => {
      const { db } = await import("@/lib/db");
      const hit = await db.humanFeedbackEvent.findFirst({
        where: { pendingActionId: actionId, skillSlug: FDE_FEEDBACK_SKILL, aiOutputRef: { path: ["terminal"], equals: terminal } },
        select: { id: true },
      });
      return Boolean(hit);
    },
    createFeedback: async (input) => {
      const { createHumanFeedbackEvent } = await import("@/lib/employee-ai/feedback-service");
      return createHumanFeedbackEvent(input);
    },
  };
}

function defaultSweepDeps(): SweepDeps {
  return {
    listCandidates: async (now, limit) => {
      const { db } = await import("@/lib/db");
      const rows = await db.pendingAction.findMany({ where: feedbackSweepWhere(now), select: { id: true }, orderBy: { updatedAt: "desc" }, take: limit });
      return rows.map((r) => r.id);
    },
    withFeedback: async (actionIds) => {
      const { db } = await import("@/lib/db");
      const rows = await db.humanFeedbackEvent.findMany({ where: existingFeedbackWhere(actionIds), select: { pendingActionId: true } });
      return new Set(rows.map((r) => r.pendingActionId).filter((id): id is string => !!id));
    },
    record: (actionId) => recordInquiryReplyFeedbackSafe(actionId),
  };
}
