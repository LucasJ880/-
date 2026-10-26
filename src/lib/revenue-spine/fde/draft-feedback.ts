/**
 * FDE 询盘回复草稿的反馈闭环（B-1，openspec change fde-feedback-loop）
 *
 * - 审批新建时写一条脱敏草稿快照审计（recordInquiryDraftSnapshotSafe）；
 * - 审批到达终态（批准 / 驳回 / 过期）时产生一条团队范围的人类反馈事件（recordInquiryReplyFeedbackSafe），
 *   只存引用与结构化 diff，不存正文；同一审批同一终态只产一条；
 * - 人工已回复而被系统作废（SUPERSEDED_BY_MANUAL_REPLY，B-2）也算一次改稿：diff = 草稿快照 vs 那次人工外发正文；
 *   改稿类事件记录后触发商务事实提案（fact-proposals.ts，尽力而为）；
 * - approval-timeout 定时任务里补漏（sweepInquiryReplyFeedback）。
 * 全部尽力而为：任何异常只记日志，不影响审批结果、接口响应与 FDE 流程。
 * 结局判定复用驾驶舱工作量的同一张规则表（cockpit/workload.ts pendingActionOutcome），两边口径一致。
 */

import {
  PENDING_BATCH_PREPARE_FAILED,
  PENDING_CANCELLED_REASON,
  PENDING_EXPIRED_REASON,
  PENDING_QUOTE_CHANGED_PREFIX,
  PENDING_RUN_CANCELLED_PREFIX,
  pendingActionOutcome,
} from "@/lib/cockpit/workload";
import type { CreateFeedbackInput } from "@/lib/employee-ai/feedback-service";
import { stripQuotedReply } from "../fact-extract";
import { buildDraftDiff, draftContentHash, maskBuyerPii, normalizeDraftBody, type BuyerPiiTerms } from "./draft-diff";

/** 与 fde/inbound-sales.ts INQUIRY_REPLY_ACTION_TYPE 一致（测试对照源码） */
export const INQUIRY_REPLY_TYPE = "sales.send_inquiry_reply";
/** 与 fde/actions.ts FDE_EMPLOYEE_KEY 一致：写入 HumanFeedbackEvent.skillSlug */
export const FDE_FEEDBACK_SKILL = "inbound_sales_fde";
/** 含 "email"：与 practice-miner / preference-learner 识别邮件类反馈的规则对得上 */
export const FDE_FEEDBACK_TASK_TYPE = "fde_email_reply";
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

/** 审计里读回的快照：AuditLog.afterData 是 JSON 字符串；字段不全或版本不符视为没有快照 */
export function parseDraftSnapshot(value: unknown): DraftSnapshot | null {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const v = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
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

export type FeedbackTerminal = "approved" | "rejected" | "expired" | "manual_reply";
export type FeedbackType = "approved_as_is" | "approved_edited" | "rejected" | "expired" | "replaced_by_manual_reply";

export const HUMAN_DECISION_BY_FEEDBACK: Record<FeedbackType, "accepted" | "edited" | "rejected" | "deferred"> = {
  approved_as_is: "accepted",
  approved_edited: "edited",
  rejected: "rejected",
  expired: "deferred",
  replaced_by_manual_reply: "edited",
};

/** 与 trade/outbound-sync.ts SUPERSEDED_BY_MANUAL_REPLY 一致（测试对照源码） */
export const MANUAL_REPLY_REASON = "SUPERSEDED_BY_MANUAL_REPLY";

/** 改稿类事件：记录后触发商务事实提案（B-2） */
export const FACT_PROPOSAL_FEEDBACK_TYPES: readonly FeedbackType[] = ["approved_edited", "replaced_by_manual_reply"];

/** 系统作废原因里的证据：`SUPERSEDED_BY_MANUAL_REPLY tradeMessageId=… outboundInteractionId=… triggeredBy=<userId> …` */
export function parseSupersessionEvidence(failureReason: string | null | undefined): { outboundInteractionId: string | null; triggeredBy: string | null } {
  const get = (key: string) => {
    const m = new RegExp(`(?:^|\\s)${key}=(\\S+)`).exec(failureReason ?? "");
    return m && m[1] !== "none" ? m[1] : null;
  };
  return { outboundInteractionId: get("outboundInteractionId"), triggeredBy: get("triggeredBy") };
}

/**
 * 只有三种终态产事件：批准（含批准后执行失败）、人工驳回、过期。
 * 人工取消、系统作废（新来信 / 人工已回复 / 入驻测试 / 报价变化）、批量准备失败、关联任务取消都不产。
 */
export function feedbackTerminal(row: { status: string; failureReason: string | null; decidedById: string | null }): FeedbackTerminal | null {
  if (row.status === "approved") return null; // 执行中的占位，等最终结果
  // 人工已回复：销售没批这份草稿，而是自己回了买家（B-2 的改稿来源）；其它系统作废仍不产事件
  if (row.status === "failed" && (row.failureReason ?? "").startsWith(MANUAL_REPLY_REASON)) return "manual_reply";
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

export interface FeedbackBuyer extends BuyerPiiTerms {
  /** 买家电话：只交给商务事实提案排除 WhatsApp，不进事件 */
  phone?: string | null;
  /** 入驻测试询盘（与询盘 SLA 指标同一判定）：不产学习事件 */
  testInquiry: boolean;
}

/** 人工外发正文（Revenue Spine 的外发互动）；source 是外贸外发来源（trade_inbox.reply / trade_outreach.send …） */
export interface ManualReply {
  content: string;
  source: string | null;
}

/** 改稿类事件记录后交给商务事实提案的上下文 */
export interface AfterRecordedContext {
  orgId: string;
  opportunityId: string | null;
  sourcePendingActionId: string;
  principalUserId: string;
  feedbackType: FeedbackType;
  snapshotBody: string | null;
  /** 发给买家的原文（人工回复或执行正文），未替换买家信息 */
  sentRaw: string;
  buyer: BuyerPiiTerms & { phone?: string | null };
}

export interface FeedbackDeps {
  loadAction(actionId: string): Promise<FeedbackActionRow | null>;
  /** 按组织读外发互动正文（人工已回复终态用） */
  loadManualReply(orgId: string, interactionId: string): Promise<ManualReply | null>;
  /** 该审批的全部快照（按写入先后）；并发重放可能写了不止一份 */
  loadSnapshots(orgId: string, actionId: string): Promise<DraftSnapshot[]>;
  loadBuyer(orgId: string, opportunityId: string): Promise<FeedbackBuyer | null>;
  hasFeedback(actionId: string, terminal: FeedbackTerminal): Promise<boolean>;
  createFeedback(input: CreateFeedbackInput): Promise<{ id: string }>;
  /** 同一审批串行化"先查后写"（生产：事务内 pg_advisory_xact_lock） */
  withLock<T>(actionId: string, fn: () => Promise<T>): Promise<T>;
  /** 改稿类事件写入后（锁外）调用；异常由记录器吞掉，不影响事件 */
  afterRecorded?(ctx: AfterRecordedContext): Promise<void>;
}

/**
 * 不是销售写给买家的回复，只记事件、不从中抽商务事实：
 * - 开发信（trade_outreach.*）是模板外发；
 * - 线索页手工留痕（trade_prospect.manual_outbound）是沟通记录，常记着买家说的数字（"电话：客户要 300 件"）。
 */
const NOT_A_REPLY_SOURCE_PREFIXES: readonly string[] = ["trade_outreach.", "trade_prospect.manual_outbound"];

export function isFactProposalSource(source: string | null | undefined): boolean {
  return !NOT_A_REPLY_SOURCE_PREFIXES.some((p) => (source ?? "").startsWith(p));
}

export type RecordResult =
  | { status: "recorded"; feedbackType: FeedbackType; eventId: string }
  | { status: "skipped"; reason: "not_found" | "not_inquiry_reply" | "no_org" | "not_terminal" | "onboarding_test" | "duplicate" };

/** 多份快照时取正文哈希与执行正文一致的那份（照发）；都不一致取最早一份（FDE 最初的草稿） */
export function pickSnapshot(snapshots: readonly DraftSnapshot[], sentHash: string): DraftSnapshot | null {
  return snapshots.find((s) => s.bodyHash === sentHash) ?? snapshots[0] ?? null;
}

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
  const orgId = row.orgId;

  const payload = record(row.payload);
  const metadata = record(payload?.metadata);
  const opportunityId = str(payload?.opportunityId) ?? str(metadata?.opportunityId);
  const loaded = opportunityId ? await deps.loadBuyer(orgId, opportunityId) : null;
  if (loaded?.testInquiry) return { status: "skipped", reason: "onboarding_test" };
  // 事件只用联系人名 / 公司 / 收件人邮箱做替换；电话单独留给商务事实提案
  const buyer: BuyerPiiTerms = loaded ? { contactName: loaded.contactName, companyName: loaded.companyName, recipientEmail: loaded.recipientEmail } : {};

  let feedbackType: FeedbackType = terminal === "approved" ? "approved_as_is" : terminal === "manual_reply" ? "replaced_by_manual_reply" : terminal;
  let diffSummary: Record<string, unknown> = EMPTY_DIFF(feedbackType);
  let snapshotBody: string | null = null;
  /** 发给买家的原文（只有改稿类事件才会用来抽商务事实） */
  let sentRaw: string | null = null;
  let sentSource: string | null = null;
  const evidence = terminal === "manual_reply" ? parseSupersessionEvidence(row.failureReason) : null;
  if (terminal === "approved") {
    const sent = normalizeDraftBody(str(payload?.body) ?? "");
    const snapshot = pickSnapshot(await deps.loadSnapshots(orgId, row.id), draftContentHash(sent));
    if (!snapshot) {
      diffSummary = EMPTY_DIFF("无快照", { noSnapshot: true });
    } else if (draftContentHash(sent) !== snapshot.bodyHash) {
      // 执行正文与草稿快照不同：两边都是替换买家信息后的版本，diff 结果只含结构信息
      feedbackType = "approved_edited";
      diffSummary = { ...buildDraftDiff(snapshot.body, maskBuyerPii(sent, buyer)) };
      snapshotBody = snapshot.body;
      sentRaw = sent;
    } else {
      diffSummary = EMPTY_DIFF("无修改");
    }
  } else if (terminal === "manual_reply") {
    const reply = evidence?.outboundInteractionId ? await deps.loadManualReply(orgId, evidence.outboundInteractionId) : null;
    // 人工回复常带引用的买家原信：先截掉，再与草稿比较
    const manual = reply ? normalizeDraftBody(stripQuotedReply(reply.content)) : "";
    const snapshot = manual ? pickSnapshot(await deps.loadSnapshots(orgId, row.id), draftContentHash(manual)) : null;
    if (!manual) {
      diffSummary = EMPTY_DIFF("无人工回复正文", { noManualReply: true });
    } else if (!snapshot) {
      diffSummary = EMPTY_DIFF("无快照", { noSnapshot: true });
    } else {
      diffSummary = { ...buildDraftDiff(snapshot.body, maskBuyerPii(manual, buyer)) };
    }
    snapshotBody = snapshot?.body ?? null;
    sentRaw = manual || null;
    sentSource = reply?.source ?? null;
  }

  // 事件里连收件人邮箱也不留（快照才允许保留收件人邮箱）
  const reason = terminal === "rejected" && row.failureReason ? maskBuyerPii(row.failureReason, { ...buyer, recipientEmail: null }).slice(0, REASON_MAX) : null;
  const followUpStep = typeof payload?.followUpStep === "number" ? payload.followUpStep : null;
  // 先查后写在同一把锁里：端口、过期、补漏乃至重叠的定时任务同时到达也只写一条
  const userId = row.decidedById ?? evidence?.triggeredBy ?? row.approverUserId ?? row.createdById;
  const result = await deps.withLock(row.id, async (): Promise<RecordResult> => {
    if (await deps.hasFeedback(row.id, terminal)) return { status: "skipped", reason: "duplicate" };
    const event = await deps.createFeedback({
      orgId,
      userId,
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
  });

  // 改稿类事件：锁外触发商务事实提案（B-2）。开发信不是对询盘的回复，不抽
  if (
    result.status === "recorded" &&
    deps.afterRecorded &&
    sentRaw &&
    FACT_PROPOSAL_FEEDBACK_TYPES.includes(feedbackType) &&
    isFactProposalSource(sentSource)
  ) {
    try {
      await deps.afterRecorded({
        orgId,
        opportunityId,
        sourcePendingActionId: row.id,
        principalUserId: userId,
        feedbackType,
        snapshotBody,
        sentRaw,
        buyer: { ...buyer, phone: loaded?.phone ?? null },
      });
    } catch (err) {
      console.error("[fde.feedback] 商务事实提案失败", row.id, err instanceof Error ? err.name : typeof err);
    }
  }
  return result;
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
export const FEEDBACK_SWEEP_PAGE = 200;
export const FEEDBACK_SWEEP_MAX_PAGES = 10;
/** 每轮最多处理（记录或判定跳过）的条数，避免一次定时任务跑太久 */
export const FEEDBACK_SWEEP_MAX_RECORDS = 100;

/**
 * 近 7 天、终态已超过 10 分钟（避开端口与过期赢家正在写的那一刻）、可能产事件的询盘回复审批。
 * 在查询里就排除不会产事件的终态（取消 / 人工已回复以外的作废 / 批量准备失败 / 关联任务取消），不让它们挤占每页名额。
 */
export function feedbackSweepWhere(now: Date) {
  return {
    type: INQUIRY_REPLY_TYPE,
    updatedAt: {
      gte: new Date(now.getTime() - FEEDBACK_SWEEP_LOOKBACK_DAYS * 86_400_000),
      lte: new Date(now.getTime() - FEEDBACK_SWEEP_SETTLE_MS),
    },
    OR: [
      { status: "executed" },
      // 人工已回复作废（B-2）：其它 SUPERSEDED_ 仍在下方排除
      { status: "failed", failureReason: { startsWith: MANUAL_REPLY_REASON } },
      { status: "rejected", OR: [{ failureReason: null }, { NOT: { failureReason: { startsWith: PENDING_RUN_CANCELLED_PREFIX } } }] },
      { status: "failed", failureReason: PENDING_EXPIRED_REASON },
      {
        status: "failed",
        decidedById: { not: null },
        NOT: [
          { failureReason: PENDING_CANCELLED_REASON },
          { failureReason: { startsWith: PENDING_BATCH_PREPARE_FAILED } },
          { failureReason: { startsWith: "SUPERSEDED_" } },
          { failureReason: { startsWith: PENDING_QUOTE_CHANGED_PREFIX } },
        ],
      },
    ],
  };
}

export function existingFeedbackWhere(actionIds: readonly string[]) {
  return { skillSlug: FDE_FEEDBACK_SKILL, pendingActionId: { in: [...actionIds] } };
}

export interface SweepDeps {
  /** 按 (updatedAt, id) 升序分页；cursorId 为上一页最后一条 */
  listCandidates(now: Date, limit: number, cursorId: string | null): Promise<string[]>;
  /** 已有 B-1 反馈事件的审批 id */
  withFeedback(actionIds: readonly string[]): Promise<ReadonlySet<string>>;
  record(actionId: string): Promise<RecordResult | null>;
}

/** 从最早的开始翻页，已有事件的跳过；处理满上限或翻完为止（旧的漏记不会被新的挤掉） */
export async function sweepInquiryReplyFeedback(now: Date, deps: SweepDeps = defaultSweepDeps()) {
  let cursor: string | null = null;
  let scanned = 0;
  let recorded = 0;
  let skipped = 0;
  let pages = 0;
  while (pages < FEEDBACK_SWEEP_MAX_PAGES && recorded + skipped < FEEDBACK_SWEEP_MAX_RECORDS) {
    const ids = await deps.listCandidates(now, FEEDBACK_SWEEP_PAGE, cursor);
    pages++;
    if (!ids.length) break;
    scanned += ids.length;
    const done = await deps.withFeedback(ids);
    for (const id of ids) {
      if (done.has(id)) continue;
      if (recorded + skipped >= FEEDBACK_SWEEP_MAX_RECORDS) break;
      const result = await deps.record(id);
      if (result?.status === "recorded") recorded++;
      else skipped++;
    }
    cursor = ids[ids.length - 1];
    if (ids.length < FEEDBACK_SWEEP_PAGE) break;
  }
  return { scanned, recorded, skipped, pages };
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
    loadManualReply: async (orgId, interactionId) => {
      const { db } = await import("@/lib/db");
      const row = await db.customerInteraction.findFirst({
        where: { id: interactionId, orgId, direction: "outbound" },
        select: { content: true, analysisResult: true },
      });
      if (!row?.content) return null;
      const source = record(row.analysisResult)?.source;
      return { content: row.content, source: typeof source === "string" ? source : null };
    },
    loadSnapshots: async (orgId, actionId) => {
      const { db } = await import("@/lib/db");
      const audits = await db.auditLog.findMany({
        where: { orgId, action: DRAFT_SNAPSHOT_AUDIT_ACTION, targetType: "pending_action", targetId: actionId },
        orderBy: { createdAt: "asc" },
        select: { afterData: true },
        take: 5,
      });
      return audits.map((a) => parseDraftSnapshot(a.afterData)).filter((s): s is DraftSnapshot => s !== null);
    },
    loadBuyer: async (orgId, opportunityId) => {
      const [{ db }, sla] = await Promise.all([import("@/lib/db"), import("@/lib/revenue-spine/sla-metrics")]);
      const [opp, firstInquiry] = await Promise.all([
        db.salesOpportunity.findFirst({
          where: { id: opportunityId, orgId },
          select: { lostReason: true, customer: { select: { name: true, contactName: true, email: true, phone: true, tags: true } } },
        }),
        db.salesAction.findFirst({
          where: { orgId, opportunityId, employeeKey: FDE_FEEDBACK_SKILL, actionType: sla.INBOUND_INQUIRY_ACTION_TYPE },
          orderBy: { createdAt: "asc" },
          select: { inputContext: true },
        }),
      ]);
      if (!opp) return null;
      return {
        companyName: opp.customer.name,
        contactName: opp.customer.contactName,
        recipientEmail: opp.customer.email,
        phone: opp.customer.phone,
        testInquiry: sla.isOnboardingTestInquiry({
          utmSource: sla.utmSourceOf(firstInquiry?.inputContext ?? null),
          customerTags: opp.customer.tags,
          lostReason: opp.lostReason,
        }),
      };
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
    afterRecorded: async (ctx) => {
      const { proposeCommercialFactsSafe } = await import("@/lib/revenue-spine/fact-proposals");
      await proposeCommercialFactsSafe({
        orgId: ctx.orgId,
        opportunityId: ctx.opportunityId,
        sourcePendingActionId: ctx.sourcePendingActionId,
        principalUserId: ctx.principalUserId,
        snapshotBody: ctx.snapshotBody,
        sentRaw: ctx.sentRaw,
        buyer: ctx.buyer,
        now: new Date(),
      });
    },
    // 与 assistant/followup-task.ts、tender-workforce 同一模式：事务内 advisory lock 串行化先查后写
    withLock: async (actionId, fn) => {
      const { db } = await import("@/lib/db");
      return db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fde-draft-feedback:${actionId}`}))`;
          return fn();
        },
        { timeout: 15_000, maxWait: 5_000 },
      );
    },
  };
}

function defaultSweepDeps(): SweepDeps {
  return {
    listCandidates: async (now, limit, cursorId) => {
      const { db } = await import("@/lib/db");
      const rows = await db.pendingAction.findMany({
        where: feedbackSweepWhere(now),
        select: { id: true },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: limit,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      });
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
