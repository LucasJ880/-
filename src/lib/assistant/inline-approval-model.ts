/**
 * Runtime V2 Inline Approval — 纯函数（可单测）
 */

export type ApprovalRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type InlineActionStatus =
  | "pending"
  | "approved"
  | "executing"
  | "executed"
  | "rejected"
  | "failed"
  | "expired";

export type InlinePendingAction = {
  actionId: string;
  draftType: string;
  title: string;
  preview: string;
  status: InlineActionStatus;
  failureReason?: string;
  agentRunId?: string | null;
  payload?: Record<string, unknown> | null;
};

export const DRAFT_TYPE_LABELS: Record<string, string> = {
  "sales.update_followup": "更新跟进时间",
  "sales.update_stage": "推进商机阶段",
  "calendar.create_event": "创建日历事件",
  "grader.email_draft": "Gmail 草稿",
};

export const INLINE_ACTION_STATUS_LABEL: Record<InlineActionStatus, string> = {
  pending: "等待确认",
  approved: "已确认",
  executing: "执行中",
  executed: "已完成",
  rejected: "已拒绝",
  failed: "失败",
  expired: "已过期",
};

/** 用户级进度（默认折叠技术步骤） */
export type UserProgressStage =
  | "analyze"
  | "prioritize"
  | "awaiting_approval"
  | "execute"
  | "verify";

export const USER_PROGRESS_LABEL: Record<UserProgressStage, string> = {
  analyze: "分析数据",
  prioritize: "选择优先客户",
  awaiting_approval: "等待确认",
  execute: "执行动作",
  verify: "验证结果",
};

export function draftTypeLabel(type: string): string {
  return DRAFT_TYPE_LABELS[type] ?? type;
}

export function isEmailDraftType(type: string): boolean {
  return type === "grader.email_draft";
}

/** Gmail Draft / Calendar / Follow-up 默认可安全审批，无需二次确认 */
export function riskLevelForAction(action: {
  draftType: string;
  payload?: Record<string, unknown> | null;
}): ApprovalRiskLevel {
  const meta = action.payload?.metadata;
  if (meta && typeof meta === "object") {
    const sev = (meta as { issueSeverity?: unknown }).issueSeverity;
    if (sev === "CRITICAL" || sev === "HIGH" || sev === "MEDIUM" || sev === "LOW") {
      return sev;
    }
  }
  // 写操作草稿默认 LOW：不会直接外发邮件
  if (
    action.draftType === "grader.email_draft" ||
    action.draftType === "calendar.create_event" ||
    action.draftType === "sales.update_followup"
  ) {
    return "LOW";
  }
  if (action.draftType === "sales.update_stage") return "MEDIUM";
  return "MEDIUM";
}

export function isSafeToBatchApprove(action: {
  draftType: string;
  payload?: Record<string, unknown> | null;
  status: string;
}): boolean {
  if (action.status !== "pending") return false;
  return riskLevelForAction(action) !== "CRITICAL";
}

export function defaultSelectedActionIds(
  actions: Array<{
    actionId: string;
    draftType: string;
    payload?: Record<string, unknown> | null;
    status: string;
  }>,
): string[] {
  return actions.filter(isSafeToBatchApprove).map((a) => a.actionId);
}

export function extractTargetLabel(action: InlinePendingAction): string {
  const p = action.payload ?? {};
  if (typeof p.customerName === "string" && p.customerName) return p.customerName;
  if (typeof p.to === "string" && p.to) return p.to;
  if (typeof p.opportunityTitle === "string" && p.opportunityTitle) {
    return p.opportunityTitle;
  }
  if (typeof p.title === "string" && p.title) return p.title;
  // 从标题推断：跟进提醒：[AR2-QA] Customer 1
  const m = action.title.match(/[:：]\s*(.+)$/);
  return m?.[1]?.trim() || action.title;
}

export function extractChangeSummary(action: InlinePendingAction): {
  summary: string;
  before: string | null;
  after: string | null;
} {
  const p = action.payload ?? {};
  if (action.draftType === "sales.update_followup") {
    const before =
      typeof p.previousFollowupAt === "string" ? p.previousFollowupAt : null;
    const after = typeof p.nextFollowupAt === "string" ? p.nextFollowupAt : null;
    return {
      summary: action.preview || "调整下次跟进日期",
      before: before ? formatMaybeDate(before) : "未设置",
      after: after ? formatMaybeDate(after) : null,
    };
  }
  if (action.draftType === "sales.update_stage") {
    return {
      summary: action.preview || "推进商机阶段",
      before: typeof p.previousStage === "string" ? p.previousStage : null,
      after: typeof p.newStage === "string" ? p.newStage : null,
    };
  }
  if (action.draftType === "calendar.create_event") {
    const start = typeof p.startTime === "string" ? formatMaybeDate(p.startTime) : null;
    return {
      summary: action.preview || "创建跟进提醒",
      before: "无",
      after: start ? `日历事件 @ ${start}` : (typeof p.title === "string" ? p.title : "新建事件"),
    };
  }
  if (action.draftType === "grader.email_draft") {
    const subject = typeof p.subject === "string" ? p.subject : action.preview;
    const to = typeof p.to === "string" ? p.to : "";
    return {
      summary: subject || "创建邮件草稿",
      before: "无草稿",
      after: to ? `草稿 → ${to}` : "Gmail 草稿（未发送）",
    };
  }
  return {
    summary: action.preview || action.title,
    before: null,
    after: null,
  };
}

function formatMaybeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function primaryConfirmLabel(selectedCount: number): string {
  if (selectedCount <= 0) return "请先选择动作";
  if (selectedCount === 1) return "确认并继续";
  return `确认 ${selectedCount} 个动作并继续`;
}

export function stickyBarLabel(pendingCount: number): string {
  return `${pendingCount} 个动作等待确认`;
}

/** 新文案：1 个步骤等待确认，共 3 个动作。 */
export function formatAwaitingCopy(input: {
  awaitingApprovalSteps: number;
  pendingActions: number;
  executedActions: number;
  rejectedActions: number;
  failedActions: number;
}): string {
  const parts: string[] = [];
  if (input.awaitingApprovalSteps > 0 || input.pendingActions > 0) {
    parts.push(
      `${input.awaitingApprovalSteps} 个步骤等待确认，共 ${input.pendingActions} 个动作`,
    );
  }
  if (input.executedActions > 0) parts.push(`已执行 ${input.executedActions}`);
  if (input.rejectedActions > 0) parts.push(`已拒绝 ${input.rejectedActions}`);
  if (input.failedActions > 0) parts.push(`失败 ${input.failedActions}`);
  return parts.length ? `${parts.join("，")}。` : "";
}

export function simplifyEvidenceRefs(refs: string[]): string[] {
  const labels: string[] = [];
  for (const r of refs.slice(0, 4)) {
    if (r.startsWith("s3")) labels.push("跟进分析");
    else if (r.startsWith("s4")) labels.push("报价风险");
    else if (r.startsWith("s2") || r.startsWith("interaction")) labels.push("商机记录");
    else if (r.includes("quote")) labels.push("报价记录");
    else if (r.includes("close")) labels.push("成交窗口");
    else labels.push("业务信号");
  }
  return Array.from(new Set(labels));
}

export function deriveUserProgress(input: {
  runStatus: string;
  assistantStatus?: string;
  steps?: Array<{ status: string; stepKey?: string | null; requiresApproval?: boolean }>;
  hasPendingActions: boolean;
}): { stage: UserProgressStage; stages: Array<{ id: UserProgressStage; done: boolean; active: boolean }> } {
  const steps = input.steps ?? [];
  const prioritizeDone = steps.some(
    (s) =>
      (s.stepKey === "s5_prioritize" || (s.stepKey ?? "").includes("prioritize")) &&
      (s.status === "completed" || s.status === "skipped"),
  );
  const analyzeDone =
    prioritizeDone ||
    steps.filter((s) => !s.requiresApproval).some((s) => s.status === "completed");
  const awaiting =
    input.hasPendingActions ||
    input.runStatus === "awaiting_approval" ||
    input.assistantStatus === "waiting_for_confirmation";
  const executing =
    ["executing", "running", "repairing"].includes(input.runStatus) && !awaiting;
  const verifying = input.runStatus === "verifying";
  const completed = ["completed", "partially_executed"].includes(input.runStatus);
  const needsHuman = input.runStatus === "needs_human" || input.runStatus === "failed";

  let stage: UserProgressStage = "analyze";
  if (completed || verifying || needsHuman) stage = "verify";
  else if (executing) stage = "execute";
  else if (awaiting) stage = "awaiting_approval";
  else if (prioritizeDone) stage = "prioritize";
  else stage = "analyze";

  const order: UserProgressStage[] = [
    "analyze",
    "prioritize",
    "awaiting_approval",
    "execute",
    "verify",
  ];
  const activeIdx = order.indexOf(stage);
  const stages = order.map((id, i) => ({
    id,
    done:
      i < activeIdx ||
      (id === "verify" && completed) ||
      (id === "analyze" && analyzeDone && activeIdx > 0) ||
      (id === "prioritize" && prioritizeDone && activeIdx > 1),
    active: id === stage,
  }));

  return { stage, stages };
}

export function shortBodySummary(content: string, maxLen = 180): string {
  const trimmed = content.replace(/\n{3,}/g, "\n\n").trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen).trim()}…`;
}

/** 批量确认时是否需要 CRITICAL 二次确认 Modal */
export function needsCriticalConfirm(
  selected: Array<{ draftType: string; payload?: Record<string, unknown> | null }>,
): boolean {
  return selected.some((a) => riskLevelForAction(a) === "CRITICAL");
}
