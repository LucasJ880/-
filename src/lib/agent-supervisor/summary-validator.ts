/**
 * 管理摘要确定性校验
 */

import type { SupervisorState } from "./types";
import {
  ManagementSummarySchema,
  type ManagementSummary,
} from "./summary-schema";

export interface SummaryValidationIssue {
  code: string;
  message: string;
}

const FORBIDDEN_DONE_WORDS =
  /已发送|已发布|已投放|已提交投标|预算已修改|已完成发送|已经发送/;
const SLUG_IN_TITLE = /\b(sales|tender|marketing|mmm)-[a-z0-9-]+\b/i;
const RAW_JSON_BLOB = /^\s*[\{\[]/;

export function validateSupervisorSummary(
  summary: unknown,
  state: SupervisorState,
  pendingStatuses?: Map<string, string>,
): { ok: boolean; summary?: ManagementSummary; issues: SummaryValidationIssue[] } {
  const issues: SummaryValidationIssue[] = [];
  const parsed = ManagementSummarySchema.safeParse(summary);
  if (!parsed.success) {
    return {
      ok: false,
      issues: [
        {
          code: "schema",
          message: parsed.error.issues.map((i) => i.message).join("; "),
        },
      ],
    };
  }

  const s = parsed.data;
  if (!s.executiveConclusion.trim()) {
    issues.push({ code: "empty_conclusion", message: "结论不能为空" });
  }
  if (RAW_JSON_BLOB.test(s.executiveConclusion.trim())) {
    issues.push({
      code: "json_conclusion",
      message: "结论不能是原始 JSON",
    });
  }

  const orgPending = new Set(state.pendingActionIds);
  for (const id of s.pendingApprovals) {
    if (!orgPending.has(id) && !(pendingStatuses?.has(id))) {
      issues.push({
        code: "unknown_pending",
        message: `待审批 ID 不属于当前任务：${id}`,
      });
    }
  }

  for (const a of s.recommendedActions) {
    if (a.pendingActionId && !orgPending.has(a.pendingActionId)) {
      const st = pendingStatuses?.get(a.pendingActionId);
      if (!st) {
        issues.push({
          code: "orphan_pending_action",
          message: `动作引用了未知 PendingAction：${a.pendingActionId}`,
        });
      }
    }
    if (
      a.pendingActionId &&
      pendingStatuses?.get(a.pendingActionId) === "rejected" &&
      !/拒绝|未执行/.test(`${a.action}${a.reason}`)
    ) {
      issues.push({
        code: "rejected_as_done",
        message: "已拒绝动作未标明未执行",
      });
    }
    if (FORBIDDEN_DONE_WORDS.test(a.action) || FORBIDDEN_DONE_WORDS.test(a.reason)) {
      issues.push({
        code: "forbidden_done_words",
        message: "推荐动作含未授权完成用语",
      });
    }
    if (SLUG_IN_TITLE.test(a.action)) {
      issues.push({
        code: "slug_in_title",
        message: `推荐动作含技术 slug：${a.action}`,
      });
    }
  }

  if (s.recommendedActions.length > 7) {
    issues.push({ code: "too_many_actions", message: "推荐动作超过 7 项" });
  }

  const priorities = s.recommendedActions.map((a) => a.priority);
  const sorted = [...priorities].sort((a, b) => a - b);
  if (priorities.join(",") !== sorted.join(",")) {
    issues.push({ code: "priority_order", message: "推荐动作未按 priority 排序" });
  }

  const rejected = state.plan.filter((p) => p.error === "pending_action_rejected");
  for (const step of rejected) {
    const hidden =
      !s.skippedOrFailedSteps.some((x) => x.includes(step.objective.slice(0, 12))) &&
      !s.limitations.some((x) => /拒绝/.test(x)) &&
      !s.missingInformation.some((x) => /拒绝/.test(x));
    if (hidden && rejected.length > 0) {
      issues.push({
        code: "rejected_hidden",
        message: "拒绝步骤未在摘要中体现",
      });
      break;
    }
  }

  const failedOrSkipped = state.plan.filter(
    (p) => p.status === "failed" || p.status === "skipped",
  );
  if (
    failedOrSkipped.length > 0 &&
    s.skippedOrFailedSteps.length === 0 &&
    !s.limitations.some((x) => /跳过|失败|拒绝/.test(x))
  ) {
    issues.push({
      code: "failed_hidden",
      message: "失败/跳过步骤被隐藏",
    });
  }

  for (const text of [
    s.executiveConclusion,
    ...s.keyFindings.map((f) => f.finding),
    ...s.recommendedActions.map((a) => a.action),
  ]) {
    if (FORBIDDEN_DONE_WORDS.test(text)) {
      issues.push({
        code: "forbidden_done_words",
        message: "摘要含未授权完成用语",
      });
      break;
    }
  }

  // 软修复：排序与截断
  let fixed = s;
  if (issues.some((i) => i.code === "priority_order" || i.code === "too_many_actions")) {
    fixed = {
      ...s,
      recommendedActions: [...s.recommendedActions]
        .sort((a, b) => a.priority - b.priority)
        .slice(0, 7)
        .map((a, i) => ({ ...a, priority: i + 1 })),
    };
  }

  const hard = issues.filter(
    (i) =>
      ![
        "priority_order",
        "too_many_actions",
      ].includes(i.code),
  );

  return {
    ok: hard.length === 0,
    summary: fixed,
    issues,
  };
}
