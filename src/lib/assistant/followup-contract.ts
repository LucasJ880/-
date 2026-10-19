/**
 * QINGYAN_ASSISTANT_DURABLE_FOLLOWUP_M1 — 客户跟进持久任务契约（纯模块，零依赖，客户端可安全导入）
 *
 * 一个"客户跟进持久任务" = 一个 workforce_job（AgentRun），计划由服务端按
 * 用户明确要求生成（ServerAuthoredPlanV1），并穿过与 LLM 计划相同的共享编译链。
 * 本文件只定义：
 *   - 契约版本 / 工具名 / 任务（step）键
 *   - AgentRun.metadata 中本契约使用的键（只能由服务端经 createWorkforceJob
 *     的 extraMetadata 写入；客户端无任何写入通道）
 *   - metadata → 结构化上下文的只读解析（adapter / 状态投影共用，不允许两套解析）
 *
 * 不含任何授权语义：执行期授权仍完整走 principal → membership → canInvokeTool →
 * PendingAction 审批链。
 */

export const FOLLOWUP_TASK_CONTRACT = "assistant-followup/v1" as const;

/** 本轮工具上限：既有排序工具最多选 3 个客户 */
export const FOLLOWUP_MAX_TOP_N = 3;

/**
 * 本契约引用的 Runtime V2 工具名（只是名字常量，不是注册表：描述符与 handler
 * 全部登记在既有的 agent-runtime-v2 工具目录与 adapters handler map 中）
 */
export const FOLLOWUP_TOOL = {
  attachmentEvidence: "sales_followup_attachment_evidence",
  carryTargets: "sales_followup_carry_targets",
  opportunities: "sales_list_opportunities",
  followupAnalysis: "sales_customer_followup_analysis",
  quoteRisk: "sales_quote_risk_analysis",
  prioritize: "sales_prioritize_followups",
  prepareActions: "sales_prepare_followup_actions",
} as const;

export type FollowupToolName = (typeof FOLLOWUP_TOOL)[keyof typeof FOLLOWUP_TOOL];

/** 任务（AgentRunStep.stepKey）键：固定、可读、按拓扑顺序 */
export const FOLLOWUP_STEP = {
  attachmentEvidence: "f1_attachment_evidence",
  carryTargets: "f1_carry_targets",
  opportunities: "f2_opportunities",
  followupAnalysis: "f3_followup_analysis",
  quoteRisk: "f4_quote_risk",
  prioritize: "f5_prioritize",
  prepareActions: "f6_prepare_actions",
} as const;

export type FollowupDeliverable = "analysis" | "email_drafts" | "reminders";

export type FollowupMissingInput = "reminder_time" | "timezone";

export type FollowupUnsupportedCode =
  | "send_email"
  | "auto_order"
  | "payment"
  | "bulk_delete";

export type FollowupEmailUnavailableReason = "gmail_disabled" | "tool_denied";

/**
 * AgentRun.metadata 键（extraMetadata 通道：≤16 键、仅原始值、≤500 字符）。
 * 不得与 createWorkforceJob 的保留键冲突（runtimeVersion/goal/threadId/... 均不在此列）。
 */
export const FOLLOWUP_META = {
  contract: "followupContract",
  requestId: "requestId",
  assistantMessageId: "assistantMessageId",
  topN: "followupTopN",
  deliverables: "followupDeliverables",
  reminderAt: "followupReminderAt",
  reminderTimezone: "followupReminderTimezone",
  reminderTimezoneSource: "followupReminderTzSource",
  missing: "followupMissing",
  unsupported: "followupUnsupported",
  emailSendRequested: "followupEmailSendRequested",
  emailUnavailable: "followupEmailUnavailable",
  attachmentCount: "followupAttachmentCount",
  parentRunId: "followupParentRunId",
  targetCustomerIds: "followupTargetCustomerIds",
} as const;

export type FollowupRunContext = {
  contract: typeof FOLLOWUP_TASK_CONTRACT;
  requestId: string | null;
  topN: number;
  deliverables: FollowupDeliverable[];
  /** UTC ISO；只来自用户明确输入（服务端解析） */
  reminderAt: string | null;
  reminderTimezone: string | null;
  reminderTimezoneSource: "user_explicit" | "org_profile" | null;
  missing: FollowupMissingInput[];
  unsupported: FollowupUnsupportedCode[];
  emailSendRequested: boolean;
  emailUnavailable: FollowupEmailUnavailableReason | null;
  attachmentCount: number;
  parentRunId: string | null;
  targetCustomerIds: string[];
  initiatedByUserId: string | null;
  threadId: string | null;
  assistantMessageId: string | null;
};

const DELIVERABLES: readonly FollowupDeliverable[] = [
  "analysis",
  "email_drafts",
  "reminders",
];
const MISSING: readonly FollowupMissingInput[] = ["reminder_time", "timezone"];
const UNSUPPORTED: readonly FollowupUnsupportedCode[] = [
  "send_email",
  "auto_order",
  "payment",
  "bulk_delete",
];

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function csv<T extends string>(v: unknown, allowed: readonly T[]): T[] {
  const s = str(v);
  if (!s) return [];
  const out: T[] = [];
  for (const part of s.split(",")) {
    const p = part.trim() as T;
    if (allowed.includes(p) && !out.includes(p)) out.push(p);
  }
  return out;
}

function idList(v: unknown, max: number): string[] {
  const s = str(v);
  if (!s) return [];
  const out: string[] = [];
  for (const part of s.split(",")) {
    const p = part.trim();
    if (/^[A-Za-z0-9_-]{1,64}$/.test(p) && !out.includes(p)) out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * metadata → 跟进任务上下文。非本契约（含 legacy runtime_v2 / tender / 其他
 * workforce job）一律返回 null——调用方据此 fail-closed 或走原有行为。
 */
export function readFollowupRunContext(
  metadata: unknown,
): FollowupRunContext | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const m = metadata as Record<string, unknown>;
  if (m[FOLLOWUP_META.contract] !== FOLLOWUP_TASK_CONTRACT) return null;

  const rawTop = Number(m[FOLLOWUP_META.topN]);
  const topN =
    Number.isInteger(rawTop) && rawTop >= 1
      ? Math.min(rawTop, FOLLOWUP_MAX_TOP_N)
      : FOLLOWUP_MAX_TOP_N;

  const reminderAtRaw = str(m[FOLLOWUP_META.reminderAt]);
  const reminderAt =
    reminderAtRaw && !Number.isNaN(new Date(reminderAtRaw).getTime())
      ? new Date(reminderAtRaw).toISOString()
      : null;
  const tzSource = str(m[FOLLOWUP_META.reminderTimezoneSource]);
  const emailUnavailable = str(m[FOLLOWUP_META.emailUnavailable]);
  const attachmentCount = Number(m[FOLLOWUP_META.attachmentCount]);

  return {
    contract: FOLLOWUP_TASK_CONTRACT,
    requestId: str(m[FOLLOWUP_META.requestId]),
    topN,
    deliverables: csv(m[FOLLOWUP_META.deliverables], DELIVERABLES),
    reminderAt,
    reminderTimezone: str(m[FOLLOWUP_META.reminderTimezone]),
    reminderTimezoneSource:
      tzSource === "user_explicit" || tzSource === "org_profile"
        ? tzSource
        : null,
    missing: csv(m[FOLLOWUP_META.missing], MISSING),
    unsupported: csv(m[FOLLOWUP_META.unsupported], UNSUPPORTED),
    emailSendRequested: m[FOLLOWUP_META.emailSendRequested] === true,
    emailUnavailable:
      emailUnavailable === "gmail_disabled" || emailUnavailable === "tool_denied"
        ? emailUnavailable
        : null,
    attachmentCount:
      Number.isInteger(attachmentCount) && attachmentCount > 0
        ? attachmentCount
        : 0,
    parentRunId: str(m[FOLLOWUP_META.parentRunId]),
    targetCustomerIds: idList(m[FOLLOWUP_META.targetCustomerIds], 10),
    initiatedByUserId: str(m.initiatedByUserId),
    threadId: str(m.threadId),
    assistantMessageId: str(m[FOLLOWUP_META.assistantMessageId]),
  };
}

/** 提醒是否可以生成：必须同时具备用户明确时间与可信时区 */
export function followupReminderSchedule(
  ctx: FollowupRunContext,
): { startAt: string; timezone: string } | null {
  if (!ctx.deliverables.includes("reminders")) return null;
  if (!ctx.reminderAt || !ctx.reminderTimezone) return null;
  return { startAt: ctx.reminderAt, timezone: ctx.reminderTimezone };
}

export type WallParts = {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  /** 1=周一 … 7=周日 */
  weekday: number;
};

/** 某一 UTC 瞬间在业务时区下的墙钟时间（Intl，非服务器本地时区） */
export function wallPartsInTz(instant: Date, tz: string): WallParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) parts[p.type] = p.value;
  const wd =
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday) + 1;
  return {
    y: Number(parts.year),
    mo: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour) % 24,
    mi: Number(parts.minute),
    weekday: wd,
  };
}

/** 以业务时区展示（"2026-10-20 15:00"） */
export function formatInTimezone(iso: string, tz: string): string {
  const w = wallPartsInTz(new Date(iso), tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${w.y}-${pad(w.mo)}-${pad(w.d)} ${pad(w.h)}:${pad(w.mi)}`;
}

export const FOLLOWUP_UNSUPPORTED_LABEL: Record<FollowupUnsupportedCode, string> =
  {
    send_email: "直接发送邮件（本轮只准备 Gmail 草稿，不发送）",
    auto_order: "自动下单",
    payment: "付款 / 转账",
    bulk_delete: "批量删除或清空数据",
  };
