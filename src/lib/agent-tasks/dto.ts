/**
 * AgentTask API DTO：业务视图 vs 平台诊断视图。
 *
 * 安全契约（Tender/Project Security P0）：
 * 普通业务用户禁止拿到 Agent 执行内幕——inputJson / outputJson /
 * checkReportJson / 原始 error / ApprovalRequest.previewJson / riskReason。
 * 参照 src/lib/conversations/dto.ts：禁止「先返回完整对象再由前端删字段」，
 * 敏感/内部数据在服务端投影时即移除，不出服务端。
 * 平台管理员（isPlatformAdmin）保留完整诊断视图。
 */

/** 业务用户看到的步骤失败提示（不泄露原始 error / stack / 内部原因） */
export const SAFE_STEP_ERROR_MESSAGE = "处理失败，请稍后重试或联系管理员";

/** 服务端应从业务投影中剔除的内部字段（用于测试断言与审计） */
export const AGENT_STEP_INTERNAL_FIELDS = [
  "inputJson",
  "outputJson",
  "checkReportJson",
] as const;

export const APPROVAL_INTERNAL_FIELDS = [
  "previewJson",
  "riskReason",
  "decisionNote",
] as const;

type ApprovalRequestLike = {
  id: string;
  actionType?: string | null;
  riskLevel?: string | null;
  riskReason?: string | null;
  previewJson?: string | null;
  status: string;
  deadlineAt?: Date | string | null;
  decidedAt?: Date | string | null;
  decidedBy?: string | null;
  decisionNote?: string | null;
  acceptedWithRisk?: boolean | null;
  createdAt?: Date | string;
};

type AgentTaskStepLike = {
  id: string;
  stepIndex: number;
  skillId: string;
  agentName: string;
  title: string;
  description?: string | null;
  status: string;
  riskLevel: string;
  requiresApproval: boolean;
  inputJson?: string | null;
  outputJson?: string | null;
  outputSummary?: string | null;
  checkReportJson?: string | null;
  confidence?: number | null;
  error?: string | null;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
  createdAt?: Date | string;
  approvalRequests?: ApprovalRequestLike[];
};

type AgentTaskLike = {
  id: string;
  projectId: string;
  project?: { id: string; name: string } | null;
  taskType: string;
  triggerType: string;
  intent: string;
  riskLevel: string;
  status: string;
  currentStepIndex: number;
  totalSteps: number;
  priority: string;
  requiresApproval: boolean;
  createdById?: string;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
  failedAt?: Date | string | null;
  cancelledAt?: Date | string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  steps?: AgentTaskStepLike[];
  approvalRequests?: ApprovalRequestLike[];
};

/** 业务用户：审批摘要（无 previewJson / riskReason / decisionNote） */
function toBusinessApprovalRequest(a: ApprovalRequestLike) {
  return {
    id: a.id,
    actionType: a.actionType ?? null,
    riskLevel: a.riskLevel ?? null,
    status: a.status,
    deadlineAt: a.deadlineAt ?? null,
    acceptedWithRisk: a.acceptedWithRisk ?? false,
    createdAt: a.createdAt,
  };
}

/** 业务用户：步骤安全视图（无 input/output/checkReport JSON、原始 error 脱敏） */
export function toBusinessAgentTaskStep(step: AgentTaskStepLike) {
  return {
    id: step.id,
    stepIndex: step.stepIndex,
    skillId: step.skillId,
    agentName: step.agentName,
    title: step.title,
    description: step.description ?? null,
    status: step.status,
    riskLevel: step.riskLevel,
    requiresApproval: step.requiresApproval,
    outputSummary: step.outputSummary ?? null,
    confidence: step.confidence ?? null,
    // 内部字段：一律 null（业务视图不出服务端）
    inputJson: null,
    outputJson: null,
    checkReportJson: null,
    hasError: step.status === "error" || step.status === "failed" || !!step.error,
    error:
      step.status === "error" || step.status === "failed" || step.error
        ? SAFE_STEP_ERROR_MESSAGE
        : null,
    startedAt: step.startedAt ?? null,
    completedAt: step.completedAt ?? null,
    createdAt: step.createdAt,
    approvalRequests: (step.approvalRequests ?? []).map(toBusinessApprovalRequest),
  };
}

/** 平台管理员：步骤完整诊断视图（含全部原始字段） */
export function toDiagnosticAgentTaskStep(step: AgentTaskStepLike) {
  return {
    id: step.id,
    stepIndex: step.stepIndex,
    skillId: step.skillId,
    agentName: step.agentName,
    title: step.title,
    description: step.description ?? null,
    status: step.status,
    riskLevel: step.riskLevel,
    requiresApproval: step.requiresApproval,
    inputJson: step.inputJson ?? null,
    outputJson: step.outputJson ?? null,
    outputSummary: step.outputSummary ?? null,
    checkReportJson: step.checkReportJson ?? null,
    confidence: step.confidence ?? null,
    error: step.error ?? null,
    startedAt: step.startedAt ?? null,
    completedAt: step.completedAt ?? null,
    createdAt: step.createdAt,
    approvalRequests: step.approvalRequests ?? [],
  };
}

function toTaskEnvelope(task: AgentTaskLike) {
  return {
    id: task.id,
    projectId: task.projectId,
    project: task.project ?? null,
    taskType: task.taskType,
    triggerType: task.triggerType,
    intent: task.intent,
    riskLevel: task.riskLevel,
    status: task.status,
    currentStepIndex: task.currentStepIndex,
    totalSteps: task.totalSteps,
    priority: task.priority,
    requiresApproval: task.requiresApproval,
    startedAt: task.startedAt ?? null,
    completedAt: task.completedAt ?? null,
    failedAt: task.failedAt ?? null,
    cancelledAt: task.cancelledAt ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

/** 业务用户：任务详情安全视图 */
export function toBusinessAgentTaskDetail(task: AgentTaskLike) {
  return {
    ...toTaskEnvelope(task),
    steps: (task.steps ?? []).map(toBusinessAgentTaskStep),
    approvalRequests: (task.approvalRequests ?? []).map(toBusinessApprovalRequest),
  };
}

/** 平台管理员：任务详情完整诊断视图 */
export function toDiagnosticAgentTaskDetail(task: AgentTaskLike) {
  return {
    ...toTaskEnvelope(task),
    createdById: task.createdById,
    steps: (task.steps ?? []).map(toDiagnosticAgentTaskStep),
    approvalRequests: task.approvalRequests ?? [],
  };
}

/**
 * 列表视图的步骤（list GET 已用 select 排除 input/output JSON）——
 * 仅需把原始 error 脱敏；平台管理员保留原始 error。
 */
export function sanitizeListStepError<T extends { status: string; error?: string | null }>(
  step: T,
  diagnostic: boolean,
): T & { error: string | null } {
  if (diagnostic) return { ...step, error: step.error ?? null };
  const hasError = step.status === "error" || step.status === "failed" || !!step.error;
  return { ...step, error: hasError ? SAFE_STEP_ERROR_MESSAGE : null };
}
