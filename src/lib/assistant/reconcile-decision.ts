/**
 * Run 收敛决策纯函数（无 DB，可单测）
 */

export type EffectiveActionStatus =
  | "pending"
  | "approved"
  | "executed"
  | "rejected"
  | "failed"
  | "expired";

export type ActionSummary = {
  total: number;
  pending: number;
  approved: number;
  executed: number;
  rejected: number;
  failed: number;
  expired: number;
};

export type RetryKind = "safe_reprepare" | "manual_review" | null;

export type ReconcileDecision = {
  kind: "noop_no_actions" | "awaiting" | "completed" | "cancelled" | "failed";
  dbStatus: "awaiting_approval" | "completed" | "cancelled" | "failed";
  assistantStatus:
    | "waiting_for_confirmation"
    | "completed"
    | "cancelled"
    | "failed"
    | "running";
  resultSummary: string;
  userFacingSummary: string;
  eventKey: string;
  counts: ActionSummary;
  partialCompletion: boolean;
  partialSideEffects: boolean;
  canRetry: boolean;
  retryKind: RetryKind;
  metadataPatch: Record<string, unknown>;
  terminalEventType:
    | "run.completed"
    | "run.cancelled"
    | "run.failed"
    | null;
  terminalEventTitle: string | null;
};

export function effectiveActionStatus(
  action: { status: string; expiresAt: Date | string | null },
  now: Date = new Date(),
): EffectiveActionStatus {
  const status = action.status;
  if (status === "pending") {
    const exp = action.expiresAt ? new Date(action.expiresAt) : null;
    if (exp && !Number.isNaN(exp.getTime()) && exp.getTime() <= now.getTime()) {
      return "expired";
    }
    return "pending";
  }
  if (
    status === "approved" ||
    status === "executed" ||
    status === "rejected" ||
    status === "failed"
  ) {
    return status;
  }
  return "failed";
}

export function summarizeActions(
  actions: Array<{ status: string; expiresAt: Date | string | null }>,
  now: Date = new Date(),
): ActionSummary {
  const counts: ActionSummary = {
    total: actions.length,
    pending: 0,
    approved: 0,
    executed: 0,
    rejected: 0,
    failed: 0,
    expired: 0,
  };
  for (const a of actions) {
    counts[effectiveActionStatus(a, now)] += 1;
  }
  return counts;
}

export function decideRunReconcile(
  actions: Array<{ status: string; expiresAt: Date | string | null }>,
  now: Date = new Date(),
  opts?: { safeToRetryHint?: boolean },
): ReconcileDecision {
  const counts = summarizeActions(actions, now);

  if (counts.total === 0) {
    return {
      kind: "noop_no_actions",
      dbStatus: "awaiting_approval",
      assistantStatus: "running",
      resultSummary: "no_actions",
      userFacingSummary: "",
      eventKey: "noop_no_actions",
      counts,
      partialCompletion: false,
      partialSideEffects: false,
      canRetry: opts?.safeToRetryHint === true,
      retryKind: opts?.safeToRetryHint ? "safe_reprepare" : null,
      metadataPatch: {},
      terminalEventType: null,
      terminalEventTitle: null,
    };
  }

  const open = counts.pending + counts.approved;
  if (open > 0) {
    return {
      kind: "awaiting",
      dbStatus: "awaiting_approval",
      assistantStatus: "waiting_for_confirmation",
      resultSummary: "awaiting_confirmation",
      userFacingSummary:
        open === 1
          ? "还剩 1 项动作等待确认"
          : `还剩 ${open} 项动作等待确认`,
      eventKey: `awaiting:${counts.pending}:${counts.approved}:${counts.executed}`,
      counts,
      partialCompletion: false,
      partialSideEffects: counts.executed > 0,
      canRetry: false,
      retryKind: null,
      metadataPatch: {
        resultSummary: "awaiting_confirmation",
        actionSummary: counts,
        partialCompletion: false,
        partialSideEffects: counts.executed > 0,
      },
      terminalEventType: null,
      terminalEventTitle: null,
    };
  }

  if (counts.failed + counts.expired > 0) {
    const partialSideEffects = counts.executed > 0;
    return {
      kind: "failed",
      dbStatus: "failed",
      assistantStatus: "failed",
      resultSummary: partialSideEffects
        ? "partial_side_effects_failed"
        : counts.expired > 0 && counts.failed === 0
          ? "all_actions_expired"
          : "action_execution_failed",
      userFacingSummary: partialSideEffects
        ? "部分动作已执行，另有动作失败。已完成的操作不会自动回滚。"
        : counts.expired > 0 && counts.executed === 0
          ? "确认已过期，请重新生成操作。"
          : "动作执行失败。",
      eventKey: `failed:e${counts.executed}:f${counts.failed}:x${counts.expired}`,
      counts,
      partialCompletion: false,
      partialSideEffects,
      canRetry: false,
      retryKind: "manual_review",
      metadataPatch: {
        resultSummary: partialSideEffects
          ? "partial_side_effects_failed"
          : "action_execution_failed",
        scenarioErrorCode: partialSideEffects
          ? "PARTIAL_SIDE_EFFECTS"
          : counts.expired > 0
            ? "ACTION_EXPIRED"
            : "ACTION_EXECUTION_FAILED",
        partialSideEffects,
        executedActionCount: counts.executed,
        failedActionCount: counts.failed,
        expiredActionCount: counts.expired,
        actionSummary: counts,
        safeToRetry: false,
      },
      terminalEventType: "run.failed",
      terminalEventTitle: "run.failed",
    };
  }

  if (counts.executed > 0 && counts.rejected > 0) {
    return {
      kind: "completed",
      dbStatus: "completed",
      assistantStatus: "completed",
      resultSummary: "partially_executed",
      userFacingSummary: `任务已结束：${counts.executed} 项已完成，${counts.rejected} 项已取消。`,
      eventKey: `completed:partial:e${counts.executed}:r${counts.rejected}`,
      counts,
      partialCompletion: true,
      partialSideEffects: false,
      canRetry: false,
      retryKind: null,
      metadataPatch: {
        resultSummary: "partially_executed",
        partialCompletion: true,
        executedActionCount: counts.executed,
        rejectedActionCount: counts.rejected,
        actionSummary: counts,
      },
      terminalEventType: "run.completed",
      terminalEventTitle: "approval.all_executed_partial",
    };
  }

  if (counts.executed === counts.total) {
    return {
      kind: "completed",
      dbStatus: "completed",
      assistantStatus: "completed",
      resultSummary: "all_actions_executed",
      userFacingSummary: "所有确认动作已完成",
      eventKey: `completed:all:${counts.executed}`,
      counts,
      partialCompletion: false,
      partialSideEffects: false,
      canRetry: false,
      retryKind: null,
      metadataPatch: {
        resultSummary: "all_actions_executed",
        partialCompletion: false,
        executedActionCount: counts.executed,
        actionSummary: counts,
      },
      terminalEventType: "run.completed",
      terminalEventTitle: "approval.all_executed",
    };
  }

  if (counts.rejected === counts.total) {
    return {
      kind: "cancelled",
      dbStatus: "cancelled",
      assistantStatus: "cancelled",
      resultSummary: "all_actions_rejected",
      userFacingSummary: "所有待确认动作已取消",
      eventKey: `cancelled:all:${counts.rejected}`,
      counts,
      partialCompletion: false,
      partialSideEffects: false,
      canRetry: false,
      retryKind: null,
      metadataPatch: {
        resultSummary: "all_actions_rejected",
        rejectedActionCount: counts.rejected,
        actionSummary: counts,
      },
      terminalEventType: "run.cancelled",
      terminalEventTitle: "approval.all_rejected",
    };
  }

  return {
    kind: "failed",
    dbStatus: "failed",
    assistantStatus: "failed",
    resultSummary: "reconcile_inconsistent",
    userFacingSummary: "任务状态不一致，请联系支持或重新生成操作。",
    eventKey: "failed:inconsistent",
    counts,
    partialCompletion: false,
    partialSideEffects: counts.executed > 0,
    canRetry: false,
    retryKind: "manual_review",
    metadataPatch: {
      resultSummary: "reconcile_inconsistent",
      actionSummary: counts,
      safeToRetry: false,
    },
    terminalEventType: "run.failed",
    terminalEventTitle: "run.failed",
  };
}

export function deriveRetryFlags(input: {
  runStatus: string;
  metadata: unknown;
  actions: Array<{ status: string; expiresAt: Date | string | null }>;
  now?: Date;
}): { canRetry: boolean; retryKind: RetryKind } {
  const now = input.now ?? new Date();
  const meta = (input.metadata ?? {}) as Record<string, unknown>;
  const counts = summarizeActions(input.actions, now);

  if (input.runStatus !== "failed") {
    return { canRetry: false, retryKind: null };
  }

  // 安全重试：仅 Prepare/分析失败，无任何 PA，且标记 safeToRetry
  if (counts.total === 0 && meta.safeToRetry === true) {
    const attempt =
      typeof meta.retryAttempt === "number" ? meta.retryAttempt : 0;
    if (attempt >= 2) {
      return { canRetry: false, retryKind: "manual_review" };
    }
    return { canRetry: true, retryKind: "safe_reprepare" };
  }

  // 有 executed / failed / expired → 可能已有外部副作用
  if (counts.executed > 0 || counts.failed > 0 || counts.expired > 0) {
    return { canRetry: false, retryKind: "manual_review" };
  }

  if (counts.rejected > 0) {
    return { canRetry: false, retryKind: "manual_review" };
  }

  return { canRetry: false, retryKind: "manual_review" };
}
