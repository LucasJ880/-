/**
 * Phase 3B-A：助手七态类型与纯函数（客户端可安全导入，无 DB）
 */

import type { FollowupOutcome } from "./followup-outcome";

export type AssistantTaskStatus =
  | "received"
  | "planning"
  | "running"
  | "waiting_for_confirmation"
  | "completed"
  | "failed"
  | "cancelled";

export type AssistantRunStepType =
  | "intent"
  | "data_lookup"
  | "permission_check"
  | "tool_execution"
  | "approval_required"
  | "result";

export type AssistantActionSummary = {
  total: number;
  pending: number;
  approved: number;
  executed: number;
  rejected: number;
  failed: number;
  expired: number;
};

export type AssistantRetryKind = "safe_reprepare" | "manual_review" | null;

export type AssistantRunStatusDto = {
  runId: string;
  conversationId: string;
  organizationId: string;
  initiatedByPrincipalId: string;
  /** AgentRun.userMessageId → AiMessage(user) */
  userMessageId: string | null;
  /** metadata.assistantMessageId → AiMessage(assistant) */
  assistantMessageId: string | null;
  /** PendingAction.agentRunId 关联 */
  pendingActionIds: string[];
  status: AssistantTaskStatus;
  intent: string | null;
  currentStep: {
    type: AssistantRunStepType;
    title: string;
  } | null;
  /**
   * 优先 metadata.scenarioErrorCode（如 DRAFT_CREATION_FAILED），
   * 否则回退 AgentRun.errorCode（枚举如 tool_failed）。
   */
  errorCode: string | null;
  resultSummary: string | null;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  actionSummary?: AssistantActionSummary;
  partialCompletion?: boolean;
  partialSideEffects?: boolean;
  canRetry?: boolean;
  retryKind?: AssistantRetryKind;
  /** Agent Runtime 2.0 */
  runtimeVersion?: string | null;
  planSummary?: string | null;
  objective?: string | null;
  runtimeSteps?: Array<{
    stepKey?: string | null;
    title: string;
    status: string;
    /** @deprecated 使用 preferredTool */
    toolName?: string | null;
    preferredTool?: string | null;
    attemptCount?: number;
    errorMessage?: string | null;
    requiresApproval?: boolean;
  }>;
  prioritizedCustomers?: Array<{
    customerName: string;
    score: number;
    reasons: string[];
    evidenceRefs: string[];
  }>;
  awaitingApprovalStepCount?: number;
  verificationLabel?: string | null;
  /**
   * DURABLE_FOLLOWUP_M1：客户跟进持久任务的成果投影（只来自 DB 事实）。
   * 可选字段：旧客户端忽略即可；非跟进任务恒为 undefined。
   */
  followup?: FollowupOutcome;
  /** 服务端判定当前用户可以取消该持久任务（取消走服务端控制） */
  cancellable?: boolean;
};

export type RunStatusEvent = {
  type: "run_status";
  run: AssistantRunStatusDto;
  transition?: AssistantTaskStatus;
};

const STATUS_LABEL: Record<AssistantTaskStatus, string> = {
  received: "已收到",
  planning: "正在分析",
  running: "正在执行",
  waiting_for_confirmation: "等待确认",
  completed: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
};

export function assistantStatusLabel(status: AssistantTaskStatus): string {
  return STATUS_LABEL[status];
}

export function isTerminalAssistantStatus(status: AssistantTaskStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled"
  );
}

export function buildRunStatusEvent(
  run: AssistantRunStatusDto,
  statusOverride?: AssistantTaskStatus,
): RunStatusEvent {
  const status = statusOverride ?? run.status;
  const dto: AssistantRunStatusDto = { ...run, status };
  return {
    type: "run_status",
    run: dto,
    transition: status,
  };
}

export function mapAgentRunToAssistantStatus(input: {
  runStatus: string;
  pendingActionStatus?: string | null;
}): AssistantTaskStatus {
  const pa = input.pendingActionStatus;
  if (pa === "pending" || pa === "approved") {
    return "waiting_for_confirmation";
  }
  if (pa === "rejected") return "cancelled";
  if (pa === "failed" || pa === "expired") return "failed";

  switch (input.runStatus) {
    case "queued":
    case "acknowledged":
      return "received";
    case "planning":
    case "planned":
      return "planning";
    case "running":
    case "executing":
    case "verifying":
    case "repairing":
      return "running";
    case "awaiting_approval":
    case "waiting_for_approval":
      return "waiting_for_confirmation";
    case "completed":
    case "partially_executed":
      return "completed";
    case "needs_human":
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "running";
  }
}

export function runMatchesOwner(input: {
  orgId: string;
  activeOrgId: string;
  metadataThreadId: string | null;
  requestThreadId: string;
  sessionUserId: string | null;
  metadataInitiatedByUserId: string | null;
  currentUserId: string;
}): boolean {
  if (input.orgId !== input.activeOrgId) return false;
  if (input.metadataThreadId !== input.requestThreadId) return false;
  if (input.sessionUserId !== input.currentUserId) return false;
  if (
    input.metadataInitiatedByUserId &&
    input.metadataInitiatedByUserId !== input.currentUserId
  ) {
    return false;
  }
  return true;
}

/**
 * 同一 Run 的增量更新：以新 DTO 为准，但新 DTO 没带的展示字段（例如审批回包
 * 里 reconcile 生成的 DTO 不含步骤 / 成果投影）沿用旧值，避免卡片被清空。
 * 只合并同一 runId；不同 Run 直接返回新值。
 */
export function mergeAssistantRunUpdate(
  prev: AssistantRunStatusDto | null | undefined,
  next: AssistantRunStatusDto,
): AssistantRunStatusDto {
  if (!prev || prev.runId !== next.runId) return next;
  return {
    ...next,
    runtimeVersion: next.runtimeVersion ?? prev.runtimeVersion,
    runtimeSteps: next.runtimeSteps ?? prev.runtimeSteps,
    prioritizedCustomers: next.prioritizedCustomers ?? prev.prioritizedCustomers,
    awaitingApprovalStepCount:
      next.awaitingApprovalStepCount ?? prev.awaitingApprovalStepCount,
    objective: next.objective ?? prev.objective,
    planSummary: next.planSummary ?? prev.planSummary,
    verificationLabel: next.verificationLabel ?? prev.verificationLabel,
    followup: next.followup ?? prev.followup,
    cancellable: next.cancellable ?? prev.cancellable,
  };
}

/** 持久跟进任务仍会自行推进（前端据此轮询；等待确认/补充信息时不推进） */
export function isDurableRunProgressing(run: AssistantRunStatusDto): boolean {
  return run.followup?.overall === "in_progress";
}

export function isAssistantRunStatusDto(value: unknown): value is AssistantRunStatusDto {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.runId === "string" &&
    typeof v.conversationId === "string" &&
    typeof v.organizationId === "string" &&
    typeof v.status === "string" &&
    typeof v.initiatedByPrincipalId === "string"
  );
}

export function readAssistantMessageId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const v = (metadata as Record<string, unknown>).assistantMessageId;
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** 场景可恢复错误码（优先于枚举 tool_failed） */
export function readScenarioErrorCode(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const v = (metadata as Record<string, unknown>).scenarioErrorCode;
  return typeof v === "string" && v.length > 0 ? v : null;
}
