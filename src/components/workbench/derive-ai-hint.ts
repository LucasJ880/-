import type { WorkQueueItem } from "./types";

/**
 * 纯规则 AI 建议。无可靠规则时返回 null（UI 隐藏区块）。
 * 禁止静态占位文案。
 */
export function deriveAiHint(item: WorkQueueItem | null): string | null {
  if (!item) return null;
  switch (item.kind) {
    case "task_overdue":
      return "建议优先确认阻塞原因并调整截止日期";
    case "project_risk":
      return "建议检查未完成阶段和负责人";
    case "task_due_today":
      return "建议在今日完成或重新排期";
    default:
      return null;
  }
}
