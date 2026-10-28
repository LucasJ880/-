/**
 * Muse Bridge — 契约 v1（`muse-bridge/v1`）
 *
 * 青砚 ↔ Muse-Bridge-bot 之间唯一的数据边界。原则：
 *   1. 下行是**有限意图集**，不是自由文本转发。Bridge 负责把 Muse 的自然语言映射到 intent，
 *      青砚只接受白名单里的 intent + 结构化 args；未知 intent 整包拒绝。
 *   2. 上行是**事件信封**：每条事件 = 一句话摘要 + 一个可直接回复的动作（approvalId 或下一个建议 intent）。
 *   3. 一切带事实写入 / 状态变更 / 对外发送的动作只在青砚执行（审批走 ApprovalPort 单入口）。
 *   4. 版本字面量 + `.strip()`：reader fail-closed（参照 workforce-task/v1 契约纪律）。
 *   5. 契约层零 DB、零 LLM、零出站——纯 schema，可被任何运行时复用。
 */

import { z } from "zod";

export const MUSE_BRIDGE_CONTRACT_VERSION = "muse-bridge/v1" as const;

// ── 意图集 ───────────────────────────────────────────────────────

/** 全部意图（含尚未实施的，便于 Bridge 侧先对齐词表）。 */
export const MUSE_INTENTS = [
  "status",
  "ask",
  "approve",
  "reject",
  "follow_tender",
  "rfq",
  "chase",
  "compare",
  "price_scenario",
  "next_step",
  "set_preference",
  "preferences",
  // TASKFLOW S1（Sales Pilot）：只读销售意图
  "sales_overview",
  "opportunity_status",
  // TASKFLOW S2：跨助理询问与回复（内部写，预授权）
  "ask_colleague",
  "reply_inquiry",
  // TASKFLOW S3：跟进（内部写，预授权）
  "create_followup",
  "update_followup",
] as const;
export type MuseIntent = (typeof MUSE_INTENTS)[number];

/**
 * Phase 0 默认放行的意图；其余由 env `MUSE_BRIDGE_INTENTS` 逐个开启（见 flags.ts）。
 * next_step（只读查表）与 preferences / set_preference（只改本人偏好）是 P1-8 加进默认集的。
 */
export const MUSE_PHASE0_INTENTS: readonly MuseIntent[] = ["status", "ask", "approve", "reject", "next_step", "set_preference", "preferences"];

/** 个人偏好可改的键（偏好里不存任何金额） */
export const MUSE_PREF_KEYS = ["defaultSupplierIds", "defaultIncoterm", "chaseAfterDays"] as const;

/** 询价可用的贸易条款（rfq 意图的 incoterm 参数与偏好 defaultIncoterm 共用） */
export const MUSE_INCOTERMS = ["EXW", "FOB", "CIF", "DDP", "DAP"] as const;
export type MusePrefKey = (typeof MUSE_PREF_KEYS)[number];

/** 各意图所属阶段（文档 + 错误提示用；路由拒绝时如实告知"哪一阶段才有"）。 */
export const MUSE_INTENT_PHASE: Record<MuseIntent, 0 | 1 | 2 | 3> = {
  status: 0,
  ask: 0,
  approve: 0,
  reject: 0,
  rfq: 1,
  chase: 1,
  compare: 1,
  price_scenario: 1,
  next_step: 0,
  set_preference: 0,
  preferences: 0,
  follow_tender: 2,
  // Sales Pilot（TASKFLOW Phase S）与招投标 Phase 1 同期按需开放
  sales_overview: 1,
  opportunity_status: 1,
  ask_colleague: 1,
  reply_inquiry: 1,
  create_followup: 1,
  update_followup: 1,
};

const trimmed = (max: number) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim().slice(0, max) : v), z.string().min(1));

const idField = z.string().min(1).max(64);

/** S2：负责人回复时可勾选的支持需求 */
export const MUSE_INQUIRY_NEEDS = ["material", "meeting", "sample", "quote_revision", "other"] as const;
export type MuseInquiryNeed = (typeof MUSE_INQUIRY_NEEDS)[number];

/** S3：跟进可改到的状态（open 只由创建产生；auto_resolved 只属于数字员工自动行动） */
export const MUSE_FOLLOWUP_UPDATE_STATUSES = ["in_progress", "completed", "dismissed"] as const;
export type MuseFollowupUpdateStatus = (typeof MUSE_FOLLOWUP_UPDATE_STATUSES)[number];

// ── 下行：命令 ──────────────────────────────────────────────────

/** 各意图的 args（discriminated union，未知 intent 直接失败）。 */
export const museCommandArgsSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("status"), projectId: idField.optional() }).strip(),
  z.object({ intent: z.literal("ask"), projectId: idField, question: trimmed(2000) }).strip(),
  z
    .object({
      intent: z.literal("approve"),
      approvalId: idField,
      note: trimmed(500).optional(),
      acceptedWithRisk: z.boolean().optional(),
    })
    .strip(),
  z.object({ intent: z.literal("reject"), approvalId: idField, reason: trimmed(500).optional() }).strip(),
  z
    .object({ intent: z.literal("follow_tender"), url: z.string().url().optional(), noticeId: idField.optional() })
    .strip(),
  z
    .object({
      intent: z.literal("rfq"),
      projectId: idField,
      supplierIds: z.array(idField).min(1).max(10).optional(),
      supplierHint: trimmed(300).optional(),
      scope: trimmed(2000).optional(),
      // 显式指定 > 个人偏好 defaultIncoterm；大小写不敏感
      incoterm: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() : v), z.enum(MUSE_INCOTERMS)).optional(),
    })
    .strip(),
  // P1-7：不指定 inquiryId → 最新一轮；不指定 itemIds → 该轮所有该催 / 该追问的
  z.object({ intent: z.literal("chase"), projectId: idField, inquiryId: idField.optional(), itemIds: z.array(idField).min(1).max(20).optional() }).strip(),
  z.object({ intent: z.literal("compare"), projectId: idField, inquiryId: idField.optional() }).strip(),
  z
    .object({
      intent: z.literal("price_scenario"),
      projectId: idField,
      candidatePrice: z.number().positive().optional(),
      /** 按哪家供应商的落地价算（InquiryItem.id）；不给 → 推荐的那家，没有推荐则最便宜的那家 */
      supplierItemId: idField.optional(),
    })
    .strip(),
  z.object({ intent: z.literal("next_step"), projectId: idField }).strip(),
  z
    .object({
      intent: z.literal("set_preference"),
      key: z.enum(MUSE_PREF_KEYS),
      /** 按 key 再校验（prefs-pure.applyPreference）：供应商 id 列表 / 贸易条款 / 天数 / null 清空 */
      value: z.union([z.array(idField).max(5), z.string().max(20), z.number(), z.null()]),
    })
    .strip(),
  z.object({ intent: z.literal("preferences") }).strip(),
  // S1：读范围由服务端角色决定；assigneeUserId 只是过滤条件，不提升权限
  z
    .object({
      intent: z.literal("sales_overview"),
      days: z.number().int().min(1).max(90).optional(),
      assigneeUserId: idField.optional(),
      limit: z.number().int().min(1).max(20).optional(),
    })
    .strip(),
  z.object({ intent: z.literal("opportunity_status"), opportunityId: idField }).strip(),
  // S2：收件人由服务端取商机负责人，请求不能指定
  z
    .object({
      intent: z.literal("ask_colleague"),
      opportunityId: idField,
      questions: z.array(trimmed(300)).min(1).max(5),
      replyBy: z.string().datetime().optional(),
      note: trimmed(500).optional(),
    })
    .strip(),
  z
    .object({
      intent: z.literal("reply_inquiry"),
      inquiryId: idField,
      nextStep: trimmed(300),
      customerFeedback: trimmed(1000).optional(),
      lastContactAt: z.string().datetime().optional(),
      nextStepDueAt: z.string().datetime().optional(),
      needs: z.array(z.enum(MUSE_INQUIRY_NEEDS)).max(5).optional(),
      note: trimmed(1000).optional(),
    })
    .strip(),
  // S3：管理角色可指定负责人（本组织有效成员）；销售只能给自己建
  z
    .object({
      intent: z.literal("create_followup"),
      opportunityId: idField,
      title: trimmed(200),
      dueAt: z.string().datetime(),
      fromInquiryId: idField.optional(),
      assigneeUserId: idField.optional(),
    })
    .strip(),
  // 完成须带 evidence，搁置须带 reason（服务端校验，见 followup-pure）
  z
    .object({
      intent: z.literal("update_followup"),
      followupId: idField,
      status: z.enum(MUSE_FOLLOWUP_UPDATE_STATUSES),
      evidence: trimmed(2000).optional(),
      reason: trimmed(2000).optional(),
    })
    .strip(),
]);
export type MuseCommandArgs = z.infer<typeof museCommandArgsSchema>;

/** 命令信封。`museUserRef` 由 Bridge 给出（Muse 侧稳定用户标识），青砚通过绑定表解析为 userId。 */
export const museCommandEnvelopeSchema = z
  .object({
    contractVersion: z.literal(MUSE_BRIDGE_CONTRACT_VERSION),
    /** Bridge 生成；同 requestId 重放必须幂等（青砚按 requestId 去重 24h）。 */
    requestId: z.string().min(8).max(128),
    /** 绑定键：Bridge 部署按 org 配置，命令必须声明目标 org；fail-closed。 */
    orgId: idField,
    museUserRef: z.string().min(1).max(200),
    /** Muse 原话（仅审计/调试，路由绝不解析它）。 */
    utterance: z.string().max(4000).optional(),
    command: museCommandArgsSchema,
    sentAt: z.string().datetime().optional(),
  })
  .strip();
export type MuseCommandEnvelope = z.infer<typeof museCommandEnvelopeSchema>;

// ── 下行：响应 ──────────────────────────────────────────────────

export const MUSE_ERROR_CODES = [
  "BRIDGE_DISABLED",
  "INTENT_NOT_ENABLED",
  "USER_NOT_BOUND",
  "ORG_MEMBERSHIP_REQUIRED",
  "PROJECT_NOT_FOUND",
  "APPROVAL_FAILED",
  "VALIDATION_FAILED",
  "DUPLICATE_REQUEST",
  "INTERNAL",
  // S1：销售意图
  "PERMISSION_DENIED",
  "OPPORTUNITY_NOT_FOUND",
  // S2：询问与回复
  "INQUIRY_NOT_FOUND",
  "INQUIRY_CLOSED",
  "OPPORTUNITY_UNASSIGNED",
  // S3：跟进
  "FOLLOWUP_NOT_FOUND",
  "FOLLOWUP_CLOSED",
] as const;
export type MuseErrorCode = (typeof MUSE_ERROR_CODES)[number];

/** 响应里"下一步可以直接说的话"——Muse 把它渲染成按钮/建议回复。 */
export const museSuggestedActionSchema = z
  .object({
    label: z.string().min(1).max(60),
    /** 直接可发回青砚的 command（已结构化），Bridge 不需要再做 NLU。 */
    command: museCommandArgsSchema,
  })
  .strip();
export type MuseSuggestedAction = z.infer<typeof museSuggestedActionSchema>;

export const museCommandResponseSchema = z
  .object({
    contractVersion: z.literal(MUSE_BRIDGE_CONTRACT_VERSION),
    requestId: z.string(),
    ok: z.boolean(),
    /** 给人看的一段话（≤ 1200 字），Muse 原样转述；不含内部成本/毛利/估值。 */
    message: z.string().max(1200),
    /** 结构化附件（status 列表、比价表等），Muse 可选渲染。 */
    data: z.unknown().optional(),
    suggestedActions: z.array(museSuggestedActionSchema).max(4).default([]),
    errorCode: z.enum(MUSE_ERROR_CODES).optional(),
    /** 对未启用意图：告知所属阶段，诚实不装。 */
    availableInPhase: z.number().int().min(0).max(3).optional(),
  })
  .strip();
export type MuseCommandResponse = z.infer<typeof museCommandResponseSchema>;

// ── 上行：事件 ──────────────────────────────────────────────────

export const MUSE_EVENT_TYPES = [
  "brief.daily",
  "analysis.ready",
  "approval.requested",
  "approval.resolved",
  "reply.received",
  "quote.parsed",
  "missing_fields",
  "addendum.detected",
  "deadline.approaching",
  /** P1-7：催满两次（或截止已过）仍没回 → 已标未响应 */
  "no_response",
  /** S2：询问收件人 / 发起人；inquiry.overdue 由 S3 的逾期扫描发出 */
  "inquiry.received",
  "inquiry.replied",
  "inquiry.overdue",
  /** S3：跟进负责人 / 创建人；due 与 overdue 由 sales-actions cron 的提醒扫描发出 */
  "followup.assigned",
  "followup.due",
  "followup.overdue",
  "followup.updated",
] as const;
export type MuseEventType = (typeof MUSE_EVENT_TYPES)[number];

export const museEventEnvelopeSchema = z
  .object({
    contractVersion: z.literal(MUSE_BRIDGE_CONTRACT_VERSION),
    /** 幂等键：同一业务事实只推一次（= Notification.sourceKey）。 */
    eventId: z.string().min(8).max(200),
    type: z.enum(MUSE_EVENT_TYPES),
    orgId: idField,
    /** 事件投递给哪个青砚用户（Bridge 据此路由到他的 Muse）。 */
    userId: idField,
    projectId: idField.optional(),
    projectName: z.string().max(200).optional(),
    /** S2：销售协作事件的关联对象 */
    opportunityId: idField.optional(),
    inquiryId: idField.optional(),
    followupId: idField.optional(),
    /** 一句话摘要（≤ 300 字），已脱敏。 */
    summary: z.string().min(1).max(300),
    /** 一条可直接回复的动作（审批卡 / 下一个建议意图）。 */
    action: museSuggestedActionSchema.optional(),
    /** 审批类事件专用：approvalId + 过期时间。过期 ≠ 拒绝。 */
    approval: z
      .object({ approvalId: idField, kind: z.enum(["pending_action", "approval_request"]), expiresAt: z.string().datetime().optional() })
      .strip()
      .optional(),
    occurredAt: z.string().datetime(),
  })
  .strip();
export type MuseEventEnvelope = z.infer<typeof museEventEnvelopeSchema>;

// ── 工具 ────────────────────────────────────────────────────────

/** 严格读取：版本不符 / 未知意图 / 多余字段 → 返回 null（fail-closed）。 */
export function parseMuseCommand(input: unknown): { ok: true; value: MuseCommandEnvelope } | { ok: false; issues: string[] } {
  const r = museCommandEnvelopeSchema.safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, issues: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
}

export function isMuseIntent(v: unknown): v is MuseIntent {
  return typeof v === "string" && (MUSE_INTENTS as readonly string[]).includes(v);
}

/** 出站脱敏：响应/事件文本绝不携带内部成本、毛利、估值字段名或数值标签。 */
const OUTBOUND_SENSITIVE_PATTERNS: RegExp[] = [
  /estimatedValue/i,
  /ourBidPrice/i,
  /winningBidPrice/i,
  /\b(gross\s*)?margin\b/i,
  /毛利/,
  /内部成本/,
  /预算上限/,
];

/**
 * strict：财务类意图（compare / price_scenario）额外拦截"利润"字样。
 * 决定 A：供应商落地价（成本线）允许出 Muse；不出的只有毛利率、项目估值、我方最终报价（见上面的常规模式）。
 * 默认模式不拦——status / ask 的招标原文里常有"利润""profit"这类合法说法。
 */
const OUTBOUND_STRICT_PATTERNS: RegExp[] = [/利润/, /\bprofit\b/i];

export function containsOutboundSensitive(text: string, opts: { strict?: boolean } = {}): boolean {
  if (OUTBOUND_SENSITIVE_PATTERNS.some((p) => p.test(text))) return true;
  return !!opts.strict && OUTBOUND_STRICT_PATTERNS.some((p) => p.test(text));
}
