/**
 * 多 PendingAction 审批结果 → Step 状态（纯函数，可单测）
 */

export type PendingActionLite = {
  id: string;
  status: string;
};

export type ReconcileApprovalResult = {
  stepStatus:
    | "completed"
    | "skipped"
    | "partially_executed"
    | "failed"
    | "needs_human"
    | "awaiting_approval";
  runHint:
    | "continue"
    | "awaiting_approval"
    | "needs_human"
    | "noop";
  reason: string;
};

/**
 * expectedPendingActionIds：步骤期望的全部 Action ID。
 * found：按 orgId 查到的行（可能少于 expected）。
 */
export function reconcilePendingActionsForStep(input: {
  expectedPendingActionIds: string[];
  found: PendingActionLite[];
}): ReconcileApprovalResult {
  const expected = input.expectedPendingActionIds.filter(Boolean);
  if (expected.length === 0) {
    return {
      stepStatus: "needs_human",
      runHint: "needs_human",
      reason: "empty_expected_actions",
    };
  }

  const byId = new Map(input.found.map((a) => [a.id, a]));
  if (input.found.length !== expected.length) {
    return {
      stepStatus: "needs_human",
      runHint: "needs_human",
      reason: `action_count_mismatch: expected=${expected.length} found=${input.found.length}`,
    };
  }
  for (const id of expected) {
    if (!byId.has(id)) {
      return {
        stepStatus: "needs_human",
        runHint: "needs_human",
        reason: `missing_action:${id}`,
      };
    }
  }

  const statuses = expected.map((id) => byId.get(id)!.status);
  if (statuses.some((s) => s === "pending" || s === "approved")) {
    return {
      stepStatus: "awaiting_approval",
      runHint: "awaiting_approval",
      reason: "still_pending",
    };
  }
  if (statuses.some((s) => s === "failed")) {
    return {
      stepStatus: "failed",
      runHint: "needs_human",
      reason: "action_failed",
    };
  }

  const executed = statuses.filter((s) => s === "executed").length;
  const rejected = statuses.filter((s) => s === "rejected").length;
  const n = statuses.length;

  if (executed === n) {
    return {
      stepStatus: "completed",
      runHint: "continue",
      reason: "all_executed",
    };
  }
  if (rejected === n) {
    return {
      stepStatus: "skipped",
      runHint: "continue",
      reason: "all_rejected",
    };
  }
  if (executed > 0 && rejected > 0 && executed + rejected === n) {
    return {
      stepStatus: "partially_executed",
      runHint: "continue",
      reason: "mixed_executed_rejected",
    };
  }

  return {
    stepStatus: "needs_human",
    runHint: "needs_human",
    reason: `unresolved_statuses:${statuses.join(",")}`,
  };
}

/** 重复 reconcile：终态步骤保持不变（awaiting_approval 必须继续） */
export function shouldSkipReconcile(currentStepStatus: string): boolean {
  return [
    "completed",
    "skipped",
    "partially_executed",
    "failed",
    "blocked",
    "needs_human",
  ].includes(currentStepStatus);
}
